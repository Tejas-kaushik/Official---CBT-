import { loadConfig } from './config.js';
import { openStore } from './store/index.js';
import { createNotifier } from './mail.js';
import { createApp } from './app.js';

const config = loadConfig();
const store = await openStore(config);
const notifier = createNotifier(config.mail);
const app = createApp({ store, config, notifier });

if (!config.adminPassword) console.warn('ADMIN_PASSWORD is not set: the studio desk at /admin stays locked.');

const server = app.listen(config.port, () => {
  console.log(`Content Book is running at http://localhost:${config.port}`);
  console.log(`Data is kept in ${store.kind === 'redis' ? 'Upstash Redis' : config.dbFile}.`);
  console.log(`Enquiry emails are ${notifier.enabled ? `on, to ${config.mail.to}` : 'off (no SMTP_HOST)'}.`);
});

const stop = () => server.close(() => {
  store.close();
  process.exit(0);
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
