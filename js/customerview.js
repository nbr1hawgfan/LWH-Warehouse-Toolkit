// Customer View — the mirror image of Location Overview. Pick a customer
// instead of a warehouse; see their pallet count and qty broken out by
// warehouse instead of by customer. Same customerRows dataset, same
// pattern, just the two axes swapped.
(function(){
  function el(id){ return document.getElementById(id); }
  function safe(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  let currentCustomer = '', currentWarehouse = '', currentDetailRows = [];

  function allRows(){ return (window.LWHInventory && LWHInventory.getAllRows) ? LWHInventory.getAllRows() : []; }

  // Hooked from inventory.js's customerStatus() — same single choke point
  // every data-load path already runs through — so this stays current
  // automatically, same as Location Overview's warehouse dropdown.
  function populateCustomers(){
    const sel = el('cvCustomerSelect'); if(!sel) return;
    const rows = allRows();
    if(!rows.length){ sel.innerHTML = '<option value="">Loading inventory…</option>'; return; }
    const set = new Set();
    rows.forEach(r => { const c = String(r.subCustNm||'').trim(); if(c) set.add(c); });
    const list = [...set].sort();
    const prev = sel.value;
    sel.innerHTML = '<option value="">Select a customer…</option>' + list.map(c => `<option value="${safe(c)}">${safe(c)}</option>`).join('');
    if(prev && list.includes(prev)) sel.value = prev;
  }

  function renderSummary(){
    const sel = el('cvCustomerSelect'); if(!sel) return;
    currentCustomer = sel.value;
    el('cvCustomerName').textContent = currentCustomer ? `— ${currentCustomer}` : '';
    hideDetail();
    const out = el('cvLocationSummary');
    if(!currentCustomer){ out.innerHTML = '<p class="hint">Select a customer above.</p>'; return; }
    const rows = allRows().filter(r => (r.subCustNm||'—') === currentCustomer);
    if(!rows.length){ out.innerHTML = '<p class="hint">No inventory found for this customer.</p>'; return; }
    const groups = {};
    rows.forEach(r => {
      const wh = r.warehouse || '—';
      if(!groups[wh]) groups[wh] = { warehouse:wh, pallets:0, totalQty:0 };
      groups[wh].pallets++;
      groups[wh].totalQty += parseFloat(r.qty)||0;
    });
    const totals = Object.values(groups).sort((a,b)=>b.pallets-a.pallets);
    const trs = totals.map(t => `<tr data-cv-warehouse="${safe(t.warehouse)}" style="cursor:pointer"><td>${safe(t.warehouse)}</td><td>${t.pallets.toLocaleString()}</td><td>${t.totalQty.toLocaleString()}</td></tr>`).join('');
    out.innerHTML = `<table class="pls-table"><thead><tr><th>Location</th><th>Pallets</th><th>Total Qty</th></tr></thead><tbody>${trs}</tbody></table><p class="hint" style="margin-top:8px">Click a location to see the full inventory there.</p>`;
  }

  const detailFields = [
    { k:'controlNumber', l:'LWH ID' }, { k:'invReceipt', l:'INV Receipt' },
    { k:'itemNm', l:'Item #' }, { k:'itemDesc', l:'Description' },
    { k:'lotNum', l:'Lot #' }, { k:'qty', l:'Qty' },
    { k:'currentBay', l:'Bay' }, { k:'location', l:'Location' },
    { k:'comments', l:'Comments' }, { k:'vendor', l:'Vendor' }
  ];
  function fieldVal(r,k){ return k==='currentBay' ? (r.currentBay||r.bayName||'') : (r[k]||''); }

  function renderDetail(warehouse){
    currentWarehouse = warehouse;
    currentDetailRows = allRows().filter(r => (r.subCustNm||'—')===currentCustomer && String(r.warehouse||'').trim()===warehouse);
    el('cvLocationName').textContent = warehouse;
    const card = el('cvDetailCard'); card.hidden = false;
    const out = el('cvLocationDetail');
    if(!currentDetailRows.length){ out.innerHTML = '<p class="hint">No inventory rows found.</p>'; return; }
    const totalQty = currentDetailRows.reduce((s,r)=>s+(parseFloat(r.qty)||0),0);
    const head = detailFields.map(f=>`<th>${f.l}</th>`).join('');
    const trs = currentDetailRows.map(r => `<tr>${detailFields.map(f=>`<td>${safe(fieldVal(r,f.k))}</td>`).join('')}</tr>`).join('');
    out.innerHTML = `<div class="hint" style="margin-bottom:8px"><b>${currentDetailRows.length}</b> pallet(s) · <b>${totalQty.toLocaleString()}</b> total qty</div>`+
      `<table class="pls-table"><thead><tr>${head}</tr></thead><tbody>${trs}</tbody></table>`;
    card.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }

  function hideDetail(){
    const card = el('cvDetailCard'); if(card) card.hidden = true;
    currentWarehouse = ''; currentDetailRows = [];
  }

  function csvEscape(v){
    const s = String(v??'');
    return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  }

  function exportCsv(){
    if(!currentDetailRows.length){ LWHUI.toast('No inventory to export — click a location first'); return; }
    const header = detailFields.map(f=>f.l);
    const rows = currentDetailRows.map(r => detailFields.map(f=>csvEscape(fieldVal(r,f.k))));
    const csv = [header.join(','), ...rows.map(r=>r.join(','))].join('\r\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0,10);
    const slug = (s) => String(s).replace(/[^a-z0-9]+/gi,'-').toLowerCase();
    a.href = url; a.download = `${slug(currentCustomer)}-${slug(currentWarehouse)}-inventory-${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    LWHUI.toast(`Exported ${currentDetailRows.length} row(s) to CSV`);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const sel = el('cvCustomerSelect'); if(sel) sel.onchange = renderSummary;
    const sumOut = el('cvLocationSummary');
    if(sumOut) sumOut.addEventListener('click', e => {
      const tr = e.target.closest('[data-cv-warehouse]'); if(!tr) return;
      renderDetail(tr.dataset.cvWarehouse);
    });
    const closeBtn = el('cvCloseDetail'); if(closeBtn) closeBtn.onclick = hideDetail;
    const expBtn = el('cvExportCsv'); if(expBtn) expBtn.onclick = exportCsv;
    populateCustomers(); // in case inventory is already cached-and-loaded before this fires
  });

  window.LWHCustomerView = { populateCustomers, renderSummary };
})();
