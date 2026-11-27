// Service worker: cache the app shell by VERSION. API calls are NEVER cached (data must be live).
const VERSION = '1.0.0+e23694c';
const CACHE = `havan-crm-${VERSION}`;
const SHELL = ['/', '/index.html', '/css/app.css', '/manifest.webmanifest', '/icon.svg', '/img/slip-template.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('havan-crm-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // network-first (fresh code when online), cache fallback (offline field use)
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html'))));
});
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });
