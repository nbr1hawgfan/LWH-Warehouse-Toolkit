(function(){
  function el(id){ return document.getElementById(id); }
  function safe(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function cleanVal(v){ const s=String(v??'').trim(); return (!s||/^null$/i.test(s))?'':s; }

  // Same comma-separated multi-value filter pattern as Pick List, so anyone
  // who already knows that screen already knows how this one works.
  function tokens(v){ return String(v||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean); }
  function matchesAny(value,toks){ if(!toks.length) return true; const v=String(value||'').toLowerCase(); return toks.some(t=>v.includes(t)); }

  function toRow(r){
    return {
      lwhid:cleanVal(r.controlNumber), customer:cleanVal(r.subCustNm), item:cleanVal(r.itemNm),
      itemDesc:cleanVal(r.itemDesc), lot:cleanVal(r.lotNum), qty:cleanVal(r.qty),
      warehouse:cleanVal(r.warehouse), bay:cleanVal(r.currentBay||r.bayName)
    };
  }

  function doSearch(){
    const custToks=tokens(el('bcCustomer').value);
    const itemToks=tokens(el('bcItem').value);
    const lotToks=tokens(el('bcLot').value);
    const bayToks=tokens(el('bcBay').value);
    const whToks=tokens(el('bcWarehouse').value);
    const status=el('bcStatus');
    if(!custToks.length && !itemToks.length && !lotToks.length && !bayToks.length && !whToks.length){
      status.textContent='Enter at least one filter to search.';
      el('bcResults').innerHTML='';
      return [];
    }
    if(!window.LWHInventory || !LWHInventory.getAllRows){ status.textContent='Inventory data not available yet.'; return []; }
    const rows=LWHInventory.getAllRows();
    const matches=rows.filter(r=>{
      if(!matchesAny(r.subCustNm,custToks)) return false;
      if(!matchesAny(r.itemNm,itemToks)) return false;
      if(!matchesAny(r.lotNum,lotToks)) return false;
      if(!matchesAny(r.currentBay||r.bayName,bayToks)) return false;
      if(!matchesAny(r.warehouse,whToks)) return false;
      return true;
    }).map(toRow);
    render(matches);
    return matches;
  }

  let lastResults=[];

  function render(list){
    lastResults=list;
    const out=el('bcResults'), status=el('bcStatus');
    status.textContent=`${list.length} matching row(s).`;
    if(!out) return;
    if(!list.length){ out.innerHTML='<div class="card">No matching inventory found.</div>'; return; }

    const totalQty=list.reduce((s,r)=>s+(parseFloat(r.qty)||0),0);
    const totalPallets=list.length;
    const bays=[...new Set(list.map(r=>r.bay).filter(Boolean))];

    // By-item breakdown, matching the Item Summary panel's shape.
    const byItem={};
    list.forEach(r=>{
      const key=r.item||'(no item #)';
      if(!byItem[key]) byItem[key]={desc:r.itemDesc,pallets:0,qty:0};
      byItem[key].pallets++;
      byItem[key].qty+=parseFloat(r.qty)||0;
    });
    const itemRows=Object.entries(byItem).sort((a,b)=>b[1].pallets-a[1].pallets)
      .map(([item,d])=>`<tr><td>${safe(item)}</td><td>${safe(d.desc)}</td><td>${d.pallets.toLocaleString()}</td><td>${d.qty.toLocaleString()}</td></tr>`).join('');

    const header=`<div class="card"><b>${totalPallets.toLocaleString()}</b> pallet(s) · <b>${totalQty.toLocaleString()}</b> total qty · ${bays.length} bay(s): ${safe(bays.slice(0,10).join(', '))}${bays.length>10?'…':''}
      <div class="actions"><button type="button" id="bcCsvBtn">Download CSV</button><button type="button" id="bcPrintBtn" class="ghost">Print</button></div></div>`;

    const summaryTable=`<h3 style="margin-top:16px">By Item</h3><table class="pls-table"><thead><tr><th>Item #</th><th>Description</th><th>Pallets</th><th>Total Qty</th></tr></thead><tbody>${itemRows}</tbody></table>`;

    const detailRows=list.slice(0,500).map(r=>`<tr><td>${safe(r.lwhid)}</td><td>${safe(r.customer)}</td><td>${safe(r.item)}</td><td>${safe(r.itemDesc)}</td><td>${safe(r.lot)}</td><td>${safe(r.qty)}</td><td>${safe(r.warehouse)}</td><td>${safe(r.bay)}</td></tr>`).join('');
    const detailTable=`<h3 style="margin-top:16px">All Pallets${list.length>500?` (showing first 500 of ${list.length})`:''}</h3><table class="pls-table"><thead><tr><th>LWH ID</th><th>Customer</th><th>Item #</th><th>Description</th><th>Lot</th><th>Qty</th><th>Warehouse</th><th>Bay</th></tr></thead><tbody>${detailRows}</tbody></table>`;

    out.innerHTML=header+summaryTable+detailTable;

    const csvBtn=el('bcCsvBtn');
    if(csvBtn) csvBtn.onclick=()=>{
      const csvRows=[['LWH ID','Customer','Item #','Description','Lot','Qty','Warehouse','Bay']];
      lastResults.forEach(r=>csvRows.push([r.lwhid,r.customer,r.item,r.itemDesc,r.lot,r.qty,r.warehouse,r.bay]));
      const csv=csvRows.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob=new Blob([csv],{type:'text/csv'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='bay-contents.csv'; document.body.append(a); a.click(); a.remove();
      if(window.LWHUI) LWHUI.toast('CSV downloaded');
    };

    const printBtn=el('bcPrintBtn');
    if(printBtn) printBtn.onclick=()=>{
      const printOut=el('bcPrintOutput');
      if(printOut){
        printOut.innerHTML=`<div class="checklist-page"><h2>Bay Contents</h2><p>${totalPallets.toLocaleString()} pallet(s) · ${totalQty.toLocaleString()} total qty · ${bays.length} bay(s): ${safe(bays.join(', '))}</p>${summaryTable}${detailTable}</div>`;
      }
      if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
      setTimeout(()=>window.print(),50);
    };
  }

  function clearAll(){
    ['bcCustomer','bcItem','bcLot','bcBay','bcWarehouse'].forEach(id=>{ if(el(id)) el(id).value=''; });
    el('bcResults').innerHTML='';
    el('bcStatus').textContent='Enter at least one filter to search.';
    lastResults=[];
  }

  window.addEventListener('load',()=>{
    if(!el('bcSearchBtn')) return;
    bcSearchBtn.onclick=doSearch;
    bcClearBtn.onclick=clearAll;
    ['bcCustomer','bcItem','bcLot','bcBay','bcWarehouse'].forEach(id=>{
      el(id).addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); doSearch(); } });
    });
  });
})();
