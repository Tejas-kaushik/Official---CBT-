// Vercel's entry point. Every request that is not a static file in public/ is rewritten here
// (see vercel.json), and the same Express app as `npm start` answers it.
import { loadConfig } from '../server/config.js';
import { openStore } from '../server/store/index.js';
import { createNotifier } from '../server/mail.js';
import { createPush } from '../server/push.js';
import { createApp } from '../server/app.js';

let ready;
const build = async () => {
  const config = loadConfig();
  const store = await openStore(config);
  if (store.kind !== 'redis') console.warn('No Upstash Redis credentials: data is kept in /tmp and lost when this instance stops.');
  const push = createPush(store, { subject: `mailto:${config.mail.to}` });
  return createApp({ store, config, notifier: createNotifier(config.mail), push });
};

export default async function handler(req, res) {
  ready ??= build().catch(err => {
    ready = undefined;
    throw err;
  });
  const app = await ready;
  return app(req, res);
}
