import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadConfig } from '../server/config.js';
import { createSqliteStore } from '../server/store/sqlite.js';
import { createRedisStore } from '../server/store/redis.js';
import { encryptStore, parseKey } from '../server/store/encrypt.js';
import { createApp } from '../server/app.js';
import { formToken } from '../server/auth.js';
import { fakeUpstash } from './fake-upstash.js';

// Each check gets a fresh store, so rate limits from one never leak into another.
const servers = [];
async function start({ store = createSqliteStore(':memory:'), config: overrides = {} } = {}) {
  const config = loadConfig({ adminPassword: 'test-password', isProd: false, ...overrides });
  const sent = [];
  const app = createApp({ store, config, notifier: { enabled: true, enquiry: async e => sent.push(e) } });
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  servers.push(server);
  return { base: `http://127.0.0.1:${server.address().port}`, store, config, sent };
}
after(() => servers.forEach(s => s.close()));

const post = (url, body, cookie) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const person = config => ({ name: 'Ava', brand: 'Toro Coffee', city: 'Glasgow', service: 'website', email: 'ava@example.com', message: 'Hi', ts: formToken(config, Date.now() - 10_000) });
const signIn = async base => (await post(`${base}/api/desk/login`, { password: 'test-password' })).headers.get('set-cookie').split(';')[0];

describe('bot protection', () => {
  test('the page carries a signed timestamp and a real visitor gets through', async () => {
    const { base, config, store } = await start();
    const html = await (await fetch(base)).text();
    assert.match(html, /<input type="hidden" name="ts" value="\d{13}\.[\w-]{22}">/);
    const res = await post(`${base}/api/enquiries`, person(config));
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal((await store.enquiries.list()).length, 1);
  });

  test('no timestamp, a forged one, or a form sent within 3 seconds is dropped quietly', async () => {
    const { base, config, store, sent } = await start();
    const attempts = [
      { ...person(config), ts: undefined },
      { ...person(config), ts: `${Date.now() - 10_000}.forgedforgedforgedforg` },
      { ...person(config), ts: formToken(config, Date.now() - 500) },
    ];
    for (const a of attempts) {
      const res = await post(`${base}/api/enquiries`, a);
      assert.equal(res.status, 201, 'a bot sees the same thank-you as a person');
    }
    assert.equal((await store.enquiries.list()).length, 0);
    assert.equal(sent.length, 0);
  });

  test('a page left open for over a week is asked to refresh, not dropped', async () => {
    const { base, config } = await start();
    const res = await post(`${base}/api/enquiries`, { ...person(config), ts: formToken(config, Date.now() - 8 * 864e5) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Refresh/);
  });
});

describe('input validation', () => {
  test('newlines cannot be smuggled into the email headers', async () => {
    const { base, config, sent } = await start();
    await post(`${base}/api/enquiries`, { ...person(config), brand: 'Toro\r\nBcc: victim@example.com', name: 'Ava\nX-Evil: 1' });
    assert.equal(sent[0].brand, 'Toro Bcc: victim@example.com');
    assert.doesNotMatch(sent[0].name, /\n/);
  });

  test('an email field holding two addresses is refused', async () => {
    const { base, config } = await start();
    for (const email of ['a@b.co,c@d.co', 'a@b.co>,x', '"x"@b.co', 'a@b.co\nbcc:c@d.co', 'a@-b.co']) {
      const res = await post(`${base}/api/enquiries`, { ...person(config), email });
      assert.equal(res.status, 400, email);
    }
  });

  test('desk requests over 100 kB are refused', async () => {
    const { base, config } = await start();
    await post(`${base}/api/enquiries`, person(config));
    const cookie = await signIn(base);
    const res = await fetch(`${base}/api/desk/enquiries/1`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ notes: 'x'.repeat(200_000) }) });
    assert.equal(res.status, 413);
  });
});

describe('rate limits are shared between server instances', () => {
  test('login: the 9th wrong guess is blocked even when it reaches another instance', async () => {
    const store = createRedisStore({ url: 'https://fake.upstash.io', token: 'test-token', fetch: fakeUpstash() });
    const a = await start({ store });
    const b = await start({ store });
    for (let i = 0; i < 8; i++) assert.equal((await post(`${(i % 2 ? a : b).base}/api/desk/login`, { password: 'nope' })).status, 401);
    assert.equal((await post(`${a.base}/api/desk/login`, { password: 'nope' })).status, 429);
    assert.equal((await post(`${b.base}/api/desk/login`, { password: 'test-password' })).status, 429, 'even the right password waits');
  });

  test('enquiries: the 6th from one address in ten minutes is blocked across instances', async () => {
    const store = createSqliteStore(':memory:');
    const a = await start({ store });
    const b = await start({ store });
    for (let i = 0; i < 5; i++) assert.equal((await post(`${(i % 2 ? a : b).base}/api/enquiries`, person(a.config))).status, 201);
    assert.equal((await post(`${b.base}/api/enquiries`, person(a.config))).status, 429);
  });
});

describe('server-side auth and record access', () => {
  test('every desk route refuses a visitor who is not signed in', async () => {
    const { base } = await start();
    const routes = [['GET', '/enquiries'], ['PATCH', '/enquiries/1'], ['DELETE', '/enquiries/1'], ['GET', '/work'], ['POST', '/work'], ['PATCH', '/work/1'], ['DELETE', '/work/1'], ['POST', '/uploads'], ['GET', '/push'], ['POST', '/push/subscribe'], ['POST', '/push/test']];
    for (const [method, path] of routes) {
      const res = await fetch(`${base}/api/desk${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });

  test('a forged or expired session cookie is refused', async () => {
    const { base } = await start();
    const real = await signIn(base);
    const [payload, mac] = real.split('=')[1].split('.');
    const forever = Buffer.from(JSON.stringify({ exp: Date.now() + 1e12 })).toString('base64url');
    for (const cookie of [`cbt_desk=${forever}.${mac}`, `cbt_desk=${payload}.${'A'.repeat(mac.length)}`, 'cbt_desk=garbage']) {
      assert.equal((await fetch(`${base}/api/desk/enquiries`, { headers: { Cookie: cookie } })).status, 401, cookie);
    }
  });

  test('strangers learn only whether to show the sign-in box', async () => {
    const { base } = await start();
    assert.deepEqual(await (await fetch(`${base}/api/desk/me`)).json(), { signedIn: false, configured: true });
  });

  test('odd record ids match nothing, and the visitor cannot set their own status', async () => {
    const { base, config, store } = await start();
    await post(`${base}/api/enquiries`, { ...person(config), status: 'won', notes: 'pay me', id: 999 });
    const [row] = await store.enquiries.list();
    assert.equal(row.status, 'new');
    assert.equal(row.notes, '');
    assert.equal(row.id, 1);
    const cookie = await signIn(base);
    for (const id of ['1abc', '-1', '0', '1.5', '01', '99999999999']) {
      const res = await fetch(`${base}/api/desk/enquiries/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{"status":"won"}' });
      assert.equal(res.status, 404, id);
    }
    const tamper = await fetch(`${base}/api/desk/enquiries/1`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{"email":"evil@example.com","created_at":"2000-01-01"}' });
    assert.equal(tamper.status, 400);
    assert.equal((await store.enquiries.list())[0].email, 'ava@example.com');
  });

  test('push alerts can only be pointed at real push services', async () => {
    const { base } = await start();
    const cookie = await signIn(base);
    const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
    for (const endpoint of ['https://169.254.169.254/latest/meta-data', 'https://localhost/x', 'https://evil.example.com/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.com/x']) {
      assert.equal((await post(`${base}/api/desk/push/subscribe`, { subscription: { endpoint, keys } }, cookie)).status, 400, endpoint);
    }
    for (const endpoint of ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc']) {
      assert.equal((await post(`${base}/api/desk/push/subscribe`, { subscription: { endpoint, keys } }, cookie)).status, 201, endpoint);
    }
  });
});

describe('headers and cookies', () => {
  test('every response carries the security headers', async () => {
    const { base } = await start();
    for (const path of ['/', '/admin', '/api/work', '/styles.css', '/nope']) {
      const h = (await fetch(base + path)).headers;
      assert.match(h.get('content-security-policy'), /frame-ancestors 'none'/, path);
      assert.equal(h.get('x-frame-options'), 'DENY', path);
      assert.equal(h.get('x-content-type-options'), 'nosniff', path);
      assert.equal(h.get('cross-origin-opener-policy'), 'same-origin', path);
    }
  });

  test('in production the session cookie is __Host-, Secure, HttpOnly and SameSite=Strict, with HSTS on', async () => {
    const { base } = await start({ config: { isProd: true } });
    const res = await post(`${base}/api/desk/login`, { password: 'test-password' });
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /^__Host-cbt_desk=/);
    for (const flag of [/Secure/, /HttpOnly/, /SameSite=Strict/, /Path=\//]) assert.match(cookie, flag);
    assert.doesNotMatch(cookie, /Domain=/i);
    assert.match(res.headers.get('strict-transport-security'), /max-age=63072000/);
  });

  test('user content is escaped on the page', async () => {
    const { base } = await start();
    const html = await (await fetch(`${base}/?error=${encodeURIComponent('"><img src=x onerror=alert(1)>')}&service=${encodeURIComponent('"><script>')}`)).text();
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('"><script>'));
  });
});

describe('encryption at rest', () => {
  const key = crypto.randomBytes(32);

  test('names, emails, messages and notes are stored encrypted and read back plainly', async () => {
    const raw = createSqliteStore(':memory:');
    const store = encryptStore(raw, key);
    const row = await store.enquiries.add({ name: 'Ava', brand: 'Toro', city: 'Glasgow', service: 'website', email: 'ava@example.com', message: 'Secret plans' });
    assert.equal(row.email, 'ava@example.com');
    await store.enquiries.update(row.id, { notes: 'Budget £2k' });
    const [stored] = await raw.enquiries.list();
    for (const f of ['name', 'brand', 'city', 'email', 'message', 'notes']) assert.match(stored[f], /^enc1:/, f);
    assert.equal(stored.service, 'website', 'what we filter on stays readable');
    const [readBack] = await store.enquiries.list();
    assert.equal(readBack.notes, 'Budget £2k');
    assert.equal(readBack.message, 'Secret plans');
  });

  test('older plain enquiries still read, and a wrong key never crashes the desk', async () => {
    const raw = createSqliteStore(':memory:');
    await raw.enquiries.add({ name: 'Old', brand: 'Plain', city: '', service: 'website', email: 'old@example.com', message: '' });
    await encryptStore(raw, key).enquiries.add({ name: 'New', brand: 'Sealed', city: '', service: 'website', email: 'new@example.com', message: '' });
    const wrong = await encryptStore(raw, crypto.randomBytes(32)).enquiries.list();
    assert.equal(wrong.find(r => r.id === 1).email, 'old@example.com');
    assert.match(wrong.find(r => r.id === 2).email, /cannot be read/);
  });

  test('a malformed key is refused at start-up', () => {
    assert.throws(() => parseKey('too-short'), /32 bytes/);
    assert.equal(parseKey(crypto.randomBytes(32).toString('hex')).length, 32);
    assert.equal(parseKey(''), null);
  });
});
