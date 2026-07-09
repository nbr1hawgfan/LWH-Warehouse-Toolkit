(function(){
  function el(id){ return document.getElementById(id); }
  function round(n,d){ return Math.round(n*Math.pow(10,d))/Math.pow(10,d); }

  // ---------- Tab switching ----------
  function initTabs(){
    const tabs=el('utilTabs'); if(!tabs) return;
    tabs.addEventListener('click',e=>{
      const b=e.target.closest('[data-util]'); if(!b) return;
      tabs.querySelectorAll('.seg').forEach(s=>s.classList.toggle('active',s===b));
      ['calc','convert','pallet','notepad','scanner'].forEach(name=>{
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
    const kg=el('cvKg'), lb=el('cvLb'), inch=el('cvIn'), ft=el('cvFt'), cm=el('cvCm'), m=el('cvM');
    if(!kg) return;
    const KG_LB=2.2046226218, IN_CM=2.54;
    kg.addEventListener('input',()=>{ const v=parseFloat(kg.value); lb.value=isNaN(v)?'':round(v*KG_LB,3); });
    lb.addEventListener('input',()=>{ const v=parseFloat(lb.value); kg.value=isNaN(v)?'':round(v/KG_LB,3); });
    function fromInches(inches){
      if(isNaN(inches)){ inch.value=ft.value=cm.value=m.value=''; return; }
      inch.value=round(inches,3); ft.value=round(inches/12,3); cm.value=round(inches*IN_CM,3); m.value=round(inches*IN_CM/100,4);
    }
    inch.addEventListener('input',()=>{ const v=parseFloat(inch.value); if(isNaN(v)){ft.value=cm.value=m.value='';return;} ft.value=round(v/12,3); cm.value=round(v*IN_CM,3); m.value=round(v*IN_CM/100,4); });
    ft.addEventListener('input',()=>{ const v=parseFloat(ft.value); if(isNaN(v)){inch.value=cm.value=m.value='';return;} inch.value=round(v*12,3); cm.value=round(v*12*IN_CM,3); m.value=round(v*12*IN_CM/100,4); });
    cm.addEventListener('input',()=>{ const v=parseFloat(cm.value); if(isNaN(v)){inch.value=ft.value=m.value='';return;} const i=v/IN_CM; inch.value=round(i,3); ft.value=round(i/12,3); m.value=round(v/100,4); });
    m.addEventListener('input',()=>{ const v=parseFloat(m.value); if(isNaN(v)){inch.value=ft.value=cm.value='';return;} const i=(v*100)/IN_CM; inch.value=round(i,3); ft.value=round(i/12,3); cm.value=round(v*100,3); });
  }

  // ---------- Pallet footprint ----------
  function initPallet(){
    const len=el('pfLen'), wid=el('pfWid'), sqft=el('pfSqFt'), sqin=el('pfSqIn'), std=el('pfStandard');
    if(!len) return;
    function calcFootprint(){
      const l=parseFloat(len.value)||0, w=parseFloat(wid.value)||0;
      const area=l*w;
      sqft.textContent=round(area/144,2);
      sqin.textContent=Math.round(area)+' sq in';
    }
    len.addEventListener('input',calcFootprint); wid.addEventListener('input',calcFootprint);
    if(std) std.onclick=()=>{ len.value=48; wid.value=40; calcFootprint(); };
    calcFootprint();
  }

  // ---------- Notepad ----------
  function initNotepad(){
    const text=el('notepadText'), copyBtn=el('notepadCopy'), emailBtn=el('notepadEmail'), clearBtn=el('notepadClear');
    if(!text) return;
    text.value=LWHStorage.get('notepadText','');
    text.addEventListener('input',()=>LWHStorage.set('notepadText',text.value));
    if(copyBtn) copyBtn.onclick=()=>{ navigator.clipboard?.writeText(text.value).then(()=>LWHUI.toast('Copied to clipboard')).catch(()=>alert(text.value)); };
    if(emailBtn) emailBtn.onclick=()=>{ const body=encodeURIComponent(text.value||''); location.href=`mailto:?subject=${encodeURIComponent('Warehouse Notes')}&body=${body}`; };
    if(clearBtn) clearBtn.onclick=()=>{ if(confirm('Clear notepad? This cannot be undone.')){ text.value=''; LWHStorage.set('notepadText',''); } };
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
  function initScanner(){
    const openBtn=el('scanCaptureBtn'); if(!openBtn) return;
    openBtn.onclick=openScannerCamera;
    el('scanCloseBtn').onclick=stopScannerCamera;
    el('scanSnapBtn').onclick=capturePage;
    el('scanShareAll').onclick=shareAllPages;
    el('scanClearAll').onclick=()=>{ scanPagesData.length=0; renderScanPages(); };
  }

  window.LWHUtilities={stopScannerCamera};
  window.addEventListener('load',()=>{ initTabs(); initCalc(); initConvert(); initPallet(); initNotepad(); initScanner(); });
})();
