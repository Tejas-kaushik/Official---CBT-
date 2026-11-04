import webpush from 'web-push';
import { SERVICES } from './content.js';

// Push alerts to the team's phones. Each phone subscribes from the studio desk; a new enquiry
// is pushed to every subscribed phone, and tapping it opens that enquiry on the desk.
// The VAPID keys are made once and kept in the store (or set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY),
// so no extra settings are needed on the host.
export function createPush(store, { subject, send = webpush.sendNotification.bind(webpush) } = {}) {
  let keys;
  const getKeys = () =>
    (keys ??= (async () => {
      if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
      }
      return (await store.settings.get('vapid')) ?? store.settings.init('vapid', webpush.generateVAPIDKeys());
    })().catch(err => {
      keys = undefined;
      throw err;
    }));

  async function sendAll(message) {
    const subs = await store.push.list();
    if (!subs.length) return { sent: 0, removed: 0 };
    const { publicKey, privateKey } = await getKeys();
    const options = { vapidDetails: { subject, publicKey, privateKey }, TTL: 24 * 60 * 60, urgency: 'high' };
    const payload = JSON.stringify(message);
    let sent = 0;
    let removed = 0;
    await Promise.all(
      subs.map(async ({ created_at, ...sub }) => {
        try {
          await send(sub, payload, options);
          sent++;
        } catch (err) {
          // 404 and 410 mean the phone unsubscribed or the browser dropped it: forget it.
          if (err.statusCode === 404 || err.statusCode === 410) {
            await store.push.remove(sub.endpoint);
            removed++;
          } else {
            console.error('Push failed:', err.statusCode || '', err.body || err.message);
          }
        }
      }),
    );
    return { sent, removed };
  }

  return {
    async publicKey() {
      return (await getKeys()).publicKey;
    },
    async subscribe(sub) {
      await store.push.add({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    },
    unsubscribe: endpoint => store.push.remove(endpoint),
    count: async () => (await store.push.list()).length,
    test: () => sendAll({ title: 'Phone alerts are on', body: 'New enquiries from the website will show up here.', url: '/admin', tag: 'test' }),
    enquiry(e) {
      const wants = SERVICES[e.service] || e.service;
      const note = e.message ? ` "${e.message.length > 90 ? `${e.message.slice(0, 89)}…` : e.message}"` : '';
      return sendAll({
        title: `New enquiry: ${e.brand}`,
        body: `${e.name}${e.city ? ` (${e.city})` : ''} wants ${wants}.${note}`,
        url: `/admin#enquiry-${e.id}`,
        tag: `enquiry-${e.id}`,
      });
    },
  };
}
