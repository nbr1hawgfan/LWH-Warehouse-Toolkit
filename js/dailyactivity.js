(function(){
  function el(id){ return document.getElementById(id); }
  function safe(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  function formatDate(iso){
    const d=new Date(iso+'T00:00:00');
    if(isNaN(d)) return iso;
    return d.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
  }

  function buildDayGroups(rows, warehouse){
    const filtered=warehouse && warehouse!=='__all__' ? rows.filter(r=>r.location===warehouse) : rows;
    const byDate={};
    filtered.forEach(r=>{
      const date=r.transactionDate; if(!date) return;
      if(!byDate[date]) byDate[date]={date, inPallets:0, inQty:0, outPallets:0, outQty:0, items:{}};
      const g=byDate[date];
      const qty=parseFloat(r.qty)||0;
      if(r.transactionType==='Inbound'){ g.inPallets++; g.inQty+=qty; } else { g.outPallets++; g.outQty+=qty; }
      const key=r.itemNm||'(no item #)';
      if(!g.items[key]) g.items[key]={qty:0,pallets:0};
      g.items[key].qty+=qty; g.items[key].pallets++;
    });
    return Object.values(byDate).sort((a,b)=>b.date.localeCompare(a.date));
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
    if(!rows.length){ out.innerHTML='<div class="card">No transaction history loaded yet — click Load / Refresh.</div>'; return; }
    renderWarehouseOptions(rows);
    const warehouse=(el('daWarehouse')||{}).value||'__all__';
    const days=buildDayGroups(rows, warehouse);
    if(!days.length){ out.innerHTML='<div class="card">No activity found for that warehouse in the current 90-day window.</div>'; return; }

    out.innerHTML=days.map(g=>{
      const topItems=Object.entries(g.items).sort((a,b)=>b[1].qty-a[1].qty).slice(0,5)
        .map(([item,d])=>`<tr><td>${safe(item)}</td><td>${d.pallets.toLocaleString()}</td><td>${d.qty.toLocaleString()}</td></tr>`).join('');
      return `<div class="card" style="margin-bottom:10px">
        <b>${safe(formatDate(g.date))}</b>
        <div class="grid-2" style="margin-top:8px">
          <div class="card" style="text-align:center;background:var(--bg)"><div class="hint">Inbound</div><div style="font-size:1.4em;font-weight:900;color:var(--brand)">${g.inPallets.toLocaleString()} plt</div><div class="hint">${g.inQty.toLocaleString()} qty</div></div>
          <div class="card" style="text-align:center;background:var(--bg)"><div class="hint">Outbound</div><div style="font-size:1.4em;font-weight:900;color:var(--brand)">${g.outPallets.toLocaleString()} plt</div><div class="hint">${g.outQty.toLocaleString()} qty</div></div>
        </div>
        <details style="margin-top:8px"><summary>Top items that day</summary><table class="pls-table" style="margin-top:6px"><thead><tr><th>Item #</th><th>Pallets</th><th>Qty</th></tr></thead><tbody>${topItems}</tbody></table></details>
      </div>`;
    }).join('');
  }

  window.addEventListener('load',()=>{
    if(!el('daWarehouse')) return;
    daWarehouse.addEventListener('change',renderDays);
    if(window.daLoadBtn) daLoadBtn.onclick=async()=>{
      await LWHTransactions.loadTransactions(true);
      renderDays();
      if(window.LWHUI) LWHUI.toast('Daily activity refreshed');
    };
    // Lazy-load the first time this tab is actually opened, matching the
    // Transaction History tab's approach — no reason to pull 60K+ rows on
    // every app launch if nobody visits this screen that day.
    const navBtn=document.querySelector('[data-view="dailyActivity"]');
    let loadedOnce=false;
    document.addEventListener('click',e=>{
      if(e.target.closest('[data-view="dailyActivity"]') && !loadedOnce){
        loadedOnce=true;
        LWHTransactions.loadTransactions(false).then(renderDays);
      }
    });
  });
})();
