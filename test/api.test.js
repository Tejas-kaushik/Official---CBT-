import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { createSqliteStore } from '../server/store/sqlite.js';
import { createRedisStore } from '../server/store/redis.js';
import { createApp } from '../server/app.js';
import { createPush } from '../server/push.js';
import { formToken } from '../server/auth.js';
import { fakeUpstash } from './fake-upstash.js';

// The same checks run against both stores: SQLite (local, Render) and Upstash Redis (Vercel).
const stores = {
  sqlite: () => createSqliteStore(':memory:'),
  redis: () => createRedisStore({ url: 'https://fake.upstash.io', token: 'test-token', fetch: fakeUpstash() }),
};

for (const [kind, makeStore] of Object.entries(stores)) {
  describe(`with ${kind}`, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbt-test-'));
    const config = loadConfig({ adminPassword: 'test-password', uploadsDir: path.join(tmp, 'uploads'), isProd: false });
    const store = makeStore();
    const sent = [];
    const pushed = [];
    const gone = new Set();
    const push = createPush(store, {
      subject: 'mailto:test@example.com',
      send: async (sub, payload, options) => {
        if (gone.has(sub.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 });
        pushed.push({ endpoint: sub.endpoint, ...JSON.parse(payload), publicKey: options.vapidDetails.publicKey });
      },
    });
    const app = createApp({ store, config, notifier: { enabled: true, enquiry: async e => sent.push(e) }, push });

    let server;
    let base;
    before(async () => {
      server = app.listen(0);
      await new Promise(r => server.once('listening', r));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => {
      server.close();
      store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    const json = (method, body, cookie) => ({
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // ts: the signed timestamp the page puts in the form, as if it loaded ten seconds ago.
    const enquiry = { name: 'Eilidh', brand: 'Morning Rush', city: 'Glasgow', service: 'website', email: 'hello@example.com', message: 'Opening hours reel?', ts: formToken(config, Date.now() - 10_000) };

    async function signIn() {
      const res = await fetch(`${base}/api/desk/login`, json('POST', { password: 'test-password' }));
      assert.equal(res.status, 200);
      return res.headers.get('set-cookie').split(';')[0];
    }

    test('the home page renders the services and the form', async () => {
      const res = await fetch(base);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /What we offer/);
      assert.doesNotMatch(html, /Chalo Baithak|plays/);
      assert.match(html, /<option value="website">A website<\/option>/);
      assert.match(html, /<symbol id="wm-content"/);
      assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    });

    test('a service link pre-selects that service', async () => {
      const html = await (await fetch(`${base}/?service=strategy`)).text();
      assert.match(html, /<option value="strategy" selected>/);
    });

    test('a valid enquiry is saved and the studio is notified', async () => {
      const res = await fetch(`${base}/api/enquiries`, json('POST', enquiry));
      assert.equal(res.status, 201);
      // The reply carries nothing back about the enquiry.
      assert.deepEqual(await res.json(), { ok: true });
      assert.equal(sent.at(-1).email, 'hello@example.com');
      assert.equal(sent.at(-1).brand, 'Morning Rush');
    });

    test('a bad enquiry comes back with a reason for each field', async () => {
      const res = await fetch(`${base}/api/enquiries`, json('POST', { name: '', brand: 'x', service: 'nope', email: 'not-an-email', ts: enquiry.ts }));
      assert.equal(res.status, 400);
      const { fields } = await res.json();
      assert.deepEqual(Object.keys(fields).sort(), ['email', 'name', 'service']);
    });

    test('the form still works without JavaScript', async () => {
      const res = await fetch(`${base}/api/enquiries`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...enquiry, brand: 'No Script Café' }),
      });
      assert.equal(res.status, 303);
      assert.equal(res.headers.get('location'), '/?sent=1#contact');
    });

    test('a bot filling the hidden field gets a thank-you but nothing is stored', async () => {
      const count = (await store.enquiries.list()).length;
      const res = await fetch(`${base}/api/enquiries`, json('POST', { ...enquiry, website: 'http://spam.example' }));
      assert.equal(res.status, 201);
      assert.equal((await store.enquiries.list()).length, count);
    });

    test('the desk is closed without signing in', async () => {
      assert.equal((await fetch(`${base}/api/desk/enquiries`)).status, 401);
      assert.equal((await fetch(`${base}/api/desk/login`, json('POST', { password: 'wrong' }))).status, 401);
    });

    test('signed in, the desk lists enquiries newest first and moves them along', async () => {
      const cookie = await signIn();
      const list = await (await fetch(`${base}/api/desk/enquiries`, { headers: { Cookie: cookie } })).json();
      assert.equal(list.enquiries.length, 2);
      assert.equal(list.enquiries[0].brand, 'No Script Café');
      assert.equal(list.counts.new, 2);

      const id = list.enquiries.find(e => e.brand === 'Morning Rush').id;
      const res = await fetch(`${base}/api/desk/enquiries/${id}`, json('PATCH', { status: 'call booked', notes: 'Call Thursday 3pm' }, cookie));
      assert.equal(res.status, 200);
      assert.equal((await res.json()).notes, 'Call Thursday 3pm');

      const booked = await (await fetch(`${base}/api/desk/enquiries?status=call%20booked`, { headers: { Cookie: cookie } })).json();
      assert.deepEqual(booked.enquiries.map(e => e.id), [id]);
      assert.equal(booked.counts['call booked'], 1);

      assert.equal((await fetch(`${base}/api/desk/enquiries/${id}`, json('PATCH', { status: 'maybe' }, cookie))).status, 400);
      assert.equal((await fetch(`${base}/api/desk/enquiries/9999`, json('PATCH', { status: 'won' }, cookie))).status, 404);
      assert.equal((await fetch(`${base}/api/desk/enquiries/${id}`, json('DELETE', undefined, cookie))).status, 200);
      assert.equal((await store.enquiries.list()).length, 1);
    });

    test('desk writes must be JSON', async () => {
      const cookie = await signIn();
      const res = await fetch(`${base}/api/desk/work`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
        body: 'title=x&image=/x.jpg',
      });
      assert.equal(res.status, 415);
    });

    test('work can be added, hidden and removed, and the site follows', async () => {
      const cookie = await signIn();
      const created = await fetch(`${base}/api/desk/work`, json('POST', { title: 'Morning Rush launch', image: '/assets/media/work-matcha.jpg', metric: '1,000 plays' }, cookie));
      assert.equal(created.status, 201);
      const piece = await created.json();
      assert.equal(piece.position, 5);
      assert.ok((await (await fetch(`${base}/api/work`)).json()).some(w => w.id === piece.id));

      await fetch(`${base}/api/desk/work/${piece.id}`, json('PATCH', { published: false }, cookie));
      assert.ok(!(await (await fetch(`${base}/api/work`)).json()).some(w => w.id === piece.id));

      const rejected = await fetch(`${base}/api/desk/work`, json('POST', { title: 'x', image: 'javascript:alert(1)' }, cookie));
      assert.equal(rejected.status, 400);

      assert.equal((await fetch(`${base}/api/desk/work/${piece.id}`, json('DELETE', undefined, cookie))).status, 200);
      assert.equal((await (await fetch(`${base}/api/desk/work`, { headers: { Cookie: cookie } })).json()).length, 4);
    });

    test(store.canUpload ? 'uploads accept real images only' : 'uploads are refused with a reason', async () => {
      const cookie = await signIn();
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      const ok = await fetch(`${base}/api/desk/uploads`, json('POST', { dataUrl: `data:image/png;base64,${png.toString('base64')}` }, cookie));
      if (!store.canUpload) return assert.equal(ok.status, 501);
      assert.equal(ok.status, 201);
      const { path: saved } = await ok.json();
      assert.equal((await fetch(base + saved)).status, 200);

      const fake = await fetch(`${base}/api/desk/uploads`, json('POST', { dataUrl: `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}` }, cookie));
      assert.equal(fake.status, 400);
    });

    const phone = n => ({ endpoint: `https://fcm.googleapis.com/fcm/send/phone-${n}`, keys: { p256dh: 'BKey'.padEnd(87, 'x'), auth: 'auth-secret-16' } });

    test('phone alerts need the desk password', async () => {
      assert.equal((await fetch(`${base}/api/desk/push`)).status, 401);
      assert.equal((await fetch(`${base}/api/desk/push/subscribe`, json('POST', { subscription: phone(1) }))).status, 401);
      assert.equal((await fetch(`${base}/api/desk/push/test`, json('POST', {}))).status, 401);
    });

    test('a phone subscribes once and gets an alert for each new enquiry, linked to it', async () => {
      const cookie = await signIn();
      const { publicKey } = await (await fetch(`${base}/api/desk/push`, { headers: { Cookie: cookie } })).json();
      assert.match(publicKey, /^[A-Za-z0-9_-]{80,}$/);
      // the key is kept, not remade
      assert.equal((await (await fetch(`${base}/api/desk/push`, { headers: { Cookie: cookie } })).json()).publicKey, publicKey);

      assert.equal((await fetch(`${base}/api/desk/push/subscribe`, json('POST', { subscription: { endpoint: 'javascript:alert(1)', keys: {} } }, cookie))).status, 400);
      for (let i = 0; i < 2; i++) assert.equal((await fetch(`${base}/api/desk/push/subscribe`, json('POST', { subscription: phone(1) }, cookie))).status, 201);
      const res = await fetch(`${base}/api/desk/push/subscribe`, json('POST', { subscription: phone(2) }, cookie));
      assert.equal((await res.json()).phones, 2);

      pushed.length = 0;
      await fetch(`${base}/api/enquiries`, json('POST', { ...enquiry, brand: 'Toro Coffee' }));
      const saved = sent.at(-1);
      assert.equal(pushed.length, 2);
      assert.equal(pushed[0].title, 'New enquiry: Toro Coffee');
      assert.match(pushed[0].body, /Eilidh \(Glasgow\) wants a website\. "Opening hours reel\?"/);
      assert.equal(pushed[0].url, `/admin#enquiry-${saved.id}`);
      assert.equal(pushed[0].publicKey, publicKey);
    });

    test('a phone that has gone away is forgotten, and the test alert reports who got it', async () => {
      const cookie = await signIn();
      gone.add(phone(2).endpoint);
      const first = await (await fetch(`${base}/api/desk/push/test`, json('POST', {}, cookie))).json();
      assert.deepEqual(first, { sent: 1, removed: 1 });
      assert.equal((await store.push.list()).length, 1);

      const off = await fetch(`${base}/api/desk/push/unsubscribe`, json('POST', { endpoint: phone(1).endpoint }, cookie));
      assert.equal((await off.json()).phones, 0);
      assert.deepEqual(await (await fetch(`${base}/api/desk/push/test`, json('POST', {}, cookie))).json(), { sent: 0, removed: 0 });
    });

    test('the desk is installable and its service worker is served', async () => {
      const manifest = await (await fetch(`${base}/admin/manifest.webmanifest`)).json();
      assert.equal(manifest.start_url, '/admin');
      assert.equal(manifest.display, 'standalone');
      const sw = await fetch(`${base}/sw.js`);
      assert.equal(sw.status, 200);
      assert.match(await sw.text(), /notificationclick/);
    });

    test('error messages are escaped on the page', async () => {
      const html = await (await fetch(`${base}/?error=${encodeURIComponent('<script>alert(1)</script>')}`)).text();
      assert.ok(!html.includes('<script>alert(1)</script>'));
      assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    });

    test('unknown pages and API routes are 404s', async () => {
      assert.equal((await fetch(`${base}/nope`)).status, 404);
      assert.equal((await fetch(`${base}/api/nope`)).status, 404);
    });
  });
}
