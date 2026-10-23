(function(){
  // BAY SCAN — scan customer pallet tags into a bay.
  //  • Pick the warehouse, pick (or scan) the bay, then scan tags. Each tag's
  //    "current bay" is whatever it was last scanned into.
  //  • Bays are the customer's names (VB220…), created right here. When the
  //    customer gives the same physical space a new name, "New bay name"
  //    retires the old one and keeps its history. Capacity defaults to 240.
  //  • Find tag: current bay, when it was put there, by whom, full history.
  //  • Scans are kept on this device first and sent to Supabase in the
  //    background (sql/bay_scan.sql), so a dead spot in the warehouse doesn't
  //    lose anything — they go up when the signal comes back.
  const SUPABASE_URL='https://tjivcqxnkftujceumdtx.supabase.co';
  const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqaXZjcXhua2Z0dWpjZXVtZHR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTE5NDMsImV4cCI6MjEwMDQ2Nzk0M30.GzDc-_u92jvAHq7eG1X-1cet5Av9qF3ZDEVJMRKEP0E';
  const WAREHOUSES=['WHSE10','WHSE11','WHSE30','WHSE32','WHSE40','WHSE41','WHSE42','WHSE50','WHSE55','WHSE56','WHSE60','WHSE65','WHSE70','WHSE80','WHSE85'];
  const DEFAULT_CAP=240;
  const K={wh:'bayScanWh',bay:'bayScanBay',bays:'bayScanBays_',queue:'bayScanQueue',recent:'bayScanRecent',kb:'bayScanHideKb'};

  const el=id=>document.getElementById(id);
  const safe=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const norm=s=>String(s||'').replace(/\s+/g,'').toUpperCase();
  const me=()=>(LWHStorage.get('userName','')||'').trim();
  function rid(){ try{ return crypto.randomUUID(); }catch{ return Date.now().toString(36)+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2); } }
  function deviceId(){ let d=LWHStorage.get('deviceId',''); if(!d){ d=rid(); LWHStorage.set('deviceId',d); } return d; }
  function deviceLabel(){ const u=navigator.userAgent||''; const k=/Android/i.test(u)?'Android':/iPhone|iPad/i.test(u)?'iPhone/iPad':/Windows/i.test(u)?'Windows':/Mac/i.test(u)?'Mac':'Other'; return k+' · '+deviceId().slice(0,6); }
  function fmtDate(iso){ const d=new Date(iso); return isNaN(d)?'':d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
  function fmtTime(iso){ const d=new Date(iso); return isNaN(d)?'':d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }
  function fmtWhen(iso){ return iso?fmtDate(iso)+' '+fmtTime(iso):''; }
  function daysAgo(iso){ const d=new Date(iso); if(isNaN(d)) return ''; const n=Math.floor((Date.now()-d)/86400000); return n<=0?'today':n===1?'1 day ago':n+' days ago'; }
  function cleanScan(v){ return String(v||'').replace(/^\][A-Za-z][0-9]/,'').replace(/[\x00-\x1F\x7F]/g,'').trim(); }
  const whLabel=w=>String(w||'').replace(/^WHSE/,'Whse');

  // ---------------------------------------------------------------- state
  let wh=LWHStorage.get(K.wh,'')||'';
  let bays=[];               // active + retired bays for this warehouse (from cache / server)
  let bayId=null;            // bay being scanned into
  let tab='scan';
  let cam=null, camFor=null, camLast={v:'',t:0}, audio=null, burst=[];
  let online=true, setupMissing=false;
  let openBayId=null;        // bay detail panel in the Bays tab
  let showRetired=false;

  const queue=()=>LWHStorage.get(K.queue,[])||[];
  const setQueue=q=>LWHStorage.set(K.queue,q);
  const recent=()=>LWHStorage.get(K.recent,[])||[];
  const setRecent=r=>LWHStorage.set(K.recent,r.slice(0,60));
  const bayById=id=>bays.find(b=>b.id===id);
  const activeBays=()=>bays.filter(b=>b.active);
  const curBay=()=>bayById(bayId);

  // ---------------------------------------------------------------- supabase
  async function rpc(fn,body){
    const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`,{method:'POST',headers:{'apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(res.status===404){ setupMissing=true; const e=new Error('not_set_up'); e.setup=true; throw e; }
    if(!res.ok) throw new Error('HTTP '+res.status);
    setupMissing=false;
    return res.json();
  }
  function errText(e,fallback){ return e&&e.setup?'Bay Scan isn\'t set up yet — run sql/bay_scan.sql in Supabase.':navigator.onLine===false?'No signal — try again when you\'re back online.':(fallback||'Couldn\'t reach the server — check your connection.'); }
  const ERR={exists:'That bay name already exists in this warehouse.',no_bay:'That bay wasn\'t found.',bad_warehouse:'Pick a warehouse first.',same_name:'That\'s the same name it already has.',bay_retired:'That bay name has been retired.'};

  // ---------------------------------------------------------------- feedback
  function tone(kind){
    try{
      audio=audio||new (window.AudioContext||window.webkitAudioContext)();
      const play=(f,t0,dur)=>{ const o=audio.createOscillator(),g=audio.createGain(); o.frequency.value=f; o.type='square'; g.gain.setValueAtTime(0.08,audio.currentTime+t0); g.gain.exponentialRampToValueAtTime(0.0001,audio.currentTime+t0+dur); o.connect(g).connect(audio.destination); o.start(audio.currentTime+t0); o.stop(audio.currentTime+t0+dur); };
      if(kind==='ok') play(1760,0,0.09);
      else if(kind==='bay'){ play(1320,0,0.08); play(1760,0.1,0.12); }
      else { play(220,0,0.16); play(180,0.2,0.22); }
    }catch(e){}
    try{ navigator.vibrate&&navigator.vibrate(kind==='ok'?60:kind==='bay'?[60,50,60]:[200,80,200]); }catch(e){}
  }
  function flash(kind,msg){
    const f=el('bsFlash'); if(!f) return;
    f.className='ls-flash ls-flash-'+kind; f.textContent=msg;
    clearTimeout(flash.t); flash.t=setTimeout(()=>{ f.className='ls-flash'; f.textContent=''; },kind==='bad'?4000:2200);
  }
  function showLast(kind,label,v){
    const b=el('bsLast'); if(!b) return;
    b.hidden=false; b.className='ls-last ls-last-'+kind;
    b.innerHTML=`<div class="ls-last-top"><span class="ls-last-lbl">${safe(label)}</span></div><div class="ls-last-v">${safe(v)}</div>`;
    b.classList.remove('ls-last-pop'); void b.offsetWidth; b.classList.add('ls-last-pop');
  }

  // ---------------------------------------------------------------- bays
  function loadCachedBays(){ bays=wh?(LWHStorage.get(K.bays+wh,[])||[]):[]; }
  function saveBays(){ if(wh) LWHStorage.set(K.bays+wh,bays); }
  async function refreshBays(quiet){
    if(!wh) return;
    const w=wh;
    try{
      const r=await rpc('toolkit_bay_list',{p_warehouse:w,p_retired:true});
      if(w!==wh||!r.ok) return;
      bays=r.bays||[];
      // scans not sent yet still count toward the bay on screen
      queue().filter(m=>m.warehouse===w&&m.bay_id).forEach(m=>{ const b=bayById(m.bay_id); if(b) b.count=(b.count||0)+1; });
      saveBays(); online=true;
      if(bayId&&!curBay()?.active){ const b=curBay(); if(b&&b.replaced_by_bay&&!quiet) flash('warn',`${b.bay} was renamed to ${b.replaced_by_bay} — pick the new bay`); bayId=null; LWHStorage.set(K.bay,null); }
    }catch(e){ online=false; if(!quiet) flash('warn',errText(e,'Offline — using the bay list saved on this device.')); }
    renderAll();
  }
  function selectBay(id,announce){
    const b=bayById(id); if(!b||!b.active) return;
    bayId=id; LWHStorage.set(K.bay,{wh,id});
    if(announce){ tone('bay'); flash('ok',`Now scanning into ${b.bay}`); showLast('idle','Scanning into bay',b.bay); }
    renderScan(); focusInput();
  }
  function setWarehouse(w){
    if(w===wh) return;
    wh=w; LWHStorage.set(K.wh,w); bayId=null; openBayId=null;
    const saved=LWHStorage.get(K.bay,null);
    loadCachedBays();
    if(saved&&saved.wh===w&&bayById(saved.id)?.active) bayId=saved.id;
    el('bsBayFilter').value='';
    renderAll(); refreshBays(true);
  }

  // ---------------------------------------------------------------- scanning
  function addScan(raw,source){
    const v=cleanScan(raw); if(!v) return;
    if(!wh){ tone('bad'); flash('bad','Pick the warehouse first'); return; }
    // A bay label scanned? Switch to that bay.
    const asBay=activeBays().find(b=>b.bay===norm(v));
    if(asBay){ selectBay(asBay.id,true); return; }
    const b=curBay();
    if(!b){ tone('bad'); flash('bad',`Pick a bay first (or scan the bay label). "${v}" isn't a bay in ${whLabel(wh)}.`); showLast('bad','Not added — no bay picked',v); return; }
    const tag=norm(v);
    if(tag.length<3){ tone('bad'); flash('bad','That doesn\'t look like a tag'); return; }
    // same tag into the same bay just now? don't double up
    const r=recent(); const prev=r.find(x=>x.tag===tag&&x.state!=='undone');
    if(prev&&prev.bay_id===b.id&&Date.now()-new Date(prev.t)<6*3600e3){ tone('bad'); flash('warn',`Already scanned into ${b.bay} at ${fmtTime(prev.t)} — not added again`); showLast('warn','Already in this bay',tag); return; }
    const m={client_id:rid(),tag,bay_id:b.id,bay:b.bay,warehouse:wh,scanned_at:new Date().toISOString(),scanned_by:me()||null,device:deviceLabel(),src:source||'scanner'};
    setQueue([...queue(),m]);
    r.unshift({client_id:m.client_id,tag,bay_id:b.id,bay:b.bay,warehouse:wh,t:m.scanned_at,state:'pending',prevLocal:prev&&prev.bay_id!==b.id?prev.bay:null});
    setRecent(r);
    b.count=(b.count||0)+1; b.last_at=m.scanned_at;
    if(prev&&prev.bay_id&&prev.bay_id!==b.id){ const pb=bayById(prev.bay_id); if(pb&&pb.count>0) pb.count--; }
    saveBays();
    const cap=b.capacity||DEFAULT_CAP, over=b.count>cap;
    if(over||prev&&prev.bay_id!==b.id){ tone('bad'); } else tone('ok');
    flash(over?'warn':'ok',over?`Added — ${b.bay} is over capacity (${b.count} / ${cap})`:prev&&prev.bay&&prev.bay_id!==b.id?`Moved from ${prev.bay} to ${b.bay} — ${b.count} / ${cap}`:`Added to ${b.bay} — ${b.count} / ${cap}`);
    showLast(over?'warn':'ok',`Added to ${b.bay}`,tag);
    renderScan(); scheduleSync(600);
  }
  function submitInput(){ const inp=el('bsInput'); const v=inp.value; inp.value=''; burst=[]; if(v.trim()) addScan(v,'scanner'); inp.focus(); }
  function focusInput(){ const i=el('bsInput'); if(i&&tab==='scan'&&document.getElementById('bayScan').classList.contains('active')) i.focus(); }

  // Undo the last scan on this device: not sent yet → just drop it;
  // already saved → send it back to the bay it came from (or out of a bay).
  function undoLast(){
    const r=recent(); const x=r.find(s=>s.state!=='undone'&&!s.undo);
    if(!x){ flash('warn','Nothing to undo'); return; }
    if(!confirm(`Undo ${x.tag} → ${x.bay||'out of bay'}?`)) return;
    const q=queue(); const qi=q.findIndex(m=>m.client_id===x.client_id);
    const b=bayById(x.bay_id); if(b&&b.count>0) b.count--;
    if(qi>=0){ q.splice(qi,1); setQueue(q); }
    else{
      const back=x.from_bay_id&&bayById(x.from_bay_id)?.active?x.from_bay_id:null;
      const bb=bayById(back); if(bb) bb.count=(bb.count||0)+1;
      const m={client_id:rid(),tag:x.tag,bay_id:back,bay:bb?bb.bay:null,warehouse:bb?wh:null,scanned_at:new Date().toISOString(),scanned_by:me()||null,device:deviceLabel(),note:'Undo of scan into '+x.bay};
      setQueue([...q,m]);
      r.unshift({client_id:m.client_id,tag:x.tag,bay_id:back,bay:bb?bb.bay:null,warehouse:wh,t:m.scanned_at,state:'pending',undo:true});
      scheduleSync(300);
    }
    x.state='undone'; setRecent(r); saveBays();
    flash('warn',`Undone — ${x.tag}`); renderScan();
  }

  // Take a tag out of its bay (consumed / sent back to the plant)
  function takeOut(tag,fromBay,why){
    const m={client_id:rid(),tag:norm(tag),bay_id:null,bay:null,warehouse:null,scanned_at:new Date().toISOString(),scanned_by:me()||null,device:deviceLabel(),note:why||'Taken out of bay'};
    setQueue([...queue(),m]);
    const r=recent(); r.unshift({client_id:m.client_id,tag:m.tag,bay_id:null,bay:null,warehouse:wh,t:m.scanned_at,state:'pending',out:fromBay||true}); setRecent(r);
    const fb=bays.find(b=>b.bay===fromBay&&b.active); if(fb&&fb.count>0){ fb.count--; saveBays(); }
    scheduleSync(100);
  }

  // ---------------------------------------------------------------- sync
  let syncTimer=null, syncing=false, retryMs=10000;
  function scheduleSync(ms){ clearTimeout(syncTimer); syncTimer=setTimeout(syncNow,ms??1500); renderSync(); }
  async function syncNow(){
    if(syncing) return; const q=queue(); if(!q.length){ renderSync(); return; }
    syncing=true; renderSync();
    const batch=q.slice(0,200);
    try{
      const r=await rpc('toolkit_bay_scan',{p_moves:batch.map(({src,bay,warehouse,...m})=>m)});
      if(!r.ok) throw new Error(r.error||'save failed');
      const done=new Set(), rec=recent(); let touched=false;
      (r.results||[]).forEach(res=>{
        done.add(res.client_id);
        const x=rec.find(s=>s.client_id===res.client_id); if(!x) return;
        if(res.ok){
          x.state=x.state==='undone'?'undone':'saved';
          if(!res.dup){ x.from_bay_id=res.from_bay_id; x.from_bay=res.from_bay; x.from_wh=res.from_warehouse; x.stale=res.stale; x.same=res.same_bay; }
          if(res.bay_id&&res.count!=null){ const b=bayById(res.bay_id); if(b){ b.count=res.count+queue().filter(m=>m.bay_id===b.id&&!done.has(m.client_id)).length; touched=true; } }
          if(res.from_bay_id&&!res.same_bay){ const fb=bayById(res.from_bay_id); if(fb&&!x.prevLocal&&!x.undo&&!x.out&&fb.count>0){ fb.count--; touched=true; } }
        }else{
          x.state='error';
          x.msg=res.error==='bay_retired'?`${res.bay} was renamed${res.replaced_by_bay?' to '+res.replaced_by_bay:''} before this was saved — scan it again into the new bay`:res.error==='no_bay'?'That bay no longer exists — scan it again':'Couldn\'t save ('+res.error+')';
          const b=bayById(x.bay_id); if(b&&b.count>0){ b.count--; touched=true; }
        }
      });
      setQueue(queue().filter(m=>!done.has(m.client_id)));
      setRecent(rec); if(touched) saveBays();
      online=true; retryMs=10000;
      const errs=(r.results||[]).filter(x=>!x.ok).length;
      if(errs){ tone('bad'); flash('bad',`${errs} scan${errs===1?'':'s'} couldn't be saved — see the list below`); }
    }catch(e){
      online=false;
      if(!e.setup){ clearTimeout(syncTimer); syncTimer=setTimeout(syncNow,retryMs); retryMs=Math.min(retryMs*2,120000); }
    }
    syncing=false;
    if(online&&queue().length) return syncNow();
    renderScan();
  }
  function renderSync(){
    const p=el('bsSync'); if(!p) return;
    const n=queue().length;
    let cls,txt;
    if(setupMissing){ cls='bad'; txt='Not set up yet — run sql/bay_scan.sql in Supabase'; }
    else if(syncing){ cls='idle'; txt=`Saving ${n} scan${n===1?'':'s'}…`; }
    else if(n){ cls='warn'; txt=`${n} scan${n===1?'':'s'} waiting to save — ${navigator.onLine===false||!online?'will send when back online':'retrying'}`; }
    else { const r=recent()[0]; cls=r?'ok':'idle'; txt=r?`✓ All scans saved`:'Scans are saved automatically'; }
    p.className='ls-sync ls-sync-'+cls; p.textContent=txt;
  }

  // ---------------------------------------------------------------- camera
  async function startCamera(target){
    if(cam){ const was=camFor; await stopCamera(); if(was===target) return; }
    if(typeof Html5Qrcode==='undefined'){ alert('The camera scanner didn\'t load. A plugged-in or Bluetooth scanner still works.'); return; }
    camFor=target;
    const wrap=el(target==='find'?'bsFindCamWrap':'bsCamWrap'), box=target==='find'?'bsFindCam':'bsCam';
    wrap.hidden=false; el(target==='find'?'bsFindCamBtn':'bsCamBtn').textContent='Stop camera';
    const F=window.Html5QrcodeSupportedFormats;
    const cfg={fps:12,qrbox:(w,h)=>({width:Math.min(w*0.9,420),height:Math.min(h*0.45,180)}),formatsToSupport:F?[F.CODE_128,F.CODE_39,F.ITF,F.EAN_13,F.UPC_A,F.QR_CODE,F.DATA_MATRIX]:undefined};
    cam=new Html5Qrcode(box);
    const onHit=txt=>{
      const v=cleanScan(txt), now=Date.now();
      if(v===camLast.v&&now-camLast.t<2500){ camLast.t=now; return; }
      camLast={v,t:now};
      if(camFor==='find'){ el('bsFindQ').value=v; stopCamera(); findTag(); }
      else addScan(v,'camera');
    };
    try{ await cam.start({facingMode:'environment'},cfg,onHit,()=>{}); }
    catch(e){ alert('Camera error: '+e.message+' — allow camera access, or use a scanner.'); stopCamera(); }
  }
  async function stopCamera(){
    const c=cam; cam=null; camFor=null;
    if(c){ try{ await c.stop(); c.clear(); }catch(e){} }
    ['bsCamWrap','bsFindCamWrap'].forEach(id=>{ const w=el(id); if(w) w.hidden=true; });
    if(el('bsCamBtn')) el('bsCamBtn').textContent='Use camera';
    if(el('bsFindCamBtn')) el('bsFindCamBtn').textContent='Scan with camera';
  }

  // ---------------------------------------------------------------- render: scan tab
  function fillBar(b){
    const cap=b.capacity||DEFAULT_CAP, n=b.count||0, pct=Math.min(100,Math.round(n/cap*100));
    return {cap,n,pct,cls:n>cap?'bs-over':n>=cap?'bs-full':pct>=90?'bs-near':''};
  }
  function renderScan(){
    const b=curBay();
    const panel=el('bsCurrent');
    if(!wh){ panel.innerHTML='<div class="bs-cur-empty">Pick a warehouse to start.</div>'; }
    else if(!b){ panel.innerHTML=`<div class="bs-cur-empty">Pick a bay below — or scan the bay's label.${activeBays().length?'':`<br><b>No bays set up in ${whLabel(wh)} yet.</b> Add them in the <a href="#" data-bs-tab="bays">Bays</a> tab.`}</div>`; }
    else{
      const f=fillBar(b);
      panel.innerHTML=`<div class="bs-cur-lbl">Scanning into · ${safe(whLabel(wh))}</div>
        <div class="bs-cur-bay">${safe(b.bay)}</div>${b.spot?`<div class="bs-cur-spot">${safe(b.spot)}</div>`:''}
        <div class="bs-cur-count ${f.cls}"><b>${f.n}</b> / ${f.cap} pallets${f.n>f.cap?' — over capacity':f.n>=f.cap?' — full':''}</div>
        <div class="bs-bar ${f.cls}"><div style="width:${f.pct}%"></div></div>
        <button type="button" class="mh-link bs-change" id="bsChangeBay">Change bay</button>`;
      el('bsChangeBay').onclick=()=>{ bayId=null; LWHStorage.set(K.bay,null); renderScan(); setTimeout(()=>el('bsBayFilter').focus(),50); };
    }
    panel.querySelectorAll('[data-bs-tab]').forEach(a=>a.onclick=e=>{ e.preventDefault(); setTab(a.dataset.bsTab); });
    el('bsPicker').hidden=!wh||!!b;
    renderPicker();
    el('bsInput').disabled=!wh;
    el('bsNameNote').hidden=!!me();
    renderRecent(); renderSync();
  }
  function renderPicker(){
    const box=el('bsBayChips'); if(!box) return;
    const q=norm(el('bsBayFilter').value);
    const list=activeBays().filter(b=>!q||b.bay.includes(q)||norm(b.spot).includes(q));
    if(!activeBays().length){ box.innerHTML=`<div class="hint">No bays in ${safe(whLabel(wh))} yet. Type a name above and tap <b>Add bay</b>.</div>`; }
    else box.innerHTML=list.length?list.map(b=>{ const f=fillBar(b); return `<button type="button" class="bs-chip ${f.cls}" data-bs-pick="${b.id}"><b>${safe(b.bay)}</b><span>${f.n}/${f.cap}</span>${b.spot?`<i>${safe(b.spot)}</i>`:''}</button>`; }).join('')
      :`<div class="hint">No bay matches "${safe(q)}".</div>`;
    const canAdd=q&&!activeBays().some(b=>b.bay===q);
    el('bsQuickAdd').hidden=!canAdd; el('bsQuickAdd').textContent=canAdd?`Add bay ${q}`:'';
    box.querySelectorAll('[data-bs-pick]').forEach(x=>x.onclick=()=>selectBay(+x.dataset.bsPick,true));
  }
  function renderRecent(){
    const box=el('bsRecent'); const r=recent().filter(x=>x.warehouse===wh||!x.warehouse);
    if(!r.length){ box.innerHTML='<div class="ls-empty">Scans on this device show up here.</div>'; return; }
    box.innerHTML=r.slice(0,40).map(x=>{
      const st=x.state==='pending'?'<span class="bs-st bs-st-wait">waiting to save</span>':x.state==='error'?'<span class="bs-st bs-st-bad">not saved</span>':x.state==='undone'?'<span class="bs-st">undone</span>':'';
      const where=x.out?`out of ${typeof x.out==='string'?safe(x.out):'its bay'}`:x.bay?`→ <b>${safe(x.bay)}</b>`:'out of its bay';
      const moved=x.state==='saved'&&x.from_bay&&!x.same&&!x.undo?`<div class="bs-note">moved from ${safe(x.from_bay)}${x.from_wh&&x.from_wh!==x.warehouse?' ('+safe(whLabel(x.from_wh))+')':''}</div>`:'';
      const stale=x.stale?'<div class="bs-note bs-note-warn">Saved to history — but a newer scan already put this pallet somewhere else</div>':'';
      return `<div class="bs-row${x.state==='error'?' bs-row-bad':''}${x.state==='undone'?' bs-row-undone':''}"><div><div class="ls-v">${safe(x.tag)}</div>${moved}${stale}${x.msg?`<div class="bs-note bs-note-bad">${safe(x.msg)}</div>`:''}</div><div class="bs-row-r">${where}${x.undo?' · undo':''}<div class="ls-t">${fmtTime(x.t)} ${st}</div></div></div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- render: bays tab
  function renderBays(){
    const box=el('bsBayList'); if(!box) return;
    el('bsWhName').textContent=whLabel(wh)||'—';
    if(!wh){ box.innerHTML='<div class="hint">Pick a warehouse.</div>'; el('bsBayDetail').hidden=true; return; }
    const q=norm(el('bsBaysQ').value);
    const list=bays.filter(b=>(b.active||showRetired)&&(!q||b.bay.includes(q)||norm(b.spot).includes(q)));
    const act=activeBays(); const tot=act.reduce((n,b)=>n+(b.count||0),0), cap=act.reduce((n,b)=>n+(b.capacity||DEFAULT_CAP),0);
    el('bsBaysSum').textContent=act.length?`${act.length} bay${act.length===1?'':'s'} · ${tot} pallets in ${cap} spaces`:'';
    box.innerHTML=list.length?`<table class="ql-table bs-table"><thead><tr><th>Bay</th><th>Physical spot</th><th>Pallets</th><th>Last scan</th><th></th></tr></thead><tbody>${list.map(b=>{
      const f=fillBar(b);
      return `<tr class="${b.active?'':'bs-retired'}${b.id===openBayId?' bs-open':''}"><td><b>${safe(b.bay)}</b>${b.active?'':`<div class="bs-note">retired${b.replaced_by_bay?' → '+safe(b.replaced_by_bay):''} ${fmtDate(b.retired_at)}</div>`}</td>
        <td>${safe(b.spot||'')}</td>
        <td>${b.active?`<div class="bs-mini ${f.cls}"><span>${f.n} / ${f.cap}</span><div class="bs-bar ${f.cls}"><div style="width:${f.pct}%"></div></div></div>`:'—'}</td>
        <td>${b.last_at?fmtDate(b.last_at):''}</td>
        <td class="bs-td-act">${b.active?`<button type="button" class="ghost" data-bs-scan="${b.id}">Scan</button><button type="button" class="ghost" data-bs-open="${b.id}">Open</button>`:`<button type="button" class="ghost" data-bs-open="${b.id}">History</button>`}</td></tr>`; }).join('')}</tbody></table>`
      :`<div class="hint" style="padding:10px 0">${q?`No bay matches "${safe(q)}".`:`No bays in ${safe(whLabel(wh))} yet — add the customer's bay names above.`}</div>`;
    box.querySelectorAll('[data-bs-scan]').forEach(x=>x.onclick=()=>{ setTab('scan'); selectBay(+x.dataset.bsScan,true); });
    box.querySelectorAll('[data-bs-open]').forEach(x=>x.onclick=()=>openBay(+x.dataset.bsOpen));
  }

  async function addBays(){
    const st=el('bsAddStatus');
    if(!wh){ st.textContent='Pick a warehouse first.'; return; }
    const names=[...new Set(String(el('bsAddName').value||'').split(/[\n,;]+/).map(norm).filter(Boolean))];
    if(!names.length){ st.textContent='Type the bay name (or several, one per line).'; el('bsAddName').focus(); return; }
    const capRaw=el('bsAddCap').value.trim(); const cap=/^\d{1,5}$/.test(capRaw)&&+capRaw>0?+capRaw:DEFAULT_CAP;
    const spot=el('bsAddSpot').value.trim();
    if(names.length>1&&spot&&!confirm(`Give all ${names.length} bays the physical spot "${spot}"?`)) return;
    st.textContent=`Adding ${names.length} bay${names.length===1?'':'s'}…`;
    const added=[],skipped=[];
    for(const n of names){
      try{
        const r=await rpc('toolkit_bay_add',{p:{warehouse:wh,bay:n,capacity:cap,spot,by:me()}});
        if(r.ok) added.push(r.bay.bay); else skipped.push(n+(r.error==='exists'?' (already there)':' ('+r.error+')'));
      }catch(e){ st.textContent=errText(e); if(added.length) refreshBays(true); return; }
    }
    st.innerHTML=(added.length?`✓ Added ${added.map(safe).join(', ')}.`:'')+(skipped.length?` <span style="color:var(--bad)">Skipped ${skipped.map(safe).join(', ')}.</span>`:'');
    el('bsAddName').value=''; el('bsAddSpot').value=''; el('bsAddCap').value='';
    await refreshBays(true);
    if(added.length===1&&tab==='scan'){ const b=activeBays().find(x=>x.bay===added[0]); if(b) selectBay(b.id,true); }
  }
  async function quickAdd(){
    const n=norm(el('bsBayFilter').value); if(!n||!wh) return;
    if(!confirm(`Add bay ${n} in ${whLabel(wh)}? Capacity ${DEFAULT_CAP} pallets (you can change it in the Bays tab).`)) return;
    try{
      const r=await rpc('toolkit_bay_add',{p:{warehouse:wh,bay:n,capacity:DEFAULT_CAP,by:me()}});
      if(!r.ok&&r.error!=='exists'){ flash('bad',ERR[r.error]||r.error); return; }
      await refreshBays(true);
      const b=activeBays().find(x=>x.bay===n); el('bsBayFilter').value=''; if(b) selectBay(b.id,true);
    }catch(e){ flash('bad',errText(e,'Adding a bay needs a connection.')); }
  }

  // ---------------------------------------------------------------- bay detail
  let detail=null;
  async function openBay(id){
    openBayId=id; renderBays();
    const p=el('bsBayDetail'); p.hidden=false; detail=null;
    const b=bayById(id);
    p.innerHTML=`<div class="hint">Loading ${safe(b?b.bay:'bay')}…</div>`;
    p.scrollIntoView({block:'nearest',behavior:'smooth'});
    try{
      const r=await rpc('toolkit_bay_contents',{p_bay_id:id});
      if(!r.ok||openBayId!==id) return;
      detail=r; renderDetail();
    }catch(e){ p.innerHTML=`<div class="hint">${safe(errText(e))}</div>`; }
  }
  function renderDetail(){
    const p=el('bsBayDetail'); const b=detail.bay, T=detail.tags||[];
    const local=bayById(b.id); if(local){ Object.assign(local,{count:b.count,capacity:b.capacity,spot:b.spot,note:b.note,last_at:b.last_at}); saveBays(); }
    const f=fillBar(b);
    p.innerHTML=`<div class="bs-det-head"><div><div class="bs-cur-lbl">${safe(whLabel(b.warehouse))}${b.active?'':' · retired'}</div><div class="bs-det-bay">${safe(b.bay)}</div>
        ${b.spot?`<div class="bs-cur-spot">${safe(b.spot)}</div>`:''}${b.note?`<div class="hint">${safe(b.note)}</div>`:''}
        <div class="hint">Added ${fmtDate(b.created_at)}${b.created_by?' by '+safe(b.created_by):''}${b.retired_at?` · retired ${fmtDate(b.retired_at)}${b.retired_by?' by '+safe(b.retired_by):''}${b.replaced_by_bay?' → now '+safe(b.replaced_by_bay):''}`:''}</div></div>
      <div class="bs-det-n ${f.cls}"><b>${f.n}</b><span>of ${f.cap}</span></div></div>
      <div class="bs-bar ${f.cls}"><div style="width:${f.pct}%"></div></div>
      ${b.active?`<div class="bs-det-act">
        <button type="button" data-bs-d="scan">Scan into ${safe(b.bay)}</button>
        <button type="button" class="ghost" data-bs-d="print" ${T.length?'':'disabled'}>Print</button>
        <button type="button" class="ghost" data-bs-d="csv" ${T.length?'':'disabled'}>CSV</button>
        <button type="button" class="ghost" data-bs-d="edit">Capacity / spot</button>
        <button type="button" class="ghost" data-bs-d="rename">New bay name</button>
        <button type="button" class="ghost" data-bs-d="clear" ${T.length?'':'disabled'}>Clear bay</button>
        <button type="button" class="mh-link" data-bs-d="retire">Retire this name</button></div>`
      :`<div class="bs-det-act"><button type="button" class="ghost" data-bs-d="restore">Restore this bay name</button></div>`}
      <div id="bsDetForm"></div>
      <div class="ls-list-head" style="padding:12px 0 6px;border:0"><b>In this bay now</b><span class="hint">newest first</span></div>
      ${T.length?`<div class="ql-table-wrap"><table class="ql-table"><thead><tr><th>Tag</th><th>Put here</th><th>By</th><th>Item</th><th>Lot</th><th>Qty</th><th></th></tr></thead><tbody>${T.map((t,i)=>`<tr><td class="bs-mono">${safe(t.tag)}</td><td>${fmtWhen(t.assigned_at)}</td><td>${safe(t.assigned_by||'')}</td><td>${safe(t.item||'')}</td><td>${safe(t.lot||'')}</td><td>${t.qty!=null?Number(t.qty).toLocaleString():''}</td><td>${b.active?`<button type="button" class="ls-del" data-bs-out="${i}" title="Take out of bay" aria-label="Take ${safe(t.tag)} out of the bay">✕</button>`:''}</td></tr>`).join('')}</tbody></table></div>`
        :'<div class="ls-empty">Empty — nothing scanned into this bay right now.</div>'}
      <div class="hint" style="margin-top:6px">Item / lot / qty fill in when the tag matches a pallet in live inventory.</div>`;
    p.querySelectorAll('[data-bs-out]').forEach(x=>x.onclick=()=>{
      const t=T[+x.dataset.bsOut]; if(!confirm(`Take ${t.tag} out of ${b.bay}? (consumed or sent back)`)) return;
      takeOut(t.tag,b.bay,'Taken out of '+b.bay); T.splice(+x.dataset.bsOut,1); detail.bay.count=Math.max(0,(detail.bay.count||1)-1); renderDetail(); renderBays();
    });
    p.querySelectorAll('[data-bs-d]').forEach(x=>x.onclick=()=>detailAction(x.dataset.bsD));
  }
  function formBox(html){ const f=el('bsDetForm'); f.innerHTML=`<div class="bs-form">${html}<div class="hint" id="bsDetStatus"></div></div>`; const first=f.querySelector('input'); if(first) first.focus(); return f; }
  async function detailAction(a){
    const b=detail.bay, T=detail.tags||[];
    const status=t=>{ const s=el('bsDetStatus'); if(s) s.innerHTML=t; };
    const after=async(msg)=>{ LWHUI.toast(msg); await refreshBays(true); };
    if(a==='scan'){ setTab('scan'); selectBay(b.id,true); return; }
    if(a==='csv') return contentsCsv(b,T);
    if(a==='print') return contentsPrint(b,T);
    if(a==='edit'){
      formBox(`<div class="bs-form-grid"><label class="ps-field"><span>Capacity (pallets)</span><input id="bsEdCap" inputmode="numeric" value="${b.capacity}"></label><label class="ps-field"><span>Physical spot (our name)</span><input id="bsEdSpot" value="${safe(b.spot||'')}" placeholder="e.g. Dock 4 east wall"></label><label class="ps-field bs-span2"><span>Note</span><input id="bsEdNote" value="${safe(b.note||'')}"></label></div><button type="button" id="bsEdGo">Save</button>`);
      el('bsEdGo').onclick=async()=>{ status('Saving…'); try{ const r=await rpc('toolkit_bay_update',{p:{id:b.id,capacity:el('bsEdCap').value.trim(),spot:el('bsEdSpot').value,note:el('bsEdNote').value,by:me()}}); if(!r.ok) return status(ERR[r.error]||r.error); detail.bay=r.bay; renderDetail(); after('Saved'); }catch(e){ status(safe(errText(e))); } };
      return;
    }
    if(a==='rename'){
      formBox(`<p class="bs-form-p">The customer gave this same space a new bay name. <b>${safe(b.bay)}</b> is retired (its history stays) and the new name gets the same capacity${b.spot?' and physical spot':''}.</p>
        <label class="ps-field"><span>New bay name</span><input id="bsRnName" autocomplete="off" autocapitalize="characters" placeholder="e.g. VB2102"></label>
        ${T.length?`<div class="bs-radio"><b>${T.length} pallet${T.length===1?' is':'s are'} still in ${safe(b.bay)}:</b>
          <label><input type="radio" name="bsRnMode" value="clear" checked> They've been consumed / sent back — clear them</label>
          <label><input type="radio" name="bsRnMode" value="move"> They're still here — move them to the new name</label></div>`:''}
        <button type="button" id="bsRnGo">Rename</button>`);
      el('bsRnGo').onclick=async()=>{
        const nn=norm(el('bsRnName').value); if(!nn) return status('Type the new bay name.');
        const mode=(document.querySelector('input[name=bsRnMode]:checked')||{}).value||'move';
        if(!confirm(`Rename ${b.bay} → ${nn}?${T.length?`\n\n${T.length} pallet(s) will be ${mode==='clear'?'cleared':'moved to '+nn}.`:''}`)) return;
        status('Saving…');
        try{ const r=await rpc('toolkit_bay_rename',{p:{id:b.id,new_bay:nn,by:me(),tags:mode}}); if(!r.ok) return status(ERR[r.error]||r.error);
          if(bayId===b.id){ bayId=r.bay.id; LWHStorage.set(K.bay,{wh,id:bayId}); }
          await after(`${b.bay} is now ${nn}`); openBay(r.bay.id);
        }catch(e){ status(safe(errText(e))); }
      };
      return;
    }
    if(a==='clear'){
      formBox(`<p class="bs-form-p">Takes all <b>${T.length}</b> pallet${T.length===1?'':'s'} out of <b>${safe(b.bay)}</b> — for when everything from the PO has been consumed or sent back to the plant. The bay stays open. Each pallet's history keeps the record.</p>
        <label class="ps-field"><span>Type ${safe(b.bay)} to confirm</span><input id="bsClrName" autocomplete="off" autocapitalize="characters"></label>
        <label class="ps-field"><span>Note (optional)</span><input id="bsClrNote" placeholder="e.g. PO 4500123 consumed"></label>
        <button type="button" id="bsClrGo" class="bs-danger">Clear ${safe(b.bay)}</button>`);
      el('bsClrGo').onclick=async()=>{
        if(norm(el('bsClrName').value)!==b.bay) return status(`Type ${safe(b.bay)} exactly to confirm.`);
        status('Clearing…');
        try{ const r=await rpc('toolkit_bay_clear',{p:{id:b.id,by:me(),note:el('bsClrNote').value.trim()}}); if(!r.ok) return status(ERR[r.error]||r.error);
          await after(`${b.bay} cleared — ${r.cleared} pallet${r.cleared===1?'':'s'}`); openBay(b.id);
        }catch(e){ status(safe(errText(e))); }
      };
      return;
    }
    if(a==='retire'){
      if(!confirm(`Retire ${b.bay}? It won't show up for scanning any more${T.length?` and its ${T.length} pallet(s) will be cleared`:''}. Its history is kept, and you can restore it later.\n\n(If the customer just gave the space a new name, use "New bay name" instead.)`)) return;
      try{ const r=await rpc('toolkit_bay_retire',{p:{id:b.id,by:me()}}); if(!r.ok) return flash('bad',ERR[r.error]||r.error);
        if(bayId===b.id){ bayId=null; LWHStorage.set(K.bay,null); }
        await after(`${b.bay} retired`); el('bsBayDetail').hidden=true; openBayId=null; renderBays();
      }catch(e){ alert(errText(e)); }
      return;
    }
    if(a==='restore'){
      try{ const r=await rpc('toolkit_bay_retire',{p:{id:b.id,restore:true,by:me()}}); if(!r.ok) return alert(r.error==='exists'?`An open bay is already called ${b.bay}.`:(ERR[r.error]||r.error));
        await after(`${b.bay} restored`); openBay(b.id);
      }catch(e){ alert(errText(e)); }
    }
  }
  const fileName=(b,ext)=>('Bay_'+b.warehouse+'_'+b.bay).replace(/[^A-Za-z0-9_-]+/g,'_')+ext;
  function download(blob,name){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); }
  const csvEsc=v=>{ const s=String(v??''); return /[",\n]/.test(s)||/^\d{12,}$/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  function contentsCsv(b,T){
    const head=['Warehouse','Bay','Physical spot','Tag','Put in bay','By','Item','Description','Lot','Qty','LWH ID'];
    const rows=T.map(t=>[b.warehouse,b.bay,b.spot||'',t.tag,t.assigned_at?new Date(t.assigned_at).toLocaleString('en-US'):'',t.assigned_by||'',t.item||'',t.description||'',t.lot||'',t.qty??'',t.lwh_id??''].map(csvEsc).join(','));
    download(new Blob([[head.join(','),...rows].join('\r\n')],{type:'text/csv;charset=utf-8;'}),fileName(b,'.csv'));
  }
  // Letter sheet: bay barcode at the top, then tags two-across (about 32 a page)
  function contentsPrint(b,T){
    const out=el('bsPrintArea');
    const info=t=>[t.item?'Item '+safe(t.item):'',t.lot?'Lot '+safe(t.lot):'',t.qty!=null?'Qty '+Number(t.qty).toLocaleString():'',fmtDate(t.assigned_at)].filter(Boolean).join(' · ');
    out.innerHTML=`<div class="ls-p-page bs-p-page"><div class="ls-p-head"><div><b>Bay ${safe(b.bay)}</b> — ${safe(whLabel(b.warehouse))}${b.spot?' · '+safe(b.spot):''}</div><div>${T.length} of ${b.capacity} pallets · ${fmtWhen(new Date().toISOString())}</div></div>
      <div class="bs-p-baybc"><svg id="bsPBay"></svg></div>
      <div class="bs-p-grid">${T.map((t,i)=>`<div class="bs-p-cell"><div class="bs-p-n">${i+1}</div><div class="bs-p-bc"><svg id="bsPBc${i}"></svg><div class="bs-p-txt">${safe(t.tag)}</div><div class="bs-p-info">${info(t)}</div></div></div>`).join('')}</div></div>`;
    // give each barcode a viewBox so it shrinks to fit its column instead of being cut off
    const fit=id=>{ const s=document.getElementById(id); if(!s) return; const w=parseFloat(s.getAttribute('width')),h=parseFloat(s.getAttribute('height')); if(w&&h){ s.setAttribute('viewBox',`0 0 ${w} ${h}`); s.setAttribute('preserveAspectRatio','none'); s.removeAttribute('width'); s.removeAttribute('height'); s.style.aspectRatio=`${w} / ${h}`; } };
    try{ if(window.JsBarcode){
      JsBarcode('#bsPBay',b.bay,{format:'CODE128',height:60,width:2,margin:0,marginLeft:20,marginRight:20,displayValue:true,fontSize:18}); fit('bsPBay');
      T.forEach((t,i)=>{ try{ JsBarcode('#bsPBc'+i,t.tag,{format:'CODE128',height:40,width:1.4,margin:0,marginLeft:12,marginRight:12,displayValue:false}); fit('bsPBc'+i); }catch(e){} });
    } }catch(e){}
    if(window.LWHLabels&&LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
    setTimeout(()=>print(),200);
  }
  function baysCsv(){
    if(!wh||!bays.length) return;
    const head=['Warehouse','Bay','Physical spot','Pallets','Capacity','Open spaces','Last scan','Status','Replaced by','Added','Added by'];
    const rows=bays.filter(b=>b.active||showRetired).map(b=>[wh,b.bay,b.spot||'',b.active?b.count||0:'',b.capacity,b.active?Math.max(0,b.capacity-(b.count||0)):'',b.last_at?new Date(b.last_at).toLocaleString('en-US'):'',b.active?'Open':'Retired',b.replaced_by_bay||'',b.created_at?new Date(b.created_at).toLocaleDateString('en-US'):'',b.created_by||''].map(csvEsc).join(','));
    download(new Blob([[head.join(','),...rows].join('\r\n')],{type:'text/csv;charset=utf-8;'}),'Bays_'+wh+'.csv');
  }

  // ---------------------------------------------------------------- find tag
  async function findTag(){
    const q=norm(el('bsFindQ').value), out=el('bsFindResults');
    if(q.length<3){ out.innerHTML='<div class="hint">Type or scan at least 3 characters of the tag.</div>'; return; }
    out.innerHTML='<div class="hint">Looking it up…</div>';
    try{
      const r=await rpc('toolkit_bay_tag_lookup',{p_search:q});
      if(!r.ok){ out.innerHTML=`<div class="hint">${r.error==='too_short'?'Type at least 3 characters.':'Couldn\'t look that up.'}</div>`; return; }
      renderFind(r);
    }catch(e){ out.innerHTML=`<div class="hint">${safe(errText(e))}</div>`; }
  }
  function renderFind(r){
    const out=el('bsFindResults'); const L=r.tags||[];
    const pend=queue().filter(m=>m.tag===r.search);
    const pendNote=pend.length?`<div class="bs-note bs-note-warn">This device still has ${pend.length} scan${pend.length===1?'':'s'} of this tag waiting to save — what's below may change once ${pend.length===1?'it goes':'they go'} up.</div>`:'';
    if(!L.length){ out.innerHTML=pendNote+`<div class="ls-empty">"${safe(r.search)}" hasn't been scanned into a bay.</div>`; return; }
    const partial=!r.exact;
    out.innerHTML=pendNote+(partial?`<div class="hint" style="margin-bottom:8px">No exact match — ${L.length} tag${L.length===1?'':'s'} contain "${safe(r.search)}":</div>`:'')+L.map((t,i)=>{
      const c=t.current, inv=t.inventory;
      const lastAssign=(t.history||[]).find(h=>h.bay);
      return `<div class="card bs-find">
        <div class="bs-find-tag bs-mono">${safe(t.tag)}</div>
        ${c?`<div class="bs-find-cur"><div class="bs-cur-lbl">Current bay · ${safe(whLabel(c.warehouse))}</div><div class="bs-cur-bay">${safe(c.bay)}</div>${c.spot?`<div class="bs-cur-spot">${safe(c.spot)}</div>`:''}
              <div class="bs-find-when">Put here <b>${fmtWhen(c.assigned_at)}</b> (${daysAgo(c.assigned_at)})${c.assigned_by?' by '+safe(c.assigned_by):''}</div></div>`
           :`<div class="bs-find-cur bs-find-none"><div class="bs-cur-lbl">Not in a bay now</div>
              <div class="bs-find-when">${t.last_move&&t.last_move.action==='clear'?`Taken out of <b>${safe(t.last_move.from_bay||'its bay')}</b> ${fmtWhen(t.last_move.at)}${t.last_move.by?' by '+safe(t.last_move.by):''}${t.last_move.note?' — '+safe(t.last_move.note):''}`:''}
              ${lastAssign?`<br>Last bay assignment: <b>${safe(lastAssign.bay)}</b> on ${fmtWhen(lastAssign.at)}`:''}</div></div>`}
        ${inv?`<div class="bs-find-inv">${inv.customer?safe(inv.customer)+' · ':''}${inv.item?'Item <b>'+safe(inv.item)+'</b>':''}${inv.description?' '+safe(inv.description):''}${inv.lot?' · Lot '+safe(inv.lot):''}${inv.qty!=null?' · Qty '+Number(inv.qty).toLocaleString():''}<div class="hint">WMS: LWH ID ${safe(inv.lwh_id)} · ${safe(whLabel(inv.warehouse))} bay ${safe(inv.wms_bay||'—')}</div></div>`:''}
        <div class="bs-find-act">${c?`<button type="button" class="ghost" data-bs-fout="${i}">Take out of bay</button>`:''}<button type="button" class="ghost" data-bs-fopen="${i}" ${c?'':'hidden'}>Open ${c?safe(c.bay):''}</button></div>
        <details class="bs-hist"${partial?'':' open'}><summary>History (${t.history.length})</summary>
          <table class="ql-table"><thead><tr><th>When</th><th>What</th><th>Who</th></tr></thead><tbody>${t.history.map(h=>`<tr><td>${fmtWhen(h.at)}</td><td>${h.action==='clear'?`Out of ${safe(h.from_bay||'bay')}`:h.action==='rename'?`Bay renamed ${safe(h.from_bay)} → <b>${safe(h.bay)}</b>`:`Into <b>${safe(h.bay)}</b> (${safe(whLabel(h.warehouse))})${h.from_bay&&h.from_bay!==h.bay?' from '+safe(h.from_bay):''}`}${h.note&&h.action!=='rename'?`<div class="bs-note">${safe(h.note)}</div>`:''}</td><td>${safe(h.by||'')}</td></tr>`).join('')}</tbody></table></details>
      </div>`;
    }).join('');
    out.querySelectorAll('[data-bs-fout]').forEach(x=>x.onclick=()=>{
      const t=L[+x.dataset.bsFout]; if(!confirm(`Take ${t.tag} out of ${t.current.bay}? (consumed or sent back)`)) return;
      takeOut(t.tag,t.current.bay,'Taken out of '+t.current.bay); LWHUI.toast('Taken out — saving'); setTimeout(findTag,1500);
    });
    out.querySelectorAll('[data-bs-fopen]').forEach(x=>x.onclick=()=>{
      const c=L[+x.dataset.bsFopen].current; if(!c) return;
      if(c.warehouse!==wh){ el('bsWh').value=c.warehouse; setWarehouse(c.warehouse); }
      setTab('bays'); setTimeout(()=>openBay(c.bay_id),50);
    });
  }

  // ---------------------------------------------------------------- tabs / wiring
  function setTab(t){
    tab=t;
    document.querySelectorAll('[data-bs-tabbtn]').forEach(b=>b.classList.toggle('on',b.dataset.bsTabbtn===t));
    ['scan','bays','find'].forEach(x=>{ el('bsTab_'+x).hidden=x!==t; });
    if(camFor&&!((t==='find'&&camFor==='find')||(t==='scan'&&camFor==='scan'))) stopCamera();
    if(t==='bays'){ renderBays(); refreshBays(true); }
    if(t==='find') setTimeout(()=>el('bsFindQ').focus(),50);
    if(t==='scan'){ renderScan(); focusInput(); }
  }
  function renderAll(){ el('bsWh').value=wh; renderScan(); if(tab==='bays') renderBays(); if(openBayId&&!bayById(openBayId)){ openBayId=null; el('bsBayDetail').hidden=true; } }

  window.addEventListener('load',()=>{
    if(!el('bsInput')) return;
    el('bsWh').innerHTML='<option value="">Pick a warehouse…</option>'+WAREHOUSES.map(w=>`<option value="${w}">${whLabel(w)}</option>`).join('');
    if(wh&&!WAREHOUSES.includes(wh)) wh='';
    loadCachedBays();
    const saved=LWHStorage.get(K.bay,null); if(saved&&saved.wh===wh&&bayById(saved.id)?.active) bayId=saved.id;
    el('bsWh').onchange=e=>setWarehouse(e.target.value);
    document.querySelectorAll('[data-bs-tabbtn]').forEach(b=>b.onclick=()=>setTab(b.dataset.bsTabbtn));

    const inp=el('bsInput');
    const hide=LWHStorage.get(K.kb,false); el('bsHideKb').checked=hide; inp.setAttribute('inputmode',hide?'none':'text');
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key==='Tab'){ e.preventDefault(); submitInput(); } });
    inp.addEventListener('input',()=>{   // scanners that don't send Enter
      const now=performance.now(); burst.push(now); if(burst.length>40) burst.shift();
      clearTimeout(inp._t);
      inp._t=setTimeout(()=>{ const v=inp.value; if(v.length<4||burst.length<4) return; const g=burst.slice(1).map((t,i)=>t-burst[i]); if(g.reduce((a,b)=>a+b,0)/g.length<35) submitInput(); },220);
    });
    const ready=on=>{ el('bsReady').classList.toggle('ls-ready-on',on); el('bsReady').textContent=on?'Ready — scan a tag or bay label':'Tap here to scan'; };
    inp.addEventListener('focus',()=>ready(true)); inp.addEventListener('blur',()=>ready(false));
    el('bsReady').onclick=()=>inp.focus();
    el('bsAdd').onclick=submitInput;
    el('bsHideKb').onchange=e=>{ LWHStorage.set(K.kb,e.target.checked); inp.setAttribute('inputmode',e.target.checked?'none':'text'); inp.blur(); inp.focus(); };
    el('bsCamBtn').onclick=()=>startCamera('scan');
    el('bsUndo').onclick=undoLast;
    el('bsBayFilter').addEventListener('input',renderPicker);
    el('bsBayFilter').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); const q=norm(e.target.value); const hit=activeBays().find(b=>b.bay===q)||(()=>{ const l=activeBays().filter(b=>b.bay.includes(q)); return l.length===1?l[0]:null; })(); if(hit){ e.target.value=''; selectBay(hit.id,true); } else if(q) quickAdd(); } });
    el('bsQuickAdd').onclick=quickAdd;
    el('bsSaveName').onclick=()=>{ const n=el('bsName').value.trim(); if(!n) return; LWHStorage.set('userName',n); if(window.setUserName) setUserName.value=n; el('bsNameNote').hidden=true; LWHUI.toast('Name saved'); focusInput(); };
    // Bays tab
    el('bsAddGo').onclick=addBays;
    el('bsAddName').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey&&!/\n/.test(e.target.value)){ e.preventDefault(); addBays(); } });
    el('bsBaysQ').addEventListener('input',renderBays);
    el('bsShowRetired').onchange=e=>{ showRetired=e.target.checked; renderBays(); };
    el('bsBaysCsv').onclick=baysCsv;
    el('bsBaysRefresh').onclick=()=>refreshBays(false);
    // Find tab
    el('bsFindGo').onclick=findTag;
    el('bsFindQ').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); findTag(); } });
    el('bsFindCamBtn').onclick=()=>startCamera('find');

    window.addEventListener('online',()=>{ scheduleSync(200); refreshBays(true); });
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden){ scheduleSync(500); } });
    document.addEventListener('click',e=>{ const v=e.target.closest('[data-view]'); if(!v) return; setTimeout(()=>{ if(v.dataset.view==='bayScan'){ refreshBays(true); focusInput(); } else stopCamera(); },50); });
    setTab('scan');
    if(wh) refreshBays(true);
    scheduleSync(1000);
  });
  window.LWHBayScan={addScan:v=>addScan(v,'test'),syncNow:()=>syncNow(),refresh:()=>refreshBays(false)};
})();
