/* Gowes service worker
   - App shell: cache-first (precached saat install)
   - CDN (maplibre, fonts): cache-first runtime
   - Tiles CyclOSM: cache-first runtime, dibatasi maks 600 tile
   - BRouter routing: selalu network (hasil rute tidak dicache)
*/
const SHELL_CACHE = 'gowes-shell-v1';
const TILE_CACHE = 'gowes-tiles-v1';
const CDN_CACHE = 'gowes-cdn-v1';
const MAX_TILES = 600;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './js/app.js',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => ![SHELL_CACHE, TILE_CACHE, CDN_CACHE].includes(k))
          .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > max) {
    await cache.delete(keys[0]);
    return trimCache(name, max);
  }
}

async function cacheFirst(req, cacheName, trim) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    const cache = await caches.open(cacheName);
    cache.put(req, res.clone());
    if (trim) trimCache(cacheName, MAX_TILES);
  }
  return res;
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // routing: jangan pernah cache
  if (url.hostname.includes('brouter')) return;

  // tiles CyclOSM
  if (url.hostname.includes('tile-cyclosm')) {
    e.respondWith(cacheFirst(e.request, TILE_CACHE, true));
    return;
  }

  // CDN library & fonts
  if (url.hostname.includes('unpkg.com') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(cacheFirst(e.request, CDN_CACHE, false));
    return;
  }

  // app shell (same-origin)
  if (url.origin === self.location.origin) {
    e.respondWith(
      cacheFirst(e.request, SHELL_CACHE, false).catch(() => caches.match('./index.html'))
    );
  }
});
