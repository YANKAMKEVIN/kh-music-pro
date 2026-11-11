// Service worker de KH Music Pro : garde l'application disponible hors-ligne.
const CACHE = 'kh-music-pro-v3';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', 'manifest.webmanifest', 'icon.svg']))); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// La page transmet la liste de ses fichiers une fois chargée.
self.addEventListener('message', e => { if (e.data && e.data.cache) e.waitUntil(caches.open(CACHE).then(c => c.addAll(e.data.cache))); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  // Réseau d'abord (pour recevoir les mises à jour), cache en secours hors-ligne.
  e.respondWith(fetch(r).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
    return res;
  }).catch(() => caches.match(r, { ignoreVary: true, ignoreSearch: r.mode === 'navigate' })
    .then(m => m || (r.mode === 'navigate' ? caches.match('./') : Response.error()))));
});
