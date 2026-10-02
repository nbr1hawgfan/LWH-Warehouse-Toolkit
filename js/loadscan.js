(function(){
  // LOAD TAG SCAN — replaces the "scan pallet tags into a spreadsheet, print
  // the barcode column, scan that into SAP" routine.
  //  • Scan with a USB/Bluetooth scanner (it types the tag + Enter) or the
  //    phone camera (continuous — no tapping between tags).
  //  • Running count against the expected units, duplicate tags refused,
  //    tags that don't look like the others flagged.
  //  • Saved on this device after every scan, so a refresh, dead battery or
  //    phone call doesn't lose the load. Finished loads kept for reprinting.
  //  • Output: print sheet / PDF with a Code 128 barcode and a QR code for
  //    every tag, plus Excel / CSV.
  const DRAFT_KEY='loadScanDraft', HIST_KEY='loadScanHistory', KB_KEY='loadScanHideKb';
  const XLSXJS='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

  let load=blankLoad();
  let cam=null, camLast={v:'',t:0}, audio=null;
  let burst=[];   // keystroke times, to spot scanners that don't send Enter

  const el=id=>document.getElementById(id);
  const safe=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function blankLoad(){ return {id:Date.now().toString(36),customer:'',loadNo:'',trailer:'',expected:'',scans:[],started:new Date().toISOString(),finished:null}; }
  function save(){ LWHStorage.set(DRAFT_KEY,load); }
  function fmtTime(iso){ const d=new Date(iso); return isNaN(d)?'':d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit'}); }
  function fmtDate(iso){ const d=new Date(iso); return isNaN(d)?'':d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }

  // What a scanner sends can include an AIM symbology prefix (]C1, ]Q3…) or
  // invisible control characters (GS separators). Keep just the tag.
  function cleanScan(v){
    return String(v||'').replace(/^\][A-Za-z][0-9]/,'').replace(/[\x00-\x1F\x7F]/g,'').trim();
  }
  // Usual tag length on this load (once there are a few scans)
  function usualLength(){
    const c={}; load.scans.forEach(s=>{ c[s.v.length]=(c[s.v.length]||0)+1; });
    const top=Object.keys(c).sort((a,b)=>c[b]-c[a])[0];
    return top&&c[top]>=3?+top:null;
  }

  // ---------------------------------------------------------------- feedback
  function tone(kind){
    try{
      audio=audio||new (window.AudioContext||window.webkitAudioContext)();
      const play=(f,t0,dur)=>{ const o=audio.createOscillator(),g=audio.createGain(); o.frequency.value=f; o.type='square'; g.gain.setValueAtTime(0.08,audio.currentTime+t0); g.gain.exponentialRampToValueAtTime(0.0001,audio.currentTime+t0+dur); o.connect(g).connect(audio.destination); o.start(audio.currentTime+t0); o.stop(audio.currentTime+t0+dur); };
      if(kind==='ok') play(1760,0,0.09);
      else if(kind==='done'){ play(1320,0,0.1); play(1760,0.12,0.1); play(2093,0.24,0.18); }
      else { play(220,0,0.16); play(180,0.2,0.22); }
    }catch(e){}
    try{ navigator.vibrate&&navigator.vibrate(kind==='ok'?60:kind==='done'?[60,60,60,60,160]:[200,80,200]); }catch(e){}
  }
  function flash(kind,msg){
    const f=el('lsFlash'); if(!f) return;
    f.className='ls-flash ls-flash-'+kind; f.textContent=msg;
    clearTimeout(flash.t); flash.t=setTimeout(()=>{ f.className='ls-flash'; f.textContent=''; },kind==='bad'?3500:1800);
  }

  // ---------------------------------------------------------------- scanning
  function addScan(raw,source){
    const v=cleanScan(raw);
    if(!v) return false;
    const dupAt=load.scans.findIndex(s=>s.v===v);
    if(dupAt>=0){ tone('bad'); flash('bad',`Already scanned as #${dupAt+1} — not added`); highlight(dupAt); return false; }
    const usual=usualLength();
    const odd=usual&&v.length!==usual;
    load.scans.push({v,t:new Date().toISOString(),src:source||'scanner',odd:!!odd});
    save();
    const n=load.scans.length, exp=+load.expected||0;
    if(exp&&n===exp){ tone('done'); flash('ok',`#${n} added — all ${exp} scanned!`); }
    else if(odd){ tone('bad'); flash('warn',`#${n} added — but it's ${v.length} characters, the others are ${usual}. Wrong barcode on the label?`); }
    else { tone('ok'); flash('ok',`#${n} added`); }
    if(exp&&n>exp) flash('warn',`#${n} added — that's more than the ${exp} expected`);
    render();
    return true;
  }
  function submitInput(){
    const inp=el('lsInput'); const v=inp.value; inp.value=''; burst=[];
    if(v.trim()) addScan(v,'scanner');
    inp.focus();
  }
  function highlight(i){
    const row=document.querySelector(`[data-ls-row="${i}"]`);
    if(row){ row.classList.remove('ls-hit'); void row.offsetWidth; row.classList.add('ls-hit'); row.scrollIntoView({block:'nearest',behavior:'smooth'}); }
  }

  // Camera — keeps scanning; the same tag held in view is ignored for a moment
  async function startCamera(){
    if(cam) return stopCamera();
    if(typeof Html5Qrcode==='undefined'){ alert('The camera scanner didn\'t load — check your internet connection. A plugged-in or Bluetooth scanner still works.'); return; }
    el('lsCamWrap').hidden=false; el('lsCamBtn').textContent='Stop camera';
    const formats=window.Html5QrcodeSupportedFormats?[Html5QrcodeSupportedFormats.CODE_128,Html5QrcodeSupportedFormats.CODE_39,Html5QrcodeSupportedFormats.ITF,Html5QrcodeSupportedFormats.EAN_13,Html5QrcodeSupportedFormats.UPC_A,Html5QrcodeSupportedFormats.QR_CODE,Html5QrcodeSupportedFormats.DATA_MATRIX]:undefined;
    const cfg={fps:12,qrbox:(w,h)=>({width:Math.min(w*0.9,420),height:Math.min(h*0.45,180)}),formatsToSupport:formats};
    cam=new Html5Qrcode('lsCam');
    const onHit=txt=>{
      const v=cleanScan(txt), now=Date.now();
      if(v===camLast.v&&now-camLast.t<2500){ camLast.t=now; return; }   // same tag still in view
      camLast={v,t:now};
      addScan(v,'camera');
    };
    try{ await cam.start({facingMode:'environment'},cfg,onHit,()=>{}); el('lsCamHint').textContent='Point at each tag — it adds them one after another.'; }
    catch(e){ el('lsCamHint').textContent='Camera error: '+e.message+' — allow camera access, or use a scanner.'; cam=null; el('lsCamBtn').textContent='Use camera'; }
  }
  function stopCamera(){
    const c=cam; cam=null;
    if(c){ try{ c.stop().then(()=>c.clear()).catch(()=>{}); }catch(e){} }
    const w=el('lsCamWrap'); if(w) w.hidden=true;
    const b=el('lsCamBtn'); if(b) b.textContent='Use camera';
  }

  // ---------------------------------------------------------------- render
  function render(){
    const n=load.scans.length, exp=+load.expected||0;
    el('lsCount').textContent=n;
    el('lsOf').textContent=exp?`of ${exp}`:'scanned';
    const pct=exp?Math.min(100,Math.round(n/exp*100)):0;
    el('lsBar').style.width=(exp?pct:0)+'%';
    el('lsBar').className=exp&&n===exp?'ls-bar-done':exp&&n>exp?'ls-bar-over':'';
    el('lsCountCard').classList.toggle('ls-complete',!!exp&&n===exp);
    el('lsMiniCount').textContent=n; el('lsMiniOf').textContent=exp?`of ${exp}`:'scanned';
    el('lsMiniBar').style.width=(exp?pct:0)+'%'; el('lsMini').classList.toggle('ls-complete',!!exp&&n===exp);
    el('lsCountNote').textContent=!exp?'Enter the expected units to track progress':n===exp?'All units scanned — ready to print':n>exp?`${n-exp} more than expected — check for an extra tag`:`${exp-n} to go`;
    const odd=load.scans.filter(s=>s.odd).length;
    el('lsOddNote').hidden=!odd; el('lsOddNote').textContent=odd?`${odd} tag${odd===1?' looks':'s look'} different from the rest (length) — make sure the right barcode was scanned`:'';
    const list=el('lsList');
    if(!n){ list.innerHTML='<div class="ls-empty">No tags yet. Scan the first pallet tag.</div>'; }
    else list.innerHTML=load.scans.map((s,i)=>({s,i})).reverse().map(({s,i})=>`
      <div class="ls-row${s.odd?' ls-odd':''}" data-ls-row="${i}">
        <div class="ls-n">${i+1}</div>
        <div class="ls-v">${safe(s.v)}${s.odd?'<span class="ls-tag">different length</span>':''}</div>
        <div class="ls-t">${fmtTime(s.t)}${s.src==='camera'?' · camera':''}</div>
        <button type="button" class="ls-del" data-ls-del="${i}" aria-label="Remove tag ${i+1}">✕</button>
      </div>`).join('');
    list.querySelectorAll('[data-ls-del]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.lsDel; if(confirm(`Remove #${i+1} (${load.scans[i].v})?`)){ load.scans.splice(i,1); recheckOdd(); save(); render(); flash('warn',`Removed — numbers after it moved up`); } });
    ['lsPrint','lsPdf','lsXlsx','lsCsv','lsFinish','lsUndo'].forEach(id=>{ const b=el(id); if(b) b.disabled=!n; });
    renderHistory();
  }
  function recheckOdd(){ const u=usualLength(); load.scans.forEach(s=>{ s.odd=!!(u&&s.v.length!==u); }); }
  function fieldsToUi(){ el('lsCustomer').value=load.customer; el('lsLoadNo').value=load.loadNo; el('lsTrailer').value=load.trailer; el('lsExpected').value=load.expected; }

  // ---------------------------------------------------------------- history
  function history(){ return LWHStorage.get(HIST_KEY,[])||[]; }
  function archive(){
    if(!load.scans.length) return;
    load.finished=new Date().toISOString();
    const h=history().filter(x=>x.id!==load.id); h.unshift(JSON.parse(JSON.stringify(load)));
    LWHStorage.set(HIST_KEY,h.slice(0,20));
  }
  function renderHistory(){
    const box=el('lsHistory'); if(!box) return;
    const h=history();
    box.innerHTML=h.length?h.map((x,i)=>`<div class="ls-hist-row"><div><b>${safe(x.loadNo||'(no load #)')}</b> · ${safe(x.customer||'')}${x.trailer?' · Trailer '+safe(x.trailer):''}<div class="db-sub">${x.scans.length} tags · ${fmtDate(x.finished||x.started)} ${fmtTime(x.finished||x.started)}</div></div><div class="ls-hist-act"><button type="button" class="ghost" data-ls-reprint="${i}">Reprint</button><button type="button" class="mh-link" data-ls-open="${i}">Open</button></div></div>`).join('')
      :'<div class="hint">Finished loads show up here so you can reprint them.</div>';
    box.querySelectorAll('[data-ls-reprint]').forEach(b=>b.onclick=()=>printSheet(history()[+b.dataset.lsReprint]));
    box.querySelectorAll('[data-ls-open]').forEach(b=>b.onclick=()=>{
      if(load.scans.length&&!confirm('Open that load? The load you\'re scanning now will be saved to this list first.')) return;
      archive(); load=JSON.parse(JSON.stringify(history()[+b.dataset.lsOpen])); load.finished=null; save(); fieldsToUi(); render(); el('lsInput').focus();
    });
  }

  // ---------------------------------------------------------------- output
  function outName(L){ return 'Tags_'+[L.loadNo||'load',L.trailer?'TR'+L.trailer:''].filter(Boolean).join('_').replace(/[^A-Za-z0-9_-]+/g,'_'); }
  function qrDataUrl(text,px){
    const d=document.createElement('div'); new QRCode(d,{text:String(text),width:px,height:px,correctLevel:QRCode.CorrectLevel.M});
    const c=d.querySelector('canvas'); return c?c.toDataURL('image/png'):(d.querySelector('img')||{}).src;
  }
  function headerHtml(L){
    return `<div class="ls-p-head"><div><b>Pallet Tags</b>${L.customer?' — '+safe(L.customer):''}</div><div>${L.loadNo?'Load '+safe(L.loadNo)+' · ':''}${L.trailer?'Trailer '+safe(L.trailer)+' · ':''}${L.scans.length} tags · ${fmtDate(L.finished||new Date().toISOString())}</div></div>`;
  }
  function printSheet(L){
    L=L||load; if(!L.scans.length) return;
    if(!window.JsBarcode||!window.QRCode){ alert('The barcode libraries didn\'t load — check your internet connection.'); return; }
    if(L===load) archive();
    const out=el('lsPrintArea');
    out.innerHTML=`<div class="ls-p-page">${headerHtml(L)}${L.scans.map((s,i)=>`
      <div class="ls-p-row"><div class="ls-p-n">${i+1}</div><div class="ls-p-bc"><svg id="lsBc${i}"></svg><div class="ls-p-txt">${safe(s.v)}</div></div><div class="ls-p-qr"><img id="lsQr${i}" alt="" /></div></div>`).join('')}</div>`;
    L.scans.forEach((s,i)=>{
      try{ JsBarcode('#lsBc'+i,s.v,{format:'CODE128',height:52,width:1.5,margin:0,marginLeft:16,marginRight:16,displayValue:false}); }catch(e){ console.error(e); }
      el('lsQr'+i).src=qrDataUrl(s.v,220);
    });
    if(window.LWHLabels&&LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
    setTimeout(()=>print(),200);
  }
  function downloadPdf(L){
    L=L||load; if(!L.scans.length) return;
    if(!window.jspdf||!window.JsBarcode||!window.QRCode){ alert('The PDF/barcode libraries didn\'t load — check your internet connection.'); return; }
    archive();
    const {jsPDF}=window.jspdf; const doc=new jsPDF({unit:'pt',format:'letter'});
    const M=36, rowH=64, top=86, perPage=Math.floor((792-top-M)/rowH);
    const head=(pg,pages)=>{
      doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.text('Pallet Tags'+(L.customer?' — '+L.customer:''),M,M+10);
      doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(80);
      doc.text([L.loadNo?'Load '+L.loadNo:'',L.trailer?'Trailer '+L.trailer:'',`${L.scans.length} tags`,fmtDate(new Date().toISOString())].filter(Boolean).join('  ·  '),M,M+28);
      doc.text(`Page ${pg} of ${pages}`,612-M,M+28,{align:'right'}); doc.setTextColor(0);
      doc.setLineWidth(1.2); doc.line(M,M+38,612-M,M+38);
    };
    const pages=Math.ceil(L.scans.length/perPage);
    L.scans.forEach((s,i)=>{
      const k=i%perPage; if(k===0){ if(i) doc.addPage(); head(Math.floor(i/perPage)+1,pages); }
      const y=top+k*rowH;
      doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.text(String(i+1),M+14,y+30,{align:'center'});
      // Code 128 drawn at 1 pt per bar module (~14 mil) — never squeezed
      const c=document.createElement('canvas'); const MOD=3;
      JsBarcode(c,s.v,{format:'CODE128',height:120,width:MOD,margin:0,displayValue:false});
      const maxW=612-2*M-48-76; let wPt=c.width/MOD*1.0; if(wPt>maxW) wPt=maxW; const hPt=34;
      doc.addImage(c.toDataURL('image/png'),'PNG',M+48,y+6,wPt,hPt);
      doc.setFont('courier','bold'); doc.setFontSize(12); doc.text(s.v,M+48,y+52);
      doc.addImage(qrDataUrl(s.v,240),'PNG',612-M-56,y+4,52,52);
      doc.setDrawColor(190); doc.setLineWidth(0.5); doc.line(M,y+rowH-2,612-M,y+rowH-2);
    });
    // hand the file over the same way the Excel/CSV downloads do (works on phones too)
    const a=document.createElement('a'); a.href=URL.createObjectURL(doc.output('blob')); a.download=outName(L)+'.pdf';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  }
  function rows(L){ return L.scans.map((s,i)=>({'#':i+1,'Tag':s.v,'Scanned':new Date(s.t).toLocaleString('en-US'),'Customer':L.customer,'Load #':L.loadNo,'Trailer':L.trailer})); }
  function downloadCsv(){
    const r=rows(load), h=Object.keys(r[0]||{});
    const esc=v=>{ const x=String(v??''); return /[",\n]/.test(x)||/^\d{12,}$/.test(x)?'"'+x.replace(/"/g,'""')+'"':x; };
    const blob=new Blob([[h.join(','),...r.map(o=>h.map(k=>esc(o[k])).join(','))].join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=outName(load)+'.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  async function downloadXlsx(){
    try{ await new Promise((ok,no)=>{ if(window.XLSX) return ok(); const s=document.createElement('script'); s.src=XLSXJS; s.onload=ok; s.onerror=no; document.head.appendChild(s); }); }
    catch{ LWHUI.toast('Excel needs internet — downloading CSV instead'); return downloadCsv(); }
    // tags as text so Excel doesn't turn long numbers into 1.23E+19
    const ws=XLSX.utils.json_to_sheet(rows(load).map(r=>({...r,'Tag':String(r.Tag)})));
    Object.keys(ws).forEach(k=>{ if(/^B\d+$/.test(k)&&k!=='B1'){ ws[k].t='s'; ws[k].z='@'; } });
    ws['!cols']=[{wch:5},{wch:26},{wch:22},{wch:22},{wch:14},{wch:12}];
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Tags'); XLSX.writeFile(wb,outName(load)+'.xlsx');
  }

  // ---------------------------------------------------------------- wiring
  window.addEventListener('load',()=>{
    const inp=el('lsInput'); if(!inp) return;
    const d=LWHStorage.get(DRAFT_KEY,null); if(d&&Array.isArray(d.scans)) load=d;
    fieldsToUi();
    const hide=LWHStorage.get(KB_KEY,false); el('lsHideKb').checked=hide; inp.setAttribute('inputmode',hide?'none':'text');
    render();

    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key==='Tab'){ e.preventDefault(); submitInput(); } });
    // Scanners set to send no Enter: a fast burst of characters then a pause = one scan
    inp.addEventListener('input',()=>{
      const now=performance.now(); burst.push(now); if(burst.length>40) burst.shift();
      clearTimeout(inp._t);
      inp._t=setTimeout(()=>{
        const v=inp.value; if(v.length<6||burst.length<6) return;
        const gaps=burst.slice(1).map((t,i)=>t-burst[i]); const avg=gaps.reduce((a,b)=>a+b,0)/gaps.length;
        if(avg<35) submitInput();
      },220);
    });
    const ready=on=>{ el('lsReady').classList.toggle('ls-ready-on',on); el('lsReady').textContent=on?'Ready — scan a tag':'Tap here to scan'; };
    inp.addEventListener('focus',()=>ready(true)); inp.addEventListener('blur',()=>ready(false));
    el('lsReady').onclick=()=>inp.focus();
    el('lsAdd').onclick=submitInput;
    el('lsHideKb').onchange=e=>{ LWHStorage.set(KB_KEY,e.target.checked); inp.setAttribute('inputmode',e.target.checked?'none':'text'); inp.blur(); inp.focus(); };
    [['lsCustomer','customer'],['lsLoadNo','loadNo'],['lsTrailer','trailer'],['lsExpected','expected']].forEach(([id,k])=>el(id).addEventListener('input',e=>{ load[k]=e.target.value.trim(); save(); render(); }));
    el('lsUndo').onclick=()=>{ const s=load.scans.pop(); if(s){ recheckOdd(); save(); render(); flash('warn',`Removed #${load.scans.length+1} (${s.v})`); } inp.focus(); };
    el('lsCamBtn').onclick=startCamera;
    el('lsPrint').onclick=()=>printSheet();
    el('lsPdf').onclick=()=>downloadPdf();
    el('lsXlsx').onclick=downloadXlsx;
    el('lsCsv').onclick=downloadCsv;
    el('lsFinish').onclick=()=>{
      const exp=+load.expected||0, n=load.scans.length;
      if(exp&&n!==exp&&!confirm(`${n} scanned but ${exp} expected. Start a new load anyway? This one is saved under Recent loads.`)) return;
      archive(); stopCamera(); load=blankLoad(); save(); fieldsToUi(); render(); LWHUI.toast('Saved — ready for the next load'); el('lsLoadNo').focus();
    };
    // focus the scan box when the page opens; camera off when leaving it
    document.addEventListener('click',e=>{ const v=e.target.closest('[data-view]'); if(!v) return; setTimeout(()=>{ if(v.dataset.view==='loadScan') inp.focus(); else stopCamera(); },50); });
  });
  window.LWHLoadScan={addScan:v=>addScan(v,'test')};
})();
