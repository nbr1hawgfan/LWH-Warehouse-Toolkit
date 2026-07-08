(function(){
  let stream=null, detector=null, callback=null, timer=null, zxControls=null, zxingReader=null;
  const ZXING_URLS=[
    'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/index.min.js',
    'https://unpkg.com/@zxing/browser@0.1.5/umd/index.min.js'
  ];
  const hasDetector=()=>('BarcodeDetector' in window);
  function setStatus(msg){ const s=document.getElementById('scannerStatus'); if(s) s.textContent=msg; }
  function loadScript(src){return new Promise((resolve,reject)=>{const existing=[...document.scripts].find(x=>x.src===src); if(existing){resolve();return;} const sc=document.createElement('script'); sc.src=src; sc.async=true; sc.onload=resolve; sc.onerror=()=>reject(new Error('Could not load '+src)); document.head.appendChild(sc);});}
  async function ensureZXing(){
    if(window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader) return window.ZXingBrowser;
    for(const u of ZXING_URLS){ try{ await loadScript(u); if(window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader) return window.ZXingBrowser; }catch(e){} }
    return null;
  }
  async function start(cb){
    callback=cb;
    const modal=document.getElementById('scannerModal'), video=document.getElementById('scannerVideo');
    if(!modal||!video){ alert('Scanner UI not available.'); return; }
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){ alert('Camera access is not supported in this browser.'); return; }
    modal.hidden=false;
    setStatus('Starting camera...');
    if(hasDetector()) return startNative(video);
    setStatus('Built-in scanner not found. Loading fallback scanner...');
    const zx=await ensureZXing();
    if(zx) return startZXing(video,zx);
    stop(false);
    alert('Camera opened, but this browser does not expose a barcode decoder and the fallback scanner could not load. On Android/PC use current Chrome or Edge over HTTPS, then try again. You can still type/scan with a USB/Bluetooth scanner into the search box.');
  }
  async function startNative(video){
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      video.srcObject=stream;
      await video.play();
      const supported = BarcodeDetector.getSupportedFormats ? await BarcodeDetector.getSupportedFormats() : [];
      const wanted=['qr_code','code_128','code_39','code_93','ean_13','ean_8','upc_a','upc_e','itf','codabar'];
      const formats=supported.length?wanted.filter(f=>supported.includes(f)):wanted;
      detector=new BarcodeDetector({formats});
      setStatus('Point the camera at a barcode or QR code.');
      scanLoop();
    }catch(err){
      setStatus('Built-in scanner failed. Trying fallback scanner...');
      stop(false);
      const zx=await ensureZXing();
      if(zx) return startZXing(video,zx);
      alert('Camera failed: '+err.message);
    }
  }
  async function startZXing(video,zx){
    try{
      zxingReader=new zx.BrowserMultiFormatReader();
      setStatus('Point the camera at a barcode or QR code.');
      zxControls=await zxingReader.decodeFromVideoDevice(null, video, (result,err,controls)=>{
        if(result){
          const value=(result.getText ? result.getText() : String(result.text||result)).trim();
          if(value){ setStatus('Scanned: '+value); const cb=callback; stop(); if(cb) cb(value); }
        }
      });
    }catch(err){
      stop(false);
      alert('Camera scan failed: '+err.message+' — You can still type/scan with a USB/Bluetooth scanner into the search box.');
    }
  }
  async function scanLoop(){
    const video=document.getElementById('scannerVideo');
    if(!video||!detector||!stream)return;
    try{
      const codes=await detector.detect(video);
      if(codes&&codes.length){
        const value=(codes[0].rawValue||'').trim();
        if(value){ setStatus('Scanned: '+value); const cb=callback; stop(); if(cb) cb(value); return; }
      }
    }catch(err){ setStatus('Scanning error: '+err.message); }
    timer=setTimeout(scanLoop,250);
  }
  function stop(hide=true){
    if(timer){clearTimeout(timer);timer=null;}
    if(zxControls){ try{zxControls.stop();}catch(e){} zxControls=null; }
    if(zxingReader){ try{zxingReader.reset&&zxingReader.reset();}catch(e){} zxingReader=null; }
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
    const modal=document.getElementById('scannerModal'), video=document.getElementById('scannerVideo');
    if(video) video.srcObject=null;
    if(hide&&modal) modal.hidden=true;
  }
  window.addEventListener('load',()=>{const close=document.getElementById('scannerClose'); if(close) close.onclick=()=>stop(true);});
  window.LWHScanner={start,stop};
})();
