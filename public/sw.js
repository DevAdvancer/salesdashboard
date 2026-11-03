/* CRM HUB service worker: Web Push notifications only. It does not cache pages
 * or intercept requests, so it never serves stale CRM data. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === 'string' && data.title ? data.title : 'CRM HUB';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : '',
    // Same tag as the in-page notification for this record, so one replaces the other.
    tag: typeof data.tag === 'string' ? data.tag : undefined,
    icon: '/silverspace.png',
    badge: '/silverspace.png',
    data: { url: typeof data.url === 'string' ? data.url : '/notifications' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target;
  try { target = new URL(event.notification.data && event.notification.data.url || '/notifications', self.location.origin); }
  catch { target = new URL('/notifications', self.location.origin); }
  // Only ever open this CRM.
  if (target.origin !== self.location.origin) target = new URL('/notifications', self.location.origin);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const open = windows.find(client => new URL(client.url).origin === target.origin);
    if (open) return open.focus().then(client => client && 'navigate' in client ? client.navigate(target.href) : client);
    return self.clients.openWindow(target.href);
  }));
});
