import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { SERVICES, STATUSES } from './content.js';
import { createRenderer } from './render.js';
import { passwordMatches, issueSession, clearSession, hasSession, requireDesk, rateLimit, checkFormToken } from './auth.js';

// One address only: no spaces, commas, angle brackets or quotes that could add a second recipient.
const EMAIL = /^[^\s@<>(),;:\"'\[\]\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
const URLISH = /^(\/(?!\/)|https:\/\/)\S*$/;

const text = (body, key) => String(body?.[key] ?? '').trim();
// Single-line fields: control characters (newlines included) become spaces, so nothing can break into an email header.
const line = (body, key) => text(body, key).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/ {2,}/g, ' ');
// Record ids are positive whole numbers; anything else simply matches nothing.
const recordId = raw => (/^[1-9]\d{0,9}$/.test(String(raw)) ? Number(raw) : 0);

// Push alerts may only go to the browsers' own push services, never to an address of the sender's choosing.
export const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];

function readEnquiry(body) {
  const e = {
    name: line(body, 'name'),
    brand: line(body, 'brand'),
    city: line(body, 'city'),
    service: line(body, 'service'),
    email: line(body, 'email'),
    message: text(body, 'message'),
  };
  const errors = {};
  if (!e.name) errors.name = 'Tell us your name.';
  else if (e.name.length > 80) errors.name = 'Keep your name under 80 characters.';
  if (!e.brand) errors.brand = 'Tell us the brand or business.';
  else if (e.brand.length > 120) errors.brand = 'Keep the brand name under 120 characters.';
  if (e.city.length > 80) errors.city = 'Keep the place under 80 characters.';
  if (!Object.hasOwn(SERVICES, e.service)) errors.service = 'Choose what you would like help with.';
  if (!EMAIL.test(e.email) || e.email.length > 160) errors.email = 'Check your email address.';
  if (e.message.length > 2000) errors.message = 'Keep the note under 2,000 characters.';
  return { e, errors };
}

function readWork(body, partial) {
  const w = {};
  const errors = {};
  const has = k => !partial || Object.hasOwn(body ?? {}, k);
  const field = (k, max, { required = false, url = false } = {}) => {
    if (!has(k)) return;
    const v = text(body, k);
    if (required && !v) errors[k] = 'Required.';
    else if (v.length > max) errors[k] = `Keep it under ${max} characters.`;
    else if (url && v && !URLISH.test(v)) errors[k] = 'Use a /path on this site or an https:// link.';
    else w[k] = v;
  };
  field('title', 120, { required: true });
  field('summary', 400);
  field('metric', 40);
  field('link', 400, { url: true });
  field('image', 400, { required: true, url: true });
  field('video', 400, { url: true });
  field('alt', 200);
  // Optional on create too: a new piece goes to the end and is published unless told otherwise.
  const given = k => Object.hasOwn(body ?? {}, k) && body[k] !== '' && body[k] !== null;
  if (given('position')) {
    const p = Number(body.position);
    if (Number.isInteger(p) && p >= 0 && p < 10000) w.position = p;
    else errors.position = 'Use a whole number.';
  }
  if (given('published')) w.published = body.published ? 1 : 0;
  return { w, errors };
}

const IMAGE_TYPES = {
  'image/jpeg': { ext: '.jpg', magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: '.png', magic: b => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  'image/webp': { ext: '.webp', magic: b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
};

const NO_PUSH = { publicKey: async () => '', subscribe: async () => {}, unsubscribe: async () => false, count: async () => 0, test: async () => ({ sent: 0 }), enquiry: async () => {} };

export function createApp({ store, config, notifier, push = NO_PUSH }) {
  const app = express();
  const renderHome = createRenderer(config);
  if (store.canUpload) fs.mkdirSync(config.uploadsDir, { recursive: true });

  app.disable('x-powered-by');
  if (config.isProd) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'",
        "img-src 'self' data: https:",
        "media-src 'self' https:",
        "style-src 'self' https://fonts.googleapis.com",
        'font-src https://fonts.gstatic.com',
        "script-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      ...(config.isProd ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload' } : {}),
    });
    next();
  });

  // ---------- pages ----------

  app.get('/', async (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(renderHome({ query: req.query }));
  });

  app.get(['/admin', '/admin/'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(config.publicDir, 'admin', 'index.html'));
  });

  app.use(express.static(config.publicDir, { index: false, maxAge: config.isProd ? '7d' : 0 }));
  if (store.canUpload) app.use('/uploads', express.static(config.uploadsDir, { maxAge: config.isProd ? '30d' : 0 }));

  // ---------- public API ----------

  app.get('/api/work', async (req, res) => res.json(await store.work.published()));

  app.post(
    '/api/enquiries',
    express.json({ limit: '20kb' }),
    express.urlencoded({ extended: false, limit: '20kb' }),
    rateLimit({ store, name: 'enquiry', windowMs: 10 * 60e3, max: 5, message: 'Too many messages from here. Try again in a few minutes, or email contentbook7@gmail.com.' }),
    rateLimit({ store, name: 'enquiry-all', key: () => 'all', windowMs: 60 * 60e3, max: 60, message: 'We are getting a lot of messages right now. Please email contentbook7@gmail.com instead.' }),
    async (req, res) => {
      const wantsJson = req.is('application/json');
      const body = req.body ?? {};
      const thanks = () => (wantsJson ? res.status(201).json({ ok: true }) : res.redirect(303, '/?sent=1#contact'));

      // Bots: the hidden "website" field is only ever filled in by them, and a post without our page's
      // signed timestamp, or sent seconds after the page loaded, was not typed by a person. They get a
      // thank-you, so they learn nothing, and nothing is stored or sent.
      if (text(body, 'website')) return thanks();
      const token = checkFormToken(body.ts, config);
      if (token === 'bot') return thanks();
      if (token === 'stale') {
        const again = 'This page was open for a long time. Refresh it and send your message again.';
        return wantsJson ? res.status(400).json({ error: again, fields: {} }) : res.redirect(303, `/?error=${encodeURIComponent(again)}#contact`);
      }

      const { e, errors } = readEnquiry(body);
      if (Object.keys(errors).length) {
        if (wantsJson) return res.status(400).json({ error: 'Some answers need another look.', fields: errors });
        return res.redirect(303, `/?error=${encodeURIComponent(Object.values(errors)[0])}#contact`);
      }

      const saved = await store.enquiries.add(e);
      // Awaited so a serverless host does not stop the function before the email and the push are out.
      await Promise.all([
        notifier.enquiry(saved).catch(err => console.error(`Enquiry #${saved.id} saved, but the email failed:`, err.message)),
        push.enquiry(saved).catch(err => console.error(`Enquiry #${saved.id} saved, but the phone alert failed:`, err.message)),
      ]);

      // The reply carries nothing back: the page already has what the visitor typed.
      thanks();
    },
  );

  // ---------- studio desk (admin) ----------

  const desk = express.Router();
  // Small bodies everywhere, except image uploads.
  const smallJson = express.json({ limit: '100kb' });
  const bigJson = express.json({ limit: '8mb' });
  desk.use((req, res, next) => (req.path === '/uploads' ? bigJson : smallJson)(req, res, next));

  desk.post(
    '/login',
    rateLimit({ store, name: 'login', windowMs: 15 * 60e3, max: 8, message: 'Too many tries. Wait 15 minutes.' }),
    async (req, res) => {
      if (!config.adminPassword) return res.status(503).json({ error: 'The desk is locked: set ADMIN_PASSWORD on the server first.' });
      const password = text(req.body, 'password');
      if (password.length > 200 || !passwordMatches(password, config.adminPassword)) {
        // Wrong guesses from every address together are capped too, so a botnet cannot share out the guessing.
        const failures = await store.limits?.hit('login-fail:all', 60 * 60e3).catch(() => 0);
        if (failures > 100) return res.status(429).set('Retry-After', '3600').json({ error: 'Too many wrong passwords. The desk is paused for an hour.' });
        return res.status(401).json({ error: 'That password is not right.' });
      }
      issueSession(res, config);
      res.json({ ok: true });
    },
  );

  desk.get('/me', (req, res) => {
    const signedIn = hasSession(req, config);
    // Strangers learn only whether to show the sign-in box.
    if (!signedIn) return res.json({ signedIn, configured: Boolean(config.adminPassword) });
    res.json({ signedIn, configured: true, mail: notifier.enabled, uploads: store.canUpload });
  });

  desk.post('/logout', (req, res) => {
    clearSession(res, config);
    res.json({ ok: true });
  });

  desk.use(requireDesk(config));

  // phone alerts: each phone subscribes from the desk
  desk.get('/push', async (req, res) => res.json({ publicKey: await push.publicKey(), phones: await push.count() }));

  desk.post('/push/subscribe', async (req, res) => {
    const sub = req.body?.subscription;
    let host = '';
    try { host = new URL(sub?.endpoint).hostname; } catch {}
    const ok = sub && typeof sub.endpoint === 'string' && /^https:\/\/\S{8,1000}$/.test(sub.endpoint) && PUSH_HOSTS.some(h => h.test(host))
      && typeof sub.keys?.p256dh === 'string' && sub.keys.p256dh.length < 200
      && typeof sub.keys?.auth === 'string' && sub.keys.auth.length < 100;
    if (!ok) return res.status(400).json({ error: 'That is not a push subscription.' });
    await push.subscribe(sub);
    res.status(201).json({ ok: true, phones: await push.count() });
  });

  desk.post('/push/unsubscribe', async (req, res) => {
    await push.unsubscribe(text(req.body, 'endpoint'));
    res.json({ ok: true, phones: await push.count() });
  });

  // A phone does not show a banner for the app that is open on screen, so the desk can ask
  // for the test a few seconds later, giving time to lock the phone or switch apps.
  desk.post('/push/test', async (req, res) => {
    const wait = Math.min(Math.max(Number(req.body?.delay) || 0, 0), 8);
    if (wait) await new Promise(r => setTimeout(r, wait * 1000));
    res.json(await push.test());
  });

  desk.get('/enquiries', async (req, res) => {
    const status = text(req.query, 'status');
    const enquiries = await store.enquiries.list(STATUSES.includes(status) ? status : '');
    const counts = { ...Object.fromEntries(STATUSES.map(s => [s, 0])), ...(await store.enquiries.counts()) };
    res.json({ enquiries, counts, statuses: STATUSES, services: SERVICES });
  });

  desk.patch('/enquiries/:id', async (req, res) => {
    const changes = {};
    if (Object.hasOwn(req.body ?? {}, 'status')) {
      if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Unknown status.' });
      changes.status = req.body.status;
    }
    if (Object.hasOwn(req.body ?? {}, 'notes')) {
      const notes = String(req.body.notes ?? '');
      if (notes.length > 5000) return res.status(400).json({ error: 'Keep notes under 5,000 characters.' });
      changes.notes = notes;
    }
    if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to change.' });
    const updated = await store.enquiries.update(recordId(req.params.id), changes);
    if (!updated) return res.status(404).json({ error: 'No such enquiry.' });
    res.json(updated);
  });

  desk.delete('/enquiries/:id', async (req, res) => {
    if (!(await store.enquiries.remove(recordId(req.params.id)))) return res.status(404).json({ error: 'No such enquiry.' });
    res.json({ ok: true });
  });

  desk.get('/work', async (req, res) => res.json(await store.work.all()));

  desk.post('/work', async (req, res) => {
    const { w, errors } = readWork(req.body, false);
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Some fields need another look.', fields: errors });
    res.status(201).json(await store.work.add(w));
  });

  desk.patch('/work/:id', async (req, res) => {
    const { w, errors } = readWork(req.body, true);
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Some fields need another look.', fields: errors });
    if (!Object.keys(w).length) return res.status(400).json({ error: 'Nothing to change.' });
    const updated = await store.work.update(recordId(req.params.id), w);
    if (!updated) return res.status(404).json({ error: 'No such piece of work.' });
    res.json(updated);
  });

  desk.delete('/work/:id', async (req, res) => {
    if (!(await store.work.remove(recordId(req.params.id)))) return res.status(404).json({ error: 'No such piece of work.' });
    res.json({ ok: true });
  });

  // Images arrive as data URLs from the desk's file picker and are saved under DATA_DIR/uploads.
  desk.post('/uploads', (req, res) => {
    if (!store.canUpload) {
      return res.status(501).json({ error: 'Uploads are off on this host. Paste an https:// image link instead, or add the file to public/assets and redeploy.' });
    }
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(text(req.body, 'dataUrl'));
    if (!match) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP image.' });
    const type = IMAGE_TYPES[match[1]];
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Keep images under 5 MB.' });
    if (!type.magic(bytes)) return res.status(400).json({ error: 'That file is not the image type it says it is.' });
    const name = crypto.randomUUID() + type.ext;
    fs.writeFileSync(path.join(config.uploadsDir, name), bytes);
    res.status(201).json({ path: `/uploads/${name}` });
  });

  app.use('/api/desk', desk);

  // ---------- fallbacks ----------

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((req, res) => res.status(404).sendFile(path.join(config.publicDir, '404.html')));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const message = status === 413 ? 'That is too large to send.' : status >= 500 ? 'Something went wrong on our side.' : 'That request could not be read.';
    if (req.path.startsWith('/api')) return res.status(status).json({ error: message });
    res.status(status).type('text').send(message);
  });

  return app;
}
