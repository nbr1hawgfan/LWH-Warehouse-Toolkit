(function(){
  let stream=null, callback=null, detector=null, timer=null, previewTimer=null, zxingReader=null, zxingLoaded=false;
  const ZXING_URLS=[
    'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.4/umd/index.min.js',
    'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js',
    'https://unpkg.com/@zxing/browser@0.1.4/umd/index.min.js'
  ];
  function el(id){return document.getElementById(id)}
  function setStatus(msg){const s=el('scannerStatus'); if(s) s.textContent=msg;}
  function loadScript(src){return new Promise((resolve,reject)=>{const existing=[...document.scripts].find(s=>s.src===src); if(existing){resolve();return;} const sc=document.createElement('script'); sc.src=src; sc.async=true; sc.onload=resolve; sc.onerror=()=>reject(new Error('Could not load '+src)); document.head.appendChild(sc);});}
  function getVideo(){return el('scannerVideo')}
  function getCanvas(){let c=el('scannerCanvas'); if(!c){c=document.createElement('canvas'); c.id='scannerCanvas'; c.hidden=true; document.body.appendChild(c);} return c;}
  function drawFrame(){
    const video=getVideo(), canvas=getCanvas();
    if(!stream||!video||!canvas) return;
    if(video.videoWidth&&video.videoHeight){
      if(canvas.width!==video.videoWidth) canvas.width=video.videoWidth;
      if(canvas.height!==video.videoHeight) canvas.height=video.videoHeight;
      try{canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);}catch(e){}
    }
    previewTimer=requestAnimationFrame(drawFrame);
  }
  function startPreview(){stopPreview(); drawFrame();}
  function stopPreview(){if(previewTimer){cancelAnimationFrame(previewTimer); previewTimer=null;}}
  function prepCanvas(src){
    const sw=src.width||640, sh=src.height||480;
    const cw=Math.round(sw*.92), ch=Math.round(sh*.55);
    const cx=Math.round((sw-cw)/2), cy=Math.round((sh-ch)/2);
    const out=document.createElement('canvas');
    out.width=Math.round(cw*1.6); out.height=Math.round(ch*1.6);
    const ctx=out.getContext('2d');
    ctx.filter='grayscale(1) contrast(2) brightness(1.05)';
    try{ctx.drawImage(src,cx,cy,cw,ch,0,0,out.width,out.height);}catch(e){}
    return out;
  }
  async function openCamera(){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia) throw new Error('Camera access is not supported in this browser.');
    const video=getVideo();
    const constraints={video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false};
    try{stream=await navigator.mediaDevices.getUserMedia(constraints);}catch(e){stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});}
    video.srcObject=stream; video.setAttribute('playsinline',''); video.muted=true;
    await video.play();
    startPreview();
  }
  async function setupNative(){
    if(!('BarcodeDetector' in window)) return false;
    try{
      const supported=BarcodeDetector.getSupportedFormats?await BarcodeDetector.getSupportedFormats():[];
      const wanted=['code_128','code_39','code_93','ean_13','ean_8','upc_a','upc_e','qr_code','data_matrix','pdf417','itf','codabar'];
      const formats=supported.length?wanted.filter(f=>supported.includes(f)):wanted;
      detector=new BarcodeDetector({formats:formats.length?formats:wanted});
      return true;
    }catch(e){ detector=null; return false; }
  }
  async function ensureZXing(){
    if(window.ZXingBrowser&&window.ZXingBrowser.BrowserMultiFormatReader) return 'browser';
    if(window.ZXing&&window.ZXing.BrowserMultiFormatReader) return 'library';
    for(const url of ZXING_URLS){try{await loadScript(url); if(window.ZXingBrowser&&window.ZXingBrowser.BrowserMultiFormatReader) return 'browser'; if(window.ZXing&&window.ZXing.BrowserMultiFormatReader) return 'library';}catch(e){}}
    return '';
  }
  function finish(value){
    value=String(value||'').trim();
    if(!value) return;
    try{navigator.vibrate&&navigator.vibrate(70);}catch(e){}
    const cb=callback; stop(true); if(cb) cb(value);
  }
  async function nativeLoop(){
    if(!stream||!detector) return;
    const canvas=getCanvas();
    try{
      const codes=await detector.detect(prepCanvas(canvas));
      if(codes&&codes.length&&codes[0].rawValue){finish(codes[0].rawValue); return;}
    }catch(e){}
    timer=setTimeout(nativeLoop,120);
  }
  async function zxingLoop(){
    if(!stream||!zxingReader) return;
    const canvas=prepCanvas(getCanvas());
    try{
      let result;
      if(zxingReader.decodeFromCanvas) result=await zxingReader.decodeFromCanvas(canvas);
      else if(zxingReader.decode) result=zxingReader.decode(canvas);
      const txt=result&&(result.getText?result.getText():result.text);
      if(txt){finish(txt);return;}
    }catch(e){}
    timer=setTimeout(zxingLoop,160);
  }
  async function startZXing(){
    setStatus('Loading fallback barcode engine...');
    const type=await ensureZXing();
    if(!type) throw new Error('Fallback barcode engine could not load.');
    const Reader=(type==='browser'?window.ZXingBrowser.BrowserMultiFormatReader:window.ZXing.BrowserMultiFormatReader);
    zxingReader=new Reader();
    setStatus('Scanning with fallback engine...');
    zxingLoop();
  }
  async function start(cb){
    callback=cb;
    const modal=el('scannerModal');
    if(!modal||!getVideo()){alert('Scanner UI not available.');return;}
    modal.hidden=false;
    setStatus('Starting camera...');
    try{
      await openCamera();
      if(await setupNative()){setStatus('Scanning with built-in barcode engine...'); nativeLoop();}
      else await startZXing();
    }catch(err){
      setStatus('Camera/scanner error: '+err.message);
      alert('Camera scan failed: '+err.message+'\n\nMake sure you are using Chrome/Edge over HTTPS and camera permission is allowed. You can still use a USB/Bluetooth scanner or type into Search.');
      stop(false);
    }
  }
  function stop(hide=true){
    if(timer){clearTimeout(timer); timer=null;}
    stopPreview();
    if(zxingReader){try{zxingReader.reset&&zxingReader.reset();}catch(e){} zxingReader=null;}
    if(stream){stream.getTracks().forEach(t=>t.stop()); stream=null;}
    const video=getVideo(); if(video){video.pause&&video.pause(); video.srcObject=null;}
    const modal=el('scannerModal'); if(hide&&modal) modal.hidden=true;
  }
  window.addEventListener('load',()=>{const close=el('scannerClose'); if(close) close.onclick=()=>stop(true);});
  window.LWHScanner={start,stop};
})();
