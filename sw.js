/* Incrementar RELEASE cuando cambie cualquier archivo de la interfaz. */
const RELEASE = '2026-10-07-v9';
const BASE = new URL('./', self.location.href);
const PREFIX = 'europa2026-shell-' + BASE.pathname + '-';
const CACHE = PREFIX + RELEASE;
const FILES = [
  './', 'index.html', 'offline-store.js', 'pwa.js', 'manifest.webmanifest',
  'public/icon.png', 'public/icon-sm.png', 'public/icon-192.png',
  'public/icon-maskable.png', 'public/apple-touch-icon.png',
  'public/vendor/lucide.min.js', 'public/vendor/leaflet.js', 'public/vendor/leaflet.css',
  'public/vendor/images/layers.png', 'public/vendor/images/layers-2x.png',
  'public/vendor/images/marker-icon.png', 'public/vendor/images/marker-icon-2x.png',
  'public/vendor/images/marker-shadow.png'
];
const URLS = FILES.map(file => new URL(file, BASE).href);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(URLS.map(url => new Request(url, { cache: 'reload' })));
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== BASE.origin) return;
  const page = event.request.mode === 'navigate' &&
    (url.pathname === BASE.pathname || url.pathname === new URL('index.html', BASE).pathname);
  const key = page ? new URL('index.html', BASE).href : url.href;
  if (!page && !URLS.includes(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(key)) || fetch(event.request);
  })());
});
