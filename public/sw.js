// Keep the app shell and its modules together for the life of this worker.
const VERSION = '1.0.0+18d979e';
const CACHE = `havan-crm-${VERSION}`;
const PAGES = ['checkin', 'common', 'customer', 'customers', 'forms', 'home', 'map', 'newcustomers', 'order', 'orders', 'sales', 'settings', 'visits'];
const SHELL = [
  '/', '/manifest.webmanifest', '/icon.svg', '/img/slip-template.png', '/data/units.json',
  ...['css/app.css', 'js/app.js'].map(path => `/${path}?v=${VERSION}`),
  ...['Thai', 'Latin'].flatMap(script => [400, 700].map(weight => `/fonts/sarabun-${script.toLowerCase()}-${weight}-normal.woff2`)),
  ...['data', 'slip', 'ttx', 'ui', 'version', 'shared/domain', 'shared/ops', 'shared/schema'].map(name => `/js/${name}.js`),
  ...PAGES.map(name => `/js/pages/${name}.js`),
  ...PAGES.map(name => `/js/pages/${name}.js?v=${encodeURIComponent(VERSION)}`),
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('havan-crm-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const shellNavigation = e.request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html');
  e.respondWith(caches.open(CACHE).then(cache => cache.match(shellNavigation ? '/' : e.request)).then(
    cached => cached || fetch(e.request).catch(() => new Response('Offline asset unavailable', { status: 503 })),
  ));
});
