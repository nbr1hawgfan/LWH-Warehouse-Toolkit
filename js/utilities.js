(function(){
  function el(id){ return document.getElementById(id); }
  function round(n,d){ return Math.round(n*Math.pow(10,d))/Math.pow(10,d); }

  // ---------- Tab switching ----------
  function initTabs(){
    const tabs=el('utilTabs'); if(!tabs) return;
    tabs.addEventListener('click',e=>{
      const b=e.target.closest('[data-util]'); if(!b) return;
      tabs.querySelectorAll('.seg').forEach(s=>s.classList.toggle('active',s===b));
      ['calc','convert','pallet','notepad','scanner','generate','scancode','message','trailercube','datecalc','casecalc','health','revenue','distance','translate'].forEach(name=>{
        const panel=el('util'+name.charAt(0).toUpperCase()+name.slice(1));
        if(panel) panel.hidden=(name!==b.dataset.util);
      });
      if(b.dataset.util!=='scanner') stopScannerCamera();
    });
  }

  // ---------- Calculator (classic four-function, left-to-right like a desk calculator) ----------
  const calc={acc:null,accDisplay:'',op:null,cur:'0',fresh:true,lastExpr:''};
  function opSymbol(op){ return {'+':'+','-':'−','*':'×','/':'÷'}[op]||op; }
  function calcRender(){
    const d=el('calcDisplay'); if(d) d.textContent=calc.cur;
    const e=el('calcExpr');
    if(e) e.textContent = calc.op ? `${calc.accDisplay} ${opSymbol(calc.op)} ${calc.cur}` : (calc.lastExpr||'\u00A0');
  }
  function calcDigit(v){
    if(calc.fresh){ calc.cur=(v==='.')?'0.':v; calc.fresh=false; if(!calc.op) calc.lastExpr=''; }
    else{
      if(v==='.'&&calc.cur.includes('.')) return;
      calc.cur=(calc.cur==='0'&&v!=='.')?v:calc.cur+v;
    }
    calcRender();
  }
  function calcApplyOp(op){
    if(calc.op&&!calc.fresh) calcEquals();
    calc.acc=parseFloat(calc.cur);
    calc.accDisplay=calc.cur;
    calc.op=op;
    calc.fresh=true;
    calcRender();
  }
  function calcEquals(){
    if(calc.op==null||calc.acc==null) return;
    const b=parseFloat(calc.cur);
    let r=calc.acc;
    if(calc.op==='+') r=calc.acc+b;
    else if(calc.op==='-') r=calc.acc-b;
    else if(calc.op==='*') r=calc.acc*b;
    else if(calc.op==='/') r=(b===0)?NaN:calc.acc/b;
    calc.lastExpr=`${calc.accDisplay} ${opSymbol(calc.op)} ${calc.cur} =`;
    calc.cur=String(round(r,8));
    calc.op=null; calc.acc=null; calc.fresh=true;
    calcRender();
  }
  function calcClear(){ calc.acc=null; calc.accDisplay=''; calc.op=null; calc.cur='0'; calc.fresh=true; calc.lastExpr=''; calcRender(); }
  function calcBack(){ calc.cur=calc.cur.length>1?calc.cur.slice(0,-1):'0'; calcRender(); }
  function calcPercent(){ calc.cur=String(round(parseFloat(calc.cur||'0')/100,8)); calcRender(); }
  function initCalc(){
    const grid=document.querySelector('#utilCalc .calc-grid'); if(!grid) return;
    grid.addEventListener('click',e=>{
      const b=e.target.closest('[data-calc]'); if(!b) return;
      const v=b.dataset.calc;
      if(v==='C') calcClear();
      else if(v==='back') calcBack();
      else if(v==='%') calcPercent();
      else if(v==='=') calcEquals();
      else if(['+','-','*','/'].includes(v)) calcApplyOp(v);
      else calcDigit(v);
    });
    calcRender();
  }

  // ---------- Unit converter (linked fields — type into any one, others update) ----------
  function initConvert(){
    const kg=el('cvKg'), lb=el('cvLb'), oz=el('cvOz'), inch=el('cvIn'), ft=el('cvFt'), cm=el('cvCm'), m=el('cvM');
    const gal=el('cvGal'), liter=el('cvLiter'), qt=el('cvQt'), floz=el('cvFloz');
    const lwGal=el('lwGal'), lwDensity=el('lwDensity'), lwLb=el('lwLb');
    if(!kg) return;
    const KG_LB=2.2046226218, IN_CM=2.54, GAL_L=3.785411784;

    // Weight: kg / lb / oz, any field drives the other two
    kg.addEventListener('input',()=>{ const v=parseFloat(kg.value); if(isNaN(v)){lb.value=oz.value='';return;} const l=v*KG_LB; lb.value=round(l,3); oz.value=round(l*16,2); });
    lb.addEventListener('input',()=>{ const v=parseFloat(lb.value); if(isNaN(v)){kg.value=oz.value='';return;} kg.value=round(v/KG_LB,3); oz.value=round(v*16,2); });
    oz.addEventListener('input',()=>{ const v=parseFloat(oz.value); if(isNaN(v)){kg.value=lb.value='';return;} const l=v/16; kg.value=round(l/KG_LB,3); lb.value=round(l,3); });

    // Length: in / ft / cm / m
    inch.addEventListener('input',()=>{ const v=parseFloat(inch.value); if(isNaN(v)){ft.value=cm.value=m.value='';return;} ft.value=round(v/12,3); cm.value=round(v*IN_CM,3); m.value=round(v*IN_CM/100,4); });
    ft.addEventListener('input',()=>{ const v=parseFloat(ft.value); if(isNaN(v)){inch.value=cm.value=m.value='';return;} inch.value=round(v*12,3); cm.value=round(v*12*IN_CM,3); m.value=round(v*12*IN_CM/100,4); });
    cm.addEventListener('input',()=>{ const v=parseFloat(cm.value); if(isNaN(v)){inch.value=ft.value=m.value='';return;} const i=v/IN_CM; inch.value=round(i,3); ft.value=round(i/12,3); m.value=round(v/100,4); });
    m.addEventListener('input',()=>{ const v=parseFloat(m.value); if(isNaN(v)){inch.value=ft.value=cm.value='';return;} const i=(v*100)/IN_CM; inch.value=round(i,3); ft.value=round(i/12,3); cm.value=round(v*100,3); });

    // Volume: gal / L / qt / fl oz
    gal.addEventListener('input',()=>{ const v=parseFloat(gal.value); if(isNaN(v)){liter.value=qt.value=floz.value='';return;} liter.value=round(v*GAL_L,3); qt.value=round(v*4,3); floz.value=round(v*128,2); });
    liter.addEventListener('input',()=>{ const v=parseFloat(liter.value); if(isNaN(v)){gal.value=qt.value=floz.value='';return;} const g=v/GAL_L; gal.value=round(g,3); qt.value=round(g*4,3); floz.value=round(g*128,2); });
    qt.addEventListener('input',()=>{ const v=parseFloat(qt.value); if(isNaN(v)){gal.value=liter.value=floz.value='';return;} const g=v/4; gal.value=round(g,3); liter.value=round(g*GAL_L,3); floz.value=round(v*32,2); });
    floz.addEventListener('input',()=>{ const v=parseFloat(floz.value); if(isNaN(v)){gal.value=liter.value=qt.value='';return;} const g=v/128; gal.value=round(g,3); liter.value=round(g*GAL_L,3); qt.value=round(g*4,3); });

    // Liquid Weight Estimator: gallons × density = pounds (density defaults to water, editable)
    function lwCalc(){
      const g=parseFloat(lwGal.value), d=parseFloat(lwDensity.value);
      if(isNaN(g)||isNaN(d)){ lwLb.value=''; return; }
      lwLb.value=round(g*d,2);
    }
    lwGal.addEventListener('input',lwCalc);
    lwDensity.addEventListener('input',lwCalc);
    lwLb.addEventListener('input',()=>{
      const p=parseFloat(lwLb.value), d=parseFloat(lwDensity.value);
      if(isNaN(p)||isNaN(d)||d===0){ lwGal.value=''; return; }
      lwGal.value=round(p/d,3);
    });
  }

  // ---------- Pallet footprint + Storage Space Estimator ----------
  function initPallet(){
    const len=el('pfLen'), wid=el('pfWid'), sqft=el('pfSqFt'), sqin=el('pfSqIn');
    const count=el('seCount'), stack=el('seStack'), aisle=el('seAisle'), seSqFt=el('seSqFt'), seDetail=el('seDetail');
    const availSqFt=el('seAvailSqFt'), seCapacity=el('seCapacity'), seCapacityDetail=el('seCapacityDetail');
    const rate=el('seRate'), seCost=el('seCost'), seCostDetail=el('seCostDetail');
    if(!len) return;
    const required={len,wid,sqft,sqin,count,stack,aisle,seSqFt,seDetail,availSqFt,seCapacity,seCapacityDetail};
    const missing=Object.keys(required).filter(k=>!required[k]);
    if(missing.length){ console.error('Warehouse Tools: Pallet Footprint is missing expected elements — check for an old cached utilities.js or index.html mismatch:',missing); return; }

    function palletSqFt(){ return ((parseFloat(len.value)||0)*(parseFloat(wid.value)||0))/144; }

    function calcSingleFootprint(){
      const area=(parseFloat(len.value)||0)*(parseFloat(wid.value)||0);
      sqft.textContent=round(area/144,2);
      sqin.textContent=Math.round(area)+' sq in';
    }
    // Forward: pallet count -> estimated sq ft needed.
    // Floor positions = ceil(count / stackHeight) since stacked pallets share a floor position.
    // Total = (positions × single pallet sq ft) inflated by the aisle allowance %.
    function calcStorageSpace(){
      const n=parseFloat(count.value)||0, s=Math.max(1,parseFloat(stack.value)||1), a=parseFloat(aisle.value)||0;
      const pFt=palletSqFt();
      if(!n||!pFt){ seSqFt.textContent='0 sq ft'; seDetail.textContent='—'; calcCost(0); return; }
      const positions=Math.ceil(n/s);
      const base=positions*pFt;
      const total=base*(1+a/100);
      seSqFt.textContent=round(total,0).toLocaleString()+' sq ft';
      seDetail.textContent=`${positions.toLocaleString()} floor position(s) × ${round(pFt,2)} sq ft, +${a}% aisle allowance`;
      calcCost(total);
    }
    function calcCost(totalSqFt){
      if(!rate||!seCost) return;
      const r=parseFloat(rate.value)||0;
      if(!totalSqFt||!r){ seCost.textContent='—'; if(seCostDetail) seCostDetail.textContent='—'; return; }
      const cost=totalSqFt*r;
      seCost.textContent='$'+cost.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      if(seCostDetail) seCostDetail.textContent=`${round(totalSqFt,0).toLocaleString()} sq ft × $${r}/sq ft`;
    }
    // Reverse: available sq ft -> how many pallets fit.
    // Back out the aisle allowance first, see how many floor positions fit in what's left,
    // then multiply by stack height for total pallet capacity.
    function calcReverseCapacity(){
      const avail=parseFloat(availSqFt.value)||0, s=Math.max(1,parseFloat(stack.value)||1), a=parseFloat(aisle.value)||0;
      const pFt=palletSqFt();
      if(!avail||!pFt){ seCapacity.textContent='0 pallets'; seCapacityDetail.textContent='—'; return; }
      const usable=avail/(1+a/100);
      const positions=Math.floor(usable/pFt);
      const capacity=positions*s;
      seCapacity.textContent=capacity.toLocaleString()+' pallets';
      seCapacityDetail.textContent=`${positions.toLocaleString()} floor position(s) × stack of ${s}`;
    }
    function recalcAll(){ calcSingleFootprint(); calcStorageSpace(); calcReverseCapacity(); }

    len.addEventListener('input',recalcAll); wid.addEventListener('input',recalcAll);
    len.addEventListener('change',recalcAll); wid.addEventListener('change',recalcAll);
    document.querySelectorAll('#utilPallet [data-preset]').forEach(btn=>{
      btn.onclick=()=>{
        const [l,w]=btn.dataset.preset.split(',');
        len.value=l; wid.value=w;
        recalcAll();
      };
    });
    count.addEventListener('input',calcStorageSpace); count.addEventListener('change',calcStorageSpace);
    stack.addEventListener('input',()=>{ calcStorageSpace(); calcReverseCapacity(); });
    stack.addEventListener('change',()=>{ calcStorageSpace(); calcReverseCapacity(); });
    aisle.addEventListener('input',()=>{ calcStorageSpace(); calcReverseCapacity(); });
    aisle.addEventListener('change',()=>{ calcStorageSpace(); calcReverseCapacity(); });
    if(rate){ rate.addEventListener('input',calcStorageSpace); rate.addEventListener('change',calcStorageSpace); }
    availSqFt.addEventListener('input',calcReverseCapacity); availSqFt.addEventListener('change',calcReverseCapacity);

    recalcAll();
  }

  // ---------- Notepad ----------
  function initNotepad(){
    const text=el('notepadText'), copyBtn=el('notepadCopy'), emailBtn=el('notepadEmail'), clearBtn=el('notepadClear'), scanBtn=el('notepadScanBtn');
    if(!text) return;
    text.value=LWHStorage.get('notepadText','');
    text.addEventListener('input',()=>LWHStorage.set('notepadText',text.value));
    if(copyBtn) copyBtn.onclick=()=>{ navigator.clipboard?.writeText(text.value).then(()=>LWHUI.toast('Copied to clipboard')).catch(()=>alert(text.value)); };
    if(emailBtn) emailBtn.onclick=()=>{ const body=encodeURIComponent(text.value||''); location.href=`mailto:?subject=${encodeURIComponent('Warehouse Notes')}&body=${body}`; };
    if(clearBtn) clearBtn.onclick=()=>{ if(confirm('Clear notepad? This cannot be undone.')){ text.value=''; LWHStorage.set('notepadText',''); } };
    if(scanBtn) scanBtn.onclick=()=>{
      if(!window.LWHScanner){ alert('Scanner not available.'); return; }
      LWHScanner.start(value=>{
        text.value=text.value?(text.value+'\n'+value):value;
        LWHStorage.set('notepadText',text.value);
        LWHUI.toast('Added to notes: '+value);
      });
    };
  }

  // ---------- Basic document scanner ----------
  let scanStream=null;
  const scanPagesData=[]; // {canvas, enhanced}
  function stopScannerCamera(){
    if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; }
    const wrap=el('scanCameraWrap'), openBtn=el('scanCaptureBtn'), closeBtn=el('scanCloseBtn');
    if(wrap) wrap.hidden=true; if(openBtn) openBtn.hidden=false; if(closeBtn) closeBtn.hidden=true;
  }
  async function openScannerCamera(){
    try{
      scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
      const video=el('scanVideo'); video.srcObject=scanStream;
      try{ await video.play(); }catch(playErr){ /* some browsers auto-play once metadata loads; ignore */ }
      el('scanCameraWrap').hidden=false; el('scanCaptureBtn').hidden=true; el('scanCloseBtn').hidden=false;
    }catch(e){ alert('Could not open the camera: '+e.message+'\n\nMake sure the page is served over HTTPS and camera permission is allowed.'); }
  }
  function capturePage(){
    const video=el('scanVideo'); if(!video||!video.videoWidth) return;
    const canvas=document.createElement('canvas');
    canvas.width=video.videoWidth; canvas.height=video.videoHeight;
    canvas.getContext('2d').drawImage(video,0,0);
    scanPagesData.push({canvas,enhanced:false});
    renderScanPages();
  }
  function enhanceCanvas(canvas){
    const ctx=canvas.getContext('2d');
    const img=ctx.getImageData(0,0,canvas.width,canvas.height);
    const d=img.data; const contrast=1.35, mid=128;
    for(let i=0;i<d.length;i+=4){
      const gray=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
      const v=Math.max(0,Math.min(255,(gray-mid)*contrast+mid));
      d[i]=d[i+1]=d[i+2]=v;
    }
    ctx.putImageData(img,0,0);
  }
  function renderScanPages(){
    const wrap=el('scanPages'); if(!wrap) return;
    wrap.innerHTML='';
    scanPagesData.forEach((p,i)=>{
      const div=document.createElement('div'); div.className='cust-field scan-page';
      const img=document.createElement('img'); img.src=p.canvas.toDataURL('image/jpeg',0.9); img.className='scan-thumb';
      div.append(img);
      const label=document.createElement('div'); label.innerHTML=`<b>Page ${i+1}</b>`; div.append(label);
      const actions=document.createElement('div'); actions.className='actions';
      const enhanceBtn=document.createElement('button'); enhanceBtn.type='button'; enhanceBtn.className='ghost';
      enhanceBtn.textContent=p.enhanced?'Enhanced':'Enhance';
      enhanceBtn.disabled=p.enhanced;
      enhanceBtn.onclick=()=>{ enhanceCanvas(p.canvas); p.enhanced=true; renderScanPages(); };
      const ocrBtn=document.createElement('button'); ocrBtn.type='button'; ocrBtn.className='ghost';
      ocrBtn.textContent=p.ocrRunning?'Extracting…':'Extract Text';
      ocrBtn.disabled=!!p.ocrRunning;
      ocrBtn.onclick=()=>extractText(p);
      const removeBtn=document.createElement('button'); removeBtn.type='button'; removeBtn.className='ghost'; removeBtn.textContent='Remove';
      removeBtn.onclick=()=>{ scanPagesData.splice(i,1); renderScanPages(); };
      actions.append(enhanceBtn,ocrBtn,removeBtn);
      div.append(actions);
      if(p.ocrText!=null){
        const ta=document.createElement('textarea'); ta.rows=4; ta.style.marginTop='8px'; ta.value=p.ocrText;
        ta.placeholder='Extracted text — edit to fix any misreads before copying';
        ta.addEventListener('input',()=>{ p.ocrText=ta.value; });
        div.append(ta);
        const copyBtn=document.createElement('button'); copyBtn.type='button'; copyBtn.className='ghost'; copyBtn.style.marginTop='6px';
        copyBtn.textContent='Copy Text';
        copyBtn.onclick=()=>{ navigator.clipboard?.writeText(ta.value).then(()=>LWHUI.toast('Text copied')).catch(()=>alert(ta.value)); };
        div.append(copyBtn);
      }
      wrap.append(div);
    });
    const bulk=el('scanBulkActions'); if(bulk) bulk.hidden=!scanPagesData.length;
  }
  // Runs entirely in the browser via WebAssembly (Tesseract.js) rather than
  // any OS-level camera text detection — that's deliberate, since iOS Safari
  // never implemented the browser text-detection APIs Android's Chrome has,
  // so relying on those would only ever work on Android. This approach reads
  // printed text the same way on both platforms. First run on a page loads
  // the OCR engine/language data over the network, so it's a bit slower than
  // subsequent runs in the same session.
  async function extractText(p){
    if(!window.Tesseract){ alert('Text extraction library failed to load — check your internet connection.'); return; }
    p.ocrRunning=true; renderScanPages();
    try{
      const { data }=await Tesseract.recognize(p.canvas,'eng');
      p.ocrText=(data&&data.text||'').trim()||'(No text found — try Enhance first, or retake with better lighting/focus.)';
    }catch(e){
      p.ocrText='Text extraction failed: '+e.message;
    }
    p.ocrRunning=false;
    renderScanPages();
    LWHUI.toast('Text extracted — review and Copy Text');
  }
  function canvasToFile(canvas,name){
    return new Promise(resolve=>canvas.toBlob(blob=>resolve(new File([blob],name,{type:'image/jpeg'})),'image/jpeg',0.9));
  }
  async function shareAllPages(){
    if(!scanPagesData.length) return;
    const files=await Promise.all(scanPagesData.map((p,i)=>canvasToFile(p.canvas,`page-${i+1}.jpg`)));
    if(navigator.canShare && navigator.canShare({files})){
      try{ await navigator.share({files,title:'Scanned Document'}); }
      catch(e){ /* user cancelled share sheet — not an error */ }
    } else {
      files.forEach(f=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(f); a.download=f.name; document.body.append(a); a.click(); a.remove(); });
      LWHUI.toast('Sharing not supported on this browser — downloaded instead');
    }
  }
  // Combines every captured page into one real, multi-page PDF — each photo
  // scaled to fit a letter-size page, centered, preserving its aspect ratio.
  // Good for handing off something like a signed Bill of Lading as one file
  // instead of a pile of separate photos.
  function downloadAsPdf(){
    if(!scanPagesData.length){ LWHUI.toast('No pages captured yet'); return; }
    if(!window.jspdf){ alert('The PDF library failed to load — check your internet connection. Share All Pages still works as an alternative.'); return; }
    const {jsPDF}=window.jspdf;
    const doc=new jsPDF({unit:'in',format:'letter'});
    const pageW=8.5, pageH=11, margin=0.4;
    const maxW=pageW-margin*2, maxH=pageH-margin*2;
    scanPagesData.forEach((p,i)=>{
      if(i>0) doc.addPage();
      const imgData=p.canvas.toDataURL('image/jpeg',0.9);
      const ratio=p.canvas.width/p.canvas.height;
      let w=maxW, h=w/ratio;
      if(h>maxH){ h=maxH; w=h*ratio; }
      doc.addImage(imgData,'JPEG',(pageW-w)/2,(pageH-h)/2,w,h);
    });
    doc.save('scanned-document.pdf');
    LWHUI.toast('PDF downloaded');
  }
  function initScanner(){
    const openBtn=el('scanCaptureBtn'); if(!openBtn) return;
    openBtn.onclick=openScannerCamera;
    el('scanCloseBtn').onclick=stopScannerCamera;
    el('scanSnapBtn').onclick=capturePage;
    el('scanShareAll').onclick=shareAllPages;
    const pdfBtn=el('scanDownloadPdf'); if(pdfBtn) pdfBtn.onclick=downloadAsPdf;
    el('scanClearAll').onclick=()=>{ scanPagesData.length=0; renderScanPages(); };
  }

  // ---------- Ad-hoc QR/Barcode generator ----------
  function initGenerate(){
    const text=el('genText'), tabs=el('genTypeTabs'), qrBox=el('genQrBox'), barcodeSvg=el('genBarcodeSvg'), label=el('genTextLabel'), shareBtn=el('genShareBtn');
    if(!text) return;
    let mode='qr';
    function render(){
      const v=text.value.trim();
      label.textContent=v;
      if(mode==='qr'){
        qrBox.style.display=''; barcodeSvg.style.display='none';
        qrBox.innerHTML='';
        if(v && window.LWHQR) LWHQR.make(qrBox,v,220);
      } else {
        qrBox.style.display='none'; barcodeSvg.style.display='inline-block';
        barcodeSvg.innerHTML='';
        if(v && window.LWHBarcode){ try{ LWHBarcode.make(barcodeSvg,v,{height:100,width:3}); }catch(e){ barcodeSvg.outerHTML='<div class="hint">Could not generate a barcode for that text.</div>'; } }
      }
    }
    text.addEventListener('input',render);
    if(tabs) tabs.addEventListener('click',e=>{
      const b=e.target.closest('[data-gentype]'); if(!b) return;
      tabs.querySelectorAll('.seg').forEach(s=>s.classList.toggle('active',s===b));
      mode=b.dataset.gentype;
      render();
    });
    render();

    // Converts whichever code is currently shown (QR canvas, or 1D barcode SVG)
    // into a PNG so it can go through the same native share sheet already
    // used elsewhere in the app — codes are visual, not text, so the normal
    // clipboard/mailto tricks don't apply here.
    function currentOutputAsBlob(){
      if(mode==='qr'){
        const canvas=qrBox.querySelector('canvas');
        if(canvas) return new Promise(res=>canvas.toBlob(res,'image/png'));
        const img=qrBox.querySelector('img');
        if(img) return fetch(img.src).then(r=>r.blob());
        return Promise.resolve(null);
      }
      if(!barcodeSvg.querySelector('rect,path,g')) return Promise.resolve(null);
      const svgData=new XMLSerializer().serializeToString(barcodeSvg);
      const svgUrl=URL.createObjectURL(new Blob([svgData],{type:'image/svg+xml;charset=utf-8'}));
      return new Promise((resolve)=>{
        const img=new Image();
        img.onload=()=>{
          const canvas=document.createElement('canvas');
          canvas.width=barcodeSvg.clientWidth||400; canvas.height=barcodeSvg.clientHeight||150;
          const ctx=canvas.getContext('2d');
          ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          URL.revokeObjectURL(svgUrl);
          canvas.toBlob(blob=>resolve(blob),'image/png');
        };
        img.onerror=()=>resolve(null);
        img.src=svgUrl;
      });
    }
    if(shareBtn) shareBtn.onclick=async()=>{
      const blob=await currentOutputAsBlob();
      if(!blob){ alert('Type something first to generate a code.'); return; }
      const file=new File([blob],(mode==='qr'?'qr-code.png':'barcode.png'),{type:'image/png'});
      if(navigator.canShare && navigator.canShare({files:[file]})){
        try{ await navigator.share({files:[file],title:text.value||'Code'}); }catch(e){ /* user cancelled */ }
      } else {
        const a=document.createElement('a'); a.href=URL.createObjectURL(file); a.download=file.name; document.body.append(a); a.click(); a.remove();
        LWHUI.toast('Sharing not supported here — downloaded instead');
      }
    };
  }

  // ---------- Scan Code (dedicated barcode/QR reader, separate from the generator) ----------
  function initScanCode(){
    const btn=el('scReadBtn'), resultCard=el('scResultCard'), resultText=el('scResultText');
    const copyBtn=el('scCopyBtn'), notesBtn=el('scNotesBtn'), emailBtn=el('scEmailBtn');
    if(!btn) return;
    let lastValue='';
    btn.onclick=()=>{
      if(!window.LWHScanner){ alert('Scanner not available.'); return; }
      LWHScanner.start(value=>{
        lastValue=value;
        resultText.textContent=value;
        resultCard.hidden=false;
      });
    };
    if(copyBtn) copyBtn.onclick=()=>{ if(!lastValue) return; navigator.clipboard?.writeText(lastValue).then(()=>LWHUI.toast('Copied: '+lastValue)).catch(()=>{}); };
    if(notesBtn) notesBtn.onclick=()=>{
      if(!lastValue) return;
      const text=el('notepadText');
      if(text){ text.value=text.value?(text.value+'\n'+lastValue):lastValue; LWHStorage.set('notepadText',text.value); LWHUI.toast('Added to notes'); }
    };
    if(emailBtn) emailBtn.onclick=()=>{ if(!lastValue) return; location.href=`mailto:?subject=${encodeURIComponent('Scanned Code')}&body=${encodeURIComponent(lastValue)}`; };
  }

  // ---------- Quick Message (mailto for text-only; Web Share when a photo is attached) ----------
  let qmPhotoFile=null;
  function refreshQuickMessageManagers(){
    const sel=el('qmManager'); if(!sel) return;
    const managers=LWHStorage.get('managers',[]);
    const current=sel.value;
    sel.innerHTML=managers.length
      ? managers.map(m=>`<option value="${String(m.email||'').replace(/"/g,'&quot;')}">${String(m.name||m.email||'Unnamed').replace(/</g,'&lt;')}</option>`).join('')
      : '<option value="">No managers added yet — add in Settings</option>';
    if(current) sel.value=current;
  }
  window.refreshQuickMessageManagers=refreshQuickMessageManagers; // Settings calls this after adding/editing/removing a manager

  function initMessage(){
    const sel=el('qmManager'), msg=el('qmMessage'), photoInput=el('qmPhoto'), previewWrap=el('qmPhotoPreviewWrap'), preview=el('qmPhotoPreview'), removeBtn=el('qmPhotoRemove'), sendBtn=el('qmSendBtn');
    if(!sel) return;
    refreshQuickMessageManagers();
    if(photoInput) photoInput.addEventListener('change',()=>{
      const f=photoInput.files&&photoInput.files[0];
      if(!f){ qmPhotoFile=null; previewWrap.hidden=true; return; }
      qmPhotoFile=f;
      const reader=new FileReader();
      reader.onload=()=>{ preview.src=reader.result; previewWrap.hidden=false; };
      reader.readAsDataURL(f);
    });
    if(removeBtn) removeBtn.onclick=()=>{ qmPhotoFile=null; if(photoInput) photoInput.value=''; previewWrap.hidden=true; };
    if(sendBtn) sendBtn.onclick=async()=>{
      const managers=LWHStorage.get('managers',[]);
      const chosen=managers.find(m=>m.email===sel.value) || {name:'',email:sel.value};
      if(!chosen.email){ alert('Add a manager with an email in Settings first.'); return; }
      const text=(msg.value||'').trim();
      if(!text){ alert('Type a quick message first.'); return; }
      if(qmPhotoFile){
        if(navigator.canShare && navigator.canShare({files:[qmPhotoFile]})){
          try{ await navigator.share({files:[qmPhotoFile],title:'Warehouse Alert',text:`To: ${chosen.name||chosen.email} <${chosen.email}>\n\n${text}`}); }
          catch(e){ /* user cancelled — not an error */ }
        } else {
          // No file-sharing support here — download the photo and open mailto so it can be attached manually.
          const a=document.createElement('a'); a.href=URL.createObjectURL(qmPhotoFile); a.download='warehouse-photo.jpg'; document.body.append(a); a.click(); a.remove();
          location.href=`mailto:${encodeURIComponent(chosen.email)}?subject=${encodeURIComponent('Warehouse Alert')}&body=${encodeURIComponent(text+'\n\n(Photo downloaded separately to your device — please attach it to this email.)')}`;
        }
      } else {
        location.href=`mailto:${encodeURIComponent(chosen.email)}?subject=${encodeURIComponent('Warehouse Alert')}&body=${encodeURIComponent(text)}`;
      }
    };
  }

  // ---------- Trailer Cube estimator ----------
  // Rectangular-packing estimate: picks whichever floor orientation (unit as-is,
  // or rotated 90°) fits more units per layer, multiplies by how many layers
  // stack within trailer height, and separately checks whether the trailer's
  // weight limit caps the count below what cube alone would allow — reporting
  // whichever constraint is actually the limiting factor.
  function initTrailerCube(){
    const profileSel=el('tcubeProfile'), profileName=el('tcubeProfileName'), saveBtn=el('tcubeSaveProfile'), delBtn=el('tcubeDeleteProfile');
    const len=el('tcubeLen'), wid=el('tcubeWid'), ht=el('tcubeHt'), weight=el('tcubeWeight');
    const trLen=el('tcubeTrLen'), trWid=el('tcubeTrWid'), trHt=el('tcubeTrHt'), trWeight=el('tcubeTrWeight');
    const result=el('tcubeResult'), detail=el('tcubeDetail');
    if(!len) return;

    function loadProfiles(){ return LWHStorage.get('trailerCubeProfiles',[]); }
    function saveProfiles(list){ LWHStorage.set('trailerCubeProfiles',list); }
    function refreshProfileSelect(){
      const profiles=loadProfiles();
      const current=profileSel.value;
      profileSel.innerHTML='<option value="">— Custom (not saved) —</option>'+profiles.map((p,i)=>`<option value="${i}">${String(p.name||'Unnamed').replace(/</g,'&lt;')}</option>`).join('');
      if(current) profileSel.value=current;
    }
    refreshProfileSelect();

    profileSel.addEventListener('change',()=>{
      const idx=profileSel.value; if(idx==='') return;
      const p=loadProfiles()[idx]; if(!p) return;
      len.value=p.len||''; wid.value=p.wid||''; ht.value=p.ht||''; weight.value=p.weight||'';
      profileName.value=p.name||'';
      calc();
    });

    saveBtn.onclick=()=>{
      const name=(profileName.value||'').trim();
      if(!name){ alert('Give this profile a name first.'); return; }
      const profiles=loadProfiles();
      const existingIdx=profiles.findIndex(p=>String(p.name||'').toLowerCase()===name.toLowerCase());
      const entry={name,len:len.value,wid:wid.value,ht:ht.value,weight:weight.value};
      if(existingIdx>-1) profiles[existingIdx]=entry; else profiles.push(entry);
      saveProfiles(profiles);
      refreshProfileSelect();
      profileSel.value=profiles.findIndex(p=>p.name===name);
      LWHUI.toast('Profile saved: '+name);
    };
    delBtn.onclick=()=>{
      const idx=profileSel.value;
      if(idx===''){ alert('Select a saved profile to delete first.'); return; }
      const profiles=loadProfiles();
      const removed=profiles.splice(+idx,1);
      saveProfiles(profiles);
      refreshProfileSelect();
      LWHUI.toast('Profile deleted'+(removed[0]?': '+removed[0].name:''));
    };

    function calc(){
      const uL=parseFloat(len.value)||0, uW=parseFloat(wid.value)||0, uH=parseFloat(ht.value)||0, uWt=parseFloat(weight.value)||0;
      const tL=parseFloat(trLen.value)||630, tW=parseFloat(trWid.value)||98, tH=parseFloat(trHt.value)||110, tWt=parseFloat(trWeight.value)||44000;
      if(!uL||!uW){ result.textContent='0'; detail.textContent='Enter unit length and width.'; return; }
      const perLayerA=Math.floor(tW/uW)*Math.floor(tL/uL);
      const perLayerB=Math.floor(tW/uL)*Math.floor(tL/uW);
      const rotated=perLayerB>perLayerA;
      const across=rotated?Math.floor(tW/uL):Math.floor(tW/uW);
      const along=rotated?Math.floor(tL/uW):Math.floor(tL/uL);
      const perLayer=Math.max(perLayerA,perLayerB);
      const layers=uH>0?Math.max(1,Math.floor(tH/uH)):1;
      const cubeUnits=perLayer*layers;
      let weightUnits=null, weightLimited=false;
      if(uWt>0 && tWt>0){ weightUnits=Math.floor(tWt/uWt); weightLimited=weightUnits<cubeUnits; }
      const finalUnits=weightUnits!==null?Math.min(cubeUnits,weightUnits):cubeUnits;
      result.textContent=finalUnits.toLocaleString();
      let text=`${across} across × ${along} deep${rotated?' (unit rotated 90°)':''}, ${layers} layer(s) high = ${cubeUnits.toLocaleString()} by cube`;
      if(weightUnits!==null) text+=` · ${weightUnits.toLocaleString()} by weight (${tWt.toLocaleString()} lb ÷ ${uWt.toLocaleString()} lb/unit)${weightLimited?' — weight is the limiting factor':' — cube is the limiting factor'}`;
      detail.textContent=text;
    }
    [len,wid,ht,weight,trLen,trWid,trHt,trWeight].forEach(f=>f.addEventListener('input',calc));
    calc();

    const genBtn=el('tcubeGenerate');
    if(genBtn) genBtn.onclick=()=>{
      const out=el('tcubePrintOutput'); if(!out) return;
      const name=(profileName.value||'').trim()||'Custom Unit';
      out.innerHTML=`<div class="checklist-page">
        <h1 class="tc-title">Trailer Load Estimate</h1>
        <p style="text-align:center;font-size:13px">${new Date().toLocaleDateString()}</p>
        <div class="tc-headrow" style="margin-top:14px">
          <div>
            <div><b>Unit / Customer:</b> ${name}</div>
            <div><b>Unit Dimensions:</b> ${len.value||'?'}in L × ${wid.value||'?'}in W × ${ht.value||'n/a'}in H</div>
            <div><b>Weight per Unit:</b> ${weight.value?weight.value+' lb':'n/a'}</div>
          </div>
          <div class="tc-headright">
            <div><b>Trailer:</b> 53' Dry Van</div>
            <div><b>Interior:</b> ${trLen.value} × ${trWid.value} × ${trHt.value} in</div>
            <div><b>Weight Limit:</b> ${trWeight.value} lb</div>
          </div>
        </div>
        <div style="text-align:center;margin-top:36px">
          <div style="font-size:13px">Estimated Units That Should Fit</div>
          <div style="font-size:3em;font-weight:900">${result.textContent}</div>
          <div style="font-size:13px;margin-top:6px">${detail.textContent}</div>
        </div>
        <p style="text-align:center;font-size:11px;margin-top:50px;color:#555">This is a rectangular-packing estimate based on standard trailer clearances — actual fit can vary with load bars, dunnage, and real trailer variance. Confirm against the actual load.</p>
      </div>`;
      if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
      LWHUI.toast('Summary generated — ready to print');
    };
  }

  // ---------- Date Calc: days between, add/subtract, and Julian (day-of-year) conversion ----------
  function initDateCalc(){
    const start=el('dcStart'), end=el('dcEnd'), daysBetween=el('dcDaysBetween');
    const addStart=el('dcAddStart'), addDays=el('dcAddDays'), addResult=el('dcAddResult');
    const jcDate=el('jcDate'), jcCode=el('jcCode'), jcResultJulian=el('jcResultJulian'), jcResultCalendar=el('jcResultCalendar');
    if(!start) return;

    function calcBetween(){
      if(!start.value||!end.value){ daysBetween.textContent='0'; return; }
      const d1=new Date(start.value+'T00:00:00'), d2=new Date(end.value+'T00:00:00');
      daysBetween.textContent=Math.round((d2-d1)/86400000).toLocaleString();
    }
    start.addEventListener('input',calcBetween); end.addEventListener('input',calcBetween);

    function calcAdd(){
      if(!addStart.value){ addResult.textContent='—'; return; }
      const n=parseInt(addDays.value)||0;
      const d=new Date(addStart.value+'T00:00:00');
      d.setDate(d.getDate()+n);
      addResult.textContent=d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
    }
    addStart.addEventListener('input',calcAdd); addDays.addEventListener('input',calcAdd);

    function dayOfYear(d){ return Math.floor((d-new Date(d.getFullYear(),0,1))/86400000)+1; }
    function toJulian(dateVal){
      if(!dateVal) return '';
      const d=new Date(dateVal+'T00:00:00');
      return String(d.getFullYear()%100).padStart(2,'0')+String(dayOfYear(d)).padStart(3,'0');
    }
    // Assumes the 2000s for year reconstruction — reasonable for any near-term
    // product date code. 4-digit codes (single year digit) are inherently
    // ambiguous across decades; picks whichever matching year is closest to
    // right now, which is right the overwhelming majority of the time for
    // real product dating.
    function fromJulian(code){
      code=String(code||'').trim();
      if(!/^\d{3,5}$/.test(code)) return null;
      let yy,doy;
      if(code.length===5){ yy=parseInt(code.slice(0,2),10); doy=parseInt(code.slice(2),10); }
      else if(code.length===4){
        const yDigit=parseInt(code.slice(0,1),10); doy=parseInt(code.slice(1),10);
        const nowYY=new Date().getFullYear()%100;
        let best=null,bestDiff=Infinity;
        for(let y=0;y<100;y++){ if(y%10===yDigit){ const diff=Math.abs(y-nowYY); if(diff<bestDiff){bestDiff=diff;best=y;} } }
        yy=best;
      } else { yy=new Date().getFullYear()%100; doy=parseInt(code,10); }
      if(doy<1||doy>366) return null;
      const d=new Date(2000+yy,0,1);
      d.setDate(d.getDate()+doy-1);
      return d;
    }
    jcDate.addEventListener('input',()=>{ jcResultJulian.textContent=toJulian(jcDate.value)||'—'; });
    jcCode.addEventListener('input',()=>{ const d=fromJulian(jcCode.value); jcResultCalendar.textContent=d?d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'—'; });

    const dow=el('dcDow'), dowResult=el('dcDowResult');
    if(dow) dow.addEventListener('input',()=>{
      if(!dow.value){ dowResult.textContent='—'; return; }
      const d=new Date(dow.value+'T00:00:00');
      dowResult.textContent=d.toLocaleDateString(undefined,{weekday:'long'});
    });
  }

  // ---------- Case / Layer / Pallet Counter ----------
  function initCaseCalc(){
    const upc=el('ccUnitsPerCase'), cpl=el('ccCasesPerLayer'), lpp=el('ccLayersPerPallet'), upp=el('ccUnitsPerPallet'), uppDetail=el('ccUnitsDetail');
    const target=el('ccTarget'), palletsNeeded=el('ccPalletsNeeded'), palletsDetail=el('ccPalletsDetail');
    if(!upc) return;
    function unitsPerPallet(){ return (parseFloat(upc.value)||0)*(parseFloat(cpl.value)||0)*(parseFloat(lpp.value)||0); }
    function calcPallets(){
      const u=unitsPerPallet(), t=parseFloat(target.value)||0;
      if(!u||!t){ palletsNeeded.textContent='0'; palletsDetail.textContent='—'; return; }
      const pallets=Math.ceil(t/u);
      const lastPallet=t-(pallets-1)*u;
      palletsNeeded.textContent=pallets.toLocaleString();
      palletsDetail.textContent=(t%u===0)?`Even split — all ${pallets} pallet(s) full`:`${(pallets-1).toLocaleString()} full pallet(s) + ${lastPallet.toLocaleString()} units on the last one`;
    }
    function calcUpp(){
      const u=unitsPerPallet();
      upp.textContent=u.toLocaleString();
      uppDetail.textContent=u?`${upc.value||0} units/case × ${cpl.value||0} cases/layer × ${lpp.value||0} layer(s)`:'—';
      calcPallets();
    }
    [upc,cpl,lpp].forEach(f=>f.addEventListener('input',calcUpp));
    target.addEventListener('input',calcPallets);
    calcUpp();
  }

  // ---------- Health: BMI + Body Fat % (nothing here is ever saved anywhere) ----------
  function initHealth(){
    const weight=el('bmiWeight'), hFt=el('bmiHeightFt'), hIn=el('bmiHeightIn'), bmiResult=el('bmiResult'), bmiCategory=el('bmiCategory');
    if(!weight) return;
    function calcBmi(){
      const w=parseFloat(weight.value), ft=parseFloat(hFt.value)||0, inch=parseFloat(hIn.value)||0;
      const totalIn=ft*12+inch;
      if(!w||!totalIn){ bmiResult.textContent='—'; bmiCategory.textContent='—'; return; }
      const bmi=703*w/(totalIn*totalIn);
      bmiResult.textContent=round(bmi,1);
      let cat;
      if(bmi<18.5) cat='Underweight';
      else if(bmi<25) cat='Normal weight';
      else if(bmi<30) cat='Overweight';
      else cat='Obese';
      bmiCategory.textContent=cat+' (standard BMI categories)';
    }
    [weight,hFt,hIn].forEach(f=>f.addEventListener('input',calcBmi));

    const gender=el('bfGender'), neck=el('bfNeck'), waist=el('bfWaist'), hip=el('bfHip'), hipLabel=el('bfHipLabel'), bfHeight=el('bfHeight'), bfResult=el('bfResult'), bfCategory=el('bfCategory');
    function toggleHip(){ hipLabel.style.display=(gender.value==='female')?'':'none'; }
    function bfCategoryFor(pct,sex){
      if(sex==='male'){
        if(pct<6) return 'Essential fat';
        if(pct<14) return 'Athletic';
        if(pct<18) return 'Fitness';
        if(pct<25) return 'Acceptable';
        return 'Obese range';
      }
      if(pct<14) return 'Essential fat';
      if(pct<21) return 'Athletic';
      if(pct<25) return 'Fitness';
      if(pct<32) return 'Acceptable';
      return 'Obese range';
    }
    function calcBodyFat(){
      const sex=gender.value, n=parseFloat(neck.value), wa=parseFloat(waist.value), h=parseFloat(bfHeight.value), hi=parseFloat(hip.value);
      if(!n||!wa||!h||(sex==='female'&&!hi)){ bfResult.textContent='—'; bfCategory.textContent='—'; return; }
      let bf;
      if(sex==='male') bf=86.010*Math.log10(wa-n)-70.041*Math.log10(h)+36.76;
      else bf=163.205*Math.log10(wa+hi-n)-97.684*Math.log10(h)-78.387;
      if(!isFinite(bf)||isNaN(bf)){ bfResult.textContent='—'; bfCategory.textContent='Check your measurements — waist should be larger than neck.'; return; }
      bfResult.textContent=round(bf,1)+'%';
      bfCategory.textContent=bfCategoryFor(bf,sex)+' range (estimate only)';
    }
    gender.addEventListener('change',()=>{ toggleHip(); calcBodyFat(); });
    [neck,waist,hip,bfHeight].forEach(f=>f.addEventListener('input',calcBodyFat));
    toggleHip();
  }

  // ---------- Storage Revenue & Profitability (multi-customer) ----------
  function initRevenue(){
    const rowsWrap=el('revRows'), addBtn=el('revAddRow');
    const stackIn=el('revStack'), aisleIn=el('revAisle'), costIn=el('revCostPerSqFt');
    const totalRevenueEl=el('revTotalRevenue'), totalDetailEl=el('revTotalDetail');
    if(!rowsWrap) return;

    function loadRows(){ return LWHStorage.get('storageRevenueRows',[{name:'',count:'',rate:'',len:'',wid:''}]); }
    function saveRows(rows){ LWHStorage.set('storageRevenueRows',rows); }

    // Same floor-position/aisle-allowance math as the Storage Space Estimator,
    // applied per customer row, so the sq ft figure here is consistent with
    // the rest of the app rather than a separate, different calculation.
    function rowMetrics(row,stack,aisle,costPerSqFt){
      const count=parseFloat(row.count)||0, rate=parseFloat(row.rate)||0;
      const revenue=count*rate;
      let sqft=null,effRate=null,cost=null,profit=null;
      const len=parseFloat(row.len)||0, wid=parseFloat(row.wid)||0;
      if(len&&wid&&count){
        const pFt=(len*wid)/144;
        const positions=Math.ceil(count/stack);
        sqft=positions*pFt*(1+aisle/100);
        effRate=sqft?revenue/sqft:null;
        if(costPerSqFt){ cost=sqft*costPerSqFt; profit=revenue-cost; }
      }
      return {revenue,sqft,effRate,cost,profit};
    }
    function metricsLine(m){
      return [
        `Revenue $${round(m.revenue,2).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`,
        m.sqft!=null?`${round(m.sqft,0).toLocaleString()} sq ft`:null,
        m.effRate!=null?`$${round(m.effRate,3)}/sq ft charged`:null,
        m.profit!=null?(m.profit>=0?`+$${round(m.profit,2).toLocaleString()} profit`:`−$${round(Math.abs(m.profit),2).toLocaleString()} loss`):null
      ].filter(Boolean).join(' · ');
    }
    function sharedVals(){ return {stack:Math.max(1,parseFloat(stackIn.value)||1),aisle:parseFloat(aisleIn.value)||0,costPerSqFt:parseFloat(costIn.value)||0}; }

    // Updates only the computed metrics text per row — never rebuilds the
    // input fields themselves, so typing in one row's field never steals
    // focus away mid-keystroke the way a full re-render would.
    function updateMetricsOnly(){
      const rows=loadRows(); const {stack,aisle,costPerSqFt}=sharedVals();
      let totalRev=0,totalSqft=0,totalCost=0,anySqft=false,anyCost=false;
      rows.forEach((row,i)=>{
        const m=rowMetrics(row,stack,aisle,costPerSqFt);
        const lineEl=rowsWrap.querySelector(`[data-metrics="${i}"]`);
        if(lineEl) lineEl.textContent=metricsLine(m)||'—';
        totalRev+=m.revenue;
        if(m.sqft!=null){ totalSqft+=m.sqft; anySqft=true; }
        if(m.cost!=null){ totalCost+=m.cost; anyCost=true; }
      });
      totalRevenueEl.textContent='$'+round(totalRev,2).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      let detail=`${rows.length} customer(s)`;
      if(anySqft) detail+=` · ${round(totalSqft,0).toLocaleString()} sq ft total`;
      if(anyCost){ const totalProfit=totalRev-totalCost; detail+=totalProfit>=0?` · +$${round(totalProfit,2).toLocaleString()} profit`:` · −$${round(Math.abs(totalProfit),2).toLocaleString()} loss`; }
      totalDetailEl.textContent=detail;
    }

    function render(){
      const rows=loadRows(); const {stack,aisle,costPerSqFt}=sharedVals();
      rowsWrap.innerHTML=rows.map((row,i)=>{
        const m=rowMetrics(row,stack,aisle,costPerSqFt);
        return `<div class="card" style="margin-bottom:8px">
          <div class="grid-3">
            <input data-idx="${i}" data-field="name" value="${String(row.name||'').replace(/"/g,'&quot;')}" placeholder="Customer Name" />
            <input data-idx="${i}" data-field="count" value="${String(row.count||'')}" placeholder="Pallet Count" inputmode="numeric" />
            <input data-idx="${i}" data-field="rate" value="${String(row.rate||'')}" placeholder="Rate $/Pallet" inputmode="decimal" />
          </div>
          <div class="grid-2" style="margin-top:6px">
            <input data-idx="${i}" data-field="len" value="${String(row.len||'')}" placeholder="Pallet Length (in, optional)" inputmode="decimal" />
            <input data-idx="${i}" data-field="wid" value="${String(row.wid||'')}" placeholder="Pallet Width (in, optional)" inputmode="decimal" />
          </div>
          <div class="hint" style="margin-top:6px" data-metrics="${i}">${metricsLine(m)||'—'}</div>
          <div class="actions" style="margin-top:6px"><button type="button" class="ghost" data-remove="${i}">Remove Row</button></div>
        </div>`;
      }).join('');
      updateMetricsOnly();
    }

    rowsWrap.addEventListener('input',e=>{
      const t=e.target; if(t.dataset.idx===undefined) return;
      const rows=loadRows();
      if(!rows[t.dataset.idx]) return;
      rows[t.dataset.idx][t.dataset.field]=t.value;
      saveRows(rows);
      updateMetricsOnly();
    });
    rowsWrap.addEventListener('click',e=>{
      const b=e.target.closest('[data-remove]'); if(!b) return;
      const rows=loadRows();
      rows.splice(+b.dataset.remove,1);
      if(!rows.length) rows.push({name:'',count:'',rate:'',len:'',wid:''});
      saveRows(rows);
      render();
    });
    addBtn.onclick=()=>{
      const rows=loadRows();
      rows.push({name:'',count:'',rate:'',len:'',wid:''});
      saveRows(rows);
      render();
    };
    [stackIn,aisleIn,costIn].forEach(f=>f.addEventListener('input',updateMetricsOnly));
    render();
  }

  // ---------- Translate: free, keyless via MyMemory ----------
  const TRANSLATE_QUICK_PHRASES=[
    'I need your paperwork.',
    'What is your pickup or delivery number?',
    'Please go to the dock number posted.',
    'Please wait here.',
    'Do you have your Bill of Lading?',
    'Thank you, have a safe trip.'
  ];
  const SPEECH_LANG_MAP={en:'en-US',es:'es-ES',ru:'ru-RU',fr:'fr-FR',pt:'pt-PT',zh:'zh-CN',ar:'ar-SA',vi:'vi-VN'};
  function initTranslate(){
    const from=el('trFrom'), to=el('trTo'), input=el('trInput'), result=el('trResult'), goBtn=el('trGo'), swapBtn=el('trSwap'), voiceBtn=el('trVoiceBtn'), phrasesWrap=el('trQuickPhrases');
    if(!input) return;

    async function translate(text){
      if(!text||!text.trim()){ result.textContent='Type, paste, or speak something first.'; return; }
      result.textContent='Translating…';
      try{
        const url=`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from.value}|${to.value}`;
        const res=await fetch(url);
        if(!res.ok) throw new Error('HTTP '+res.status);
        const data=await res.json();
        const translated=data && data.responseData && data.responseData.translatedText;
        if(!translated) throw new Error('No translation returned');
        result.textContent=translated;
      }catch(e){
        result.textContent='Translation failed: '+e.message+' — check your connection and try again';
      }
    }

    goBtn.onclick=()=>translate(input.value);
    swapBtn.onclick=()=>{
      const f=from.value; from.value=to.value; to.value=f;
      const prevResult=result.textContent;
      if(prevResult && prevResult!=='—' && !prevResult.startsWith('Translation failed') && !prevResult.startsWith('Type')){
        input.value=prevResult;
      }
      result.textContent='—';
    };
    phrasesWrap.innerHTML=TRANSLATE_QUICK_PHRASES.map((p,i)=>`<button type="button" class="ghost" data-phrase="${i}">${p}</button>`).join('');
    phrasesWrap.addEventListener('click',e=>{
      const b=e.target.closest('[data-phrase]'); if(!b) return;
      const phrase=TRANSLATE_QUICK_PHRASES[+b.dataset.phrase];
      input.value=phrase;
      translate(phrase);
    });
    if(window.attachVoiceInput) attachVoiceInput(voiceBtn,input,{lang:()=>SPEECH_LANG_MAP[from.value]||'en-US',cleanDigits:false,idleLabel:'Speak'});
  }

  window.LWHUtilities={stopScannerCamera};
  window.addEventListener('load',()=>{ initTabs(); initCalc(); initConvert(); initPallet(); initNotepad(); initScanner(); initGenerate(); initScanCode(); initMessage(); initTrailerCube(); initDateCalc(); initCaseCalc(); initHealth(); initRevenue(); initTranslate(); });
})();
