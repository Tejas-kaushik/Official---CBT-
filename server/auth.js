import crypto from 'node:crypto';

// In production the __Host- prefix makes the browser refuse the cookie unless it is Secure,
// set by this exact host and scoped to the whole site, so no subdomain can set or read it.
const cookieName = config => (config.isProd ? '__Host-cbt_desk' : 'cbt_desk');

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest();
const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Constant-time comparison of the typed password against ADMIN_PASSWORD.
export function passwordMatches(given, expected) {
  if (!expected) return false;
  return crypto.timingSafeEqual(sha256(given), sha256(expected));
}

export function issueSession(res, config) {
  const exp = Date.now() + config.sessionDays * 864e5;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const token = `${payload}.${sign(payload, config.sessionSecret)}`;
  res.cookie(cookieName(config), token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProd,
    path: '/',
    maxAge: config.sessionDays * 864e5,
  });
}

export function clearSession(res, config) {
  res.clearCookie(cookieName(config), { httpOnly: true, sameSite: 'strict', secure: config.isProd, path: '/' });
}

export function hasSession(req, config) {
  const token = parseCookies(req.headers.cookie)[cookieName(config)];
  if (!token) return false;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return false;
  const expected = Buffer.from(sign(payload, config.sessionSecret));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
  } catch {
    return false;
  }
}

export const requireDesk = config => (req, res, next) => {
  if (!hasSession(req, config)) return res.status(401).json({ error: 'Sign in to the studio desk first.' });
  // A cross-site form can only POST, and cannot send JSON without a preflight, so desk POSTs must be JSON.
  // PATCH and DELETE cannot come from another site at all.
  if (req.method === 'POST' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Send JSON.' });
  }
  next();
};

// A fixed-window limiter. Counts live in the store, so every serverless instance shares them;
// if the store cannot be reached, each instance falls back to its own memory rather than failing open.
export function rateLimit({ store, name, windowMs, max, message, key = req => req.ip }) {
  const local = new Map();
  const localHit = id => {
    const now = Date.now();
    const entry = local.get(id);
    if (!entry || entry.reset < now) {
      local.set(id, { count: 1, reset: now + windowMs });
      if (local.size > 5000) for (const [k, v] of local) if (v.reset < now) local.delete(k);
      return 1;
    }
    return ++entry.count;
  };
  return async (req, res, next) => {
    const id = `${name}:${key(req)}`;
    let count;
    try {
      count = store?.limits ? await store.limits.hit(id, windowMs) : localHit(id);
    } catch {
      count = localHit(id);
    }
    if (count > max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// Bot check for the public form: the page carries a signed timestamp. A post without a valid one
// was not made from our page; one made within a few seconds of loading was not typed by a person.
const formMac = (ts, secret) => crypto.createHmac('sha256', secret).update(`cbt-form:${ts}`).digest('base64url').slice(0, 22);

export function formToken(config, now = Date.now()) {
  return `${now}.${formMac(String(now), config.sessionSecret)}`;
}

// 'ok', 'bot' (forged, missing or too fast) or 'stale' (the page was left open for over a week).
export function checkFormToken(token, config, now = Date.now()) {
  const [ts, mac] = String(token ?? '').split('.');
  if (!/^\d{13}$/.test(ts ?? '') || !mac) return 'bot';
  const expected = Buffer.from(formMac(ts, config.sessionSecret));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return 'bot';
  const age = now - Number(ts);
  if (age < (config.formMinMs ?? 3000)) return 'bot';
  if (age > 7 * 864e5) return 'stale';
  return 'ok';
}
