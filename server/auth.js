import crypto from 'node:crypto';

const COOKIE = 'cbt_desk';

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
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProd,
    path: '/',
    maxAge: config.sessionDays * 864e5,
  });
}

export function clearSession(res, config) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: config.isProd, path: '/' });
}

export function hasSession(req, config) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
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

// A small fixed-window limiter, per client address. Enough for one studio's site.
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return next();
    }
    if (++entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
