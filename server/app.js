import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { SERVICES, STATUSES } from './db.js';
import { createRenderer } from './render.js';
import { passwordMatches, issueSession, clearSession, hasSession, requireDesk, rateLimit } from './auth.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URLISH = /^(\/(?!\/)|https:\/\/)\S*$/;

const text = (body, key) => String(body?.[key] ?? '').trim();

function readEnquiry(body) {
  const e = {
    name: text(body, 'name'),
    brand: text(body, 'brand'),
    city: text(body, 'city'),
    service: text(body, 'service'),
    email: text(body, 'email'),
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

export function createApp({ db, config, notifier }) {
  const app = express();
  const renderHome = createRenderer(config);
  fs.mkdirSync(config.uploadsDir, { recursive: true });

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
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
  });

  const q = {
    publishedWork: db.prepare('SELECT id, title, summary, metric, link, image, video, alt FROM work WHERE published = 1 ORDER BY position, id'),
    allWork: db.prepare('SELECT * FROM work ORDER BY position, id'),
    getWork: db.prepare('SELECT * FROM work WHERE id = ?'),
    deleteWork: db.prepare('DELETE FROM work WHERE id = ?'),
    insertEnquiry: db.prepare('INSERT INTO enquiries (name, brand, city, service, email, message) VALUES (?, ?, ?, ?, ?, ?)'),
    getEnquiry: db.prepare('SELECT * FROM enquiries WHERE id = ?'),
    deleteEnquiry: db.prepare('DELETE FROM enquiries WHERE id = ?'),
    counts: db.prepare('SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status'),
  };

  // ---------- pages ----------

  app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(renderHome({ work: q.publishedWork.all(), query: req.query }));
  });

  app.get(['/admin', '/admin/'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(config.publicDir, 'admin', 'index.html'));
  });

  app.use(express.static(config.publicDir, { index: false, maxAge: config.isProd ? '7d' : 0 }));
  app.use('/uploads', express.static(config.uploadsDir, { maxAge: config.isProd ? '30d' : 0 }));

  // ---------- public API ----------

  app.get('/api/work', (req, res) => res.json(q.publishedWork.all()));

  app.post(
    '/api/enquiries',
    express.json({ limit: '20kb' }),
    express.urlencoded({ extended: false, limit: '20kb' }),
    rateLimit({ windowMs: 10 * 60e3, max: 5, message: 'Too many messages from here. Try again in a few minutes, or email contentbook7@gmail.com.' }),
    async (req, res) => {
      const wantsJson = req.is('application/json');
      const body = req.body ?? {};

      // The hidden "website" field is only ever filled in by bots.
      if (text(body, 'website')) return wantsJson ? res.status(201).json({ ok: true }) : res.redirect(303, '/?sent=1#write');

      const { e, errors } = readEnquiry(body);
      if (Object.keys(errors).length) {
        if (wantsJson) return res.status(400).json({ error: 'Some answers need another look.', fields: errors });
        return res.redirect(303, `/?error=${encodeURIComponent(Object.values(errors)[0])}#write`);
      }

      const { lastInsertRowid } = q.insertEnquiry.run(e.name, e.brand, e.city, e.service, e.email, e.message);
      const saved = { id: Number(lastInsertRowid), ...e };
      notifier.enquiry(saved).catch(err => console.error(`Enquiry #${saved.id} saved, but the email failed:`, err.message));

      if (!wantsJson) return res.redirect(303, '/?sent=1#write');
      res.status(201).json({ ok: true, id: saved.id, name: e.name, brand: e.brand, city: e.city, email: e.email, service: SERVICES[e.service] });
    },
  );

  // ---------- studio desk (admin) ----------

  const desk = express.Router();
  desk.use(express.json({ limit: '8mb' }));

  desk.post(
    '/login',
    rateLimit({ windowMs: 15 * 60e3, max: 8, message: 'Too many tries. Wait 15 minutes.' }),
    (req, res) => {
      if (!config.adminPassword) return res.status(503).json({ error: 'The desk is locked: set ADMIN_PASSWORD on the server first.' });
      if (!passwordMatches(text(req.body, 'password'), config.adminPassword)) return res.status(401).json({ error: 'That password is not right.' });
      issueSession(res, config);
      res.json({ ok: true });
    },
  );

  desk.get('/me', (req, res) => res.json({ signedIn: hasSession(req, config), configured: Boolean(config.adminPassword), mail: notifier.enabled }));

  desk.post('/logout', (req, res) => {
    clearSession(res, config);
    res.json({ ok: true });
  });

  desk.use(requireDesk(config));

  desk.get('/enquiries', (req, res) => {
    const status = text(req.query, 'status');
    const rows = STATUSES.includes(status)
      ? db.prepare('SELECT * FROM enquiries WHERE status = ? ORDER BY created_at DESC').all(status)
      : db.prepare('SELECT * FROM enquiries ORDER BY created_at DESC').all();
    const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
    for (const { status: s, n } of q.counts.all()) counts[s] = n;
    res.json({ enquiries: rows, counts, statuses: STATUSES, services: SERVICES });
  });

  desk.patch('/enquiries/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!q.getEnquiry.get(id)) return res.status(404).json({ error: 'No such enquiry.' });
    const sets = [];
    const args = [];
    if (Object.hasOwn(req.body ?? {}, 'status')) {
      if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Unknown status.' });
      sets.push('status = ?');
      args.push(req.body.status);
    }
    if (Object.hasOwn(req.body ?? {}, 'notes')) {
      const notes = String(req.body.notes ?? '');
      if (notes.length > 5000) return res.status(400).json({ error: 'Keep notes under 5,000 characters.' });
      sets.push('notes = ?');
      args.push(notes);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
    db.prepare(`UPDATE enquiries SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(...args, id);
    res.json(q.getEnquiry.get(id));
  });

  desk.delete('/enquiries/:id', (req, res) => {
    const { changes } = q.deleteEnquiry.run(Number(req.params.id));
    if (!changes) return res.status(404).json({ error: 'No such enquiry.' });
    res.json({ ok: true });
  });

  desk.get('/work', (req, res) => res.json(q.allWork.all()));

  desk.post('/work', (req, res) => {
    const { w, errors } = readWork(req.body, false);
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Some fields need another look.', fields: errors });
    const position = w.position ?? db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM work').get().p;
    const { lastInsertRowid } = db
      .prepare('INSERT INTO work (title, summary, metric, link, image, video, alt, position, published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(w.title, w.summary ?? '', w.metric ?? '', w.link ?? '', w.image, w.video ?? '', w.alt ?? '', position, w.published ?? 1);
    res.status(201).json(q.getWork.get(Number(lastInsertRowid)));
  });

  desk.patch('/work/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!q.getWork.get(id)) return res.status(404).json({ error: 'No such piece of work.' });
    const { w, errors } = readWork(req.body, true);
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Some fields need another look.', fields: errors });
    const keys = Object.keys(w);
    if (!keys.length) return res.status(400).json({ error: 'Nothing to change.' });
    db.prepare(`UPDATE work SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => w[k]), id);
    res.json(q.getWork.get(id));
  });

  desk.delete('/work/:id', (req, res) => {
    const { changes } = q.deleteWork.run(Number(req.params.id));
    if (!changes) return res.status(404).json({ error: 'No such piece of work.' });
    res.json({ ok: true });
  });

  // Images arrive as data URLs from the desk's file picker and are saved under DATA_DIR/uploads.
  desk.post('/uploads', (req, res) => {
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
