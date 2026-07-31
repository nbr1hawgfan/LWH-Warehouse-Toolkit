(function(){
  function el(id){ return document.getElementById(id); }
  function safe(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  let lastAggregate=[];

  function formatDate(iso){
    const d=new Date(iso+'T00:00:00');
    if(isNaN(d)) return iso;
    return d.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
  }

  function filterRows(rows, warehouse, from, to){
    return rows.filter(r=>{
      if(!r.transactionDate) return false;
      if(warehouse && warehouse!=='__all__' && r.location!==warehouse) return false;
      if(from && r.transactionDate<from) return false;
      if(to && r.transactionDate>to) return false;
      return true;
    });
  }

  function buildDayGroups(filtered){
    const byDate={};
    filtered.forEach(r=>{
      const date=r.transactionDate;
      if(!byDate[date]) byDate[date]={date, inPallets:0, inQty:0, outPallets:0, outQty:0, items:{}};
      const g=byDate[date];
      const qty=parseFloat(r.qty)||0;
      if(r.transactionType==='Inbound'){ g.inPallets++; g.inQty+=qty; } else { g.outPallets++; g.outQty+=qty; }
      // Inbound and Outbound get their own line, and Bill-to-Ref is part of
      // the grouping key — billing needs those kept separate, not blended.
      const type=r.transactionType==='Inbound'?'Inbound':'Outbound';
      const billToRef=r.billToRef||'—';
      const key=type+'|'+(r.itemNm||'(no item #)')+'|'+(r.subCustNm||'—')+'|'+billToRef;
      if(!g.items[key]) g.items[key]={type, item:r.itemNm||'(no item #)',customer:r.subCustNm||'—',billToRef,qty:0,pallets:0};
      g.items[key].qty+=qty; g.items[key].pallets++;
    });
    return Object.values(byDate).sort((a,b)=>b.date.localeCompare(a.date));
  }

  function buildAggregateItems(filtered){
    const items={};
    filtered.forEach(r=>{
      const qty=parseFloat(r.qty)||0;
      const type=r.transactionType==='Inbound'?'Inbound':'Outbound';
      const billToRef=r.billToRef||'—';
      const key=type+'|'+(r.itemNm||'(no item #)')+'|'+(r.subCustNm||'—')+'|'+billToRef;
      if(!items[key]) items[key]={type, item:r.itemNm||'(no item #)',customer:r.subCustNm||'—',billToRef,pallets:0,qty:0};
      items[key].qty+=qty; items[key].pallets++;
    });
    // Inbound lines first (matches how the day cards lead with Inbound), then by qty descending within each.
    return Object.values(items).sort((a,b)=> a.type!==b.type ? (a.type==='Inbound'?-1:1) : b.qty-a.qty);
  }

  function renderWarehouseOptions(rows){
    const sel=el('daWarehouse'); if(!sel) return;
    const current=sel.value;
    const warehouses=[...new Set(rows.map(r=>r.location).filter(Boolean))].sort();
    sel.innerHTML='<option value="__all__">All Warehouses</option>'+warehouses.map(w=>`<option value="${safe(w)}">${safe(w)}</option>`).join('');
    if(warehouses.includes(current)) sel.value=current;
  }

  function renderDays(){
    const out=el('daResults'); if(!out) return;
    const rows=window.LWHTransactions?LWHTransactions.getAllTransactions():[];
    if(!rows.length){ out.innerHTML='<div class="card">No transaction history loaded yet — click Load / Refresh.</div>'; lastAggregate=[]; return; }
    renderWarehouseOptions(rows);
    const warehouse=(el('daWarehouse')||{}).value||'__all__';
    const from=(el('daFrom')||{}).value||'';
    const to=(el('daTo')||{}).value||'';
    const filtered=filterRows(rows, warehouse, from, to);
    const days=buildDayGroups(filtered);
    const aggregate=buildAggregateItems(filtered);
    lastAggregate=aggregate;

    if(!filtered.length){ out.innerHTML='<div class="card">No activity found for that warehouse/date range.</div>'; return; }

    const grandInPallets=filtered.filter(r=>r.transactionType==='Inbound').length;
    const grandOutPallets=filtered.length-grandInPallets;
    const grandInQty=filtered.filter(r=>r.transactionType==='Inbound').reduce((s,r)=>s+(parseFloat(r.qty)||0),0);
    const grandOutQty=filtered.filter(r=>r.transactionType!=='Inbound').reduce((s,r)=>s+(parseFloat(r.qty)||0),0);

    const rangeLabel=(from||to)?` — ${from||'start'} to ${to||'today'}`:' — last 90 days';
    const aggRows=aggregate.map(i=>`<tr><td>${safe(i.type)}</td><td>${safe(i.item)}</td><td>${safe(i.customer)}</td><td>${safe(i.billToRef)}</td><td>${i.pallets.toLocaleString()}</td><td>${i.qty.toLocaleString()}</td></tr>`).join('');

    let html=`<div class="card" style="margin-bottom:10px">
      <b>Totals${rangeLabel}${warehouse!=='__all__'?' — '+safe(warehouse):''}</b>
      <div class="grid-2" style="margin-top:8px">
        <div class="card" style="text-align:center;background:var(--bg)"><div class="hint">Inbound</div><div style="font-size:1.4em;font-weight:900;color:var(--brand)">${grandInPallets.toLocaleString()} plt</div><div class="hint">${grandInQty.toLocaleString()} qty</div></div>
        <div class="card" style="text-align:center;background:var(--bg)"><div class="hint">Outbound</div><div style="font-size:1.4em;font-weight:900;color:var(--brand)">${grandOutPallets.toLocaleString()} plt</div><div class="hint">${grandOutQty.toLocaleString()} qty</div></div>
      </div>
      <div style="margin-top:12px;overflow-x:auto"><table class="pls-table"><thead><tr><th>Type</th><th>Item #</th><th>Customer</th><th>Bill-to-Ref</th><th>Pallets</th><th>Qty</th></tr></thead><tbody>${aggRows}</tbody></table></div>
    </div>`;

    html+=days.map(g=>{
      const allItems=Object.values(g.items).sort((a,b)=> a.type!==b.type ? (a.type==='Inbound'?-1:1) : b.qty-a.qty)
        .map(d=>`<tr><td>${safe(d.type)}</td><td>${safe(d.item)}</td><td>${safe(d.customer)}</td><td>${safe(d.billToRef)}</td><td>${d.pallets.toLocaleString()}</td><td>${d.qty.toLocaleString()}</td></tr>`).join('');
      return `<div class="card" style="margin-bottom:10px">
        <b>${safe(formatDate(g.date))}</b>
        <div class="grid-2" style="margin-top:8px">
          <div class="card" style="text-align:center;background:var(--bg)"><div class="hint">Inbound</div><div style="font-size:1.4em;font-weight:900;color:var(--brand)">${g.inPallets.toLocaleString()} plt</div><div class="hint">${g.inQty.toLocaleString()} qty</div></div>
          <div class="card" style="text-align:center;background:var(--bg)"><div class="hint">Outbound</div><div style="font-size:1.4em;font-weight:900;color:var(--brand)">${g.outPallets.toLocaleString()} plt</div><div class="hint">${g.outQty.toLocaleString()} qty</div></div>
        </div>
        <details style="margin-top:8px"><summary>All items that day (${Object.keys(g.items).length})</summary><table class="pls-table" style="margin-top:6px"><thead><tr><th>Type</th><th>Item #</th><th>Customer</th><th>Bill-to-Ref</th><th>Pallets</th><th>Qty</th></tr></thead><tbody>${allItems}</tbody></table></details>
      </div>`;
    }).join('');

    out.innerHTML=html;
  }

  function csvEscape(v){
    const s=String(v??'');
    return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  }

  function exportCsv(){
    if(!lastAggregate.length){ LWHUI.toast('No results to export — load data and pick a filter first'); return; }
    const header=['Type','Item #','Customer','Bill-to-Ref','Pallets','Qty'];
    const rows=lastAggregate.map(i=>[i.type,i.item,i.customer,i.billToRef,i.pallets,i.qty].map(csvEscape));
    const csv=[header.join(','), ...rows.map(r=>r.join(','))].join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const stamp=new Date().toISOString().slice(0,10);
    a.href=url; a.download=`daily-activity-item-totals-${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    LWHUI.toast(`Exported ${lastAggregate.length} row(s) to CSV`);
  }

  function renderPrintTable(){
    const out=el('daPrintTable'); if(!out) return;
    if(!lastAggregate.length){ out.innerHTML=''; LWHUI.toast('No results to print — load data and pick a filter first'); return; }
    const warehouse=(el('daWarehouse')||{}).value||'__all__';
    const from=(el('daFrom')||{}).value||'';
    const to=(el('daTo')||{}).value||'';
    const rangeLabel=(from||to)?`${from||'start'} to ${to||'today'}`:'last 90 days';
    const header=['Type','Item #','Customer','Bill-to-Ref','Pallets','Qty'].map(h=>`<th>${h}</th>`).join('');
    const rows=lastAggregate.map(i=>`<tr><td>${safe(i.type)}</td><td>${safe(i.item)}</td><td>${safe(i.customer)}</td><td>${safe(i.billToRef)}</td><td>${i.pallets.toLocaleString()}</td><td>${i.qty.toLocaleString()}</td></tr>`).join('');
    out.innerHTML=`
      <h2>Daily Activity Item Totals — ${rangeLabel}${warehouse!=='__all__'?' — '+safe(warehouse):''}</h2>
      <table class="txn-print-table">
        <thead><tr>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    setTimeout(()=>print(),100);
  }

  window.addEventListener('load',()=>{
    if(!el('daWarehouse')) return;
    daWarehouse.addEventListener('change',renderDays);
    if(window.daFrom) daFrom.addEventListener('change',renderDays);
    if(window.daTo) daTo.addEventListener('change',renderDays);
    if(window.daClearRange) daClearRange.onclick=()=>{ daFrom.value=''; daTo.value=''; renderDays(); };
    if(window.daLoadBtn) daLoadBtn.onclick=async()=>{
      await LWHTransactions.loadTransactions(true);
      renderDays();
      if(window.LWHUI) LWHUI.toast('Daily activity refreshed');
    };
    if(window.daCsvBtn) daCsvBtn.onclick=exportCsv;
    if(window.daPrintBtn) daPrintBtn.onclick=renderPrintTable;
    // Lazy-load the first time this tab is actually opened, matching the
    // Transaction History tab's approach — no reason to pull 60K+ rows on
    // every app launch if nobody visits this screen that day.
    let loadedOnce=false;
    document.addEventListener('click',e=>{
      if(e.target.closest('[data-view="dailyActivity"]') && !loadedOnce){
        loadedOnce=true;
        LWHTransactions.loadTransactions(false).then(renderDays);
      }
    });
  });
})();

