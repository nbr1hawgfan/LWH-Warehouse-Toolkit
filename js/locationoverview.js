// Location Overview — pick a warehouse, see every customer stored there
// with their pallet count and total qty, click a customer to pull up
// their full inventory, export that table to CSV. Reuses the same
// customerRows dataset that Master Lookup and Home's "Inventory by
// Customer" already load — no separate data source, no separate refresh.
(function(){
  function el(id){ return document.getElementById(id); }
  function safe(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  let currentWarehouse = '', currentCustomer = '', currentCustomerRows = [];

  function allRows(){ return (window.LWHInventory && LWHInventory.getAllRows) ? LWHInventory.getAllRows() : []; }

  // Hooked from inventory.js's customerStatus() — the single choke point
  // every data-load path (auto-load, manual refresh, paste, cached-on-open)
  // already runs through — so this dropdown stays current automatically.
  function populateWarehouses(){
    const sel = el('loWarehouseSelect'); if(!sel) return;
    const rows = allRows();
    if(!rows.length){ sel.innerHTML = '<option value="">Loading inventory…</option>'; return; }
    const set = new Set();
    rows.forEach(r => { const w = String(r.warehouse||'').trim(); if(w) set.add(w); });
    const list = [...set].sort();
    const prev = sel.value;
    sel.innerHTML = '<option value="">Select a warehouse…</option>' + list.map(w => `<option value="${safe(w)}">${safe(w)}</option>`).join('');
    if(prev && list.includes(prev)) sel.value = prev;
  }

  function renderSummary(){
    const sel = el('loWarehouseSelect'); if(!sel) return;
    currentWarehouse = sel.value;
    el('loWarehouseName').textContent = currentWarehouse ? `— ${currentWarehouse}` : '';
    hideDetail();
    const out = el('loCustomerSummary');
    if(!currentWarehouse){ out.innerHTML = '<p class="hint">Select a warehouse above.</p>'; return; }
    const rows = allRows().filter(r => String(r.warehouse||'').trim() === currentWarehouse);
    if(!rows.length){ out.innerHTML = '<p class="hint">No inventory found for this warehouse.</p>'; return; }
    const groups = {};
    rows.forEach(r => {
      const name = r.subCustNm || '—';
      if(!groups[name]) groups[name] = { customer:name, pallets:0, totalQty:0 };
      groups[name].pallets++;
      groups[name].totalQty += parseFloat(r.qty)||0;
    });
    const totals = Object.values(groups).sort((a,b)=>b.pallets-a.pallets);
    const trs = totals.map(t => `<tr data-lo-customer="${safe(t.customer)}" style="cursor:pointer"><td>${safe(t.customer)}</td><td>${t.pallets.toLocaleString()}</td><td>${t.totalQty.toLocaleString()}</td></tr>`).join('');
    out.innerHTML = `<table class="pls-table"><thead><tr><th>Customer</th><th>Pallets</th><th>Total Qty</th></tr></thead><tbody>${trs}</tbody></table><p class="hint" style="margin-top:8px">Click a customer to see their full inventory.</p>`;
  }

  const detailFields = [
    { k:'controlNumber', l:'LWH ID' }, { k:'invReceipt', l:'INV Receipt' },
    { k:'itemNm', l:'Item #' }, { k:'itemDesc', l:'Description' },
    { k:'lotNum', l:'Lot #' }, { k:'qty', l:'Qty' },
    { k:'currentBay', l:'Bay' }, { k:'location', l:'Location' },
    { k:'comments', l:'Comments' }, { k:'vendor', l:'Vendor' }
  ];
  function fieldVal(r,k){ return k==='currentBay' ? (r.currentBay||r.bayName||'') : (r[k]||''); }

  function renderDetail(customer){
    currentCustomer = customer;
    currentCustomerRows = allRows().filter(r => String(r.warehouse||'').trim()===currentWarehouse && (r.subCustNm||'—')===customer);
    el('loCustomerName').textContent = customer;
    const card = el('loDetailCard'); card.hidden = false;
    const out = el('loCustomerDetail');
    if(!currentCustomerRows.length){ out.innerHTML = '<p class="hint">No inventory rows found.</p>'; return; }
    const totalQty = currentCustomerRows.reduce((s,r)=>s+(parseFloat(r.qty)||0),0);
    const head = detailFields.map(f=>`<th>${f.l}</th>`).join('');
    const trs = currentCustomerRows.map(r => `<tr>${detailFields.map(f=>`<td>${safe(fieldVal(r,f.k))}</td>`).join('')}</tr>`).join('');
    out.innerHTML = `<div class="hint" style="margin-bottom:8px"><b>${currentCustomerRows.length}</b> pallet(s) · <b>${totalQty.toLocaleString()}</b> total qty</div>`+
      `<table class="pls-table"><thead><tr>${head}</tr></thead><tbody>${trs}</tbody></table>`;
    card.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }

  function hideDetail(){
    const card = el('loDetailCard'); if(card) card.hidden = true;
    currentCustomer = ''; currentCustomerRows = [];
  }

  function csvEscape(v){
    const s = String(v??'');
    return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  }

  function exportCsv(){
    if(!currentCustomerRows.length){ LWHUI.toast('No inventory to export — click a customer first'); return; }
    const header = detailFields.map(f=>f.l);
    const rows = currentCustomerRows.map(r => detailFields.map(f=>csvEscape(fieldVal(r,f.k))));
    const csv = [header.join(','), ...rows.map(r=>r.join(','))].join('\r\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0,10);
    const slug = (s) => String(s).replace(/[^a-z0-9]+/gi,'-').toLowerCase();
    a.href = url; a.download = `${slug(currentWarehouse)}-${slug(currentCustomer)}-inventory-${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    LWHUI.toast(`Exported ${currentCustomerRows.length} row(s) to CSV`);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const sel = el('loWarehouseSelect'); if(sel) sel.onchange = renderSummary;
    const sumOut = el('loCustomerSummary');
    if(sumOut) sumOut.addEventListener('click', e => {
      const tr = e.target.closest('[data-lo-customer]'); if(!tr) return;
      renderDetail(tr.dataset.loCustomer);
    });
    const closeBtn = el('loCloseDetail'); if(closeBtn) closeBtn.onclick = hideDetail;
    const expBtn = el('loExportCsv'); if(expBtn) expBtn.onclick = exportCsv;
    populateWarehouses(); // in case inventory is already cached-and-loaded before this fires
  });

  window.LWHLocationOverview = { populateWarehouses, renderSummary };
})();
