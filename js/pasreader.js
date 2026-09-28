(function(){
  // PAS SHEET READER — turns a scanned Shipping P.A.S. Sheet (PDF or phone
  // photo) into checked pallet/serial data: review each row beside a picture
  // of that exact row, then download Excel/CSV, copy serials, or print a
  // barcode sheet to scan into the WMS instead of typing.
  // Everything runs in this browser — the sheet is never uploaded anywhere.
  // Extraction rules live in js/pasreader-core.js (same code the accuracy
  // tests run).
  const PDFJS='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const XLSXJS='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

  let worker=null, busy=false;
  let sheets=[], cur=0, onlyIssues=false;

  const el=id=>document.getElementById(id);
  const safe=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const makeCanvas=(w,h)=>{ const c=document.createElement('canvas'); c.width=w; c.height=h; return c; };
  function loadScript(src){ return new Promise((ok,no)=>{ if([...document.scripts].some(s=>s.src===src)) return ok(); const s=document.createElement('script'); s.src=src; s.onload=ok; s.onerror=()=>no(new Error('Couldn\'t load '+src.split('/').pop()+' — check your internet connection.')); document.head.appendChild(s); }); }
  function progress(msg,frac){ el('psStatus').textContent=msg||''; if(frac!=null) el('psBar').style.width=Math.round(Math.max(0,Math.min(1,frac))*100)+'%'; }

  // ---------------------------------------------------------------- input
  async function pdfPages(file){
    await loadScript(PDFJS);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;
    const pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
    const out=[];
    for(let p=1;p<=pdf.numPages;p++){
      progress(`Opening page ${p} of ${pdf.numPages}…`,0.01);
      const page=await pdf.getPage(p);
      const v1=page.getViewport({scale:1});
      const scale=Math.max(2,Math.min(4.5,2480/v1.width));      // ~300 dpi on a letter page
      const vp=page.getViewport({scale});
      const c=makeCanvas(Math.round(vp.width),Math.round(vp.height));
      const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height);
      await page.render({canvasContext:x,viewport:vp}).promise;
      out.push(c);
    }
    return out;
  }
  async function imagePage(file){
    const url=URL.createObjectURL(file);
    try{
      const img=await new Promise((ok,no)=>{ const i=new Image(); i.onload=()=>ok(i); i.onerror=()=>no(new Error('That picture couldn\'t be opened.')); i.src=url; });
      const nw=img.naturalWidth;
      const s=nw>3000?3000/nw:nw<1800?1800/nw:1;   // phone photos: keep ~300 dpi-ish detail
      const c=makeCanvas(Math.round(img.naturalWidth*s),Math.round(img.naturalHeight*s));
      const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); x.drawImage(img,0,0,c.width,c.height);
      return [c];
    }finally{ URL.revokeObjectURL(url); }
  }
  async function getWorker(){
    if(worker) return worker;
    if(!window.Tesseract) throw new Error('The text reader didn\'t load — check your internet connection and reload.');
    progress('Loading the text reader (first time only)…',0.02);
    worker=await Tesseract.createWorker('eng',1,{logger:m=>{ if(m.status&&/load/i.test(m.status)&&m.progress!=null) progress('Loading the text reader (first time only)…',0.02+m.progress*0.03); }});
    return worker;
  }

  async function handleFile(file){
    if(!file||busy) return;
    const isPdf=/pdf$/i.test(file.type)||/\.pdf$/i.test(file.name);
    const isImg=/^image\//i.test(file.type);
    if(!isPdf&&!isImg){ progress('Please choose a PDF or a photo of the sheet.'); return; }
    busy=true; el('psWorking').hidden=false; el('psResults').innerHTML=''; el('psDrop').classList.add('ps-busy');
    try{
      const pages=isPdf?await pdfPages(file):await imagePage(file);
      const w=await getWorker();
      sheets=[];
      for(let i=0;i<pages.length;i++){
        const label=pages.length>1?`Page ${i+1} of ${pages.length}: `:'';
        const res=await LWHPasCore.extract(w,pages[i],{makeCanvas,progress:(m,f)=>progress(label+m,(i+f)/pages.length)});
        sheets.push(prepSheet(res,file.name,i+1,pages.length));
      }
      cur=0; onlyIssues=false;
      progress('',1); el('psWorking').hidden=true;
      render();
      const s=sheets[0];
      LWHUI.toast(s.records.length?`Read ${s.records.length} pallet row${s.records.length===1?'':'s'}`:'No pallet rows found — see the tips below');
    }catch(e){
      console.error('PAS reader failed',e);
      progress('Couldn\'t read that file: '+e.message);
      el('psResults').innerHTML=`<div class="card">Couldn't read that file. ${safe(e.message)}</div>`;
    }finally{ busy=false; el('psDrop').classList.remove('ps-busy'); el('psFile').value=''; el('psPhoto').value=''; }
  }

  // ---------------------------------------------------------------- sheet model
  function strip(canvas,x0,x1,y0,y1,maxH){
    const w=Math.max(1,Math.round(x1-x0)),h=Math.max(1,Math.round(y1-y0));
    const s=Math.min(1,maxH/h);
    const c=makeCanvas(Math.round(w*s),Math.round(h*s));
    c.getContext('2d').drawImage(canvas,x0,y0,w,h,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',0.85);
  }
  function prepSheet(res,fileName,page,pages){
    const pad=res.wordH*0.45;
    const recs=res.records.map(r=>({
      pallet:r.pallet,item:r.item,serial:r.serial,date:r.date,time:r.time,
      flags:r.flags,edited:{},accepted:false,palletInferred:r.palletInferred,
      img:strip(res.canvas,res.table.x0,res.table.x1,Math.max(0,r.band.y0-pad),Math.min(res.canvas.height,r.band.y1+pad),120)
    }));
    const h=res.header;
    return {
      fileName,page,pages,template:res.template,checks:res.checks,angle:res.angle,rawText:res.rawText,
      headerImg:strip(res.canvas,0,res.canvas.width,0,res.headerBottom,420),
      fullImg:null,canvas:res.canvas,
      header:{order:h.order||'',trailer:h.trailer||'',customer:h.customer||'',item:h.itemHeader||'',product:h.product||'',
        lotCode:h.lotCode||'',expected:h.expected||'',dateLoaded:h.dateLoaded||'',carrier:h.carrier||'',dockDoor:h.dockDoor||'',bayLocation:h.bayLocation||'',weight:h.weight||''},
      records:recs
    };
  }
  const S=()=>sheets[cur];
  function openFlags(r){ return r.flags.filter(f=>f.level!=='info'&&!r.edited[f.field]&&!r.accepted); }
  function rowLevel(r){ const f=openFlags(r); return f.some(x=>x.level==='bad')?'bad':f.length?'check':'ok'; }
  function patternOk(v){ const t=S().template; if(!t) return !!v; if(!v||v.length!==t.length) return false; return [...v].every((c,i)=>t.pattern[i]==='?'||(t.pattern[i]==='9'?/[0-9]/.test(c):/[A-Z]/.test(c))); }

  function liveChecks(){
    const s=S(), recs=s.records, exp=+s.header.expected||0, out=[];
    const nums=recs.map(r=>+r.pallet).filter(Boolean);
    const miss=[]; if(exp) for(let i=1;i<=exp;i++) if(!nums.includes(i)) miss.push(i);
    if(exp) out.push(recs.length===exp&&!miss.length?{level:'ok',msg:`All ${exp} pallets found`}:{level:'bad',msg:`Sheet says ${exp} pallets — found ${recs.length}`+(miss.length?` (missing #${miss.join(', #')})`:'')});
    else out.push({level:'check',msg:'Enter the pallet count from the sheet'});
    const dupP=[...new Set(nums.filter((n,i,a)=>a.indexOf(n)!==i))]; if(dupP.length) out.push({level:'bad',msg:'Pallet # listed twice: '+dupP.join(', ')});
    const ser=recs.map(r=>r.serial).filter(Boolean), dupS=[...new Set(ser.filter((x,i,a)=>a.indexOf(x)!==i))];
    out.push(dupS.length?{level:'bad',msg:'Duplicate serial: '+dupS.join(', ')}:{level:'ok',msg:'No duplicate serials'});
    const bad=recs.filter(r=>rowLevel(r)==='bad').length, chk=recs.filter(r=>rowLevel(r)==='check').length;
    if(bad||chk) out.push({level:bad?'bad':'check',msg:`${bad+chk} row${bad+chk===1?'':'s'} to review`});
    else out.push({level:'ok',msg:'Every row confirmed'});
    return out;
  }

  // ---------------------------------------------------------------- render
  const HF=[['order','Order No.'],['trailer','Trailer #'],['item','Item #'],['expected','Pallets on sheet'],['product','Product'],['lotCode','Code'],['customer','Customer'],['dateLoaded','Date Loaded'],['carrier','Carrier'],['dockDoor','Dock Door'],['bayLocation','Bay Location'],['weight','Load Weight']];
  function render(){
    const out=el('psResults'); const s=S(); if(!s){ out.innerHTML=''; return; }
    const tabs=sheets.length>1?`<div class="ff-chips" style="margin-bottom:10px">${sheets.map((x,i)=>`<button type="button" class="ff-chip${i===cur?' active':''}" data-pspage="${i}">Page ${x.page}<span>${x.records.length} rows</span></button>`).join('')}</div>`:'';
    out.innerHTML=`${tabs}
      <div class="card">
        <div class="ps-head-top"><div><h3 style="margin:0">Sheet details</h3><div class="db-sub">${safe(s.fileName)}${s.pages>1?' · page '+s.page:''}${s.angle?` · straightened ${Math.abs(s.angle)}°`:''} · fix anything that doesn't match the paper</div></div></div>
        <div class="ps-fields">${HF.map(([k,l])=>`<label class="ps-field"><span>${l}</span><input data-hf="${k}" value="${safe(s.header[k])}" ${k==='expected'?'inputmode="numeric"':''} /></label>`).join('')}</div>
        <details class="ps-headimg"><summary>Show the sheet's header</summary><img src="${s.headerImg}" alt="Sheet header" /></details>
      </div>
      <div class="card" style="margin-top:10px">
        <div id="psChecks" class="ps-checks"></div>
        <div class="ps-toolbar no-print">
          <label class="mh-remember" style="margin:0"><input type="checkbox" id="psOnly" ${onlyIssues?'checked':''}/> Only rows to review</label>
          <div class="ps-actions">
            <button type="button" id="psXlsx">Download Excel</button>
            <button type="button" id="psCsv" class="ghost">CSV</button>
            <button type="button" id="psCopy" class="ghost">Copy serials</button>
            <button type="button" id="psBarcodes" class="ghost">Print barcodes</button>
          </div>
        </div>
      </div>
      <div class="ps-list" id="psList"></div>
      <details class="card ps-raw" style="margin-top:10px"><summary>Troubleshooting: everything the reader saw</summary><pre>${safe(s.rawText)}</pre></details>`;
    out.querySelectorAll('[data-pspage]').forEach(b=>b.onclick=()=>{ cur=+b.dataset.pspage; render(); });
    out.querySelectorAll('[data-hf]').forEach(i=>i.oninput=()=>{ S().header[i.dataset.hf]=i.value.trim(); renderChecks(); });
    el('psOnly').onchange=e=>{ onlyIssues=e.target.checked; renderList(); };
    el('psXlsx').onclick=()=>exportXlsx(); el('psCsv').onclick=exportCsv; el('psCopy').onclick=copySerials; el('psBarcodes').onclick=printBarcodes;
    renderChecks(); renderList();
  }
  function renderChecks(){
    const box=el('psChecks'); if(!box) return;
    box.innerHTML=liveChecks().map(c=>`<span class="ps-pill ps-${c.level}">${c.level==='ok'?'✓ ':c.level==='bad'?'✕ ':'! '}${safe(c.msg)}</span>`).join('');
  }
  function renderList(){
    const list=el('psList'); const s=S(); if(!list) return;
    if(!s.records.length){ list.innerHTML=`<div class="card" style="margin-top:10px"><b>No pallet rows were found.</b><div class="hint" style="margin-top:6px">Tips: use the original PDF from the scanner if you have it, or take the photo straight on, in good light, with the whole sheet filling the frame. The troubleshooting box below shows what the reader could see.</div></div>`; return; }
    const rows=s.records.map((r,i)=>({r,i})).filter(({r})=>!onlyIssues||rowLevel(r)!=='ok');
    if(!rows.length){ list.innerHTML='<div class="card" style="margin-top:10px">Nothing left to review.</div>'; return; }
    list.innerHTML=`<div class="ps-row ps-row-head"><div>Pallet</div><div>On the sheet</div><div>Serial</div><div>Date</div><div>Time</div><div></div></div>`+rows.map(({r,i})=>rowHtml(r,i)).join('');
    list.querySelectorAll('[data-f]').forEach(inp=>{
      inp.oninput=()=>{ const r=S().records[+inp.dataset.i], f=inp.dataset.f; let v=inp.value; if(f==='serial'){ v=v.toUpperCase().replace(/[^A-Z0-9]/g,''); if(inp.value!==v) inp.value=v; inp.classList.toggle('ps-invalid',!patternOk(v)); }
        r[f]=v.trim(); r.edited[f]=true; refreshRow(+inp.dataset.i); renderChecks(); };
    });
    list.querySelectorAll('[data-zoom]').forEach(im=>im.onclick=()=>{ const row=el('psRow'+im.dataset.zoom); if(row) row.classList.toggle('ps-zoomed'); });
    list.querySelectorAll('[data-accept]').forEach(b=>b.onclick=()=>{ const r=S().records[+b.dataset.accept]; r.accepted=true; refreshRow(+b.dataset.accept); renderChecks(); });
    list.querySelectorAll('[data-alt]').forEach(b=>b.onclick=()=>{ const [i,f]=b.dataset.alt.split(':'); const r=S().records[+i]; const fl=r.flags.find(x=>x.field===f&&x.alt); if(!fl) return; const old=r[f]; r[f]=fl.alt; fl.alt=old; r.edited[f]=true; const inp=list.querySelector(`[data-f="${f}"][data-i="${i}"]`); if(inp) inp.value=r[f]; refreshRow(+i); renderChecks(); });
  }
  function rowHtml(r,i){
    const lvl=rowLevel(r), open=openFlags(r), infos=r.flags.filter(f=>f.level==='info');
    const cls=f=>open.some(x=>x.field===f)?(open.some(x=>x.field===f&&x.level==='bad')?' ps-cell-bad':' ps-cell-check'):'';
    const notes=[...open.map(f=>`<div class="ps-note ps-note-${f.level}">${safe(f.msg)}${f.alt?` <button type="button" class="mh-link" data-alt="${i}:${f.field}">Use ${safe(f.alt)}</button>`:''}</div>`),
                 ...infos.map(f=>`<div class="ps-note ps-note-info">${safe(f.msg)}</div>`)].join('');
    return `<div class="ps-row ps-${lvl}" id="psRow${i}">
      <div class="ps-pallet"><span class="ps-num">${safe(r.pallet)}</span><span class="ps-status ps-status-${lvl}" title="${lvl==='ok'?'Confirmed':lvl==='bad'?'Needs fixing':'Check this row'}">${lvl==='ok'?'✓':lvl==='bad'?'✕':'!'}</span></div>
      <div class="ps-img" title="Tap to enlarge"><img src="${r.img}" alt="Pallet ${safe(r.pallet)} as scanned" loading="lazy" data-zoom="${i}" /></div>
      <div><input class="ps-serial${cls('serial')}${patternOk(r.serial)?'':' ps-invalid'}" data-f="serial" data-i="${i}" value="${safe(r.serial)}" spellcheck="false" autocomplete="off" aria-label="Serial for pallet ${safe(r.pallet)}" /></div>
      <div><input class="ps-small${cls('date')}" data-f="date" data-i="${i}" value="${safe(r.date)}" aria-label="Date" /></div>
      <div><input class="ps-small${cls('time')}" data-f="time" data-i="${i}" value="${safe(r.time)}" aria-label="Time" /></div>
      <div class="ps-row-act">${lvl!=='ok'?`<button type="button" class="ghost ps-ok-btn" data-accept="${i}">Looks right</button>`:''}</div>
      ${notes?`<div class="ps-notes">${notes}</div>`:''}
      <div class="ps-bigimg"><img src="${r.img}" alt="" data-zoom="${i}" /></div>
    </div>`;
  }
  function refreshRow(i){
    const old=el('psRow'+i); if(!old) return;
    const focusF=document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.i==String(i)?document.activeElement.dataset.f:null;
    const pos=focusF?document.activeElement.selectionStart:null;
    renderList();
    if(focusF){ const inp=document.querySelector(`[data-f="${focusF}"][data-i="${i}"]`); if(inp){ inp.focus(); try{ inp.setSelectionRange(pos,pos); }catch{} } }
  }

  // ---------------------------------------------------------------- output
  function unresolved(){ return S().records.filter(r=>rowLevel(r)!=='ok').length; }
  function okToExport(){ const n=unresolved(); return !n||confirm(`${n} row${n===1?' is':'s are'} still marked to review. Export anyway?`); }
  function exportRows(){
    const h=S().header;
    return S().records.map(r=>({'Order No.':h.order,'Trailer':h.trailer,'Customer':h.customer,'Item':r.item||h.item,'Product':h.product,'Code':h.lotCode,
      'Pallet':r.pallet?+r.pallet:'','Serial':r.serial,'Date':r.date,'Time':r.time,'Status':rowLevel(r)==='ok'?(Object.keys(r.edited).length?'Corrected':'Confirmed'):'Review'}));
  }
  function fileBase(){ const h=S().header; return 'PAS_'+((h.order||'sheet').replace(/[^A-Za-z0-9]+/g,'_'))+(h.trailer?'_TR'+h.trailer.replace(/[^A-Za-z0-9]+/g,''):''); }
  async function exportXlsx(){
    if(!okToExport()) return;
    try{ await loadScript(XLSXJS); }catch(e){ LWHUI.toast('Excel download needs internet — using CSV instead'); exportCsv(true); return; }
    const ws=XLSX.utils.json_to_sheet(exportRows());
    ws['!cols']=[{wch:14},{wch:10},{wch:28},{wch:10},{wch:24},{wch:12},{wch:7},{wch:20},{wch:10},{wch:10},{wch:10}];
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'PAS Data');
    XLSX.writeFile(wb,fileBase()+'.xlsx');
  }
  function exportCsv(skipConfirm){
    if(skipConfirm!==true&&!okToExport()) return;
    const rows=exportRows(), heads=Object.keys(rows[0]||{});
    const esc=v=>{ const s=String(v??''); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
    const blob=new Blob([[heads.join(','),...rows.map(r=>heads.map(h=>esc(r[h])).join(','))].join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=fileBase()+'.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  async function copySerials(){
    const txt=S().records.map(r=>r.serial).filter(Boolean).join('\n');
    try{ await navigator.clipboard.writeText(txt); LWHUI.toast(`Copied ${S().records.length} serials`); }
    catch{ const t=document.createElement('textarea'); t.value=txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); LWHUI.toast('Serials copied'); }
  }
  function printBarcodes(){
    if(!okToExport()) return;
    if(!window.JsBarcode){ alert('The barcode library didn\'t load — check your internet connection.'); return; }
    const s=S(), h=s.header, out=el('psPrintArea');
    // One row per pallet: serial · date · time, each its own Code 128 barcode,
    // left to right in the order they're keyed into the WMS.
    out.innerHTML=`<div class="ps-bc-page">
      <div class="ps-bc-head"><div><b>PAS Barcodes</b> — Order ${safe(h.order)} · Trailer ${safe(h.trailer)}</div><div>${safe(h.product)} · Item ${safe(h.item)} · ${s.records.length} pallets</div></div>
      <div class="ps-bc-row ps-bc-cols"><div>Pallet</div><div>Serial</div><div>Date</div><div>Time</div></div>
      ${s.records.map((r,i)=>`<div class="ps-bc-row">
        <div class="ps-bc-p"><b>${safe(r.pallet)}</b></div>
        <div class="ps-bc-code"><svg id="psBcS${i}"></svg><div class="ps-bc-txt">${safe(r.serial)}</div></div>
        <div class="ps-bc-code"><svg id="psBcD${i}"></svg><div class="ps-bc-txt">${safe(r.date)}</div></div>
        <div class="ps-bc-code"><svg id="psBcT${i}"></svg><div class="ps-bc-txt">${safe(r.time)}</div></div>
      </div>`).join('')}
    </div>`;
    // Bars are never squeezed to fit (scanners need even bar widths) and each
    // code keeps a blank quiet zone on both sides so neighbours don't run together.
    const draw=(id,val,w)=>{ if(!val) return; try{ JsBarcode('#'+id,val,{format:'CODE128',height:44,width:w,marginTop:0,marginBottom:0,marginLeft:12*w,marginRight:12*w,displayValue:false}); }catch(e){ console.error(e); } };
    s.records.forEach((r,i)=>{ draw('psBcS'+i,r.serial,1.3); draw('psBcD'+i,r.date,1.15); draw('psBcT'+i,r.time,1.15); });
    if(window.LWHLabels&&LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
    setTimeout(()=>print(),150);
  }

  // ---------------------------------------------------------------- wiring
  window.addEventListener('load',()=>{
    const drop=el('psDrop'); if(!drop) return;
    el('psPick').onclick=()=>el('psFile').click();
    el('psCamera').onclick=()=>el('psPhoto').click();
    el('psFile').onchange=e=>handleFile(e.target.files[0]);
    el('psPhoto').onchange=e=>handleFile(e.target.files[0]);
    ['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{ e.preventDefault(); drop.classList.add('ps-drag'); }));
    ['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{ e.preventDefault(); drop.classList.remove('ps-drag'); }));
    drop.addEventListener('drop',e=>handleFile(e.dataTransfer.files[0]));
  });
})();
