(function(){
  function el(id){ return document.getElementById(id); }
  function safe(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  let ebType='timecard'; // 'timecard' | 'idbadge'

  // Mirrors the calibration-aware page wrapper used elsewhere (labels.js's
  // internal page() helper isn't exported, so this is a small self-contained
  // copy of the same logic for consistent print alignment behavior).
  function makePage(className,html){
    const d=document.createElement('div');
    d.className=className;
    d.innerHTML=html;
    const x=+LWHStorage.get('calX',0), y=+LWHStorage.get('calY',0), sc=+LWHStorage.get('calScale',100);
    d.style.transform=`translate(${x}px,${y}px) scale(${sc/100})`;
    d.style.transformOrigin='top left';
    return d;
  }

  function finishCodes(root){
    root.querySelectorAll('.eb-barcode').forEach(svg=>{ if(window.LWHBarcode){ try{ LWHBarcode.make(svg,svg.dataset.barcode,{height:+svg.dataset.height||42,width:+svg.dataset.width||1.6}); }catch(e){} } });
    root.querySelectorAll('.eb-qr').forEach(q=>{ if(window.LWHQR) LWHQR.make(q,q.dataset.qr,+q.dataset.size||90); });
  }
  function codeBlockHtml(id,codeType,qrSize){
    return codeType==='qr'
      ? `<div class="qrbox eb-qr" data-qr="${safe(id)}" data-size="${qrSize||90}"></div>`
      : `<svg class="eb-barcode" data-barcode="${safe(id)}" data-height="42" data-width="1.6"></svg>`;
  }

  // ---------- Timecard Badge: simple, landscape, name/ID/barcode only ----------
  function timecardHtml(name,id,codeType){
    return `<div class="employee-badge">
      <div class="eb-top">LOGISTICS WAREHOUSE</div>
      <div class="eb-type">EMPLOYEE TIMECARD</div>
      <div class="eb-name">${safe(name)}</div>
      <div class="eb-code">${codeBlockHtml(id,codeType,90)}</div>
      <div class="eb-id">${safe(id)}</div>
    </div>`;
  }

  // ---------- ID Badge: full front/back, portrait, logo/photo/title ----------
  function idFrontHtml(name,dept,photo){
    const logo=LWHStorage.get('companyLogo','');
    const tagline=LWHStorage.get('companyTagline','');
    const brand=LWHStorage.get('primaryColor','#0f4a45');
    return `<div class="employee-badge id-badge-card">
      ${logo?`<img class="id-logo" src="${logo}" />`:''}
      ${tagline?`<div class="id-tagline" style="color:${safe(brand)}">${safe(tagline)}</div>`:''}
      ${photo?`<img class="id-photo" src="${photo}" />`:'<div class="id-photo id-photo-placeholder"></div>'}
      <div class="id-name">${safe(name)}</div>
      ${dept?`<div class="id-dept" style="color:${safe(brand)}">${safe(dept)}</div>`:''}
    </div>`;
  }
  function idBackHtml(id,codeType){
    const code=codeBlockHtml(id,codeType,110);
    // Barcode (not QR) gets rotated 90° here specifically — the ID badge back
    // is a portrait card (2.125in wide), too narrow for an 11+ character
    // barcode to render at a scannable bar width. Turning it sideways lets it
    // use the card's 3.375in height instead, which is plenty of room.
    const codeBlock = codeType==='qr' ? code : `<div class="eb-barcode-rotated">${code}</div>`;
    return `<div class="employee-badge id-badge-card">${codeBlock}<div class="eb-id">${safe(id)}</div></div>`;
  }

  function generate(mode){
    const out=el('empBadgeOutput'); if(!out) return;
    const name=(el('ebName').value||'').trim(), id=(el('ebId').value||'').trim(), dept=(el('ebDept').value||'').trim(), codeType=el('ebCodeType').value;
    if(!name){ alert('Enter at least an Employee Name.'); return; }
    if(!id){ alert('Enter an ID for the barcode.'); return; }

    LWHUI.readFile(el('ebPhoto'),photo=>{
      out.innerHTML='';

      if(ebType==='timecard'){
        if(mode==='card'){
          out.append(makePage('label-page employee-badge-page',timecardHtml(name,id,codeType)));
          finishCodes(out);
          if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(3.375,2.125); // landscape
          LWHUI.toast('Single CR80 card ready to print');
        } else {
          const copies=Math.max(1,+el('ebCopies').value||1), perSheet=8, sheets=Math.ceil(copies/perSheet);
          for(let s=0;s<sheets;s++){
            const onThisSheet=Math.min(perSheet,copies-s*perSheet);
            let inner=''; for(let i=0;i<onThisSheet;i++) inner+=timecardHtml(name,id,codeType);
            out.append(makePage('label-page employee-sheet-page',inner));
          }
          finishCodes(out);
          if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
          LWHUI.toast(`Generated ${copies} badge(s) across ${sheets} sheet(s) — cut along each badge's border`);
        }
      } else { // idbadge
        if(mode==='card'){
          out.append(makePage('label-page employee-badge-page-portrait',idFrontHtml(name,dept,photo)));
          out.append(makePage('label-page employee-badge-page-portrait',idBackHtml(id,codeType)));
          finishCodes(out);
          if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(2.125,3.375); // portrait — reads right-side-up on a lanyard
          LWHUI.toast('Front & back ready — 2 pages, portrait');
        } else {
          const copies=Math.max(1,+el('ebCopies').value||1), perSheet=6, sheets=Math.ceil(copies/perSheet);
          for(let s=0;s<sheets;s++){
            const onThisSheet=Math.min(perSheet,copies-s*perSheet);
            let inner=''; for(let i=0;i<onThisSheet;i++) inner+=idFrontHtml(name,dept,photo);
            out.append(makePage('label-page employee-sheet-page',inner));
          }
          finishCodes(out);
          if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
          LWHUI.toast(`Generated ${copies} front(s) across ${sheets} sheet(s) — cut along each badge's border`);
        }
      }
      LWHStorage.set('printJobs',(+LWHStorage.get('printJobs',0))+1);
    });
  }

  function applyModeUi(){
    const isId=ebType==='idbadge';
    el('ebDeptLabel').hidden=!isId;
    el('ebPhotoLabel').hidden=!isId;
    el('ebGenCardLabel').textContent=isId?'Front & Back (CR80, Portrait)':'Single CR80 Card';
    el('ebModeHint').textContent=isId
      ? 'Full company badge: your logo/tagline, employee photo, name, and title on the front; the scan barcode on the back. Prints portrait so it reads right-side-up on a lanyard (2.125×3.375in).'
      : 'Simple badge for time clock scanning: name, ID, and a barcode. Prints landscape at exact CR80 size (3.375×2.125in).';
  }

  window.addEventListener('load',()=>{
    if(!el('empBadgeForm')) return;
    const tabs=el('ebTypeTabs');
    if(tabs) tabs.addEventListener('click',e=>{
      const b=e.target.closest('[data-ebtype]'); if(!b) return;
      tabs.querySelectorAll('.seg').forEach(s=>s.classList.toggle('active',s===b));
      ebType=b.dataset.ebtype;
      applyModeUi();
    });
    applyModeUi();
    const cardBtn=el('ebGenCard'); if(cardBtn) cardBtn.onclick=()=>generate('card');
    const sheetBtn=el('ebGenSheet'); if(sheetBtn) sheetBtn.onclick=()=>generate('sheet');
  });
})();
