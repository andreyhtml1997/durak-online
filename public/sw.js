const CACHE_NAME = 'durak-pwa-v5';
const ASSETS = [
  './',
  './index.html',
  './app-config.js',
  './lan-peer.js',
  './sound.js',
  './vendor/peerjs.min.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('durak-pwa-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Signaling and other network requests must never be intercepted or cached.
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    // Network-first picks up updates. Offline fallback ignores ?room= while the
    // original URL stays in the address bar, so the game can read the room ID.
    event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
    return;
  }
  const asset = ASSETS.find(path => new URL(path, self.registration.scope).pathname === url.pathname);
  if (!asset) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
