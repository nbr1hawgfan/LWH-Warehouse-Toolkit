const CACHE_NAME='lwh-warehouse-toolkit-v1-1-0';
const ASSETS=['./','./index.html','./manifest.json','./css/app.css','./css/print.css','./js/storage.js','./js/qr.js','./js/barcode.js','./js/ui.js','./js/labels.js','./js/visitors.js','./js/inventory.js','./js/app.js','./icons/icon-192.png','./icons/icon-512.png','./icons/favicon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{const copy=r.clone(); if(new URL(e.request.url).origin===location.origin)caches.open(CACHE_NAME).then(c=>c.put(e.request,copy)); return r}).catch(()=>cached)))});
