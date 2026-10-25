const CACHE_NAME='lwh-toolkit-v1-75-0';
// Pinned-version outside libraries (OpenCV edge finder, pdf.js, jsPDF, Tesseract…)
// are kept in their own cache that survives app updates, so the big ones download
// once instead of on every visit. Only exact-version URLs listed here are cached.
const LIB_CACHE='lwh-shared-libs-v1'; // shared with the Driver Toolkit (same site)
const LIB_URLS=[/^https:\/\/docs\.opencv\.org\/4\.8\.0\//,/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/3\.11\.174\//,/^https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf@2\.5\.1\//,/^https:\/\/cdn\.jsdelivr\.net\/npm\/html2canvas@1\.4\.1\//,/^https:\/\/unpkg\.com\/leaflet@1\.9\.4\//];
const ASSETS=['./','./index.html','./manifest.json','./css/app.css','./css/print.css','./js/storage.js','./js/qr.js','./js/barcode.js','./js/ui.js','./js/hometiles.js','./fonts/oswald-latin-500-normal.woff2','./fonts/oswald-latin-600-normal.woff2','./fonts/oswald-latin-700-normal.woff2','./js/labels.js','./js/visitors.js','./js/empbadge.js','./js/distance.js','./js/trailer.js','./js/picklist.js','./js/bol.js','./js/inventory.js','./js/transactions.js','./js/itemtxnlookup.js','./js/dailyactivity.js','./js/loaddetails.js','./js/packinglist.js','./js/spottertimesheets.js','./js/myhours.js','./js/missedpunches.js','./js/fifo.js','./js/dockboard.js','./js/pasreader-core.js','./js/pasreader.js','./js/loadscan.js','./js/bayscan.js','./js/outbound.js','./js/paperforms.js','./js/osinbound.js','./vendor/JsBarcode.all.min.js','./vendor/html5-qrcode.min.js','./vendor/qrcode.min.js','./js/scanner.js','./js/doc-auto-detect.js','./js/docscan.js','./js/radar.js','./js/utilities.js','./js/xlsx-lite.js','./js/quicklookup.js','./js/baycontents.js','./js/locationoverview.js','./js/customerview.js','./js/shipweights.js','./js/formulabuilder.js','./js/app.js','./icons/icon-192.png','./icons/icon-512.png','./icons/favicon.png','./icons/company-logo.png','./icons/shortcut-lookup.png','./icons/shortcut-picklist.png','./icons/shortcut-tools.png','./icons/shortcut-bol.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lwh-toolkit-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin){
    if(LIB_URLS.some(re=>re.test(e.request.url))){
      e.respondWith(caches.open(LIB_CACHE).then(c=>c.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{ if(r&&(r.ok||r.type==='opaque')) c.put(e.request,r.clone()); return r; }))));
      return;
    }
    e.respondWith(fetch(e.request,{cache:'no-store'})); return;
  }
  const networkFirst=/\.(html|js|css)$/.test(url.pathname) || url.pathname.endsWith('/');
  if(networkFirst){
    e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const copy=r.clone(); caches.open(CACHE_NAME).then(c=>c.put(e.request,copy)); return r;}).catch(()=>caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{const copy=r.clone(); caches.open(CACHE_NAME).then(c=>c.put(e.request,copy)); return r;})));
});
