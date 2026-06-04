const CACHE = 'sitenote-v9';
const PRECACHE = [
  './',
  './index.html',
  './css/app.css',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
  './js/db.js',
  './js/router.js',
  './js/utils.js',
  './js/settings.js',
  './js/jobs.js',
  './js/setup.js',
  './js/capture.js',
  './js/review.js',
  './js/pdf.js',
  './js/report-preview.js',
  './logo-dvm.jpg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Skip non-GET and chrome-extension requests
  if (e.request.method !== 'GET') return;
  if (e.request.url.startsWith('chrome-extension')) return;
  if (e.request.url.includes('api.anthropic.com')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => null);
      return cached || fetchPromise;
    })
  );
});
