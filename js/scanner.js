(function(){
  let stream=null, detector=null, callback=null, timer=null;
  const hasDetector=()=>('BarcodeDetector' in window);
  async function start(cb){
    callback=cb;
    const modal=document.getElementById('scannerModal'), video=document.getElementById('scannerVideo'), status=document.getElementById('scannerStatus');
    if(!modal||!video){ alert('Scanner UI not available.'); return; }
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){ alert('Camera access is not supported in this browser.'); return; }
    if(!hasDetector()){
      alert('This browser does not support built-in barcode detection. On Android, use current Chrome or Edge over HTTPS.');
      return;
    }
    modal.hidden=false;
    status.textContent='Starting camera...';
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      video.srcObject=stream;
      await video.play();
      const formats=['qr_code','code_128','code_39','code_93','ean_13','ean_8','upc_a','upc_e','itf','codabar'];
      detector=new BarcodeDetector({formats});
      status.textContent='Point the camera at a barcode or QR code.';
      scanLoop();
    }catch(err){
      status.textContent='Camera failed: '+err.message;
    }
  }
  async function scanLoop(){
    const video=document.getElementById('scannerVideo'), status=document.getElementById('scannerStatus');
    if(!video||!detector||!stream)return;
    try{
      const codes=await detector.detect(video);
      if(codes&&codes.length){
        const value=(codes[0].rawValue||'').trim();
        if(value){ status.textContent='Scanned: '+value; const cb=callback; stop(); if(cb) cb(value); return; }
      }
    }catch(err){ status.textContent='Scanning error: '+err.message; }
    timer=setTimeout(scanLoop,250);
  }
  function stop(){
    if(timer){clearTimeout(timer);timer=null;}
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
    const modal=document.getElementById('scannerModal'), video=document.getElementById('scannerVideo');
    if(video) video.srcObject=null;
    if(modal) modal.hidden=true;
  }
  window.addEventListener('load',()=>{const close=document.getElementById('scannerClose'); if(close) close.onclick=stop;});
  window.LWHScanner={start,stop};
})();
