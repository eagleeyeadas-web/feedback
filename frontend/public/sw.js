/**
 * Eagle Eye SafDrive — Service Worker for Mobile & Desktop Web Push
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Handle incoming push events from server
 */
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = {
        title: 'Eagle Eye SafDrive — New Installation Checklist',
        body: event.data.text() || 'A new installation checklist has been created.',
      };
    }
  }

  const title = data.title || 'Eagle Eye SafDrive — New Installation Checklist';
  const body = data.body || 'A new installation checklist has been created.';
  const icon = data.icon || '/icon-192.png';
  const badge = data.badge || '/icon-192.png';
  const tag = data.tag || `checklist-${Date.now()}`;
  const targetUrl = data.data?.url || data.url || '/admin/installation-checklists';

  const options = {
    body,
    icon,
    badge,
    tag,
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: {
      url: targetUrl,
      checklistId: data.data?.checklistId || null,
      checklistNumber: data.data?.checklistNumber || null,
      timestamp: Date.now(),
    },
    actions: [
      {
        action: 'open',
        title: 'View Checklist',
      },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Handle notification click: Open or focus corresponding checklist
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/admin/installation-checklists';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 1. If an existing tab is open on this origin, navigate and focus it
      for (const client of clientList) {
        if ('focus' in client) {
          // If already on the site, navigate to the target checklist and focus
          if ('navigate' in client) {
            client.navigate(urlToOpen);
          }
          return client.focus();
        }
      }
      // 2. Otherwise open a new window/tab to the checklist URL
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
