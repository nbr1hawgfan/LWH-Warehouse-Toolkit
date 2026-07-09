(function(){
  const GMP_QUESTIONS=[
    'Evidence of odor?',
    'Debris on floor or in corners?',
    'Evidence of rodent activity?',
    'Previous product residue?',
    'Sidewall or ceiling damage?',
    'Holes in floor or roof?',
    'Nails or other objects protruding from floor or walls?',
    'Evidence or leaks, moisture, standing water?',
    'Problems with door latching?',
    'Is trailer unsealable?'
  ];
  const PRESHIP_QUESTIONS=[
    'Have all instructions on Bill of Lading been followed?',
    'Does trailer latch properly?',
    'Has the trailer been sealed?',
    'If a COA is requested has driver been given copy?',
    'Has dunnage been placed where necessary if required?',
    'Inspection sheet turned into office to send with BOL?'
  ];

  function el(id){ return document.getElementById(id); }
  function safe(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  function buildQuestionRow(q,idx,prefix){
    return `<div class="grid-2" style="align-items:center;margin-bottom:4px"><span style="font-weight:400">${safe(q)}</span><select id="${prefix}_${idx}"><option value="">— Not checked —</option><option value="yes">Yes</option><option value="no">No</option></select></div>`;
  }

  function renderLists(){
    const gmp=el('tcGmpList'), preship=el('tcPreShipList');
    if(gmp) gmp.innerHTML=GMP_QUESTIONS.map((q,i)=>buildQuestionRow(q,i,'tcGmp')).join('');
    if(preship) preship.innerHTML=PRESHIP_QUESTIONS.map((q,i)=>buildQuestionRow(q,i,'tcPreShip')).join('');
  }

  function answerFor(prefix,idx){ const s=el(prefix+'_'+idx); return s?s.value:''; }

  function tableRows(questions,prefix){
    return questions.map((q,i)=>{
      const a=answerFor(prefix,i);
      return `<tr><td class="tc-x">${a==='yes'?'X':''}</td><td class="tc-x">${a==='no'?'X':''}</td><td>${safe(q)}</td></tr>`;
    }).join('');
  }

  function formatDate(v){
    if(!v) return '';
    const [y,m,d]=v.split('-');
    return (m&&d&&y)?`${m}-${d}-${y}`:v;
  }
  function formatTime(v){
    if(!v) return '';
    const [h,mi]=v.split(':');
    if(h===undefined) return v;
    const hh=((+h+11)%12)+1, ampm=(+h>=12)?'PM':'AM';
    return `${hh}:${mi} ${ampm}`;
  }

  function checklistHtml(){
    const door=el('tcDoor').value, date=formatDate(el('tcDate').value), time=formatTime(el('tcTime').value),
      carrier=el('tcCarrier').value, trailer=el('tcTrailer').value, seal=el('tcSeal').value,
      driverName=el('tcDriverName').value, driverLicense=el('tcDriverLicense').value, notes=el('tcNotes').value;

    return `<div class="checklist-page">
      <div class="tc-doortag">${door?('Door '+safe(door)):''}</div>
      <h1 class="tc-title">Trailer Pre-Loading Checklist</h1>
      <div class="tc-headrow">
        <div>
          <div><b>Date:</b> ${safe(date)}</div>
          <div><b>Carrier Name:</b> ${safe(carrier)}</div>
          <div><b>Seal Number:</b> ${safe(seal)}</div>
          <div><b>Driver Name:</b> ${safe(driverName)}</div>
          <div><b>Driver's License #:</b> ${safe(driverLicense)}</div>
        </div>
        <div class="tc-headright">
          <div><b>Time:</b> ${safe(time)}</div>
          <div><b>Trailer Number:</b> ${safe(trailer)}</div>
        </div>
      </div>

      <h2 class="tc-section">Drivers and Loaders</h2>
      <p class="tc-instructions">Please make sure you check the following to ensure the trailer is suitable to load. If any box is checked yes, notify the manager or supervisor.</p>
      <h3 class="tc-subsection">General Trailer GMP</h3>
      <table class="tc-table"><thead><tr><th>YES</th><th>NO</th><th></th></tr></thead><tbody>${tableRows(GMP_QUESTIONS,'tcGmp')}</tbody></table>
      <div class="tc-notes"><b>Notes/Comments:</b> ${safe(notes)}</div>
      <p class="tc-warning">Any item on this checklist could cause the trailer to be rejected</p>

      <div class="tc-box">
        <h3 class="tc-subsection">Pre-Shipment Checklist</h3>
        <table class="tc-table"><thead><tr><th>YES</th><th>NO</th><th></th></tr></thead><tbody>${tableRows(PRESHIP_QUESTIONS,'tcPreShip')}</tbody></table>
      </div>

      <p class="tc-ack">We acknowledge that this load is leaving in good condition and that all customer request and instructions have been met.</p>
      <div class="tc-sig">Loader Signature: <span class="tc-sigline"></span></div>
      <div class="tc-sig">Manager/Supervisor Signature: <span class="tc-sigline"></span></div>
    </div>`;
  }

  function generate(){
    const out=el('trailerPrintOutput'); if(!out) return;
    out.innerHTML=checklistHtml();
    if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11); // full 8.5x11 page, not a small label
    LWHUI.toast('Checklist generated');
  }

  function clearForm(){
    ['tcDoor','tcDate','tcTime','tcCarrier','tcTrailer','tcSeal','tcDriverName','tcDriverLicense','tcNotes'].forEach(id=>{ const f=el(id); if(f) f.value=''; });
    GMP_QUESTIONS.forEach((_,i)=>{ const s=el('tcGmp_'+i); if(s) s.value=''; });
    PRESHIP_QUESTIONS.forEach((_,i)=>{ const s=el('tcPreShip_'+i); if(s) s.value=''; });
    const out=el('trailerPrintOutput'); if(out) out.innerHTML='';
  }

  window.addEventListener('load',()=>{
    if(!el('trailerForm')) return;
    renderLists();
    const genBtn=el('tcGenerate'); if(genBtn) genBtn.onclick=generate;
    const clearBtn=el('tcClear'); if(clearBtn) clearBtn.onclick=clearForm;
    // Default Date/Time to right now, purely for convenience — still fully editable.
    const d=el('tcDate'); if(d && !d.value) d.value=new Date().toISOString().slice(0,10);
    const t=el('tcTime'); if(t && !t.value){ const now=new Date(); t.value=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'); }
  });
})();
