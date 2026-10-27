import fs from 'node:fs';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createNotifier } from './mail.js';
import { createApp } from './app.js';

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });

const db = openDb(config.dbFile);
const notifier = createNotifier(config.mail);
const app = createApp({ db, config, notifier });

if (!config.adminPassword) console.warn('ADMIN_PASSWORD is not set: the studio desk at /admin stays locked.');
if (config.isProd && !process.env.SESSION_SECRET) console.warn('SESSION_SECRET is not set: desk sign-ins end at every restart.');

const server = app.listen(config.port, () => {
  console.log(`Content Book is running at http://localhost:${config.port}`);
  console.log(`Enquiry emails are ${notifier.enabled ? `on, to ${config.mail.to}` : 'off (no SMTP_HOST)'}.`);
});

const stop = () => server.close(() => {
  db.close();
  process.exit(0);
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
