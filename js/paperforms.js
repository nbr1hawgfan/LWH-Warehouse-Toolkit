(function(){
  // PAPER FORMS — the last-resort fallback when devices, hotspots or the
  // network are down. Prints blank forms to fill in by hand and key into
  // the WMS once it's back:
  //   • Blank BOL — same layout as the Outbound Loads BOL (and the WMS BOL),
  //     optionally pre-numbered and with the ship-from filled in.
  //   • Receiving tally — for any customer, including the ones whose pallets
  //     have nothing to scan until the WMS generates their LWH ID / labels.
  //     Has an "LWH ID (assign in WMS)" column for that.
  // Print a stack ahead of time and keep it with the hotspot/printer kit.
  const CO_KEY='obCompany', FROM_BY_WH='obFromByWh', PF_KEY='pfSettings';
  const DEFAULT_CO={name:'Logistics Warehouse',addr:'700 Fresno Street, Fort Smith, AR 72901',phone:'(479) 410-2611'};
  const el=id=>document.getElementById(id);
  const safe=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const blanks=(n,html)=>Array.from({length:n},(_,i)=>html(i)).join('');
  let form='bol';

  function company(){ return Object.assign({},DEFAULT_CO,LWHStorage.get(CO_KEY,{})||{}); }
  function settings(){
    return {warehouse:el('pfWarehouse').value.trim(),customer:el('pfCustomer').value.trim(),copies:Math.max(1,Math.min(100,parseInt(el('pfCopies').value,10)||1)),
      cont:el('pfCont').checked,fillFrom:el('pfFillFrom').checked,prefix:el('pfPrefix').value.trim(),start:Math.max(1,parseInt(el('pfStart').value,10)||1)};
  }
  function saveSettings(){ const s=settings(); LWHStorage.set(PF_KEY,{form,warehouse:s.warehouse,customer:s.customer,copies:s.copies,cont:s.cont,fillFrom:s.fillFrom,prefix:s.prefix}); }
  function shipFromFor(wh){ const m=LWHStorage.get(FROM_BY_WH,{})||{}; return (wh&&m[wh])||null; }
  function bolNo(s,i){ return s.prefix?`${s.prefix}-${String(s.start+i).padStart(3,'0')}`:''; }

  // ---------------------------------------------------------------- blank BOL
  function partyBox(title,p){
    p=p||{};
    return `<div class="obp-box pf-box"><div class="obp-box-t">${title}</div>${p.code?`<div class="obp-code">${safe(p.code)}</div>`:''}
      <div class="obp-box-b">${p.name?`${safe(p.name)}<br>${safe(p.addr1)}<br>${safe(p.city)}${p.phone?'<br>'+safe(p.phone):''}`:'<div class="pf-wline"></div><div class="pf-wline"></div><div class="pf-wline"></div>'}</div></div>`;
  }
  const BOL_HEAD='<tr><th>CUSTOMER ID</th><th>LWH ID</th><th>DESCRIPTION</th><th>ITEM NUMBER</th><th>PO</th><th>LOT / DATE</th><th class="r">QTY</th></tr>';
  function bolPage(s,i,pages){
    const co=company(), no=bolNo(s,i), from=s.fillFrom?shipFromFor(s.warehouse):null;
    return `<div class="obp-page pf-page">
      <div class="obp-top">
        <div class="obp-co"><div class="obp-co-name">${safe(co.name)}</div><div class="obp-co-addr">${safe(co.addr)}</div><div class="obp-co-addr">Phone: ${safe(co.phone)}</div></div>
        <div class="obp-bolno"><div class="obp-box-t">BOL NUMBER</div><div class="obp-bolno-v pf-bolno">${safe(no)||'&nbsp;'}</div><div class="obp-ref pf-ref">BILL TO REF: <span class="pf-fill pf-fill-s"></span></div></div>
        <table class="obp-hdr pf-hdr"><tr><th>APPT</th><td></td></tr><tr><th>BOL</th><td>${safe(no)}</td></tr><tr><th>PRO #</th><td></td></tr>
          <tr><th>CARRIER</th><td></td></tr><tr><th>TRAILER</th><td></td></tr><tr><th>SEAL</th><td></td></tr></table>
      </div>
      <div class="obp-parties">${partyBox('SHIP FROM',from)}${partyBox('CONSIGNEE')}${partyBox('BILL TO')}
        <div class="obp-box pf-box"><div class="obp-box-t">COMMENTS</div><div class="obp-box-b">${s.warehouse?`<b>Warehouse: ${safe(s.warehouse)}</b>`:''}</div></div></div>
      <table class="obp-lines pf-lines">${BOL_HEAD}${blanks(18,()=>'<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>')}</table>
      <div class="pf-totals"><span>TOTAL PALLETS <span class="pf-fill pf-fill-s"></span></span><span>TOTAL QTY <span class="pf-fill pf-fill-s"></span></span>${s.cont?'<span>Continued on next page ☐</span>':''}</div>
      <div class="obp-legal">Received, subject to the classifications and tariffs in effect on the date of issue of this Bill of Lading, the property described above in apparent good order, except as noted. Seal number recorded above was applied at time of loading.</div>
      <div class="obp-sigs pf-sigs"><div><div class="obp-line"></div>Shipper signature / date<div class="obp-sub">${safe(co.name)} · loaded by <span class="pf-fill"></span></div></div>
        <div><div class="obp-line"></div>Carrier / driver signature / date<div class="obp-sub">&nbsp;</div></div></div>
      <div class="obp-foot"><span>Paper BOL — enter into the WMS when it's back. Entered in WMS ☐ by ________ date ______</span><span>Page 1 of ${pages}</span></div>
    </div>`;
  }
  function bolContPage(s,i,pg,pages){
    const no=bolNo(s,i);
    return `<div class="obp-page pf-page">
      <div class="obp-mini pf-mini"><b>BOL ${safe(no)||'<span class="pf-fill"></span>'}</b><span>Consignee <span class="pf-fill"></span></span><span>Trailer <span class="pf-fill pf-fill-s"></span></span><span>Page ${pg} of ${pages}</span></div>
      <table class="obp-lines pf-lines">${BOL_HEAD}${blanks(30,()=>'<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>')}</table>
      <div class="pf-totals"><span>PAGE PALLETS <span class="pf-fill pf-fill-s"></span></span><span>PAGE QTY <span class="pf-fill pf-fill-s"></span></span></div>
      <div class="obp-foot"><span>Paper BOL — continuation</span><span>Page ${pg} of ${pages}</span></div>
    </div>`;
  }

  // ---------------------------------------------------------------- receiving tally (landscape)
  const TALLY_HEAD='<tr><th class="c">#</th><th>ITEM NUMBER</th><th>DESCRIPTION</th><th>LOT / DATE</th><th class="r">QTY</th><th>CUSTOMER PALLET ID (if any)</th><th>BAY / LOC</th><th class="c">COND<br>OK / DMG</th><th class="pf-wms">LWH ID<br>(assign in WMS)</th></tr>';
  function tallyRows(n,from){ return blanks(n,i=>`<tr><td class="c n">${from+i}</td><td></td><td></td><td></td><td></td><td></td><td></td><td class="c">☐ ☐</td><td class="pf-wms"></td></tr>`); }
  function field(label,val,cls){ return `<div class="pf-f ${cls||''}"><span>${label}</span><div>${val?safe(val):''}</div></div>`; }
  function tallyPage(s,pages){
    const co=company();
    return `<div class="pf-tpage">
      <div class="pf-thead"><div><div class="obp-co-name pf-tco">${safe(co.name)}</div><div class="obp-co-addr" style="text-align:left">${safe(co.addr)} · ${safe(co.phone)}</div></div>
        <div class="pf-ttitle">RECEIVING TALLY<small>Paper fallback — key into the WMS when it's back</small></div></div>
      <div class="pf-fields">
        ${field('Date','')}${field('Warehouse',s.warehouse)}${field('Customer / sub-customer',s.customer,'pf-f2')}${field('Customer BOL / PO #','','pf-f2')}
        ${field('Carrier','','pf-f2')}${field('Trailer #','')}${field('Door','')}
        <div class="pf-f pf-f2"><span>Seal #</span><div></div><em>☐ intact&nbsp;&nbsp;☐ broken&nbsp;&nbsp;☐ none</em></div>
        ${field('Appt time','')}${field('Arrived','')}${field('Unload start','')}${field('Unload finish','')}
        ${field('Pallets expected','')}${field('Pallets received','')}${field('Received by','','pf-f2')}
      </div>
      <table class="pf-tally">${TALLY_HEAD}${tallyRows(16,1)}</table>
      <div class="pf-tfoot">
        <div class="pf-osd"><b>OVER / SHORT / DAMAGED</b> — what, how many, photos taken? ☐<div class="pf-wline"></div><div class="pf-wline"></div></div>
        <div class="pf-tsum"><div>TOTAL PALLETS <span class="pf-fill pf-fill-s"></span></div><div>TOTAL QTY <span class="pf-fill pf-fill-s"></span></div>${s.cont?'<div>Continued ☐</div>':''}</div>
      </div>
      <div class="pf-tsigs"><div><div class="obp-line"></div>Driver signature / date</div><div><div class="obp-line"></div>Received by (LWH) / date</div><div><div class="obp-line"></div>Entered in WMS by / date</div></div>
      <div class="pf-tfoot2"><span>${safe(co.name)} · Receiving tally</span><span>Page 1 of ${pages}</span></div>
    </div>`;
  }
  function tallyContPage(s,pg,pages){
    return `<div class="pf-tpage">
      <div class="pf-mini2"><b>RECEIVING TALLY — continued</b><span>Customer <span class="pf-fill">${safe(s.customer)}</span></span><span>Trailer <span class="pf-fill pf-fill-s"></span></span><span>Date <span class="pf-fill pf-fill-s"></span></span><span>Page ${pg} of ${pages}</span></div>
      <table class="pf-tally">${TALLY_HEAD}${tallyRows(25,17+(pg-2)*25)}</table>
      <div class="pf-tsum pf-tsum-row"><div>PAGE PALLETS <span class="pf-fill pf-fill-s"></span></div><div>PAGE QTY <span class="pf-fill pf-fill-s"></span></div></div>
      <div class="pf-tfoot2"><span>Receiving tally — continuation</span><span>Page ${pg} of ${pages}</span></div>
    </div>`;
  }

  // ---------------------------------------------------------------- build / print
  function build(s){
    let html='';
    for(let i=0;i<s.copies;i++){
      if(form==='bol'){ const pages=s.cont?2:1; html+=bolPage(s,i,pages); if(s.cont) html+=bolContPage(s,i,2,pages); }
      else { const pages=s.cont?2:1; html+=tallyPage(s,pages); if(s.cont) html+=tallyContPage(s,2,pages); }
    }
    return html;
  }
  function preview(){
    const s=settings(); saveSettings();
    const one=Object.assign({},s,{copies:1});
    el('pfPreview').innerHTML=`<div class="pf-scale ${form==='tally'?'pf-scale-land':''}">${build(one)}</div>`;
    const pages=(s.cont?2:1)*s.copies;
    el('pfSummary').textContent=`${form==='bol'?'Blank BOL':'Receiving tally'} · ${s.copies} cop${s.copies===1?'y':'ies'} · ${pages} page${pages===1?'':'s'} · ${form==='tally'?'landscape':'portrait'}${form==='bol'&&s.prefix?` · numbered ${bolNo(s,0)} to ${bolNo(s,s.copies-1)}`:''}`;
    const from=shipFromFor(s.warehouse);
    el('pfFromHint').textContent=!s.warehouse?'Type the warehouse to fill in its ship-from address.':from?`Uses ${from.name}, ${from.addr1} (last outbound load from ${s.warehouse}).`:`No outbound load from ${s.warehouse} on this device yet — the box prints blank.`;
  }
  function printForms(){
    const s=settings(); saveSettings();
    el('pfPrintArea').innerHTML=build(s);
    if(window.LWHLabels&&LWHLabels.setPrintPageSize) form==='tally'?LWHLabels.setPrintPageSize(11,8.5):LWHLabels.setPrintPageSize(8.5,11);
    if(form==='bol'&&s.prefix) LWHStorage.set('pfNextStart',s.start+s.copies);
    setTimeout(()=>print(),250);
    if(form==='bol'&&s.prefix) setTimeout(()=>{ el('pfStart').value=s.start+s.copies; preview(); },1500);
  }
  function setForm(f){
    form=f;
    document.querySelectorAll('[data-pftab]').forEach(b=>b.classList.toggle('active',b.dataset.pftab===f));
    document.querySelectorAll('[data-pf-only]').forEach(x=>{ x.hidden=x.dataset.pfOnly!==f; });
    preview();
  }

  window.addEventListener('load',()=>{
    if(!el('paperForms')) return;
    const st=LWHStorage.get(PF_KEY,{})||{};
    el('pfWarehouse').value=st.warehouse||''; el('pfCustomer').value=st.customer||''; el('pfCopies').value=st.copies||10;
    el('pfCont').checked=!!st.cont; el('pfFillFrom').checked=st.fillFrom!==false; el('pfPrefix').value=st.prefix||''; el('pfStart').value=LWHStorage.get('pfNextStart',1)||1;
    document.querySelectorAll('[data-pftab]').forEach(b=>b.onclick=()=>setForm(b.dataset.pftab));
    ['pfWarehouse','pfCustomer','pfCopies','pfCont','pfFillFrom','pfPrefix','pfStart'].forEach(id=>el(id).addEventListener('input',preview));
    ['pfCont','pfFillFrom'].forEach(id=>el(id).addEventListener('change',preview));
    el('pfPrint').onclick=printForms;
    // warehouse suggestions from live inventory
    const fillWh=()=>{ const rows=(window.LWHInventory&&LWHInventory.getAllRows)?LWHInventory.getAllRows():[];
      el('pfWhList').innerHTML=[...new Set(rows.map(r=>String(r.warehouse||'').trim()).filter(Boolean))].sort().map(w=>`<option value="${safe(w)}"></option>`).join(''); };
    document.addEventListener('click',e=>{ const v=e.target.closest('[data-view]'); if(v&&v.dataset.view==='paperForms') setTimeout(()=>{ fillWh(); preview(); },50); });
    setForm(st.form==='tally'?'tally':'bol');
  });
  window.LWHPaperForms={build:(f,s)=>{ form=f; return build(s); }};
})();
