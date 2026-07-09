(function(){
  function el(id){ return document.getElementById(id); }
  function round(n,d){ return Math.round(n*Math.pow(10,d))/Math.pow(10,d); }

  // ---------- Tab switching ----------
  function initTabs(){
    const tabs=el('utilTabs'); if(!tabs) return;
    tabs.addEventListener('click',e=>{
      const b=e.target.closest('[data-util]'); if(!b) return;
      tabs.querySelectorAll('.seg').forEach(s=>s.classList.toggle('active',s===b));
      ['calc','convert','pallet','notepad','scanner','generate','scancode','message','trailercube'].forEach(name=>{
        const panel=el('util'+name.charAt(0).toUpperCase()+name.slice(1));
        if(panel) panel.hidden=(name!==b.dataset.util);
      });
      if(b.dataset.util!=='scanner') stopScannerCamera();
    });
  }

  // ---------- Calculator (classic four-function, left-to-right like a desk calculator) ----------
  const calc={acc:null,op:null,cur:'0',fresh:true};
  function calcRender(){ const d=el('calcDisplay'); if(d) d.textContent=calc.cur; }
  function calcDigit(v){
    if(calc.fresh){ calc.cur=(v==='.')?'0.':v; calc.fresh=false; }
    else{
      if(v==='.'&&calc.cur.includes('.')) return;
      calc.cur=(calc.cur==='0'&&v!=='.')?v:calc.cur+v;
    }
    calcRender();
  }
  function calcApplyOp(op){
    if(calc.op&&!calc.fresh) calcEquals();
    calc.acc=parseFloat(calc.cur);
    calc.op=op;
    calc.fresh=true;
  }
  function calcEquals(){
    if(calc.op==null||calc.acc==null) return;
    const b=parseFloat(calc.cur);
    let r=calc.acc;
    if(calc.op==='+') r=calc.acc+b;
    else if(calc.op==='-') r=calc.acc-b;
    else if(calc.op==='*') r=calc.acc*b;
    else if(calc.op==='/') r=(b===0)?NaN:calc.acc/b;
    calc.cur=String(round(r,8));
    calc.op=null; calc.acc=null; calc.fresh=true;
    calcRender();
  }
  function calcClear(){ calc.acc=null; calc.op=null; calc.cur='0'; calc.fresh=true; calcRender(); }
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
    const len=el('pfLen'), wid=el('pfWid'), sqft=el('pfSqFt'), sqin=el('pfSqIn'), std=el('pfStandard');
    const count=el('seCount'), stack=el('seStack'), aisle=el('seAisle'), seSqFt=el('seSqFt'), seDetail=el('seDetail');
    const availSqFt=el('seAvailSqFt'), seCapacity=el('seCapacity'), seCapacityDetail=el('seCapacityDetail');
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
      if(!n||!pFt){ seSqFt.textContent='0 sq ft'; seDetail.textContent='—'; return; }
      const positions=Math.ceil(n/s);
      const base=positions*pFt;
      const total=base*(1+a/100);
      seSqFt.textContent=round(total,0).toLocaleString()+' sq ft';
      seDetail.textContent=`${positions.toLocaleString()} floor position(s) × ${round(pFt,2)} sq ft, +${a}% aisle allowance`;
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
    if(std) std.onclick=()=>{ len.value=48; wid.value=40; recalcAll(); };
    count.addEventListener('input',calcStorageSpace); count.addEventListener('change',calcStorageSpace);
    stack.addEventListener('input',()=>{ calcStorageSpace(); calcReverseCapacity(); });
    stack.addEventListener('change',()=>{ calcStorageSpace(); calcReverseCapacity(); });
    aisle.addEventListener('input',()=>{ calcStorageSpace(); calcReverseCapacity(); });
    aisle.addEventListener('change',()=>{ calcStorageSpace(); calcReverseCapacity(); });
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
      const removeBtn=document.createElement('button'); removeBtn.type='button'; removeBtn.className='ghost'; removeBtn.textContent='Remove';
      removeBtn.onclick=()=>{ scanPagesData.splice(i,1); renderScanPages(); };
      actions.append(enhanceBtn,removeBtn);
      div.append(actions);
      wrap.append(div);
    });
    const bulk=el('scanBulkActions'); if(bulk) bulk.hidden=!scanPagesData.length;
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

  window.LWHUtilities={stopScannerCamera};
  window.addEventListener('load',()=>{ initTabs(); initCalc(); initConvert(); initPallet(); initNotepad(); initScanner(); initGenerate(); initScanCode(); initMessage(); initTrailerCube(); });
})();
