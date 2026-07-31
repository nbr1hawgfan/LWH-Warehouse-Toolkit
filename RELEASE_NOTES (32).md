(function(){
  function el(id){ return document.getElementById(id); }
  function safe(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  // Same signature pad approach as the Trailer Checklist — Pointer Events
  // cover mouse, touch, and stylus in one code path.
  function setupSignaturePad(canvas){
    if(!canvas) return null;
    canvas.width=600; canvas.height=150;
    const ctx=canvas.getContext('2d');
    ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#111';
    let drawing=false, hasInk=false, last=null;
    function pos(e){
      const rect=canvas.getBoundingClientRect();
      return {x:(e.clientX-rect.left)*(canvas.width/rect.width), y:(e.clientY-rect.top)*(canvas.height/rect.height)};
    }
    function start(e){ drawing=true; last=pos(e); e.preventDefault(); }
    function move(e){
      if(!drawing) return;
      const p=pos(e);
      ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke();
      last=p; hasInk=true;
      e.preventDefault();
    }
    function end(){ drawing=false; }
    canvas.addEventListener('pointerdown',start);
    canvas.addEventListener('pointermove',move);
    canvas.addEventListener('pointerup',end);
    canvas.addEventListener('pointerleave',end);
    canvas.addEventListener('pointercancel',end);
    return {
      clear(){ ctx.clearRect(0,0,canvas.width,canvas.height); hasInk=false; },
      hasSignature(){ return hasInk; },
      dataUrl(){ return canvas.toDataURL('image/png'); }
    };
  }
  let warehousePad=null, carrier2Pad=null, consigneePad=null;

  const blankSimpleRow=()=>({itemNumber:'',lotNumber:'',description:'',qty:'',pallets:'',weight:''});
  let simpleRows=[blankSimpleRow()];

  function simpleRowHtml(r,i){
    return `<div class="card" style="margin-bottom:8px">
      <div class="grid-2"><input data-simple-idx="${i}" data-field="itemNumber" value="${safe(r.itemNumber)}" placeholder="Item Number" /><input data-simple-idx="${i}" data-field="lotNumber" value="${safe(r.lotNumber)}" placeholder="Lot Number" /></div>
      <input data-simple-idx="${i}" data-field="description" value="${safe(r.description)}" placeholder="Description (optional)" style="margin-top:6px" />
      <div class="grid-3" style="margin-top:6px"><input data-simple-idx="${i}" data-field="qty" value="${safe(r.qty)}" placeholder="Qty" inputmode="numeric" /><input data-simple-idx="${i}" data-field="pallets" value="${safe(r.pallets)}" placeholder="# of Pallets" inputmode="numeric" /><input data-simple-idx="${i}" data-field="weight" value="${safe(r.weight)}" placeholder="Weight (optional)" inputmode="decimal" /></div>
      <div class="actions" style="margin-top:6px"><button type="button" class="ghost" data-remove-simple="${i}">Remove Row</button></div>
    </div>`;
  }
  function renderSimpleRows(){ const wrap=el('bolSimpleRows'); if(wrap) wrap.innerHTML=simpleRows.map(simpleRowHtml).join(''); }

  function formatDate(v){ if(!v) return ''; const [y,m,d]=v.split('-'); return (m&&d&&y)?`${m}-${d}-${y}`:v; }

  // Rolls the line-item rows up by Item Number — same item across multiple
  // lots/rows gets summed together — plus an overall grand total row.
  function computeItemTotals(rows){
    const byItem={};
    rows.forEach(r=>{
      const key=(r.itemNumber||'').trim(); if(!key) return;
      if(!byItem[key]) byItem[key]={qty:0,pallets:0,weight:0,hasWeight:false};
      byItem[key].qty+=parseFloat(r.qty)||0;
      byItem[key].pallets+=parseFloat(r.pallets)||0;
      if(r.weight){ byItem[key].weight+=parseFloat(r.weight)||0; byItem[key].hasWeight=true; }
    });
    return byItem;
  }

  function simpleBolHtml(){
    const logo=LWHStorage.get('companyLogo','');
    const date=formatDate(el('bolSimpleDate').value), bolNumber=el('bolSimpleNumber').value;
    const fromName=el('bolSimpleFromName').value, fromAddr=el('bolSimpleFromAddr').value, fromCity=el('bolSimpleFromCity').value;
    const toName=el('bolSimpleToName').value, toAddr=el('bolSimpleToAddr').value, toCity=el('bolSimpleToCity').value;
    const carrier=el('bolSimpleCarrier').value, driver=el('bolSimpleDriver').value, trailer=el('bolSimpleTrailer').value;
    const truck=el('bolSimpleTruck').value, seal=el('bolSimpleSeal').value;
    const instructions=el('bolSimpleInstructions').value;

    const usedRows=simpleRows.filter(r=>r.itemNumber||r.lotNumber||r.qty||r.pallets);
    const rowsHtml=usedRows.map(r=>`<tr><td>${safe(r.itemNumber)}</td><td>${safe(r.lotNumber)}</td><td>${safe(r.description)}</td><td>${safe(r.qty)}</td><td>${safe(r.pallets)}</td><td>${safe(r.weight)}</td></tr>`).join('')||'<tr><td colspan="6">—</td></tr>';

    const totals=computeItemTotals(usedRows);
    const totalKeys=Object.keys(totals);
    let grandQty=0, grandPallets=0, grandWeight=0, anyWeight=false;
    const totalsRowsHtml=totalKeys.map(key=>{
      const t=totals[key];
      grandQty+=t.qty; grandPallets+=t.pallets; if(t.hasWeight){ grandWeight+=t.weight; anyWeight=true; }
      return `<tr><td>${safe(key)}</td><td>${t.qty.toLocaleString()}</td><td>${t.pallets.toLocaleString()}</td><td>${t.hasWeight?t.weight.toLocaleString():'—'}</td></tr>`;
    }).join('');
    const totalsTable=totalKeys.length?`<div class="bol-section-title">Item Totals</div>
      <table class="bol-table"><thead><tr><th>Item Number</th><th>Total Qty</th><th>Total Pallets</th><th>Total Weight</th></tr></thead><tbody>${totalsRowsHtml}<tr class="bol-grand-total"><td>Grand Total</td><td>${grandQty.toLocaleString()}</td><td>${grandPallets.toLocaleString()}</td><td>${anyWeight?grandWeight.toLocaleString():'—'}</td></tr></tbody></table>`:'';

    const warehouseSig=(warehousePad&&warehousePad.hasSignature())?`<img class="bol-sig-img" src="${warehousePad.dataUrl()}" />`:'<span class="bol-sig-line"></span>';
    const carrier2Sig=(carrier2Pad&&carrier2Pad.hasSignature())?`<img class="bol-sig-img" src="${carrier2Pad.dataUrl()}" />`:'<span class="bol-sig-line"></span>';
    const consigneeSig=(consigneePad&&consigneePad.hasSignature())?`<img class="bol-sig-img" src="${consigneePad.dataUrl()}" />`:'<span class="bol-sig-line"></span>';

    return `<div class="checklist-page">
      <div class="bol-header">
        ${logo?`<img class="bol-logo" src="${logo}" />`:''}
        <div>
          <h1 class="bol-title">Bill of Lading</h1>
          <div class="bol-meta">Date: ${safe(date)} &nbsp;&nbsp; ${bolNumber?`BOL #: ${safe(bolNumber)}`:''}</div>
        </div>
      </div>

      <div class="bol-grid-2col">
        <div class="bol-box"><div class="bol-box-title">Ship From</div><div>${safe(fromName)}</div><div>${safe(fromAddr)}</div><div>${safe(fromCity)}</div></div>
        <div class="bol-box"><div class="bol-box-title">Ship To</div><div>${safe(toName)}</div><div>${safe(toAddr)}</div><div>${safe(toCity)}</div></div>
      </div>

      <div class="bol-box" style="margin-top:6px"><div class="bol-box-title">Carrier</div><div><b>Carrier:</b> ${safe(carrier)} &nbsp;&nbsp; <b>Driver:</b> ${safe(driver)}</div><div><b>Trailer #:</b> ${safe(trailer)} ${truck?`&nbsp;&nbsp; <b>Truck #:</b> ${safe(truck)}`:''} &nbsp;&nbsp; <b>Seal #:</b> ${safe(seal)}</div></div>

      ${instructions?`<div class="bol-row-line" style="margin-top:6px"><b>Special Instructions:</b> ${safe(instructions)}</div>`:''}

      <div class="bol-section-title">Items</div>
      <table class="bol-table"><thead><tr><th>Item Number</th><th>Lot Number</th><th>Description</th><th>Qty</th><th># Pallets</th><th>Weight</th></tr></thead><tbody>${rowsHtml}</tbody></table>

      ${totalsTable}

      <p class="bol-legal">Received, subject to the rates, classifications, and rules established by the carrier, and to all applicable state and federal regulations. Property described above is received in good order, except as noted, and is tendered for transportation.</p>

      <div class="bol-sig-row">
        <div class="bol-sig-block"><div class="bol-sig-label">Warehouse / Shipper</div>${warehouseSig}<div class="bol-sig-date">Date</div></div>
        <div class="bol-sig-block"><div class="bol-sig-label">Carrier</div>${carrier2Sig}<div class="bol-sig-date">Date</div></div>
        <div class="bol-sig-block"><div class="bol-sig-label">Consignee</div>${consigneeSig}<div class="bol-sig-date">Date</div></div>
      </div>
    </div>`;
  }

  function generate(){
    const out=el('bolPrintOutput'); if(!out) return;
    out.innerHTML = simpleBolHtml();
    if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
    LWHUI.toast('Bill of Lading generated');
  }

  function clearForm(){
    ['bolSimpleDate','bolSimpleNumber','bolSimpleFromName','bolSimpleFromAddr','bolSimpleFromCity','bolSimpleToName','bolSimpleToAddr','bolSimpleToCity','bolSimpleDriver','bolSimpleTrailer','bolSimpleTruck','bolSimpleSeal','bolSimpleInstructions'].forEach(id=>{ const f=el(id); if(f) f.value=''; });
    if(el('bolSimpleCarrier')) bolSimpleCarrier.value='Logistics Warehouse';
    simpleRows=[blankSimpleRow()];
    renderSimpleRows();
    [warehousePad,carrier2Pad,consigneePad].forEach(p=>p&&p.clear());
    const out=el('bolPrintOutput'); if(out) out.innerHTML='';
  }

  // ---------- PDF export (Download / Share) — works on whatever was last generated ----------
  async function renderToPdf(){
    const out=el('bolPrintOutput');
    if(!out || !out.firstElementChild){ alert('Generate the Bill of Lading first.'); return null; }
    if(!window.html2canvas || !window.jspdf){ alert('PDF library failed to load — check your internet connection.'); return null; }
    const target=out.firstElementChild;
    const canvas=await html2canvas(target,{scale:2,backgroundColor:'#ffffff'});
    const imgData=canvas.toDataURL('image/jpeg',0.92);
    const {jsPDF}=window.jspdf;
    const doc=new jsPDF({unit:'in',format:'letter'});
    const pageW=8.5, pageH=11;
    const ratio=canvas.width/canvas.height;
    let w=pageW, h=w/ratio;
    if(h>pageH){ h=pageH; w=h*ratio; }
    doc.addImage(imgData,'JPEG',(pageW-w)/2,(pageH-h)/2,w,h);
    return doc;
  }
  async function downloadPdf(){
    const doc=await renderToPdf(); if(!doc) return;
    doc.save('bill-of-lading.pdf');
    LWHUI.toast('PDF downloaded');
  }
  async function sharePdf(){
    const doc=await renderToPdf(); if(!doc) return;
    const blob=doc.output('blob');
    const file=new File([blob],'bill-of-lading.pdf',{type:'application/pdf'});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      try{ await navigator.share({files:[file],title:'Bill of Lading'}); }
      catch(e){ /* user cancelled — not an error */ }
    } else {
      const a=document.createElement('a'); a.href=URL.createObjectURL(file); a.download=file.name; document.body.append(a); a.click(); a.remove();
      LWHUI.toast('Sharing not supported here — downloaded instead');
    }
  }

  window.addEventListener('load',()=>{
    if(!el('bolForm')) return;
    renderSimpleRows();

    warehousePad=setupSignaturePad(el('bolSigWarehouse'));
    carrier2Pad=setupSignaturePad(el('bolSigCarrier2'));
    consigneePad=setupSignaturePad(el('bolSigConsignee'));
    const bindClear=(btnId,pad)=>{ const b=el(btnId); if(b) b.onclick=()=>pad&&pad.clear(); };
    bindClear('bolSigWarehouseClear',warehousePad);
    bindClear('bolSigCarrier2Clear',carrier2Pad);
    bindClear('bolSigConsigneeClear',consigneePad);

    el('bolSimpleRows').addEventListener('input',e=>{ const t=e.target; if(t.dataset.simpleIdx===undefined) return; simpleRows[+t.dataset.simpleIdx][t.dataset.field]=t.value; });
    el('bolSimpleRows').addEventListener('click',e=>{ const b=e.target.closest('[data-remove-simple]'); if(!b) return; simpleRows.splice(+b.dataset.removeSimple,1); if(!simpleRows.length) simpleRows.push(blankSimpleRow()); renderSimpleRows(); });
    el('bolAddSimpleRow').onclick=()=>{ simpleRows.push(blankSimpleRow()); renderSimpleRows(); };

    const genBtn=el('bolGenerate'); if(genBtn) genBtn.onclick=generate;
    const clearBtn=el('bolClear'); if(clearBtn) clearBtn.onclick=clearForm;
    const dlBtn=el('bolDownloadPdf'); if(dlBtn) dlBtn.onclick=downloadPdf;
    const shareBtn=el('bolSharePdf'); if(shareBtn) shareBtn.onclick=sharePdf;

    const d2=el('bolSimpleDate'); if(d2 && !d2.value) d2.value=new Date().toISOString().slice(0,10);
  });
})();
