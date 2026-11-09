// Serves from cache so the launcher opens instantly, then refreshes the cache in the background.
const CACHE = 'launcher-v1';
const ASSETS = ['./', 'style.css', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const key = url.origin + url.pathname;

  const refresh = fetch(key, { cache: 'no-cache' }).then(async (response) => {
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(key, response.clone());
    }
    return response;
  });

  event.respondWith(caches.match(key).then((cached) => cached ?? refresh));
  event.waitUntil(refresh.catch(() => {}));
});
