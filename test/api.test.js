import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbt-test-'));
const config = loadConfig({ adminPassword: 'test-password', uploadsDir: path.join(tmp, 'uploads'), isProd: false });
const db = openDb(':memory:');
const sent = [];
const app = createApp({ db, config, notifier: { enabled: true, enquiry: async e => sent.push(e) } });

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const json = (method, body, cookie) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const enquiry = { name: 'Eilidh', brand: 'Morning Rush', city: 'Glasgow', service: 'website', email: 'hello@example.com', message: 'Opening hours reel?' };

async function signIn() {
  const res = await fetch(`${base}/api/desk/login`, json('POST', { password: 'test-password' }));
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

test('the home page renders the seeded work and the form', async () => {
  const res = await fetch(base);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Chalo Baithak/);
  assert.match(html, /8,466 plays/);
  assert.match(html, /<option value="website">a café website<\/option>/);
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
  const body = await res.json();
  assert.equal(body.brand, 'Morning Rush');
  assert.equal(body.service, 'a café website');
  assert.equal(sent.at(-1).email, 'hello@example.com');
});

test('a bad enquiry comes back with a reason for each field', async () => {
  const res = await fetch(`${base}/api/enquiries`, json('POST', { name: '', brand: 'x', service: 'nope', email: 'not-an-email' }));
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
  assert.equal(res.headers.get('location'), '/?sent=1#write');
});

test('a bot filling the hidden field gets a thank-you but nothing is stored', async () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM enquiries').get().n;
  const res = await fetch(`${base}/api/enquiries`, json('POST', { ...enquiry, website: 'http://spam.example' }));
  assert.equal(res.status, 201);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM enquiries').get().n, before);
});

test('the desk is closed without signing in', async () => {
  assert.equal((await fetch(`${base}/api/desk/enquiries`)).status, 401);
  assert.equal((await fetch(`${base}/api/desk/login`, json('POST', { password: 'wrong' }))).status, 401);
});

test('signed in, the desk lists enquiries and moves them along', async () => {
  const cookie = await signIn();
  const list = await (await fetch(`${base}/api/desk/enquiries`, { headers: { Cookie: cookie } })).json();
  assert.ok(list.enquiries.length >= 2);
  assert.ok(list.counts.new >= 2);

  const id = list.enquiries.find(e => e.brand === 'Morning Rush').id;
  const res = await fetch(`${base}/api/desk/enquiries/${id}`, json('PATCH', { status: 'call booked', notes: 'Call Thursday 3pm' }, cookie));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'call booked');

  const bad = await fetch(`${base}/api/desk/enquiries/${id}`, json('PATCH', { status: 'maybe' }, cookie));
  assert.equal(bad.status, 400);
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
  const { id } = await created.json();
  assert.ok((await (await fetch(`${base}/api/work`)).json()).some(w => w.id === id));

  await fetch(`${base}/api/desk/work/${id}`, json('PATCH', { published: false }, cookie));
  assert.ok(!(await (await fetch(`${base}/api/work`)).json()).some(w => w.id === id));

  const rejected = await fetch(`${base}/api/desk/work`, json('POST', { title: 'x', image: 'javascript:alert(1)' }, cookie));
  assert.equal(rejected.status, 400);

  assert.equal((await fetch(`${base}/api/desk/work/${id}`, json('DELETE', undefined, cookie))).status, 200);
});

test('uploads accept real images only', async () => {
  const cookie = await signIn();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const ok = await fetch(`${base}/api/desk/uploads`, json('POST', { dataUrl: `data:image/png;base64,${png.toString('base64')}` }, cookie));
  assert.equal(ok.status, 201);
  const { path: saved } = await ok.json();
  assert.equal((await fetch(base + saved)).status, 200);

  const fake = await fetch(`${base}/api/desk/uploads`, json('POST', { dataUrl: `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}` }, cookie));
  assert.equal(fake.status, 400);
});

test('work titles are escaped on the page', async () => {
  const cookie = await signIn();
  await fetch(`${base}/api/desk/work`, json('POST', { title: '<script>alert(1)</script>', image: '/x.jpg' }, cookie));
  const html = await (await fetch(base)).text();
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('unknown pages and API routes are 404s', async () => {
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
});
