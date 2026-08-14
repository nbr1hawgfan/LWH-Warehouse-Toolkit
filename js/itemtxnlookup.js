(function(){
  // ITEM TRANSACTION LOOKUP — built on top of the same Transaction History
  // dataset/loader as the Transaction History and Daily Activity tabs (same
  // rolling ~90-day window, same Supabase edge function). Two views:
  //   - Pallet Detail: every matching transaction row (one row = one pallet
  //     movement), sorted most recent first — general-purpose browsing.
  //     Still client-side, unchanged.
  //   - Summary by Item: rows grouped into one line per load/transaction —
  //     AS OF 2026-08-14, computed SERVER-SIDE by the
  //     get_item_transaction_summary Postgres function instead of the old
  //     client-side buildLoads()/buildTotals(). That function counts
  //     pallets by DISTINCT LWH ID, not by row count, so it can't be
  //     fooled by a duplicate row the way "pallets++ per row" could. Same
  //     load-key logic (Bill-to-Ref, falling back to INV Receipt, falling
  //     back to LWH ID), same lot breakdown, same Totals by Item, Location
  //     & Type block — just computed in the database instead of the
  //     browser. See CHANGELOG for the duplicate-pallet-count
  //     investigation this came out of.
  // Filters (Item #, Warehouse, Date range) all AND together with each other
  // and with the free-text Smart Search box, which matches across every
  // column on the row (not just item/description like Item Summary on the
  // Master Lookup side does).

  const SUPABASE_URL='https://tjivcqxnkftujceumdtx.supabase.co';
  const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqaXZjcXhua2Z0dWpjZXVtZHR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTE5NDMsImV4cCI6MjEwMDQ2Nzk0M30.GzDc-_u92jvAHq7eG1X-1cet5Av9qF3ZDEVJMRKEP0E';

  // Calls get_item_transaction_summary via PostgREST's RPC endpoint — plain
  // fetch, no supabase-js library, matching how the rest of this app
  // already talks to Supabase (see loadTransactions() in transactions.js).
  // The anon key here is the public/publishable key, safe to embed
  // client-side — NOT the sb_secret_ service-role key the PowerShell sync
  // scripts use, which must never appear in this file.
  async function fetchServerSummary(params){
    const url=`${SUPABASE_URL}/rest/v1/rpc/get_item_transaction_summary`;
    const body={};
    if(params.item) body.p_item_number=params.item;
    if(params.warehouse) body.p_location=params.warehouse;
    if(params.q) body.p_search=params.q;
    if(params.from) body.p_start_date=params.from;
    if(params.to) body.p_end_date=params.to;
    const res=await fetch(url,{
      method:'POST',
      headers:{
        'apikey':SUPABASE_ANON_KEY,
        'Authorization':'Bearer '+SUPABASE_ANON_KEY,
        'Content-Type':'application/json'
      },
      body:JSON.stringify(body)
    });
    if(!res.ok){
      const errText=await res.text().catch(()=>res.statusText);
      throw new Error(`Server summary failed (HTTP ${res.status}): ${errText}`);
    }
    return res.json();
  }

  function el(id){ return document.getElementById(id); }
  function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function itlStatus(msg){ const s=el('itlStatus'); if(s) s.textContent=msg; }

  let mode='summary'; // 'detail' | 'summary' — Summary is the default view
  let lastDetailRows=[];
  let lastLoadRows=[];
  let lastSummaryTotals=[];

  // Customer-facing warehouse codes some customers use for our locations —
  // shown alongside our WHSE code, never in place of it, since Tim's own
  // Warehouse filter and internal reports still key off the WHSE codes.
  // Add more mappings here as other customers surface their own codes.
  const LOCATION_ALIASES={'WHSE70':'UWLC','WHSE10':'UWLW'};
  function displayLocation(loc){
    if(!loc) return loc;
    const m=String(loc).match(/^(WHSE\d+)/i);
    if(m){
      const alias=LOCATION_ALIASES[m[1].toUpperCase()];
      if(alias) return `${loc} — ${alias}`;
    }
    return loc;
  }

  // Customer ID (e.g. "3442") is our internal number and means nothing to
  // the customer reading this — left out of both the displayed columns and
  // exports. Still searchable via Smart Search below, just not a column.
  const fieldOrder=['transactionDate','transactionType','lwhId','itemNm','itemDesc','qty','billToRef','subCustNm','lotNum','location','invReceipt','madeFrom','unique2'];
  const labels={transactionDate:'Date',transactionType:'Type',lwhId:'LWH ID',itemNm:'Item #',itemDesc:'Item Description',qty:'Qty',billToRef:'Bill-to-Ref',subCustNm:'Customer',lotNum:'Lot #',location:'Location',invReceipt:'INV Receipt',madeFrom:'Made From',unique2:'Unique2'};
  // Every field on the row is searchable via the Smart Search box — this is
  // deliberately the full row, not a curated subset, per the request to make
  // "all of them" (BillToRef, type, INV Receipt, etc.) searchable.
  const searchableFields=['billToRef','itemNm','lwhId','subCustNm','lotNum','invReceipt','madeFrom','itemDesc','customerId','transactionType','location','transactionDate','unique2'];

  function hasValue(v){ return v!==null && v!==undefined && String(v).trim()!==''; }

  function renderWarehouseOptions(rows){
    const sel=el('itlWarehouse'); if(!sel) return;
    const current=sel.value;
    const warehouses=[...new Set(rows.map(r=>r.location).filter(Boolean))].sort();
    sel.innerHTML='<option value="__all__">All Warehouses</option>'+warehouses.map(w=>`<option value="${safe(w)}">${safe(displayLocation(w))}</option>`).join('');
    if(warehouses.includes(current)) sel.value=current;
  }

  function currentFilters(){
    return {
      q: String((el('itlSearch')||{}).value||'').toLowerCase().trim(),
      item: String((el('itlItem')||{}).value||'').toLowerCase().trim(),
      warehouse: (el('itlWarehouse')||{}).value||'__all__',
      from: (el('itlFrom')||{}).value||'',
      to: (el('itlTo')||{}).value||''
    };
  }

  function filterRows(rows, f){
    const terms=f.q?f.q.split(/\s+/):[];
    return rows.filter(r=>{
      if(f.item && !String(r.itemNm||'').toLowerCase().includes(f.item)) return false;
      if(f.warehouse && f.warehouse!=='__all__' && r.location!==f.warehouse) return false;
      if(f.from && r.transactionDate && r.transactionDate<f.from) return false;
      if(f.to && r.transactionDate && r.transactionDate>f.to) return false;
      if(f.from && !r.transactionDate) return false;
      if(f.to && !r.transactionDate) return false;
      if(terms.length){
        const hay=searchableFields.map(k=>r[k]).join(' ').toLowerCase();
        if(!terms.every(t=>hay.includes(t))) return false;
      }
      return true;
    });
  }

  function setMode(next){
    mode=next;
    document.querySelectorAll('[data-itl-view]').forEach(b=>b.classList.toggle('active', b.dataset.itlView===mode));
    runSearch();
  }

  function runSearch(){
    const rows=window.LWHTransactions?LWHTransactions.getAllTransactions():[];
    renderWarehouseOptions(rows);
    const f=currentFilters();
    if(mode==='summary'){
      // Summary is server-driven now — doesn't need the raw client-side
      // pallet list to be loaded first, just fires the RPC directly.
      runServerSummary(f);
      return;
    }
    if(!rows.length){
      el('itlResults').innerHTML='<div class="card">Transaction history not loaded yet — click Load / Refresh Data, or run a search to load it automatically.</div>';
      return;
    }
    const filtered=filterRows(rows, f);
    renderDetail(filtered);
  }

  function buildTable(rows){
    const scrollWrap=document.createElement('div'); scrollWrap.style.cssText='margin-top:10px;overflow-x:auto';
    const table=document.createElement('table'); table.className='pls-table';
    table.innerHTML='<thead><tr>'+fieldOrder.map(k=>`<th>${safe(labels[k])}</th>`).join('')+'</tr></thead>';
    const tbody=document.createElement('tbody');
    rows.forEach(r=>{
      const tr=document.createElement('tr');
      tr.innerHTML=fieldOrder.map(k=>{
        if(k==='location') return `<td>${hasValue(r[k])?safe(displayLocation(r[k])):''}</td>`;
        return `<td>${hasValue(r[k])?safe(r[k]):''}</td>`;
      }).join('');
      tbody.append(tr);
    });
    table.append(tbody);
    scrollWrap.append(table);
    return scrollWrap;
  }

  function renderDetail(list){
    lastDetailRows=list.slice().sort((a,b)=>(b.transactionDate||'').localeCompare(a.transactionDate||'')).slice(0,1000);
    lastLoadRows=[]; lastSummaryTotals=[];
    const out=el('itlResults'); if(!out) return;
    out.innerHTML='';
    if(!list.length){ out.innerHTML='<div class="card">No matching transactions found.</div>'; return; }

    const inbound=list.filter(r=>r.transactionType==='Inbound').length;
    const outbound=list.length-inbound;
    const totalQty=list.reduce((s,r)=>s+(parseFloat(r.qty)||0),0);
    const items=new Set(list.map(r=>r.itemNm).filter(Boolean)).size;

    const top=document.createElement('div'); top.className='card';
    top.innerHTML=`<b>${list.length}</b> matching transaction(s) across <b>${items}</b> item(s)`+
      (list.length>1000?` (showing most recent 1000)`:'')+
      `<div class="hint">${inbound} Inbound · ${outbound} Outbound · ${totalQty.toLocaleString()} total Qty</div>`;
    out.append(top);

    // Plain table — same view used for on-screen viewing, CSV, and Print
    // Table, per the customer's requirement that results come back as a
    // table rather than the card layout Transaction History uses. Wrapped
    // for horizontal scroll on mobile, matching Daily Activity's pattern.
    out.append(buildTable(lastDetailRows));
  }

  // Groups individual pallet rows into one row per load/transaction. A
  // "load" is everything sharing the same Bill-to-Ref (the normal case,
  // covers outbound shipments) — falling back to INV Receipt when
  // Bill-to-Ref is blank (inbound receipts usually don't carry a
  // Bill-to-Ref), and falling back to the individual LWH ID as a last
  // resort for a lone pallet with neither. Always scoped to the same item,
  // location, type, and customer so nothing gets merged across those.
  //
  // NO LONGER CALLED as of 2026-08-14 — Summary mode now gets this same
  // grouping done server-side by get_item_transaction_summary instead
  // (counts by distinct LWH ID, immune to the row-duplication bug this
  // client-side version could fall victim to). Left in place rather than
  // deleted, in case the server call ever needs a client-side fallback.
  function buildLoads(list){
    const groups={};
    list.forEach(r=>{
      const billRef=String(r.billToRef||'').trim();
      const invRef=String(r.invReceipt||'').trim();
      const loadRef = billRef ? 'B:'+billRef : (invRef ? 'I:'+invRef : 'P:'+(r.lwhId||Math.random()));
      const key=[loadRef, r.itemNm||'', r.location||'', r.transactionType||'', r.subCustNm||''].join('|');
      if(!groups[key]) groups[key]={
        transactionType:r.transactionType||'—', subCustNm:r.subCustNm||'—', location:r.location||'—',
        itemNm:r.itemNm||'(no item #)', itemDesc:r.itemDesc||'',
        invReceipts:new Set(), billToRefs:new Set(), dates:new Set(),
        lotTotals:{}, pallets:0, qty:0
      };
      const g=groups[key];
      if(!g.itemDesc && r.itemDesc) g.itemDesc=r.itemDesc;
      if(invRef) g.invReceipts.add(invRef);
      if(billRef) g.billToRefs.add(billRef);
      if(r.transactionDate) g.dates.add(r.transactionDate);
      const qty=parseFloat(r.qty)||0;
      g.pallets++; g.qty+=qty;
      const lot=r.lotNum||'(no lot)';
      if(!g.lotTotals[lot]) g.lotTotals[lot]={lotNum:lot,pallets:0,qty:0};
      g.lotTotals[lot].pallets++; g.lotTotals[lot].qty+=qty;
    });
    return Object.values(groups).map(g=>{
      const invList=[...g.invReceipts];
      const billList=[...g.billToRefs];
      const dateList=[...g.dates].sort();
      const lots=Object.values(g.lotTotals).sort((a,b)=>a.lotNum.localeCompare(b.lotNum));
      return {
        transactionType:g.transactionType, subCustNm:g.subCustNm, location:g.location,
        itemNm:g.itemNm, itemDesc:g.itemDesc,
        invReceiptDisplay: invList.length===0?'—':invList.length===1?invList[0]:`${invList.length} receipts`,
        billToRefDisplay: billList.length===0?'—':billList.length===1?billList[0]:`${billList.length} refs`,
        dateDisplay: dateList.length===0?'—':dateList.length===1?dateList[0]:`${dateList[0]} – ${dateList[dateList.length-1]}`,
        pallets:g.pallets, qty:g.qty, lots, multiLot:lots.length>1
      };
    }).sort((a,b)=> a.itemNm.localeCompare(b.itemNm) || a.location.localeCompare(b.location) || a.transactionType.localeCompare(b.transactionType) || a.dateDisplay.localeCompare(b.dateDisplay));
  }

  function lotBreakdownText(g){
    // Server rows (Summary mode as of 2026-08-14) come with the breakdown
    // text already formatted by get_item_transaction_summary — use that
    // directly. Fall back to the old lots-array logic only if a row
    // somehow doesn't have it (shouldn't happen anymore, but harmless).
    if(g.lotBreakdownText!==undefined) return g.lotBreakdownText;
    return g.multiLot ? g.lots.map(l=>`${l.lotNum} (${l.pallets.toLocaleString()} plt, ${l.qty.toLocaleString()} qty)`).join('; ') : (g.lots[0]?.lotNum||'—');
  }

  function buildLoadsTable(loads){
    const scrollWrap=document.createElement('div'); scrollWrap.style.cssText='margin-top:10px;overflow-x:auto';
    const table=document.createElement('table'); table.className='pls-table';
    table.innerHTML='<thead><tr><th>Type</th><th>Customer</th><th>Location</th><th>Item #</th><th>Item Description</th><th>INV Receipt</th><th>Bill-to-Ref</th><th>Date</th><th>Lot Breakdown</th><th>Pallets</th><th>Qty</th></tr></thead>';
    const tbody=document.createElement('tbody');
    loads.forEach(g=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${safe(g.transactionType)}</td><td>${safe(g.subCustNm)}</td><td>${safe(displayLocation(g.location))}</td><td>${safe(g.itemNm)}</td><td>${safe(g.itemDesc)}</td><td>${safe(g.invReceiptDisplay)}</td><td>${safe(g.billToRefDisplay)}</td><td>${safe(g.dateDisplay)}</td><td>${safe(lotBreakdownText(g))}</td><td>${g.pallets.toLocaleString()}</td><td>${g.qty.toLocaleString()}</td>`;
      tbody.append(tr);
    });
    table.append(tbody);
    scrollWrap.append(table);
    return scrollWrap;
  }

  // Grand totals grouped by Item + Location + Type — same grain as the
  // portal's ROLLUP "ITEM TOTAL" line, summed across every LOAD row shown
  // above. Takes already-built load rows (server or otherwise) rather than
  // raw pallet rows — since each load row's pallet count already equals
  // its member pallets exactly, summing load rows here is mathematically
  // identical to summing raw pallets, just cheaper and consistent with
  // Summary mode no longer fetching the full raw pallet list at all.
  function buildTotalsFromLoads(loadRows){
    const groups={};
    loadRows.forEach(g=>{
      const key=(g.itemNm||'(no item #)')+'|'+(g.location||'—')+'|'+(g.transactionType||'—');
      if(!groups[key]) groups[key]={itemNm:g.itemNm||'(no item #)', location:g.location||'—', transactionType:g.transactionType||'—', pallets:0, qty:0};
      const t=groups[key];
      t.pallets+=g.pallets; t.qty+=g.qty;
    });
    return Object.values(groups).sort((a,b)=> a.itemNm.localeCompare(b.itemNm) || a.location.localeCompare(b.location) || a.transactionType.localeCompare(b.transactionType));
  }

  // Renders Summary mode from already-built load rows — as of 2026-08-14
  // these come from the server (get_item_transaction_summary), not from
  // filtering the raw client-side pallet list the way this used to work.
  function renderSummary(loadRows){
    lastLoadRows=loadRows;
    lastSummaryTotals=buildTotalsFromLoads(loadRows);
    lastDetailRows=[];

    const out=el('itlResults'); if(!out) return;
    out.innerHTML='';
    if(!lastLoadRows.length){ out.innerHTML='<div class="card">No matching transactions found.</div>'; return; }

    const totalPallets=lastLoadRows.reduce((s,g)=>s+g.pallets,0);
    const totalQty=lastLoadRows.reduce((s,g)=>s+g.qty,0);
    const inbound=lastLoadRows.filter(g=>g.transactionType==='Inbound').reduce((s,g)=>s+g.pallets,0);
    const outbound=totalPallets-inbound;
    const items=new Set(lastLoadRows.map(g=>g.itemNm).filter(Boolean)).size;

    const top=document.createElement('div'); top.className='card';
    top.innerHTML=`<b>${lastLoadRows.length}</b> load(s)/transaction(s) totaling <b>${totalPallets.toLocaleString()}</b> pallet(s) across <b>${items}</b> item(s)`+
      `<div class="hint">${inbound.toLocaleString()} Inbound · ${outbound.toLocaleString()} Outbound · ${totalQty.toLocaleString()} total Qty</div>`;
    out.append(top);

    out.append(buildLoadsTable(lastLoadRows));

    const totalsHeading=document.createElement('div'); totalsHeading.className='card'; totalsHeading.style.marginTop='14px';
    totalsHeading.innerHTML='<b>Totals by Item, Location &amp; Type</b>';
    out.append(totalsHeading);

    const scrollWrap=document.createElement('div'); scrollWrap.style.cssText='margin-top:6px;overflow-x:auto';
    const table=document.createElement('table'); table.className='pls-table';
    table.innerHTML='<thead><tr><th>Item #</th><th>Location</th><th>Type</th><th>Pallets</th><th>Qty</th></tr></thead>';
    const tbody=document.createElement('tbody');
    lastSummaryTotals.forEach(g=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${safe(g.itemNm)}</td><td>${safe(displayLocation(g.location))}</td><td>${safe(g.transactionType)}</td><td>${g.pallets.toLocaleString()}</td><td>${g.qty.toLocaleString()}</td>`;
      tbody.append(tr);
    });
    table.append(tbody);
    scrollWrap.append(table);
    out.append(scrollWrap);
  }

  // Fetches the summary from the server and hands it to renderSummary()
  // in the same load-row shape the rest of this file already expects, so
  // buildLoadsTable / exportCsv / renderPrintTable don't need to change
  // at all — only where the data comes from changes.
  async function runServerSummary(f){
    const out=el('itlResults'); if(!out) return;
    out.innerHTML='<div class="card">Loading summary from server…</div>';

    let rpcRows;
    try{
      rpcRows=await fetchServerSummary({
        item:f.item||null,
        warehouse:(f.warehouse && f.warehouse!=='__all__') ? f.warehouse : null,
        q:f.q||null,
        from:f.from||null,
        to:f.to||null
      });
    }catch(e){
      console.error(e);
      lastLoadRows=[]; lastSummaryTotals=[];
      out.innerHTML=`<div class="card">Couldn't load the summary from the server: ${safe(e.message)}<div class="hint">Summary now runs in the database, not the browser — this needs a live connection each time. Check your connection and try again.</div></div>`;
      return;
    }

    const loadRows=(rpcRows||[]).map(r=>({
      transactionType:r.transaction_type||'—',
      subCustNm:r.customer||'—',
      location:r.location||'—',
      itemNm:r.item_number||'(no item #)',
      itemDesc:r.item_description||'',
      invReceiptDisplay:r.inv_receipt_display||'—',
      billToRefDisplay:r.bill_to_ref_display||'—',
      dateDisplay:r.date_display||'—',
      pallets:Number(r.pallets)||0,
      qty:Number(r.qty)||0,
      lotBreakdownText:r.lot_breakdown||'—'
    }));

    renderSummary(loadRows);
  }

  function csvEscape(v){ const s=String(v??''); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }

  function exportCsv(){
    if(mode==='summary'){
      if(!lastLoadRows.length){ LWHUI.toast('No results to export — run a search first'); return; }
      const header=['Type','Customer','Location','Item #','Item Description','INV Receipt','Bill-to-Ref','Date','Lot Breakdown','Pallets','Qty'];
      const rows=lastLoadRows.map(g=>[g.transactionType,g.subCustNm,displayLocation(g.location),g.itemNm,g.itemDesc,g.invReceiptDisplay,g.billToRefDisplay,g.dateDisplay,lotBreakdownText(g),g.pallets,g.qty].map(csvEscape));
      const totalsHeader=['Item #','Location','Type','Pallets','Qty'];
      const totalsRows=lastSummaryTotals.map(g=>[g.itemNm,displayLocation(g.location),g.transactionType,g.pallets,g.qty].map(csvEscape));
      const csv=[header.join(','),...rows.map(r=>r.join(',')),'','Totals by Item, Location & Type',totalsHeader.join(','),...totalsRows.map(r=>r.join(','))].join('\r\n');
      downloadCsv(csv,'item-transaction-summary');
      LWHUI.toast(`Exported ${lastLoadRows.length} load(s) + ${lastSummaryTotals.length} total(s) to CSV`);
    } else {
      if(!lastDetailRows.length){ LWHUI.toast('No results to export — run a search first'); return; }
      const header=fieldOrder.map(k=>labels[k]);
      const rows=lastDetailRows.map(r=>fieldOrder.map(k=>csvEscape(k==='location'?displayLocation(r[k]):r[k])));
      const csv=[header.join(','),...rows.map(r=>r.join(','))].join('\r\n');
      downloadCsv(csv,'item-transaction-detail');
      LWHUI.toast(`Exported ${lastDetailRows.length} row(s) to CSV`);
    }
  }

  function downloadCsv(csv,name){
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const stamp=new Date().toISOString().slice(0,10);
    a.href=url; a.download=`${name}-${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function renderPrintTable(){
    const out=el('itlPrintTable'); if(!out) return;
    if(mode==='summary'){
      if(!lastLoadRows.length){ out.innerHTML=''; LWHUI.toast('No results to print — run a search first'); return; }
      const header=['Type','Customer','Location','Item #','Item Description','INV Receipt','Bill-to-Ref','Date','Lot Breakdown','Pallets','Qty'].map(h=>`<th>${h}</th>`).join('');
      const rows=lastLoadRows.map(g=>`<tr><td>${safe(g.transactionType)}</td><td>${safe(g.subCustNm)}</td><td>${safe(displayLocation(g.location))}</td><td>${safe(g.itemNm)}</td><td>${safe(g.itemDesc)}</td><td>${safe(g.invReceiptDisplay)}</td><td>${safe(g.billToRefDisplay)}</td><td>${safe(g.dateDisplay)}</td><td>${safe(lotBreakdownText(g))}</td><td>${g.pallets.toLocaleString()}</td><td>${g.qty.toLocaleString()}</td></tr>`).join('');
      const totalsHeader=['Item #','Location','Type','Pallets','Qty'].map(h=>`<th>${h}</th>`).join('');
      const totalsRows=lastSummaryTotals.map(g=>`<tr><td>${safe(g.itemNm)}</td><td>${safe(displayLocation(g.location))}</td><td>${safe(g.transactionType)}</td><td>${g.pallets.toLocaleString()}</td><td>${g.qty.toLocaleString()}</td></tr>`).join('');
      out.innerHTML=`<h2>Item Transaction Summary — ${lastLoadRows.length} load(s)</h2><table class="txn-print-table itl-print-table"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table><h2 style="margin-top:20px">Totals by Item, Location &amp; Type</h2><table class="txn-print-table itl-print-table"><thead><tr>${totalsHeader}</tr></thead><tbody>${totalsRows}</tbody></table>`;
    } else {
      if(!lastDetailRows.length){ out.innerHTML=''; LWHUI.toast('No results to print — run a search first'); return; }
      const header=fieldOrder.map(k=>`<th>${safe(labels[k])}</th>`).join('');
      const rows=lastDetailRows.map(r=>`<tr>${fieldOrder.map(k=>`<td>${safe(k==='location'?displayLocation(r[k]):r[k])}</td>`).join('')}</tr>`).join('');
      out.innerHTML=`<h2>Item Transaction Detail — ${lastDetailRows.length} result(s)</h2><table class="txn-print-table itl-print-table"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    // Landscape 11x8.5 — same trick Pick List uses — gives the wide table
    // room; paired with the .itl-print-table wrap rules above so Qty (the
    // right-most column) doesn't run off the printed page.
    if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(11,8.5);
    setTimeout(()=>print(),100);
  }

  function clearAll(){
    if(el('itlSearch')) el('itlSearch').value='';
    if(el('itlItem')) el('itlItem').value='';
    if(el('itlWarehouse')) el('itlWarehouse').value='__all__';
    if(el('itlFrom')) el('itlFrom').value='';
    if(el('itlTo')) el('itlTo').value='';
    lastDetailRows=[]; lastLoadRows=[]; lastSummaryTotals=[];
    const out=el('itlResults'); if(out) out.innerHTML='';
    const printOut=el('itlPrintTable'); if(printOut) printOut.innerHTML='';
  }

  window.LWHItemTxnLookup={runSearch,setMode,exportCsv,renderPrintTable,clearAll};

  window.addEventListener('load',()=>{
    if(!el('itemTxnLookup')) return;

    document.querySelectorAll('[data-itl-view]').forEach(b=>{
      b.addEventListener('click',()=>setMode(b.dataset.itlView));
    });
    // Keep the segmented control in sync with the default mode ('summary')
    // in case markup ever drifts out of step with the JS default.
    document.querySelectorAll('[data-itl-view]').forEach(b=>b.classList.toggle('active', b.dataset.itlView===mode));

    if(el('itlSearchBtn')) itlSearchBtn.onclick=()=>{ LWHTransactions.loadTransactions(false).then(runSearch); };
    if(el('itlWarehouse')) itlWarehouse.addEventListener('change',runSearch);
    if(el('itlFrom')) itlFrom.addEventListener('change',runSearch);
    if(el('itlTo')) itlTo.addEventListener('change',runSearch);
    if(el('itlLoadBtn')) itlLoadBtn.onclick=async()=>{
      itlStatus('Refreshing transaction history…');
      await LWHTransactions.loadTransactions(true);
      itlStatus('');
      runSearch();
      if(window.LWHUI) LWHUI.toast('Item transaction data refreshed');
    };
    if(el('itlClearBtn')) itlClearBtn.onclick=clearAll;
    if(el('itlCsvBtn')) itlCsvBtn.onclick=exportCsv;
    if(el('itlPrintBtn')) itlPrintBtn.onclick=renderPrintTable;

    // Lazy-load the first time this tab is opened — same approach as
    // Transaction History / Daily Activity, no need to pull the dataset on
    // every app launch if nobody visits this screen that day.
    let loadedOnce=false;
    document.addEventListener('click',e=>{
      if(e.target.closest('[data-view="itemTxnLookup"]') && !loadedOnce){
        loadedOnce=true;
        LWHTransactions.loadTransactions(false).then(runSearch);
      }
    });
  });
})();
