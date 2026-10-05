(function(){
  // ONE SOURCE INBOUND — receive One Source trailers while the WMS/network is down.
  //  • Load info once (Load/BOL, carrier, item, bin class), then Pallet ID -> PGID -> QTY per pallet.
  //  • Checks: duplicate Pallet ID (this load or any load from any synced device), PGID equal to
  //    the Pallet ID, QTY must be a whole number 1-9999 (catches a wrong label scanned into QTY).
  //  • Local-first: every scan saves on this device (IndexedDB + localStorage mirror) before anything
  //    else. With a sync code, changes push to Supabase (os_inbound_sync) and other devices' loads
  //    pull down. Merge-safe: pallets upsert by load + Pallet ID, removals are soft deletes.
  //  • Scan sheet: one page per load, Code 128 barcode for every Pallet ID, PGID, QTY, "In WMS" box.
  //  • Shares its storage with the standalone LWH-OneSource-Inbound app (same site), so loads scanned
  //    there show up here on the same device.
  const SB_URL='https://tjivcqxnkftujceumdtx.supabase.co';
  const SB_KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';   // public key; the sync code gates access
  const DB_NAME='lwh-os-inbound', STORE='loads';
  const LS_KEY='lwh-os-inbound-mirror', SET_KEY='lwh-os-inbound-settings', KB_KEY='osiHideKb';
  const QTY_MAX=9999, SYNC_EVERY_MS=20000;

  let loads=[], current=null, editingId=null, step='pallet', pending={palletId:'',pgid:''}, lastAddedTs=null, screen='list';
  let settings=loadSettings();
  const sync={busy:false,timer:null,lastOk:null,error:null};
  let audio=null, ready=false;

  const el=id=>document.getElementById(id);
  const safe=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  // Scanner AIM prefixes (]C1 ...) and hidden control characters (GS, CR, LF) are stripped
  const clean=v=>String(v||'').replace(/^\][A-Za-z][0-9]/,'').replace(/[\x00-\x1F\x7F]/g,'').trim();
  const norm=v=>clean(v).toUpperCase();
  const uid=()=>{ try{ return crypto.randomUUID(); }catch{ return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2); } };
  const totalQty=L=>L.pallets.reduce((a,p)=>a+(Number(p.qty)||0),0);
  const fmtTime=iso=>{ const d=new Date(iso); return isNaN(d)?'':d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); };
  const fmtDate=iso=>{ const d=new Date(iso); return isNaN(d)?'':d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); };
  const fmtDT=iso=>fmtDate(iso)+' '+fmtTime(iso);
  const live=()=>loads.filter(l=>!l.deleted);
  const pendingCount=l=>(l._headDirty?1:0)+l._dirtyKeys.length+l._removedKeys.length;
  const addKey=(a,k)=>{ if(!a.includes(k)) a.push(k); };
  const dropKey=(a,k)=>{ const i=a.indexOf(k); if(i>=0) a.splice(i,1); };
  const userName=()=>(LWHStorage.get('userName','')||'').trim();
  const toast=m=>{ if(window.LWHUI&&LWHUI.toast) LWHUI.toast(m); };

  // ---------------------------------------------------------------- settings
  function loadSettings(){
    let s={}; try{ s=JSON.parse(localStorage.getItem(SET_KEY)||'{}'); }catch{}
    return Object.assign({code:'',since:null,device:''},s);
  }
  function saveSettings(){ try{ localStorage.setItem(SET_KEY,JSON.stringify(settings)); }catch{} }
  function deviceName(){
    if(settings.device) return settings.device;
    return userName()||('Device '+Math.random().toString(36).slice(2,6).toUpperCase());
  }

  // ---------------------------------------------------------------- storage
  let dbp=null;
  function openDB(){
    if(dbp) return dbp;
    dbp=new Promise((ok,no)=>{
      if(!('indexedDB' in window)) return no(new Error('IndexedDB not available'));
      const r=indexedDB.open(DB_NAME,1);
      r.onupgradeneeded=()=>{ const db=r.result; if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'id'}); };
      r.onsuccess=()=>ok(r.result); r.onerror=()=>no(r.error);
    });
    return dbp;
  }
  async function idbAll(){ const db=await openDB(); return new Promise((ok,no)=>{ const r=db.transaction(STORE,'readonly').objectStore(STORE).getAll(); r.onsuccess=()=>ok(r.result||[]); r.onerror=()=>no(r.error); }); }
  async function idbPut(L){ const db=await openDB(); return new Promise((ok,no)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(L); tx.oncomplete=ok; tx.onerror=()=>no(tx.error); }); }
  async function idbDel(id){ const db=await openDB(); return new Promise((ok,no)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete=ok; tx.onerror=()=>no(tx.error); }); }
  function mirror(){ try{ localStorage.setItem(LS_KEY,JSON.stringify(loads)); }catch{} }
  async function persist(L){ mirror(); try{ await idbPut(L); }catch(e){ console.error(e); flash('bad','Could not save to this device\'s storage. Make a backup file now.'); } }
  async function saveLoad(L){ L.updatedAt=new Date().toISOString(); await persist(L); scheduleSync(1200); }
  async function dropLocal(id){ loads=loads.filter(l=>l.id!==id); mirror(); try{ await idbDel(id); }catch(e){ console.error(e); } }
  async function loadAll(){
    let a=[], b=[];
    try{ a=await idbAll(); }catch(e){ console.warn(e); }
    try{ b=JSON.parse(localStorage.getItem(LS_KEY)||'[]'); }catch{}
    const map=new Map();
    [...b,...a].forEach(l=>{ const ex=map.get(l.id); if(!ex||(l.updatedAt||'')>=(ex.updatedAt||'')) map.set(l.id,l); });
    loads=[...map.values()];
    loads.forEach(l=>{
      if(!l._syncInit){ l._syncInit=true; l._headDirty=true; l._dirtyKeys=l.pallets.map(p=>norm(p.palletId)); l._removedKeys=[]; }
      l._dirtyKeys=l._dirtyKeys||[]; l._removedKeys=l._removedKeys||[];
    });
    for(const l of loads){ try{ await idbPut(l); }catch{} }
    mirror();
  }

  // ---------------------------------------------------------------- feedback
  function tone(kind){
    try{
      audio=audio||new (window.AudioContext||window.webkitAudioContext)();
      const play=(f,t0,dur)=>{ const o=audio.createOscillator(),g=audio.createGain(); o.frequency.value=f; o.type='square'; g.gain.setValueAtTime(0.08,audio.currentTime+t0); g.gain.exponentialRampToValueAtTime(0.0001,audio.currentTime+t0+dur); o.connect(g).connect(audio.destination); o.start(audio.currentTime+t0); o.stop(audio.currentTime+t0+dur); };
      if(kind==='ok') play(1760,0,0.09); else { play(220,0,0.16); play(180,0.2,0.22); }
    }catch{}
    try{ navigator.vibrate&&navigator.vibrate(kind==='ok'?60:[200,80,200]); }catch{}
  }
  function flash(kind,msg){
    const f=el('osiFlash'); if(!f) return;
    f.className='ls-flash ls-flash-'+kind; f.textContent=msg;
    clearTimeout(flash.t);
    if(kind!=='bad') flash.t=setTimeout(()=>{ if(f.textContent===msg) f.className='ls-flash'; },6000);
  }

  // ---------------------------------------------------------------- screens
  function show(which){
    screen=which;
    el('osiListScreen').hidden=which!=='list';
    el('osiForm').hidden=which!=='form';
    el('osiEditor').hidden=which!=='editor';
    window.scrollTo(0,0);
  }
  function renderList(){
    const sorted=live().sort((a,b)=>a.status!==b.status?(a.status==='open'?-1:1):(b.createdAt||'').localeCompare(a.createdAt||''));
    el('osiLoadList').innerHTML=!sorted.length
      ?'<div class="hint">No loads yet. Tap <b>+ New load</b> when a One Source trailer is ready to unload.</div>'
      :sorted.map(l=>{
        const wait=pendingCount(l)?' <span class="ob-unsaved">· waiting to sync</span>':'';
        const from=l.device&&l.device!==deviceName()?' · from '+safe(l.device):'';
        return `<button type="button" class="ob-load-row ob-st-${l.status==='closed'?'closed':'open'}" data-osi-open="${safe(l.id)}">
          <div><div><b style="font-size:18px">${safe(l.loadNo)}</b> <span class="ob-pill ob-pill-${l.status==='closed'?'closed':'open'}">${l.status==='closed'?'Closed':'Open'}</span></div>
          <div class="hint">${safe(l.carrier)} · Item ${safe(l.itemNo)} · Bin ${safe(l.binClass)} · ${safe(fmtDT(l.createdAt))}${from}${wait}</div></div>
          <div class="ob-load-n">${l.pallets.length}<span>pallets · ${totalQty(l)} qty</span></div></button>`;
      }).join('');
    const pallets=live().reduce((a,l)=>a+l.pallets.length,0);
    el('osiStorageInfo').textContent=`${live().length} load(s), ${pallets} pallet(s) on this device.`;
  }
  function openList(){ current=null; renderList(); el('osiCode').value=settings.code; el('osiDevice').value=settings.device||userName(); show('list'); updateSyncUI(); }
  function openForm(L){
    editingId=L?L.id:null;
    el('osiFormTitle').textContent=L?'Edit load info':'New load';
    el('osiFormSave').textContent=L?'Save changes':'Save and start scanning';
    el('osiFLoad').value=L?L.loadNo:''; el('osiFCarrier').value=L?L.carrier:''; el('osiFItem').value=L?L.itemNo:''; el('osiFBin').value=L?L.binClass:'';
    el('osiFormMsg').hidden=true;
    show('form'); setTimeout(()=>el('osiFLoad').focus(),60);
  }
  function openEditor(L){
    current=L; resetPending(); renderEditor(); show('editor');
    flash('','');
    if(L.status==='open') setTimeout(()=>el('osiInPallet').focus(),80);
  }
  function renderEditor(){
    const L=current, closed=L.status==='closed';
    el('osiTitle').textContent=L.loadNo;
    el('osiStatus').className='ob-pill ob-pill-'+(closed?'closed':'open'); el('osiStatus').textContent=closed?'Closed':'Open';
    el('osiTitleSub').textContent=`${L.carrier} · Item ${L.itemNo} · Bin class ${L.binClass} · ${fmtDT(L.createdAt)}`;
    el('osiCount').textContent=L.pallets.length; el('osiQty').textContent=totalQty(L);
    el('osiClosedNote').hidden=!closed; el('osiScanCard').hidden=closed;
    el('osiClose').textContent=closed?'Reopen load':'Close load';
    const n=L.pallets.length;
    el('osiList').innerHTML=!n?'<div class="hint" style="padding:14px 16px">No pallets yet. Scan the first Pallet ID.</div>'
      :`<table class="osi-tbl"><thead><tr><th>#</th><th>Pallet ID</th><th>PGID</th><th class="osi-num">QTY</th><th class="osi-time">Time</th><th></th></tr></thead><tbody>${
        L.pallets.slice().reverse().map((p,i)=>`<tr class="${p.scannedAt===lastAddedTs?'osi-fresh':''}"><td>${n-i}</td><td class="osi-mono">${safe(p.palletId)}</td><td class="osi-mono">${safe(p.pgid)}</td><td class="osi-num"><b>${safe(p.qty)}</b></td><td class="osi-time">${safe(fmtTime(p.scannedAt))}</td><td>${closed?'':`<button type="button" class="mh-link ob-danger-link osi-rm" data-osi-rm="${safe(p.palletId)}">Remove</button>`}</td></tr>`).join('')
      }</tbody></table>`;
    setStepUI();
  }

  // ---------------------------------------------------------------- scan loop
  function resetPending(){ pending={palletId:'',pgid:''}; ['osiInPallet','osiInPgid','osiInQty'].forEach(id=>el(id).value=''); step='pallet'; setStepUI(); }
  function setStepUI(){
    const order=['pallet','pgid','qty'];
    document.querySelectorAll('#osInbound .osi-step').forEach(f=>{ const s=f.dataset.step; f.classList.toggle('active',s===step); f.classList.toggle('done',order.indexOf(s)<order.indexOf(step)); });
  }
  function goStep(s){ step=s; setStepUI(); ({pallet:el('osiInPallet'),pgid:el('osiInPgid'),qty:el('osiInQty')})[s].focus(); }
  function findElsewhere(pid){ const k=norm(pid); return live().find(l=>(!current||l.id!==current.id)&&l.pallets.some(p=>norm(p.palletId)===k)); }

  function handlePallet(){
    const v=clean(el('osiInPallet').value); el('osiInPallet').value=v; if(!v) return;
    if(current.pallets.some(p=>norm(p.palletId)===norm(v))){ tone('bad'); flash('bad',`Pallet ID ${v} is already on this load — not added. Scan the next pallet.`); el('osiInPallet').value=''; return goStep('pallet'); }
    const other=findElsewhere(v);
    if(other){ tone('bad'); flash('bad',`Pallet ID ${v} was already scanned on load ${other.loadNo} — not added. Check the label.`); el('osiInPallet').value=''; return goStep('pallet'); }
    pending.palletId=v; flash('','Now scan the PGID.'); goStep('pgid');
  }
  function handlePgid(){
    const v=clean(el('osiInPgid').value); el('osiInPgid').value=v; if(!v) return;
    if(norm(v)===norm(pending.palletId)){ tone('bad'); flash('bad','That matches the Pallet ID. Scan the PGID barcode.'); el('osiInPgid').value=''; return goStep('pgid'); }
    pending.pgid=v; flash('','Now scan the QTY.'); goStep('qty');
  }
  async function handleQty(){
    const v=clean(el('osiInQty').value); el('osiInQty').value=v; if(!v) return;
    if(!/^\d+$/.test(v)||+v<1||+v>QTY_MAX){ tone('bad'); flash('bad',`QTY must be a whole number from 1 to ${QTY_MAX}. "${v}" looks like a different barcode — scan the QTY again.`); el('osiInQty').value=''; return goStep('qty'); }
    if(!pending.palletId||!pending.pgid){ resetPending(); return goStep('pallet'); }
    const p={palletId:pending.palletId,pgid:pending.pgid,qty:+v,scannedAt:new Date().toISOString(),device:deviceName()};
    const L=current;
    L.pallets.push(p);
    const k=norm(p.palletId); addKey(L._dirtyKeys,k); dropKey(L._removedKeys,k);
    lastAddedTs=p.scannedAt;
    // Screen first so a fast next scan can't land in the wrong field, then storage
    tone('ok'); resetPending(); renderEditor();
    flash('ok',`Saved pallet ${L.pallets.length}: ${p.palletId}, qty ${p.qty}. Scan the next Pallet ID.`);
    goStep('pallet');
    await saveLoad(L);
  }
  function bindScan(id,handler,s){
    const inp=el(id);
    inp.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key==='Tab'){ if(e.key==='Tab'&&e.shiftKey) return; e.preventDefault(); handler(); }
    });
    inp.addEventListener('focus',()=>{
      if((s==='pgid'||s==='qty')&&!pending.palletId) return goStep('pallet');
      if(s==='qty'&&!pending.pgid) return goStep('pgid');
      step=s; setStepUI();
    });
  }

  // ---------------------------------------------------------------- form
  async function submitForm(){
    const vals={loadNo:clean(el('osiFLoad').value),carrier:clean(el('osiFCarrier').value),itemNo:clean(el('osiFItem').value),binClass:clean(el('osiFBin').value)};
    const missing=[['loadNo','Load # or BOL','osiFLoad'],['carrier','Carrier name','osiFCarrier'],['itemNo','Item number','osiFItem'],['binClass','Bin class','osiFBin']].find(([k])=>!vals[k]);
    if(missing){ el('osiFormMsg').hidden=false; el('osiFormMsg').textContent=missing[1]+' is required.'; el(missing[2]).focus(); return; }
    const dupe=live().find(l=>l.id!==editingId&&norm(l.loadNo)===norm(vals.loadNo));
    if(dupe&&!confirm(`Load ${dupe.loadNo} already exists${dupe.device&&dupe.device!==deviceName()?' (started on '+dupe.device+')':''}. Create another load with the same number anyway?\n\nTap Cancel to open the existing load instead.`)) return openEditor(dupe);
    if(editingId){
      const L=loads.find(x=>x.id===editingId); Object.assign(L,vals); L._headDirty=true; await saveLoad(L); openEditor(L);
    }else{
      const L={id:uid(),...vals,status:'open',createdAt:new Date().toISOString(),updatedAt:'',pallets:[],device:deviceName(),appVersion:'toolkit',_syncInit:true,_headDirty:true,_dirtyKeys:[],_removedKeys:[]};
      loads.push(L); await saveLoad(L); openEditor(L);
    }
  }

  // ---------------------------------------------------------------- print / export
  function bcSvg(value,opts){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    try{ JsBarcode(svg,value,Object.assign({format:'CODE128',width:1.6,height:44,displayValue:true,fontSize:14,textMargin:2,margin:4,marginLeft:20,marginRight:20,font:'Arial'},opts||{})); return svg.outerHTML; }
    catch(e){ return `<b>${safe(value)}</b> (barcode could not be drawn)`; }
  }
  function printLoad(L){
    if(!L.pallets.length&&!confirm('This load has no pallets yet. Print anyway?')) return;
    if(!window.JsBarcode){ alert('The barcode library did not load. Close and reopen the app once while it has signal.'); return; }
    const rows=L.pallets.map((p,i)=>`<tr><td class="osi-p-n">${i+1}</td><td class="osi-p-bc">${bcSvg(p.palletId)}</td><td>${safe(p.pgid)}</td><td class="osi-p-q">${safe(p.qty)}</td><td><span class="osi-p-box"></span></td></tr>`).join('');
    el('osiPrintArea').innerHTML=`<div class="osi-p-page">
      <div class="osi-p-head">
        <div class="osi-p-title"><b>One Source inbound scan sheet</b><span>Logistics Warehouse, Inc.</span></div>
        <div class="osi-p-grid">
          <div><span>Load / BOL</span><b>${safe(L.loadNo)}</b></div><div><span>Carrier</span><b>${safe(L.carrier)}</b></div>
          <div><span>Item number</span><b>${safe(L.itemNo)}</b></div><div><span>Bin class</span><b>${safe(L.binClass)}</b></div>
          <div><span>Received</span><b>${safe(fmtDT(L.createdAt))}</b></div><div><span>Pallets</span><b>${L.pallets.length}</b></div>
          <div><span>Total qty</span><b>${totalQty(L)}</b></div><div><span>Printed</span><b>${safe(fmtDT(new Date().toISOString()))}</b></div>
        </div>
        <div class="osi-p-loadbc">${bcSvg(L.loadNo,{height:34,fontSize:12})}</div>
      </div>
      <table class="osi-p-tbl"><thead><tr><th>#</th><th>Pallet ID (scan into WMS)</th><th>PGID</th><th class="osi-p-q">QTY</th><th>In WMS</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="5">No pallets scanned.</td></tr>'}</tbody></table>
      <div class="osi-p-foot"><div>Unloaded by</div><div>Date</div><div>Entered in WMS by</div><div>Date</div></div>
    </div>`;
    if(window.LWHLabels&&LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
    setTimeout(()=>print(),200);
  }
  function download(name,text,type){
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }
  const csvCell=v=>{ const s=String(v??''); return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  function toCsv(list){
    const out=['Load_BOL,Carrier,Item_Number,Bin_Class,Pallet_ID,PGID,QTY,Scanned_At,Scanned_On_Device,Load_Created,Load_Status'];
    list.forEach(l=>l.pallets.forEach(p=>out.push([l.loadNo,l.carrier,l.itemNo,l.binClass,p.palletId,p.pgid,p.qty,p.scannedAt,p.device||'',l.createdAt,l.status].map(csvCell).join(','))));
    return out.join('\r\n');
  }
  const stamp=()=>new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
  const fileSafe=s=>String(s).replace(/[^A-Za-z0-9_-]+/g,'_').slice(0,40);
  async function restoreFile(file){
    let data; try{ data=JSON.parse(await file.text()); }catch{ return alert('That file is not a valid backup.'); }
    const inc=Array.isArray(data)?data:data.loads;
    if(!Array.isArray(inc)) return alert('That file is not a One Source Inbound backup.');
    let added=0, merged=0, pAdded=0;
    for(const x of inc){
      if(!x||!x.id||!Array.isArray(x.pallets)||x.deleted) continue;
      const ex=loads.find(l=>l.id===x.id);
      if(!ex){ Object.assign(x,{_syncInit:true,_headDirty:true,_dirtyKeys:x.pallets.map(p=>norm(p.palletId)),_removedKeys:[]}); loads.push(x); await saveLoad(x); added++; pAdded+=x.pallets.length; continue; }
      const have=new Set(ex.pallets.map(p=>norm(p.palletId)));
      const extra=x.pallets.filter(p=>!have.has(norm(p.palletId)));
      if(extra.length){ ex.pallets.push(...extra); extra.forEach(p=>{ const k=norm(p.palletId); addKey(ex._dirtyKeys,k); dropKey(ex._removedKeys,k); }); ex.pallets.sort((a,b)=>(a.scannedAt||'').localeCompare(b.scannedAt||'')); pAdded+=extra.length; merged++; await saveLoad(ex); }
    }
    alert(`Restore complete: ${added} new load(s), ${merged} load(s) merged, ${pAdded} pallet(s) added.`);
    openList();
  }

  // ---------------------------------------------------------------- sync
  function scheduleSync(ms){ clearTimeout(sync.timer); sync.timer=setTimeout(syncNow,ms==null?1200:ms); updateSyncUI(); }
  function buildPayload(){
    const dirty=loads.filter(l=>pendingCount(l)>0).slice(0,40), snap=new Map();
    const payload=dirty.map(l=>{
      const keys=new Set(l._dirtyKeys);
      snap.set(l.id,{head:!!l._headDirty,updatedAt:l.updatedAt,keys:[...l._dirtyKeys],removed:[...l._removedKeys]});
      return {id:l.id,load_no:l.loadNo,carrier:l.carrier,item_no:l.itemNo,bin_class:l.binClass,status:l.status,deleted:!!l.deleted,
        created_at:l.createdAt,updated_at:l.updatedAt,device:l.device||deviceName(),head_dirty:!!l._headDirty,
        pallets:l.pallets.filter(p=>keys.has(norm(p.palletId))).map(p=>({pallet_id:p.palletId,pgid:p.pgid,qty:p.qty,scanned_at:p.scannedAt,device:p.device||deviceName()})),
        removed:[...l._removedKeys]};
    });
    return {payload,snap};
  }
  async function mergeRemote(r){
    let l=loads.find(x=>x.id===r.id);
    const toLocal=rp=>({palletId:rp.pallet_id,pgid:rp.pgid||'',qty:rp.qty,scannedAt:rp.scanned_at,device:rp.device||''});
    if(!l){
      if(r.deleted) return false;
      l={id:r.id,loadNo:r.load_no,carrier:r.carrier||'',itemNo:r.item_no||'',binClass:r.bin_class||'',status:r.status||'open',createdAt:r.created_at,updatedAt:r.updated_at,device:r.device||'',
        pallets:(r.pallets||[]).filter(p=>!p.deleted).map(toLocal),_syncInit:true,_headDirty:false,_dirtyKeys:[],_removedKeys:[]};
      loads.push(l); await persist(l); return true;
    }
    if(r.deleted&&!l._headDirty){ await dropLocal(l.id); return true; }
    let changed=false;
    if(!l._headDirty){
      const head={loadNo:r.load_no,carrier:r.carrier||'',itemNo:r.item_no||'',binClass:r.bin_class||'',status:r.status||'open'};
      for(const k of Object.keys(head)) if(l[k]!==head[k]){ l[k]=head[k]; changed=true; }
    }
    for(const rp of r.pallets||[]){
      const key=norm(rp.pallet_id), idx=l.pallets.findIndex(p=>norm(p.palletId)===key), dirty=l._dirtyKeys.includes(key);
      if(rp.deleted){ if(idx>=0&&!dirty){ l.pallets.splice(idx,1); changed=true; } }
      else if(idx<0){ if(!l._removedKeys.includes(key)){ l.pallets.push(toLocal(rp)); changed=true; } }
      else if(!dirty){ const p=l.pallets[idx]; if(p.pgid!==(rp.pgid||'')||Number(p.qty)!==Number(rp.qty)){ Object.assign(p,toLocal(rp)); changed=true; } }
    }
    if(changed){ l.pallets.sort((a,b)=>(a.scannedAt||'').localeCompare(b.scannedAt||'')); await persist(l); }
    return changed;
  }
  async function syncNow(){
    clearTimeout(sync.timer);
    if(sync.busy) return;
    if(!settings.code||!navigator.onLine){ updateSyncUI(); return; }
    sync.busy=true; updateSyncUI();
    let again=false;
    try{
      const {payload,snap}=buildPayload();
      const since=settings.since?new Date(Date.parse(settings.since)-120000).toISOString():null;
      const ctrl=new AbortController(), to=setTimeout(()=>ctrl.abort(),25000);
      const res=await fetch(SB_URL+'/rest/v1/rpc/os_inbound_sync',{method:'POST',signal:ctrl.signal,headers:{apikey:SB_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({p_code:settings.code,p_loads:payload,p_since:since,p_device:deviceName()})});
      clearTimeout(to);
      if(!res.ok) throw new Error('HTTP '+res.status);
      const out=await res.json();
      if(!out.ok){
        sync.error=out.error==='bad_code'?'The sync code is wrong. Check it under "Sync between devices".'
          :out.error==='locked'?'Sync is locked for 10 minutes after too many wrong codes.':'Sync was refused ('+out.error+').';
        return;
      }
      for(const [id,s] of snap){
        const l=loads.find(x=>x.id===id); if(!l) continue;
        if(s.head&&l.updatedAt===s.updatedAt) l._headDirty=false;
        s.keys.forEach(k=>dropKey(l._dirtyKeys,k)); s.removed.forEach(k=>dropKey(l._removedKeys,k));
        if(l.deleted&&!l._headDirty) await dropLocal(l.id); else await persist(l);
      }
      let changed=false;
      for(const r of out.loads||[]) if(await mergeRemote(r)) changed=true;
      settings.since=out.server_time; saveSettings();
      sync.error=null; sync.lastOk=new Date().toISOString();
      if(changed) refreshAfterSync();
      again=loads.some(l=>pendingCount(l)>0);
    }catch(e){
      sync.error=e.name==='AbortError'?'Sync timed out — it will retry.':'Could not reach the server — it will retry.';
      console.warn('osinbound sync',e);
    }finally{
      sync.busy=false; updateSyncUI();
      if(screen==='list') renderList();
      scheduleSync(again?300:SYNC_EVERY_MS);
    }
  }
  function refreshAfterSync(){
    if(screen!=='editor') return;
    if(current&&!loads.includes(current)){ openList(); alert('This load was deleted on another device.'); return; }
    const p=pending, s=step, vals=[el('osiInPallet').value,el('osiInPgid').value,el('osiInQty').value];
    renderEditor();
    pending=p; step=s; [el('osiInPallet').value,el('osiInPgid').value,el('osiInQty').value]=vals; setStepUI();
  }
  function updateSyncUI(){
    if(!ready) return;
    const waiting=loads.reduce((a,l)=>a+pendingCount(l),0);
    let text, cls;
    if(!settings.code){ text='Sync off — scans are saved on this device only. Add the sync code under "Sync between devices" on the loads list.'; cls='warn'; }
    else if(sync.error&&/code|locked|refused/.test(sync.error)){ text=sync.error; cls='bad'; }
    else if(sync.busy){ text='Syncing…'; cls='idle'; }
    else if(waiting){ text=`${waiting} change(s) waiting to sync`+(navigator.onLine?(sync.error?' — '+sync.error:''):' — no signal; scans are safe on this device'); cls='warn'; }
    else if(sync.lastOk){ text='✓ Synced '+fmtTime(sync.lastOk); cls='ok'; }
    else { text='Not synced yet'; cls='idle'; }
    ['osiListSync','osiSync'].forEach(id=>{ const b=el(id); if(b){ b.textContent=text; b.className='ls-sync ls-sync-'+cls; } });
    const st=el('osiSyncStatus'); if(st) st.textContent=settings.code?(sync.lastOk?'Last synced '+fmtTime(sync.lastOk)+'. ':'')+(waiting?waiting+' change(s) waiting.':'Nothing waiting to upload.'):'Enter the sync code to share loads between devices.';
  }

  // ---------------------------------------------------------------- wiring
  window.addEventListener('load',async()=>{
    if(!el('osInbound')) return;
    bindScan('osiInPallet',handlePallet,'pallet'); bindScan('osiInPgid',handlePgid,'pgid'); bindScan('osiInQty',handleQty,'qty');
    const hide=LWHStorage.get(KB_KEY,false); el('osiHideKb').checked=hide;
    const setKb=h=>['osiInPallet','osiInPgid'].forEach(id=>el(id).setAttribute('inputmode',h?'none':'text'));
    setKb(hide); el('osiInQty').setAttribute('inputmode',hide?'none':'numeric');
    el('osiHideKb').onchange=e=>{ LWHStorage.set(KB_KEY,e.target.checked); setKb(e.target.checked); el('osiInQty').setAttribute('inputmode',e.target.checked?'none':'numeric'); goStep(step); };
    [['osiFLoad','osiFCarrier'],['osiFCarrier','osiFItem'],['osiFItem','osiFBin']].forEach(([a,b])=>el(a).addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); el(b).focus(); } }));
    el('osiFBin').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); submitForm(); } });
    el('osiNew').onclick=()=>openForm(null);
    el('osiFormSave').onclick=submitForm;
    el('osiFormCancel').onclick=()=>editingId&&current?openEditor(current):openList();
    el('osiBack').onclick=openList;
    el('osiLoadList').addEventListener('click',e=>{ const b=e.target.closest('[data-osi-open]'); if(!b) return; const L=loads.find(x=>x.id===b.dataset.osiOpen); if(L) openEditor(L); });
    el('osiClearRow').onclick=()=>{ resetPending(); flash('','Cleared. Scan the Pallet ID.'); goStep('pallet'); };
    el('osiEdit').onclick=()=>openForm(current);
    el('osiList').addEventListener('click',async e=>{
      const b=e.target.closest('[data-osi-rm]'); if(!b) return;
      const pid=b.dataset.osiRm; if(!confirm(`Remove pallet ${pid} from this load?`)) return;
      const k=norm(pid); current.pallets=current.pallets.filter(p=>norm(p.palletId)!==k);
      dropKey(current._dirtyKeys,k); addKey(current._removedKeys,k);
      await saveLoad(current); renderEditor(); flash('warn',`Removed pallet ${pid}.`); goStep('pallet');
    });
    el('osiPrint').onclick=()=>printLoad(current);
    el('osiCsv').onclick=()=>download(`OneSource_${fileSafe(current.loadNo)}_${stamp()}.csv`,toCsv([current]),'text/csv');
    el('osiClose').onclick=async()=>{
      if(current.status==='open'){ if(!confirm(`Close load ${current.loadNo} with ${current.pallets.length} pallets and ${totalQty(current)} total qty?`)) return; current.status='closed'; }
      else current.status='open';
      current._headDirty=true; await saveLoad(current); resetPending(); renderEditor();
      if(current.status==='open'){ flash('','Load reopened. Scan the Pallet ID.'); goStep('pallet'); } else toast('Load closed');
    };
    el('osiDelete').onclick=async()=>{
      const typed=prompt(`This deletes load ${current.loadNo} and its ${current.pallets.length} pallets${settings.code?' from every synced device':' from this device'}.\n\nType the load number to confirm:`);
      if(typed==null) return;
      if(norm(typed)!==norm(current.loadNo)) return alert('Load number did not match. Nothing was deleted.');
      current.deleted=true; current._headDirty=true; await saveLoad(current); openList(); toast('Load deleted');
    };
    el('osiExportAll').onclick=()=>{ if(!live().length) return alert('There are no loads to export yet.'); download(`OneSource_AllLoads_${stamp()}.csv`,toCsv(live()),'text/csv'); };
    el('osiBackup').onclick=()=>download(`OneSource_Inbound_Backup_${stamp()}.json`,JSON.stringify({app:'lwh-os-inbound',source:'toolkit',exportedAt:new Date().toISOString(),loads:live()},null,1),'application/json');
    el('osiRestoreBtn').onclick=()=>el('osiRestore').click();
    el('osiRestore').onchange=async()=>{ const f=el('osiRestore').files[0]; el('osiRestore').value=''; if(f) await restoreFile(f); };
    el('osiSaveSync').onclick=()=>{
      const code=clean(el('osiCode').value), dev=clean(el('osiDevice').value);
      if(code!==settings.code){ settings.since=null; sync.error=null; }
      settings.code=code; settings.device=dev.slice(0,60); saveSettings(); updateSyncUI(); syncNow(); toast('Sync settings saved');
    };
    el('osiSyncNow').onclick=()=>syncNow();
    // Camera: the shared scanner modal reads one barcode into the field that's up next
    document.querySelectorAll('#osInbound [data-osi-cam]').forEach(b=>b.addEventListener('click',()=>{
      const t=b.dataset.osiCam;
      if(t==='osiInPgid'&&!pending.palletId) return goStep('pallet');
      if(t==='osiInQty'&&!pending.pgid) return goStep(pending.palletId?'pgid':'pallet');
      if(!window.LWHScanner){ alert('The camera scanner is not available.'); return; }
      LWHScanner.start(v=>{ el(t).value=v; ({osiInPallet:handlePallet,osiInPgid:handlePgid,osiInQty:handleQty})[t](); });
    }));
    window.addEventListener('afterprint',()=>{ el('osiPrintArea').innerHTML=''; });
    window.addEventListener('online',()=>scheduleSync(500));
    window.addEventListener('offline',updateSyncUI);
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) scheduleSync(400); });
    // Opening the module from the menu or Home: fresh list, or focus the scan box if a load is open
    document.addEventListener('click',e=>{ const v=e.target.closest('[data-view]'); if(!v||v.dataset.view!=='osInbound') return; setTimeout(()=>{ if(screen==='editor'&&current&&current.status==='open') goStep(step); else if(screen==='list') openList(); },60); });

    if(navigator.storage&&navigator.storage.persist){ try{ await navigator.storage.persist(); }catch{} }
    await loadAll();
    ready=true;
    openList();
    scheduleSync(800);
  });
  window.LWHOsInbound={syncNow:()=>syncNow(),_state:()=>({loads,current,settings})};
})();
