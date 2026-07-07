const CACHE_NAME = 'lwh-warehouse-toolkit-v1.0.0';
const APP_SHELL = [
  './','./index.html','./manifest.json','./css/app.css','./css/print.css',
  './js/app.js','./js/storage.js','./js/qr.js','./js/barcode.js','./js/ui.js','./js/labels.js','./js/visitors.js',
  './icons/icon-192.png','./icons/icon-512.png','./icons/favicon.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(resp => {
    const copy = resp.clone();
    if (event.request.method === 'GET') caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(()=>{});
    return resp;
  }).catch(() => caches.match('./index.html'))));
});
