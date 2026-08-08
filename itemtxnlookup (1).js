(function(){
  // ITEM TRANSACTION LOOKUP — built on top of the same Transaction History
  // dataset/loader as the Transaction History and Daily Activity tabs (same
  // rolling ~90-day window, same Supabase edge function). Two views:
  //   - Pallet Detail: every matching transaction row (one row = one pallet
  //     movement), same shape as Transaction History's results.
  //   - Summary by Item: matching rows grouped by item #, with total pallets
  //     and qty (plus an Inbound/Outbound split).
  // Filters (Item #, Warehouse, Date range) all AND together with each other
  // and with the free-text Smart Search box, which matches across every
  // column on the row (not just item/description like Item Summary on the
  // Master Lookup side does).

  function el(id){ return document.getElementById(id); }
  function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function itlStatus(msg){ const s=el('itlStatus'); if(s) s.textContent=msg; }

  let mode='detail'; // 'detail' | 'summary'
  let lastDetailRows=[];
  let lastSummaryRows=[];

  const fieldOrder=['transactionDate','transactionType','lwhId','itemNm','itemDesc','qty','billToRef','subCustNm','customerId','lotNum','location','invReceipt','madeFrom','unique2'];
  const labels={transactionDate:'Date',transactionType:'Type',lwhId:'LWH ID',itemNm:'Item #',itemDesc:'Item Description',qty:'Qty',billToRef:'Bill-to-Ref',subCustNm:'Customer',customerId:'Customer ID',lotNum:'Lot #',location:'Location',invReceipt:'INV Receipt',madeFrom:'Made From',unique2:'Unique2'};
  // Every field on the row is searchable via the Smart Search box — this is
  // deliberately the full row, not a curated subset, per the request to make
  // "all of them" (BillToRef, type, INV Receipt, etc.) searchable.
  const searchableFields=['billToRef','itemNm','lwhId','subCustNm','lotNum','invReceipt','madeFrom','itemDesc','customerId','transactionType','location','transactionDate','unique2'];

  function hasValue(v){ return v!==null && v!==undefined && String(v).trim()!==''; }

  function renderWarehouseOptions(rows){
    const sel=el('itlWarehouse'); if(!sel) return;
    const current=sel.value;
    const warehouses=[...new Set(rows.map(r=>r.location).filter(Boolean))].sort();
    sel.innerHTML='<option value="__all__">All Warehouses</option>'+warehouses.map(w=>`<option value="${safe(w)}">${safe(w)}</option>`).join('');
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
    if(!rows.length){
      el('itlResults').innerHTML='<div class="card">Transaction history not loaded yet — click Load / Refresh Data, or run a search to load it automatically.</div>';
      return;
    }
    const f=currentFilters();
    const filtered=filterRows(rows, f);
    if(mode==='summary') renderSummary(filtered); else renderDetail(filtered);
  }

  function renderDetail(list){
    lastDetailRows=list.slice().sort((a,b)=>(b.transactionDate||'').localeCompare(a.transactionDate||'')).slice(0,1000);
    lastSummaryRows=[];
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
    // for horizontal scroll on mobile, matching Daily Activity's pattern —
    // 14 columns won't fit a phone width otherwise.
    const scrollWrap=document.createElement('div'); scrollWrap.style.cssText='margin-top:10px;overflow-x:auto';
    const table=document.createElement('table'); table.className='pls-table';
    table.innerHTML='<thead><tr>'+fieldOrder.map(k=>`<th>${safe(labels[k])}</th>`).join('')+'</tr></thead>';
    const tbody=document.createElement('tbody');
    lastDetailRows.forEach(r=>{
      const tr=document.createElement('tr');
      tr.innerHTML=fieldOrder.map(k=>`<td>${hasValue(r[k])?safe(r[k]):''}</td>`).join('');
      tbody.append(tr);
    });
    table.append(tbody);
    scrollWrap.append(table);
    out.append(scrollWrap);
  }

  function buildSummary(list){
    const groups={};
    list.forEach(r=>{
      const key=r.itemNm||'(no item #)';
      if(!groups[key]) groups[key]={itemNm:key, itemDesc:r.itemDesc||'', locations:new Set(), totalPallets:0, totalQty:0, inPallets:0, inQty:0, outPallets:0, outQty:0};
      const g=groups[key];
      if(!g.itemDesc && r.itemDesc) g.itemDesc=r.itemDesc;
      if(r.location) g.locations.add(r.location);
      const qty=parseFloat(r.qty)||0;
      g.totalPallets++; g.totalQty+=qty;
      if(r.transactionType==='Inbound'){ g.inPallets++; g.inQty+=qty; } else { g.outPallets++; g.outQty+=qty; }
    });
    return Object.values(groups).sort((a,b)=>b.totalPallets-a.totalPallets);
  }

  function renderSummary(list){
    lastSummaryRows=buildSummary(list);
    lastDetailRows=[];
    const out=el('itlResults'); if(!out) return;
    out.innerHTML='';
    if(!lastSummaryRows.length){ out.innerHTML='<div class="card">No matching transactions found.</div>'; return; }

    const grandPallets=lastSummaryRows.reduce((s,g)=>s+g.totalPallets,0);
    const grandQty=lastSummaryRows.reduce((s,g)=>s+g.totalQty,0);
    const top=document.createElement('div'); top.className='card';
    top.innerHTML=`<b>${lastSummaryRows.length}</b> item(s) · <b>${grandPallets.toLocaleString()}</b> total pallet(s) · <b>${grandQty.toLocaleString()}</b> total qty`;
    out.append(top);

    const scrollWrap=document.createElement('div'); scrollWrap.style.cssText='margin-top:10px;overflow-x:auto';
    const table=document.createElement('table'); table.className='pls-table';
    table.innerHTML='<thead><tr><th>Item #</th><th>Description</th><th>Location(s)</th><th>Total Pallets</th><th>Total Qty</th><th>Inbound Pallets</th><th>Inbound Qty</th><th>Outbound Pallets</th><th>Outbound Qty</th></tr></thead>';
    const tbody=document.createElement('tbody');
    lastSummaryRows.forEach(g=>{
      const tr=document.createElement('tr');
      const locs=[...g.locations].sort().join(', ')||'—';
      tr.innerHTML=`<td>${safe(g.itemNm)}</td><td>${safe(g.itemDesc)}</td><td>${safe(locs)}</td><td>${g.totalPallets.toLocaleString()}</td><td>${g.totalQty.toLocaleString()}</td><td>${g.inPallets.toLocaleString()}</td><td>${g.inQty.toLocaleString()}</td><td>${g.outPallets.toLocaleString()}</td><td>${g.outQty.toLocaleString()}</td>`;
      tbody.append(tr);
    });
    table.append(tbody);
    scrollWrap.append(table);
    out.append(scrollWrap);
  }

  function csvEscape(v){ const s=String(v??''); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }

  function exportCsv(){
    if(mode==='summary'){
      if(!lastSummaryRows.length){ LWHUI.toast('No results to export — run a search first'); return; }
      const header=['Item #','Description','Location(s)','Total Pallets','Total Qty','Inbound Pallets','Inbound Qty','Outbound Pallets','Outbound Qty'];
      const rows=lastSummaryRows.map(g=>[g.itemNm,g.itemDesc,[...g.locations].sort().join(', '),g.totalPallets,g.totalQty,g.inPallets,g.inQty,g.outPallets,g.outQty].map(csvEscape));
      const csv=[header.join(','),...rows.map(r=>r.join(','))].join('\r\n');
      downloadCsv(csv,'item-transaction-summary');
      LWHUI.toast(`Exported ${lastSummaryRows.length} item row(s) to CSV`);
    } else {
      if(!lastDetailRows.length){ LWHUI.toast('No results to export — run a search first'); return; }
      const header=fieldOrder.map(k=>labels[k]);
      const rows=lastDetailRows.map(r=>fieldOrder.map(k=>csvEscape(r[k])));
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
      if(!lastSummaryRows.length){ out.innerHTML=''; LWHUI.toast('No results to print — run a search first'); return; }
      const header=['Item #','Description','Location(s)','Total Pallets','Total Qty','Inbound Pallets','Inbound Qty','Outbound Pallets','Outbound Qty'].map(h=>`<th>${h}</th>`).join('');
      const rows=lastSummaryRows.map(g=>`<tr><td>${safe(g.itemNm)}</td><td>${safe(g.itemDesc)}</td><td>${safe([...g.locations].sort().join(', ')||'—')}</td><td>${g.totalPallets.toLocaleString()}</td><td>${g.totalQty.toLocaleString()}</td><td>${g.inPallets.toLocaleString()}</td><td>${g.inQty.toLocaleString()}</td><td>${g.outPallets.toLocaleString()}</td><td>${g.outQty.toLocaleString()}</td></tr>`).join('');
      out.innerHTML=`<h2>Item Transaction Summary — ${lastSummaryRows.length} item(s)</h2><table class="txn-print-table"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
    } else {
      if(!lastDetailRows.length){ out.innerHTML=''; LWHUI.toast('No results to print — run a search first'); return; }
      const header=fieldOrder.map(k=>`<th>${safe(labels[k])}</th>`).join('');
      const rows=lastDetailRows.map(r=>`<tr>${fieldOrder.map(k=>`<td>${safe(r[k])}</td>`).join('')}</tr>`).join('');
      out.innerHTML=`<h2>Item Transaction Detail — ${lastDetailRows.length} result(s)</h2><table class="txn-print-table"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    setTimeout(()=>print(),100);
  }

  function clearAll(){
    if(el('itlSearch')) el('itlSearch').value='';
    if(el('itlItem')) el('itlItem').value='';
    if(el('itlWarehouse')) el('itlWarehouse').value='__all__';
    if(el('itlFrom')) el('itlFrom').value='';
    if(el('itlTo')) el('itlTo').value='';
    lastDetailRows=[]; lastSummaryRows=[];
    const out=el('itlResults'); if(out) out.innerHTML='';
    const printOut=el('itlPrintTable'); if(printOut) printOut.innerHTML='';
  }

  window.LWHItemTxnLookup={runSearch,setMode,exportCsv,renderPrintTable,clearAll};

  window.addEventListener('load',()=>{
    if(!el('itemTxnLookup')) return;

    document.querySelectorAll('[data-itl-view]').forEach(b=>{
      b.addEventListener('click',()=>setMode(b.dataset.itlView));
    });

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
