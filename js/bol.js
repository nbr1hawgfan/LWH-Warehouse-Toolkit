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
  let shipperPad=null, carrierPad=null;

  const blankOrderRow=()=>({orderNo:'',packages:'',weight:'',palletSlip:'',shipperInfo:''});
  const blankCarrierRow=()=>({huQty:'',huType:'',pkgQty:'',pkgType:'',weight:'',hm:false,description:'',nmfc:'',class:''});
  let orderRows=[blankOrderRow()];
  let carrierRows=[blankCarrierRow()];

  function orderRowHtml(r,i){
    return `<div class="card" style="margin-bottom:8px">
      <div class="grid-2"><input data-order-idx="${i}" data-field="orderNo" value="${safe(r.orderNo)}" placeholder="Customer Order No." /><input data-order-idx="${i}" data-field="packages" value="${safe(r.packages)}" placeholder="# of Packages" inputmode="numeric" /></div>
      <div class="grid-2" style="margin-top:6px"><input data-order-idx="${i}" data-field="weight" value="${safe(r.weight)}" placeholder="Weight" inputmode="decimal" /><select data-order-idx="${i}" data-field="palletSlip"><option value="">Pallet/Slip?</option><option value="Y"${r.palletSlip==='Y'?' selected':''}>Yes</option><option value="N"${r.palletSlip==='N'?' selected':''}>No</option></select></div>
      <input data-order-idx="${i}" data-field="shipperInfo" value="${safe(r.shipperInfo)}" placeholder="Additional Shipper Information" style="margin-top:6px" />
      <div class="actions" style="margin-top:6px"><button type="button" class="ghost" data-remove-order="${i}">Remove Row</button></div>
    </div>`;
  }
  function carrierRowHtml(r,i){
    return `<div class="card" style="margin-bottom:8px">
      <div class="grid-3"><input data-carrier-idx="${i}" data-field="huQty" value="${safe(r.huQty)}" placeholder="Handling Unit Qty" inputmode="numeric" /><input data-carrier-idx="${i}" data-field="huType" value="${safe(r.huType)}" placeholder="HU Type (e.g. Pallet)" /><input data-carrier-idx="${i}" data-field="weight" value="${safe(r.weight)}" placeholder="Weight" inputmode="decimal" /></div>
      <div class="grid-3" style="margin-top:6px"><input data-carrier-idx="${i}" data-field="pkgQty" value="${safe(r.pkgQty)}" placeholder="Package Qty" inputmode="numeric" /><input data-carrier-idx="${i}" data-field="pkgType" value="${safe(r.pkgType)}" placeholder="Package Type" /><label style="display:flex;align-items:center;gap:6px;margin:0"><input type="checkbox" data-carrier-idx="${i}" data-field="hm"${r.hm?' checked':''} /> HM (hazmat)</label></div>
      <input data-carrier-idx="${i}" data-field="description" value="${safe(r.description)}" placeholder="Commodity Description" style="margin-top:6px" />
      <div class="grid-2" style="margin-top:6px"><input data-carrier-idx="${i}" data-field="nmfc" value="${safe(r.nmfc)}" placeholder="NMFC No." /><input data-carrier-idx="${i}" data-field="class" value="${safe(r.class)}" placeholder="Class" /></div>
      <div class="actions" style="margin-top:6px"><button type="button" class="ghost" data-remove-carrier="${i}">Remove Row</button></div>
    </div>`;
  }
  function renderOrderRows(){ const wrap=el('bolOrderRows'); if(wrap) wrap.innerHTML=orderRows.map(orderRowHtml).join(''); }
  function renderCarrierRows(){ const wrap=el('bolCarrierRows'); if(wrap) wrap.innerHTML=carrierRows.map(carrierRowHtml).join(''); }

  function formatDate(v){ if(!v) return ''; const [y,m,d]=v.split('-'); return (m&&d&&y)?`${m}-${d}-${y}`:v; }

  function bolHtml(){
    const logo=LWHStorage.get('companyLogo','');
    const date=formatDate(el('bolDate').value), bolNumber=el('bolNumber').value;
    const fromName=el('bolFromName').value, fromAddr=el('bolFromAddr').value, fromCity=el('bolFromCity').value;
    const toName=el('bolToName').value, toAddr=el('bolToAddr').value, toCity=el('bolToCity').value;
    const carrier=el('bolCarrier').value, trailer=el('bolTrailer').value, serial=el('bolSerial').value;
    const billName=el('bolBillName').value, billAddr=el('bolBillAddr').value, billCity=el('bolBillCity').value, scac=el('bolScac').value, pro=el('bolPro').value;
    const freightTerms=el('bolFreightTerms').value, masterBol=el('bolMasterBol').checked, instructions=el('bolInstructions').value;
    const cod=el('bolCod').value, feeTerms=el('bolFeeTerms').value, trailerLoaded=el('bolTrailerLoaded').value, freightCounted=el('bolFreightCounted').value;
    const shipperDate=formatDate(el('bolShipperDate').value), carrierDate=formatDate(el('bolCarrierDate').value);

    const orderRowsHtml=orderRows.filter(r=>r.orderNo||r.packages||r.weight||r.shipperInfo).map(r=>`<tr><td>${safe(r.orderNo)}</td><td>${safe(r.packages)}</td><td>${safe(r.weight)}</td><td>${safe(r.palletSlip)}</td><td>${safe(r.shipperInfo)}</td></tr>`).join('')||'<tr><td colspan="5">—</td></tr>';
    const carrierRowsHtml=carrierRows.filter(r=>r.huQty||r.pkgQty||r.description).map(r=>`<tr><td>${safe(r.huQty)}</td><td>${safe(r.huType)}</td><td>${safe(r.pkgQty)}</td><td>${safe(r.pkgType)}</td><td>${safe(r.weight)}</td><td>${r.hm?'X':''}</td><td>${safe(r.description)}</td><td>${safe(r.nmfc)}</td><td>${safe(r.class)}</td></tr>`).join('')||'<tr><td colspan="9">—</td></tr>';

    const shipperSig=(shipperPad&&shipperPad.hasSignature())?`<img class="bol-sig-img" src="${shipperPad.dataUrl()}" />`:'<span class="bol-sig-line"></span>';
    const carrierSig=(carrierPad&&carrierPad.hasSignature())?`<img class="bol-sig-img" src="${carrierPad.dataUrl()}" />`:'<span class="bol-sig-line"></span>';

    return `<div class="checklist-page">
      <div class="bol-header">
        ${logo?`<img class="bol-logo" src="${logo}" />`:''}
        <div>
          <h1 class="bol-title">Bill of Lading — Short Form — Not Negotiable</h1>
          <div class="bol-meta">Date: ${safe(date)} &nbsp;&nbsp; BOL #: ${safe(bolNumber)} &nbsp;&nbsp; Page 1 of 1</div>
        </div>
      </div>

      <div class="bol-grid-2col">
        <div class="bol-box"><div class="bol-box-title">Ship From</div><div>${safe(fromName)}</div><div>${safe(fromAddr)}</div><div>${safe(fromCity)}</div></div>
        <div class="bol-box"><div class="bol-box-title">Ship To</div><div>${safe(toName)}</div><div>${safe(toAddr)}</div><div>${safe(toCity)}</div><div><b>Carrier:</b> ${safe(carrier)}</div><div><b>Trailer #:</b> ${safe(trailer)}</div><div><b>Serial #:</b> ${safe(serial)}</div></div>
      </div>

      <div class="bol-box" style="margin-top:6px"><div class="bol-box-title">Third Party Freight Charges Bill To</div><div>${safe(billName)}</div><div>${safe(billAddr)}</div><div>${safe(billCity)}</div><div><b>SCAC:</b> ${safe(scac)} &nbsp;&nbsp; <b>Pro #:</b> ${safe(pro)}</div></div>

      <div class="bol-row-line" style="margin-top:6px"><b>Freight Charge Terms:</b> ${safe(freightTerms)}${masterBol?' · Master BOL with attached underlying BOLs':''}</div>
      ${instructions?`<div class="bol-row-line"><b>Special Instructions:</b> ${safe(instructions)}</div>`:''}

      <div class="bol-section-title">Customer Order Information</div>
      <table class="bol-table"><thead><tr><th>Order No.</th><th># Pkgs</th><th>Weight</th><th>Pallet/Slip</th><th>Additional Shipper Info</th></tr></thead><tbody>${orderRowsHtml}</tbody></table>

      <div class="bol-section-title">Carrier Information</div>
      <table class="bol-table"><thead><tr><th>HU Qty</th><th>HU Type</th><th>Pkg Qty</th><th>Pkg Type</th><th>Weight</th><th>HM</th><th>Commodity Description</th><th>NMFC</th><th>Class</th></tr></thead><tbody>${carrierRowsHtml}</tbody></table>

      <div class="bol-row-line" style="margin-top:6px"><b>COD Amount:</b> $${safe(cod)} &nbsp;&nbsp; <b>Fee Terms:</b> ${safe(feeTerms)}</div>
      <div class="bol-row-line"><b>Trailer Loaded:</b> ${safe(trailerLoaded)} &nbsp;&nbsp; <b>Freight Counted:</b> ${safe(freightCounted)}</div>

      <p class="bol-legal">Note: Liability limitation for loss or damage in this shipment may be applicable. See 49 USC § 14706(c)(1)(A) and (B). Received, subject to individually determined rates or contracts that have been agreed upon in writing between the carrier and shipper, if applicable, otherwise to the rates, classifications, and rules that have been established by the carrier and are available to the shipper, on request, and to all applicable state and federal regulations. The carrier shall not make delivery of this shipment without payment of charges and all other lawful fees.</p>
      <p class="bol-legal">This is to certify that the above named materials are properly classified, packaged, marked, and labeled, and are in proper condition for transportation according to the applicable regulations of the DOT. Carrier acknowledges receipt of packages and required placards. Carrier certifies emergency response information was made available and/or carrier has the DOT emergency response guidebook or equivalent documentation in the vehicle. Property described above is received in good order, except as noted.</p>

      <div class="bol-sig-row">
        <div class="bol-sig-block"><div class="bol-sig-label">Shipper Signature</div>${shipperSig}<div class="bol-sig-date">Date: ${safe(shipperDate)}</div></div>
        <div class="bol-sig-block"><div class="bol-sig-label">Carrier Signature</div>${carrierSig}<div class="bol-sig-date">Pickup Date: ${safe(carrierDate)}</div></div>
      </div>
    </div>`;
  }

  function generate(){
    const out=el('bolPrintOutput'); if(!out) return;
    out.innerHTML=bolHtml();
    if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
    LWHUI.toast('Bill of Lading generated');
  }

  function clearForm(){
    ['bolDate','bolNumber','bolFromName','bolFromAddr','bolFromCity','bolToName','bolToAddr','bolToCity','bolTrailer','bolSerial','bolBillName','bolBillAddr','bolBillCity','bolScac','bolPro','bolInstructions','bolCod','bolShipperDate','bolCarrierDate'].forEach(id=>{ const f=el(id); if(f) f.value=''; });
    if(el('bolCarrier')) bolCarrier.value='Logistics Warehouse';
    if(el('bolMasterBol')) bolMasterBol.checked=false;
    orderRows=[blankOrderRow()]; carrierRows=[blankCarrierRow()];
    renderOrderRows(); renderCarrierRows();
    if(shipperPad) shipperPad.clear();
    if(carrierPad) carrierPad.clear();
    const out=el('bolPrintOutput'); if(out) out.innerHTML='';
  }

  window.addEventListener('load',()=>{
    if(!el('bolForm')) return;
    renderOrderRows(); renderCarrierRows();
    shipperPad=setupSignaturePad(el('bolSigShipper'));
    carrierPad=setupSignaturePad(el('bolSigCarrier'));
    const shipperClearBtn=el('bolSigShipperClear'); if(shipperClearBtn) shipperClearBtn.onclick=()=>shipperPad&&shipperPad.clear();
    const carrierClearBtn=el('bolSigCarrierClear'); if(carrierClearBtn) carrierClearBtn.onclick=()=>carrierPad&&carrierPad.clear();

    el('bolOrderRows').addEventListener('input',e=>{ const t=e.target; if(t.dataset.orderIdx===undefined) return; orderRows[+t.dataset.orderIdx][t.dataset.field]=t.value; });
    el('bolOrderRows').addEventListener('click',e=>{ const b=e.target.closest('[data-remove-order]'); if(!b) return; orderRows.splice(+b.dataset.removeOrder,1); if(!orderRows.length) orderRows.push(blankOrderRow()); renderOrderRows(); });
    el('bolAddOrderRow').onclick=()=>{ orderRows.push(blankOrderRow()); renderOrderRows(); };

    el('bolCarrierRows').addEventListener('input',e=>{ const t=e.target; if(t.dataset.carrierIdx===undefined) return; const val=t.type==='checkbox'?t.checked:t.value; carrierRows[+t.dataset.carrierIdx][t.dataset.field]=val; });
    el('bolCarrierRows').addEventListener('click',e=>{ const b=e.target.closest('[data-remove-carrier]'); if(!b) return; carrierRows.splice(+b.dataset.removeCarrier,1); if(!carrierRows.length) carrierRows.push(blankCarrierRow()); renderCarrierRows(); });
    el('bolAddCarrierRow').onclick=()=>{ carrierRows.push(blankCarrierRow()); renderCarrierRows(); };

    const genBtn=el('bolGenerate'); if(genBtn) genBtn.onclick=generate;
    const clearBtn=el('bolClear'); if(clearBtn) clearBtn.onclick=clearForm;
    const d=el('bolDate'); if(d && !d.value) d.value=new Date().toISOString().slice(0,10);
  });
})();
