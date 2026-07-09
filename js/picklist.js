(function(){
  function el(id){ return document.getElementById(id); }
  function safe(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  function toPickRow(r){
    return { lwhid:r.controlNumber||'', customer:r.subCustNm||'', item:r.itemNm||'', lot:r.lotNum||'', qty:r.qty||'', location:r.location||r.warehouse||'', bay:r.currentBay||r.bayName||'' };
  }

  // Splits a field's input on commas into lowercase, trimmed tokens — lets a
  // driver enter several item numbers (or bays) at once and get everything
  // combined into one pick list, instead of one search/print per item.
  function tokens(v){ return String(v||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean); }
  function matchesAny(value,toks){ if(!toks.length) return true; const v=String(value||'').toLowerCase(); return toks.some(t=>v.includes(t)); }

  function doSearch(){
    const custToks=tokens(el('plCustomer').value);
    const itemToks=tokens(el('plItem').value);
    const lotToks=tokens(el('plLot').value);
    const bayToks=tokens((el('plBay')||{}).value);
    const status=el('plStatus'), out=el('picklistResults'), printOut=el('picklistPrintOutput');
    if(printOut) printOut.innerHTML='';
    if(!custToks.length && !itemToks.length && !lotToks.length && !bayToks.length){
      status.textContent='Enter at least one filter to search.';
      if(out) out.innerHTML='';
      return [];
    }
    if(!window.LWHInventory || !LWHInventory.getAllRows){ status.textContent='Inventory data not available yet.'; return []; }
    const rows=LWHInventory.getAllRows();
    const matches=rows.filter(r=>{
      if(!matchesAny(r.subCustNm,custToks)) return false;
      if(!matchesAny(r.itemNm,itemToks)) return false;
      if(!matchesAny(r.lotNum,lotToks)) return false;
      if(!matchesAny(r.currentBay||r.bayName,bayToks)) return false;
      return true;
    });
    render(matches.map(toPickRow));
    return matches;
  }

  function render(list){
    const out=el('picklistResults'), status=el('plStatus');
    status.textContent=`${list.length} matching row(s).`;
    if(!out) return;
    if(!list.length){ out.innerHTML='<div class="card">No matching inventory found.</div>'; return; }
    const totalQty=list.reduce((sum,r)=>sum+(parseFloat(r.qty)||0),0);
    const bays=[...new Set(list.map(r=>r.bay).filter(Boolean))];
    out.innerHTML=`<div class="card"><b>${list.length}</b> matching row(s) · Total Qty <b>${totalQty.toLocaleString()}</b> · ${bays.length} bay(s): ${safe(bays.slice(0,10).join(', '))}${bays.length>10?'…':''}<div class="actions"><button type="button" id="plGenerateBtn">Generate Pick List</button></div></div><div class="result-list">${list.slice(0,300).map(r=>`<div class="result-card"><div><b>${safe(r.lwhid)}</b> <span>${safe(r.customer)}</span></div><div>${safe(r.item)} · Lot ${safe(r.lot)} · Qty ${safe(r.qty)}</div><div>${safe(r.location)} · Bay <b>${safe(r.bay)}</b></div></div>`).join('')}</div>`;
    const genBtn=el('plGenerateBtn'); if(genBtn) genBtn.onclick=()=>generatePrintable(list);
  }

  function generatePrintable(list){
    const out=el('picklistPrintOutput'); if(!out) return;
    const codeType=(el('plCodeType')||{}).value||'qr';
    const rows=list.map(r=>`<tr>
        <td class="pl-code">${codeType==='qr'?`<div class="pl-qr" data-qr="${safe(r.lwhid)}"></div>`:`<svg class="pl-barcode" data-barcode="${safe(r.lwhid)}"></svg>`}<div class="pl-lwh">${safe(r.lwhid)}</div></td>
        <td>${safe(r.customer)}</td>
        <td>${safe(r.item)}</td>
        <td>${safe(r.lot)}</td>
        <td>${safe(r.qty)}</td>
        <td>${safe(r.location)}</td>
        <td>${safe(r.bay)}</td>
      </tr>`).join('');
    const totalQty=list.reduce((sum,r)=>sum+(parseFloat(r.qty)||0),0);
    out.innerHTML=`<div class="picklist-page">
      <h1 class="pl-title">Pick List</h1>
      <p class="pl-meta">Generated ${new Date().toLocaleString()} · ${list.length} row(s) · Total Qty ${totalQty.toLocaleString()}</p>
      <table class="pl-table">
        <thead><tr><th>LWH ID</th><th>Customer</th><th>Item</th><th>Lot</th><th>Qty</th><th>Location</th><th>Bay</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
    out.querySelectorAll('.pl-qr').forEach(box=>{ if(window.LWHQR) LWHQR.make(box,box.dataset.qr,60); });
    out.querySelectorAll('.pl-barcode').forEach(svg=>{ if(window.LWHBarcode){ try{ LWHBarcode.make(svg,svg.dataset.barcode,{height:32,width:1.3}); }catch(e){} } });
    if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(11,8.5); // landscape — more room for the table columns
    LWHUI.toast(`Pick list generated (${list.length} row(s))`);
  }

  function clearForm(){
    ['plCustomer','plItem','plLot','plBay'].forEach(id=>{ const f=el(id); if(f) f.value=''; });
    const out=el('picklistResults'); if(out) out.innerHTML='';
    const printOut=el('picklistPrintOutput'); if(printOut) printOut.innerHTML='';
    const status=el('plStatus'); if(status) status.textContent='Enter at least one filter to search.';
  }

  function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

  window.addEventListener('load',()=>{
    if(!el('picklistForm')) return;
    const searchBtn=el('plSearchBtn'); if(searchBtn) searchBtn.onclick=doSearch;
    const clearBtn=el('plClearBtn'); if(clearBtn) clearBtn.onclick=clearForm;
    ['plCustomer','plItem','plLot','plBay'].forEach(id=>{
      const f=el(id); if(!f) return;
      f.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); doSearch(); } });
      f.addEventListener('input',debounce(doSearch,300));
    });
  });
})();
