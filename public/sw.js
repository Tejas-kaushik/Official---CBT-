// The studio desk's service worker: shows a phone alert for each new enquiry, and opens the
// desk on that enquiry when the alert is tapped. It caches nothing.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'New enquiry', {
      body: data.body || 'Someone wrote in through the website.',
      icon: '/admin/icon-192.png',
      badge: '/admin/icon-192.png',
      tag: data.tag || 'enquiry',
      renotify: true,
      data: { url: data.url || '/admin' },
    }),
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/admin', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const desk = open.find(c => new URL(c.url).pathname.startsWith('/admin'));
      if (desk) {
        await desk.focus();
        desk.postMessage({ type: 'open', url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
