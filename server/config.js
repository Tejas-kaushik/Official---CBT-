import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const root = path.resolve(import.meta.dirname, '..');

const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const isProd = env.NODE_ENV === 'production';

export function loadConfig(overrides = {}) {
  const dataDir = path.resolve(root, env.DATA_DIR || 'data');
  return {
    root,
    isProd,
    port: Number(env.PORT) || 3000,
    dataDir,
    dbFile: path.join(dataDir, 'cbt.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    publicDir: path.join(root, 'public'),
    adminPassword: env.ADMIN_PASSWORD || '',
    sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
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
