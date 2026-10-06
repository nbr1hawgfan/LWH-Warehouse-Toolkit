(function(){
  // OUTBOUND LOADS — a stripped-down outbound WMS for when a warehouse can't
  // reach the WMS. Build a load (ship from / to / bill to, carrier, trailer,
  // seal), add order lines from the selected sub-customer's own items, scan
  // the pallets onto it, and print a detailed BOL. Every pallet scanned is
  // saved to Supabase (sql/outbound_loads.sql) so the load can be re-entered
  // into the WMS later.
  //
  // Protecting the data is the point, so every scan is checked before it's
  // accepted:
  //   • the pallet must be in inventory (or a manager adds it as an exception)
  //   • it must belong to this load's sub-customer          (no override)
  //   • it must not already be on this load or another load  (no override)
  //   • its item must be on an order line that isn't full     (no override)
  //   • it must be in this load's warehouse (or a manager overrides)
  // Inventory comes from the same live Master Lookup data as the rest of the
  // app (LWHInventory). The Customer ID is the Comments field there.
  const LOADS_KEY='obLoads', CUR_KEY='obCurrent', PARTY_KEY='obParties', CARRIER_KEY='obCarriers',
        SHIPPED_KEY='obShipped', KB_KEY='obHideKb', CO_KEY='obCompany', FROM_BY_WH='obFromByWh', BILL_BY_SUB='obBillBySub';
  const XLSXJS='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  const SUPABASE_URL='https://tjivcqxnkftujceumdtx.supabase.co';
  const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqaXZjcXhua2Z0dWpjZXVtZHR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTE5NDMsImV4cCI6MjEwMDQ2Nzk0M30.GzDc-_u92jvAHq7eG1X-1cet5Av9qF3ZDEVJMRKEP0E';
  const MGR_PASS_KEY='lwh_mgrPass';   // same tab-only passcode as Missed Punches / Load Tag Scan records
  const PARTY_KINDS=[['shipFrom','ship_from','Ship from'],['shipTo','ship_to','Ship to (consignee)'],['billTo','bill_to','Bill to']];
  const DEFAULT_CO={name:'Logistics Warehouse',addr:'700 Fresno Street, Fort Smith, AR 72901',phone:'(479) 410-2611'};

  const el=id=>document.getElementById(id);
  const safe=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const clean=v=>{ const s=String(v??'').trim(); return (!s||/^null$/i.test(s))?'':s; };
  const num=v=>{ const n=parseFloat(String(v??'').replace(/,/g,'')); return isFinite(n)?n:0; };
  const fmtN=n=>(+n||0).toLocaleString('en-US',{maximumFractionDigits:2});
  const upper=v=>clean(v).toUpperCase().replace(/\s+/g,'');
  function rid(){ try{ return crypto.randomUUID(); }catch{ return Date.now().toString(36)+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2); } }
  function deviceId(){ let d=LWHStorage.get('deviceId',''); if(!d){ d=rid(); LWHStorage.set('deviceId',d); } return d; }
  function userName(){ return (LWHStorage.get('userName','')||'').trim(); }
  function fmtTime(iso){ const d=new Date(iso); return isNaN(d)?'':d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }
  function fmtDate(iso){ const d=new Date(iso); return isNaN(d)?'':d.toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}); }
  function fmtStamp(iso){ const d=new Date(iso); return isNaN(d)?'':d.toLocaleString('en-US',{month:'numeric',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}); }
  // Scanner output can carry an AIM prefix (]C1…) or invisible separators; GS1
  // labels may also be read as "(00)…". Keep just the code.
  function cleanScan(v){ return String(v||'').replace(/^\][A-Za-z][0-9]/,'').replace(/[\x00-\x1F\x7F]/g,'').replace(/^\(00\)/,'00').replace(/\s+/g,'').trim(); }
  // Different ways the same ID can come through: SSCC with/without its "00"
  // application identifier, or a numeric LWH ID with leading zeros.
  function variants(v){
    const k=upper(v); if(!k) return [];
    const out=new Set([k]);
    if(/^\d+$/.test(k)){
      if(k.length===20&&k.startsWith('00')) out.add(k.slice(2));
      if(k.length===18) out.add('00'+k);
      const lz=k.replace(/^0+/,''); if(lz&&lz!==k) out.add(lz);
    }
    return [...out];
  }
  function sameId(a,b){ if(!a||!b) return false; const vb=new Set(variants(b)); return variants(a).some(x=>vb.has(x)); }

  // ================================================================ state
  let loads=[], load=null, cam=null, camLast={v:'',t:0}, audio=null, burst=[], pendingBlock=null;
  let shipped=new Map(), shippedAt=null, lookups={parties:[],carriers:[]};
  function allLoads(){ return loads; }
  function persistLoads(){
    // keep every open load, plus the latest 60 closed/void ones
    const open=loads.filter(L=>L.status==='open'), done=loads.filter(L=>L.status!=='open').sort((a,b)=>(b.closed||b.updated||'').localeCompare(a.closed||a.updated||'')).slice(0,60);
    loads=[...open,...done];
    LWHStorage.set(LOADS_KEY,loads);
  }
  function save(){ if(load){ load.updated=new Date().toISOString(); } persistLoads(); scheduleSync(); }
  function logEvent(L,what){ (L.events=L.events||[]).push({t:new Date().toISOString(),by:L.by||userName()||'',what}); }
  function newBol(){
    const d=new Date(), p=n=>String(n).padStart(2,'0');
    return 'EB'+String(d.getFullYear()).slice(2)+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+deviceId().replace(/[^a-z0-9]/gi,'').slice(0,2).toUpperCase();
  }
  function blankParty(){ return {name:'',code:'',addr1:'',city:'',phone:''}; }
  function blankLoad(){
    return {id:Date.now().toString(36),key:rid(),bol:newBol(),status:'open',warehouse:'',subCust:'',billRef:'',appt:'',pro:'',carrier:'',trailer:'',seal:'',comments:'',
      by:userName(),shipFrom:blankParty(),shipTo:blankParty(),billTo:blankParty(),lines:[],scans:[],events:[],
      created:new Date().toISOString(),updated:new Date().toISOString(),closed:null,closedBy:'',sync:null};
  }

  // ================================================================ inventory
  let invCache={src:null,len:-1,rows:[],idx:new Map()};
  function custIdOf(r){ const c=clean(r.comments); return (c&&!/\s/.test(c)&&c.length>=6)?c:''; }
  function inv(){
    const src=(window.LWHInventory&&LWHInventory.getAllRows)?LWHInventory.getAllRows():[];
    if(src===invCache.src&&src.length===invCache.len) return invCache;
    const rows=[], idx=new Map();
    (src||[]).forEach(r=>{
      if(/^(n|no|false|0)$/i.test(clean(r.stillInInventory))) return;
      const o={lwh:clean(r.controlNumber),cust:custIdOf(r),item:clean(r.itemNm),desc:clean(r.itemDesc)||clean(r.unique8),lot:clean(r.lotNum),
        qty:num(r.qty),wh:clean(r.warehouse),sub:clean(r.subCustNm),bay:clean(r.currentBay||r.bayName)};
      if(!o.lwh) return;
      rows.push(o);
      [...variants(o.lwh),...variants(o.cust)].forEach(k=>{ const a=idx.get(k); if(a){ if(!a.includes(o)) a.push(o); } else idx.set(k,[o]); });
    });
    invCache={src,len:(src||[]).length,rows,idx};
    return invCache;
  }
  function lookup(code){ const {idx}=inv(); const out=[]; variants(code).forEach(k=>(idx.get(k)||[]).forEach(r=>{ if(!out.includes(r)) out.push(r); })); return out; }
  function warehouses(){ return [...new Set(inv().rows.map(r=>r.wh).filter(Boolean))].sort(); }
  function subCustomers(wh){ return [...new Set(inv().rows.filter(r=>!wh||r.wh===wh).map(r=>r.sub).filter(Boolean))].sort(); }
  function invAsOf(){ const src=(window.LWHInventory&&LWHInventory.getAllRows)?LWHInventory.getAllRows():[]; const s=src&&src[0]&&src[0].syncedAt; if(!s) return ''; const d=new Date(String(s).includes('T')?s:String(s).replace(' ','T')); return isNaN(d)?'':d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }

  // ================================================================ shipped registry
  // Pallets already on a load: from Supabase (every device) plus this device's own loads.
  function shippedElsewhere(r,L){
    L=L||load;
    for(const k of [...variants(r.lwh),...variants(r.cust)]){
      const hit=shipped.get(k); if(hit&&hit.key!==L.key) return hit.bol||'(no BOL #)';
    }
    for(const o of loads){ if(o.key===L.key||o.status==='void') continue;
      if(o.scans.some(s=>sameId(s.lwh,r.lwh)||(r.cust&&sameId(s.lwh,r.cust)))) return o.bol||'(no BOL #)'; }
    return null;
  }
  function onThisLoad(r){ return load.scans.some(s=>sameId(s.lwh,r.lwh)); }
  async function refreshShipped(){
    try{
      const r=await rpc('toolkit_outbound_shipped_ids',{});
      if(!r||!r.ok) return;
      const m=new Map(); (r.ids||[]).forEach(([lwh,cust,bol,key])=>{ [...variants(lwh),...variants(cust)].forEach(k=>m.set(k,{bol,key})); });
      shipped=m; shippedAt=new Date().toISOString(); setupMissing=false;
      LWHStorage.set(SHIPPED_KEY,{at:shippedAt,ids:r.ids||[]});
      recheckConflicts();
      if(load&&isEditorOpen()) render();
    }catch(e){ if(e.setup) setupMissing=true; }
  }
  function loadCachedShipped(){ const c=LWHStorage.get(SHIPPED_KEY,null); if(c&&Array.isArray(c.ids)){ const m=new Map(); c.ids.forEach(([lwh,cust,bol,key])=>[...variants(lwh),...variants(cust)].forEach(k=>m.set(k,{bol,key}))); shipped=m; shippedAt=c.at; } }
  function recheckConflicts(){
    loads.forEach(L=>{ if(L.status==='void') return; L.scans.forEach(s=>{
      const other=shippedElsewhere({lwh:s.lwh,cust:s.cust},L);
      if(other&&!s.conflict) s.conflict=other;
      else if(!other&&s.conflict&&!s.serverConflict) s.conflict=null;
    }); });
    persistLoads();
  }

  // ================================================================ lines
  function lineScans(line){ return load.scans.filter(s=>s.lineId===line.id); }
  function lineProgress(line){
    const sc=lineScans(line), pallets=sc.length, units=sc.reduce((a,s)=>a+num(s.qty),0);
    let done=false, have=0, need=0;
    if(line.mode==='pallets'){ have=pallets; need=line.target; done=pallets>=line.target; }
    else if(line.mode==='units'){ have=units; need=line.target; done=units>=line.target; }
    else { need=line.ids.length; have=line.ids.filter(id=>sc.some(s=>sameId(s.lwh,id))).length; done=have>=need; }
    return {pallets,units,have,need,done,over:line.mode==='units'?Math.max(0,units-line.target):line.mode==='pallets'?Math.max(0,pallets-line.target):0};
  }
  function availableFor(item){
    return inv().rows.filter(r=>r.sub===load.subCust&&r.wh===load.warehouse&&r.item===item&&!onThisLoad(r)&&!shippedElsewhere(r));
  }
  function itemsForLoad(){
    const m=new Map();
    inv().rows.forEach(r=>{ if(r.sub!==load.subCust||r.wh!==load.warehouse||!r.item) return;
      if(onThisLoad(r)||shippedElsewhere(r)) return;
      const o=m.get(r.item)||{item:r.item,desc:r.desc,pallets:0,units:0}; o.pallets++; o.units+=r.qty; if(!o.desc&&r.desc) o.desc=r.desc; m.set(r.item,o); });
    return [...m.values()].sort((a,b)=>a.item.localeCompare(b.item,undefined,{numeric:true}));
  }
  function pickLine(r){
    const forItem=load.lines.filter(l=>l.item===r.item);
    if(!forItem.length) return {err:`Item ${r.item} isn't on this load — add an order line for it first`};
    const idLine=forItem.find(l=>l.mode==='ids'&&l.ids.some(id=>sameId(id,r.lwh)||(r.cust&&sameId(id,r.cust))));
    if(idLine) return {line:idLine};
    const open=forItem.filter(l=>l.mode!=='ids'&&!lineProgress(l).done);
    if(open.length) return {line:open[0]};
    if(forItem.every(l=>l.mode==='ids')) return {err:`Pallet ${r.lwh} isn't one of the pallet IDs ordered for item ${r.item}`};
    const l=forItem.find(x=>x.mode!=='ids'); const p=lineProgress(l);
    return {err:`Item ${r.item} line is already complete (${fmtN(p.have)} of ${fmtN(p.need)} ${l.mode==='units'?'qty':'pallets'}) — change the line to ship more`};
  }

  // ================================================================ feedback
  function tone(kind){
    try{
      audio=audio||new (window.AudioContext||window.webkitAudioContext)();
      const play=(f,t0,dur)=>{ const o=audio.createOscillator(),g=audio.createGain(); o.frequency.value=f; o.type='square'; g.gain.setValueAtTime(0.08,audio.currentTime+t0); g.gain.exponentialRampToValueAtTime(0.0001,audio.currentTime+t0+dur); o.connect(g).connect(audio.destination); o.start(audio.currentTime+t0); o.stop(audio.currentTime+t0+dur); };
      if(kind==='ok') play(1760,0,0.09);
      else if(kind==='done'){ play(1320,0,0.1); play(1760,0.12,0.1); play(2093,0.24,0.18); }
      else { play(220,0,0.16); play(180,0.2,0.22); play(160,0.45,0.3); }
    }catch(e){}
    try{ navigator.vibrate&&navigator.vibrate(kind==='ok'?60:kind==='done'?[60,60,60,60,160]:[300,100,300,100,300]); }catch(e){}
  }
  function flash(kind,msg,action){
    const f=el('obFlash'); if(!f) return;
    f.className='ls-flash ls-flash-'+kind; f.innerHTML=safe(msg)+(action?` <button type="button" class="ob-flash-btn" id="obFlashAct">${safe(action.label)}</button>`:'');
    if(action) el('obFlashAct').onclick=action.fn;
    clearTimeout(flash.t); flash.t=setTimeout(()=>{ f.className='ls-flash'; f.textContent=''; },action?15000:kind==='bad'?6000:2200);
  }
  function showLast(title,v,kind,label){
    const b=el('obLast'); if(!b) return;
    b.hidden=false; b.className='ls-last ls-last-'+kind;
    b.innerHTML=`<div class="ls-last-top"><span class="ls-last-n">${safe(title)}</span><span class="ls-last-lbl">${safe(label)}</span></div><div class="ls-last-v">${safe(v)}</div>`;
    void b.offsetWidth; b.classList.add('ls-last-pop');
  }
  function block(v,msg,action){ tone('bad'); flash('bad','✕ NOT ADDED — '+msg,action); showLast('✕',v,'bad',msg); }

  // ================================================================ scanning
  function readyToScan(){
    if(!load||load.status!=='open') return 'This load is closed — reopen it to make changes';
    if(!load.warehouse) return 'Pick the warehouse first';
    if(!load.subCust) return 'Pick the sub-customer first';
    if(!load.lines.length) return 'Add at least one order line first';
    return null;
  }
  function addScan(raw,source){
    const v=cleanScan(raw); if(!v) return false;
    pendingBlock=null;
    const notReady=readyToScan(); if(notReady){ block(v,notReady); return false; }
    const dupAt=load.scans.findIndex(s=>sameId(s.lwh,v)||(s.cust&&sameId(s.cust,v)));
    if(dupAt>=0){ block(v,`already on this load (pallet #${dupAt+1})`); highlight(load.scans[dupAt].lwh); return false; }
    const matches=lookup(v);
    if(!matches.length){
      block(v,'not found in inventory. Check the tag — or, if it\'s a new receipt, a manager can add it as an exception.',{label:'Add as exception (manager)',fn:()=>exceptionDialog(v,source)});
      return false;
    }
    let mine=matches.filter(r=>r.sub===load.subCust);
    if(!mine.length){ const who=[...new Set(matches.map(r=>r.sub))].join(', '); block(v,`belongs to ${who}, not ${load.subCust}`); return false; }
    if(mine.length>1){ const here=mine.filter(r=>r.wh===load.warehouse); if(here.length) mine=here; }
    if(mine.length>1){ block(v,`matches ${mine.length} pallets — scan the LWH ID tag instead`); return false; }
    const r=mine[0];
    if(onThisLoad(r)){ const i=load.scans.findIndex(s=>sameId(s.lwh,r.lwh)); block(v,`already on this load (pallet #${i+1}, LWH ${r.lwh})`); highlight(r.lwh); return false; }
    const other=shippedElsewhere(r); if(other){ block(v,`LWH ${r.lwh} is already on BOL ${other}`); return false; }
    const pl=pickLine(r); if(pl.err){ block(v,pl.err); return false; }
    if(r.wh&&r.wh!==load.warehouse){
      block(v,`inventory shows LWH ${r.lwh} in ${r.wh}, not ${load.warehouse}`,{label:'It\'s here — override (manager)',fn:()=>overrideDialog({kind:'warehouse',title:'Pallet in a different warehouse',detail:`Inventory shows LWH ${r.lwh} in ${r.wh}. This load ships from ${load.warehouse}.`}).then(o=>{ if(o) commit(r,pl.line,source,v,{ovr:o}); })});
      return false;
    }
    commit(r,pl.line,source,v);
    return true;
  }
  function commit(r,line,source,raw,extra){
    extra=extra||{};
    load.scans.push({lwh:r.lwh,cust:r.cust||'',item:r.item,desc:r.desc||line.desc||'',lot:r.lot||'',qty:r.qty,lineId:line.id,wh:r.wh||load.warehouse,
      t:new Date().toISOString(),by:load.by||userName(),src:source||'scanner',raw:raw||'',exc:!!extra.exc,ovr:extra.ovr||null,conflict:null});
    if(extra.ovr) logEvent(load,`${extra.exc?'Exception pallet':'Override'} ${r.lwh}: ${extra.ovr.reason} (manager ${extra.ovr.by}${extra.ovr.verified?'':' — not verified, offline'})`);
    save();
    const p=lineProgress(line), all=load.lines.every(l=>lineProgress(l).done);
    const n=load.scans.length;
    const lineTxt=`Item ${line.item}: ${fmtN(p.have)} of ${fmtN(p.need)} ${line.mode==='units'?'qty':'pallets'}`;
    if(all){ tone('done'); flash('ok',`Pallet #${n} added — every line is complete. Ready to close the load.`); showLast('#'+n,r.lwh,'ok','Added — load complete'); }
    else if(p.over){ tone('bad'); flash('warn',`Pallet #${n} added — ${lineTxt}, over by ${fmtN(p.over)}`); showLast('#'+n,r.lwh,'warn','Added — line over'); }
    else if(extra.ovr){ tone('ok'); flash('warn',`Pallet #${n} added with manager ${extra.exc?'exception':'override'} — ${lineTxt}`); showLast('#'+n,r.lwh,'warn','Added — '+(extra.exc?'exception':'override')); }
    else { tone(p.done?'done':'ok'); flash('ok',`Pallet #${n} added — ${lineTxt}${p.done?' ✓ line complete':''}`); showLast('#'+n,r.lwh,'ok',p.done?'Added — line complete':'Added'); }
    render();
  }
  function submitInput(){ const inp=el('obInput'); const v=inp.value; inp.value=''; burst=[]; if(v.trim()) addScan(v,'scanner'); inp.focus(); }
  function highlight(lwh){ const row=document.querySelector(`[data-ob-scan="${CSS.escape(lwh)}"]`); if(row){ row.classList.remove('ls-hit'); void row.offsetWidth; row.classList.add('ls-hit'); row.scrollIntoView({block:'nearest',behavior:'smooth'}); } }

  async function startCamera(){
    if(cam) return stopCamera();
    if(typeof Html5Qrcode==='undefined'){ alert('The camera scanner didn\'t load — check your connection. A plugged-in or Bluetooth scanner still works.'); return; }
    el('obCamWrap').hidden=false; el('obCamBtn').textContent='Stop camera';
    const formats=window.Html5QrcodeSupportedFormats?[Html5QrcodeSupportedFormats.CODE_128,Html5QrcodeSupportedFormats.CODE_39,Html5QrcodeSupportedFormats.ITF,Html5QrcodeSupportedFormats.EAN_13,Html5QrcodeSupportedFormats.UPC_A,Html5QrcodeSupportedFormats.QR_CODE,Html5QrcodeSupportedFormats.DATA_MATRIX]:undefined;
    const cfg={fps:12,qrbox:(w,h)=>({width:Math.min(w*0.9,420),height:Math.min(h*0.45,180)}),formatsToSupport:formats};
    cam=new Html5Qrcode('obCam');
    const onHit=txt=>{ const v=cleanScan(txt), now=Date.now(); if(v===camLast.v&&now-camLast.t<3000){ camLast.t=now; return; } camLast={v,t:now}; addScan(v,'camera'); };
    try{ await cam.start({facingMode:'environment'},cfg,onHit,()=>{}); el('obCamHint').textContent='Point at each pallet tag — it adds them one after another.'; }
    catch(e){ el('obCamHint').textContent='Camera error: '+e.message+' — allow camera access, or use a scanner.'; cam=null; el('obCamBtn').textContent='Use camera'; }
  }
  function stopCamera(){ const c=cam; cam=null; if(c){ try{ c.stop().then(()=>c.clear()).catch(()=>{}); }catch(e){} } const w=el('obCamWrap'); if(w) w.hidden=true; const b=el('obCamBtn'); if(b) b.textContent='Use camera'; }

  // ================================================================ dialogs
  function modal(html){
    return new Promise(resolve=>{
      const m=el('obModal'); m.hidden=false; el('obModalBody').innerHTML=html;
      const done=v=>{ m.hidden=true; el('obModalBody').innerHTML=''; resolve(v); };
      m.onclick=e=>{ if(e.target===m) done(null); };
      el('obModalBody').querySelectorAll('[data-ob-cancel]').forEach(b=>b.onclick=()=>done(null));
      modal.done=done;
      const f=el('obModalBody').querySelector('input,select,textarea'); if(f) setTimeout(()=>f.focus(),50);
    });
  }
  function getPass(){ try{ return sessionStorage.getItem(MGR_PASS_KEY)||''; }catch{ return ''; } }
  function setPass(v){ try{ v?sessionStorage.setItem(MGR_PASS_KEY,v):sessionStorage.removeItem(MGR_PASS_KEY); }catch{} }
  // Checks the manager passcode in Supabase. If the hotspot is down the
  // override still goes through, but it's recorded as "not verified".
  async function verifyPass(pass){
    try{ const r=await rpc('toolkit_outbound_verify',{p_passcode:pass}); if(r&&r.ok) return {ok:true,verified:true};
      return {ok:false,msg:r.error==='bad_passcode'?'That passcode isn\'t right.':r.error==='locked'?'Too many wrong tries — locked for a few minutes.':r.error==='not_set_up'?'The manager passcode hasn\'t been set up yet.':'Couldn\'t check the passcode.'}; }
    catch(e){ if(e.setup) return {ok:false,msg:'Outbound records aren\'t set up yet — run sql/outbound_loads.sql in Supabase.'}; return {ok:true,verified:false}; }
  }
  function managerFields(reasonLabel,reasonPh){
    return `<label class="ps-field"><span>Manager name</span><input id="obMgrName" autocomplete="off" /></label>
      <label class="ps-field"><span>${safe(reasonLabel||'Reason')}</span><input id="obMgrReason" autocomplete="off" placeholder="${safe(reasonPh||'')}" /></label>
      <label class="ps-field"><span>Manager passcode</span><input id="obMgrPass" type="password" autocomplete="current-password" placeholder="Same as Missed Punches" /></label>
      <div id="obMgrErr" class="ob-err" hidden></div>`;
  }
  async function readManager(){
    const name=el('obMgrName').value.trim(), reason=el('obMgrReason').value.trim(), pass=el('obMgrPass').value.trim()||getPass();
    const err=m=>{ const e=el('obMgrErr'); e.hidden=false; e.textContent=m; return null; };
    if(!name) return err('Enter the manager\'s name.');
    if(!reason) return err('Enter the reason.');
    if(!pass) return err('Enter the manager passcode.');
    el('obMgrErr').hidden=false; el('obMgrErr').textContent='Checking…';
    const v=await verifyPass(pass);
    if(!v.ok) return err(v.msg);
    setPass(pass);
    if(!v.verified&&!confirm('No connection — the passcode can\'t be checked right now. Record this as an unverified manager approval?')) return err('Cancelled.');
    return {by:name,reason,verified:v.verified,at:new Date().toISOString()};
  }
  function overrideDialog(o){
    const p=modal(`<h3>${safe(o.title)}</h3><p class="hint">${safe(o.detail)}</p>${managerFields(o.reasonLabel,o.reasonPh)}
      <div class="ob-modal-act"><button type="button" class="ghost" data-ob-cancel>Cancel</button><button type="button" id="obMgrOk">${safe(o.ok||'Approve')}</button></div>`);
    el('obMgrOk').onclick=async()=>{ const m=await readManager(); if(m){ m.kind=o.kind; modal.done(m); } };
    return p;
  }
  function exceptionDialog(v,source){
    const lines=load.lines.map(l=>`<option value="${safe(l.id)}">${safe(l.item)}${l.desc?' — '+safe(l.desc):''}${l.po?' · PO '+safe(l.po):''}</option>`).join('');
    const p=modal(`<h3>Add pallet that isn't in inventory</h3>
      <p class="hint">Use this only for a pallet that's really here but not in the inventory data yet (a new receipt). It's flagged as an exception on the load and in the WMS re-entry sheet.</p>
      <label class="ps-field"><span>LWH ID</span><input id="obExLwh" value="${safe(v)}" autocomplete="off" /></label>
      <label class="ps-field"><span>Customer ID (if it has one)</span><input id="obExCust" autocomplete="off" /></label>
      <label class="ps-field"><span>Order line / item</span><select id="obExLine">${lines}</select></label>
      <div class="ob-2col"><label class="ps-field"><span>Qty on pallet</span><input id="obExQty" inputmode="decimal" autocomplete="off" /></label>
      <label class="ps-field"><span>Lot / date</span><input id="obExLot" autocomplete="off" /></label></div>
      ${managerFields('Reason','e.g. received 10/5, not synced yet')}
      <div class="ob-modal-act"><button type="button" class="ghost" data-ob-cancel>Cancel</button><button type="button" id="obMgrOk">Add pallet</button></div>`);
    el('obMgrOk').onclick=async()=>{
      const lwh=cleanScan(el('obExLwh').value), qty=num(el('obExQty').value), line=load.lines.find(l=>l.id===el('obExLine').value);
      const err=m=>{ const e=el('obMgrErr'); e.hidden=false; e.textContent=m; };
      if(!lwh) return err('Enter the LWH ID.');
      if(!(qty>0)) return err('Enter the quantity on the pallet.');
      if(!line) return err('Pick the order line.');
      if(load.scans.some(s=>sameId(s.lwh,lwh))) return err('That pallet is already on this load.');
      const other=shippedElsewhere({lwh,cust:cleanScan(el('obExCust').value)}); if(other) return err(`That pallet is already on BOL ${other}.`);
      const cust=cleanScan(el('obExCust').value), lot=el('obExLot').value.trim();
      const m=await readManager(); if(!m) return;
      m.kind='not_in_inventory';
      modal.done(true);
      commit({lwh,cust,item:line.item,desc:line.desc,lot,qty,wh:load.warehouse},line,source,v,{exc:true,ovr:m});
    };
    return p;
  }

  // ================================================================ parties (smart save)
  function localParties(){ return LWHStorage.get(PARTY_KEY,[])||[]; }
  function partyKey(kind,p){ return (kind+'|'+clean(p.name)+'|'+clean(p.addr1)).toLowerCase(); }
  function learnParties(L){
    const list=localParties();
    PARTY_KINDS.forEach(([k,kind])=>{ const p=L[k]; if(!p||!clean(p.name)) return;
      const key=partyKey(kind,p); let o=list.find(x=>x.key===key);
      if(!o){ o={key,kind,subs:{},uses:0}; list.push(o); }
      Object.assign(o,{name:p.name,code:p.code||'',addr1:p.addr1||'',city:p.city||'',phone:p.phone||'',last:new Date().toISOString()}); o.uses=(o.uses||0)+1;
      if(L.subCust) o.subs[L.subCust]=(o.subs[L.subCust]||0)+1; });
    LWHStorage.set(PARTY_KEY,list.sort((a,b)=>(b.last||'').localeCompare(a.last||'')).slice(0,400));
    if(L.warehouse&&clean(L.shipFrom.name)){ const m=LWHStorage.get(FROM_BY_WH,{})||{}; m[L.warehouse]=L.shipFrom; LWHStorage.set(FROM_BY_WH,m); }
    if(L.subCust&&clean(L.billTo.name)){ const m=LWHStorage.get(BILL_BY_SUB,{})||{}; m[L.subCust]=L.billTo; LWHStorage.set(BILL_BY_SUB,m); }
    if(clean(L.carrier)){ const c=(LWHStorage.get(CARRIER_KEY,[])||[]).filter(x=>x.toLowerCase()!==L.carrier.toLowerCase()); c.unshift(L.carrier); LWHStorage.set(CARRIER_KEY,c.slice(0,60)); }
  }
  function partySuggestions(kind,q){
    q=clean(q).toLowerCase();
    const seen=new Set(), out=[];
    const score=p=>(p.subs&&load.subCust&&p.subs[load.subCust]?1000*p.subs[load.subCust]:0)+(p.uses||0);
    const loc=localParties().filter(p=>p.kind===kind).sort((a,b)=>score(b)-score(a));
    const srv=(lookups.parties||[]).filter(p=>p.kind===kind);
    [...loc,...srv].forEach(p=>{ const key=partyKey(kind,p); if(seen.has(key)) return;
      const hay=[p.name,p.code,p.addr1,p.city].join(' ').toLowerCase(); if(q&&!hay.includes(q)) return;
      seen.add(key); out.push(p); });
    return out.slice(0,8);
  }
  function renderParties(){
    const box=el('obParties'); if(!box) return;
    box.innerHTML=PARTY_KINDS.map(([k,kind,label])=>{ const p=load[k]||blankParty();
      return `<div class="ob-party" data-party="${k}">
        <div class="ob-party-head"><b>${label}</b><span class="hint">start typing — saved addresses pop up</span></div>
        <div class="ob-party-grid">
          <label class="ps-field ob-pname"><span>Name</span><input data-pf="name" value="${safe(p.name)}" autocomplete="off" /><div class="ob-suggest" hidden></div></label>
          <label class="ps-field"><span>Code / #</span><input data-pf="code" value="${safe(p.code)}" autocomplete="off" /></label>
          <label class="ps-field ob-wide"><span>Street address</span><input data-pf="addr1" value="${safe(p.addr1)}" autocomplete="off" /></label>
          <label class="ps-field"><span>City, ST ZIP</span><input data-pf="city" value="${safe(p.city)}" autocomplete="off" /></label>
          <label class="ps-field"><span>Phone</span><input data-pf="phone" value="${safe(p.phone)}" autocomplete="off" inputmode="tel" /></label>
        </div></div>`; }).join('');
    box.querySelectorAll('.ob-party').forEach(card=>{
      const k=card.dataset.party, kind=PARTY_KINDS.find(x=>x[0]===k)[1];
      const sug=card.querySelector('.ob-suggest'), nameInp=card.querySelector('[data-pf="name"]');
      card.querySelectorAll('[data-pf]').forEach(inp=>inp.addEventListener('input',()=>{ load[k][inp.dataset.pf]=inp.value; save(); renderChecklist(); if(inp===nameInp) showSug(); }));
      const showSug=()=>{
        if(load.status!=='open'){ sug.hidden=true; return; }
        const list=partySuggestions(kind,nameInp.value);
        if(!list.length){ sug.hidden=true; return; }
        sug.innerHTML=list.map((p,i)=>`<button type="button" data-sug="${i}"><b>${safe(p.name)}</b>${p.code?` <span class="ob-code">${safe(p.code)}</span>`:''}<span>${safe([p.addr1,p.city].filter(Boolean).join(', '))}</span></button>`).join('');
        sug.hidden=false;
        sug.querySelectorAll('[data-sug]').forEach(b=>b.onmousedown=e=>{ e.preventDefault(); const p=list[+b.dataset.sug];
          load[k]={name:p.name||'',code:p.code||'',addr1:p.addr1||'',city:p.city||'',phone:p.phone||''}; save(); renderParties(); renderChecklist(); });
      };
      nameInp.addEventListener('focus',showSug);
      nameInp.addEventListener('blur',()=>setTimeout(()=>{ sug.hidden=true; },150));
    });
    lockFields();
  }

  // ================================================================ render — editor
  function isEditorOpen(){ const v=el('outbound'); return v&&v.classList.contains('active')&&!el('obEditor').hidden; }
  function fieldsToUi(){
    fillWarehouses(); fillSubs();
    [['obBol','bol'],['obBillRef','billRef'],['obAppt','appt'],['obPro','pro'],['obCarrier','carrier'],['obTrailer','trailer'],['obSeal','seal'],['obBy','by'],['obComments','comments']].forEach(([id,k])=>{ el(id).value=load[k]||''; });
    renderParties(); fillCarriers();
  }
  function fillWarehouses(){
    const s=el('obWarehouse'), list=warehouses(); if(load.warehouse&&!list.includes(load.warehouse)) list.unshift(load.warehouse);
    s.innerHTML='<option value="">Select warehouse…</option>'+list.map(w=>`<option${w===load.warehouse?' selected':''}>${safe(w)}</option>`).join('');
  }
  function fillSubs(){
    const s=el('obSubCust'), list=load.warehouse?subCustomers(load.warehouse):[]; if(load.subCust&&!list.includes(load.subCust)) list.unshift(load.subCust);
    s.innerHTML=`<option value="">${load.warehouse?'Select sub-customer…':'Pick the warehouse first'}</option>`+list.map(c=>`<option${c===load.subCust?' selected':''}>${safe(c)}</option>`).join('');
  }
  function fillCarriers(){
    const set=new Set([...(LWHStorage.get(CARRIER_KEY,[])||[]),...(lookups.carriers||[])]);
    el('obCarrierList').innerHTML=[...set].slice(0,80).map(c=>`<option value="${safe(c)}"></option>`).join('');
  }
  function fillItems(){
    const s=el('obItem'); if(!s) return;
    const q=clean(el('obItemFilter').value).toLowerCase();
    const items=(load.warehouse&&load.subCust)?itemsForLoad():[];
    const shown=items.filter(it=>!q||(it.item+' '+it.desc).toLowerCase().includes(q));
    s.innerHTML=(!load.subCust?'<option value="">Pick the sub-customer first</option>':`<option value="">${shown.length?'Select item…':'No matching items in stock'}</option>`)+
      shown.map(it=>`<option value="${safe(it.item)}">${safe(it.item)}${it.desc?' — '+safe(it.desc):''}  (${it.pallets} plt · ${fmtN(it.units)} qty)</option>`).join('')+
      (load.subCust?'<option value="__other">Item not listed…</option>':'');
    if(s._keep&&[...s.options].some(o=>o.value===s._keep)) s.value=s._keep;
    updateLineForm();
  }
  function updateLineForm(){
    const mode=el('obMode').value;
    el('obIdsWrap').hidden=mode!=='ids'; el('obAmtWrap').hidden=mode==='ids';
    el('obAmtLabel').textContent=mode==='units'?'Total qty (pieces)':'Pallets';
    const item=el('obItem').value, hint=el('obItemHint');
    if(item&&item!=='__other'){ const a=availableFor(item); hint.textContent=`${a.length} pallet${a.length===1?'':'s'} · ${fmtN(a.reduce((x,r)=>x+r.qty,0))} qty available for ${load.subCust} in ${load.warehouse}`; }
    else hint.textContent='';
  }
  function addLine(){
    if(load.status!=='open') return;
    let item=el('obItem').value, desc='';
    const err=m=>{ el('obLineErr').hidden=false; el('obLineErr').textContent=m; };
    el('obLineErr').hidden=true;
    if(!load.warehouse||!load.subCust) return err('Pick the warehouse and sub-customer first.');
    if(!item) return err('Pick an item.');
    if(item==='__other'){
      item=clean(prompt('Item number (not in current inventory):')||''); if(!item) return;
      desc=clean(prompt('Item description:')||'');
    } else { const it=itemsForLoad().find(x=>x.item===item); desc=it?it.desc:''; }
    const mode=el('obMode').value, po=el('obPo').value.trim();
    const line={id:Date.now().toString(36)+Math.random().toString(36).slice(2,5),item,desc,mode,target:0,ids:[],po};
    if(mode==='ids'){
      const raw=el('obIds').value.split(/[\s,;]+/).map(cleanScan).filter(Boolean);
      if(!raw.length) return err('Enter or scan the pallet IDs (one per line).');
      const bad=[], ids=[];
      raw.forEach(v=>{ const m=lookup(v).filter(r=>r.sub===load.subCust);
        if(!m.length) bad.push(`${v}: not found for ${load.subCust}`);
        else if(m[0].item!==item) bad.push(`${v}: is item ${m[0].item}, not ${item}`);
        else if(shippedElsewhere(m[0])) bad.push(`${v}: already on BOL ${shippedElsewhere(m[0])}`);
        else if(!ids.includes(m[0].lwh)) ids.push(m[0].lwh); });
      if(bad.length) return err('Fix these IDs first — '+bad.join(' · '));
      line.ids=ids; line.target=ids.length;
    } else {
      const n=num(el('obAmt').value); if(!(n>0)) return err(`Enter how many ${mode==='units'?'qty':'pallets'}.`);
      if(mode==='pallets'&&n!==Math.floor(n)) return err('Pallets must be a whole number.');
      line.target=n;
      const avail=availableFor(item); const have=mode==='units'?avail.reduce((a,r)=>a+r.qty,0):avail.length;
      if(item===el('obItem').value&&n>have&&!confirm(`Only ${fmtN(have)} ${mode==='units'?'qty':'pallets'} of ${item} show as available. Add the line anyway?`)) return;
    }
    load.lines.push(line); logEvent(load,`Added line ${item} — ${mode==='ids'?line.ids.length+' pallet IDs':fmtN(line.target)+' '+(mode==='units'?'qty':mode)}${po?' · PO '+po:''}`);
    el('obAmt').value=''; el('obIds').value=''; el('obPo').value=''; el('obItem').value=''; el('obItem')._keep=''; el('obItemFilter').value='';
    save(); render(); el('obInput').focus();
  }
  function renderLines(){
    const box=el('obLines');
    if(!load.lines.length){ box.innerHTML='<div class="ls-empty">No order lines yet. Pick an item above and add it.</div>'; return; }
    box.innerHTML=load.lines.map(l=>{ const p=lineProgress(l), pct=p.need?Math.min(100,Math.round(p.have/p.need*100)):0;
      return `<div class="ob-line${p.done?' ob-line-done':''}">
        <div class="ob-line-top"><div><b>${safe(l.item)}</b>${l.desc?` <span class="ob-desc">${safe(l.desc)}</span>`:''}${l.po?` <span class="ls-tag">PO ${safe(l.po)}</span>`:''}</div>
          <div class="ob-line-n">${fmtN(p.have)} / ${fmtN(p.need)} <span>${l.mode==='units'?'qty':'pallets'}</span></div></div>
        <div class="ps-progress"><div style="width:${pct}%" class="${p.done?'ls-bar-done':''}"></div></div>
        <div class="ob-line-sub">${p.pallets} pallet${p.pallets===1?'':'s'} · ${fmtN(p.units)} qty${l.mode==='ids'?` · specific IDs: ${l.ids.map(safe).join(', ')}`:''}${p.over?` · <b class="ob-over">over by ${fmtN(p.over)}</b>`:''}
          ${load.status==='open'?`<span class="ob-line-act">${l.mode!=='ids'?`<button type="button" class="mh-link" data-line-edit="${l.id}">Change</button>`:''}<button type="button" class="mh-link" data-line-del="${l.id}">Remove</button></span>`:''}</div>
      </div>`; }).join('');
    box.querySelectorAll('[data-line-del]').forEach(b=>b.onclick=()=>{ const l=load.lines.find(x=>x.id===b.dataset.lineDel);
      if(lineScans(l).length) return alert(`${lineScans(l).length} pallet(s) are scanned on this line. Remove those pallets first.`);
      if(!confirm(`Remove the line for item ${l.item}?`)) return;
      load.lines=load.lines.filter(x=>x!==l); logEvent(load,`Removed line ${l.item}`); save(); render(); });
    box.querySelectorAll('[data-line-edit]').forEach(b=>b.onclick=()=>{ const l=load.lines.find(x=>x.id===b.dataset.lineEdit);
      const v=prompt(`New ${l.mode==='units'?'total qty':'pallet count'} for item ${l.item}:`,l.target); if(v===null) return; const n=num(v);
      if(!(n>0)||(l.mode==='pallets'&&n!==Math.floor(n))) return alert('Enter a valid number.');
      logEvent(load,`Changed line ${l.item} from ${l.target} to ${n} ${l.mode==='units'?'qty':l.mode}`); l.target=n; save(); render(); });
  }
  function renderScans(){
    const box=el('obScanList'), n=load.scans.length;
    el('obScanHead').textContent=`Pallets on this load (${n})`;
    if(!n){ box.innerHTML='<div class="ls-empty">No pallets yet. Scan the first pallet tag.</div>'; return; }
    box.innerHTML=load.scans.map((s,i)=>({s,i})).reverse().map(({s,i})=>`
      <div class="ls-row ob-scan-row${s.conflict?' ob-row-bad':(s.exc||s.ovr)?' ls-odd':''}" data-ob-scan="${safe(s.lwh)}">
        <div class="ls-n">${i+1}</div>
        <div><div class="ls-v">${safe(s.lwh)}${s.cust?` <span class="ob-cust">${safe(s.cust)}</span>`:''}</div>
          <div class="ob-scan-sub">${safe(s.item)} · qty ${fmtN(s.qty)}${s.lot?' · lot '+safe(s.lot):''}${s.exc?'<span class="ls-tag">exception</span>':''}${s.ovr&&!s.exc?'<span class="ls-tag">override</span>':''}${s.conflict?`<span class="ls-tag ob-tag-bad">also on BOL ${safe(s.conflict)} — remove it</span>`:''}</div></div>
        <div class="ls-t">${fmtTime(s.t)}${s.src==='camera'?' · cam':''}</div>
        ${load.status==='open'?`<button type="button" class="ls-del" data-scan-del="${i}" aria-label="Remove pallet ${i+1}">✕</button>`:'<span></span>'}
      </div>`).join('');
    box.querySelectorAll('[data-scan-del]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.scanDel, s=load.scans[i];
      if(!confirm(`Take pallet #${i+1} (LWH ${s.lwh}) off this load?`)) return;
      load.scans.splice(i,1); logEvent(load,`Removed pallet ${s.lwh}`); save(); render(); flash('warn',`Removed LWH ${s.lwh}`); });
  }
  function totals(L){ L=L||load; return {pallets:L.scans.length,units:L.scans.reduce((a,s)=>a+num(s.qty),0)}; }
  function checklist(){
    const L=load, t=totals(), c=[];
    const add=(ok,txt,soft)=>c.push({ok,txt,soft});
    add(!!L.warehouse&&!!L.subCust,'Warehouse and sub-customer');
    add(!!clean(L.bol),'BOL #');
    add(!!clean(L.shipFrom.name)&&!!clean(L.shipFrom.addr1),'Ship from name and address');
    add(!!clean(L.shipTo.name)&&!!clean(L.shipTo.addr1)&&!!clean(L.shipTo.city),'Ship to name, address and city');
    add(!!clean(L.billTo.name),'Bill to');
    add(!!clean(L.carrier),'Carrier');
    add(!!clean(L.trailer),'Trailer #');
    add(!!clean(L.seal),'Seal #');
    add(t.pallets>0,'At least one pallet scanned');
    const conf=L.scans.filter(s=>s.conflict).length; add(!conf,conf?`${conf} pallet${conf===1?' is':'s are'} also on another BOL`:'No pallets on another BOL');
    const short=L.lines.filter(l=>!lineProgress(l).done); add(!short.length,short.length?`${short.length} line${short.length===1?' is':'s are'} short (needs a manager to ship short)`:'Every line complete',true);
    add(!!clean(L.billRef),'Bill To Ref #',true);
    return c;
  }
  function renderChecklist(){
    const box=el('obChecklist'); if(!box) return;
    if(load.status!=='open'){
      box.innerHTML=`<div class="ob-closed-note">${load.status==='void'?'✕ Voided':'✓ Closed'} ${fmtStamp(load.closed||load.updated)}${load.closedBy?' by '+safe(load.closedBy):''}</div>`;
    } else box.innerHTML=checklist().map(x=>`<div class="ob-chk ${x.ok?'ok':x.soft?'soft':'no'}">${x.ok?'✓':x.soft?'!':'○'} ${safe(x.txt)}</div>`).join('');
  }
  function lockFields(){
    const open=load&&load.status==='open';
    document.querySelectorAll('#obEditor [data-ob-lock]').forEach(x=>{ x.disabled=!open; });
    document.querySelectorAll('#obParties input').forEach(x=>{ x.disabled=!open; });
    if(load&&load.scans.length){ el('obWarehouse').disabled=true; el('obSubCust').disabled=true; }
  }
  function render(){
    if(!load) return;
    const t=totals();
    el('obTitleBol').textContent=load.bol||'(no BOL #)';
    const pill=el('obStatus'); pill.textContent=load.status==='open'?'Open':load.status==='closed'?'Closed':'Void'; pill.className='ob-pill ob-pill-'+load.status;
    el('obTitleSub').textContent=[load.subCust,load.warehouse,load.shipTo.name?'→ '+load.shipTo.name:''].filter(Boolean).join(' · ');
    el('obCount').textContent=t.pallets; el('obUnits').textContent=fmtN(t.units);
    const need=load.lines.reduce((a,l)=>a+(l.mode==='units'?0:l.target),0);
    const done=load.lines.length&&load.lines.every(l=>lineProgress(l).done);
    el('obCountCard').classList.toggle('ls-complete',!!done);
    el('obCountNote').textContent=!load.lines.length?'Add order lines, then scan pallets':done?'Every line complete — ready to close':`${load.lines.filter(l=>!lineProgress(l).done).length} line(s) still open${need?` · ${need} pallets ordered on pallet lines`:''}`;
    const nr=readyToScan(); el('obScanBlocked').hidden=!nr||load.status!=='open'; el('obScanBlocked').textContent=nr||'';
    el('obClose').hidden=load.status!=='open'; el('obReopen').hidden=load.status!=='closed';
    el('obDelete').textContent=load.status==='void'?'Remove from this device':(load.scans.length||load.status==='closed')?'Void load…':'Delete load';
    ['obPrint','obWms','obXlsx','obCsv'].forEach(id=>{ el(id).disabled=!t.pallets; });
    el('obPrint').textContent=load.status==='closed'?'Print BOL':'Print draft BOL';
    renderLines(); renderScans(); renderChecklist(); fillItems(); renderSync(); lockFields();
  }

  // ================================================================ render — list screen
  function showList(){
    stopCamera(); el('obEditor').hidden=true; el('obListScreen').hidden=false; LWHStorage.set(CUR_KEY,null); load=null; renderList(); window.scrollTo(0,0);
  }
  function openLoad(id){
    const L=loads.find(x=>x.id===id); if(!L) return;
    load=L; LWHStorage.set(CUR_KEY,id);
    el('obListScreen').hidden=true; el('obEditor').hidden=false;
    el('obLast').hidden=true; el('obFlash').className='ls-flash'; el('obFlash').textContent='';
    fieldsToUi(); render(); window.scrollTo(0,0);
    refreshShipped();
  }
  function newLoad(){
    const L=blankLoad();
    loads.unshift(L); logEvent(L,'Load created'); load=L; persistLoads(); openLoad(L.id);
    if(!userName()) setTimeout(()=>el('obBy').focus(),100); else el('obWarehouse').focus();
  }
  function renderList(){
    const box=el('obLoadList'); if(!box) return;
    const open=loads.filter(L=>L.status==='open'), done=loads.filter(L=>L.status!=='open');
    const row=L=>{ const t=totals(L), st=L.sync, cur=st&&st.state==='saved'&&st.sig===sig(L);
      return `<button type="button" class="ob-load-row ob-st-${L.status}" data-ob-open="${L.id}">
        <div><b>${safe(L.bol||'(no BOL #)')}</b> <span class="ob-pill ob-pill-${L.status}">${L.status==='open'?'Open':L.status==='closed'?'Closed':'Void'}</span>
          <div class="db-sub">${safe([L.subCust,L.warehouse,L.shipTo.name&&'→ '+L.shipTo.name,L.trailer&&'Trailer '+L.trailer].filter(Boolean).join(' · ')||'New load')}</div>
          <div class="db-sub">${fmtDate(L.closed||L.created)} ${fmtTime(L.closed||L.created)}${L.billRef?' · Ref '+safe(L.billRef):''}${cur?' · ✓ saved':' · <b class="ob-unsaved">not saved to records yet</b>'}</div></div>
        <div class="ob-load-n">${t.pallets}<span>pallets</span></div></button>`; };
    box.innerHTML=(open.length?`<div class="ob-list-h">Open loads</div>${open.map(row).join('')}`:'<div class="hint" style="padding:6px 0 10px">No open loads on this device. Start one with New load.</div>')+
      (done.length?`<div class="ob-list-h">Closed on this device</div>${done.slice(0,30).map(row).join('')}`:'');
    box.querySelectorAll('[data-ob-open]').forEach(b=>b.onclick=()=>openLoad(b.dataset.obOpen));
    renderInvStatus(); renderSync();
  }
  function renderInvStatus(){
    const s=el('obInvStatus'); if(!s) return;
    const n=inv().rows.length, asOf=invAsOf();
    s.className='ob-inv '+(n?'ok':'bad');
    s.textContent=n?`Inventory: ${n.toLocaleString()} pallets loaded${asOf?' · data as of '+asOf:''}${shippedAt?' · shipped list checked '+fmtTime(shippedAt):''}`:'Inventory isn\'t loaded yet — tap Refresh inventory (needs a connection).';
  }
  async function refreshInventory(){
    const s=el('obInvStatus'); if(s){ s.className='ob-inv'; s.textContent='Refreshing inventory…'; }
    try{ await LWHInventory.loadCustomerFromUrl(); }catch(e){ LWHUI.toast('Couldn\'t refresh inventory — using what\'s saved on this device'); }
    await refreshShipped(); renderInvStatus(); if(load&&isEditorOpen()){ fillWarehouses(); fillSubs(); render(); }
  }

  // ================================================================ sync (records)
  let syncTimer=null, syncing=false, syncAgain=false, retryMs=10000, setupMissing=false;
  async function rpc(fn,body){
    const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`,{method:'POST',headers:{'apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(res.status===404){ const e=new Error('not_set_up'); e.setup=true; throw e; }
    if(!res.ok) throw new Error('HTTP '+res.status);
    return res.json();
  }
  function deviceLabel(){ const u=navigator.userAgent||''; const k=/Android/i.test(u)?'Android':/iPhone|iPad/i.test(u)?'iPhone/iPad':/Windows/i.test(u)?'Windows':/Mac/i.test(u)?'Mac':'Other'; return k+' · '+deviceId().slice(0,6); }
  const party=p=>({name:p.name||'',code:p.code||'',addr1:p.addr1||'',city:p.city||'',phone:p.phone||''});
  function payload(L){
    return {client_key:L.key,bol_no:L.bol,status:L.status==='void'?'open':L.status,warehouse:L.warehouse,sub_customer:L.subCust,bill_to_ref:L.billRef,
      appt:L.appt,pro_no:L.pro,carrier:L.carrier,trailer:L.trailer,seal:L.seal,comments:L.comments,
      ship_from:party(L.shipFrom),ship_to:party(L.shipTo),bill_to:party(L.billTo),
      lines:L.lines,events:L.events||[],created_by:L.by||userName()||null,device:deviceLabel(),
      created_at:L.created,closed_at:L.closed||'',closed_by:L.closedBy||'',
      scans:L.scans.map(s=>({lwh_id:s.lwh,customer_id:s.cust,item:s.item,item_desc:s.desc,lot:s.lot,qty:s.qty,po:(L.lines.find(l=>l.id===s.lineId)||{}).po||'',
        line_id:s.lineId,warehouse:s.wh,scanned_at:s.t,scanned_by:s.by,source:s.src,raw:s.raw,exception:!!s.exc,override:s.ovr||null}))};
  }
  function sig(L){ const p=payload(L); delete p.device; return JSON.stringify(p).length+':'+hash(JSON.stringify(p)); }
  function hash(s){ let h=0; for(let i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))|0; } return h; }
  function scheduleSync(delay){ clearTimeout(syncTimer); syncTimer=setTimeout(syncAll,delay??1200); }
  async function syncOne(L){
    if(L.status==='void'&&L.voidedOnServer) return true;
    const s=sig(L);
    if(L.sync&&L.sync.state==='saved'&&L.sync.sig===s) return true;
    if(!L.subCust&&!L.scans.length&&!L.lines.length) return true;   // nothing worth saving yet
    try{
      const r=await rpc('toolkit_outbound_save',{p_load:payload(L)});
      if(r&&r.voided){ L.status='void'; L.voidedOnServer=true; L.closed=L.closed||new Date().toISOString(); logEvent(L,`Voided by manager ${r.voided_by||''}: ${r.void_reason||''}`);
        L.sync={state:'saved',at:new Date().toISOString(),sig:sig(L)}; persistLoads(); if(load===L) LWHUI.toast(`BOL ${L.bol} was voided by a manager`); return true; }
      if(!r||!r.ok){ const e=new Error(r&&r.error||'save failed'); e.code=r&&r.error; throw e; }
      const conf=new Map((r.conflicts||[]).map(c=>[upper(c.lwh_id),c.bol_no]));
      L.scans.forEach(sc=>{ const b=conf.get(upper(sc.lwh)); if(b){ sc.conflict=b; sc.serverConflict=true; } else if(sc.serverConflict){ sc.serverConflict=false; sc.conflict=null; } });
      L.sync={state:'saved',at:new Date().toISOString(),sig:s,conflicts:conf.size}; setupMissing=false;
      learnParties(L); persistLoads();
      if(conf.size&&load===L){ tone('bad'); flash('bad',`${conf.size} pallet${conf.size===1?' is':'s are'} already on another BOL — see the red rows and take them off`); }
      return true;
    }catch(e){
      if(e.setup) setupMissing=true;
      L.sync={state:'error',at:new Date().toISOString(),msg:e.code==='bol_taken'?'That BOL # is already used on another load — change it':e.message,sig:(L.sync&&L.sync.sig)||''};
      persistLoads(); return e.code==='bol_taken';
    }
  }
  async function syncAll(){
    if(syncing){ syncAgain=true; return; }
    syncing=true; renderSync();
    let ok=true;
    for(const L of loads.slice()){ const r=await syncOne(L); ok=ok&&r; }
    syncing=false;
    if(syncAgain){ syncAgain=false; return syncAll(); }
    if(!ok&&!setupMissing){ clearTimeout(syncTimer); syncTimer=setTimeout(syncAll,retryMs); retryMs=Math.min(retryMs*2,120000); } else retryMs=10000;
    renderSync(); if(load&&isEditorOpen()){ renderScans(); renderChecklist(); } else if(!load) renderList();
  }
  function unsaved(){ return loads.filter(L=>(L.subCust||L.scans.length||L.lines.length)&&!(L.sync&&L.sync.state==='saved'&&L.sync.sig===sig(L))); }
  function renderSync(){
    const nodes=[el('obSync'),el('obListSync')].filter(Boolean); if(!nodes.length) return;
    const pend=unsaved(), cur=load&&pend.includes(load), err=load&&load.sync&&load.sync.state==='error'?load.sync.msg:'';
    let cls, txt;
    if(setupMissing){ cls='bad'; txt='Records not set up yet — run sql/outbound_loads.sql in Supabase. Loads are kept on this device until then.'; }
    else if(syncing){ cls='idle'; txt='Saving to records…'; }
    else if(err&&/BOL #/.test(err)){ cls='bad'; txt=err; }
    else if(!pend.length){ cls='ok'; txt=load&&load.sync?`✓ Saved to records ${fmtTime(load.sync.at)}`:'✓ Everything saved to records'; }
    else { cls='warn'; txt=`Not saved to records yet${pend.length>1||!cur?` (${pend.length} load${pend.length===1?'':'s'})`:''} — kept on this device, will keep retrying${navigator.onLine===false?' when back online':''}`; }
    nodes.forEach(p=>{ p.className='ls-sync ls-sync-'+cls; p.textContent=txt; });
  }

  // ================================================================ close / reopen / void
  async function closeLoad(){
    if(load.status!=='open') return;
    await refreshShipped(); recheckConflicts();
    const c=checklist(), hard=c.filter(x=>!x.ok&&!x.soft);
    if(hard.length){ renderChecklist(); alert('Before closing:\n\n• '+hard.map(x=>x.txt).join('\n• ')); return; }
    const short=load.lines.filter(l=>!lineProgress(l).done);
    let shortOk=null;
    if(short.length){
      shortOk=await overrideDialog({kind:'short_ship',title:'Ship short?',ok:'Approve short ship',reasonLabel:'Reason for shipping short',reasonPh:'e.g. customer cut the order',
        detail:short.map(l=>{ const p=lineProgress(l); return `${l.item}: ${fmtN(p.have)} of ${fmtN(p.need)} ${l.mode==='units'?'qty':'pallets'}`; }).join(' · ')});
      if(!shortOk) return;
    } else if(!confirm(`Close BOL ${load.bol}? ${totals().pallets} pallets, ${fmtN(totals().units)} qty.\n\nAfter closing, the load is locked (a manager can reopen it).`)) return;
    if(!clean(load.billRef)&&!confirm('No Bill To Ref # entered. Close anyway?')) return;
    load.status='closed'; load.closed=new Date().toISOString(); load.closedBy=load.by||userName();
    if(shortOk) logEvent(load,`Closed short — approved by ${shortOk.by}: ${shortOk.reason}${shortOk.verified?'':' (not verified, offline)'}`);
    logEvent(load,'Load closed'); learnParties(load); save(); render(); scheduleSync(50);
    tone('done'); flash('ok',`BOL ${load.bol} closed — printing the BOL`);
    setTimeout(()=>printBol(load),400);
  }
  async function reopenLoad(){
    const o=await overrideDialog({kind:'reopen',title:`Reopen BOL ${load.bol}?`,ok:'Reopen',reasonLabel:'Reason for reopening',detail:'The load goes back to Open so pallets and details can be changed. Reprint the BOL after you close it again.'});
    if(!o) return;
    load.status='open'; load.closed=null; load.closedBy=''; logEvent(load,`Reopened by manager ${o.by}: ${o.reason}${o.verified?'':' (not verified, offline)'}`);
    save(); fieldsToUi(); render();
  }
  async function deleteOrVoid(){
    if(load.status==='void'){ if(!confirm('Remove this voided load from this device? (It stays in records.)')) return; loads=loads.filter(x=>x!==load); persistLoads(); return showList(); }
    if(!load.scans.length&&load.status==='open'){
      if(!confirm('Delete this load? It has no pallets.')) return;
      loads=loads.filter(x=>x!==load); persistLoads(); return showList();
    }
    const o=await overrideDialog({kind:'void',title:`Void BOL ${load.bol}?`,ok:'Void load',reasonLabel:'Reason for voiding',detail:'Voiding takes every pallet off this load so they can go on another load. The load stays in records, marked void. Needs a connection.'});
    if(!o) return;
    if(!o.verified){ alert('Voiding needs a connection so every device stops treating these pallets as shipped. Try again when the hotspot is connected.'); return; }
    try{
      await syncOne(load);
      const r=await rpc('toolkit_outbound_manage',{p_passcode:getPass(),p_client_key:load.key,p_action:'void',p_by:o.by,p_reason:o.reason});
      if(!r.ok&&r.error!=='not_found') throw new Error(r.error);
    }catch(e){ alert('Couldn\'t void it in records: '+e.message); return; }
    load.status='void'; load.voidedOnServer=true; load.closed=load.closed||new Date().toISOString(); logEvent(load,`Voided by manager ${o.by}: ${o.reason}`);
    load.sync={state:'saved',at:new Date().toISOString(),sig:sig(load)};
    persistLoads(); refreshShipped(); render(); LWHUI.toast('Load voided — its pallets are free for another load');
  }

  // ================================================================ BOL print
  function company(){ return Object.assign({},DEFAULT_CO,LWHStorage.get(CO_KEY,{})||{}); }
  function natural(a,b){ return String(a||'').localeCompare(String(b||''),undefined,{numeric:true}); }
  function bolRows(L){
    // grouped by order line (item), then lot — with a lot total after each lot like the WMS BOL
    const rows=[], lineOrder=L.lines.map(l=>l.id);
    const byItem=new Map();
    L.scans.forEach((s,i)=>{ const k=s.item; if(!byItem.has(k)) byItem.set(k,[]); byItem.get(k).push({...s,_i:i}); });
    const items=[...byItem.keys()].sort((a,b)=>{ const ia=lineOrder.indexOf((byItem.get(a)[0]||{}).lineId), ib=lineOrder.indexOf((byItem.get(b)[0]||{}).lineId); return (ia-ib)||natural(a,b); });
    items.forEach(item=>{
      const sc=byItem.get(item), lots=new Map();
      sc.forEach(s=>{ const k=s.lot||''; if(!lots.has(k)) lots.set(k,[]); lots.get(k).push(s); });
      const lotKeys=[...lots.keys()].sort(natural);
      lotKeys.forEach(lk=>{ const ls=lots.get(lk).sort((a,b)=>a._i-b._i);
        ls.forEach(s=>rows.push({type:'row',s,po:(L.lines.find(l=>l.id===s.lineId)||{}).po||''}));
        rows.push({type:'lot',pallets:ls.length,qty:ls.reduce((a,s)=>a+num(s.qty),0)}); });
      if(lotKeys.length>1) rows.push({type:'item',item,pallets:sc.length,qty:sc.reduce((a,s)=>a+num(s.qty),0)});
    });
    return rows;
  }
  function summary(L){
    const m=new Map();
    L.scans.forEach(s=>{ const line=L.lines.find(l=>l.id===s.lineId)||{}; const k=s.item+'|'+(line.po||'');
      const o=m.get(k)||{item:s.item,desc:s.desc||line.desc||'',po:line.po||'',pallets:0,units:0}; o.pallets++; o.units+=num(s.qty); m.set(k,o); });
    return [...m.values()];
  }
  function partyBox(title,p,code){
    return `<div class="obp-box"><div class="obp-box-t">${title}</div>${p.code?`<div class="obp-code">${safe(p.code)}</div>`:''}
      <div class="obp-box-b">${safe(p.name)}<br>${safe(p.addr1)}<br>${safe(p.city)}${p.phone?'<br>'+safe(p.phone):''}</div></div>`;
  }
  function bolHtml(L){
    const co=company(), rows=bolRows(L), sum=summary(L), t=totals(L), printed=fmtStamp(new Date().toISOString());
    const draft=L.status!=='closed';
    // fixed rows per page so the page footer and totals always fit
    const FIRST=30, NEXT=40, SUMROWS=10+sum.length;
    const pages=[]; let i=0;
    while(i<rows.length||!pages.length){ const cap=pages.length?NEXT:FIRST; pages.push(rows.slice(i,i+cap)); i+=cap; }
    const lastCap=pages.length===1?FIRST:NEXT;
    const summaryOwnPage=pages[pages.length-1].length+SUMROWS>lastCap;
    const total=pages.length+(summaryOwnPage?1:0);
    const head=`<tr><th>CUSTOMER ID</th><th>LWH ID</th><th>DESCRIPTION</th><th>ITEM NUMBER</th><th>PO</th><th>LOT / DATE</th><th class="r">QTY</th></tr>`;
    const tr=r=>r.type==='row'?`<tr><td class="mono">${safe(r.s.cust)}</td><td class="mono b">${safe(r.s.lwh)}${r.s.exc?'*':''}</td><td class="desc">${safe(r.s.desc)}</td><td>${safe(r.s.item)}</td><td>${safe(r.po)}</td><td>${safe(r.s.lot)}</td><td class="r q">${fmtN(r.s.qty)}</td></tr>`
      :r.type==='lot'?`<tr class="obp-lot"><td class="r">${r.pallets}</td><td colspan="5"><div class="obp-dash"><span>Lot Total</span></div></td><td class="r">${fmtN(r.qty)}</td></tr>`
      :`<tr class="obp-itemt"><td class="r">${r.pallets}</td><td colspan="5">Item ${safe(r.item)} total</td><td class="r">${fmtN(r.qty)}</td></tr>`;
    const top=`<div class="obp-top">
        <div class="obp-co"><div class="obp-co-name">${safe(co.name)}</div><div class="obp-co-addr">${safe(co.addr)}</div><div class="obp-co-addr">Phone: ${safe(co.phone)}</div></div>
        <div class="obp-bolno"><div class="obp-box-t">BOL NUMBER</div><div class="obp-bolno-v">${safe(L.bol)}</div>${L.billRef?`<div class="obp-ref">BILL TO REF: <b>${safe(L.billRef)}</b></div>`:''}</div>
        <table class="obp-hdr"><tr><th>APPT</th><td class="dark">${safe(L.appt)}</td></tr><tr><th>BOL</th><td>${safe(L.bol)}</td></tr><tr><th>PRO #</th><td>${safe(L.pro)}</td></tr>
          <tr><th>CARRIER</th><td>${safe(L.carrier)}</td></tr><tr><th>TRAILER</th><td>${safe(L.trailer)}</td></tr><tr><th>SEAL</th><td>${safe(L.seal)}</td></tr></table>
      </div>
      <div class="obp-parties">${partyBox('SHIP FROM',L.shipFrom)}${partyBox('CONSIGNEE',L.shipTo)}${partyBox('BILL TO',L.billTo)}
        <div class="obp-box"><div class="obp-box-t">COMMENTS</div><div class="obp-box-b obp-comments">${safe(L.comments)}</div></div></div>`;
    const mini=pg=>`<div class="obp-mini"><b>BOL ${safe(L.bol)}</b><span>${safe(L.shipTo.name)}</span><span>Carrier ${safe(L.carrier)}</span><span>Trailer ${safe(L.trailer)}</span><span>Seal ${safe(L.seal)}</span><span>Page ${pg} of ${total}</span></div>`;
    const foot=pg=>`<div class="obp-foot"><span>${printed}</span><span>${draft?'DRAFT — load not closed':''}</span><span>Page ${pg} of ${total}</span></div>`;
    const sumHtml=`<div class="obp-sum">
        <table class="obp-sumt"><tr><th>ITEM NUMBER</th><th>DESCRIPTION</th><th>PO</th><th class="r">PALLETS</th><th class="r">QTY</th></tr>
          ${sum.map(x=>`<tr><td>${safe(x.item)}</td><td>${safe(x.desc)}</td><td>${safe(x.po)}</td><td class="r">${x.pallets}</td><td class="r">${fmtN(x.units)}</td></tr>`).join('')}
          <tr class="obp-grand"><td colspan="3">TOTAL</td><td class="r">${t.pallets}</td><td class="r">${fmtN(t.units)}</td></tr></table>
        ${L.scans.some(s=>s.exc)?'<div class="obp-note">* Pallet added by manager exception (not in inventory data at time of shipping).</div>':''}
        <div class="obp-legal">Received, subject to the classifications and tariffs in effect on the date of issue of this Bill of Lading, the property described above in apparent good order, except as noted. Seal number recorded above was applied at time of loading.</div>
        <div class="obp-sigs"><div><div class="obp-line"></div>Shipper signature / date<div class="obp-sub">${safe(co.name)}${L.closedBy?' · loaded by '+safe(L.closedBy):''}</div></div>
          <div><div class="obp-line"></div>Carrier / driver signature / date<div class="obp-sub">${safe(L.carrier)}</div></div></div>
      </div>`;
    let html='';
    pages.forEach((pr,pi)=>{ const pg=pi+1, last=pi===pages.length-1;
      html+=`<div class="obp-page">${draft?'<div class="obp-wm">DRAFT</div>':''}${pi===0?top:mini(pg)}
        <table class="obp-lines">${head}${pr.map(tr).join('')}</table>
        ${last&&!summaryOwnPage?sumHtml:''}${foot(pg)}</div>`; });
    if(summaryOwnPage) html+=`<div class="obp-page">${draft?'<div class="obp-wm">DRAFT</div>':''}${mini(total)}${sumHtml}${foot(total)}</div>`;
    return html;
  }
  function printBol(L){
    L=L||load; if(!L||!L.scans.length) return;
    el('obPrintArea').innerHTML=bolHtml(L);
    if(window.LWHLabels&&LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
    setTimeout(()=>print(),250);
  }
  // WMS re-entry sheet — every pallet with a Code 128 barcode of its LWH ID so
  // it can be scanned into the WMS instead of typed
  function printWms(L){
    L=L||load; if(!L||!L.scans.length) return;
    if(!window.JsBarcode){ alert('The barcode library didn\'t load — check your connection, or use the Excel/CSV download.'); return; }
    const t=totals(L);
    el('obPrintArea').innerHTML=`<div class="ls-p-page obw-page"><div class="ls-p-head"><div><b>WMS re-entry — BOL ${safe(L.bol)}</b> — ${safe(L.subCust)}</div>
      <div>${safe(L.warehouse)} · Trailer ${safe(L.trailer)} · Seal ${safe(L.seal)} · ${t.pallets} pallets · ${fmtN(t.units)} qty · ${L.billRef?'Ref '+safe(L.billRef)+' · ':''}${fmtDate(L.closed||new Date().toISOString())}</div></div>
      ${L.scans.map((s,i)=>`<div class="obw-row"><div class="ls-p-n">${i+1}</div><div class="ls-p-bc"><svg id="obBc${i}"></svg><div class="ls-p-txt">${safe(s.lwh)}</div></div>
        <div class="obw-info"><b>${safe(s.item)}</b> · qty ${fmtN(s.qty)}${s.lot?' · lot '+safe(s.lot):''}<br>${s.cust?'Cust ID '+safe(s.cust):''}${s.exc?' <b>· EXCEPTION</b>':''}${s.ovr&&!s.exc?' · override':''}</div></div>`).join('')}</div>`;
    L.scans.forEach((s,i)=>{ try{ JsBarcode('#obBc'+i,s.lwh,{format:'CODE128',height:48,width:1.6,margin:0,marginLeft:14,marginRight:14,displayValue:false}); }catch(e){ console.error(e); } });
    if(window.LWHLabels&&LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
    setTimeout(()=>print(),250);
  }
  function exportRows(list){
    const out=[];
    list.forEach(L=>L.scans.forEach((s,i)=>{ const line=L.lines.find(l=>l.id===s.lineId)||{};
      out.push({'BOL #':L.bol,'Bill To Ref':L.billRef,'Status':L.status,'Closed':L.closed?fmtStamp(L.closed):'','Warehouse':L.warehouse,'Sub-customer':L.subCust,
        'Ship To':L.shipTo.name,'Bill To':L.billTo.name,'Carrier':L.carrier,'Trailer':L.trailer,'Seal':L.seal,'PRO #':L.pro,
        '#':i+1,'LWH ID':s.lwh,'Customer ID':s.cust,'Item':s.item,'Description':s.desc,'Lot':s.lot,'Qty':num(s.qty),'PO':line.po||'',
        'Scanned':fmtStamp(s.t),'Scanned by':s.by,'Exception':s.exc?'YES':'','Override / reason':s.ovr?`${s.ovr.by}: ${s.ovr.reason}${s.ovr.verified?'':' (unverified)'}`:''}); }));
    return out;
  }
  function fileName(list){ return list.length===1?'BOL_'+String(list[0].bol||'load').replace(/[^A-Za-z0-9_-]+/g,'_'):'Outbound_loads_'+new Date().toISOString().slice(0,10); }
  function downloadCsv(list){
    const r=exportRows(list), h=Object.keys(r[0]||{'BOL #':''});
    const esc=v=>{ const x=String(v??''); return /[",\n]/.test(x)||/^\d{12,}$/.test(x)?'"'+x.replace(/"/g,'""')+'"':x; };
    const blob=new Blob([[h.join(','),...r.map(o=>h.map(k=>esc(o[k])).join(','))].join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=fileName(list)+'.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  async function downloadXlsx(list){
    try{ await new Promise((ok,no)=>{ if(window.XLSX) return ok(); const s=document.createElement('script'); s.src=XLSXJS; s.onload=ok; s.onerror=no; document.head.appendChild(s); }); }
    catch{ LWHUI.toast('Excel needs a connection — downloading CSV instead'); return downloadCsv(list); }
    const r=exportRows(list);
    const ws=XLSX.utils.json_to_sheet(r);
    // IDs as text so Excel doesn't turn long numbers into 1.23E+19
    const hdr=Object.keys(r[0]||{}); ['LWH ID','Customer ID','Item','BOL #','Trailer','Seal','Lot'].forEach(name=>{ const c=hdr.indexOf(name); if(c<0) return;
      for(let i=0;i<r.length;i++){ const ref=XLSX.utils.encode_cell({r:i+1,c}); if(ws[ref]){ ws[ref].t='s'; ws[ref].v=String(r[i][name]??''); ws[ref].z='@'; } } });
    ws['!cols']=hdr.map(h=>({wch:Math.max(8,Math.min(30,h.length+4,...r.slice(0,50).map(x=>String(x[h]??'').length+2)))}));
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Pallets'); XLSX.writeFile(wb,fileName(list)+'.xlsx');
  }

  // ================================================================ records (managers, every device)
  let recPass='', recData=null;
  function fromServer(x){
    const p=o=>Object.assign(blankParty(),o||{});
    return {id:'rec-'+x.client_key,key:x.client_key,bol:x.bol_no||'',status:x.status,warehouse:x.warehouse||'',subCust:x.sub_customer||'',billRef:x.bill_to_ref||'',appt:x.appt||'',pro:x.pro_no||'',
      carrier:x.carrier||'',trailer:x.trailer||'',seal:x.seal||'',comments:x.comments||'',shipFrom:p(x.ship_from),shipTo:p(x.ship_to),billTo:p(x.bill_to),
      lines:x.lines||[],events:x.events||[],created:x.created_at,closed:x.closed_at,closedBy:x.closed_by||'',by:x.created_by||'',
      scans:(x.scans||[]).map(s=>({lwh:s.lwh_id,cust:s.customer_id||'',item:s.item||'',desc:s.item_desc||'',lot:s.lot||'',qty:num(s.qty),lineId:s.line_id,wh:s.warehouse,t:s.scanned_at,by:s.scanned_by,src:s.source,exc:s.exception,ovr:s.override,match:s.match}))};
  }
  async function recSearch(){
    const out=el('obRecResults'), st=el('obRecStatus');
    recPass=recPass||el('obRecPass').value.trim()||getPass();
    if(!recPass){ st.textContent='Enter the manager passcode.'; return; }
    st.textContent='Looking up loads…';
    try{
      const r=await rpc('toolkit_outbound_records',{p_passcode:recPass,p_search:el('obRecQ').value.trim(),p_days:+el('obRecDays').value||14,p_filter:el('obRecFilter').value});
      if(!r.ok){ recPass=''; setPass(''); el('obRecLocked').hidden=false; el('obRecOpen').hidden=true; out.innerHTML='';
        st.textContent=r.error==='bad_passcode'?'That passcode isn\'t right.':r.error==='locked'?'Too many wrong tries — locked for a few minutes.':r.error==='not_set_up'?'The manager passcode hasn\'t been set up yet.':'Couldn\'t open records.'; return; }
      setPass(recPass); el('obRecLocked').hidden=true; el('obRecOpen').hidden=false;
      recData=r; renderRecords(); st.textContent='';
    }catch(e){ st.textContent=e.setup?'Records not set up yet — run sql/outbound_loads.sql in Supabase.':'Couldn\'t reach records — check the connection.'; }
  }
  function renderRecords(){
    const out=el('obRecResults'), raw=recData.loads||[], list=raw.map(fromServer), q=recData.search;
    if(!list.length){ out.innerHTML=`<div class="hint" style="margin-top:8px">${q?`Nothing found for "${safe(q)}".`:'No loads in that range.'}</div>`; return; }
    const closed=list.filter(L=>L.status==='closed');
    out.innerHTML=`<div class="ls-rec-sum">${list.length} load${list.length===1?'':'s'} · ${list.reduce((a,L)=>a+L.scans.length,0)} pallets
        <span><button type="button" class="mh-link" id="obRecXlsx">Excel (all)</button> <button type="button" class="mh-link" id="obRecCsv">CSV (all)</button></span></div>`+
      list.map((L,i)=>{ const x=raw[i], t=totals(L), hits=L.scans.filter(s=>s.match);
        const wms=x.wms_entered_at?`<span class="ob-pill ob-pill-closed">In WMS ${fmtDate(x.wms_entered_at)}${x.wms_entered_by?' · '+safe(x.wms_entered_by):''}</span>`:L.status==='closed'?'<span class="ob-pill ob-pill-warn">Not in WMS yet</span>':'';
        return `<details class="ls-rec"${hits.length&&list.length<=3?' open':''}>
          <summary><div><b>${safe(L.bol||'(no BOL #)')}</b> <span class="ob-pill ob-pill-${L.status}">${L.status}</span> ${wms}
            <div class="db-sub">${safe([L.subCust,L.warehouse,L.shipTo.name&&'→ '+L.shipTo.name,L.carrier,L.trailer&&'Trailer '+L.trailer,L.seal&&'Seal '+L.seal].filter(Boolean).join(' · '))}</div>
            <div class="db-sub">${fmtDate(L.closed||x.updated_at)} ${fmtTime(L.closed||x.updated_at)}${L.closedBy?' · '+safe(L.closedBy):''}${L.billRef?' · Ref '+safe(L.billRef):''}${x.void_reason?' · void: '+safe(x.void_reason):''}</div></div>
            <div class="ls-rec-n">${t.pallets}<span>pallets</span></div></summary>
          ${hits.length?`<div class="ls-rec-hit">Found: ${hits.map(s=>`<b>${safe(s.lwh)}</b>${s.cust?' ('+safe(s.cust)+')':''} · item ${safe(s.item)}`).join('<br>')}</div>`:''}
          <div class="ob-rec-pallets">${L.scans.map((s,j)=>`<div class="${s.match?'ls-rec-m':''}"><span>${j+1}</span>${safe(s.lwh)} · ${safe(s.item)} · ${fmtN(s.qty)}${s.exc?' · EXC':''}</div>`).join('')}</div>
          <div class="ls-rec-act ob-rec-act">
            <button type="button" class="ghost" data-rec="bol" data-i="${i}">Print BOL</button>
            <button type="button" class="ghost" data-rec="wms" data-i="${i}">WMS sheet</button>
            <button type="button" class="ghost" data-rec="xlsx" data-i="${i}">Excel</button>
            ${L.status==='closed'?(x.wms_entered_at?`<button type="button" class="ghost" data-rec="wms_pending" data-i="${i}">Mark not in WMS</button>`:`<button type="button" data-rec="wms_entered" data-i="${i}">Mark entered in WMS</button>`):''}
            ${L.status!=='void'?`<button type="button" class="ghost ob-danger" data-rec="void" data-i="${i}">Void</button>`:''}
          </div></details>`; }).join('');
    el('obRecCsv').onclick=()=>downloadCsv(list.filter(L=>L.status!=='void'));
    el('obRecXlsx').onclick=()=>downloadXlsx(list.filter(L=>L.status!=='void'));
    out.querySelectorAll('[data-rec]').forEach(b=>b.onclick=async()=>{
      const L=list[+b.dataset.i], a=b.dataset.rec;
      if(a==='bol') return printBol(L);
      if(a==='wms') return printWms(L);
      if(a==='xlsx') return downloadXlsx([L]);
      let by=userName(), reason=null;
      if(a==='void'){ reason=prompt(`Void BOL ${L.bol}? Its ${L.scans.length} pallets become free for other loads.\n\nReason:`); if(!reason) return; }
      if(!by){ by=prompt('Your name:')||''; if(!by) return; }
      try{ const r=await rpc('toolkit_outbound_manage',{p_passcode:recPass,p_client_key:L.key,p_action:a,p_by:by,p_reason:reason});
        if(!r.ok) throw new Error(r.error); LWHUI.toast(a==='void'?'Voided':a==='wms_entered'?'Marked entered in WMS':'Marked not in WMS'); if(a==='void') refreshShipped(); recSearch(); }
      catch(e){ alert('Couldn\'t update: '+e.message); }
    });
  }
  async function refreshLookups(){
    try{ const r=await rpc('toolkit_outbound_lookups',{}); if(r&&r.ok){ lookups={parties:r.parties||[],carriers:r.carriers||[]}; LWHStorage.set('obLookups',lookups); if(load&&isEditorOpen()) fillCarriers(); } }
    catch(e){ if(e.setup) setupMissing=true; }
  }

  // ================================================================ wiring
  window.addEventListener('load',()=>{
    if(!el('outbound')) return;
    loads=(LWHStorage.get(LOADS_KEY,[])||[]).filter(L=>L&&L.key&&Array.isArray(L.scans));
    lookups=LWHStorage.get('obLookups',lookups)||lookups;
    loadCachedShipped();
    const co=company(); el('obCoName').value=co.name; el('obCoAddr').value=co.addr; el('obCoPhone').value=co.phone;
    ['obCoName','obCoAddr','obCoPhone'].forEach(id=>el(id).addEventListener('input',()=>LWHStorage.set(CO_KEY,{name:el('obCoName').value,addr:el('obCoAddr').value,phone:el('obCoPhone').value})));

    const cur=LWHStorage.get(CUR_KEY,null);
    if(cur&&loads.some(L=>L.id===cur)) openLoad(cur); else showList();

    el('obNew').onclick=newLoad;
    el('obBack').onclick=showList;
    el('obRefreshInv').onclick=refreshInventory;
    el('obWarehouse').onchange=e=>{
      if(load.scans.length){ e.target.value=load.warehouse; return alert('Take the pallets off first to change the warehouse.'); }
      load.warehouse=e.target.value; load.subCust=''; load.lines=[];
      const m=LWHStorage.get(FROM_BY_WH,{})||{}; if(m[load.warehouse]&&!clean(load.shipFrom.name)) load.shipFrom=Object.assign(blankParty(),m[load.warehouse]);
      save(); fillSubs(); renderParties(); render(); };
    el('obSubCust').onchange=e=>{
      if(load.scans.length){ e.target.value=load.subCust; return alert('Take the pallets off first to change the sub-customer.'); }
      if(load.lines.length&&!confirm('Changing the sub-customer removes the order lines. Continue?')){ e.target.value=load.subCust; return; }
      load.subCust=e.target.value; load.lines=[];
      const m=LWHStorage.get(BILL_BY_SUB,{})||{}; if(m[load.subCust]&&!clean(load.billTo.name)) load.billTo=Object.assign(blankParty(),m[load.subCust]);
      logEvent(load,'Sub-customer set to '+load.subCust); save(); renderParties(); render(); };
    [['obBol','bol'],['obBillRef','billRef'],['obAppt','appt'],['obPro','pro'],['obCarrier','carrier'],['obTrailer','trailer'],['obSeal','seal'],['obBy','by'],['obComments','comments']].forEach(([id,k])=>
      el(id).addEventListener('input',e=>{ load[k]=e.target.value.trim(); if(k==='by'&&load[k]) LWHStorage.set('userName',load[k]); save(); render(); }));
    el('obItemFilter').addEventListener('input',()=>{ el('obItem')._keep=el('obItem').value; fillItems(); });
    el('obItem').onchange=()=>{ el('obItem')._keep=el('obItem').value; updateLineForm(); };
    el('obMode').onchange=updateLineForm;
    el('obAddLine').onclick=addLine;
    el('obAmt').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); addLine(); } });

    const inp=el('obInput');
    const hide=LWHStorage.get(KB_KEY,false); el('obHideKb').checked=hide; inp.setAttribute('inputmode',hide?'none':'text');
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key==='Tab'){ e.preventDefault(); submitInput(); } });
    inp.addEventListener('input',()=>{   // scanners set to send no Enter: fast burst then a pause = one scan
      const now=performance.now(); burst.push(now); if(burst.length>40) burst.shift();
      clearTimeout(inp._t);
      inp._t=setTimeout(()=>{ const v=inp.value; if(v.length<5||burst.length<5) return;
        const gaps=burst.slice(1).map((t,i)=>t-burst[i]); const avg=gaps.reduce((a,b)=>a+b,0)/gaps.length; if(avg<35) submitInput(); },220);
    });
    const ready=on=>{ el('obReady').classList.toggle('ls-ready-on',on); el('obReady').textContent=on?'Ready — scan a pallet tag':'Tap here to scan'; };
    inp.addEventListener('focus',()=>ready(true)); inp.addEventListener('blur',()=>ready(false));
    el('obReady').onclick=()=>inp.focus();
    el('obAdd').onclick=submitInput;
    el('obHideKb').onchange=e=>{ LWHStorage.set(KB_KEY,e.target.checked); inp.setAttribute('inputmode',e.target.checked?'none':'text'); inp.blur(); inp.focus(); };
    el('obCamBtn').onclick=startCamera;
    el('obUndo').onclick=()=>{ if(load.status!=='open') return; const s=load.scans.pop(); if(s){ logEvent(load,`Removed pallet ${s.lwh} (undo)`); save(); render(); flash('warn',`Removed LWH ${s.lwh}`); } inp.focus(); };
    el('obClose').onclick=closeLoad;
    el('obReopen').onclick=reopenLoad;
    el('obDelete').onclick=deleteOrVoid;
    el('obPrint').onclick=()=>printBol();
    el('obWms').onclick=()=>printWms();
    el('obXlsx').onclick=()=>downloadXlsx([load]);
    el('obCsv').onclick=()=>downloadCsv([load]);
    el('obLocalXlsx').onclick=()=>{ const l=loads.filter(L=>L.status==='closed'); if(!l.length) return LWHUI.toast('No closed loads on this device'); downloadXlsx(l); };

    el('obRecGo').onclick=recSearch;
    el('obRecPass').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); recSearch(); } };
    el('obRecQ').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); recSearch(); } };
    el('obRecSearch').onclick=recSearch;
    el('obRecDays').onchange=recSearch; el('obRecFilter').onchange=recSearch;
    el('obRecLock').onclick=()=>{ recPass=''; setPass(''); recData=null; el('obRecResults').innerHTML=''; el('obRecLocked').hidden=false; el('obRecOpen').hidden=true; el('obRecPass').value=''; };
    el('obRecDetails').addEventListener('toggle',()=>{ if(el('obRecDetails').open&&getPass()&&!recData){ recPass=getPass(); recSearch(); } });

    window.addEventListener('online',()=>{ scheduleSync(200); refreshShipped(); });
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden){ scheduleSync(500); if(isEditorOpen()) refreshShipped(); } });
    setInterval(()=>{ if(isEditorOpen()&&navigator.onLine!==false) refreshShipped(); },45000);
    // inventory finishes loading after the app opens — refresh the pickers when it does
    let lastLen=-1; setInterval(()=>{ const n=inv().rows.length; if(n!==lastLen){ lastLen=n; renderInvStatus(); if(load&&isEditorOpen()){ fillWarehouses(); fillSubs(); fillItems(); } } },3000);
    document.addEventListener('click',e=>{ const v=e.target.closest('[data-view]'); if(!v) return;
      setTimeout(()=>{ if(v.dataset.view==='outbound'){ refreshShipped(); refreshLookups(); if(load) inp.focus(); else renderList(); } else stopCamera(); },50); });
    scheduleSync(1000); refreshLookups(); refreshShipped();
  });
  window.LWHOutbound={addScan:v=>addScan(v,'test'),syncNow:()=>syncAll(),_state:()=>({loads,load,shipped}),printBol,bolHtml,refreshShipped};
})();
