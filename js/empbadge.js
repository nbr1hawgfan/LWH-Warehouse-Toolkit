(function(){
  function el(id){ return document.getElementById(id); }
  function safe(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

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

  function frontHtml(name,dept,photo){
    const logo=LWHStorage.get('companyLogo','');
    const tagline=LWHStorage.get('companyTagline','');
    const brand=LWHStorage.get('primaryColor','#0f4a45');
    return `<div class="employee-badge id-front">
      ${logo?`<img class="id-logo" src="${logo}" />`:''}
      ${tagline?`<div class="id-tagline" style="color:${safe(brand)}">${safe(tagline)}</div>`:''}
      ${photo?`<img class="id-photo" src="${photo}" />`:'<div class="id-photo id-photo-placeholder"></div>'}
      <div class="id-name">${safe(name)}</div>
      ${dept?`<div class="id-dept" style="color:${safe(brand)}">${safe(dept)}</div>`:''}
    </div>`;
  }
  function backHtml(id,codeType){
    const codeBlock=codeType==='qr'
      ? `<div class="qrbox eb-qr" data-qr="${safe(id)}" data-size="90"></div>`
      : `<svg class="eb-barcode" data-barcode="${safe(id)}" data-height="42" data-width="1.6"></svg>`;
    return `<div class="employee-badge id-back">${codeBlock}<div class="eb-id">${safe(id)}</div></div>`;
  }

  function finishCodes(root){
    root.querySelectorAll('.eb-barcode').forEach(svg=>{ if(window.LWHBarcode){ try{ LWHBarcode.make(svg,svg.dataset.barcode,{height:+svg.dataset.height||42,width:+svg.dataset.width||1.6}); }catch(e){} } });
    root.querySelectorAll('.eb-qr').forEach(q=>{ if(window.LWHQR) LWHQR.make(q,q.dataset.qr,+q.dataset.size||90); });
  }

  function generate(mode){
    const out=el('empBadgeOutput'); if(!out) return;
    const name=(el('ebName').value||'').trim(), id=(el('ebId').value||'').trim(), dept=(el('ebDept').value||'').trim(), codeType=el('ebCodeType').value;
    if(!name){ alert('Enter at least an Employee Name.'); return; }
    if(mode==='card' && !id){ alert('Front & Back mode needs a Secure ID for the back barcode.'); return; }

    LWHUI.readFile(el('ebPhoto'),photo=>{
      out.innerHTML='';
      if(mode==='card'){
        out.append(makePage('label-page employee-badge-page',frontHtml(name,dept,photo)));
        out.append(makePage('label-page employee-badge-page',backHtml(id,codeType)));
        finishCodes(out);
        if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(3.375,2.125);
        LWHUI.toast('Front & back ready — 2 pages');
      } else {
        const copies=Math.max(1,+el('ebCopies').value||1);
        const perSheet=8; // 2 columns x 4 rows fits comfortably on a Letter page with margin
        const sheets=Math.ceil(copies/perSheet);
        for(let s=0;s<sheets;s++){
          const onThisSheet=Math.min(perSheet,copies-s*perSheet);
          let inner='';
          for(let i=0;i<onThisSheet;i++) inner+=frontHtml(name,dept,photo);
          out.append(makePage('label-page employee-sheet-page',inner));
        }
        finishCodes(out);
        if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
        LWHUI.toast(`Generated ${copies} front(s) across ${sheets} sheet(s) — cut along each badge's border`);
      }
      LWHStorage.set('printJobs',(+LWHStorage.get('printJobs',0))+1);
    });
  }

  window.addEventListener('load',()=>{
    if(!el('empBadgeForm')) return;
    const cardBtn=el('ebGenCard'); if(cardBtn) cardBtn.onclick=()=>generate('card');
    const sheetBtn=el('ebGenSheet'); if(sheetBtn) sheetBtn.onclick=()=>generate('sheet');
  });
})();
