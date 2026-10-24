/**
 * Eagle Eye SafDrive — Service Worker for Mobile & Desktop Web Push
 *
 * Key fixes applied:
 * 1. Notification URLs are built as hash-based absolute URLs (origin + /#/path) to match
 *    the HashRouter used by the React application.
 * 2. matchAll origin-check: focus/navigate windows on THIS origin.
 * 3. Security: enforce destination stays on APP_ORIGIN while gracefully extracting
 *    route paths if payloads contain different origins (e.g., preview environments, localhost).
 * 4. Tab reuse & message dispatch: postMessage to existing client so HashRouter navigates
 *    instantly in background/foreground without duplicate tabs or reload failures.
 * 5. Safe fallback: malformed URLs safely default to authorized checklist workspace.
 */

const APP_ORIGIN = self.location.origin;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName.startsWith('safdrive-old-')) {
              return caches.delete(cacheName);
            }
          })
        );
      }),
    ])
  );
});

/**
 * Validates that a route path belongs to internal SafDrive features.
 */
function isKnownSafDrivePath(path) {
  if (!path || typeof path !== 'string') return false;
  const p = path.toLowerCase();
  return (
    p.startsWith('/admin') ||
    p.startsWith('/sales') ||
    p.startsWith('/technical') ||
    p.startsWith('/store') ||
    p.startsWith('/coordinator') ||
    p.startsWith('/hr') ||
    p.startsWith('/customer-form') ||
    p.startsWith('/feedback') ||
    p.startsWith('/login')
  );
}

/**
 * Build a full hash-router URL from a relative path string.
 * e.g. "/admin/installation-checklists/abc?foo=bar" → "https://origin/#/admin/installation-checklists/abc?foo=bar"
 */
function buildHashUrl(relativePath) {
  if (!relativePath || relativePath === '/') {
    return `${APP_ORIGIN}/#/`;
  }
  if (relativePath.startsWith('#/')) {
    return `${APP_ORIGIN}/${relativePath}`;
  }
  if (relativePath.startsWith('#')) {
    return `${APP_ORIGIN}/#/${relativePath.replace(/^#+/, '')}`;
  }
  const clean = relativePath.replace(/^\/+/, '');
  return `${APP_ORIGIN}/#/${clean}`;
}

/**
 * Convert a relative app path or absolute URL into the correct hash-router absolute URL.
 * Always binds the final URL to APP_ORIGIN to prevent untrusted external redirects.
 */
function resolveNotificationUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return `${APP_ORIGIN}/#/admin/installation-checklists`;
  }

  try {
    let parsed = null;
    try {
      parsed = new URL(rawUrl);
    } catch {
      parsed = null;
    }

    if (parsed) {
      // If it already has a hash starting with #/, use it bound to APP_ORIGIN
      if (parsed.hash && parsed.hash.startsWith('#/')) {
        return `${APP_ORIGIN}/${parsed.hash}`;
      }

      // Check pathname
      const relative = parsed.pathname + parsed.search + (parsed.hash || '');
      if (isKnownSafDrivePath(parsed.pathname)) {
        return buildHashUrl(relative);
      }

      // If it belongs to this origin, accept the relative path
      if (parsed.origin === APP_ORIGIN) {
        return buildHashUrl(relative);
      }

      // External untrusted domain with unknown path — fallback safely
      console.warn('[SW] External domain rejected in notification URL:', parsed.origin);
      return `${APP_ORIGIN}/#/admin/installation-checklists`;
    }

    // rawUrl is a relative path like "/admin/installation-checklists/abc" or "#/admin/..."
    return buildHashUrl(rawUrl);
  } catch (err) {
    console.warn('[SW] Could not resolve notification URL, using default:', rawUrl, err);
    return `${APP_ORIGIN}/#/admin/installation-checklists`;
  }
}

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

  // Resolve target URL to valid absolute hash-router URL on APP_ORIGIN
  const rawTargetUrl = data.data?.url || data.url || data.data?.path || '/admin/installation-checklists';
  const resolvedUrl = resolveNotificationUrl(rawTargetUrl);

  const options = {
    body,
    icon,
    badge,
    tag,
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: {
      url: resolvedUrl,
      rawUrl: rawTargetUrl,
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
 * Handle notification click: Open or focus the SafDrive app at the correct route.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const storedData = event.notification.data || {};
  const storedUrl = storedData.url || storedData.rawUrl;
  const urlToOpen = resolveNotificationUrl(storedUrl);

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clientList) => {
        // Filter to only windows/tabs on this exact origin
        const ownClients = clientList.filter((c) => {
          try {
            return new URL(c.url).origin === APP_ORIGIN;
          } catch {
            return false;
          }
        });

        if (ownClients.length > 0) {
          const client = ownClients[0];

          // 1. Send postMessage so active React HashRouter navigates immediately
          try {
            client.postMessage({
              type: 'SAFDRIVE_NOTIFICATION_CLICK',
              url: urlToOpen,
              data: storedData,
            });
          } catch (e) {
            console.warn('[SW] Could not postMessage to client:', e);
          }

          // 2. Navigate existing window
          if (typeof client.navigate === 'function') {
            try {
              await client.navigate(urlToOpen);
            } catch (err) {
              console.warn('[SW] client.navigate failed (fallback to postMessage):', err);
            }
          }

          // 3. Bring to front
          if (typeof client.focus === 'function') {
            return client.focus();
          }
          return client;
        }

        // No existing window for this origin — open a new one
        if (typeof self.clients.openWindow === 'function') {
          return self.clients.openWindow(urlToOpen);
        }
      })
  );
});
