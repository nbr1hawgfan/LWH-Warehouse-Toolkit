/* LWH Warehouse Toolkit — Quick Lookup (v1.72.0)
   The "slimmed-down Toolkit" screen: one search box, type / scan / speak,
   see results, print them with scannable barcodes, see transaction history,
   and hand the data off to Excel when someone wants it there.

   - Same live inventory as Master Lookup (LWHInventory.getAllRows(), the
     master-lookup-csv feed from Supabase, refreshed every ~15 min). No new
     data source, no new database objects.
   - Same transaction history as Transaction History / Item Transaction
     Lookup (LWHTransactions, rolling ~90-day window).
   - Direct link: index.html?view=quickLookup opens straight to this screen
     with the side menu tucked away. Home button still goes to the full
     Toolkit.
*/
(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const clean=v=>{ const s=String(v??'').trim(); return /^null$/i.test(s)?'':s; };
  const norm=v=>clean(v).toLowerCase();
  const squash=s=>String(s||'').replace(/[\s-]+/g,'');
  const num=v=>{ const n=parseFloat(String(v??'').replace(/,/g,'')); return isFinite(n)?n:0; };
  const fmt=n=>Number(n||0).toLocaleString();
  const bayOf=r=>clean(r.currentBay||r.bayName);
  const whOf=r=>clean(r.warehouse||r.location);
  const cmp=(a,b)=>String(a||'').localeCompare(String(b||''),undefined,{numeric:true,sensitivity:'base'});

  const DISPLAY_CAP=300;      // cards drawn on screen; print/export always use everything
  const SHORTCUT_URL='https://nbr1hawgfan.github.io/LWH-Warehouse-Toolkit/index.html?view=quickLookup';

  // Inventory fields (Master Lookup row shape) and the matching transaction
  // fields. "Bay" has no transaction column, so its history comes from the
  // LWH IDs currently in that bay.
  const FIELDS={
    any:     {label:'Anything'},
    lwh:     {label:'LWH ID',      inv:r=>[r.controlNumber],   txn:t=>[t.lwhId,t.madeFrom]},
    item:    {label:'Item #',      inv:r=>[r.itemNm],          txn:t=>[t.itemNm]},
    custid:  {label:'Customer ID', inv:r=>[r.comments],        txn:t=>[t.customerId]},
    bay:     {label:'Bay',         inv:r=>[bayOf(r)],          txn:null},
    customer:{label:'Customer',    inv:r=>[r.subCustNm],       txn:t=>[t.subCustNm]},
    lot:     {label:'Lot #',       inv:r=>[r.lotNum],          txn:t=>[t.lotNum]},
    inv:     {label:'INV Receipt', inv:r=>[r.invReceipt],      txn:t=>[t.invReceipt]}
  };
  const CHIP_ORDER=['any','lwh','item','custid','bay','customer','lot','inv'];
  // When "Anything" is picked and the whole search exactly equals one of
  // these, that field wins (a scanned LWH ID shows just that pallet).
  const EXACT_ORDER=['lwh','custid','inv','item','bay','lot','customer'];
  // Spoken prefixes: "bay X L F zero two three", "item 870537", "lot ..."
  const SPOKEN=[[/^(lwh|l w h|pallet)( id)?\s+/i,'lwh'],[/^item( number)?\s+/i,'item'],[/^customer id\s+/i,'custid'],[/^bay\s+/i,'bay'],[/^lot( number)?\s+/i,'lot'],[/^(inv|invoice|inventory) receipt\s+/i,'inv'],[/^customer\s+/i,'customer']];

  const S={
    field:LWHStorage.get('qlField','any'),
    wh:'all',
    query:'',
    res:null,          // {rows, field (effective), how}
    tab:'pallets',     // pallets | summary | history
    hist:null,         // {rows, note} for the current search
    histKey:'',
    detail:null        // row being shown in detail view
  };
  if(!FIELDS[S.field]) S.field='any';

  // ---------- data ----------
  function invRows(){ return (window.LWHInventory&&LWHInventory.getAllRows())||[]; }
  const hayCache=new WeakMap();
  function hayOf(r){
    let h=hayCache.get(r);
    if(!h){ h=[r.controlNumber,r.invReceipt,r.subCustNm,r.itemNm,r.itemDesc,r.lotNum,r.qty,r.comments,r.vendor,r.unique2,r.unique3,r.unique5,r.unique6,r.unique7,r.unique8,whOf(r),bayOf(r)].map(norm).join(' | '); hayCache.set(r,h); }
    return h;
  }
  function syncedLabel(rows){
    const latest=rows.reduce((m,r)=>r.syncedAt&&r.syncedAt>m?r.syncedAt:m,'');
    if(!latest) return '';
    const d=new Date(latest.includes('T')?latest:latest.replace(' ','T'));
    return isNaN(d)?'':d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  }

  function matchList(list,getter,q){
    const ql=q.toLowerCase(), qs=squash(ql);
    const exact=list.filter(x=>getter(x).some(v=>{ const n=norm(v); return n && (n===ql || squash(n)===qs); }));
    if(exact.length) return {rows:exact,how:'exact'};
    const part=list.filter(x=>getter(x).some(v=>{ const n=norm(v); return n && (n.includes(ql) || (qs.length>2 && squash(n).includes(qs))); }));
    return {rows:part,how:'contains'};
  }

  function searchInventory(q,field){
    let rows=invRows();
    if(S.wh!=='all') rows=rows.filter(r=>whOf(r)===S.wh);
    q=String(q||'').trim();
    if(!q) return {rows:[],field,how:''};
    if(field!=='any'){
      const m=matchList(rows,FIELDS[field].inv,q);
      return {rows:m.rows,field,how:m.how};
    }
    const ql=q.toLowerCase(), qs=squash(ql);
    for(const key of EXACT_ORDER){
      const g=FIELDS[key].inv;
      const hit=rows.filter(r=>g(r).some(v=>{ const n=norm(v); return n && (n===ql || squash(n)===qs); }));
      if(hit.length) return {rows:hit,field:key,how:'exact'};
    }
    const terms=ql.split(/\s+/).filter(Boolean);
    let hit=rows.filter(r=>{ const h=hayOf(r); return terms.every(t=>h.includes(t)); });
    if(!hit.length && terms.length>1 && qs.length>2) hit=rows.filter(r=>squash(hayOf(r)).includes(qs));
    return {rows:hit,field:'any',how:'contains'};
  }

  function sortRows(rows,field){
    const out=rows.slice();
    if(field==='bay') out.sort((a,b)=>cmp(bayOf(a),bayOf(b))||cmp(a.itemNm,b.itemNm)||cmp(a.controlNumber,b.controlNumber));
    else out.sort((a,b)=>cmp(a.subCustNm,b.subCustNm)||cmp(a.itemNm,b.itemNm)||cmp(a.lotNum,b.lotNum)||cmp(bayOf(a),bayOf(b))||cmp(a.controlNumber,b.controlNumber));
    return out;
  }

  function summarize(rows){
    const g={};
    rows.forEach(r=>{
      const k=[r.itemNm,r.lotNum,whOf(r),bayOf(r)].join('|');
      if(!g[k]) g[k]={item:clean(r.itemNm),desc:clean(r.itemDesc),customer:clean(r.subCustNm),lot:clean(r.lotNum),wh:whOf(r),bay:bayOf(r),pallets:0,qty:0};
      g[k].pallets++; g[k].qty+=num(r.qty);
    });
    return Object.values(g).sort((a,b)=>cmp(a.customer,b.customer)||cmp(a.item,b.item)||cmp(a.lot,b.lot)||cmp(a.bay,b.bay));
  }
  function totals(rows){
    return {pallets:rows.length,qty:rows.reduce((s,r)=>s+num(r.qty),0),
      bays:new Set(rows.map(bayOf).filter(Boolean)).size,items:new Set(rows.map(r=>clean(r.itemNm)).filter(Boolean)).size};
  }

  // ---------- transaction history ----------
  async function allTxns(){
    if(!window.LWHTransactions) return [];
    await LWHTransactions.loadTransactions();
    return LWHTransactions.getAllTransactions()||[];
  }
  function txnHay(t){ return [t.lwhId,t.madeFrom,t.customerId,t.invReceipt,t.billToRef,t.subCustNm,t.itemNm,t.itemDesc,t.lotNum,t.transactionType,t.location,t.transactionDate].map(norm).join(' | '); }
  function sortTxns(list){ return list.slice().sort((a,b)=>cmp(b.transactionDate,a.transactionDate)||cmp(b.lwhId,a.lwhId)); }
  function whMatch(t){ return S.wh==='all' || String(t.location||'').toUpperCase().startsWith(S.wh.toUpperCase()); }

  async function historyFor(q,field,invHits){
    const all=(await allTxns()).filter(whMatch);
    q=String(q||'').trim(); if(!q) return {rows:[],note:''};
    if(field==='bay'){
      const ids=new Set(invHits.map(r=>clean(r.controlNumber)).filter(Boolean));
      return {rows:sortTxns(all.filter(t=>ids.has(clean(t.lwhId))||ids.has(clean(t.madeFrom)))),note:'Bays aren\'t in transaction history, so this shows the history of the pallets in that bay now.'};
    }
    if(field==='lwh'){
      const qs=squash(q.toLowerCase());
      const rows=all.filter(t=>norm(t.lwhId)===qs||norm(t.madeFrom)===qs);
      if(rows.length) return {rows:sortTxns(rows),note:''};
    }
    if(field!=='any' && FIELDS[field].txn){
      return {rows:sortTxns(matchList(all,FIELDS[field].txn,q).rows),note:''};
    }
    // Anything: try the same exact-field detection, then a free-text match
    for(const key of EXACT_ORDER){
      const f=FIELDS[key]; if(!f.txn) continue;
      const ql=q.toLowerCase(), qs=squash(ql);
      const hit=all.filter(t=>f.txn(t).some(v=>{ const n=norm(v); return n && (n===ql||squash(n)===qs); }));
      if(hit.length) return {rows:sortTxns(hit),note:''};
    }
    const terms=q.toLowerCase().split(/\s+/).filter(Boolean);
    return {rows:sortTxns(all.filter(t=>{ const h=txnHay(t); return terms.every(x=>h.includes(x)); })),note:''};
  }
  // Bill-to-Ref isn't in the inventory feed, only in transaction history.
  // Each pallet's INBOUND Bill-to-Ref is looked up from history (rolling
  // ~90 days), so pallets received before that window show it blank.
  let inboundMap=null, inboundSrc=null;
  async function inboundBillToRef(){
    const all=await allTxns();
    if(inboundMap && inboundSrc===all) return inboundMap;
    const m=new Map();
    all.forEach(t=>{
      if(!/^in/i.test(t.transactionType||'')) return;
      const id=clean(t.lwhId), ref=clean(t.billToRef); if(!id||!ref) return;
      const prev=m.get(id);
      if(!prev || String(t.transactionDate||'')>prev.date) m.set(id,{ref,date:String(t.transactionDate||'')});
    });
    inboundMap=m; inboundSrc=all; return m;
  }
  const btrOf=(m,r)=>{ const x=m&&m.get(clean(r.controlNumber)); return x?x.ref:''; };

  async function palletHistory(id){
    const all=await allTxns(); id=norm(id);
    return sortTxns(all.filter(t=>norm(t.lwhId)===id||norm(t.madeFrom)===id));
  }

  // ---------- rendering ----------
  function status(msg){ const s=$('qlStatus'); if(s) s.textContent=msg; }
  function dataStatus(){
    const rows=invRows();
    if(!rows.length){ status('Loading inventory…'); return false; }
    const as=syncedLabel(rows);
    status(`${fmt(rows.length)} pallets in inventory${as?` · data as of ${as}`:''}`);
    return true;
  }

  function renderChips(){
    $('qlChips').innerHTML=CHIP_ORDER.map(k=>`<button type="button" class="ql-chip${S.field===k?' on':''}" data-ql-field="${k}">${esc(FIELDS[k].label)}</button>`).join('');
    const ph={any:'Scan or type anything — LWH ID, item, customer ID, bay, lot…',lwh:'Scan or type an LWH ID',item:'Item number',custid:'Customer ID / customer pallet tag',bay:'Bay location (e.g. XLF023)',customer:'Customer (e.g. ANCHE)',lot:'Lot number',inv:'INV Receipt number'};
    $('qlInput').placeholder=ph[S.field];
  }
  function renderWarehouses(){
    const sel=$('qlWh'); if(!sel) return;
    const whs=[...new Set(invRows().map(whOf).filter(Boolean))].sort(cmp);
    const cur=S.wh;
    sel.innerHTML='<option value="all">All warehouses</option>'+whs.map(w=>`<option value="${esc(w)}">${esc(w)}</option>`).join('');
    sel.value=whs.includes(cur)?cur:'all'; S.wh=sel.value;
  }

  function cardHtml(r,i){
    const custId=clean(r.comments);
    return `<button type="button" class="ql-card" data-ql-row="${i}">
      <span class="ql-card-top"><span class="ql-id">${esc(clean(r.controlNumber))}</span><span class="ql-bay"><small>BAY</small>${esc(bayOf(r)||'—')}</span></span>
      <span class="ql-item"><b>${esc(clean(r.itemNm))}</b>${clean(r.itemDesc)?' — '+esc(clean(r.itemDesc)):''}</span>
      <span class="ql-meta"><span><small>Qty</small>${esc(fmt(num(r.qty)))}</span><span><small>Lot</small>${esc(clean(r.lotNum)||'—')}</span><span><small>Customer</small>${esc(clean(r.subCustNm)||'—')}</span><span><small>Whse</small>${esc(whOf(r)||'—')}</span>${custId?`<span class="wide"><small>Cust ID</small>${esc(custId)}</span>`:''}</span>
    </button>`;
  }

  function renderResults(){
    const out=$('qlResults'), bar=$('qlBar');
    S.detail=null;
    if(!S.res||!S.query){ out.innerHTML=''; bar.hidden=true; $('qlTabs').hidden=true; return; }
    const rows=S.res.rows, t=totals(rows);
    bar.hidden=false; $('qlTabs').hidden=false;
    const how=S.res.how==='exact'?`Exact ${FIELDS[S.res.field].label} match`:(S.res.field==='any'?'Matches anywhere':`${FIELDS[S.res.field].label} contains`);
    $('qlKpis').innerHTML=`<div><b>${fmt(t.pallets)}</b><span>Pallets</span></div><div><b>${fmt(t.qty)}</b><span>Total Qty</span></div><div><b>${fmt(t.bays)}</b><span>Bays</span></div><div><b>${fmt(t.items)}</b><span>Items</span></div><p class="ql-how">${esc(how)} · “${esc(S.query)}”${S.wh!=='all'?` · ${esc(S.wh)}`:''}</p>`;
    document.querySelectorAll('[data-ql-tab]').forEach(b=>b.classList.toggle('on',b.dataset.qlTab===S.tab));
    $('qlLabelsBtn').hidden=S.tab!=='pallets';
    if(S.tab==='pallets') renderPallets(out,rows);
    else if(S.tab==='summary') renderSummary(out,rows);
    else renderHistory(out);
  }

  function renderPallets(out,rows){
    if(!rows.length){
      out.innerHTML=`<div class="ql-empty"><b>Not in current inventory.</b> If it already shipped, it will show under <button type="button" class="ql-link" data-ql-tab="history">History</button>.</div>`;
      return;
    }
    const more=rows.length>DISPLAY_CAP?`<p class="ql-note">Showing the first ${DISPLAY_CAP} of ${fmt(rows.length)} pallets. Print and Excel include all ${fmt(rows.length)}. Narrow it with a warehouse or a more specific search.</p>`:'';
    out.innerHTML=more+`<div class="ql-cards">${rows.slice(0,DISPLAY_CAP).map(cardHtml).join('')}</div>`;
  }

  function renderSummary(out,rows){
    if(!rows.length){ out.innerHTML='<div class="ql-empty">Nothing in current inventory to summarize.</div>'; return; }
    const g=summarize(rows), t=totals(rows);
    out.innerHTML=`<div class="ql-table-wrap"><table class="ql-table"><thead><tr><th>Item #</th><th>Description</th><th>Customer</th><th>Lot #</th><th>Whse</th><th>Bay</th><th class="r">Pallets</th><th class="r">Qty</th></tr></thead><tbody>${
      g.map(x=>`<tr><td><b>${esc(x.item)}</b></td><td>${esc(x.desc)}</td><td>${esc(x.customer)}</td><td>${esc(x.lot)}</td><td>${esc(x.wh)}</td><td><b>${esc(x.bay)}</b></td><td class="r">${fmt(x.pallets)}</td><td class="r">${fmt(x.qty)}</td></tr>`).join('')
    }</tbody><tfoot><tr><td colspan="6">Total</td><td class="r">${fmt(t.pallets)}</td><td class="r">${fmt(t.qty)}</td></tr></tfoot></table></div>`;
  }

  function txnTable(rows,cap){
    const shown=cap?rows.slice(0,cap):rows;
    return `<div class="ql-table-wrap"><table class="ql-table"><thead><tr><th>Date</th><th>Type</th><th>LWH ID</th><th>Item #</th><th>Description</th><th class="r">Qty</th><th>Lot #</th><th>Bill-to-Ref</th><th>INV Receipt</th><th>Location</th><th>Made From</th><th>Customer ID</th><th>Unique2</th></tr></thead><tbody>${
      shown.map(t=>{ const type=clean(t.transactionType); const cls=/^in/i.test(type)?'in':(/^out/i.test(type)?'out':'');
        return `<tr><td>${esc(clean(t.transactionDate))}</td><td><span class="ql-type ${cls}">${esc(type)}</span></td><td><b>${esc(clean(t.lwhId))}</b></td><td>${esc(clean(t.itemNm))}</td><td>${esc(clean(t.itemDesc))}</td><td class="r">${fmt(num(t.qty))}</td><td>${esc(clean(t.lotNum))}</td><td>${esc(clean(t.billToRef))}</td><td>${esc(clean(t.invReceipt))}</td><td>${esc(clean(t.location))}</td><td>${esc(clean(t.madeFrom))}</td><td>${esc(clean(t.customerId))}</td><td>${esc(clean(t.unique2))}</td></tr>`; }).join('')
    }</tbody></table></div>`;
  }
  function histTotals(rows){
    const t={inP:0,inQ:0,outP:0,outQ:0};
    rows.forEach(r=>{ const o=/^out/i.test(r.transactionType||''); if(o){t.outP++;t.outQ+=num(r.qty);}else{t.inP++;t.inQ+=num(r.qty);} });
    return t;
  }

  async function ensureHistory(){
    const key=[S.query,S.res&&S.res.field,S.wh].join('|');
    if(S.hist && S.histKey===key) return S.hist;
    S.histKey=key; S.hist=null;
    const h=await historyFor(S.query,S.res?S.res.field:'any',S.res?S.res.rows:[]);
    if(S.histKey===key) S.hist=h;
    return h;
  }
  async function renderHistory(out){
    out.innerHTML='<div class="ql-empty">Loading transaction history…</div>';
    const h=await ensureHistory();
    if(S.tab!=='history'||S.detail) return;
    if(!h.rows.length){ out.innerHTML=`<div class="ql-empty">No inbound or outbound transactions found in the last ~90 days for “${esc(S.query)}”.</div>`; return; }
    const t=histTotals(h.rows);
    const cap=500;
    out.innerHTML=`<div class="ql-hist-kpis"><span class="ql-type in">Inbound</span> ${fmt(t.inP)} pallets · ${fmt(t.inQ)} qty &nbsp; <span class="ql-type out">Outbound</span> ${fmt(t.outP)} pallets · ${fmt(t.outQ)} qty</div>${h.note?`<p class="ql-note">${esc(h.note)}</p>`:''}${h.rows.length>cap?`<p class="ql-note">Showing the newest ${cap} of ${fmt(h.rows.length)}. Print and Excel include all.</p>`:''}${txnTable(h.rows,cap)}<p class="ql-note">Rolling ~90-day window, newest first.</p>`;
  }

  // ---------- pallet detail ----------
  async function showDetail(r){
    S.detail=r;
    const out=$('qlResults');
    const id=clean(r.controlNumber);
    const labels=window.LWHInventory?LWHInventory.customerLabels():{};
    const fields=[['controlNumber','LWH ID'],['_btr','Bill-to-Ref (Inbound)'],['subCustNm','Customer'],['comments','Customer ID'],['itemNm','Item #'],['itemDesc','Description'],['lotNum','Lot #'],['qty','Qty'],['warehouse','Warehouse'],['bayName','Bay'],['invReceipt','INV Receipt'],['vendor','Vendor'],['unique2',''],['unique3',''],['unique5',''],['unique6',''],['unique7',''],['unique8','']]
      .map(([k,l])=>{ const v=k==='_btr'?'__BTR__':(k==='bayName'?bayOf(r):(k==='warehouse'?whOf(r):clean(r[k]))); if(v==='__BTR__') return `<div id="qlDetailBtr"><small>${esc(l)}</small><b>…</b></div>`; return v?`<div><small>${esc(l||labels[k]||k)}</small><b>${esc(v)}</b></div>`:''; }).join('');
    out.innerHTML=`<div class="ql-detail">
      <button type="button" class="ghost ql-back" data-ql-back>← Back to results</button>
      <div class="ql-detail-head">
        <div><small>LWH ID</small><div class="ql-detail-id">${esc(id)}</div><svg class="ql-detail-bc" data-barcode="${esc(id)}"></svg></div>
        <div class="ql-detail-bay"><small>BAY</small><b>${esc(bayOf(r)||'—')}</b><span>${esc(whOf(r))}</span></div>
      </div>
      <div class="ql-fields">${fields}</div>
      <div class="ql-actions"><button type="button" data-ql-dlabel>Print 4x6 Label</button><button type="button" class="ghost" data-ql-dsheet>Print Pallet Sheet</button><button type="button" class="ghost" data-ql-dcopy>Copy LWH ID</button></div>
      <h3 class="ql-h3">Transaction History</h3>
      <div id="qlDetailHist"><div class="ql-empty">Loading…</div></div>
    </div>`;
    const svg=out.querySelector('.ql-detail-bc'); if(svg&&window.LWHBarcode) LWHBarcode.make(svg,id,{height:56,width:2});
    window.scrollTo({top:$('qlBar').offsetTop-70,behavior:'smooth'});
    const [hist,bm]=await Promise.all([palletHistory(id),inboundBillToRef()]);
    if(S.detail!==r) return;
    r._btr=btrOf(bm,r);
    const bEl=$('qlDetailBtr'); if(bEl) bEl.querySelector('b').textContent=r._btr||'— (older than ~90 days)';
    r._hist=hist;
    $('qlDetailHist').innerHTML=hist.length?txnTable(hist):'<div class="ql-empty">No transactions for this pallet in the last ~90 days.</div>';
  }

  // ---------- search driver ----------
  function applySpokenPrefix(text){
    for(const [re,field] of SPOKEN){ if(re.test(text)){ setField(field,false); return text.replace(re,''); } }
    return text;
  }
  function setField(f,rerun=true){
    S.field=f; LWHStorage.set('qlField',f); renderChips();
    if(rerun && S.query) run();
  }
  function run(){
    const q=String($('qlInput').value||'').trim();
    S.query=q; S.hist=null; S.histKey='';
    if(!q){ S.res=null; renderResults(); return; }
    if(!invRows().length){ status('Inventory is still loading — your search will run as soon as it arrives.'); waitForData(); return; }
    const r=searchInventory(q,S.field);
    r.rows=sortRows(r.rows,r.field);
    S.res=r;
    // Nothing on hand → jump to History (shipped pallets live there). Once a
    // later search finds inventory again, go back to the pallet list.
    if(!r.rows.length){ if(S.tab!=='history'){ S.tab='history'; S.autoHist=true; } }
    else if(S.autoHist){ S.tab='pallets'; S.autoHist=false; }
    renderResults();
    if(r.rows.length===1 && r.how==='exact' && S.tab==='pallets'){
      showDetail(r.rows[0]);
      if(window.LWHInventory&&LWHInventory.speakText&&LWHStorage.get('readAloudEnabled',true)){
        const x=r.rows[0]; const parts=[clean(x.itemNm),bayOf(x)?'Bay '+bayOf(x):'',clean(x.qty)?'Quantity '+clean(x.qty):''].filter(Boolean);
        if(parts.length) LWHInventory.speakText(parts.join('. '));
      }
    }
  }
  let waitTimer=null;
  function waitForData(){
    if(waitTimer) return;
    let n=0;
    waitTimer=setInterval(()=>{
      n++;
      if(invRows().length){ clearInterval(waitTimer); waitTimer=null; dataStatus(); renderWarehouses(); if($('qlInput').value.trim()) run(); }
      else if(n>60){ clearInterval(waitTimer); waitTimer=null; status('Inventory didn\'t load. Check the connection and tap Refresh.'); }
    },1000);
  }
  let deb=null;
  function debounced(){ clearTimeout(deb); deb=setTimeout(run,280); }

  // ---------- print ----------
  function setPage(w,h,margin){
    let st=document.getElementById('dynamicPageSize');
    if(!st){ st=document.createElement('style'); st.id='dynamicPageSize'; document.head.appendChild(st); }
    st.textContent=`@media print{@page{size:${w}in ${h}in;margin:${margin}in}}`;
  }
  function sheetHead(title,sub){
    const now=new Date().toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
    return `<div class="qlp-head"><div><div class="qlp-co">Logistics Warehouse</div><h2>${esc(title)}</h2><div class="qlp-sub">${sub}</div></div><div class="qlp-when">Printed ${esc(now)}<br>Data as of ${esc(syncedLabel(invRows())||'—')}</div></div>`;
  }
  function searchLine(){ return `Search: <b>${esc(S.query)}</b> · ${esc(S.res.how==='exact'?FIELDS[S.res.field].label+' (exact)':FIELDS[S.res.field].label)}${S.wh!=='all'?' · '+esc(S.wh):''}`; }
  function doPrint(html,w,h,margin){
    const area=$('qlPrintArea');
    area.innerHTML=html;
    area.querySelectorAll('svg[data-barcode]').forEach(svg=>{ if(window.LWHBarcode) LWHBarcode.make(svg,svg.dataset.barcode,{height:+svg.dataset.h||34,width:+svg.dataset.w||1.4}); svg.setAttribute('preserveAspectRatio','xMinYMid meet'); });
    setPage(w,h,margin);
    setTimeout(()=>window.print(),120);
  }
  function confirmBig(n){ return n<=600 || confirm(`That's ${fmt(n)} rows — about ${Math.ceil(n/13)} pages. Print anyway?`); }

  function printPalletList(){
    const rows=S.res.rows; if(!rows.length){ LWHUI.toast('Nothing to print'); return; }
    if(!confirmBig(rows.length)) return;
    const t=totals(rows);
    const body=rows.map(r=>`<tr>
      <td class="qlp-bc"><svg data-barcode="${esc(clean(r.controlNumber))}" data-h="34" data-w="1.35"></svg><div>${esc(clean(r.controlNumber))}</div></td>
      <td class="qlp-bay">${esc(bayOf(r))}<div>${esc(whOf(r))}</div></td>
      <td><b>${esc(clean(r.itemNm))}</b><div class="qlp-desc">${esc(clean(r.itemDesc))}</div></td>
      <td>${esc(clean(r.lotNum))}</td>
      <td class="r"><b>${fmt(num(r.qty))}</b></td>
      <td>${esc(clean(r.subCustNm))}${clean(r.comments)?`<div class="qlp-desc">${esc(clean(r.comments))}</div>`:''}</td>
    </tr>`).join('');
    doPrint(`<div class="qlp-sheet">${sheetHead('Inventory Lookup',searchLine()+` · <b>${fmt(t.pallets)}</b> pallets · <b>${fmt(t.qty)}</b> qty · ${fmt(t.bays)} bays`)}
      <table class="qlp-table"><thead><tr><th>LWH ID</th><th>Bay</th><th>Item / Description</th><th>Lot #</th><th class="r">Qty</th><th>Customer / Cust ID</th></tr></thead><tbody>${body}</tbody>
      <tfoot><tr><td colspan="4">Total — ${fmt(t.pallets)} pallets</td><td class="r">${fmt(t.qty)}</td><td></td></tr></tfoot></table></div>`,8.5,11,0.4);
  }
  function printSummary(){
    const rows=S.res.rows; if(!rows.length){ LWHUI.toast('Nothing to print'); return; }
    const g=summarize(rows), t=totals(rows);
    doPrint(`<div class="qlp-sheet">${sheetHead('Inventory Summary',searchLine())}
      <table class="qlp-table"><thead><tr><th>Item #</th><th>Description</th><th>Customer</th><th>Lot #</th><th>Whse</th><th>Bay</th><th class="r">Pallets</th><th class="r">Qty</th></tr></thead><tbody>${
      g.map(x=>`<tr><td><b>${esc(x.item)}</b></td><td>${esc(x.desc)}</td><td>${esc(x.customer)}</td><td>${esc(x.lot)}</td><td>${esc(x.wh)}</td><td class="qlp-bay sm">${esc(x.bay)}</td><td class="r">${fmt(x.pallets)}</td><td class="r">${fmt(x.qty)}</td></tr>`).join('')
      }</tbody><tfoot><tr><td colspan="6">Total</td><td class="r">${fmt(t.pallets)}</td><td class="r">${fmt(t.qty)}</td></tr></tfoot></table></div>`,8.5,11,0.4);
  }
  async function printHistory(){
    const h=await ensureHistory(); if(!h.rows.length){ LWHUI.toast('No history to print'); return; }
    if(!confirmBig(h.rows.length)) return;
    const t=histTotals(h.rows);
    doPrint(`<div class="qlp-sheet land">${sheetHead('Transaction History',searchLine()+` · Inbound ${fmt(t.inP)} pallets / ${fmt(t.inQ)} qty · Outbound ${fmt(t.outP)} pallets / ${fmt(t.outQ)} qty`)}
      ${txnTable(h.rows).replace('class="ql-table"','class="qlp-table"')}</div>`,11,8.5,0.35);
  }
  function printDetailSheet(r){
    const id=clean(r.controlNumber);
    const rows=[['Customer',clean(r.subCustNm)],['Customer ID',clean(r.comments)],['Item #',clean(r.itemNm)],['Description',clean(r.itemDesc)],['Lot #',clean(r.lotNum)],['Qty',fmt(num(r.qty))],['Warehouse',whOf(r)],['INV Receipt',clean(r.invReceipt)],['Bill-to-Ref (Inbound)',r._btr||''],['Vendor',clean(r.vendor)],['Unique2',clean(r.unique2)],['Unique3',clean(r.unique3)],['Unique5',clean(r.unique5)],['Unique6',clean(r.unique6)],['Unique7',clean(r.unique7)],['Unique8',clean(r.unique8)]].filter(x=>x[1]);
    const hist=r._hist||[];
    doPrint(`<div class="qlp-sheet">${sheetHead('Pallet '+id,`Bay <b>${esc(bayOf(r))}</b> · ${esc(whOf(r))}`)}
      <div class="qlp-pallet"><div><svg data-barcode="${esc(id)}" data-h="70" data-w="2.4"></svg><div class="qlp-pid">${esc(id)}</div></div><div class="qlp-pbay"><small>BAY</small>${esc(bayOf(r))}</div></div>
      <table class="qlp-kv">${rows.map(x=>`<tr><th>${esc(x[0])}</th><td>${esc(x[1])}</td></tr>`).join('')}</table>
      <h3>Transaction History</h3>${hist.length?txnTable(hist).replace('class="ql-table"','class="qlp-table"'):'<p>No transactions in the last ~90 days.</p>'}</div>`,8.5,11,0.4);
  }
  function printLabels(rows){
    if(!rows.length){ LWHUI.toast('Nothing to print'); return; }
    if(rows.length>50 && !confirm(`Print ${fmt(rows.length)} 4x6 pallet labels?`)) return;
    LWHInventory.printRows(rows.map(r=>({location:whOf(r),lwhid:clean(r.controlNumber),custId:clean(r.comments),customer:clean(r.subCustNm),invRec:clean(r.invReceipt),billToRef:'',item:clean(r.itemNm),desc:clean(r.itemDesc),lot:clean(r.lotNum),qty:clean(r.qty),units:'',bay:bayOf(r),dateReceived:'',vendor:clean(r.vendor),unique2:clean(r.unique2),unique8:clean(r.unique8)})),$('qlPrintArea'));
  }

  // ---------- export ----------
  function fileBase(){
    const d=new Date(), p=n=>String(n).padStart(2,'0');
    return `LWH-Lookup-${String(S.query||'all').replace(/[^\w-]+/g,'_').slice(0,30)}-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`;
  }
  const PALLET_COLS=[{label:'LWH ID',type:'n',width:11},{label:'Bay',width:12},{label:'Warehouse',width:11},{label:'Customer',width:12},{label:'Customer ID',width:22},{label:'Item #',width:16},{label:'Description',width:32},{label:'Lot #',width:15},{label:'Qty',type:'n',width:10},{label:'INV Receipt',type:'n',width:12},{label:'Bill-to-Ref (Inbound)',width:20},{label:'Vendor',width:16},{label:'Unique2'},{label:'Unique3'},{label:'Unique5'},{label:'Unique6'},{label:'Unique7'},{label:'Unique8'}];
  const palletRow=(r,bm)=>[clean(r.controlNumber),bayOf(r),whOf(r),clean(r.subCustNm),clean(r.comments),clean(r.itemNm),clean(r.itemDesc),clean(r.lotNum),clean(r.qty),clean(r.invReceipt),btrOf(bm,r),clean(r.vendor),clean(r.unique2),clean(r.unique3),clean(r.unique5),clean(r.unique6),clean(r.unique7),clean(r.unique8)];
  const SUM_COLS=[{label:'Item #',width:16},{label:'Description',width:32},{label:'Customer',width:12},{label:'Lot #',width:15},{label:'Warehouse',width:11},{label:'Bay',width:12},{label:'Pallets',type:'n',width:9},{label:'Qty',type:'n',width:11}];
  const TXN_COLS=[{label:'Date',width:11},{label:'Type',width:9},{label:'LWH ID',type:'n',width:11},{label:'Item #',width:16},{label:'Description',width:30},{label:'Qty',type:'n',width:10},{label:'Lot #',width:14},{label:'Bill-to-Ref',width:18},{label:'INV Receipt',type:'n',width:12},{label:'Customer',width:11},{label:'Customer ID',width:22},{label:'Location',width:18},{label:'Made From',type:'n',width:11},{label:'Unique2',width:12}];
  const txnRow=t=>[clean(t.transactionDate),clean(t.transactionType),clean(t.lwhId),clean(t.itemNm),clean(t.itemDesc),clean(t.qty),clean(t.lotNum),clean(t.billToRef),clean(t.invReceipt),clean(t.subCustNm),clean(t.customerId),clean(t.location),clean(t.madeFrom),clean(t.unique2)];

  async function exportExcel(){
    if(!window.LWHXlsx){ LWHUI.toast('Excel export not available'); return; }
    LWHUI.toast('Building Excel file…');
    const rows=S.res.rows, t=totals(rows), g=summarize(rows);
    let bm=null; try{ bm=await inboundBillToRef(); }catch(e){ console.error(e); }
    let h={rows:[]}; try{ h=await ensureHistory(); }catch(e){ console.error(e); }
    const ht=histTotals(h.rows);
    const sheets=[
      {name:'Pallets',columns:PALLET_COLS,rows:rows.map(r=>palletRow(r,bm)),totals:['Total','','','','','','','',t.qty,'','','','','','','','','']},
      {name:'Summary',columns:SUM_COLS,rows:g.map(x=>[x.item,x.desc,x.customer,x.lot,x.wh,x.bay,x.pallets,x.qty]),totals:['Total','','','','','',t.pallets,t.qty]},
      {name:'History',columns:TXN_COLS,rows:h.rows.map(txnRow)},
      {name:'Search Info',columns:[{label:'Field',width:18},{label:'Value',width:44}],rows:[
        ['Search',S.query],['Searched by',S.res.how==='exact'?FIELDS[S.res.field].label+' (exact match)':FIELDS[S.res.field].label],['Warehouse',S.wh==='all'?'All warehouses':S.wh],
        ['Pallets',String(t.pallets)],['Total Qty',String(t.qty)],['Bays',String(t.bays)],['Items',String(t.items)],
        ['History inbound',`${ht.inP} pallets / ${ht.inQ} qty`],['History outbound',`${ht.outP} pallets / ${ht.outQ} qty`],
        ['Bill-to-Ref (Inbound)','From transaction history — rolling ~90 days. Pallets received earlier show it blank.'],['Inventory data as of',syncedLabel(invRows())],['Exported',new Date().toLocaleString()],['Source','LWH Warehouse Toolkit — Quick Lookup']]}
    ];
    LWHXlsx.download(fileBase()+'.xlsx',sheets);
  }
  async function exportCsv(){
    let cols,rows,suffix;
    if(S.tab==='summary'){ cols=SUM_COLS; rows=summarize(S.res.rows).map(x=>[x.item,x.desc,x.customer,x.lot,x.wh,x.bay,x.pallets,x.qty]); suffix='-summary'; }
    else if(S.tab==='history'){ const h=await ensureHistory(); cols=TXN_COLS; rows=h.rows.map(txnRow); suffix='-history'; }
    else { let bm=null; try{ bm=await inboundBillToRef(); }catch(e){} cols=PALLET_COLS; rows=S.res.rows.map(r=>palletRow(r,bm)); suffix=''; }
    const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const csv='﻿'+[cols.map(c=>q(c.label)).join(','),...rows.map(r=>r.map(q).join(','))].join('\r\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download=fileBase()+suffix+'.csv'; document.body.append(a); a.click(); a.remove();
    LWHUI.toast('CSV downloaded');
  }

  // ---------- voice ----------
  function initVoice(){
    const btn=$('qlVoiceBtn');
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){ btn.hidden=true; $('qlVoiceHint').hidden=false; return; }
    const rec=new SR(); rec.lang='en-US'; rec.interimResults=false; rec.maxAlternatives=1;
    let on=false;
    const idle=()=>{ on=false; btn.classList.remove('listening'); btn.querySelector('span').textContent='Speak'; };
    btn.onclick=()=>{
      if(on){ try{rec.stop();}catch(e){} return; }
      on=true; btn.classList.add('listening'); btn.querySelector('span').textContent='Listening…';
      try{ rec.start(); }catch(e){ idle(); }
    };
    rec.onresult=e=>{
      let text=String(e.results[0][0].transcript||'').trim().replace(/[.?!]$/,'');
      text=applySpokenPrefix(text);
      // "4 2 2 6 6 1 5" or "422-6615" → "4226615"; "X L F 023" → "XLF023"
      if(/^[\w\s-]+$/.test(text) && /^(\w{1,3}[\s-])+\w{1,4}$/.test(text)) text=text.replace(/[\s-]+/g,'');
      $('qlInput').value=text;
      run();
    };
    rec.onerror=idle; rec.onend=idle;
  }

  // ---------- wiring ----------
  function onShow(){
    renderChips(); renderWarehouses();
    if(!dataStatus()) waitForData();
    const fine=window.matchMedia&&matchMedia('(pointer:fine)').matches;
    if(fine) setTimeout(()=>{ const i=$('qlInput'); i.focus(); i.select(); },60);
  }

  function init(){
    if(!$('quickLookup')) return;
    const inp=$('qlInput');
    renderChips();
    inp.addEventListener('input',debounced);
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); clearTimeout(deb); run(); inp.select(); } else if(e.key==='Escape'){ inp.value=''; run(); } });
    $('qlScanBtn').onclick=()=>LWHScanner.start(code=>{ inp.value=code; run(); });
    $('qlClearBtn').onclick=()=>{ inp.value=''; S.tab='pallets'; run(); inp.focus(); };
    $('qlRefreshBtn').onclick=async()=>{ status('Refreshing inventory…'); try{ await LWHInventory.loadCustomerFromUrl(); if(window.LWHTransactions) await LWHTransactions.loadTransactions(true); dataStatus(); renderWarehouses(); if(S.query) run(); LWHUI.toast('Data refreshed'); }catch(e){ status('Refresh failed: '+e.message); } };
    $('qlWh').onchange=e=>{ S.wh=e.target.value; if(S.query) run(); };
    $('qlCopyLink').onclick=()=>{ navigator.clipboard?.writeText(SHORTCUT_URL).then(()=>LWHUI.toast('Quick Lookup link copied — paste it as a bookmark')).catch(()=>prompt('Bookmark this link:',SHORTCUT_URL)); };
    $('qlPrintBtn').onclick=()=>{ if(!S.res) return; if(S.tab==='summary') printSummary(); else if(S.tab==='history') printHistory(); else printPalletList(); };
    $('qlLabelsBtn').onclick=()=>{ if(S.res) printLabels(S.res.rows); };
    $('qlXlsxBtn').onclick=()=>{ if(S.res) exportExcel(); };
    $('qlCsvBtn').onclick=()=>{ if(S.res) exportCsv(); };

    $('quickLookup').addEventListener('click',e=>{
      const chip=e.target.closest('[data-ql-field]'); if(chip){ setField(chip.dataset.qlField); inp.focus(); return; }
      const tab=e.target.closest('[data-ql-tab]'); if(tab){ S.tab=tab.dataset.qlTab; S.autoHist=false; renderResults(); return; }
      if(e.target.closest('[data-ql-back]')){ renderResults(); return; }
      const card=e.target.closest('[data-ql-row]'); if(card){ const r=S.res&&S.res.rows[+card.dataset.qlRow]; if(r) showDetail(r); return; }
      if(S.detail){
        if(e.target.closest('[data-ql-dlabel]')) printLabels([S.detail]);
        else if(e.target.closest('[data-ql-dsheet]')) printDetailSheet(S.detail);
        else if(e.target.closest('[data-ql-dcopy]')){ const id=clean(S.detail.controlNumber); navigator.clipboard?.writeText(id).then(()=>LWHUI.toast('Copied: '+id)).catch(()=>{}); }
      }
    });
    initVoice();

    // Hook the app's view switcher so this screen refreshes when opened, and
    // so the direct-link "slim" mode turns off once someone leaves it.
    const origShow=LWHUI.show.bind(LWHUI);
    LWHUI.show=function(view){
      origShow(view);
      if(view==='quickLookup') onShow();
      else document.body.classList.remove('ql-direct');
    };
    if(new URLSearchParams(location.search).get('view')==='quickLookup') document.body.classList.add('ql-direct');
    window.addEventListener('afterprint',()=>{ const st=document.getElementById('dynamicPageSize'); if(st && $('quickLookup').classList.contains('active')) st.textContent=''; });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
  window.LWHQuickLookup={run,searchInventory,summarize};
})();
