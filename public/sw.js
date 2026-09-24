/* Roost service worker — enables the installed PWA and receives web push.
   Deliberately no offline caching: the app updates often and stale caches
   cause more harm than good here. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// A backend can POST a push (VAPID) to a subscriber to alert them of a sale.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Roost';
  const opts = {
    body: data.body || 'You have a new sale.',
    icon: '/roost/icons/icon-192.png',
    badge: '/roost/icons/icon-192.png',
    tag: data.tag || 'roost-sales',
    data: { url: data.url || '/roost/' }
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/roost/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) { if (c.url.includes('/roost/') && 'focus' in c) return c.focus(); }
      return self.clients.openWindow(url);
    })
  );
});
