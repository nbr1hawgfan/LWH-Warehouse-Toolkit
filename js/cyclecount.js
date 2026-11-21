/* CYCLE COUNTS (v1.92.0; Analytics tab v1.102.0) — count what's on the floor against BirdsEye inventory.

   Managers start a count: pick a warehouse, then what to count —
     a customer · an item · an item + lot · one or more bays.
   The expected pallets are frozen from current_inventory at that moment.

   Anyone signed in can count: say which bay you're in (type it or scan the bay label), then
   scan each pallet's LWH ID or the customer's pallet tag (keyboard-wedge scanner, Bluetooth
   scanner or the phone camera) and type the qty if the count asks for it.
     green  = right pallet, right bay (and right qty)
     amber  = pallet belongs to this count but is in a different bay
     red    = not part of this count — shows where the system thinks it is
   "Blind" counts hide expected pallets and quantities from counters until it's submitted.

   Submit → anything not scanned is "missing". Each difference shows whether the pallet has
   shipped or moved in BirdsEye since the count started. Managers mark how each one was handled
   (adjusted in WMS, found, shipped during count…), can send it back for a recount, export to
   Excel, and close it.

   Data: Supabase cyc_* functions (sql/cycle_counts.sql). Separate from the Trane / customer-
   portal cycle counts (cc_*). */
(function(){
  'use strict';
  const API='https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const VIEW='cycleCount';
  const ICON='<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M9 10v10"/><path d="M12.5 15l1.8 1.8 3.4-3.6"/></svg>';
  const TYPES=[['customer','Customer'],['item','Item'],['item_lot','Item + Lot'],['bay','Bay']];
  const RES={match:['Match','ok'],qty:['Qty off','warn'],bay:['Wrong bay','warn'],qty_bay:['Qty + bay off','warn'],missing:['Missing','bad'],extra:['Extra','bad']};
  const FIXES=['Adjusted in WMS','Moved in WMS (bay fixed)','Found — count was wrong','Shipped / moved during count','Recounted — OK','Sent to customer service','Other'];

  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const toast=m=>{ if(window.LWHUI&&LWHUI.toast) LWHUI.toast(m); };
  const ls={ get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
             set(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };
  const whLabel=w=>String(w||'').replace(/^WHSE/,'Whse ');
  const num=n=>n==null||n===''?'':Number(n).toLocaleString('en-US');
  const when=s=>{ if(!s) return ''; const d=new Date(s); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); };
  const plural=(k,w)=>num(k)+' '+w+(k===1?'':'s');

  let B=null;                     // boot
  let tab='active', list=[], built=false;
  let C=null;                     // open count {count, lines, bays, is_manager, hidden}
  let pending=null;               // scanned code waiting for qty
  let cam=null, camLast={v:'',t:0};
  let newForm=null, sugT=null, showAll=false, filt='diff';

  // ---------------------------------------------------------------- API
  async function rpc(name,args){
    let res;
    try{ res=await fetch(API+name,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(args||{}),cache:'no-store'}); }
    catch(e){ throw new Error('No connection. Try again when you have signal.'); }
    if(!res.ok){ let t=''; try{ t=(await res.json()).message||''; }catch(e){} throw new Error(/sign_in/.test(t)?'Please sign in again.':(t||'HTTP '+res.status)); }
    const r=await res.json();
    if(r&&r.ok===false){ if(r.error==='sign_in'&&window.LWHAuth) LWHAuth.requireSignIn('Please sign in to use Cycle Counts.'); throw new Error(r.error==='sign_in'?'Please sign in again.':r.error); }
    return r;
  }
  const isMgr=()=>!!(B&&B.me&&B.me.is_manager);

  // ---------------------------------------------------------------- shell
  function build(){
    const sec=$(VIEW); if(!sec||built) return; built=true;
    sec.innerHTML=`<div class="cy-wrap">
      <div class="mh-entry-head no-print">
        <div class="mh-entry-icon">${ICON}</div>
        <div><h2>Cycle Counts</h2><div class="mh-entry-sub">Count a customer, item, lot or bay against BirdsEye inventory — see what's missing, extra, in the wrong bay or short.</div></div>
        <div class="pr-who"><span id="cyWho"></span></div>
      </div>
      <div id="cyBody"></div>
    </div>`;
    sec.addEventListener('click',onClick);
  }
  async function boot(){
    try{ B=await rpc('cyc_boot'); $('cyWho').textContent=B.me.name+(B.me.is_manager?' · manager':''); }
    catch(e){ $('cyBody').innerHTML=`<div class="card fi-note fi-bad">${esc(e.message)}</div>`; return; }
    const open=ls.get('lwh_cyOpen',null);
    if(open&&!C) openCount(open,true); else if(!C) showList();
  }

  // ---------------------------------------------------------------- list
  async function showList(which){
    stopCam(); C=null; ls.set('lwh_cyOpen',null); if(which) tab=which;
    const body=$('cyBody');
    if(tab==='analytics'&&!isMgr()) tab='active';
    const tabs=`<div class="pr-tabs no-print"><button type="button" data-cy-tab="active" class="${tab==='active'?'active':''}">Open &amp; to review</button><button type="button" data-cy-tab="closed" class="${tab==='closed'?'active':''}">Finished</button>${isMgr()?`<button type="button" data-cy-tab="analytics" class="${tab==='analytics'?'active':''}">Analytics</button>`:''}</div>`;
    if(tab==='analytics'){ body.innerHTML=tabs+'<div id="cyaBody"></div>'; showAnalytics(); return; }
    body.innerHTML=`${tabs}
      <div class="cy-listbar">${isMgr()?'<button type="button" data-cy="new">+ New count</button>':'<span class="fi-sub">Managers start counts. Pick one below to help count.</span>'}<button type="button" class="ghost fi-small" data-cy="refresh">Refresh</button></div>
      <div id="cyList" class="cy-list"><div class="fi-sub">Loading…</div></div>`;
    try{ list=(await rpc('cyc_list',{p_which:tab})).counts; }catch(e){ $('cyList').innerHTML=`<div class="fi-note fi-bad">${esc(e.message)}</div>`; return; }
    if(!list.length){ $('cyList').innerHTML=`<div class="card fi-sub">${tab==='active'?'No counts going right now.'+(isMgr()?' Tap <b>+ New count</b> to start one.':''):'No finished counts in the last 6 months.'}</div>`; return; }
    $('cyList').innerHTML=list.map(c=>{
      const pct=c.expected?Math.round(c.counted/c.expected*100):0;
      const st={open:['Counting','info'],review:['To review','warn'],closed:['Closed','ok'],cancelled:['Cancelled','muted']}[c.status];
      return `<button type="button" class="card cy-item" data-cy-open="${c.id}">
        <div class="cy-item-top"><b>${esc(c.title)}</b><span class="cy-badge cy-${st[1]}">${st[0]}</span></div>
        <div class="fi-sub">Started by ${esc(c.created_name)} · ${when(c.created_at)}${c.blind?' · blind':''}${c.count_qty?' · counting qty':''}</div>
        ${c.status==='open'?`<div class="in-bar"><i style="width:${pct}%"></i></div><div class="fi-sub">${plural(c.counted,'pallet')} of ${num(c.expected)} found${c.extras?` · ${plural(c.extras,'extra')}`:''}</div>`
          :`<div class="fi-sub">${num(c.counted)} of ${num(c.expected)} found · <b class="${c.diffs?'in-red':''}">${plural(c.diffs,'difference')}</b>${c.status==='review'&&c.open_diffs?` (${num(c.open_diffs)} not handled yet)`:''}</div>`}
      </button>`;
    }).join('');
  }

  // ---------------------------------------------------------------- new count (managers)
  function showNew(){
    stopCam();
    newForm={wh:ls.get('lwh_cyWh',''),type:'customer',customer:'',item:'',lot:'',bays:[]};
    $('cyBody').innerHTML=`<div class="card cy-new">
      <h3>New cycle count</h3>
      <label>Warehouse<select id="cyWh"><option value="">Pick a warehouse…</option>${B.warehouses.map(w=>`<option value="${esc(w.code)}">${whLabel(w.code)} — ${num(w.pallets)} pallets</option>`).join('')}</select></label>
      <label>Count by</label>
      <div class="cy-types">${TYPES.map(([k,l])=>`<button type="button" class="cy-type" data-cy-type="${k}">${l}</button>`).join('')}</div>
      <div id="cyFields"></div>
      <div id="cyPreview" class="fi-note" hidden></div>
      <label class="fi-check"><input type="checkbox" id="cyBlind" checked> Blind count <span>— counters don't see what's expected or the system qty until it's submitted</span></label>
      <label class="fi-check"><input type="checkbox" id="cyQty" checked> Count qty on each pallet <span>— off = just confirm each pallet is there and in the right bay</span></label>
      <label>Note for counters (optional)<input id="cyNote" maxlength="200" placeholder="e.g. Customer audit Friday — check top racks too"></label>
      <div class="cy-actions"><button type="button" class="ghost" data-cy="list">Cancel</button><button type="button" id="cyCreate" data-cy="create">Start count</button></div>
      <datalist id="cySug"></datalist>
    </div>`;
    $('cyWh').value=newForm.wh;
    $('cyWh').onchange=e=>{ newForm.wh=e.target.value; ls.set('lwh_cyWh',newForm.wh); newForm.customer=newForm.item=newForm.lot=''; newForm.bays=[]; drawFields(); };
    drawFields();
  }
  function drawFields(){
    document.querySelectorAll('[data-cy-type]').forEach(b=>b.classList.toggle('on',b.dataset.cyType===newForm.type));
    const t=newForm.type, f=(id,label,val,ph)=>`<label>${label}<input id="${id}" list="cySug" autocomplete="off" value="${esc(val)}" placeholder="${ph}" data-cy-field="${id}"></label>`;
    let h='';
    if(t==='customer') h=f('cyCust','Customer',newForm.customer,'Start typing — e.g. TRAFO');
    if(t==='item'||t==='item_lot') h=f('cyCust','Customer (optional — narrows the item list)',newForm.customer,'Any customer')+f('cyItem','Item',newForm.item,'Item number');
    if(t==='item_lot') h+=f('cyLot','Lot',newForm.lot,'Lot number');
    if(t==='bay') h=`<label>Bays — add one or more<div class="cy-bayadd"><input id="cyBay" list="cySug" autocomplete="off" placeholder="Bay name, then Add" data-cy-field="cyBay"><button type="button" class="ghost fi-small" data-cy="addbay">Add</button></div></label><div id="cyBayChips" class="cy-chips"></div>`;
    $('cyFields').innerHTML=newForm.wh?h:'<p class="fi-sub">Pick a warehouse first.</p>';
    drawBayChips(); preview();
  }
  function drawBayChips(){ const b=$('cyBayChips'); if(b) b.innerHTML=newForm.bays.map(x=>`<button type="button" class="ac-chip" data-cy-delbay="${esc(x)}">${esc(x)} ✕</button>`).join(''); }
  function readFields(){
    if($('cyCust')) newForm.customer=$('cyCust').value.trim();
    if($('cyItem')) newForm.item=$('cyItem').value.trim();
    if($('cyLot')) newForm.lot=$('cyLot').value.trim();
  }
  function scopeObj(){ return {customer:newForm.customer,item:newForm.item,lot:newForm.lot,bays:newForm.bays}; }
  async function suggest(id){
    readFields();
    const field={cyCust:'customer',cyItem:'item',cyLot:'lot',cyBay:'bay'}[id]; if(!field||!newForm.wh) return;
    try{
      const r=await rpc('cyc_suggest',{p_wh:newForm.wh,p_field:field,p_q:$(id).value,p_customer:field==='customer'?'':newForm.customer,p_item:field==='lot'?newForm.item:''});
      $('cySug').innerHTML=r.rows.map(x=>`<option value="${esc(x.val)}">${esc(x.descr?x.descr+' · ':'')}${plural(x.pallets,'pallet')}</option>`).join('');
    }catch(e){}
  }
  async function preview(){
    readFields(); const p=$('cyPreview'); if(!p) return;
    const t=newForm.type, ready=newForm.wh&&((t==='customer'&&newForm.customer)||(t==='item'&&newForm.item)||(t==='item_lot'&&newForm.item&&newForm.lot)||(t==='bay'&&newForm.bays.length));
    if(!ready){ p.hidden=true; return; }
    try{
      const r=await rpc('cyc_preview',{p_wh:newForm.wh,p_type:t,p_scope:scopeObj()});
      p.hidden=false;
      p.className='fi-note '+(r.pallets?(r.pallets>3000?'fi-bad':'fi-info'):'fi-warn');
      p.innerHTML=r.pallets?`This count covers <b>${plural(r.pallets,'pallet')}</b> (Qty ${num(r.qty)}) in <b>${plural(r.bays,'bay')}</b>${r.customers>1?` for ${r.customers} customers`:''}.${r.pallets>3000?' That\'s too many for one count — narrow it down.':''}`
        :'Nothing in BirdsEye inventory matches that yet. Check the spelling (pick from the list).';
    }catch(e){ p.hidden=true; }
  }
  async function create(){
    readFields();
    const btn=$('cyCreate'); btn.disabled=true; btn.textContent='Starting…';
    try{
      const r=await rpc('cyc_create',{p_wh:newForm.wh,p_type:newForm.type,p_scope:scopeObj(),p_blind:$('cyBlind').checked,p_count_qty:$('cyQty').checked,p_note:$('cyNote').value});
      toast(`Count started — ${plural(r.pallets,'pallet')} to find.`);
      openCount(r.id);
    }catch(e){ toast(e.message); btn.disabled=false; btn.textContent='Start count'; }
  }

  // ---------------------------------------------------------------- open a count
  async function openCount(id,quiet){
    stopCam();
    try{ C=await rpc('cyc_get',{p_id:+id}); }
    catch(e){ ls.set('lwh_cyOpen',null); if(!quiet) toast(e.message); showList(); return; }
    ls.set('lwh_cyOpen',+id);
    if(C.count.status==='open') drawCounting(); else drawReview();
  }
  async function reload(){ if(!C) return; try{ C=await rpc('cyc_get',{p_id:C.count.id}); }catch(e){ return; } if(C.count.status==='open') refreshCounting(); else drawReview(); }

  function head(){
    const c=C.count;
    return `<div class="cy-head no-print"><button type="button" class="ghost fi-small" data-cy="list">← All counts</button><button type="button" class="ghost fi-small" data-cy="reload">Refresh</button></div>
      <div class="cy-title"><h3>${esc(c.title)}</h3><div class="fi-sub">Count #${c.id} · started by ${esc(c.created_name)} ${when(c.created_at)} · inventory as of ${when(c.snapshot_at)}${c.blind?' · <b>blind</b>':''}</div>${c.note?`<div class="fi-note fi-info">${esc(c.note)}</div>`:''}</div>`;
  }

  // ---------------------------------------------------------------- counting screen
  function drawCounting(){
    const c=C.count, bay=ls.get('lwh_cyBay_'+c.id,'');
    $('cyBody').innerHTML=head()+`
      <div class="card cy-scanbox">
        <div class="cy-prog"><div class="in-bar"><i id="cyBar"></i></div><div id="cyProgTxt" class="fi-sub"></div></div>
        <label>Bay you're counting <span class="fi-sub">(type it or scan the bay label)</span><input id="cyCurBay" list="cyBayList" autocomplete="off" value="${esc(bay)}" placeholder="e.g. RACKT02"></label>
        <datalist id="cyBayList">${C.bays.map(b=>`<option value="${esc(b.bay)}">`).join('')}</datalist>
        <label>Scan pallet <span class="fi-sub">(LWH ID or customer tag)</span><input id="cyScan" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Scan or type, then Enter"></label>
        <div id="cyQtyRow" class="cy-qtyrow" hidden><div id="cyPend" class="cy-pend"></div><label>Qty on this pallet<input id="cyQtyIn" type="number" inputmode="decimal" min="0" step="any"></label><div class="cy-actions"><button type="button" class="ghost" data-cy="cancelpend">Skip</button><button type="button" data-cy="savepend">Save</button></div></div>
        <div class="cy-scanbtns"><button type="button" class="ghost fi-small" id="cyCamBtn" data-cy="cam">📷 Use camera</button><span id="cySaving" class="fi-sub"></span></div>
        <div id="cyCamWrap" hidden><div id="cyCam" class="cy-cam"></div></div>
        <div id="cyFlash" class="cy-flash" hidden></div>
      </div>
      <div class="card"><h4 class="cy-h4">Bays</h4><div id="cyBays" class="cy-bays"></div></div>
      <div class="card"><div class="cy-h4row"><h4 class="cy-h4" id="cyLinesHead"></h4>${C.hidden?'':`<label class="fi-check cy-showall"><input type="checkbox" id="cyShowAll" ${showAll?'checked':''}> Show pallets not found yet</label>`}</div><div id="cyLines"></div></div>
      <div class="cy-actions cy-bottom"><button type="button" class="fi-submit" data-cy="submit">Done counting — submit</button></div>
      ${isMgr()?'<div class="cy-actions"><button type="button" class="ghost ob-danger fi-small" data-cy="cancelcount">Cancel this count</button></div>':''}`;
    const scan=$('cyScan'), bayIn=$('cyCurBay');
    bayIn.onchange=()=>{ bayIn.value=bayIn.value.trim().toUpperCase(); ls.set('lwh_cyBay_'+c.id,bayIn.value); };
    bayIn.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); bayIn.onchange(); scan.focus(); } };
    scan.onkeydown=e=>{ if(e.key==='Enter'||e.key==='Tab'){ e.preventDefault(); const v=scan.value; scan.value=''; if(v.trim()) onCode(v,'scanner'); } };
    $('cyQtyIn').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); savePending(); } };
    if($('cyShowAll')) $('cyShowAll').onchange=e=>{ showAll=e.target.checked; refreshCounting(); };
    refreshCounting();
    setTimeout(()=>(bayIn.value?scan:bayIn).focus(),50);
  }
  function refreshCounting(){
    if(!$('cyBays')) return drawCounting();
    const c=C.count, pct=c.expected?Math.round(c.counted/c.expected*100):0;
    $('cyBar').style.width=pct+'%';
    $('cyProgTxt').innerHTML=`<b>${num(c.counted)}</b> of ${num(c.expected)} pallets found${c.extras?` · <span class="in-red">${plural(c.extras,'extra')}</span>`:''}`;
    const cur=($('cyCurBay').value||'').toUpperCase();
    $('cyBays').innerHTML=C.bays.map(b=>{
      const done=b.expected&&b.counted>=b.expected;
      return `<button type="button" class="cy-bay${done?' done':''}${b.bay===cur?' cur':''}${!b.expected?' extra':''}" data-cy-setbay="${esc(b.bay)}"><b>${esc(b.bay)}</b><span>${b.expected?`${num(Math.min(b.counted,b.expected))}/${num(b.expected)}`:'not in count'}</span></button>`;
    }).join('')||'<div class="fi-sub">—</div>';
    const scanned=C.lines.filter(l=>l.counted).sort((a,b)=>String(b.counted_at).localeCompare(String(a.counted_at)));
    const notYet=showAll&&!C.hidden?C.lines.filter(l=>l.expected&&!l.counted):[];
    $('cyLinesHead').textContent=showAll?`Not found yet (${notYet.length}) · Scanned (${scanned.length})`:`Scanned (${scanned.length})`;
    $('cyLines').innerHTML=(notYet.length?`<table class="cy-t"><thead><tr><th>LWH ID</th><th>Tag</th><th>Customer / Item / Lot</th><th>Bay</th>${c.count_qty?'<th>Qty</th>':''}</tr></thead><tbody>${notYet.map(l=>`<tr class="cy-notyet"><td>${esc(l.pallet_id)}</td><td>${esc(l.tag||'')}</td><td>${esc([l.customer,l.item,l.lot].filter(Boolean).join(' · '))}</td><td>${esc(l.exp_bay||'')}</td>${c.count_qty?`<td>${num(l.exp_qty)}</td>`:''}</tr>`).join('')}</tbody></table><h4 class="cy-h4">Scanned</h4>`:'')
      +(scanned.length?`<table class="cy-t"><thead><tr><th></th><th>LWH ID / tag</th><th>Customer / Item / Lot</th><th>Bay</th>${c.count_qty?'<th>Qty</th>':''}<th>By</th><th></th></tr></thead><tbody>${scanned.slice(0,300).map(l=>{
        const r=RES[l.result]||['',''];
        return `<tr><td>${l.result?`<span class="cy-badge cy-${r[1]}">${r[0]}</span>`:''}</td><td>${esc(l.pallet_id||l.scanned)}${l.tag&&String(l.tag)!==String(l.pallet_id)?`<div class="fi-sub">${esc(l.tag)}</div>`:''}</td><td>${esc([l.customer,l.item,l.lot].filter(Boolean).join(' · ')||'—')}${l.sys_where?`<div class="fi-sub in-red">System: ${esc(l.sys_where)}</div>`:''}</td><td>${esc(l.cnt_bay||'')}${l.result==='bay'||l.result==='qty_bay'?`<div class="fi-sub">should be ${esc(l.exp_bay)}</div>`:''}</td>${c.count_qty?`<td>${num(l.cnt_qty)}</td>`:''}<td class="fi-sub">${esc((l.counted_name||'').split(' ')[0])}</td><td><button type="button" class="ghost cy-x" data-cy-undo="${l.id}" title="Undo this scan">Undo</button></td></tr>`;
      }).join('')}</tbody></table>`:'<div class="fi-sub">Nothing scanned yet.</div>');
  }

  function cleanCode(v){ return String(v||'').trim().replace(/^\][A-Za-z]\d/,'').toUpperCase(); }
  function onCode(raw,src){
    const v=cleanCode(raw); if(!v) return;
    const bays=C.bays.map(b=>b.bay);
    // A bay label scanned into the pallet box switches the current bay.
    if(bays.includes(v)&&!C.lines.some(l=>String(l.pallet_id)===v||String(l.tag||'').toUpperCase()===v)){
      $('cyCurBay').value=v; ls.set('lwh_cyBay_'+C.count.id,v); flash('info','Now counting bay '+v); refreshCounting(); return;
    }
    if(!$('cyCurBay').value.trim()){ flash('warn','Enter or scan the bay you\'re in first.'); $('cyCurBay').focus(); return; }
    if(C.count.count_qty){
      pending={code:v,src};
      $('cyQtyRow').hidden=false; $('cyPend').innerHTML=`Pallet <b>${esc(v)}</b> — how many on it?`;
      $('cyQtyIn').value=''; $('cyQtyIn').focus();
    }else save(v,null);
  }
  function savePending(){
    if(!pending) return;
    const q=$('cyQtyIn').value; if(q===''||isNaN(+q)){ toast('Type the qty (0 or more).'); $('cyQtyIn').focus(); return; }
    const p=pending; pending=null; $('cyQtyRow').hidden=true; save(p.code,+q);
  }
  async function save(code,qty){
    $('cySaving').textContent='Saving…';
    try{
      const r=await rpc('cyc_scan',{p_id:C.count.id,p_code:code,p_bay:$('cyCurBay').value.trim(),p_qty:qty});
      const what=[r.customer,r.item,r.lot].filter(Boolean).join(' · ');
      if(r.result==='match') flash('ok',`✓ ${esc(r.pallet_id||code)}${what?' — '+esc(what):''}${r.again?' (scanned again — updated)':''}`);
      else if(r.result==='bay'||r.result==='qty_bay') flash('warn',`Wrong bay: ${esc(r.pallet_id||code)} should be in <b>${esc(r.exp_bay)}</b>. Counted here — leave it or move it, and tell your manager.`);
      else if(r.result==='qty') flash('warn',`Saved ${esc(r.pallet_id||code)} — qty doesn't match the system.`);
      else if(r.result==='extra') flash('bad',`Not part of this count: ${esc(code)}. ${r.sys_where?'System says: <b>'+esc(r.sys_where)+'</b>':''}${what?' — '+esc(what):''}`);
      beep(r.result==='match'?'ok':'bad');
      $('cySaving').textContent='';
      await reload();
    }catch(e){ $('cySaving').textContent=''; flash('bad',esc(e.message)); beep('bad'); }
    $('cyScan')&&$('cyScan').focus();
  }
  function flash(kind,html){ const f=$('cyFlash'); if(!f) return; f.hidden=false; f.className='cy-flash cy-'+kind; f.innerHTML=html; }
  function beep(kind){ try{ const a=new (window.AudioContext||window.webkitAudioContext)(), o=a.createOscillator(), g=a.createGain(); o.frequency.value=kind==='ok'?880:220; g.gain.value=.08; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime+(kind==='ok'?.08:.3)); }catch(e){} if(navigator.vibrate&&kind!=='ok') navigator.vibrate(200); }

  async function startCam(){
    if(cam){ stopCam(); return; }
    if(typeof Html5Qrcode==='undefined'){ toast('The camera scanner didn\'t load. A scanner gun still works.'); return; }
    $('cyCamWrap').hidden=false; $('cyCamBtn').textContent='Stop camera';
    const F=window.Html5QrcodeSupportedFormats;
    cam=new Html5Qrcode('cyCam');
    try{
      await cam.start({facingMode:'environment'},{fps:12,qrbox:(w,h)=>({width:Math.min(w*0.9,420),height:Math.min(h*0.45,180)}),formatsToSupport:F?[F.CODE_128,F.CODE_39,F.ITF,F.EAN_13,F.UPC_A,F.QR_CODE,F.DATA_MATRIX]:undefined},
        txt=>{ const v=cleanCode(txt), now=Date.now(); if(v===camLast.v&&now-camLast.t<3000){ camLast.t=now; return; } camLast={v,t:now}; if(pending) return; onCode(v,'camera'); },()=>{});
    }catch(e){ toast('Camera error: '+e.message); stopCam(); }
  }
  function stopCam(){ const c=cam; cam=null; if(c){ try{ c.stop().then(()=>c.clear()).catch(()=>{}); }catch(e){} } if($('cyCamWrap')) $('cyCamWrap').hidden=true; if($('cyCamBtn')) $('cyCamBtn').textContent='📷 Use camera'; }

  async function submit(){
    const c=C.count, left=c.expected-c.counted;
    if(!confirm(left>0?`${plural(left,'pallet')} haven't been scanned. They'll be marked MISSING.\n\nSubmit the count anyway?`:'Submit this count for review?')) return;
    try{ await rpc('cyc_submit',{p_id:c.id}); stopCam(); toast('Count submitted.'); filt='diff'; openCount(c.id); }catch(e){ toast(e.message); }
  }

  // ---------------------------------------------------------------- review screen
  function nowText(l){
    if(l.result==='missing'&&l.now_present===false) return '<span class="cy-badge cy-ok">Gone from BirdsEye since</span>';
    if(l.result==='missing'&&l.now_bay&&l.exp_bay&&l.now_bay.toUpperCase()!==l.exp_bay.toUpperCase()) return `Moved to <b>${esc(l.now_bay)}</b> since`;
    if((l.result==='bay'||l.result==='qty_bay')&&l.now_bay&&l.cnt_bay&&l.now_bay.toUpperCase()===l.cnt_bay.toUpperCase()) return '<span class="cy-badge cy-ok">Bay fixed in BirdsEye</span>';
    if(l.result==='extra') return esc(l.sys_where||'');
    return '';
  }
  function drawReview(){
    const c=C.count, mgr=C.is_manager, rev=c.status==='review';
    const diffs=C.lines.filter(l=>l.result&&l.result!=='match');
    const by=k=>diffs.filter(l=>l.result===k).length;
    const rows=filt==='all'?C.lines:filt==='open'?diffs.filter(l=>!l.resolution):diffs;
    $('cyBody').innerHTML=head()+`
      <div class="card">
        <div class="cy-sum">
          <div><b>${num(c.counted)}</b><span>of ${num(c.expected)} found</span></div>
          <div class="${by('missing')?'bad':''}"><b>${by('missing')}</b><span>missing</span></div>
          <div class="${by('extra')?'bad':''}"><b>${by('extra')}</b><span>extra</span></div>
          <div class="${by('bay')+by('qty_bay')?'warn':''}"><b>${by('bay')+by('qty_bay')}</b><span>wrong bay</span></div>
          ${c.count_qty?`<div class="${by('qty')+by('qty_bay')?'warn':''}"><b>${by('qty')+by('qty_bay')}</b><span>qty off</span></div>`:''}
        </div>
        <div class="fi-sub">Submitted by ${esc(c.submitted_name||'')} ${when(c.submitted_at)}${c.closed_at?` · ${c.status==='cancelled'?'cancelled':'closed'} by ${esc(c.closed_name)} ${when(c.closed_at)}${c.close_note?' — '+esc(c.close_note):''}`:''}</div>
        ${rev?`<div class="fi-note ${c.open_diffs?'fi-warn':'fi-ok'}">${c.open_diffs?`${plural(c.open_diffs,'difference')} still to handle.${mgr?' Pick what was done for each one below, then close the count.':' A manager will review them.'}`:'Every difference is handled.'+(mgr?' You can close the count.':'')}</div>`:''}
      </div>
      <div class="cy-filters no-print">
        <button type="button" class="ac-chip${filt==='diff'?' on':''}" data-cy-filt="diff">Differences (${diffs.length})</button>
        ${rev?`<button type="button" class="ac-chip${filt==='open'?' on':''}" data-cy-filt="open">Not handled (${c.open_diffs})</button>`:''}
        <button type="button" class="ac-chip${filt==='all'?' on':''}" data-cy-filt="all">Every pallet (${C.lines.length})</button>
        <span class="cy-grow"></span>
        <button type="button" class="ghost fi-small" data-cy="xlsx">Excel</button><button type="button" class="ghost fi-small" data-cy="print">Print</button>
      </div>
      <div class="card cy-tablewrap">${rows.length?`<table class="cy-t cy-review"><thead><tr><th>Result</th><th>LWH ID / tag</th><th>Customer · Item · Lot</th><th>System bay</th><th>Counted bay</th>${c.count_qty?'<th>System qty</th><th>Counted</th>':''}<th>In BirdsEye now</th><th>Handled</th></tr></thead><tbody>${rows.map(l=>{
        const r=RES[l.result]||['—','muted'];
        return `<tr class="cy-r-${r[1]}"><td><span class="cy-badge cy-${r[1]}">${r[0]}</span></td>
          <td>${esc(l.pallet_id||l.scanned||'')}${l.tag&&String(l.tag)!==String(l.pallet_id)?`<div class="fi-sub">${esc(l.tag)}</div>`:''}</td>
          <td>${esc([l.customer,l.item,l.lot].filter(Boolean).join(' · ')||'—')}${l.description?`<div class="fi-sub">${esc(l.description)}</div>`:''}${l.note?`<div class="fi-sub">Note: ${esc(l.note)}</div>`:''}</td>
          <td>${esc(l.exp_bay||'')}</td><td>${esc(l.cnt_bay||'')}${l.counted_name?`<div class="fi-sub">${esc(l.counted_name)}</div>`:''}</td>
          ${c.count_qty?`<td>${num(l.exp_qty)}</td><td>${l.counted?num(l.cnt_qty):''}${l.counted&&l.expected&&l.cnt_qty!=null&&l.exp_qty!=null&&+l.cnt_qty!==+l.exp_qty?`<div class="fi-sub in-red">${+l.cnt_qty-l.exp_qty>0?'+':''}${num(+l.cnt_qty-l.exp_qty)}</div>`:''}</td>`:''}
          <td>${nowText(l)}</td>
          <td>${l.result&&l.result!=='match'?(mgr&&rev?`<select data-cy-fix="${l.id}"><option value="">— pick —</option>${FIXES.map(f=>`<option${l.resolution===f?' selected':''}>${esc(f)}</option>`).join('')}${l.resolution&&!FIXES.includes(l.resolution)?`<option selected>${esc(l.resolution)}</option>`:''}</select>`:esc(l.resolution||''))+(l.resolved_name?`<div class="fi-sub">${esc(l.resolved_name)}</div>`:''):''}</td></tr>`;
      }).join('')}</tbody></table>`:'<div class="fi-sub">'+(filt==='diff'?'No differences — the floor matches BirdsEye. 🎉':'Nothing here.')+'</div>'}</div>
      ${mgr&&rev?`<div class="cy-actions cy-bottom no-print"><button type="button" class="ghost" data-cy="reopen">Send back for recount</button><button type="button" class="ghost ob-danger" data-cy="cancelcount">Cancel count</button><button type="button" data-cy="close">Close count</button></div>`:''}`;
  }
  async function manage(action,line,text){
    try{ await rpc('cyc_manage',{p_id:C.count.id,p_action:action,p_line:line||null,p_text:text||null}); return true; }
    catch(e){ toast(e.message); return false; }
  }
  function exportXlsx(){
    const c=C.count, q=c.count_qty;
    const cols=[{label:'Result',width:14},{label:'LWH ID',type:'n',width:12},{label:'Customer Tag',width:22},{label:'Customer',width:10},{label:'Item',width:16},{label:'Description',width:28},{label:'Lot',width:14},{label:'System Bay',width:12},{label:'Counted Bay',width:12}]
      .concat(q?[{label:'System Qty',type:'n',width:11},{label:'Counted Qty',type:'n',width:11},{label:'Qty Diff',type:'n',width:9}]:[])
      .concat([{label:'In BirdsEye Now',width:24},{label:'Counted By',width:18},{label:'Counted At',width:18},{label:'Note',width:24},{label:'Handled',width:26},{label:'Handled By',width:18}]);
    const rows=C.lines.map(l=>{
      const now=nowText(l).replace(/<[^>]+>/g,'');
      return [(RES[l.result]||['Not counted'])[0],l.pallet_id||'',l.tag||l.scanned||'',l.customer||'',l.item||'',l.description||'',l.lot||'',l.exp_bay||'',l.cnt_bay||'']
        .concat(q?[l.exp_qty==null?'':+l.exp_qty,l.counted&&l.cnt_qty!=null?+l.cnt_qty:'',l.counted&&l.expected&&l.cnt_qty!=null&&l.exp_qty!=null?(+l.cnt_qty-l.exp_qty):'']:[])
        .concat([now,l.counted_name||'',l.counted_at?when(l.counted_at):'',l.note||'',l.resolution||'',l.resolved_name||'']);
    });
    if(!window.LWHXlsx){ toast('Excel export didn\'t load.'); return; }
    LWHXlsx.download(`Cycle Count ${c.id} - ${c.title.replace(/[^\w .-]+/g,' ').trim()}.xlsx`,[{name:'Count '+c.id,columns:cols,rows}]);
  }

  // ---------------------------------------------------------------- analytics (managers) — v1.102.0
  // Combines Toolkit counts and customer-app counts (Trane app etc.). Server: cyc_analytics.
  let A=null;                      // last analytics result
  const iso=d=>{ const x=new Date(d.getTime()-d.getTimezoneOffset()*60000); return x.toISOString().slice(0,10); };
  const monday=d=>{ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; };
  const pctTxt=v=>v==null?'—':Number(v).toFixed(Number(v)%1?1:0)+'%';
  const accTxt=v=>v==null?'—':Number(v).toFixed(2).replace(/\.00$/,'')+'%';
  const dshort=s=>{ if(!s) return ''; const [y,m,d]=String(s).slice(0,10).split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); };
  const RESNAME={match:'Match',qty:'Qty off',bay:'Wrong bay',qty_bay:'Qty + bay off',missing:'Missing',extra:'Extra'};

  function cyaFilters(){ return ls.get('lwh_cyaF',null)||(()=>{ const t=new Date(), f=monday(new Date(t.getTime()-12*7*864e5)); return {from:iso(f),to:iso(t),wh:'',cust:''}; })(); }
  function showAnalytics(){
    const F=cyaFilters();
    $('cyaBody').innerHTML=`<div class="cya-filters no-print">
        <label>From<input type="date" id="cyaFrom" value="${esc(F.from)}"></label>
        <label>To<input type="date" id="cyaTo" value="${esc(F.to)}"></label>
        <label>Warehouse<select id="cyaWh"><option value="">All warehouses</option>${B.warehouses.map(w=>`<option value="${esc(w.code)}"${w.code===F.wh?' selected':''}>${whLabel(w.code)}</option>`).join('')}</select></label>
        <label>Customer<select id="cyaCust"><option value="">All customers</option>${F.cust?`<option value="${esc(F.cust)}" selected>${esc(F.cust)}</option>`:''}</select></label>
        <div class="cya-quick"><button type="button" class="ghost fi-small" data-cya-quick="week">This week</button><button type="button" class="ghost fi-small" data-cya-quick="4">Last 4 weeks</button><button type="button" class="ghost fi-small" data-cya-quick="13">Last 13 weeks</button><button type="button" class="ghost fi-small" data-cya-quick="year">This year</button></div>
        <div class="cya-go"><button type="button" data-cy="cya-run">Show</button><button type="button" class="ghost" data-cy="cya-xlsx">Excel</button><button type="button" class="ghost" data-cy="cya-print">Print report</button></div>
      </div>
      <div id="cyaOut"><div class="fi-sub">Loading…</div></div>`;
    runAnalytics();
  }
  function cyaQuick(k){
    const t=new Date(); let f;
    if(k==='week') f=monday(t); else if(k==='year') f=new Date(t.getFullYear(),0,1); else f=monday(new Date(t.getTime()-(Number(k)-1)*7*864e5));
    $('cyaFrom').value=iso(f); $('cyaTo').value=iso(t); runAnalytics();
  }
  async function runAnalytics(){
    const F={from:$('cyaFrom').value,to:$('cyaTo').value,wh:$('cyaWh').value,cust:$('cyaCust').value};
    if(!F.from||!F.to){ toast('Pick a from and to date.'); return; }
    ls.set('lwh_cyaF',F);
    $('cyaOut').innerHTML='<div class="fi-sub">Loading…</div>';
    try{ A=await rpc('cyc_analytics',{p_from:F.from,p_to:F.to,p_wh:F.wh||null,p_customer:F.cust||null}); }
    catch(e){ A=null; $('cyaOut').innerHTML=`<div class="fi-note fi-bad">${esc(e.message)}</div>`; return; }
    const sel=$('cyaCust'); sel.innerHTML='<option value="">All customers</option>'+(A.customers||[]).map(c=>`<option value="${esc(c)}"${c===F.cust?' selected':''}>${esc(c)}</option>`).join('');
    $('cyaOut').innerHTML=analyticsHtml(A);
  }

  // every week in the range, including weeks with no count (those matter for a weekly requirement)
  function allWeeks(r){
    const have={}; (r.weeks||[]).forEach(w=>have[String(w.week).slice(0,10)]=w);
    const out=[]; const [y1,m1,d1]=r.from.split('-').map(Number), [y2,m2,d2]=r.to.split('-').map(Number);
    for(let d=monday(new Date(y1,m1-1,d1)), end=new Date(y2,m2-1,d2); d<=end; d.setDate(d.getDate()+7)){
      const k=iso(d); out.push(have[k]||{week:k,none:true});
    }
    return out;
  }
  function scopeLabel(r){ return [r.customer||'All customers', r.warehouse?whLabel(r.warehouse):'All warehouses'].join(' · '); }

  function chartSvg(weeks,target){
    const W=Math.max(weeks.length*46,320), H=170, top=10, bot=28, lo=90, y=v=>top+(H-top-bot)*(1-(Math.max(lo,Math.min(100,v))-lo)/(100-lo));
    const bw=Math.min(30,W/weeks.length-10);
    let g=`<line x1="0" x2="${W}" y1="${y(target)}" y2="${y(target)}" class="cya-tline"/><text x="${W-4}" y="${y(target)-4}" text-anchor="end" class="cya-tlab">${target}% target</text>`;
    [90,95,100].forEach(v=>g+=`<text x="2" y="${y(v)+4}" class="cya-ax">${v}%</text>`);
    weeks.forEach((w,i)=>{
      const x=40+i*((W-44)/weeks.length), lab=dshort(w.week).replace(/, \d{4}$/,'');
      if(w.none){ g+=`<text x="${x+bw/2}" y="${H-bot-6}" text-anchor="middle" class="cya-none">none</text>`; }
      else{ const v=w.accuracy_reviewed??0, ok=v>=target; g+=`<rect x="${x}" y="${y(v)}" width="${bw}" height="${H-bot-y(v)}" class="${ok?'cya-ok':'cya-bad'}"><title>${lab}: ${accTxt(v)}</title></rect><text x="${x+bw/2}" y="${y(v)-3}" text-anchor="middle" class="cya-val">${Math.floor(v*10)/10}</text>`; }
      g+=`<text x="${x+bw/2}" y="${H-10}" text-anchor="middle" class="cya-ax">${esc(lab)}</text>`;
    });
    return `<svg class="cya-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Weekly accuracy after review against the ${target}% target">${g}</svg>`;
  }
  function grpTable(rows,label,withChecked){
    if(!rows.length) return '<p class="fi-sub">Nothing counted.</p>';
    return `<div class="cy-tablewrap"><table class="cy-t"><thead><tr><th>${label}</th><th>Counts</th>${withChecked?'<th>Pallets checked</th>':''}<th>Lines</th><th>Differences</th><th>Errors after review</th><th>Accuracy (scanned)</th><th>Accuracy (after review)</th></tr></thead><tbody>${
      rows.map(g=>`<tr><td><b>${esc(label==='Warehouse'?whLabel(g.key):g.key)}</b></td><td>${num(g.counts)}</td>${withChecked?`<td>${num(g.checked)}</td>`:''}<td>${num(g.lines)}</td><td>${num(g.lines-g.match)}</td><td>${num(g.errors_reviewed)}</td><td>${accTxt(g.accuracy)}</td><td class="${g.accuracy_reviewed>=A.target?'cya-good':'cya-low'}"><b>${accTxt(g.accuracy_reviewed)}</b></td></tr>`).join('')}</tbody></table></div>`;
  }
  function analyticsHtml(r){
    const T=r.totals, tgt=r.target, weeks=allWeeks(r), oh=r.onhand||{};
    const weekly=!!r.customer;  // the % of warehouse column means most for one customer
    const met=weeks.filter(w=>!w.none&&w.accuracy_reviewed>=tgt).length, counted=weeks.filter(w=>!w.none).length;
    const bayPct=oh.bays?Math.round(T.bays/oh.bays*1000)/10:null;
    const tile=(v,l,cls)=>`<div class="${cls||''}"><b>${v}</b><span>${l}</span></div>`;
    if(!T.lines) return `<div class="cya-printhead">${printHead(r)}</div><div class="cya-sec"><p>No finished counts for <b>${esc(scopeLabel(r))}</b> between ${dshort(r.from)} and ${dshort(r.to)}.</p><p class="fi-sub">Only closed counts are included. Counts from the Toolkit and from the customer inventory apps (Trane, Franklin) both show here.</p></div>`;
    return `<div class="cya-printhead">${printHead(r)}</div>
    <div class="cya-sec">
      <div class="cy-sum cya-tiles">
        ${tile(accTxt(T.accuracy_reviewed),`Accuracy after review · target ${tgt}%`,T.accuracy_reviewed>=tgt?'':'bad')}
        ${tile(accTxt(T.accuracy),'Accuracy as scanned',T.accuracy>=tgt?'':'warn')}
        ${tile(num(T.checked),'Pallets checked')}
        ${tile(num(T.counts),'Counts finished')}
        ${tile(`${num(T.bays)}${oh.bays?` <small>of ${num(oh.bays)}</small>`:''}`,'Bays counted'+(bayPct!=null?` · ${pctTxt(bayPct)} of bays on hand`:''))}
        ${tile(num(T.lines-T.match),'Differences found',T.lines-T.match?'warn':'')}
        ${weekly?tile(`${met} of ${weeks.length}`,`Weeks at ${tgt}% or better`,met===weeks.length?'':'bad'):''}
      </div>
      <p class="fi-sub cya-scope">${esc(scopeLabel(r))} · ${dshort(r.from)} – ${dshort(r.to)} · on hand now: ${num(oh.pallets)} pallets in ${num(oh.bays)} bays</p>
    </div>
    <div class="cya-sec">
      <h4 class="cy-h4">Weekly accuracy (after review)</h4>
      <div class="cya-chartwrap">${chartSvg(weeks,tgt)}</div>
      <div class="cy-tablewrap"><table class="cy-t cya-weeks"><thead><tr><th>Week of</th><th>Counts</th><th>Pallets checked</th><th>On hand</th><th>% checked</th><th>Bays</th><th>Differences</th><th>Errors after review</th><th>Accuracy (scanned)</th><th>Accuracy (after review)</th><th>${tgt}%?</th></tr></thead><tbody>${
        weeks.map(w=>w.none?`<tr class="cya-miss"><td><b>${dshort(w.week).replace(/, \d{4}$/,'')}</b></td><td colspan="9">No finished count this week</td><td>${weekly?'<span class="cy-badge cy-bad">No count</span>':'—'}</td></tr>`
          :`<tr><td><b>${dshort(w.week).replace(/, \d{4}$/,'')}</b></td><td>${num(w.counts)}</td><td>${num(w.checked)}</td><td>${num(w.onhand)}</td><td>${pctTxt(w.coverage)}</td><td>${num(w.bays)}</td><td>${num(w.diffs)}</td><td>${num(w.errors_reviewed)}</td><td>${accTxt(w.accuracy)}</td><td><b>${accTxt(w.accuracy_reviewed)}</b></td><td>${w.accuracy_reviewed>=tgt?'<span class="cy-badge cy-ok">Met</span>':'<span class="cy-badge cy-bad">Below</span>'}</td></tr>`).join('')}</tbody></table></div>
      ${r.snapshots_since?`<p class="fi-sub">"On hand" is what was in inventory that week (daily snapshots began ${dshort(r.snapshots_since)}; earlier weeks use today's on-hand).</p>`:''}
    </div>
    <div class="cya-sec cya-two">
      <div><h4 class="cy-h4">By warehouse</h4>${grpTable(r.by_warehouse,'Warehouse',true)}</div>
      ${r.customer?'':`<div><h4 class="cy-h4">By customer</h4>${grpTable(r.by_customer,'Customer',true)}</div>`}
    </div>
    <div class="cya-sec cya-two">
      <div><h4 class="cy-h4">What the differences were</h4><div class="cy-tablewrap"><table class="cy-t"><thead><tr><th>Result</th><th>Lines</th></tr></thead><tbody>${
        ['qty','bay','qty_bay','missing','extra'].filter(k=>T[k]).map(k=>`<tr><td>${RESNAME[k]}</td><td>${num(T[k])}</td></tr>`).join('')||'<tr><td colspan="2">None — every pallet matched.</td></tr>'}</tbody></table></div></div>
      <div><h4 class="cy-h4">How they were handled</h4><div class="cy-tablewrap"><table class="cy-t"><thead><tr><th>Resolution</th><th>Lines</th><th>Counts as error</th></tr></thead><tbody>${
        (r.resolutions||[]).map(x=>`<tr><td>${esc(x.resolution)}</td><td>${num(x.n)}</td><td>${x.counts_as_error?'Yes':'No'}</td></tr>`).join('')||'<tr><td colspan="3">No differences.</td></tr>'}</tbody></table></div></div>
    </div>
    ${(r.problem_bays||[]).length||(r.problem_items||[]).length?`<div class="cya-sec cya-two">
      <div><h4 class="cy-h4">Bays with the most differences</h4><div class="cy-tablewrap"><table class="cy-t"><thead><tr><th>Warehouse</th><th>Bay</th><th>Differences</th><th>Lines</th></tr></thead><tbody>${(r.problem_bays||[]).map(b=>`<tr><td>${whLabel(b.warehouse)}</td><td><b>${esc(b.bay||'—')}</b></td><td>${num(b.diffs)}</td><td>${num(b.lines)}</td></tr>`).join('')||'<tr><td colspan="4">None</td></tr>'}</tbody></table></div></div>
      <div><h4 class="cy-h4">Items with the most differences</h4><div class="cy-tablewrap"><table class="cy-t"><thead><tr><th>Customer</th><th>Item</th><th>Differences</th><th>Lines</th></tr></thead><tbody>${(r.problem_items||[]).map(b=>`<tr><td>${esc(b.customer)}</td><td><b>${esc(b.item)}</b></td><td>${num(b.diffs)}</td><td>${num(b.lines)}</td></tr>`).join('')||'<tr><td colspan="4">None</td></tr>'}</tbody></table></div></div>
    </div>`:''}
    <div class="cya-sec"><h4 class="cy-h4">By counter</h4>${grpTable(r.by_counter,'Counter',false)}</div>
    <div class="cya-sec"><h4 class="cy-h4">Counts included (${num(r.counts.length)})</h4><div class="cy-tablewrap"><table class="cy-t"><thead><tr><th>Date</th><th>Count</th><th>From</th><th>Warehouse</th><th>Customer</th><th>Lines</th><th>Differences</th><th>Accuracy (after review)</th><th>Counted by</th></tr></thead><tbody>${
      r.counts.map(c=>`<tr><td>${dshort(c.day)}</td><td>${c.src==='toolkit'?`<button type="button" class="cya-link" data-cy-open="${c.id}">#${c.id}</button>`:'#'+c.id} ${esc(c.title||'')}</td><td>${c.src==='toolkit'?'Toolkit':'Customer app'}</td><td>${esc(String(c.warehouse||'').split(', ').map(whLabel).join(', '))}</td><td>${esc(c.customers||'')}</td><td>${num(c.lines)}</td><td>${num(c.lines-c.match)}</td><td>${accTxt(c.accuracy_reviewed)}</td><td>${esc(c.counters||'')}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="cya-sec cya-defs">
      <h4 class="cy-h4">How these numbers work</h4>
      <p><b>Accuracy as scanned</b> = pallets that matched (right pallet, right bay and right qty when qty was counted) ÷ every line in the count, including extras found.</p>
      <p><b>Accuracy after review</b> = the same, but a difference is not counted as an error when the manager marked it <i>Found — count was wrong</i>, <i>Shipped / moved during count</i> or <i>Recounted — OK</i> (the inventory record was right). For counts done in the customer apps, a difference stays an error if it was adjusted in the WMS or not marked. The ${tgt}% target is checked against this number.</p>
      <p><b>% of pallets checked</b> = pallets on the count list that were checked that week ÷ pallets on hand that week. Only closed counts are included.</p>
    </div>
    <div class="cya-sign"><div>Reviewed by: ______________________________</div><div>Date: ______________</div></div>`;
  }
  function printHead(r){
    const me=B&&B.me?B.me.name:'';
    return `<div class="cya-ph"><div class="cya-ph-badge">LWH</div><div><h2>Cycle Count Accuracy Report</h2><div>${esc(scopeLabel(r))} · ${dshort(r.from)} – ${dshort(r.to)}</div></div><div class="cya-ph-r">Logistics Warehouse, Inc.<br>Printed ${esc(new Date().toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}))}${me?' by '+esc(me):''}</div></div>`;
  }
  function analyticsPrint(){
    if(!A||!A.ok){ toast('Show the analytics first.'); return; }
    const old=document.title; document.title=`Cycle Count Accuracy ${A.customer||'All'} ${A.from} to ${A.to}`;
    document.body.classList.add('cya-printing'); window.print();
    setTimeout(()=>{ document.body.classList.remove('cya-printing'); document.title=old; },500);
  }
  function analyticsXlsx(){
    if(!A||!A.ok){ toast('Show the analytics first.'); return; }
    const r=A, T=r.totals, weeks=allWeeks(r), n=v=>v==null?'':Number(v);
    const N=(label,w)=>({label,type:'n',width:w||14}), S=(label,w)=>({label,width:w||16});
    const grp=(rows,label)=>({columns:[S(label,18),N('Counts',10),N('Pallets checked'),N('Lines',10),N('Differences'),N('Errors after review',18),N('Accuracy % (scanned)',18),N('Accuracy % (after review)',22)],
      rows:rows.map(g=>[label==='Warehouse'?whLabel(g.key):g.key,g.counts,n(g.checked),g.lines,g.lines-g.match,g.errors_reviewed,n(g.accuracy),n(g.accuracy_reviewed)])});
    const sheets=[
      {name:'Summary',columns:[S('Measure',34),S('Value',30)],rows:[
        ['Report','Cycle Count Accuracy'],['Customer',r.customer||'All customers'],['Warehouse',r.warehouse?whLabel(r.warehouse):'All warehouses'],
        ['From',r.from],['To',r.to],['Target accuracy %',r.target],['Accuracy % (after review)',n(T.accuracy_reviewed)],['Accuracy % (as scanned)',n(T.accuracy)],
        ['Counts finished',T.counts],['Pallets checked',T.checked],['Lines (incl. extras)',T.lines],['Differences found',T.lines-T.match],['Errors after review',T.errors_reviewed],
        ['Bays counted',T.bays],['Bays on hand now',n(r.onhand&&r.onhand.bays)],['Pallets on hand now',n(r.onhand&&r.onhand.pallets)],
        ['Weeks in range',weeks.length],['Weeks with a finished count',weeks.filter(w=>!w.none).length],['Weeks at target or better',weeks.filter(w=>!w.none&&w.accuracy_reviewed>=r.target).length],
        ['Printed',new Date().toLocaleString('en-US')],['Printed by',B&&B.me?B.me.name:'']]},
      {name:'Weekly',columns:[S('Week of (Mon)',14),N('Counts',10),N('Pallets checked'),N('On hand'),N('% of pallets checked',18),N('Bays',10),N('Differences'),N('Errors after review',18),N('Accuracy % (scanned)',18),N('Accuracy % (after review)',22),S('Target met',12)],
        rows:weeks.map(w=>w.none?[w.week,0,0,'','','','','','','','No count']:[String(w.week).slice(0,10),w.counts,w.checked,n(w.onhand),n(w.coverage),w.bays,w.diffs,w.errors_reviewed,n(w.accuracy),n(w.accuracy_reviewed),w.accuracy_reviewed>=r.target?'Yes':'No'])},
      Object.assign({name:'By Warehouse'},grp(r.by_warehouse,'Warehouse')),
      Object.assign({name:'By Customer'},grp(r.by_customer,'Customer')),
      Object.assign({name:'By Counter'},grp(r.by_counter,'Counter')),
      {name:'Problem Bays',columns:[S('Warehouse',12),S('Bay',14),N('Differences'),N('Lines',10)],rows:(r.problem_bays||[]).map(b=>[whLabel(b.warehouse),b.bay,b.diffs,b.lines])},
      {name:'Problem Items',columns:[S('Customer',12),S('Item',20),N('Differences'),N('Lines',10)],rows:(r.problem_items||[]).map(b=>[b.customer,b.item,b.diffs,b.lines])},
      {name:'Resolutions',columns:[S('Resolution',34),N('Lines',10),S('Counts as error',16)],rows:(r.resolutions||[]).map(x=>[x.resolution,x.n,x.counts_as_error?'Yes':'No'])},
      {name:'Counts',columns:[S('Date',12),S('From',14),N('Count #',10),S('Title',34),S('Warehouse',14),S('Customer',14),N('Lines',10),N('Differences'),N('Errors after review',18),N('Accuracy % (scanned)',18),N('Accuracy % (after review)',22),S('Counted by',24)],
        rows:r.counts.map(c=>[c.day,c.src==='toolkit'?'Toolkit':'Customer app',c.id,c.title||'',String(c.warehouse||'').split(', ').map(whLabel).join(', '),c.customers||'',c.lines,c.lines-c.match,c.errors_reviewed,n(c.accuracy),n(c.accuracy_reviewed),c.counters||''])}
    ];
    LWHXlsx.download(`Cycle Count Accuracy ${r.customer||'All'} ${r.from} to ${r.to}.xlsx`,sheets);
  }


  // ---------------------------------------------------------------- clicks
  async function onClick(e){
    const t=e.target.closest('button,[data-cy-setbay]'); if(!t||!$(VIEW).contains(t)) return;
    const d=t.dataset;
    if(d.cyTab){ showList(d.cyTab); return; }
    if(d.cyOpen){ openCount(d.cyOpen); return; }
    if(d.cyType){ readFields(); newForm.type=d.cyType; drawFields(); return; }
    if(d.cyDelbay){ newForm.bays=newForm.bays.filter(b=>b!==d.cyDelbay); drawBayChips(); preview(); return; }
    if(d.cySetbay){ $('cyCurBay').value=d.cySetbay; ls.set('lwh_cyBay_'+C.count.id,d.cySetbay); refreshCounting(); $('cyScan').focus(); return; }
    if(d.cyUndo){ try{ await rpc('cyc_undo',{p_line:+d.cyUndo}); await reload(); }catch(err){ toast(err.message); } return; }
    if(d.cyFilt){ filt=d.cyFilt; drawReview(); return; }
    if(d.cyaQuick){ cyaQuick(d.cyaQuick); return; }
    switch(d.cy){
      case 'new': showNew(); break;
      case 'list': showList(); break;
      case 'refresh': showList(); break;
      case 'reload': reload(); break;
      case 'create': create(); break;
      case 'addbay': { const v=$('cyBay').value.trim().toUpperCase(); if(v&&!newForm.bays.includes(v)) newForm.bays.push(v); $('cyBay').value=''; drawBayChips(); preview(); $('cyBay').focus(); break; }
      case 'cam': startCam(); break;
      case 'savepend': savePending(); break;
      case 'cancelpend': pending=null; $('cyQtyRow').hidden=true; $('cyScan').focus(); break;
      case 'submit': submit(); break;
      case 'xlsx': exportXlsx(); break;
      case 'print': window.print(); break;
      case 'reopen': if(confirm('Send this count back to counting? Differences not marked handled are cleared so people can rescan.')&&await manage('reopen')){ openCount(C.count.id); } break;
      case 'close': { if(C.count.open_diffs&&!confirm(`${plural(C.count.open_diffs,'difference')} aren't marked handled. Close anyway?`)) break; const n=prompt('Closing note (optional):','')??null; if(n===null) break; if(await manage('close',null,n)){ toast('Count closed.'); showList('closed'); } break; }
      case 'cya-run': runAnalytics(); break;
      case 'cya-xlsx': analyticsXlsx(); break;
      case 'cya-print': analyticsPrint(); break;
      case 'cancelcount': { const n=prompt('Cancel this count? Reason (optional):',''); if(n===null) break; if(await manage('cancel',null,n)){ toast('Count cancelled.'); showList(); } break; }
    }
  }
  document.addEventListener('change',async e=>{
    const s=e.target.closest&&e.target.closest('#'+VIEW+' [data-cy-fix]'); if(!s) return;
    let v=s.value; if(v==='Other'){ v=prompt('What was done?',''); if(!v){ s.value=''; return; } }
    if(await manage('resolve',+s.dataset.cyFix,v)) reload();
  });
  document.addEventListener('input',e=>{
    const f=e.target.closest&&e.target.closest('#'+VIEW+' [data-cy-field]'); if(!f) return;
    clearTimeout(sugT); sugT=setTimeout(()=>{ suggest(f.id); if(f.id!=='cyBay') preview(); },250);
  });
  document.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target&&e.target.id==='cyBay'){ e.preventDefault(); const b=document.querySelector('#'+VIEW+' [data-cy="addbay"]'); if(b) b.click(); } });

  document.addEventListener('DOMContentLoaded',()=>{
    const sec=$(VIEW); if(!sec) return;
    const onShow=()=>{ build(); if(!B) boot(); else if(C) reload(); };
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); else stopCam(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
  });
})();
