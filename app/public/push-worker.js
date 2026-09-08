/* Imported by the generated offline service worker. */
self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || typeof payload.title !== 'string' || typeof payload.body !== 'string') return;
  const target = new URL(typeof payload.url === 'string' ? payload.url : '/restaurant', self.location.origin);
  const url = target.origin === self.location.origin && target.pathname === '/restaurant' ? target.href : '/restaurant';
  event.waitUntil(self.registration.showNotification(payload.title.slice(0, 100), {
    body: payload.body.slice(0, 500), icon: '/icon-192.png', badge: '/icon-192.png',
    tag: typeof payload.tag === 'string' ? payload.tag : undefined, data: { url },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/restaurant', self.location.origin);
    if (target.origin !== self.location.origin || target.pathname !== '/restaurant') return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(target.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
