(function(){
  // Live inventory, refreshed from birdsEye every ~15 min via Supabase.
  // Replaces the static Google Sheet export as the default Master Lookup source.
  const CUSTOMER_DEFAULT_URL='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/master-lookup-csv';
  const OLD_SHEET_ID='1cMa6qXIJGsnCm5hOQmNUBtxZzFPU5lZIwaYqZzrLPR4';
  let customerRows=[];

  // Same anon key as itemtxnlookup.js — public/publishable, safe to embed
  // client-side, NOT the sb_secret_ service-role key the PowerShell sync
  // scripts use. Redeclared here rather than shared across files since
  // each module in this app is a self-contained IIFE by convention.
  const SUPABASE_URL='https://tjivcqxnkftujceumdtx.supabase.co';
  const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqaXZjcXhua2Z0dWpjZXVtZHR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTE5NDMsImV4cCI6MjEwMDQ2Nzk0M30.GzDc-_u92jvAHq7eG1X-1cet5Av9qF3ZDEVJMRKEP0E';

  // Calls get_item_inventory_summary via PostgREST's RPC endpoint — same
  // plain-fetch pattern as fetchServerSummary() in itemtxnlookup.js.
  async function fetchServerItemSummary(itemNumber){
    const url=`${SUPABASE_URL}/rest/v1/rpc/get_item_inventory_summary`;
    const res=await fetch(url,{
      method:'POST',
      headers:{
        'apikey':SUPABASE_ANON_KEY,
        'Authorization':'Bearer '+SUPABASE_ANON_KEY,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({p_item_number:itemNumber})
    });
    if(!res.ok){
      const errText=await res.text().catch(()=>res.statusText);
      throw new Error(`Server item summary failed (HTTP ${res.status}): ${errText}`);
    }
    return res.json();
  }

  function el(id){ return document.getElementById(id); }
  function customerStatus(msg){ const s=el('custLookupStatus'); if(s) s.textContent=msg; renderHomeCustomerTotals(); renderHomeLocationCustomerTotals(); renderHomeWarehouseTotals(); renderHomeKpis(); if(window.LWHLocationOverview) LWHLocationOverview.populateWarehouses(); if(window.LWHCustomerView) LWHCustomerView.populateCustomers(); }
  function setCustomerCurrentUrl(url){ const u=el('custCurrentUrl'); if(u) u.textContent=url || CUSTOMER_DEFAULT_URL; }

  function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function cleanKey(h){return String(h||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');}

  function normalizeUrl(input, fallback){
    let url=String(input||'').trim();
    if(!url || url.includes(OLD_SHEET_ID)) return fallback || CUSTOMER_DEFAULT_URL;
    if(url.includes('/pub?') || url.includes('/pubhtml?')){
      return url.replace('/pubhtml?','/pub?').replace(/output=html/i,'output=csv').replace(/single=true&?/i,'').replace(/&&/g,'&');
    }
    const m=url.match(/spreadsheets\/d\/([^/]+)/);
    if(m && !/export\?format=csv|gviz\/tq|script\.google\.com/.test(url)){
      const gid=(url.match(/[?&#]gid=(\d+)/)||[])[1]||'0';
      return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&gid=${gid}`;
    }
    return url;
  }

  function splitDelimited(text){
    text=(text||'').replace(/^\uFEFF/,'').trim(); if(!text) return [];
    const delim=text.indexOf('\t')>-1?'\t':',';
    const lines=[]; let cur='', row=[], q=false;
    for(let i=0;i<text.length;i++){
      const c=text[i],n=text[i+1];
      if(c==='"'){
        if(q&&n==='"'){cur+='"';i++;} else q=!q;
      } else if(!q && c===delim){
        row.push(cur);cur='';
      } else if(!q && (c==='\n'||c==='\r')){
        if(c==='\r'&&n==='\n')i++;
        row.push(cur); if(row.some(x=>String(x).trim())) lines.push(row); row=[]; cur='';
      } else cur+=c;
    }
    row.push(cur); if(row.some(x=>String(x).trim())) lines.push(row);
    return lines;
  }

  function parseCustomerDelimited(text){
    const lines=splitDelimited(text); if(!lines.length) return [];
    const rawHead=lines.shift().map(v=>String(v||'').trim());
    const head=rawHead.map(cleanKey);
    const map={
      controlnumber:'controlNumber', lwhid:'controlNumber', lwhidcontrolnumber:'controlNumber',
      invreceipt:'invReceipt', invreceiptno:'invReceipt', invrec:'invReceipt',
      subcustnm:'subCustNm', customer:'subCustNm', subcustomer:'subCustNm',
      itemnm:'itemNm', item:'itemNm', itemnumber:'itemNm',
      lotnum:'lotNum', lot:'lotNum', lotnumber:'lotNum',
      qty:'qty', quantity:'qty', location:'location', comments:'comments', vendor:'vendor',
      unique2:'unique2', unique3:'unique3', unique5:'unique5', unique6:'unique6', unique7:'unique7', unique8:'unique8',
      itemdesc:'itemDesc', itemdescription:'itemDesc',
      warehouse:'warehouse', bayname:'bayName', bay:'bayName', stillininventory:'stillInInventory', currentbay:'currentBay',
      syncedat:'syncedAt'
    };
    const idx={}; head.forEach((h,i)=>{ if(map[h] && idx[map[h]]===undefined) idx[map[h]]=i; });
    const known=head.join('|').startsWith('controlnumber|invreceipt|subcustnm|itemnm|lotnum|qty|location|comments|vendor|unique2|unique3|unique5|unique6|unique7|unique8|warehouse|bayname|stillininventory|currentbay');
    if(known){ Object.assign(idx,{controlNumber:0,invReceipt:1,subCustNm:2,itemNm:3,lotNum:4,qty:5,location:6,comments:7,vendor:8,unique2:9,unique3:10,unique5:11,unique6:12,unique7:13,unique8:14,warehouse:15,bayName:16,stillInInventory:17,currentBay:18}); }
    const data=Object.keys(idx).length>=3?lines:[rawHead,...lines];
    function val(r,key,fallback){ const i=idx[key]; return (i!==undefined ? r[i] : r[fallback]) || ''; }
    return data.map(r=>({
      controlNumber:val(r,'controlNumber',0), invReceipt:val(r,'invReceipt',1), subCustNm:val(r,'subCustNm',2), itemNm:val(r,'itemNm',3), lotNum:val(r,'lotNum',4), qty:val(r,'qty',5), location:val(r,'location',6), comments:val(r,'comments',7), vendor:val(r,'vendor',8), unique2:val(r,'unique2',9), unique3:val(r,'unique3',10), unique5:val(r,'unique5',11), unique6:val(r,'unique6',12), unique7:val(r,'unique7',13), unique8:val(r,'unique8',14), itemDesc:val(r,'itemDesc'), warehouse:val(r,'warehouse',15), bayName:val(r,'bayName',16), stillInInventory:val(r,'stillInInventory',17), currentBay:val(r,'currentBay',18), syncedAt:val(r,'syncedAt')
    })).filter(r=>Object.values(r).some(Boolean));
  }

  function parseCustomerJson(data){ const arr=Array.isArray(data)?data:(data&&(data.rows||data.data))||[]; return arr.map(x=>({controlNumber:x.ControlNumber||x.controlNumber||'',invReceipt:x.INV_Receipt||x.InvRec||x.invReceipt||'',subCustNm:x.SubCustNm||x.Customer||'',itemNm:x.ItemNm||'',lotNum:x.LotNum||'',qty:x.Qty||'',location:x.Location||'',comments:x.Comments||'',vendor:x.Vendor||'',unique2:x.Unique2||'',unique3:x.Unique3||'',unique5:x.Unique5||'',unique6:x.Unique6||'',unique7:x.Unique7||'',unique8:x.Unique8||'',itemDesc:x.ItemDesc||x['Item Desc']||'',warehouse:x.Warehouse||'',bayName:x.BayName||'',stillInInventory:x.Still_In_Inventory||'',currentBay:x.CurrentBay||''})); }

  async function fetchText(url){
    const bust=(url.includes('?')?'&':'?')+'_=' + Date.now();
    let res;
    try{ res=await fetch(url+bust,{cache:'no-store',mode:'cors'}); }
    catch(err){ throw new Error('Fetch blocked or network error while loading: '+url+' — '+err.message); }
    if(!res.ok) throw new Error('HTTP '+res.status+' while loading: '+url);
    const text=await res.text();
    if(/<html|<!doctype html|ServiceLogin|accounts\.google/i.test(text.slice(0,500))) throw new Error('Google returned a web/sign-in page instead of CSV. Loading from: '+url);
    return {text,ctype:(res.headers.get('content-type')||'').toLowerCase()};
  }

  function getCustomerUrl(){ const saved=LWHStorage.get('customerLookupUrl',''); const input=el('setCustomerLookupUrl'); const fromInput=input?input.value:''; const url=normalizeUrl(fromInput||saved||CUSTOMER_DEFAULT_URL,CUSTOMER_DEFAULT_URL); if(input&&input.value!==url)input.value=url; LWHStorage.set('customerLookupUrl',url); setCustomerCurrentUrl(url); return url; }

  function formatSyncedAt(iso){
    if(!iso) return null;
    const d=new Date(iso.includes('T')?iso:iso.replace(' ','T'));
    if(isNaN(d)) return null;
    return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  }

  async function loadCustomerFromUrl(){ const url=getCustomerUrl(); customerStatus('Loading from: '+url); const {text,ctype}=await fetchText(url); customerRows=(ctype.includes('json')||/^[\s\r\n]*[\[{]/.test(text))?parseCustomerJson(JSON.parse(text)):parseCustomerDelimited(text); LWHStorage.set('customerLookupRows',customerRows); const synced=formatSyncedAt(customerRows[0]?.syncedAt); customerStatus(`Loaded ${customerRows.length} row(s).`+(synced?` Data as of ${synced}.`:'')); return customerRows; }

  function loadCached(){ customerRows=LWHStorage.get('customerLookupRows',[]); setCustomerCurrentUrl(LWHStorage.get('customerLookupUrl',CUSTOMER_DEFAULT_URL)||CUSTOMER_DEFAULT_URL); const synced=formatSyncedAt(customerRows[0]?.syncedAt); customerStatus(customerRows.length?`Using ${customerRows.length} cached row(s) while auto-load refreshes.`+(synced?` (as of ${synced})`:''):'Master Lookup data not loaded yet. Auto-load will try to refresh.'); }
  function resetCustomerSource(){ LWHStorage.set('customerLookupUrl',CUSTOMER_DEFAULT_URL); const input=el('setCustomerLookupUrl'); if(input) input.value=CUSTOMER_DEFAULT_URL; setCustomerCurrentUrl(CUSTOMER_DEFAULT_URL); customerStatus('Source reset. Click Load / Refresh Data.'); }

  const customerFieldOrder=['controlNumber','invReceipt','subCustNm','itemNm','lotNum','qty','location','comments','vendor','unique2','unique3','unique5','unique6','unique7','unique8','itemDesc','warehouse','bayName','stillInInventory','currentBay'];
  const customerDefaultLabels={controlNumber:'LWH ID / Control #',invReceipt:'INV Receipt',subCustNm:'Customer',itemNm:'Item #',lotNum:'Lot #',qty:'Qty',location:'Location',comments:'Comments / Customer ID',vendor:'Vendor',unique2:'Unique2',unique3:'Unique3',unique5:'Unique5',unique6:'Unique6',unique7:'Unique7',unique8:'Unique8',itemDesc:'Item Description',warehouse:'Warehouse',bayName:'Bay Name',stillInInventory:'Still In Inventory',currentBay:'Current Bay'};
  function customerLabels(){ return Object.assign({},customerDefaultLabels,LWHStorage.get('customerFieldLabels',{})||{}); }
  function saveCustomerLabelsFromSettings(){ const labels={}; customerFieldOrder.forEach(k=>{ const input=el('custLabel_'+k); if(input) labels[k]=input.value||customerDefaultLabels[k]; }); LWHStorage.set('customerFieldLabels',labels); LWHUI.toast('Customer lookup labels saved'); }
  function loadCustomerLabelsToSettings(){ const labels=customerLabels(); customerFieldOrder.forEach(k=>{ const input=el('custLabel_'+k); if(input) input.value=labels[k]||customerDefaultLabels[k]; }); }
  function bestMatchField(r,terms){ const labels=customerLabels(); for(const k of customerFieldOrder){ const value=String(r[k]||'').toLowerCase(); if(value && terms.some(t=>value.includes(t))) return {key:k,label:labels[k]||k,value:r[k]}; } return null; }
  function customerSearch(q){ q=String(q||'').toLowerCase().trim(); if(!q) return customerRows.slice(0,50).map(r=>({row:r,match:null})); const terms=q.split(/\s+/); return customerRows.filter(r=>{const hay=customerFieldOrder.map(k=>r[k]).join(' ').toLowerCase(); return terms.every(t=>hay.includes(t));}).slice(0,100).map(r=>({row:r,match:bestMatchField(r,terms)})); }
  // Read-only accessor so other tools (Pick List) can filter the same live dataset.
  function getAllRows(){ return customerRows; }

  // HOME DASHBOARD — customer totals, shown above Quick Actions. Refreshes
  // automatically any time customerStatus() fires, which covers every data
  // path (auto-load, manual refresh, paste, cached-on-open) with one hook.
  function customerTotals(){
    const groups={};
    customerRows.forEach(r=>{
      const name=r.subCustNm||'—';
      if(!groups[name]) groups[name]={customer:name,pallets:0,totalQty:0};
      groups[name].pallets++;
      groups[name].totalQty+=parseFloat(r.qty)||0;
    });
    return Object.values(groups).sort((a,b)=>b.pallets-a.pallets);
  }

  // Same idea as customerTotals(), one level more granular — grouped by
  // warehouse AND customer, for the Home quick-reference table. Sorted by
  // warehouse first (so it reads as location-grouped blocks), then by
  // pallets descending within each warehouse.
  function locationCustomerTotals(){
    const groups={};
    customerRows.forEach(r=>{
      const wh=r.warehouse||'—', name=r.subCustNm||'—';
      const key=wh+'|'+name;
      if(!groups[key]) groups[key]={warehouse:wh,customer:name,pallets:0,totalQty:0};
      groups[key].pallets++;
      groups[key].totalQty+=parseFloat(r.qty)||0;
    });
    return Object.values(groups).sort((a,b)=> a.warehouse===b.warehouse ? b.pallets-a.pallets : a.warehouse.localeCompare(b.warehouse));
  }

  // Same idea as customerTotals() and locationCustomerTotals(), collapsed
  // to just warehouse (no customer breakdown) — for the compact "Pallets
  // by Location" stat row on Home. The detailed Location & Customer table
  // further down already covers the drill-down view; this is the
  // at-a-glance version.
  function warehouseTotals(){
    const groups={};
    customerRows.forEach(r=>{
      const wh=r.warehouse||'—';
      if(!groups[wh]) groups[wh]={warehouse:wh,pallets:0,totalQty:0};
      groups[wh].pallets++;
      groups[wh].totalQty+=parseFloat(r.qty)||0;
    });
    return Object.values(groups).sort((a,b)=>b.pallets-a.pallets);
  }

  function formatKpiDate(iso){
    if(!iso) return null;
    const d=new Date(String(iso).includes('T')?iso:String(iso).replace(' ','T'));
    if(isNaN(d)) return null;
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  }

  // HOME KPI CARDS — mirrors the traditional dashboard look: a bold total
  // pallet count, active warehouse count, and last-synced date. Same
  // trigger as renderHomeCustomerTotals, so it always stays current.
  function renderHomeKpis(){
    const countEl=el('kpiInventoryCount'), updEl=el('kpiLastUpdated');
    if(!countEl) return;
    if(!customerRows.length){
      countEl.textContent='—'; if(updEl) updEl.textContent='—';
      return;
    }
    countEl.textContent=customerRows.length.toLocaleString();
    if(updEl){
      const latest=customerRows.reduce((max,r)=> r.syncedAt && r.syncedAt>max ? r.syncedAt : max, '');
      updEl.textContent=formatKpiDate(latest)||'—';
    }
  }

  function renderHomeCustomerTotals(){
    const out=el('homeCustomerTotals'); if(!out) return;
    if(!customerRows.length){ out.innerHTML='<p class="hint">Loading inventory by customer…</p>'; return; }
    const totals=customerTotals();
    if(!totals.length){ out.innerHTML='<p class="hint">No inventory data available.</p>'; return; }
    const rows=totals.map(t=>`<tr><td>${safe(t.customer)}</td><td>${t.pallets.toLocaleString()}</td><td>${t.totalQty.toLocaleString()}</td></tr>`).join('');
    out.innerHTML=`<table class="pls-table"><thead><tr><th>Customer</th><th>Pallets</th><th>Total Qty</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderHomeLocationCustomerTotals(){
    const out=el('homeLocationCustomerTotals'); if(!out) return;
    if(!customerRows.length){ out.innerHTML='<p class="hint">Loading inventory…</p>'; return; }
    const totals=locationCustomerTotals();
    if(!totals.length){ out.innerHTML='<p class="hint">No inventory data available.</p>'; return; }
    const rows=totals.map(t=>`<tr><td>${safe(t.warehouse)}</td><td>${safe(t.customer)}</td><td>${t.pallets.toLocaleString()}</td><td>${t.totalQty.toLocaleString()}</td></tr>`).join('');
    out.innerHTML=`<table class="pls-table"><thead><tr><th>Location</th><th>Customer</th><th>Pallets</th><th>Total Qty</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderHomeWarehouseTotals(){
    const out=el('homeWarehouseTotals'); if(!out) return;
    if(!customerRows.length){ out.innerHTML='<div><span class="hint">Loading…</span></div>'; return; }
    const totals=warehouseTotals();
    if(!totals.length){ out.innerHTML='<div><span class="hint">No inventory data available.</span></div>'; return; }
    out.innerHTML=totals.map(t=>`<div><b>${t.pallets.toLocaleString()}</b><span>${safe(t.warehouse)}</span></div>`).join('');
  }

  // ITEM SUMMARY — a separate, focused search, kept deliberately apart
  // from the universal search above. Groups every pallet of one item by
  // lot + bay, so "how much of item XYZ do we have and where" is a
  // single glance instead of scrolling through individual pallet cards.
  //
  // AS OF 2026-08-14: computed SERVER-SIDE by get_item_inventory_summary
  // instead of the old client-side grouping — that function counts by
  // DISTINCT pallet_id, not row count, same fix applied to Item
  // Transaction Lookup's Summary mode after the duplicate-pallet-count
  // investigation. Now async — callers need to await it.
  async function itemSummary(q){
    q=String(q||'').trim();
    if(!q) return null;

    let rpcRows;
    try{
      rpcRows=await fetchServerItemSummary(q);
    }catch(e){
      console.error(e);
      return {item:q, itemDesc:'', rows:[], totalPallets:0, totalQty:0, error:e.message};
    }

    if(!rpcRows || !rpcRows.length){
      return {item:q, itemDesc:'', rows:[], totalPallets:0, totalQty:0};
    }

    const rows=rpcRows.map(r=>({
      lotNum:r.lot_number||'—',
      bay:r.bay_name||'—',
      warehouse:r.warehouse||'—',
      qtyEach:String(r.qty_each??'0'),
      pallets:Number(r.pallets)||0,
      totalQty:Number(r.total_qty)||0
    }));

    const totalPallets=rows.reduce((s,r)=>s+r.pallets,0);
    const totalQty=rows.reduce((s,r)=>s+r.totalQty,0);

    return {item:rpcRows[0].item_number, itemDesc:rpcRows[0].item_description||'', rows, totalPallets, totalQty};
  }

  function renderItemSummary(result){
    const out=el('itemSummaryOutput'); if(!out) return;
    out.innerHTML='';
    if(!result){ return; }
    if(result.error){ out.innerHTML=`<div class="card">Couldn't load the item summary from the server: ${safe(result.error)}<div class="hint">Check your connection and try again — this now runs in the database, not the browser.</div></div>`; return; }
    if(!result.rows.length){ out.innerHTML=`<div class="card">No pallets found for "${safe(result.item)}".</div>`; return; }

    const header=document.createElement('div'); header.className='card';
    header.innerHTML=`<b>${safe(result.item)}</b>${result.itemDesc?' — '+safe(result.itemDesc):''}<div class="hint">${result.totalPallets.toLocaleString()} total pallet(s) · ${result.totalQty.toLocaleString()} total qty</div>`;
    out.append(header);

    const table=document.createElement('table'); table.className='pls-table'; table.style.marginTop='10px';
    table.innerHTML='<thead><tr><th>Lot #</th><th>Bay</th><th>Warehouse</th><th>Pallets</th><th>Qty Each</th><th>Total Qty</th></tr></thead>';
    const tbody=document.createElement('tbody');
    result.rows.forEach(r=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${safe(r.lotNum)}</td><td>${safe(r.bay)}</td><td>${safe(r.warehouse)}</td><td>${r.pallets}</td><td>${safe(r.qtyEach)}</td><td>${r.totalQty.toLocaleString()}</td>`;
      tbody.append(tr);
    });
    table.append(tbody);
    out.append(table);

    const actions=document.createElement('div'); actions.className='actions'; actions.style.marginTop='12px';
    const printBtn=document.createElement('button'); printBtn.type='button'; printBtn.className='ghost'; printBtn.textContent='Print Summary';
    const csvBtn=document.createElement('button'); csvBtn.type='button'; csvBtn.className='ghost'; csvBtn.textContent='Download CSV';
    actions.append(printBtn,csvBtn);
    out.append(actions);

    printBtn.onclick=()=>{
      const printOut=el('customerLookupPrintOutput');
      if(printOut){
        printOut.innerHTML=`<div class="checklist-page"><h2>Item Summary — ${safe(result.item)}</h2>${result.itemDesc?`<p>${safe(result.itemDesc)}</p>`:''}<p>${result.totalPallets.toLocaleString()} total pallet(s) · ${result.totalQty.toLocaleString()} total qty</p>${table.outerHTML}</div>`;
      }
      if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
      setTimeout(()=>window.print(),50);
    };

    csvBtn.onclick=()=>{
      const csvRows=[['Item','Item Description','Lot #','Bay','Warehouse','Pallets','Qty Each','Total Qty']];
      result.rows.forEach(r=>csvRows.push([result.item,result.itemDesc,r.lotNum,r.bay,r.warehouse,r.pallets,r.qtyEach,r.totalQty]));
      csvRows.push(['','','','','Total',result.totalPallets,'',result.totalQty]);
      const csv=csvRows.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob=new Blob([csv],{type:'text/csv'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`item-summary-${result.item}.csv`; document.body.append(a); a.click(); a.remove();
      if(window.LWHUI) LWHUI.toast('CSV downloaded');
    };
  }


  // Used only by the explicit "Scan to Print" action (Pallet Labels screen) —
  // deliberately separate from customerSearch/Master Lookup's scan, which is
  // used constantly just to verify a pallet's bay and must never auto-print.
  // Exact match on LWH ID/Control # first (what's actually on existing
  // labels), falling back to an exact match on Item # if nothing hit.
  function findExactForPrint(code){
    code=String(code||'').trim().toLowerCase(); if(!code) return null;
    let hit=customerRows.find(r=>String(r.controlNumber||'').trim().toLowerCase()===code);
    if(!hit) hit=customerRows.find(r=>String(r.itemNm||'').trim().toLowerCase()===code);
    return hit?customerToPalletRow(hit):null;
  }
  // One shared mapping from the master-sheet schema to the generic pallet-row
  // shape every label/print/pallet-form path expects. Used for Master Lookup
  // results AND Receiving/InvRec Print results now — one uniform mapping,
  // one uniform label, one data source.
  // Some blank cells in the sheet export come through as the literal text
  // "NULL" rather than truly empty — without this, that text would show up
  // on printed labels as if it were real data (e.g. Customer ID: "NULL").
  function cleanVal(v){ const s=String(v??'').trim(); return (!s||/^null$/i.test(s))?'':s; }
  function customerToPalletRow(r){ return {location:cleanVal(r.location||r.warehouse),lwhid:cleanVal(r.controlNumber),custId:cleanVal(r.comments),customer:cleanVal(r.subCustNm),invRec:cleanVal(r.invReceipt),billToRef:'',item:cleanVal(r.itemNm),desc:cleanVal(r.itemDesc),lot:cleanVal(r.lotNum),qty:cleanVal(r.qty),units:'',bay:cleanVal(r.currentBay||r.bayName),dateReceived:'',vendor:cleanVal(r.vendor),unique2:cleanVal(r.unique2),unique8:cleanVal(r.unique8)}; }
  function copyCustomerResult(r){ const labels=customerLabels(); const text=customerFieldOrder.map(k=>`${labels[k]||k}: ${r[k]||''}`).join('\n'); navigator.clipboard?.writeText(text).then(()=>LWHUI.toast('Result copied')).catch(()=>alert(text)); }
  // Read-aloud: uses the browser's own built-in text-to-speech (window.speechSynthesis)
  // — no external service, no API, no network call, works offline. Feature-detected,
  // and respects the Settings toggle (default on, per-user override to off).
  // Only triggers on exactly one match — the "found it" moment for a specific
  // LWH ID lookup — rather than trying to read out a whole list of results.
  //
  // Voice selection: browsers ship several built-in voices (varies by device/OS),
  // and the default one some people find robotic. speechSynthesis.getVoices() can
  // return empty on first call in Chrome/Edge until the async 'voiceschanged' event
  // fires, so we listen for that and re-populate the Settings dropdown when it does.
  let cachedVoices=[];
  function refreshVoiceList(){
    if(!window.speechSynthesis) return;
    cachedVoices=speechSynthesis.getVoices()||[];
    const sel=el('setTtsVoice');
    if(!sel) return;
    if(!cachedVoices.length){ sel.innerHTML='<option value="">No voices found — try Chrome or Edge</option>'; return; }
    const saved=LWHStorage.get('ttsVoiceURI','');
    const sorted=[...cachedVoices].sort((a,b)=>{
      const aEn=a.lang.toLowerCase().startsWith('en')?0:1, bEn=b.lang.toLowerCase().startsWith('en')?0:1;
      if(aEn!==bEn) return aEn-bEn;
      return a.name.localeCompare(b.name);
    });
    sel.innerHTML='<option value="">Default (system voice)</option>'+sorted.map(v=>`<option value="${safe(v.voiceURI)}"${v.voiceURI===saved?' selected':''}>${safe(v.name)} (${safe(v.lang)})</option>`).join('');
  }
  function findVoice(uri){ const list=cachedVoices.length?cachedVoices:(window.speechSynthesis?speechSynthesis.getVoices():[]); return list.find(v=>v.voiceURI===uri); }
  function speakText(text){
    if(!window.speechSynthesis || !text) return;
    try{
      speechSynthesis.cancel(); // stop any previous utterance before starting a new one
      const utter=new SpeechSynthesisUtterance(text);
      utter.rate=0.95;
      const uri=LWHStorage.get('ttsVoiceURI','');
      if(uri){ const v=findVoice(uri); if(v) utter.voice=v; }
      speechSynthesis.speak(utter);
    }catch(e){ /* silent — never let this interrupt an actual lookup */ }
  }
  function saveTtsVoice(uri){ LWHStorage.set('ttsVoiceURI',uri||''); }
  if(window.speechSynthesis){
    speechSynthesis.onvoiceschanged=refreshVoiceList;
    refreshVoiceList();
  }
  function speakResult(r){
    if(!LWHStorage.get('readAloudEnabled',true)) return;
    if(!window.speechSynthesis) return;
    const parts=[];
    if(r.itemNm) parts.push(r.itemNm);
    const bay=r.currentBay||r.bayName; if(bay) parts.push('Bay '+bay);
    if(r.qty) parts.push('Quantity '+r.qty);
    if(!parts.length) return;
    speakText(parts.join('. '));
  }
  function renderCustomerResults(list){ const out=el('customerLookupResults'); const printOut=el('customerLookupPrintOutput'); if(printOut) printOut.innerHTML=''; if(!out)return; out.innerHTML=''; if(!list.length){ out.innerHTML='<div class="card">No customer lookup results found.</div>'; return; } const labels=customerLabels(); const top=document.createElement('div'); top.className='card'; top.innerHTML=`<b>${list.length}</b> matching row(s)<div class="actions"><button type="button" id="custPrintAll">Print Pallet Labels</button></div>`; out.append(top); const wrap=document.createElement('div'); wrap.className='result-list customer-results'; list.forEach((obj,i)=>{ const r=obj.row; const match=obj.match; const c=document.createElement('div'); c.className='result-card customer-card'; const grid=customerFieldOrder.map(k=>`<div class="cust-field"><b>${safe(labels[k]||k)}</b><span>${safe(r[k]||'')}</span></div>`).join(''); c.innerHTML=`<div><b>${safe(r.controlNumber)}</b> <span>${safe(r.subCustNm)}</span></div><div>${safe(r.warehouse||r.location)} · Bay <b>${safe(r.currentBay||r.bayName)}</b> · Qty ${safe(r.qty)} · INV ${safe(r.invReceipt)}</div>${match?`<div class="match-pill">Matched on ${safe(match.label)}: <b>${safe(match.value)}</b></div>`:''}<details open><summary>All customer lookup fields</summary><div class="cust-grid">${grid}</div></details><div class="actions"><button type="button" data-cust-print="${i}">Print Pallet Label</button><button type="button" data-cust-copy="${i}" class="ghost">Copy Result</button><button type="button" data-cust-fill="${i}" class="ghost">Fill Pallet Form</button></div>`; wrap.append(c); }); out.append(wrap); const rowsForLabels=list.map(x=>customerToPalletRow(x.row)); const pa=el('custPrintAll'); if(pa) pa.onclick=()=>printRows(rowsForLabels,printOut); wrap.onclick=e=>{ const b=e.target.closest('button'); if(!b)return; const idx=+(b.dataset.custPrint??b.dataset.custCopy??b.dataset.custFill); const obj=list[idx]; if(!obj)return; if(b.dataset.custPrint!==undefined) printRows([customerToPalletRow(obj.row)],printOut); if(b.dataset.custCopy!==undefined) copyCustomerResult(obj.row); if(b.dataset.custFill!==undefined){ fillPallet(customerToPalletRow(obj.row)); LWHUI.show('pallet'); } }; if(list.length===1) speakResult(list[0].row); }

  function printRows(list,target){ if(!list||!list.length){LWHUI.toast('No rows to print'); return;} LWHLabels.generatePalletRows(list,target||el('customerLookupPrintOutput')); LWHStorage.set('lookupCount',(+LWHStorage.get('lookupCount',0))+1); setTimeout(()=>window.print(),300); }

  function findReceiving(){
    const q=String((el('recInvRec')||{}).value||'').trim();
    const out=el('receivingResults'); const statusEl=el('recStatus'); const printOut=el('receivingPrintOutput');
    if(printOut) printOut.innerHTML='';
    if(!q){ if(statusEl) statusEl.textContent='Enter an InvRec first.'; return []; }
    const list=customerRows.filter(r=>String(r.invReceipt||'').trim().toLowerCase()===q.toLowerCase()).map(customerToPalletRow);
    if(statusEl) statusEl.textContent=`Found ${list.length} pallet(s) for InvRec ${q}.`;
    if(out){
      if(!list.length){ out.innerHTML='<div class="card">No pallets found for that InvRec.</div>'; }
      else {
        const cust=[...new Set(list.map(r=>r.customer).filter(Boolean))].join(', ');
        const bays=[...new Set(list.map(r=>r.bay).filter(Boolean))].slice(0,8).join(', ');
        out.innerHTML=`<div class="card"><h3>InvRec ${safe(q)}</h3><p><b>${list.length}</b> pallet(s) ${cust?`· ${safe(cust)}`:''}</p><p class="hint">Bays: ${safe(bays || 'n/a')}</p><div class="actions"><button type="button" id="recPrintAll2">Print All ${list.length}</button><button type="button" id="recFillBulk" class="ghost">Send to Pallet Bulk</button></div></div><div class="result-list">${list.slice(0,100).map(r=>`<div class="result-card"><div><b>${safe(r.lwhid)}</b> <span>${safe(r.customer)}</span></div><div>${safe(r.location)} · Bay <b>${safe(r.bay)}</b> · Qty ${safe(r.qty)}</div><div>${safe(r.item)}${r.desc?' — '+safe(r.desc):''} · Lot ${safe(r.lot)}</div></div>`).join('')}</div>`;
        const b=el('recPrintAll2'); if(b)b.onclick=()=>printRows(list,printOut);
        const bulk=el('recFillBulk'); if(bulk) bulk.onclick=()=>{palletBulkText.value=toTSV(list); document.querySelector('[data-pallet-mode="bulk"]').click(); LWHUI.show('pallet'); LWHUI.toast('Rows sent to Pallet Bulk Paste');};
      }
    }
    return list;
  }
  function toTSV(list){ const h=['Location','LWH_ID','Customer_ID','Customer','InvRec','BillToRef','ItemNm','ItemDesc','LotNum','Qty','Units','BayName','DateReceived']; const keys=['location','lwhid','custId','customer','invRec','billToRef','item','desc','lot','qty','units','bay','dateReceived']; return [h.join('\t'),...list.map(r=>keys.map(k=>String(r[k]??'').replace(/\t/g,' ')).join('\t'))].join('\n'); }
  function fillPallet(r){ if(window.palLocation) palLocation.value=r.location||''; palLwhid.value=r.lwhid||''; palCustId.value=r.custId||''; palCustomer.value=r.customer||''; palBay.value=r.bay||''; palItem.value=r.item||''; palLot.value=r.lot||''; palQty.value=r.qty||''; palDate.value=r.dateReceived||''; palDesc.value=r.desc||''; document.querySelector('[data-pallet-mode="simple"]').click(); }
  window.LWHInventory={CUSTOMER_DEFAULT_URL,parseCustomerDelimited,loadCustomerFromUrl,loadCached,fillPallet,normalizeUrl,resetCustomerSource,getCustomerUrl,printRows,findReceiving,findExactForPrint,toTSV,customerSearch,getAllRows,renderCustomerResults,customerLabels,loadCustomerLabelsToSettings,saveCustomerLabelsFromSettings,itemSummary,renderItemSummary,customerTotals,renderHomeCustomerTotals,locationCustomerTotals,renderHomeLocationCustomerTotals,warehouseTotals,renderHomeWarehouseTotals,refreshVoiceList,speakText,saveTtsVoice};
})();
