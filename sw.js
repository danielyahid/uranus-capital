// Uranus Capital Service Worker — PWA Support
const CACHE_NAME = 'uranus-capital-v1';
const STATIC_CACHE = 'uranus-static-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/portal/login.html',
  '/portal/dashboard.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,900;1,400;1,700&family=Inter:wght@300;400;500;600&display=swap'
];

// Install: precache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS.filter(url => !url.startsWith('http'))))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== STATIC_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for API/Firebase, cache-first for static
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and Firebase/external API requests
  if (request.method !== 'GET') return;
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('gstatic')) {
    // Network only for Firebase, with cache fallback for fonts
    if (url.hostname.includes('fonts')) {
      event.respondWith(
        caches.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
            return response;
          });
        })
      );
    }
    return;
  }

  // HTML pages: network-first, fall back to cache
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // Everything else: cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

// Background sync stub (for offline form submissions)
self.addEventListener('sync', (event) => {
  if (event.tag === 'contact-form') {
    event.waitUntil(syncContactForm());
  }
});

async function syncContactForm() {
  // Sync queued contact form submissions when back online
  const db = await openFormQueue();
  const pending = await getAllPending(db);
  for (const entry of pending) {
    try {
      await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.data)
      });
      await deletePending(db, entry.id);
    } catch {}
  }
}

// IndexedDB helpers for offline queue
function openFormQueue() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('uranus-queue', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('forms', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = reject;
  });
}

function getAllPending(db) {
  return new Promise((resolve) => {
    const tx = db.transaction('forms', 'readonly');
    const req = tx.objectStore('forms').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

function deletePending(db, id) {
  return new Promise((resolve) => {
    const tx = db.transaction('forms', 'readwrite');
    tx.objectStore('forms').delete(id).onsuccess = resolve;
  });
}

// Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Uranus Capital', {
      body: data.body || 'New update from Daniel Yahid',
      icon: '/assets/icon-192.png',
      badge: '/assets/icon-72.png',
      data: { url: data.url || '/portal/dashboard.html' },
      actions: [
        { action: 'view', title: 'View Dashboard' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'view' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(windowClients => {
        const url = event.notification.data?.url || '/portal/dashboard.html';
        for (const client of windowClients) {
          if (client.url === url && 'focus' in client) return client.focus();
        }
        return clients.openWindow(url);
      })
    );
  }
});
