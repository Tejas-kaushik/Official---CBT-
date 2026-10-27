import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const root = path.resolve(import.meta.dirname, '..');

const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const onVercel = Boolean(env.VERCEL);
const isProd = env.NODE_ENV === 'production' || onVercel;

// Serverless instances come and go, so a random key would sign the team out at every cold start.
// Without SESSION_SECRET, derive a stable key from the password (changing it signs everyone out).
const sessionSecret = () =>
  env.SESSION_SECRET ||
  (env.ADMIN_PASSWORD
    ? crypto.createHash('sha256').update(`cbt-desk-session:${env.ADMIN_PASSWORD}`).digest('hex')
    : crypto.randomBytes(32).toString('hex'));

export function loadConfig(overrides = {}) {
  // Vercel's file system is read-only apart from /tmp.
  const dataDir = path.resolve(root, env.DATA_DIR || (onVercel ? '/tmp/cbt-data' : 'data'));
  return {
    root,
    isProd,
    port: Number(env.PORT) || 3000,
    dataDir,
    dbFile: path.join(dataDir, 'cbt.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    publicDir: path.join(root, 'public'),
    adminPassword: env.ADMIN_PASSWORD || '',
    sessionSecret: sessionSecret(),
    sessionDays: 7,
    mail: {
      host: env.SMTP_HOST || '',
      port: Number(env.SMTP_PORT) || 465,
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      to: env.NOTIFY_EMAIL || 'contentbook7@gmail.com',
    },
    ...overrides,
  };
}
