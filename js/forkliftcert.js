(function(){
  // FORKLIFT CERTIFICATION (v1.76.0)
  //
  // Three screens:
  //   forkliftTest  — employee: enter ID → pick manager + equipment → written
  //                   test (random questions, shuffled answers) → result.
  //   forkliftCerts — managers (manager sign-in, js/mgrauth.js): driving evaluation
  //                   sign-off → certificate issued; reprint certificate /
  //                   wallet card / PDF any time; revoke; settings; export.
  //   fcVerify      — anyone: the QR on certificates and wallet cards lands
  //                   here (?view=fcVerify&cert=LWH-FL-2026-0001).
  //
  // Records live in Supabase (sql/forklift_certs.sql). Correct answers never
  // come to the phone — the database scores the test. Emails go through the
  // Apps Script in gas/ForkliftCertMailer.gs; the app only hands it a
  // one-time token, the script asks the database who to send to.
  const SUPABASE_URL='https://tjivcqxnkftujceumdtx.supabase.co';
  const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqaXZjcXhua2Z0dWpjZXVtZHR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTE5NDMsImV4cCI6MjEwMDQ2Nzk0M30.GzDc-_u92jvAHq7eG1X-1cet5Av9qF3ZDEVJMRKEP0E';
  const APP_URL='https://nbr1hawgfan.github.io/LWH-Warehouse-Toolkit/';

  // Equipment an operator can be certified on (OSHA treats each type separately).
  const TRUCK_TYPES=[
    {id:'Sit-down counterbalance', hint:'Propane or electric, sit-down rider'},
    {id:'Stand-up reach truck',    hint:'Stand-up, reach / narrow aisle'},
    {id:'Order picker',            hint:'Operator rides up with the forks'},
    {id:'Electric pallet jack',    hint:'Rider or walkie'}
  ];

  // Driving evaluation checklist (OSHA 1910.178(l)(2)(ii) — evaluation of
  // the operator's performance in the workplace).
  const CHECKLIST=[
    {id:'inspect',  label:'Pre-use inspection done and documented'},
    {id:'mount',    label:'Three points of contact, seatbelt on'},
    {id:'controls', label:'Smooth starts, stops and steering; safe speed'},
    {id:'travel',   label:'Looks in direction of travel; horn at intersections and blind spots'},
    {id:'peds',     label:'Yields to pedestrians; keeps safe braking distance'},
    {id:'pickup',   label:'Picks up loads square, forks fully under, mast tilted back'},
    {id:'carry',    label:'Travels with load 2–3 in. off the floor, stable'},
    {id:'stack',    label:'Stacks / unstacks at height safely'},
    {id:'ramp',     label:'Ramps & trailers: load uphill, checks chocks / trailer restraint'},
    {id:'park',     label:'Parks right: forks down, neutral, brake set, key off'},
    {id:'fuel',     label:'Refuel / charging procedure'}
  ];
  const CHK_VALUES=[['pass','Pass'],['fail','Needs work'],['na','N/A']];

  const STATE_LABEL={active:'Active',expiring:'Expiring soon',expired:'Expired',revoked:'Revoked',superseded:'Replaced'};

  function el(id){ return document.getElementById(id); }
  function safe(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function todayIso(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function parseDate(s){ const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m?new Date(+m[1],+m[2]-1,+m[3]):null; }
  function fmtDate(s){ const d=parseDate(s); return d?d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):''; }
  function fmtNum(s){ const d=parseDate(s); return d?`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`:''; }
  function fmtStamp(s){ if(!s) return ''; const d=new Date(s); return isNaN(d)?'':d.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}); }
  function pct(n){ return (Math.round((+n||0)*10)/10).toString().replace(/\.0$/,'')+'%'; }
  function trucksText(c,sep){ return (c.truck_types||[]).length?(c.truck_types||[]).join(sep||', '):'Equipment not recorded'; }
  function needsInfo(c){ return ['active','expiring'].includes(c.state) && (!c.emp_id || !(c.truck_types||[]).length); }
  function verifyUrl(certNo){ return APP_URL+'?view=fcVerify&cert='+encodeURIComponent(certNo); }
  function toast(m){ if(window.LWHUI) LWHUI.toast(m); }

  async function rpc(fn,args){
    const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`,{
      method:'POST',
      headers:{'apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+SUPABASE_ANON_KEY,'Content-Type':'application/json'},
      body:JSON.stringify(args||{})
    });
    if(!res.ok){ let t=''; try{ t=await res.text(); }catch{} throw new Error('HTTP '+res.status+(t?' — '+t.slice(0,160):'')); }
    return res.json();
  }

  const ERRORS={
    not_found:'Employee ID not found in the timeclock. Double-check the number, or see your supervisor.',
    inactive:'This employee ID is marked inactive. See your supervisor.',
    need_manager:'Pick your manager.',
    need_truck:'Check at least one piece of equipment.',
    bad_email:'That email address doesn\'t look right.',
    not_enough_questions:'Not enough active test questions — a manager needs to add some in Forklift Certs → Settings.',
    already_submitted:'This test was already turned in.',
    expired:'This test was open more than 3 hours and was closed. Please start again.',
    need_evaluator:'Enter the evaluator\'s name.',
    not_pending:'This one is no longer waiting on a driving evaluation — refresh.',
    bad_date:'Evaluation date can\'t be in the future.',
    need_reason:'Enter a reason.',
    bad_value:'One of the settings is out of range (at least 12 questions, pass mark 50–100, 1–3 years).',
    need_name:'Enter a name.',
    emp_not_found:'That employee ID isn\'t in the timeclock.',
    need_training:'Finish classroom training first.',
    no_cert:'They don\'t have a current or expired certification to renew — they need the full classroom training.',
    modules_left:'A training module isn\'t finished yet.',
    bad_question:'Each question needs text, at least 2 answer choices, and the correct answer must match one of them exactly.'
  };
  function errText(code){ return ERRORS[code]||(LWHMgr.isAuthError(code)?LWHMgr.errText(code):('Something went wrong ('+code+').')); }

  // ---------------------------------------------------------------------
  // Shared: logo, QR images, certificate PDF, printing, email
  // ---------------------------------------------------------------------
  let logoData=null;
  function loadLogo(){
    if(logoData) return Promise.resolve(logoData);
    return new Promise(ok=>{
      const img=new Image();
      img.onload=()=>{ try{
        // Downsized JPEG on white keeps the emailed PDF small (~100 KB, not 2 MB).
        const k=Math.min(1,420/img.naturalWidth), c=document.createElement('canvas');
        c.width=Math.round(img.naturalWidth*k); c.height=Math.round(img.naturalHeight*k);
        const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0,c.width,c.height);
        logoData={url:c.toDataURL('image/jpeg',0.9),w:c.width,h:c.height,fmt:'JPEG'};
      }catch{ logoData=null; } ok(logoData); };
      img.onerror=()=>ok(null);
      img.src='./icons/company-logo.png';
    });
  }
  function qrDataUrl(text,size){
    if(typeof QRCode==='undefined') return null;
    const box=document.createElement('div');
    new QRCode(box,{text:String(text),width:size||300,height:size||300,correctLevel:QRCode.CorrectLevel.M});
    const c=box.querySelector('canvas');
    return c?c.toDataURL('image/png'):null;
  }

  // Vector PDF certificate, landscape Letter. Used for the email attachment
  // and "Download PDF". The printed version (certHtml) mirrors this layout.
  async function certPdf(c){
    if(!window.jspdf||!window.jspdf.jsPDF) throw new Error('PDF tool didn\'t load — check your internet connection.');
    const logo=await loadLogo();
    const doc=new window.jspdf.jsPDF({orientation:'landscape',unit:'in',format:'letter'});
    const W=11,H=8.5,RED=[200,16,46],INK=[28,28,43],MUTED=[92,92,107];
    doc.setDrawColor(...RED); doc.setLineWidth(0.08); doc.rect(0.35,0.35,W-0.7,H-0.7);
    doc.setDrawColor(...INK); doc.setLineWidth(0.015); doc.rect(0.5,0.5,W-1,H-1);
    let y=0.75;
    if(logo){ const lh=1.05, lw=lh*logo.w/logo.h; doc.addImage(logo.url,logo.fmt,(W-lw)/2,y,lw,lh); y+=lh+0.38; } else y+=0.4;
    doc.setTextColor(...RED); doc.setFont('helvetica','bold'); doc.setFontSize(30);
    doc.text('CERTIFICATE OF COMPLETION',W/2,y,{align:'center'}); y+=0.34;
    doc.setTextColor(...INK); doc.setFontSize(13); doc.setFont('helvetica','normal');
    doc.text('Powered Industrial Truck (Forklift) Operator',W/2,y,{align:'center'}); y+=0.55;
    doc.setFontSize(12); doc.setTextColor(...MUTED); doc.text('This certifies that',W/2,y,{align:'center'}); y+=0.5;
    doc.setTextColor(...INK); doc.setFont('helvetica','bold'); doc.setFontSize(30);
    doc.text(String(c.name||''),W/2,y,{align:'center'});
    doc.setDrawColor(...INK); doc.setLineWidth(0.01); doc.line(W/2-3,y+0.12,W/2+3,y+0.12); y+=0.38;
    doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(...MUTED);
    doc.text([c.emp_id?'Employee ID '+c.emp_id:'', c.location&&c.location!=='Not Assigned'?c.location:''].filter(Boolean).join('   ·   '),W/2,y,{align:'center'}); y+=0.42;
    doc.setTextColor(...INK); doc.setFontSize(12);
    const body=certBody(c);
    const lines=doc.splitTextToSize(body,7.6); doc.text(lines,W/2,y,{align:'center'}); y+=lines.length*0.2+0.12;
    doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(...RED);
    doc.text((c.truck_types||[]).length?c.truck_types.join('   ·   '):'Powered industrial trucks (forklifts)',W/2,y,{align:'center'}); y+=0.5;
    // detail row
    const cols=certCols(c);
    const cw=1.85, x0=W/2-cw*cols.length/2;
    cols.forEach((col,i)=>{ const cx=x0+cw*i+cw/2;
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...MUTED); doc.text(col[0].toUpperCase(),cx,y,{align:'center'});
      doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(...(i===cols.length-1?RED:INK)); doc.text(col[1]||'—',cx,y+0.24,{align:'center'}); });
    // signatures + QR
    const sy=H-1.05;
    doc.setDrawColor(...INK); doc.setLineWidth(0.01);
    doc.line(1.0,sy,3.9,sy); doc.line(4.3,sy,7.2,sy);
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(...INK);
    doc.text(String(c.evaluator||''),1.0,sy-0.08);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
    doc.text('Evaluator / Trainer',1.0,sy+0.18); doc.text('Manager',4.3,sy+0.18);
    const qr=qrDataUrl(verifyUrl(c.cert_no),300);
    if(qr) doc.addImage(qr,'PNG',W-2.25,H-2.05,1.15,1.15);
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(...INK);
    doc.text(String(c.cert_no),W-1.675,H-0.72,{align:'center'});
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text('Scan to verify',W-1.675,H-0.58,{align:'center'});
    doc.setProperties({title:'Forklift Certificate — '+c.name,subject:c.cert_no,author:'Logistics Warehouse'});
    return doc;
  }
  function certCols(c){
    return c.source==='import'
      ? [['Certified',fmtNum(c.issued_on)],['Expires',fmtNum(c.expires_on)]]
      : [['Classroom training',c.training_waived?'Recert':fmtNum(c.training_date)],['Written test',fmtNum(c.written_date)],['Driving evaluation',fmtNum(c.practical_date)],['Expires',fmtNum(c.expires_on)]];
  }
  function certBody(c){
    return c.written_score!=null
      ? `has completed formal instruction, passed the written knowledge test (${pct(c.written_score)}), and passed a practical driving evaluation in the workplace, as required by OSHA 29 CFR 1910.178(l), and is authorized to operate:`
      : 'has completed formal instruction, a written knowledge test, and a practical driving evaluation in the workplace, as required by OSHA 29 CFR 1910.178(l), and is authorized to operate:';
  }
  function pdfName(c){ return `Forklift_Certificate_${String(c.name||'').replace(/[^A-Za-z0-9]+/g,'_')}_${c.cert_no}.pdf`; }
  async function downloadPdf(c){
    try{ const doc=await certPdf(c); doc.save(pdfName(c)); }
    catch(e){ alert(e.message); }
  }

  // Printed certificate (HTML) — 11 × 8.5 landscape.
  function certHtml(c){
    const logo='./icons/company-logo.png';
    return `<div class="fcp-cert">
      <div class="fcp-inner">
        <img class="fcp-logo" src="${logo}" alt="" />
        <div class="fcp-title">CERTIFICATE OF COMPLETION</div>
        <div class="fcp-sub">Powered Industrial Truck (Forklift) Operator</div>
        <div class="fcp-certifies">This certifies that</div>
        <div class="fcp-name">${safe(c.name)}</div>
        <div class="fcp-meta">${[c.emp_id?'Employee ID '+safe(c.emp_id):'', c.location&&c.location!=='Not Assigned'?safe(c.location):''].filter(Boolean).join(' &nbsp;·&nbsp; ')||'&nbsp;'}</div>
        <div class="fcp-body">${safe(certBody(c))}</div>
        <div class="fcp-trucks">${(c.truck_types||[]).length?c.truck_types.map(safe).join(' &nbsp;·&nbsp; '):'Powered industrial trucks (forklifts)'}</div>
        <div class="fcp-cols">${certCols(c).map((col,i,a)=>`<div><span>${col[0]}</span><b${i===a.length-1?' class="fcp-red"':''}>${col[1]||'—'}</b></div>`).join('')}</div>
        <div class="fcp-foot">
          <div class="fcp-sig"><b>${safe(c.evaluator)}</b><div class="fcp-line"></div><span>Evaluator / Trainer</span></div>
          <div class="fcp-sig"><b>&nbsp;</b><div class="fcp-line"></div><span>Manager</span></div>
          <div class="fcp-qr"><div class="qrbox fc-qr" data-qr="${safe(verifyUrl(c.cert_no))}" data-size="110"></div><b>${safe(c.cert_no)}</b><span>Scan to verify</span></div>
        </div>
      </div>
    </div>`;
  }

  // Wallet card — CR80 landscape (3.375 × 2.125), front + back, for the
  // plastic card printer. Same calibration offsets as Employee Badges.
  function walletFront(c,photo){
    return `<div class="fcw-card fcw-front">
      <div class="fcw-band"><img src="./icons/company-logo.png" alt="" /><div><div class="fcw-co">LOGISTICS WAREHOUSE</div><div class="fcw-kind">CERTIFIED FORKLIFT OPERATOR</div></div></div>
      <div class="fcw-mid">
        ${photo?`<img class="fcw-photo" src="${photo}" alt="" />`:''}
        <div class="fcw-who">
          <div class="fcw-name">${safe(c.name)}</div>
          <div class="fcw-id">${[c.emp_id?'ID '+safe(c.emp_id):'', c.location&&c.location!=='Not Assigned'?safe(c.location):''].filter(Boolean).join(' · ')}</div>
          <div class="fcw-exp"><span>EXPIRES</span> ${fmtNum(c.expires_on)}</div>
        </div>
      </div>
    </div>`;
  }
  function walletBack(c){
    return `<div class="fcw-card fcw-back">
      <div class="fcw-back-l">
        <div class="fcw-h">AUTHORIZED EQUIPMENT</div>
        <ul class="fcw-list">${(c.truck_types||[]).length?c.truck_types.map(t=>`<li>${safe(t)}</li>`).join(''):'<li>Powered industrial trucks</li>'}</ul>
        <table class="fcw-tbl">
          <tr><td>Issued</td><td>${fmtNum(c.issued_on)}</td></tr>
          <tr><td>Expires</td><td>${fmtNum(c.expires_on)}</td></tr>
          <tr><td>Evaluator</td><td>${safe(c.evaluator)}</td></tr>
        </table>
        <div class="fcw-fine">Carry while operating. OSHA 29 CFR 1910.178(l).</div>
      </div>
      <div class="fcw-back-r"><div class="qrbox fc-qr" data-qr="${safe(verifyUrl(c.cert_no))}" data-size="88"></div><div class="fcw-no">${safe(c.cert_no)}</div><div class="fcw-scan">Scan to verify</div></div>
    </div>`;
  }
  function calibratedPage(cls,html){
    const d=document.createElement('div');
    d.className='label-page '+cls; d.innerHTML=html;
    const x=+LWHStorage.get('calX',0), y=+LWHStorage.get('calY',0), sc=+LWHStorage.get('calScale',100);
    d.style.transform=`translate(${x}px,${y}px) scale(${sc/100})`; d.style.transformOrigin='top left';
    return d;
  }
  function finishQrs(root){ root.querySelectorAll('.fc-qr').forEach(q=>{ if(window.LWHQR) LWHQR.make(q,q.dataset.qr,+q.dataset.size||100); }); }
  function setPage(w,h){ if(window.LWHLabels&&LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(w,h); }
  function printWhenReady(area){
    const imgs=[...area.querySelectorAll('img')].filter(i=>!i.complete);
    Promise.all(imgs.map(i=>new Promise(ok=>{ i.onload=i.onerror=ok; }))).then(()=>setTimeout(()=>window.print(),150));
  }
  function printCert(c,areaId){
    const area=el(areaId); area.innerHTML='';
    const pg=document.createElement('div'); pg.className='fcp-page'; pg.innerHTML=certHtml(c);
    area.append(pg); finishQrs(area); setPage(11,8.5); printWhenReady(area);
    LWHStorage.set('printJobs',(+LWHStorage.get('printJobs',0))+1);
  }
  function printWallet(c,areaId,photo){
    const area=el(areaId); area.innerHTML='';
    area.append(calibratedPage('fcw-page',walletFront(c,photo)));
    area.append(calibratedPage('fcw-page',walletBack(c)));
    finishQrs(area); setPage(3.375,2.125); printWhenReady(area);
    LWHStorage.set('printJobs',(+LWHStorage.get('printJobs',0))+1);
  }

  // Email through the Apps Script. Returns {ok, sent_to[]} | {skipped:true} | throws.
  async function sendMail(mailerUrl,kind,id,token,cert){
    if(!mailerUrl) return {skipped:true};
    const body={kind,id:String(id),token};
    if(kind==='cert' && cert){
      const doc=await certPdf(cert);
      body.pdf=doc.output('datauristring').split(',')[1];
      body.filename=pdfName(cert);
    }
    const res=await fetch(mailerUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body)});
    const out=await res.json();
    if(!out||!out.ok) throw new Error((out&&out.error)||'Mailer error');
    return out;
  }
  function mailLine(r){
    if(!r) return '';
    if(r.skipped) return 'Email isn\'t set up yet (Forklift Certs → Settings → Mailer URL).';
    if(r.error) return 'Email didn\'t send: '+r.error;
    const n=(r.sent_to||[]).length;
    return n?`Emailed to ${n} ${n===1?'person':'people'}: ${(r.sent_to||[]).join(', ')}`:'No email addresses on file to send to.';
  }

  // =====================================================================
  // EMPLOYEE — Forklift Test
  // =====================================================================
  const T={emp:null,info:null,attempt:null,questions:[],answers:{},idx:0,busy:false};
  const TR={id:null,done:{},idx:0,left:0,timer:null,busy:false};
  function trainingModules(){ return (window.LWH_FORKLIFT_TRAINING&&LWH_FORKLIFT_TRAINING.modules)||[]; }

  function showStep(name){
    ['Id','Info','Train','Test','Result'].forEach(s=>{ el('fcStep'+s).hidden=(s!==name); });
    if(name!=='Train') stopTrainTimer();
    window.scrollTo(0,0);
  }
  function resetTest(){
    Object.assign(T,{emp:null,info:null,attempt:null,questions:[],answers:{},idx:0,busy:false});
    el('fcEmpId').value=''; el('fcIdStatus').textContent=''; el('fcStartStatus').textContent='';
    el('fcEmail').value=''; el('fcTrained').checked=false;
    showStep('Id'); el('fcEmpId').focus();
  }

  async function lookupEmp(){
    const id=String(el('fcEmpId').value||'').replace(/\D/g,'');
    const st=el('fcIdStatus');
    if(!/^\d{5}$/.test(id)){ st.textContent='Enter your 5-digit employee ID.'; return; }
    st.style.color='var(--muted)'; st.textContent='Looking you up…';
    try{
      const r=await rpc('fc_lookup_employee',{p_emp_id:Number(id)});
      st.style.color='';
      if(!r||!r.found){ st.textContent=errText('not_found'); return; }
      if(r.emp&&r.emp.active===false){ st.textContent=errText('inactive'); return; }
      st.textContent='';
      T.info=r; T.emp=r.emp;
      renderInfo();
      showStep('Info');
    }catch(e){ st.style.color=''; st.textContent='Couldn\'t reach the server — check your connection. ('+e.message+')'; }
  }

  function renderInfo(){
    const r=T.info, e=r.emp;
    el('fcEmpBox').innerHTML=`<div class="fc-emp-name">${safe(e.name)}</div><div class="hint">ID ${safe(e.id)}${e.location?' · '+safe(e.location):''}${e.team?' · '+safe(e.team):''}</div>`;
    let box='';
    if(r.cert){
      const c=r.cert;
      box+=`<div class="fc-note fc-note-${c.state==='active'?'ok':c.state==='expiring'?'warn':'bad'}">
        <b>${c.state==='expired'?'Your certification expired':'You are certified'}</b>${(c.truck_types||[]).length?' — '+safe(c.truck_types.join(', ')):''}.<br>
        Cert ${safe(c.cert_no)} · ${c.state==='expired'?'expired':'expires'} ${fmtDate(c.expires_on)}${c.state==='expiring'?` (${c.days_left} days)`:''}.
        <div class="fc-note-act"><button type="button" class="ghost" id="fcMyPdf">Download my certificate</button></div>
        ${c.state==='active'?'<div class="hint" style="margin-top:6px">You only need to retest when it\'s close to expiring, after an incident, or if your manager asks.</div>':''}
      </div>`;
    }
    if(r.pending){
      box+=`<div class="fc-note fc-note-warn"><b>Written test passed (${pct(r.pending.score_pct)})</b> on ${fmtStamp(r.pending.submitted_at)}.<br>Next step: your manager or trainer does your driving evaluation. You don't need to take the test again.</div>`;
    }
    el('fcCertBox').innerHTML=box;
    const pdfBtn=el('fcMyPdf'); if(pdfBtn) pdfBtn.onclick=()=>downloadPdf(r.cert);

    const mgrs=r.managers||[];
    el('fcManager').innerHTML='<option value="">— Pick your manager —</option>'+mgrs.map(m=>`<option value="${m.id}">${safe(m.name)}${m.location?' — '+safe(m.location):''}</option>`).join('');
    // Pre-pick a manager at the employee's location when there's only one.
    const local=mgrs.filter(m=>m.location&&e.location&&m.location.toLowerCase()===e.location.toLowerCase());
    if(local.length===1) el('fcManager').value=local[0].id;
    if(!mgrs.length) el('fcStartStatus').textContent='No managers set up yet — a manager needs to add them in Forklift Certs → Settings.';

    const prev=(r.cert&&r.cert.truck_types)||[];
    el('fcTrucks').innerHTML=TRUCK_TYPES.map((t,i)=>`<label class="fc-check"><input type="checkbox" value="${safe(t.id)}" ${prev.includes(t.id)?'checked':''} id="fcTr${i}" /><span><b>${safe(t.id)}</b><small>${safe(t.hint)}</small></span></label>`).join('');
    el('fcTrainDate').value=todayIso(); el('fcTrainDate').max=todayIso();
    el('fcStartBtn').textContent=`Start Test — ${r.questions_per_test} questions, ${pct(r.pass_pct)} to pass`;
    const needTrain=r.require_training!==false && !r.training;
    const mods=trainingModules(), mins=Math.round(mods.reduce((s,m)=>s+m.minSec,0)/60);
    el('fcTrainBox').innerHTML=r.pending?'':(r.training
      ? (r.training.waived_by
        ? `<div class="fc-note fc-note-ok"><b>Recertification</b> — classroom training waived by ${safe(r.training.waived_by)} on ${fmtStamp(r.training.completed_at)}. Go straight to the test. <button type="button" class="mh-link" id="fcTrReview">Review the training anyway</button></div>`
        : `<div class="fc-note fc-note-ok"><b>Classroom training done</b> ${fmtStamp(r.training.completed_at)} — good until ${fmtDate(String(r.training.good_until).slice(0,10))}. <button type="button" class="mh-link" id="fcTrReview">Review it again</button></div>`)
      : (r.require_training!==false
        ? `<div class="fc-train-cta"><div class="mh-field-label">Step 1 of 3</div><b>Classroom training</b><div class="hint">${mods.length} short modules with videos, about ${mins} minutes. Use headphones if you're on the floor. You can stop and pick up where you left off.</div><button type="button" id="fcTrStart" class="mh-show-btn" style="margin-top:10px">Start Classroom Training</button></div>`
        : ''));
    const ts=el('fcTrStart'); if(ts) ts.onclick=startTraining;
    const rv=el('fcTrReview'); if(rv) rv.onclick=()=>startTraining(true);
    el('fcSelfTrain').hidden=r.require_training!==false;
    el('fcStartForm').hidden=!!r.pending || needTrain;
  }

  async function startTest(){
    if(T.busy) return;
    const st=el('fcStartStatus'); st.style.color='';
    const mgr=el('fcManager').value;
    const trucks=[...el('fcTrucks').querySelectorAll('input:checked')].map(i=>i.value);
    if(!mgr){ st.textContent=errText('need_manager'); el('fcManager').focus(); return; }
    if(!trucks.length){ st.textContent=errText('need_truck'); return; }
    if(!el('fcSelfTrain').hidden && !el('fcTrained').checked){ st.textContent='Check the box to confirm you completed classroom training.'; return; }
    T.busy=true; st.style.color='var(--muted)'; st.textContent='Getting your test…';
    try{
      const r=await rpc('fc_start_test',{p_emp_id:Number(T.emp.id),p_email:el('fcEmail').value.trim(),p_manager_id:Number(mgr),p_truck_types:trucks,p_training_date:el('fcTrainDate').value||null});
      st.style.color='';
      if(!r.ok){
        if(r.error==='need_training'){ st.textContent='Finish classroom training first.'; return; }
        st.textContent=r.error==='too_many_attempts'
          ? `You've reached the limit of tries for today. You can try again after ${fmtStamp(r.retry_at)}. Talk to your trainer about the topics you missed.`
          : errText(r.error);
        return;
      }
      st.textContent='';
      T.attempt=r.attempt_id; T.questions=r.questions; T.answers={}; T.idx=0; T.passPct=r.pass_pct;
      showStep('Test'); renderQuestion();
    }catch(e){ st.style.color=''; st.textContent='Couldn\'t start the test — check your connection. ('+e.message+')'; }
    finally{ T.busy=false; }
  }

  // ---------- Classroom training ----------
  async function startTraining(review){
    const mods=trainingModules(); if(!mods.length){ alert('Training content didn\'t load — refresh the page.'); return; }
    if(review===true){ TR.id=null; TR.done={}; TR.review=true; TR.idx=0; showStep('Train'); renderModule(); return; }
    TR.review=false;
    const st=el('fcStartStatus'); st.style.color='var(--muted)'; st.textContent='Opening training…';
    try{
      const r=await rpc('fc_training_start',{p_emp_id:Number(T.emp.id),p_module_count:mods.length,p_version:LWH_FORKLIFT_TRAINING.VERSION});
      st.style.color=''; st.textContent='';
      if(!r.ok){ st.textContent=errText(r.error); return; }
      TR.id=r.training_id; TR.done=r.modules||{};
      TR.idx=Math.max(0,mods.findIndex(m=>!TR.done[m.id])); if(TR.idx<0) TR.idx=mods.length-1;
      showStep('Train'); renderModule();
    }catch(e){ st.style.color=''; st.textContent='Couldn\'t open training — check your connection. ('+e.message+')'; }
  }
  function stopTrainTimer(){ clearInterval(TR.timer); TR.timer=null; }
  function renderModule(){
    stopTrainTimer();
    const mods=trainingModules(), m=mods[TR.idx], n=mods.length;
    const doneCount=mods.filter(x=>TR.done[x.id]).length;
    el('fcTrNum').textContent=`Module ${TR.idx+1} of ${n}`;
    el('fcTrBar').style.width=(doneCount/n*100)+'%';
    el('fcTrTitle').textContent=m.title;
    el('fcTrTest').innerHTML='<span class="hint">On the test:</span> '+m.test.map(t=>`<span class="fc-tag">${safe(t)}</span>`).join('');
    el('fcTrVideos').innerHTML=m.videos.map(v=>`
      <div class="fc-video${v.optional?' fc-video-opt':''}">
        ${v.optional?`<div class="mh-field-label">${m.videos.length>1?'More (optional)':'Watch more (optional)'}</div>`:''}
        ${v.optional?'':`<div class="fc-video-frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?rel=0&modestbranding=1&playsinline=1" title="${safe(v.title)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>`}
        <div class="fc-video-cap"><b>${safe(v.title)}</b><span>${safe(v.channel)}${v.length?' · '+safe(v.length):''}</span>
          <a href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" target="_blank" rel="noopener">${v.optional?'Watch on YouTube':'Won\'t play? Open on YouTube'}</a></div>
      </div>`).join('');
    el('fcTrPoints').innerHTML=m.points.map(p=>`<li>${p}</li>`).join('');
    el('fcTrPrev').disabled=TR.idx===0;
    el('fcTrStatus').textContent='';
    TR.left=(TR.done[m.id]||TR.review)?0:m.minSec;
    paintTrain();
    if(TR.left>0) TR.timer=setInterval(()=>{ TR.left--; paintTrain(); if(TR.left<=0) stopTrainTimer(); },1000);
    window.scrollTo(0,0);
  }
  function paintTrain(){
    const mods=trainingModules(), last=TR.idx===mods.length-1, s=Math.max(0,TR.left);
    el('fcTrTime').textContent=s>0?`Next unlocks in ${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`:'';
    const b=el('fcTrNext'); b.disabled=s>0;
    b.textContent=last?(TR.review?'Done Reviewing':'Finish Training'):'Next Module';
    b.classList.toggle('fc-submit',last);
  }
  async function nextModule(){
    if(TR.busy||TR.left>0) return;
    const mods=trainingModules(), m=mods[TR.idx], last=TR.idx===mods.length-1, st=el('fcTrStatus');
    if(TR.review){ if(last){ showStep('Info'); } else { TR.idx++; renderModule(); } return; }
    TR.busy=true; st.style.color='var(--muted)'; st.textContent='Saving…';
    try{
      if(!TR.done[m.id]){
        const r=await rpc('fc_training_module',{p_training_id:TR.id,p_module:m.id});
        if(!r.ok){ st.style.color=''; st.textContent=errText(r.error); return; }
        TR.done[m.id]=new Date().toISOString();
      }
      if(!last){ st.textContent=''; TR.idx++; renderModule(); return; }
      const f=await rpc('fc_training_finish',{p_training_id:TR.id});
      st.style.color='';
      if(!f.ok){
        if(f.error==='too_fast') st.textContent=`Almost — keep reviewing. You can finish in ${Math.ceil(f.seconds_left/60)} min.`;
        else if(f.error==='modules_left'){ const i=mods.findIndex(x=>!TR.done[x.id]); st.textContent='A module isn\'t finished yet.'; if(i>=0){ TR.idx=i; renderModule(); } }
        else st.textContent=errText(f.error);
        return;
      }
      st.textContent='';
      toast('Classroom training complete');
      const r=await rpc('fc_lookup_employee',{p_emp_id:Number(T.emp.id)});
      T.info=r; renderInfo(); showStep('Info');
    }catch(e){ st.style.color=''; st.textContent='Couldn\'t save — check your connection and tap again. ('+e.message+')'; }
    finally{ TR.busy=false; }
  }

  function renderQuestion(){
    const q=T.questions[T.idx], n=T.questions.length, done=Object.keys(T.answers).length;
    el('fcQNum').textContent=`Question ${T.idx+1} of ${n}`;
    el('fcQAnswered').textContent=`${done} answered`;
    el('fcProgBar').style.width=(done/n*100)+'%';
    el('fcQText').textContent=q.question;
    const chosen=T.answers[q.id];
    el('fcQOpts').innerHTML=q.options.map((o,i)=>`<button type="button" class="fc-opt${chosen===o?' active':''}" role="radio" aria-checked="${chosen===o}" data-i="${i}"><span class="fc-opt-letter">${'ABCDEF'[i]}</span><span>${safe(o)}</span></button>`).join('');
    el('fcPrev').disabled=T.idx===0;
    const last=T.idx===n-1;
    el('fcNext').textContent=last?(done===n?'Turn In Test':`Turn In (${n-done} unanswered)`):'Next';
    el('fcNext').classList.toggle('fc-submit',last);
    el('fcDots').innerHTML=T.questions.map((qq,i)=>`<button type="button" data-q="${i}" class="${T.answers[qq.id]!==undefined?'done':''}${i===T.idx?' cur':''}" aria-label="Question ${i+1}">${i+1}</button>`).join('');
    el('fcSubmitStatus').textContent='';
  }

  async function submitTest(){
    if(T.busy) return;
    const n=T.questions.length, done=Object.keys(T.answers).length;
    const st=el('fcSubmitStatus');
    if(done<n){
      const first=T.questions.findIndex(q=>T.answers[q.id]===undefined);
      st.textContent=`Answer every question first — question ${first+1} is blank.`;
      return;
    }
    if(!confirm('Turn in your test? You can\'t change answers after this.')) return;
    T.busy=true; st.style.color='var(--muted)'; st.textContent='Scoring…';
    try{
      const r=await rpc('fc_submit_test',{p_attempt_id:T.attempt,p_answers:T.answers});
      st.style.color='';
      if(!r.ok){ st.textContent=errText(r.error); return; }
      st.textContent='';
      renderResult(r,null);
      showStep('Result');
      // Results email (employee if given, manager, HR).
      let mail;
      try{ mail=await sendMail(r.mailer_url,'result',r.attempt_id,r.mail_token); }
      catch(e){ mail={error:e.message}; }
      const ml=el('fcMailLine'); if(ml) ml.textContent=mailLine(mail);
    }catch(e){ st.style.color=''; st.textContent='Couldn\'t turn in the test — check your connection and tap again. Your answers are still here. ('+e.message+')'; }
    finally{ T.busy=false; }
  }

  function renderResult(r){
    const missed=r.missed||[];
    el('fcStepResult').innerHTML=`
      <div class="fc-result ${r.passed?'pass':'fail'}">
        <div class="fc-result-score">${pct(r.score_pct)}</div>
        <div class="fc-result-word">${r.passed?'PASSED':'NOT PASSED'}</div>
        <div class="hint">${r.correct} of ${r.total} correct · ${pct(r.pass_pct)} needed</div>
      </div>
      ${r.passed
        ? `<div class="fc-note fc-note-ok"><b>Next step: driving evaluation.</b> Let your manager or trainer know you passed. They'll watch you operate and sign off — then your certificate and wallet card are issued.</div>`
        : `<div class="fc-note fc-note-bad"><b>Review with your trainer, then try again.</b> You can take the test again — new questions are picked each time.</div>`}
      ${missed.length?`<div class="fc-missed"><div class="mh-field-label">Review ${missed.length===1?'this topic':'these topics'}</div><ul>${missed.map(m=>`<li>${safe(m)}</li>`).join('')}</ul></div>`:''}
      <div id="fcMailLine" class="hint" style="margin-top:12px">Sending results email…</div>
      <button type="button" id="fcDone" class="mh-show-btn" style="margin-top:16px">Done</button>`;
    el('fcDone').onclick=resetTest;
  }

  // =====================================================================
  // MANAGERS — Forklift Certs
  // =====================================================================
  const M={pass:'',on:false,data:null,tab:'pending',certFilter:'active',certQuery:'',histQuery:'',evalId:null,detail:null,photo:null};

  function mstatus(msg,isErr){ const s=el('fcmStatus'); s.textContent=msg||''; s.style.color=isErr?'var(--bad)':'var(--muted)'; }

  // cred: '' for a signed-in manager, 'pin:…' for a manager approved on this tab; omitted → read the fields.
  async function unlock(cred){
    let p=cred;
    if(p==null){ const c=LWHMgr.read('fcm'); if(!c.ok){ el('fcmLockStatus').textContent=c.msg; return; } p=c.cred; }
    el('fcmLockStatus').style.color='var(--muted)'; el('fcmLockStatus').textContent='Checking…';
    try{
      const r=await rpc('fc_mgr_dashboard',{p_passcode:p});
      el('fcmLockStatus').style.color='';
      if(!r.ok){ if(LWHMgr.isAuthError(r.error)) LWHMgr.forget(); el('fcmLockStatus').textContent=errText(r.error); return; }
      el('fcmLockStatus').textContent='';
      M.pass=p; M.on=true; LWHMgr.set(p); LWHMgr.clear('fcm');
      M.data=r; setUnlocked(true); renderMgr();
    }catch(e){ el('fcmLockStatus').style.color=''; el('fcmLockStatus').textContent='Couldn\'t reach the server. ('+e.message+')'; }
  }
  function setUnlocked(on){
    el('fcmLocked').hidden=on; el('fcmUnlocked').hidden=!on;
    if(!on){ M.pass=''; M.on=false; M.data=null; el('fcmBody').innerHTML=''; }
  }
  async function refresh(quiet){
    if(!M.on) return;
    if(!quiet) mstatus('Refreshing…');
    try{
      const r=await rpc('fc_mgr_dashboard',{p_passcode:M.pass});
      if(!r.ok){ if(LWHMgr.isAuthError(r.error)){ LWHMgr.forget(); setUnlocked(false); el('fcmLockStatus').textContent=errText(r.error); } else mstatus(errText(r.error),true); return; }
      M.data=r; mstatus(''); renderMgr();
    }catch(e){ mstatus('Refresh failed — '+e.message,true); }
  }

  function renderMgr(){
    const d=M.data; if(!d) return;
    const pend=(d.pending||[]).length;
    el('fcmPendCount').textContent=pend?pend:'';
    const certs=d.certs||[];
    const cnt=s=>certs.filter(c=>c.state===s).length;
    el('fcmSub').textContent=`${cnt('active')+cnt('expiring')} current certs · ${cnt('expiring')} expiring in 60 days · ${cnt('expired')} expired`;
    document.querySelectorAll('[data-fctab]').forEach(b=>b.classList.toggle('active',b.dataset.fctab===M.tab));
    if(M.tab==='pending') renderPending();
    else if(M.tab==='certs') renderCerts();
    else if(M.tab==='history') renderHistory();
    else if(M.tab==='training') renderTraining();
    else if(M.tab==='employees') renderEmployees();
    else renderSettings();
  }

  // ---------- Driving evaluations ----------
  function renderPending(){
    const list=M.data.pending||[];
    const body=el('fcmBody');
    if(M.evalId){ const a=list.find(x=>x.attempt_id===M.evalId); if(a) return renderEvalForm(a); M.evalId=null; }
    if(!list.length){ body.innerHTML='<div class="card fc-empty">Nobody is waiting on a driving evaluation. When an employee passes the written test, they show up here.</div>'; return; }
    body.innerHTML=`<div class="fc-list">${list.map(a=>`
      <div class="card fc-row">
        <div class="fc-row-main">
          <div class="fc-row-name">${safe(a.name)} <span class="hint">ID ${safe(a.emp_id)}</span></div>
          <div class="hint">${safe(a.location||'')}${a.manager?' · Manager: '+safe(a.manager):''}</div>
          <div class="fc-tags">${(a.truck_types||[]).map(t=>`<span class="fc-tag">${safe(t)}</span>`).join('')}</div>
        </div>
        <div class="fc-row-side">
          <div class="fc-score">${pct(a.score_pct)}</div>
          <div class="hint">written · ${fmtStamp(a.submitted_at)}</div>
          <button type="button" data-eval="${safe(a.attempt_id)}">Do Driving Evaluation</button>
        </div>
      </div>`).join('')}</div>`;
    body.querySelectorAll('[data-eval]').forEach(b=>b.onclick=()=>{ M.evalId=b.dataset.eval; renderPending(); window.scrollTo(0,0); });
  }

  function renderEvalForm(a){
    const body=el('fcmBody');
    const mgrNames=(M.data.managers||[]).filter(m=>m.is_active).map(m=>m.name);
    body.innerHTML=`<div class="card fc-eval">
      <button type="button" class="mh-link" id="fceBack">‹ Back to list</button>
      <h3 style="margin:6px 0 2px">${safe(a.name)} <span class="hint">ID ${safe(a.emp_id)}</span></h3>
      <div class="hint">Written test ${pct(a.score_pct)} (${a.correct}/${a.total}) on ${fmtStamp(a.submitted_at)}${a.training_date?' · Classroom training '+fmtDate(a.training_date):''}</div>

      <div class="mh-field-label" style="margin-top:16px">Equipment evaluated on</div>
      <div class="fc-checks fc-checks-inline">${TRUCK_TYPES.map((t,i)=>`<label class="fc-check"><input type="checkbox" value="${safe(t.id)}" ${(a.truck_types||[]).includes(t.id)?'checked':''} /><span><b>${safe(t.id)}</b></span></label>`).join('')}</div>
      <div class="hint">Only check what they actually drove for you today — that's what goes on the certificate.</div>

      <div class="mh-field-label" style="margin-top:16px">Driving checklist</div>
      <div class="fc-chk">${CHECKLIST.map(item=>`
        <div class="fc-chk-row" data-chk="${item.id}">
          <div class="fc-chk-label">${safe(item.label)}</div>
          <div class="fc-chk-seg">${CHK_VALUES.map(([v,l])=>`<button type="button" data-v="${v}">${l}</button>`).join('')}</div>
        </div>`).join('')}</div>
      <button type="button" class="mh-link" id="fceAllPass">Mark all Pass</button>

      <div class="grid-2">
        <label>Evaluator / trainer<input id="fceEvaluator" list="fceEvalList" value="${safe(LWHStorage.get('fcEvaluator',''))}" /><datalist id="fceEvalList">${mgrNames.map(n=>`<option value="${safe(n)}">`).join('')}</datalist></label>
        <label>Evaluation date<input id="fceDate" type="date" value="${todayIso()}" max="${todayIso()}" /></label>
      </div>
      <label>Notes (optional)<textarea id="fceNotes" rows="2" placeholder="Anything worth keeping on record"></textarea></label>
      <div class="actions">
        <button type="button" id="fcePass">Passed — Issue Certificate</button>
        <button type="button" id="fceFail" class="ghost">Not Passed</button>
      </div>
      <div id="fceStatus" class="mh-status" role="status"></div>
    </div>`;
    el('fceBack').onclick=()=>{ M.evalId=null; renderPending(); };
    body.querySelectorAll('.fc-chk-row').forEach(row=>{
      row.querySelectorAll('button').forEach(b=>b.onclick=()=>{ row.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b)); row.dataset.val=b.dataset.v; row.classList.toggle('fail',b.dataset.v==='fail'); });
    });
    el('fceAllPass').onclick=()=>body.querySelectorAll('.fc-chk-row').forEach(row=>row.querySelector('[data-v="pass"]').click());
    el('fcePass').onclick=()=>submitEval(a,true);
    el('fceFail').onclick=()=>submitEval(a,false);
  }

  async function submitEval(a,passed){
    const body=el('fcmBody'), st=el('fceStatus'); st.style.color='';
    const evaluator=el('fceEvaluator').value.trim();
    const trucks=[...body.querySelectorAll('.fc-checks input:checked')].map(i=>i.value);
    const checklist={}; let blank=0, fails=0;
    body.querySelectorAll('.fc-chk-row').forEach(r=>{ checklist[r.dataset.chk]=r.dataset.val||null; if(!r.dataset.val) blank++; if(r.dataset.val==='fail') fails++; });
    if(!evaluator){ st.textContent=errText('need_evaluator'); el('fceEvaluator').focus(); return; }
    if(passed){
      if(!trucks.length){ st.textContent='Check the equipment they were evaluated on.'; return; }
      if(blank){ st.textContent=`Finish the checklist — ${blank} item${blank>1?'s':''} not marked.`; return; }
      if(fails){ st.textContent='Something is marked "Needs work" — that\'s a Not Passed. Re-evaluate after more training.'; return; }
    } else if(!confirm(`Record the driving evaluation as NOT passed for ${a.name}? They'll need to take the written test again before the next evaluation.`)) return;
    LWHStorage.set('fcEvaluator',evaluator);
    st.style.color='var(--muted)'; st.textContent=passed?'Issuing certificate…':'Saving…';
    el('fcePass').disabled=el('fceFail').disabled=true;
    try{
      const r=await rpc('fc_mgr_practical',{p_passcode:M.pass,p_attempt_id:a.attempt_id,p_passed:passed,p_evaluator:evaluator,p_eval_date:el('fceDate').value||null,p_truck_types:trucks,p_checklist:checklist,p_notes:el('fceNotes').value});
      if(!r.ok){ st.style.color=''; st.textContent=errText(r.error); el('fcePass').disabled=el('fceFail').disabled=false; return; }
      M.evalId=null;
      if(!passed){ toast('Saved — not passed'); await refresh(true); return; }
      M.tab='certs'; M.certFilter='all'; M.certQuery='';
      await refresh(true);
      openDetail(r.cert, 'Certificate issued.');
      let mail; const line=el('fcdMail');
      if(line) line.textContent='Emailing certificate…';
      try{ mail=await sendMail(r.mailer_url,'cert',r.cert.id,r.mail_token,r.cert); }catch(e){ mail={error:e.message}; }
      if(el('fcdMail')) el('fcdMail').textContent=mailLine(mail);
    }catch(e){ st.style.color=''; st.textContent='Save failed — '+e.message; el('fcePass').disabled=el('fceFail').disabled=false; }
  }

  // ---------- Certificates ----------
  function certMatches(c,q){
    if(!q) return true;
    return [c.name,c.emp_id,c.cert_no,c.location,c.manager,c.evaluator,(c.truck_types||[]).join(' ')].join(' ').toLowerCase().includes(q);
  }
  function filteredCerts(){
    const q=M.certQuery.trim().toLowerCase();
    return (M.data.certs||[]).filter(c=>{
      if(M.certFilter==='active' && !['active','expiring'].includes(c.state)) return false;
      if(M.certFilter==='needs' && !needsInfo(c)) return false;
      if(!['all','active','needs'].includes(M.certFilter) && c.state!==M.certFilter) return false;
      return certMatches(c,q);
    });
  }
  function renderCerts(){
    const certs=M.data.certs||[];
    const cnt={all:certs.length,active:certs.filter(c=>['active','expiring'].includes(c.state)).length};
    ['expiring','expired','revoked','superseded'].forEach(s=>cnt[s]=certs.filter(c=>c.state===s).length);
    cnt.needs=certs.filter(needsInfo).length;
    const chips=[['active','Current'],['expiring','Expiring ≤60d'],['needs','Needs info'],['expired','Expired'],['revoked','Revoked'],['superseded','Replaced'],['all','All']].filter(([k])=>k!=='needs'||cnt.needs);
    const list=filteredCerts();
    el('fcmBody').innerHTML=`
      <div id="fcDetail"></div>
      <div class="fc-toolbar">
        <input id="fccSearch" placeholder="Search name, ID, cert #, location, equipment…" value="${safe(M.certQuery)}" />
        <button type="button" id="fccExport" class="ghost">Export to Excel</button>
      </div>
      <div class="fc-chips">${chips.map(([k,l])=>`<button type="button" class="fc-chip${M.certFilter===k?' active':''}" data-cf="${k}">${l} <b>${cnt[k]}</b></button>`).join('')}</div>
      ${list.length?`<div class="fc-table-wrap"><table class="fc-table">
        <thead><tr><th>Name</th><th>Cert #</th><th>Equipment</th><th>Issued</th><th>Expires</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.map(c=>`<tr>
          <td><b>${safe(c.name)}</b><div class="hint">${c.emp_id?'ID '+safe(c.emp_id):'<span class="fc-warn-txt">No employee ID</span>'}${c.location&&c.location!=='Not Assigned'?' · '+safe(c.location):''}${c.source==='import'?' · Imported':''}</div></td>
          <td class="fc-mono">${safe(c.cert_no)}</td>
          <td>${(c.truck_types||[]).length?safe(c.truck_types.join(', ')):'<span class="fc-warn-txt">Not recorded</span>'}</td>
          <td>${fmtNum(c.issued_on)}</td>
          <td>${fmtNum(c.expires_on)}${c.state==='expiring'?`<div class="hint">${c.days_left} days</div>`:''}</td>
          <td><span class="fc-state fc-state-${c.state}">${STATE_LABEL[c.state]||c.state}</span></td>
          <td><button type="button" class="ghost fc-sm" data-open="${c.id}">Open</button></td>
        </tr>`).join('')}</tbody></table></div>`
      :'<div class="card fc-empty">No certificates match.</div>'}`;
    const s=el('fccSearch');
    s.oninput=()=>{ M.certQuery=s.value; const pos=s.selectionStart; renderCerts(); const n=el('fccSearch'); n.focus(); n.setSelectionRange(pos,pos); };
    el('fccExport').onclick=exportCerts;
    document.querySelectorAll('[data-cf]').forEach(b=>b.onclick=()=>{ M.certFilter=b.dataset.cf; renderCerts(); });
    document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{ const c=certs.find(x=>String(x.id)===b.dataset.open); if(c) openDetail(c); });
    if(M.detail){ const c=certs.find(x=>x.id===M.detail.id); if(c) drawDetail(c); }
  }

  function openDetail(c,flash){
    M.detail=c; M.photo=null;
    if(M.tab!=='certs'){ M.tab='certs'; renderMgr(); }
    drawDetail(c,flash);
    window.scrollTo(0,0);
  }
  function drawDetail(c,flash){
    const box=el('fcDetail'); if(!box) return;
    const current=['active','expiring'].includes(c.state);
    box.innerHTML=`<div class="card fc-detail">
      <div class="fc-detail-head">
        <div>
          ${flash?`<div class="fc-flash">${safe(flash)}</div>`:''}
          <h3 style="margin:0">${safe(c.name)} <span class="fc-state fc-state-${c.state}">${STATE_LABEL[c.state]||c.state}</span></h3>
          <div class="hint">${c.emp_id?'ID '+safe(c.emp_id):'No employee ID linked'}${c.location&&c.location!=='Not Assigned'?' · '+safe(c.location):''}${c.manager?' · Manager: '+safe(c.manager):''}${c.source==='import'?' · Imported from the old certification list':''}</div>
        </div>
        <button type="button" class="mh-link" id="fcdClose">Close</button>
      </div>
      <div class="fc-detail-grid">
        <div><span>Cert #</span><b class="fc-mono">${safe(c.cert_no)}</b></div>
        <div><span>Equipment</span><b>${safe(trucksText(c))}</b></div>
        ${c.written_score!=null?`<div><span>Written test</span><b>${pct(c.written_score)} · ${fmtNum(c.written_date)}</b></div>`:''}
        <div><span>${c.source==='import'?'Instructor':'Driving evaluation'}</span><b>${c.source==='import'?'':fmtNum(c.practical_date)+' · '}${safe(c.evaluator)}</b></div>
        <div><span>Issued</span><b>${fmtNum(c.issued_on)}</b></div>
        <div><span>Expires</span><b>${fmtNum(c.expires_on)}</b></div>
        ${c.emp_email?`<div><span>Employee email</span><b>${safe(c.emp_email)}</b></div>`:''}
        ${c.revoked_reason?`<div><span>Revoked</span><b>${safe(c.revoked_reason)}</b></div>`:''}
      </div>
      <div class="fc-detail-act">
        <button type="button" id="fcdCert">Print Certificate</button>
        <button type="button" id="fcdWallet">Print Wallet Card</button>
        <button type="button" id="fcdPdf" class="ghost">Download PDF</button>
        <button type="button" id="fcdEmail" class="ghost">Email Again</button>
        <button type="button" id="fcdEdit" class="ghost">Edit</button>
        ${c.status==='active'&&c.emp_id?'<button type="button" id="fcdRecert" class="ghost">Recertify — Skip Training</button>':''}
        ${c.status==='active'?'<button type="button" id="fcdRevoke" class="ghost fc-danger">Revoke</button>':''}
      </div>
      ${needsInfo(c)?`<div class="fc-note fc-note-warn" style="margin-top:12px">${!c.emp_id?'No employee ID linked — link one so they can see their cert in Forklift Test and so it matches the timeclock. ':''}${!(c.truck_types||[]).length?'Equipment isn\'t recorded — the certificate and card will say "Powered industrial trucks". ':''}Tap <b>Edit</b>.</div>`:''}
      <div id="fcdEditBox" hidden></div>
      <label class="fc-photo">Wallet card photo (optional, not saved)<input id="fcdPhoto" type="file" accept="image/*" /></label>
      <div class="fc-wallet-prev" id="fcdPreview"></div>
      <div id="fcdMail" class="hint">${c.emailed_at?'Last emailed '+fmtStamp(c.emailed_at):''}</div>
      ${!current?'<div class="hint" style="margin-top:6px">This certificate is no longer current — reprints are for records only.</div>':''}
    </div>`;
    el('fcdClose').onclick=()=>{ M.detail=null; box.innerHTML=''; };
    el('fcdCert').onclick=()=>printCert(c,'fcMgrPrintArea');
    el('fcdWallet').onclick=()=>printWallet(c,'fcMgrPrintArea',M.photo);
    el('fcdPdf').onclick=()=>downloadPdf(c);
    el('fcdEmail').onclick=()=>emailAgain(c);
    el('fcdEdit').onclick=()=>editCert(c);
    const rc=el('fcdRecert'); if(rc) rc.onclick=()=>waiveBox(el('fcdEditBox'),c.emp_id,c.name);
    const rv=el('fcdRevoke'); if(rv) rv.onclick=()=>revoke(c);
    el('fcdPhoto').onchange=()=>LWHUI.readFile(el('fcdPhoto'),p=>{ M.photo=p||null; preview(c); });
    preview(c);
  }
  // Manager waiver: skip classroom training for a recertification.
  function waiveBox(box,empId,name){
    box.hidden=false;
    box.innerHTML=`<div class="fc-edit">
      <b>Recertify${name?' '+safe(name):''} — skip classroom training</b>
      <div class="hint">They go straight to the written test, then the driving evaluation. Good for 90 days. Their new certificate shows "Recert" for classroom training.</div>
      <div class="grid-2">
        ${empId?'':'<label>Employee ID<input id="fcwId" inputmode="numeric" maxlength="5" placeholder="00000" /></label>'}
        <label>Approved by (manager)<input id="fcwBy" value="${safe(LWHStorage.get('fcEvaluator',''))}" /></label>
        <label>Reason<input id="fcwWhy" value="Recertification — cert expiring" /></label>
      </div>
      <div class="actions"><button type="button" id="fcwGo">Skip Training</button><button type="button" id="fcwCancel" class="ghost">Cancel</button></div>
      <div id="fcwMsg" class="mh-status"></div>
    </div>`;
    el('fcwCancel').onclick=()=>{ box.hidden=true; box.innerHTML=''; };
    el('fcwGo').onclick=async()=>{
      const id=empId||String(el('fcwId').value||'').replace(/\D/g,''), msg=el('fcwMsg'), by=el('fcwBy').value.trim();
      if(!/^\d{5}$/.test(String(id))){ msg.textContent='Enter the 5-digit employee ID.'; return; }
      if(!by){ msg.textContent='Enter your name.'; return; }
      msg.style.color='var(--muted)'; msg.textContent='Saving…';
      try{
        const r=await rpc('fc_mgr_waive_training',{p_passcode:M.pass,p_emp_id:Number(id),p_manager:by,p_reason:el('fcwWhy').value});
        if(!r.ok){ msg.style.color=''; msg.textContent=errText(r.error); return; }
        LWHStorage.set('fcEvaluator',by);
        msg.style.color='var(--good)'; msg.textContent=`Done — ${r.name} can go straight to the written test (current cert ${r.cert_no}, expires ${fmtNum(r.expires_on)}).`;
        el('fcwGo').disabled=true;
        if(M.tab==='training') setTimeout(()=>renderTraining(),1200);
        if(M.tab==='employees') setTimeout(()=>renderEmployees(),1500);
      }catch(e){ msg.style.color=''; msg.textContent='Save failed — '+e.message; }
    };
  }

  function editCert(c){
    const box=el('fcdEditBox'); box.hidden=false;
    box.innerHTML=`<div class="fc-edit">
      <div class="grid-2">
        <label>Employee ID (5 digits, from the timeclock)<input id="fceId" inputmode="numeric" maxlength="5" value="${safe(c.emp_id||'')}" placeholder="00000" /></label>
        <label>Employee email (optional)<input id="fceMail" type="email" value="${safe(c.emp_email||'')}" /></label>
      </div>
      <div class="mh-field-label" style="margin-top:10px">Equipment</div>
      <div class="fc-checks fc-checks-inline">${TRUCK_TYPES.map(t=>`<label class="fc-check"><input type="checkbox" value="${safe(t.id)}" ${(c.truck_types||[]).includes(t.id)?'checked':''} /><span><b>${safe(t.id)}</b></span></label>`).join('')}</div>
      <div class="hint">Linking an ID uses the name, location and team from the timeclock.</div>
      <div class="actions"><button type="button" id="fceSave">Save</button><button type="button" id="fceCancel" class="ghost">Cancel</button></div>
      <div id="fceMsg" class="mh-status"></div>
    </div>`;
    el('fceCancel').onclick=()=>{ box.hidden=true; box.innerHTML=''; };
    el('fceSave').onclick=async()=>{
      const id=el('fceId').value.replace(/\D/g,''), msg=el('fceMsg');
      if(id && !/^\d{5}$/.test(id)){ msg.textContent='Employee ID is 5 digits.'; return; }
      const changes={truck_types:[...box.querySelectorAll('.fc-check input:checked')].map(i=>i.value),emp_email:el('fceMail').value.trim()};
      if(id || c.source==='import') changes.emp_id=id;
      msg.style.color='var(--muted)'; msg.textContent='Saving…';
      try{
        const r=await rpc('fc_mgr_update_cert',{p_passcode:M.pass,p_cert_id:c.id,p_changes:changes});
        if(!r.ok){ msg.style.color=''; msg.textContent=errText(r.error); return; }
        toast('Certificate updated'); M.detail=r.cert; await refresh(true); openDetail(r.cert,'Saved.');
      }catch(e){ msg.style.color=''; msg.textContent='Save failed — '+e.message; }
    };
  }
  function preview(c){
    const p=el('fcdPreview'); if(!p) return;
    p.innerHTML=`<div class="fc-prev-card">${walletFront(c,M.photo)}</div><div class="fc-prev-card">${walletBack(c)}</div>`;
    finishQrs(p);
  }
  async function emailAgain(c){
    const line=el('fcdMail'); line.textContent='Emailing…';
    try{
      const t=await rpc('fc_mgr_mail_token',{p_passcode:M.pass,p_kind:'cert',p_id:String(c.id)});
      if(!t.ok){ line.textContent=errText(t.error); return; }
      const r=await sendMail(t.mailer_url,'cert',c.id,t.mail_token,c);
      line.textContent=mailLine(r);
    }catch(e){ line.textContent='Email didn\'t send: '+e.message; }
  }
  async function revoke(c){
    const reason=prompt(`Revoke ${c.name}'s forklift certification (${c.cert_no})?\n\nReason (kept on record):`);
    if(reason===null) return;
    if(!reason.trim()){ alert(errText('need_reason')); return; }
    try{
      const r=await rpc('fc_mgr_revoke',{p_passcode:M.pass,p_cert_id:c.id,p_reason:reason});
      if(!r.ok){ alert(errText(r.error)); return; }
      toast('Certification revoked'); await refresh(true);
    }catch(e){ alert('Revoke failed — '+e.message); }
  }
  function exportCerts(){
    if(!window.LWHXlsx){ toast('Excel export not available'); return; }
    const list=filteredCerts();
    LWHXlsx.download(`Forklift_Certifications_${todayIso()}.xlsx`,[{name:'Certifications',
      columns:[{label:'Name',width:24},{label:'Employee ID',type:'n',width:12},{label:'Location',width:14},{label:'Manager',width:18},{label:'Cert #',width:18},{label:'Equipment',width:40},{label:'Written Score %',type:'n',width:14},{label:'Classroom Training',width:14},{label:'Written Test',width:12},{label:'Driving Eval',width:12},{label:'Evaluator',width:18},{label:'Issued',width:12},{label:'Expires',width:12},{label:'Days Left',type:'n',width:10},{label:'Status',width:14},{label:'Source',width:10},{label:'Revoked Reason',width:30}],
      rows:list.map(c=>[c.name,c.emp_id,c.location||'',c.manager||'',c.cert_no,(c.truck_types||[]).join(', '),c.written_score==null?'':+c.written_score,fmtNum(c.training_date),fmtNum(c.written_date),fmtNum(c.practical_date),c.evaluator||'',fmtNum(c.issued_on),fmtNum(c.expires_on),c.days_left,STATE_LABEL[c.state]||c.state,c.source==='import'?'Imported':'App',c.revoked_reason||''])
    }]);
  }

  // ---------- Test history ----------
  const ATT_LABEL={failed:'Written — not passed',awaiting_practical:'Written passed — awaiting driving eval',certified:'Certified',practical_failed:'Driving eval — not passed',abandoned:'Not finished'};
  function filteredHistory(){
    const q=M.histQuery.trim().toLowerCase();
    return (M.data.attempts||[]).filter(a=>!q||[a.name,a.emp_id,a.location,a.manager,a.evaluator,ATT_LABEL[a.status]].join(' ').toLowerCase().includes(q));
  }
  function renderHistory(){
    const list=filteredHistory();
    el('fcmBody').innerHTML=`
      <div class="fc-toolbar">
        <input id="fchSearch" placeholder="Search name, ID, location, manager…" value="${safe(M.histQuery)}" />
        <button type="button" id="fchExport" class="ghost">Export to Excel</button>
      </div>
      <div class="hint" style="margin-bottom:8px">Every written test and driving evaluation (latest 500). Missed-question detail is kept in the database.</div>
      ${list.length?`<div class="fc-table-wrap"><table class="fc-table">
        <thead><tr><th>Date</th><th>Name</th><th>Score</th><th>Result</th><th>Manager</th><th>Evaluator</th><th>Notes</th></tr></thead>
        <tbody>${list.map(a=>`<tr>
          <td>${fmtStamp(a.submitted_at||a.started_at)}</td>
          <td><b>${safe(a.name)}</b><div class="hint">ID ${safe(a.emp_id)}${a.location?' · '+safe(a.location):''}</div></td>
          <td>${a.score_pct!=null?pct(a.score_pct)+` <span class="hint">(${a.correct}/${a.total})</span>`:'—'}</td>
          <td><span class="fc-att fc-att-${a.status}">${ATT_LABEL[a.status]||a.status}</span></td>
          <td>${safe(a.manager||'')}</td>
          <td>${safe(a.evaluator||'')}${a.practical_at?`<div class="hint">${fmtStamp(a.practical_at)}</div>`:''}</td>
          <td>${safe(a.notes||'')}</td>
        </tr>`).join('')}</tbody></table></div>`
      :'<div class="card fc-empty">No tests yet.</div>'}`;
    const s=el('fchSearch');
    s.oninput=()=>{ M.histQuery=s.value; const pos=s.selectionStart; renderHistory(); const n=el('fchSearch'); n.focus(); n.setSelectionRange(pos,pos); };
    el('fchExport').onclick=()=>{
      if(!window.LWHXlsx){ toast('Excel export not available'); return; }
      LWHXlsx.download(`Forklift_Test_History_${todayIso()}.xlsx`,[{name:'Test History',
        columns:[{label:'Submitted',width:20},{label:'Name',width:24},{label:'Employee ID',type:'n',width:12},{label:'Location',width:14},{label:'Equipment',width:36},{label:'Score %',type:'n',width:10},{label:'Correct',type:'n',width:9},{label:'Questions',type:'n',width:10},{label:'Result',width:34},{label:'Manager',width:18},{label:'Evaluator',width:18},{label:'Driving Eval',width:20},{label:'Notes',width:40}],
        rows:filteredHistory().map(a=>[fmtStamp(a.submitted_at||a.started_at),a.name,a.emp_id,a.location||'',(a.truck_types||[]).join(', '),a.score_pct==null?'':+a.score_pct,a.correct==null?'':a.correct,a.total==null?'':a.total,ATT_LABEL[a.status]||a.status,a.manager||'',a.evaluator||'',fmtStamp(a.practical_at),a.notes||''])
      }]);
    };
  }

  // ---------- Employees (from the timeclock) ----------
  function empStatus(e){
    const c=e.cert;
    if(c && c.state==='active') return {k:'certified',label:'Certified',cls:'active'};
    if(c && c.state==='expiring') return {k:'expiring',label:`Expiring — ${c.days_left} days`,cls:'expiring'};
    if(c && c.state==='expired') return {k:'expired',label:'Expired',cls:'expired'};
    return {k:'none',label:'Not certified',cls:'superseded'};
  }
  function empNext(e){
    if(e.pending_eval) return '<span class="fc-warn-txt">Passed test — needs driving evaluation</span>';
    if(e.training) return e.training.waived_by?`Training waived by ${safe(e.training.waived_by)} — ready for test`:`Training done ${fmtNum(String(e.training.completed_at).slice(0,10))} — ready for test`;
    if(e.in_training) return 'In classroom training';
    if(e.last_test && e.last_test.status==='failed') return `Last test ${pct(e.last_test.score_pct)} — not passed`;
    return '';
  }
  async function renderEmployees(cached){
    const body=el('fcmBody');
    let r=cached===true?M.emps:null;
    if(!r){
      body.innerHTML='<div class="card">Loading employees…</div>';
      try{ r=await rpc('fc_mgr_employees',{p_passcode:M.pass}); }catch(e){ body.innerHTML='<div class="card">Couldn\'t load — '+safe(e.message)+'</div>'; return; }
      if(M.tab!=='employees') return;
      if(!r.ok){ body.innerHTML='<div class="card">'+safe(errText(r.error))+'</div>'; return; }
      M.emps=r;
    }
    const all=(r.employees||[]).filter(e=>M.empInactive||(e.active&&!e.hidden));
    const hiddenCount=(r.employees||[]).filter(e=>e.hidden||!e.active).length;
    M.empSel=M.empSel||new Set();
    const q=(M.empQuery||'').toLowerCase(), f=M.empFilter||'all';
    const cnt={all:all.length}; ['certified','expiring','expired','none'].forEach(k=>cnt[k]=all.filter(e=>empStatus(e).k===k).length);
    cnt.eval=all.filter(e=>e.pending_eval).length;
    const list=all.filter(e=>{
      if(f==='eval'?!e.pending_eval:(f!=='all' && empStatus(e).k!==f)) return false;
      return !q||[e.name,e.emp_id,e.location,e.team,e.cert&&e.cert.cert_no].join(' ').toLowerCase().includes(q);
    });
    const chips=[['all','All'],['certified','Certified'],['expiring','Expiring ≤60d'],['expired','Expired'],['none','Not certified'],['eval','Needs driving eval']];
    body.innerHTML=`
      <div id="fcEmpWaive" hidden></div>
      <div class="hint" style="margin-bottom:8px">Everyone in the timeclock — synced automatically${r.synced_at?' (last sync '+fmtStamp(r.synced_at)+')':''}. New hires show up here after they're added to the timeclock and the next sync runs. Tick office / shop staff or people no longer here and <b>Hide from list</b> — display only, nothing else changes.</div>
      <div class="fc-toolbar">
        <input id="fceSearch" placeholder="Search name, employee ID, location, cert #…" value="${safe(M.empQuery||'')}" />
        <button type="button" id="fceExport" class="ghost">Export to Excel</button>
      </div>
      <div class="fc-chips">${chips.map(([k,l])=>`<button type="button" class="fc-chip${f===k?' active':''}" data-ef="${k}">${l} <b>${cnt[k]}</b></button>`).join('')}
        <label class="fc-inline fc-chip-opt"><input type="checkbox" id="fceInactive" ${M.empInactive?'checked':''} /> Show hidden (${hiddenCount})</label></div>
      <div class="fc-selbar"${M.empSel.size?'':' hidden'}><b>${M.empSel.size} selected</b>
        ${(r.employees||[]).some(e=>M.empSel.has(e.emp_id)&&!e.hidden)?'<button type="button" id="fceHide" class="fc-sm">Hide from list</button>':''}
        ${(r.employees||[]).some(e=>M.empSel.has(e.emp_id)&&e.hidden)?'<button type="button" id="fceUnhide" class="fc-sm">Unhide</button>':''}
        <button type="button" id="fceClearSel" class="mh-link">Clear</button></div>
      ${list.length?`<div class="fc-table-wrap"><table class="fc-table">
        <thead><tr><th class="fc-cb"><input type="checkbox" id="fceAll" aria-label="Select all shown" ${list.length&&list.every(e=>M.empSel.has(e.emp_id))?'checked':''} /></th><th>Name</th><th>Employee ID</th><th>Forklift cert</th><th>Expires</th><th>Status / next step</th><th></th></tr></thead>
        <tbody>${list.map(e=>{ const s=empStatus(e); return `<tr${e.active&&!e.hidden?'':' class="fc-row-off"'}>
          <td class="fc-cb"><input type="checkbox" data-esel="${e.emp_id}" ${M.empSel.has(e.emp_id)?'checked':''} aria-label="Select ${safe(e.name)}" /></td>
          <td><b>${safe(e.name)}</b>${e.location&&e.location!=='Not Assigned'?`<div class="hint">${safe(e.location)}</div>`:''}${e.active?'':'<div class="hint">Inactive</div>'}${e.hidden?`<div class="hint">Hidden${e.hidden_by?' by '+safe(e.hidden_by):''}</div>`:''}</td>
          <td class="fc-mono">${safe(e.emp_id)}</td>
          <td><span class="fc-state fc-state-${s.cls}">${s.label}</span>${e.cert?`<div class="hint fc-mono">${safe(e.cert.cert_no)}</div>`:''}</td>
          <td>${e.cert?fmtNum(e.cert.expires_on):''}</td>
          <td class="fc-next">${empNext(e)}</td>
          <td class="fc-act">${e.cert?`<button type="button" class="ghost fc-sm" data-ecert="${e.cert.id}">Open cert</button>`:''}${e.cert&&!e.training&&!e.pending_eval?`<button type="button" class="ghost fc-sm" data-ewaive="${e.emp_id}" data-ename="${safe(e.name)}">Recertify</button>`:''}</td>
        </tr>`; }).join('')}</tbody></table></div>`
      :'<div class="card fc-empty">No employees match.</div>'}`;
    const s=el('fceSearch');
    s.oninput=()=>{ M.empQuery=s.value; const pos=s.selectionStart; renderEmployees(true).then(()=>{ const n=el('fceSearch'); if(n){ n.focus(); n.setSelectionRange(pos,pos); } }); };
    document.querySelectorAll('[data-ef]').forEach(b=>b.onclick=()=>{ M.empFilter=b.dataset.ef; renderEmployees(true); });
    el('fceInactive').onchange=()=>{ M.empInactive=el('fceInactive').checked; renderEmployees(true); };
    document.querySelectorAll('[data-esel]').forEach(cb=>cb.onchange=()=>{ const id=Number(cb.dataset.esel); cb.checked?M.empSel.add(id):M.empSel.delete(id); renderEmployees(true); });
    const allCb=el('fceAll'); if(allCb) allCb.onchange=()=>{ list.forEach(e=>allCb.checked?M.empSel.add(e.emp_id):M.empSel.delete(e.emp_id)); renderEmployees(true); };
    const doHide=async(hide)=>{
      const ids=[...M.empSel]; if(!ids.length) return;
      if(hide && !confirm(`Hide ${ids.length} employee${ids.length>1?'s':''} from this list? They keep any certs and can still take the test. Unhide any time with "Show hidden".`)) return;
      try{
        const res=await rpc('fc_mgr_hide_employees',{p_passcode:M.pass,p_emp_ids:ids,p_hide:hide,p_by:LWHStorage.get('fcEvaluator','')});
        if(!res.ok){ alert(errText(res.error)); return; }
        M.empSel.clear(); toast(hide?`Hidden: ${ids.length}`:`Unhidden: ${ids.length}`); renderEmployees();
      }catch(e){ alert('Save failed — '+e.message); }
    };
    if(el('fceHide')) el('fceHide').onclick=()=>doHide(true);
    if(el('fceUnhide')) el('fceUnhide').onclick=()=>doHide(false);
    if(el('fceClearSel')) el('fceClearSel').onclick=()=>{ M.empSel.clear(); renderEmployees(true); };
    document.querySelectorAll('[data-ecert]').forEach(b=>b.onclick=()=>{ const c=(M.data.certs||[]).find(x=>String(x.id)===b.dataset.ecert); if(c){ M.certFilter='all'; M.certQuery=''; openDetail(c); } });
    document.querySelectorAll('[data-ewaive]').forEach(b=>b.onclick=()=>{ waiveBox(el('fcEmpWaive'),Number(b.dataset.ewaive),b.dataset.ename); window.scrollTo(0,0); });
    el('fceExport').onclick=()=>{
      if(!window.LWHXlsx){ toast('Excel export not available'); return; }
      LWHXlsx.download(`Forklift_Employees_${todayIso()}.xlsx`,[{name:'Employees',
        columns:[{label:'Name',width:24},{label:'Employee ID',type:'n',width:12},{label:'Location',width:14},{label:'Team',width:14},{label:'Forklift Cert',width:20},{label:'Cert #',width:18},{label:'Issued',width:12},{label:'Expires',width:12},{label:'Days Left',type:'n',width:10},{label:'Equipment',width:28},{label:'Next Step',width:40},{label:'Active',width:8}],
        rows:list.map(e=>{ const s=empStatus(e); return [e.name,e.emp_id,e.location||'',e.team||'',s.label,e.cert?e.cert.cert_no:'',e.cert?fmtNum(e.cert.issued_on):'',e.cert?fmtNum(e.cert.expires_on):'',e.cert?e.cert.days_left:'',e.cert?(e.cert.truck_types||[]).join(', '):'',empNext(e).replace(/<[^>]+>/g,''),e.active?'Yes':'No']; })}]);
    };
  }

  // ---------- Training records ----------
  async function renderTraining(cached){
    const body=el('fcmBody');
    let r=cached===true?M.training:null;
    if(!r){
      body.innerHTML='<div class="card">Loading…</div>';
      try{ r=await rpc('fc_mgr_training',{p_passcode:M.pass}); }catch(e){ body.innerHTML='<div class="card">Couldn\'t load — '+safe(e.message)+'</div>'; return; }
    }
    if(M.tab!=='training') return;
    if(!r.ok){ body.innerHTML='<div class="card">'+safe(errText(r.error))+'</div>'; return; }
    M.training=r;
    const mods=trainingModules(), recs=r.records||[];
    const q=(M.trQuery||'').toLowerCase();
    const list=recs.filter(x=>!q||[x.name,x.emp_id].join(' ').toLowerCase().includes(q));
    body.innerHTML=`
      <div class="card fc-tr-settings">
        <div class="fc-tr-set-row">
          <label class="fc-inline"><input type="checkbox" id="fctReq" ${r.require_training?'checked':''} /> Require classroom training before the written test</label>
          <label class="fc-inline">Minimum minutes <input id="fctMin" type="number" min="0" max="120" value="${r.training_min_minutes}" style="width:80px" /></label>
          <button type="button" id="fctSave" class="fc-sm">Save</button>
        </div>
        <div class="hint">Training is good for 90 days — after that they retake it before testing. ${mods.length} modules, about ${Math.round(mods.reduce((s,m)=>s+m.minSec,0)/60)} minutes of module timers. Content and videos are in <code>js/forkliftcert-training.js</code>.</div>
        <div id="fctMsg" class="mh-status"></div>
        <div class="actions" style="margin-top:6px"><button type="button" id="fctWaive" class="ghost fc-sm">Recertify — Skip Training for Someone</button></div>
        <div id="fctWaiveBox" hidden></div>
      </div>
      <div class="fc-toolbar">
        <input id="fctSearch" placeholder="Search name or ID…" value="${safe(M.trQuery||'')}" />
        <button type="button" id="fctExport" class="ghost">Export to Excel</button>
      </div>
      ${list.length?`<div class="fc-table-wrap"><table class="fc-table">
        <thead><tr><th>Name</th><th>Started</th><th>Finished</th><th>Modules</th><th>Minutes</th></tr></thead>
        <tbody>${list.map(x=>`<tr>
          <td><b>${safe(x.name)}</b><div class="hint">ID ${safe(x.emp_id)}</div></td>
          <td>${fmtStamp(x.started_at)}</td>
          <td>${x.completed_at?fmtStamp(x.completed_at):'<span class="fc-warn-txt">Not finished</span>'}${x.waived_by?`<div class="hint">Waived by ${safe(x.waived_by)} — ${safe(x.waive_reason||'')}</div>`:''}</td>
          <td>${x.waived_by?'Waived':x.modules_done+' / '+x.module_count}</td>
          <td>${x.waived_by?'—':x.minutes}</td></tr>`).join('')}</tbody></table></div>`
      :'<div class="card fc-empty">No classroom training yet.</div>'}`;
    el('fctWaive').onclick=()=>waiveBox(el('fctWaiveBox'),null,'');
    el('fctSave').onclick=async()=>{
      const msg=el('fctMsg'); msg.style.color='var(--muted)'; msg.textContent='Saving…';
      try{
        const s=await rpc('fc_mgr_save_settings',{p_passcode:M.pass,p_settings:{require_training:el('fctReq').checked,training_min_minutes:+el('fctMin').value}});
        if(!s.ok){ msg.style.color=''; msg.textContent=errText(s.error); return; }
        toast('Training settings saved'); msg.textContent='';
      }catch(e){ msg.style.color=''; msg.textContent='Save failed — '+e.message; }
    };
    const s=el('fctSearch');
    s.oninput=()=>{ M.trQuery=s.value; const pos=s.selectionStart; renderTraining(true).then(()=>{ const n=el('fctSearch'); if(n){ n.focus(); n.setSelectionRange(pos,pos); } }); };
    el('fctExport').onclick=()=>{
      if(!window.LWHXlsx){ toast('Excel export not available'); return; }
      LWHXlsx.download(`Forklift_Classroom_Training_${todayIso()}.xlsx`,[{name:'Classroom Training',
        columns:[{label:'Name',width:24},{label:'Employee ID',type:'n',width:12},{label:'Started',width:20},{label:'Finished',width:20},{label:'Modules Done',type:'n',width:12},{label:'Modules',type:'n',width:10},{label:'Minutes',type:'n',width:10}],
        rows:list.map(x=>[x.name,x.emp_id,fmtStamp(x.started_at),x.waived_by?('Waived by '+x.waived_by+' — '+(x.waive_reason||'')+' '+fmtStamp(x.completed_at)):(x.completed_at?fmtStamp(x.completed_at):'Not finished'),x.modules_done,x.module_count,x.minutes])}]);
    };
  }

  // ---------- Settings ----------
  function renderSettings(){
    const s=M.data.settings||{}, mgrs=M.data.managers||[], qs=M.data.questions||[];
    const activeQ=qs.filter(q=>q.is_active).length;
    el('fcmBody').innerHTML=`
      <div class="fc-settings">
        <div class="card">
          <h3>Test & email</h3>
          <div class="grid-2">
            <label>Questions per test<input id="fcsQ" type="number" min="12" max="${Math.max(12,activeQ)}" value="${s.questions_per_test}" /></label>
            <label>Pass mark %<input id="fcsPct" type="number" min="50" max="100" value="${s.pass_pct}" /></label>
            <label>Certificate good for (years)<input id="fcsYears" type="number" min="1" max="3" value="${s.cert_years}" /></label>
            <label>Failed tries allowed per 24 hrs<input id="fcsFails" type="number" min="1" max="10" value="${s.max_fails_per_day}" /></label>
          </div>
          <div class="hint">${activeQ} active questions in the bank. Each test picks ${s.questions_per_test} at random. With ${s.questions_per_test} questions and ${pct(s.pass_pct)}, a passing score allows ${Math.floor(s.questions_per_test*(1-s.pass_pct/100)+1e-9)} miss${Math.floor(s.questions_per_test*(1-s.pass_pct/100)+1e-9)===1?'':'es'}. OSHA requires re-evaluation at least every 3 years.</div>
          <label>HR email(s) — every result and certificate goes here<input id="fcsHr" placeholder="hr@company.com, another@company.com" value="${safe(s.hr_emails)}" /></label>
          <label>Mailer URL (Apps Script web app — see docs/FORKLIFT_CERT_SETUP.md)<input id="fcsUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${safe(s.mailer_url)}" /></label>
          <div class="hint">Expiration reminders: ${s.mailer_key_set?'<b style="color:var(--good)">mailer key is set</b>':'<b style="color:var(--bad)">mailer key not set yet</b> (one SQL line — see the setup guide)'}.</div>
          <div class="actions"><button type="button" id="fcsSave">Save Settings</button></div>
          <div id="fcsStatus" class="mh-status"></div>
        </div>

        <div class="card">
          <h3>Managers</h3>
          <div class="hint">Employees pick their manager when they take the test; that manager gets the emails. Inactive managers stay on old records but drop off the list.</div>
          <div class="fc-mgr-list">${mgrs.map(m=>`
            <div class="fc-mgr-row${m.is_active?'':' off'}" data-mid="${m.id}">
              <input class="fcm-name" value="${safe(m.name)}" placeholder="Name" />
              <input class="fcm-email" type="email" value="${safe(m.email)}" placeholder="Email" />
              <input class="fcm-loc" value="${safe(m.location)}" placeholder="Location" />
              <label class="fc-inline"><input type="checkbox" class="fcm-act" ${m.is_active?'checked':''} /> Active</label>
              <button type="button" class="ghost fc-sm fcm-save">Save</button>
            </div>`).join('')}
            <div class="fc-mgr-row fc-new" data-mid="">
              <input class="fcm-name" placeholder="New manager name" />
              <input class="fcm-email" type="email" placeholder="Email" />
              <input class="fcm-loc" placeholder="Location (e.g. Zero Street)" />
              <label class="fc-inline"><input type="checkbox" class="fcm-act" checked /> Active</label>
              <button type="button" class="fc-sm fcm-save">Add</button>
            </div>
          </div>
        </div>

        <div class="card">
          <h3>Question bank <span class="hint">${activeQ} active of ${qs.length}</span></h3>
          <div class="hint">Turn questions off instead of deleting them so old test records still make sense. The correct answer must match one of the choices exactly. "None of the above" / "All of the above" always shows last.</div>
          <div id="fcqList" class="fc-q-list">${qs.map((q,i)=>qRow(q,i+1)).join('')}</div>
          <div class="actions"><button type="button" id="fcqAdd" class="ghost">Add a Question</button></div>
        </div>
      </div>`;
    el('fcsSave').onclick=saveSettings;
    document.querySelectorAll('.fcm-save').forEach(b=>b.onclick=()=>saveManager(b.closest('.fc-mgr-row')));
    bindQRows();
    el('fcqAdd').onclick=()=>{ const list=el('fcqList'); list.insertAdjacentHTML('beforeend',qRow({id:'',question:'',correct:'',options:['','','',''],is_active:true},'New')); bindQRows(); list.lastElementChild.classList.add('open'); list.lastElementChild.querySelector('.fcq-text').focus(); };
  }
  function qRow(q,n){
    const opts=[...(q.options||[])]; while(opts.length<4) opts.push('');
    return `<div class="fc-q${q.is_active?'':' off'}" data-qid="${q.id}">
      <button type="button" class="fc-q-sum"><span class="fc-q-n">${n}</span><span>${safe(q.question)||'<i>New question</i>'}</span>${q.is_active?'':'<span class="fc-state fc-state-superseded">Off</span>'}</button>
      <div class="fc-q-edit">
        <label>Question<textarea class="fcq-text" rows="2">${safe(q.question)}</textarea></label>
        <div class="mh-field-label">Choices — tap the circle for the correct one</div>
        ${opts.map((o,i)=>`<div class="fc-q-opt"><input type="radio" name="fcqc${q.id||'new'+n}" class="fcq-correct" ${o&&o===q.correct?'checked':''} aria-label="Correct answer" /><input class="fcq-opt" value="${safe(o)}" placeholder="Choice ${i+1}${i>1?' (optional)':''}" /></div>`).join('')}
        <label class="fc-inline"><input type="checkbox" class="fcq-act" ${q.is_active?'checked':''} /> Active (used in tests)</label>
        <div class="actions"><button type="button" class="fc-sm fcq-save">Save Question</button></div>
        <div class="mh-status fcq-status"></div>
      </div>
    </div>`;
  }
  function bindQRows(){
    document.querySelectorAll('.fc-q').forEach(row=>{
      row.querySelector('.fc-q-sum').onclick=()=>row.classList.toggle('open');
      row.querySelector('.fcq-save').onclick=()=>saveQuestion(row);
    });
  }
  async function saveSettings(){
    const st=el('fcsStatus'); st.style.color='var(--muted)'; st.textContent='Saving…';
    try{
      const r=await rpc('fc_mgr_save_settings',{p_passcode:M.pass,p_settings:{
        questions_per_test:+el('fcsQ').value, pass_pct:+el('fcsPct').value, cert_years:+el('fcsYears').value,
        max_fails_per_day:+el('fcsFails').value, hr_emails:el('fcsHr').value.trim(), mailer_url:el('fcsUrl').value.trim()}});
      if(!r.ok){ st.style.color=''; st.textContent=errText(r.error); return; }
      toast('Settings saved'); await refresh(true);
    }catch(e){ st.style.color=''; st.textContent='Save failed — '+e.message; }
  }
  async function saveManager(row){
    const m={id:row.dataset.mid,name:row.querySelector('.fcm-name').value,email:row.querySelector('.fcm-email').value,location:row.querySelector('.fcm-loc').value,is_active:row.querySelector('.fcm-act').checked};
    if(m.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email.trim())){ alert('That email address doesn\'t look right.'); return; }
    try{
      const r=await rpc('fc_mgr_save_manager',{p_passcode:M.pass,p_manager:m});
      if(!r.ok){ alert(errText(r.error)); return; }
      toast(m.id?'Manager saved':'Manager added'); await refresh(true);
    }catch(e){ alert('Save failed — '+e.message); }
  }
  async function saveQuestion(row){
    const st=row.querySelector('.fcq-status'); st.style.color='';
    const opts=[...row.querySelectorAll('.fc-q-opt')].map(o=>({text:o.querySelector('.fcq-opt').value.trim(),correct:o.querySelector('.fcq-correct').checked}));
    const filled=opts.filter(o=>o.text);
    const correct=(filled.find(o=>o.correct)||{}).text;
    const q={id:row.dataset.qid,question:row.querySelector('.fcq-text').value.trim(),options:filled.map(o=>o.text),correct:correct||'',is_active:row.querySelector('.fcq-act').checked};
    if(!correct){ st.textContent='Tap the circle next to the correct answer.'; return; }
    if(new Set(q.options.map(o=>o.toLowerCase())).size!==q.options.length){ st.textContent='Two choices are the same.'; return; }
    st.style.color='var(--muted)'; st.textContent='Saving…';
    try{
      const r=await rpc('fc_mgr_save_question',{p_passcode:M.pass,p_q:q});
      if(!r.ok){ st.style.color=''; st.textContent=errText(r.error); return; }
      toast('Question saved'); await refresh(true);
    }catch(e){ st.style.color=''; st.textContent='Save failed — '+e.message; }
  }

  // =====================================================================
  // VERIFY
  // =====================================================================
  async function verify(no){
    const out=el('fcvOut');
    no=String(no||'').trim().toUpperCase();
    if(!no){ out.innerHTML=''; return; }
    el('fcvNo').value=no;
    out.innerHTML='<div class="hint">Checking…</div>';
    try{
      const r=await rpc('fc_verify',{p_cert_no:no});
      if(!r.found){ out.innerHTML='<div class="fc-verify bad"><div class="fc-verify-word">NOT FOUND</div><div>No forklift certification with that number.</div></div>'; return; }
      const ok=r.state==='active'||r.state==='expiring';
      const word={active:'VALID',expiring:'VALID — EXPIRING SOON',expired:'EXPIRED',revoked:'REVOKED',superseded:'REPLACED BY A NEWER CERT'}[r.state]||r.state;
      out.innerHTML=`<div class="fc-verify ${ok?(r.state==='expiring'?'warn':'ok'):'bad'}">
        <div class="fc-verify-word">${word}</div>
        <div class="fc-verify-name">${safe(r.name)}</div>
        <div>${safe((r.truck_types||[]).join(' · '))}</div>
        <div class="fc-verify-meta">${safe(r.cert_no)}${r.location?' · '+safe(r.location):''}<br>Issued ${fmtDate(r.issued_on)} · ${r.state==='expired'?'Expired':'Expires'} ${fmtDate(r.expires_on)}<br>Evaluator: ${safe(r.evaluator)}</div>
      </div>`;
    }catch(e){ out.innerHTML='<div class="mh-status">Couldn\'t check — '+safe(e.message)+'</div>'; }
  }

  // =====================================================================
  // Wire up
  // =====================================================================
  window.addEventListener('load',()=>{
    if(!el('forkliftTest')) return;
    // Employee
    el('fcIdBtn').onclick=lookupEmp;
    el('fcEmpId').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); lookupEmp(); } });
    el('fcNotMe').onclick=resetTest;
    el('fcStartBtn').onclick=startTest;
    el('fcQOpts').addEventListener('click',e=>{
      const b=e.target.closest('.fc-opt'); if(!b) return;
      const q=T.questions[T.idx]; T.answers[q.id]=q.options[+b.dataset.i];
      renderQuestion();
      if(T.idx<T.questions.length-1) setTimeout(()=>{ T.idx++; renderQuestion(); },220);
    });
    el('fcTrNext').onclick=nextModule;
    el('fcTrPrev').onclick=()=>{ if(TR.idx>0){ TR.idx--; renderModule(); } };
    el('fcTrExit').onclick=()=>{ stopTrainTimer(); showStep('Info'); };
    el('fcPrev').onclick=()=>{ if(T.idx>0){ T.idx--; renderQuestion(); } };
    el('fcNext').onclick=()=>{ if(T.idx<T.questions.length-1){ T.idx++; renderQuestion(); } else submitTest(); };
    el('fcDots').addEventListener('click',e=>{ const b=e.target.closest('[data-q]'); if(!b) return; T.idx=+b.dataset.q; renderQuestion(); });
    window.addEventListener('beforeunload',e=>{ if(!el('fcStepTest').hidden && Object.keys(T.answers).length){ e.preventDefault(); e.returnValue=''; } });

    // Managers
    el('fcmUnlock').onclick=()=>unlock();
    LWHMgr.onEnter('fcm',()=>unlock());
    el('fcmRefresh').onclick=()=>refresh(false);
    el('fcmLock').onclick=()=>{ LWHMgr.forget(); setUnlocked(false); };
    document.querySelectorAll('[data-fctab]').forEach(b=>b.onclick=()=>{ M.tab=b.dataset.fctab; M.evalId=null; renderMgr(); });
    // Signed-in manager (or a manager already approved on this tab)? Open straight in.
    const autoOpen=()=>{ if(M.on) return; if(LWHMgr.isMgr()) unlock(''); else if(LWHMgr.get()) unlock(LWHMgr.get()); };
    new MutationObserver(()=>{ if(el('forkliftCerts').classList.contains('active')) autoOpen(); })
      .observe(el('forkliftCerts'),{attributes:true,attributeFilter:['class']});

    // Verify
    el('fcvBtn').onclick=()=>verify(el('fcvNo').value);
    el('fcvNo').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); verify(el('fcvNo').value); } });
    const params=new URLSearchParams(location.search);
    if(params.get('view')==='fcVerify' && params.get('cert')) verify(params.get('cert'));
    if(params.get('view')==='forkliftCerts') setTimeout(autoOpen,1200);
  });

  window.LWHForkliftCert={verify,certPdf};
})();
