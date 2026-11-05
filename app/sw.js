// Service worker : l'app et les tuiles déjà vues restent disponibles hors-ligne
// (en voyage, le GPS fonctionne sans réseau — la découverte continue, la carte
// s'affiche pour les zones déjà mises en cache, la sync rattrape au retour).
const SHELL_CACHE = 'mapog-shell-v1';
const TILE_CACHE = 'mapog-tiles-v1';
const MAX_TILES = 4000;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/config.js',
  './js/db.js',
  './js/fog.js',
  './js/tracker.js',
  './js/sync.js',
  './js/main.js',
  './icons/icon.svg',
  './vendor/leaflet.css',
  './vendor/leaflet.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.endsWith('/api.php')) return; // la sync passe toujours par le réseau

  if (url.host.endsWith('cartocdn.com')) {
    e.respondWith(cacheFirst(e.request, TILE_CACHE, MAX_TILES));
  } else if (url.origin === location.origin || url.host.endsWith('gstatic.com') || url.host.endsWith('googleapis.com')) {
    e.respondWith(cacheFirst(e.request, SHELL_CACHE));
  }
});

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') {
    cache.put(request, res.clone());
    if (maxEntries) trim(cache, maxEntries); // pas de await : en tâche de fond
  }
  return res;
}

// Vide les entrées les plus anciennes quand le cache de tuiles déborde
async function trim(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (const key of keys.slice(0, keys.length - maxEntries)) {
    await cache.delete(key);
  }
}
