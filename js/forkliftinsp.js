/* FORKLIFT DAILY INSPECTION (v1.92.0)
   The pre-shift forklift checklist, now inside the Toolkit.

   - Talks to the SAME Apps Script as the stand-alone Forklift Inspections app
     (nbr1hawgfan/LWH_Forklift_Inspections), so both write to the same Sheet, the same PM
     tracking and the same report emails. The old app keeps working while people move over.
   - Operator = the signed-in employee (no typing names). Their forklift certification is
     checked against Forklift Certs and shown at the top — a warning, not a block.
   - Lift list, locations and checklist come from the Apps Script ("bootstrap"), cached on
     this device so the form opens with no signal. Submissions that can't send are queued
     here and sent when the connection comes back (the script's submissionId check stops
     duplicates — same as the old app).
   - Items that don't apply to the lift's type (propane vs electric) are set N/A and hidden.
   - PM countdown banner from the lift's hour meter and PM interval. */
(function(){
  'use strict';
  const API_URL='https://script.google.com/macros/s/AKfycbx04ENDs7GEiiudO_kQMMYr8r1oIGBNy4IBZ2KmKNokjiZ9bwt3c20hivF2fh8oDKxd/exec';
  const SUPA_RPC='https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const VIEW='forkliftInsp';
  const K={boot:'lwh_fiBoot',queue:'lwh_fiQueue',last:'lwh_fiLast',sid:'lwh_fiSid'};
  const ICON='<svg class="icon" viewBox="0 0 24 24"><path d="M4 18V8h6l3 5v5"/><path d="M13 13h3"/><path d="M17 4v14"/><path d="M17 18h4"/><circle cx="7" cy="19" r="1.6"/><circle cx="12" cy="19" r="1.6"/><path d="M5 4l1.5 1.5L9 3"/></svg>';

  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const toast=m=>{ if(window.LWHUI&&LWHUI.toast) LWHUI.toast(m); else alert(m); };
  const ls={ get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
             set(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };
  const me=()=>(window.LWHAuth&&LWHAuth.me&&LWHAuth.me())||null;
  const today=()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  const normType=t=>{ const s=String(t||'').trim().toLowerCase(); return (s==='propane'||s==='lpg')?'propane':s; };
  const applies=(to,type)=>!to||to==='Both'||normType(to)===normType(type);

  let D=null;              // bootstrap {forklifts, locations, checklist}
  let status={};           // item id -> pass | fail | na
  let forcedNa=new Set();
  let photos=[];           // compressed data URLs
  let sig=null, busy=false, built=false;

  // ---------------------------------------------------------------- shell
  function build(){
    const sec=$(VIEW); if(!sec||built) return; built=true;
    sec.innerHTML=`<div class="fi-wrap">
      <div class="mh-entry-head">
        <div class="mh-entry-icon">${ICON}</div>
        <div><h2>Forklift Inspection</h2><div class="mh-entry-sub">Daily pre-shift check. Same checklist, same records and PM tracking as the Forklift Inspections app.</div></div>
      </div>
      <div id="fiQueueBar" class="fi-note fi-warn" hidden></div>
      <div id="fiCert" class="fi-cert" hidden></div>

      <div class="card fi-card">
        <h3>Lift &amp; Hours</h3>
        <div class="fi-grid">
          <label>Operator<input id="fiOperator" readonly></label>
          <label>Date<input id="fiDate" type="date"></label>
          <label>Forklift<select id="fiLift"><option value="">Loading…</option></select></label>
          <label>Location<select id="fiLoc"><option value="">Loading…</option></select></label>
          <label>Hour meter (whole number)<input id="fiMeter" type="number" inputmode="numeric" min="0" step="1"></label>
          <div id="fiLastRead" class="fi-sub fi-lastread"></div>
        </div>
        <div id="fiPm" class="fi-note" hidden></div>
        <div id="fiExtras" class="fi-extras" hidden>
          <label class="fi-check"><input type="checkbox" id="fiPmDone"> PM was performed on this lift today <span>(resets the PM countdown)</span></label>
          <label class="fi-check" id="fiLpgRow" hidden><input type="checkbox" id="fiLpg"> Propane bottle used up / changed</label>
        </div>
      </div>

      <div class="card fi-card">
        <div class="fi-cl-head"><h3>Checklist</h3><span id="fiProgress" class="fi-sub"></span><button type="button" class="ghost fi-small" id="fiAllPass">All Pass</button></div>
        <p class="fi-sub fi-help">✓ = OK &nbsp; ✕ = problem &nbsp; – = doesn't apply. Tap <b>All Pass</b>, then change only what's wrong.</p>
        <div id="fiList"><div class="fi-sub">Pick a forklift to see its checklist.</div></div>
      </div>

      <div class="card fi-card">
        <h3>Problems &amp; Photos</h3>
        <label>Defects / notes <span id="fiDefReq" class="in-red" hidden>— required when something fails</span><textarea id="fiDefects" rows="4" placeholder="What's wrong? Anything the shop should know?"></textarea></label>
        <div class="fi-photos"><button type="button" class="ghost fi-small" id="fiAddPhoto">📷 Add photo</button><div id="fiThumbs" class="fi-thumbs"></div></div>
      </div>

      <div class="card fi-card">
        <h3>Signature</h3>
        <canvas id="fiSig" class="fi-sig"></canvas>
        <div class="fi-sig-row"><span class="fi-sub">Sign with your finger or mouse.</span><button type="button" class="ghost fi-small" id="fiSigClear">Clear</button></div>
      </div>

      <button type="button" id="fiSubmit" class="fi-submit">Submit Inspection</button>
      <div id="fiPmAdmin" class="card fi-card fi-pmadmin" hidden>
        <div class="fi-cl-head"><h3>PM Admin <span class="fi-sub">(managers)</span></h3><span class="fi-sub" id="fiPmStatus"></span><button type="button" class="ghost fi-small" id="fiPmLoad">Show fleet PM status</button></div>
        <div id="fiPmBody" hidden>
          <div id="fiPmList" class="fi-pmlist"></div>
          <div class="fi-pm-actions no-print"><button type="button" class="ghost fi-small" id="fiPmCsv">Export CSV</button><button type="button" class="ghost fi-small" id="fiPmPrint">Print</button></div>
          <h4 class="fi-pm-h">Log a completed PM</h4>
          <div class="fi-grid">
            <label>Forklift<select id="fiPmLift"></select></label>
            <label>Meter reading at PM<input id="fiPmMeter" type="number" inputmode="numeric" min="0" step="1"></label>
            <label>Performed by<input id="fiPmBy" maxlength="80" placeholder="Mechanic / vendor name"></label>
            <label>Notes (optional)<input id="fiPmNotes" maxlength="400" placeholder="e.g. oil change, filters"></label>
          </div>
          <button type="button" id="fiPmSave">Record PM completion</button>
        </div>
      </div>
    </div>`;

    $('fiDate').value=today();
    $('fiLift').onchange=onLift;
    $('fiMeter').oninput=pmBanner;
    $('fiPmDone').onchange=pmBanner;
    $('fiAllPass').onclick=allPass;
    $('fiAddPhoto').onclick=addPhoto;
    $('fiSigClear').onclick=()=>sig.clear();
    $('fiSubmit').onclick=submit;
    $('fiLoc').onchange=()=>remember();
    $('fiList').addEventListener('click',e=>{
      const b=e.target.closest('[data-fi-st]'); if(!b) return;
      setStatus(b.dataset.fiId,b.dataset.fiSt);
    });
    sig=sigPad($('fiSig'));
    $('fiPmLoad').onclick=pmLoad; $('fiPmSave').onclick=pmSave; $('fiPmCsv').onclick=pmCsv; $('fiPmPrint').onclick=()=>window.print();
  }

  // ---------------------------------------------------------------- PM Admin (warehouse managers)
  // Uses the manager's Toolkit sign-in; the forklift-pm Edge Function holds the admin passcode.
  const PM_FN='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/forklift-pm';
  let fleet=[];
  async function pmCall(action,body){
    const r=await fetch(PM_FN+'?action='+action,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(body||{})});
    let j={}; try{ j=await r.json(); }catch(e){}
    if(!j.ok){
      if(j.error==='signed_out'&&window.LWHAuth) LWHAuth.requireSignIn('Please sign in again.');
      throw new Error(j.error==='setup_needed'?'PM Admin needs one-time setup (the forklift admin passcode in Supabase). Ask Tim.':(j.error||'Could not reach the forklift server.'));
    }
    return j;
  }
  async function pmLoad(){
    $('fiPmStatus').textContent='Loading…';
    try{
      const j=await pmCall('status'); fleet=(j.data||[]).slice().sort((a,b)=>a.hoursUntilPm-b.hoursUntilPm);
      $('fiPmBody').hidden=false; $('fiPmLoad').textContent='Refresh';
      const over=fleet.filter(l=>l.status==='overdue').length, soon=fleet.filter(l=>l.status==='dueSoon').length;
      $('fiPmStatus').textContent=`${fleet.length} lifts · ${over} overdue · ${soon} due soon`;
      $('fiPmList').innerHTML=fleet.map(l=>`<div class="fi-pmrow fi-pm-${esc(l.status)}"><div><b>${esc(l.liftNumber)}</b> <span class="fi-sub">(${esc(l.type)})</span><div class="fi-sub">Last PM ${esc(l.lastPmDate)} @ ${esc(l.lastPmMeter)} hrs · now ${esc(l.currentReading)} hrs · every ${esc(l.pmInterval)}</div></div><div class="fi-pmhrs">${l.status==='overdue'?Math.abs(l.hoursUntilPm)+' hrs overdue':esc(l.hoursUntilPm)+' hrs left'}</div></div>`).join('')||'<div class="fi-sub">No lifts.</div>';
      const keep=$('fiPmLift').value;
      $('fiPmLift').innerHTML=fleet.map(l=>`<option value="${esc(l.liftNumber)}">${esc(l.liftNumber)} (${esc(l.type)})</option>`).join('');
      if(keep) $('fiPmLift').value=keep;
      if(!$('fiPmBy').value&&me()) $('fiPmBy').placeholder='Mechanic / vendor name';
    }catch(e){ $('fiPmStatus').textContent=''; toast(e.message); }
  }
  async function pmSave(){
    const body={liftNumber:$('fiPmLift').value,meterReading:$('fiPmMeter').value,performedBy:$('fiPmBy').value.trim(),notes:$('fiPmNotes').value.trim()};
    if(!body.liftNumber||!/^\d+$/.test(body.meterReading)||!body.performedBy){ toast('Forklift, meter reading and performed-by are required.'); return; }
    const b=$('fiPmSave'); b.disabled=true; b.textContent='Saving…';
    try{ await pmCall('record',body); toast('PM recorded for '+body.liftNumber); $('fiPmMeter').value=''; $('fiPmBy').value=''; $('fiPmNotes').value=''; pmLoad(); ls.set(K.boot,null); }
    catch(e){ toast(e.message); }
    finally{ b.disabled=false; b.textContent='Record PM completion'; }
  }
  function pmCsv(){
    if(!fleet.length){ toast('Load the fleet first.'); return; }
    const q=v=>{ const s=String(v==null?'':v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
    const rows=[['Lift Number','Type','PM Interval (hrs)','Last PM Meter','Last PM Date','Current Reading','Hours Until PM','Status']].concat(fleet.map(l=>[l.liftNumber,l.type,l.pmInterval,l.lastPmMeter,l.lastPmDate,l.currentReading,l.hoursUntilPm,l.status]));
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([rows.map(r=>r.map(q).join(',')).join('\n')],{type:'text/csv'})); a.download='forklift-pm-status-'+today()+'.csv'; a.click();
  }

  // ---------------------------------------------------------------- signature pad (no library)
  function sigPad(c){
    let drawing=false, dirty=false, last=null; const ctx=c.getContext('2d');
    function size(){
      const r=Math.max(window.devicePixelRatio||1,1), w=c.offsetWidth||300, h=c.offsetHeight||170;
      const keep=dirty?c.toDataURL():null;
      c.width=w*r; c.height=h*r; ctx.setTransform(r,0,0,r,0,0);
      ctx.lineWidth=2.2; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#1c1c2b';
      if(keep){ const i=new Image(); i.onload=()=>ctx.drawImage(i,0,0,w,h); i.src=keep; }
    }
    const pt=e=>{ const b=c.getBoundingClientRect(); return {x:e.clientX-b.left,y:e.clientY-b.top}; };
    c.addEventListener('pointerdown',e=>{ drawing=true; last=pt(e); c.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(last.x,last.y,1,0,7); ctx.fillStyle='#1c1c2b'; ctx.fill(); dirty=true; e.preventDefault(); });
    c.addEventListener('pointermove',e=>{ if(!drawing) return; const p=pt(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault(); });
    ['pointerup','pointercancel','pointerleave'].forEach(t=>c.addEventListener(t,()=>{ drawing=false; }));
    window.addEventListener('resize',()=>{ if(c.offsetWidth) size(); });
    return { size, isEmpty:()=>!dirty, clear(){ dirty=false; ctx.clearRect(0,0,c.width,c.height); }, toDataURL(){
      // white background so the image reads the same in the Sheet / email
      const o=document.createElement('canvas'); o.width=c.width; o.height=c.height; const x=o.getContext('2d');
      x.fillStyle='#fff'; x.fillRect(0,0,o.width,o.height); x.drawImage(c,0,0); return o.toDataURL('image/png'); } };
  }

  // ---------------------------------------------------------------- data
  async function loadBoot(){
    const cached=ls.get(K.boot,null); if(cached) apply(cached);
    if(navigator.onLine===false){ if(!cached) $('fiList').innerHTML='<div class="fi-sub">No connection, and this device hasn\'t loaded the checklist yet. Try again with signal.</div>'; return; }
    try{
      const r=await (await fetch(API_URL+'?action=bootstrap',{cache:'no-store'})).json();
      if(r&&r.success){ ls.set(K.boot,r.data); apply(r.data); }
      else if(!cached) toast('Could not load the forklift list: '+((r&&r.message)||'unknown error'));
    }catch(e){ if(!cached) toast('Could not reach the forklift inspection server.'); }
  }
  function apply(d){
    const liftWas=$('fiLift').value, locWas=$('fiLoc').value;
    D={forklifts:d.forklifts||[],locations:d.locations||[],checklist:d.checklist||[]};
    const last=ls.get(K.last,{});
    $('fiLift').innerHTML='<option value="">Pick a forklift…</option>'+D.forklifts.map(f=>`<option value="${esc(f.number)}">${esc(f.number)} (${esc(f.type)})</option>`).join('');
    $('fiLoc').innerHTML='<option value="">Pick a location…</option>'+D.locations.map(l=>`<option>${esc(l)}</option>`).join('');
    const lift=liftWas||last.lift||'', locn=locWas||last.loc||(me()&&me().location)||'';
    if(D.forklifts.some(f=>String(f.number)===String(lift))) $('fiLift').value=lift;
    if(D.locations.includes(locn)) $('fiLoc').value=locn;
    onLift(true);
  }
  const lift=()=>D&&D.forklifts.find(f=>String(f.number)===$('fiLift').value);
  function remember(){ ls.set(K.last,{lift:$('fiLift').value,loc:$('fiLoc').value}); }

  function onLift(keepAnswers){
    const f=lift();
    $('fiExtras').hidden=!f;
    $('fiLpgRow').hidden=!(f&&normType(f.type)==='propane');
    if(keepAnswers!==true) $('fiMeter').value='';
    const lr=f?parseInt(f.lastReading,10):NaN;
    $('fiLastRead').textContent=!f?'':(isNaN(lr)?'No earlier hour reading on file.':'Last recorded reading: '+lr);
    remember(); renderList(); pmBanner();
  }

  function pmBanner(){
    const f=lift(), box=$('fiPm'), m=parseFloat($('fiMeter').value);
    if(!f||isNaN(m)){ box.hidden=true; return; }
    box.hidden=false;
    const lr=parseInt(f.lastReading,10);
    if(!isNaN(lr)&&m<lr){ box.className='fi-note fi-warn'; box.textContent=`That's lower than the last reading (${lr}). Double-check the hour meter.`; return; }
    if($('fiPmDone').checked){ box.className='fi-note fi-info'; box.textContent=`PM will be logged today at ${m} hours — the countdown starts over.`; return; }
    const left=(Number(f.pmInterval)||0)-(m-(Number(f.lastPmMeter)||0));
    if(!Number(f.pmInterval)){ box.hidden=true; return; }
    if(left<=0){ box.className='fi-note fi-bad'; box.textContent=`⚠ PM is overdue by about ${Math.abs(Math.round(left))} hours (every ${f.pmInterval} hrs). Tell your manager.`; }
    else if(left<=20){ box.className='fi-note fi-warn'; box.textContent=`PM due in about ${Math.round(left)} hours (every ${f.pmInterval} hrs).`; }
    else box.hidden=true;
  }

  // ---------------------------------------------------------------- checklist
  function renderList(){
    const f=lift(), box=$('fiList');
    if(!D||!D.checklist.length){ box.innerHTML='<div class="fi-sub">Loading checklist…</div>'; return; }
    if(!f){ box.innerHTML='<div class="fi-sub">Pick a forklift to see its checklist.</div>'; updateProgress(); return; }
    const nowForced=new Set();
    D.checklist.forEach(it=>{
      if(!applies(it.appliesTo,f.type)){ nowForced.add(String(it.id)); status[it.id]='na'; }
      else if(forcedNa.has(String(it.id))) delete status[it.id];
    });
    forcedNa=nowForced;
    const cats={};
    D.checklist.filter(it=>!forcedNa.has(String(it.id))).forEach(it=>{ (cats[it.category||'General']=cats[it.category||'General']||[]).push(it); });
    box.innerHTML=Object.entries(cats).map(([cat,items])=>`<div class="fi-cat"><h4>${esc(cat)}</h4>${items.map(it=>row(it)).join('')}</div>`).join('');
    updateProgress();
  }
  function row(it){
    const s=status[it.id]||'';
    const b=(st,label,title)=>`<button type="button" class="fi-st fi-st-${st}${s===st?' on':''}" data-fi-id="${esc(it.id)}" data-fi-st="${st}" title="${title}" aria-pressed="${s===st}">${label}</button>`;
    return `<div class="fi-item${s?' res-'+s:''}" id="fiItem_${esc(it.id)}"><div class="fi-q">${esc(it.question)}</div><div class="fi-btns">${b('pass','✓','OK')}${b('na','–','Doesn\'t apply')}${b('fail','✕','Problem')}</div></div>`;
  }
  function setStatus(id,st){
    const it=D.checklist.find(x=>String(x.id)===String(id)); if(!it) return;
    status[it.id]=st;
    const el=$('fiItem_'+id); if(el) el.outerHTML=row(it);
    if(st==='fail'){
      const ta=$('fiDefects'), line=`${it.question} — FAILED`;
      if(!ta.value.includes(line)) ta.value=(ta.value?ta.value.replace(/\s*$/,'')+'\n':'')+line+'\n';
    }
    updateProgress();
  }
  function allPass(){
    if(!lift()){ toast('Pick a forklift first.'); return; }
    if(Object.values(status).includes('fail')&&!confirm('Some items are marked ✕ (problem). Change them all to ✓ pass?')) return;
    D.checklist.forEach(it=>{ if(!forcedNa.has(String(it.id))) status[it.id]='pass'; });
    renderList();
  }
  function visible(){ return D?D.checklist.filter(it=>!forcedNa.has(String(it.id))):[]; }
  function updateProgress(){
    const v=visible(), done=v.filter(it=>status[it.id]).length, bad=v.filter(it=>status[it.id]==='fail').length;
    $('fiProgress').textContent=lift()?`${done} of ${v.length} checked${bad?` · ${bad} problem${bad===1?'':'s'}`:''}`:'';
    $('fiDefReq').hidden=!bad;
  }

  // ---------------------------------------------------------------- photos
  function addPhoto(){
    if(photos.length>=6){ toast('Up to 6 photos.'); return; }
    const i=document.createElement('input'); i.type='file'; i.accept='image/*'; i.setAttribute('capture','environment');
    i.onchange=async()=>{ const f=i.files&&i.files[0]; if(!f) return; try{ photos.push(await shrink(f)); drawThumbs(); }catch(e){ toast('Could not read that photo.'); } };
    i.click();
  }
  function shrink(file){
    return new Promise((res,rej)=>{
      const url=URL.createObjectURL(file), img=new Image();
      img.onload=()=>{ const s=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight)); const c=document.createElement('canvas');
        c.width=Math.round(img.naturalWidth*s); c.height=Math.round(img.naturalHeight*s); c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg',0.75)); };
      img.onerror=()=>{ URL.revokeObjectURL(url); rej(); };
      img.src=url;
    });
  }
  function drawThumbs(){
    $('fiThumbs').innerHTML=photos.map((p,i)=>`<span class="in-thumb"><img src="${p}" alt="Photo ${i+1}"><button type="button" class="in-thumb-x" data-fi-x="${i}" aria-label="Remove photo">×</button></span>`).join('');
    $('fiThumbs').querySelectorAll('[data-fi-x]').forEach(b=>b.onclick=()=>{ photos.splice(+b.dataset.fiX,1); drawThumbs(); });
  }

  // ---------------------------------------------------------------- forklift cert check
  async function certCheck(){
    const m=me(), box=$('fiCert'); if(!box) return;
    $('fiOperator').value=m?m.name:'';
    if(!m||!m.emp_id){ box.hidden=true; return; }
    try{
      const r=await (await fetch(SUPA_RPC+'fc_lookup_employee',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({p_emp_id:+m.emp_id}),cache:'no-store'})).json();
      const c=r&&r.cert; box.hidden=false;
      const exp=c&&c.expires_on?new Date(c.expires_on+'T12:00:00'):null;
      if(c&&c.state==='expired'){
        box.className='fi-cert fi-bad';
        box.innerHTML=`<b>Your forklift certification expired${exp?' on '+exp.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):''}.</b> You can still submit this inspection — see your manager about recertifying.`;
      }else if(c&&(c.state==='active'||c.state==='expiring'||!c.state)){
        const soon=c.state==='expiring';
        box.className='fi-cert '+(soon?'fi-warn':'fi-ok');
        box.innerHTML=`<b>✓ Forklift certified</b>${exp?` — good through ${exp.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`:''}${soon?'. <b>Renewal coming up</b> — talk to your manager.':''}`;
      }else{
        box.className='fi-cert fi-bad';
        box.innerHTML='<b>No active forklift certification on file for you.</b> You can still submit this inspection, but check with your manager before operating a lift.';
      }
    }catch(e){ box.hidden=true; }
  }

  // ---------------------------------------------------------------- submit + offline queue
  function sid(){ let s=ls.get(K.sid,null); if(!s){ s=(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)); ls.set(K.sid,s); } return s; }

  function validate(){
    const miss=[];
    if(!$('fiOperator').value) miss.push('sign in');
    if(!$('fiLift').value) miss.push('forklift');
    if(!$('fiLoc').value) miss.push('location');
    if($('fiMeter').value===''||!/^\d+$/.test($('fiMeter').value)) miss.push('hour meter (whole number)');
    const open=visible().filter(it=>!status[it.id]);
    if(open.length) miss.push(open.length+' checklist item'+(open.length===1?'':'s'));
    if(visible().some(it=>status[it.id]==='fail')&&!$('fiDefects').value.trim()) miss.push('a note about the problem');
    if(sig.isEmpty()) miss.push('signature');
    if(open.length){ const el=$('fiItem_'+open[0].id); if(el){ el.classList.add('fi-missing'); el.scrollIntoView({block:'center',behavior:'smooth'}); } }
    return miss;
  }

  async function submit(){
    if(busy) return;
    const miss=validate();
    if(miss.length){ toast('Still needed: '+miss.join(', ')+'.'); return; }
    const responses={};
    D.checklist.forEach(it=>{ responses[it.id]={status:status[it.id]||'not_checked',question:it.question}; });
    const body={action:'submitInspection',payload:{
      submissionId:sid(), operatorName:$('fiOperator').value, date:$('fiDate').value||today(),
      liftNumber:$('fiLift').value, location:$('fiLoc').value, meterReading:$('fiMeter').value,
      propaneUsed:$('fiLpg').checked, pmPerformedToday:$('fiPmDone').checked,
      checklistResponses:responses, defects:$('fiDefects').value, signature:sig.toDataURL(), photos:photos.slice(),
      source:'Warehouse Toolkit', employeeId:(me()&&me().emp_id)||''
    }};
    busy=true; const btn=$('fiSubmit'); btn.disabled=true; btn.textContent='Sending…';
    const r=await send(body,1);
    busy=false; btn.disabled=false; btn.textContent='Submit Inspection';
    if(r==='queued'){ queue(body); done('Saved on this device — no connection right now. It sends by itself when you\'re back online. Don\'t submit it again.'); }
    else if(r&&r.success){
      let msg='Inspection recorded. Thank you!';
      if(r.pmStatus&&r.pmStatus.overdue) msg+=' This lift\'s PM is overdue — let your manager know.';
      else if(r.pmStatus&&r.pmStatus.dueSoon) msg+=' This lift\'s PM is due soon.';
      if(r.photoErrors&&r.photoErrors.length) msg+=' A photo didn\'t attach — the inspection still saved; tell your manager.';
      done(msg);
    }else toast((r&&r.message)||'The inspection did not save. Try again.');
  }
  // Apps Script sometimes drops the reply even though it saved; retry once, then queue.
  async function send(body,retries){
    if(navigator.onLine===false) return 'queued';
    try{ return await (await fetch(API_URL,{method:'POST',body:JSON.stringify(body)})).json(); }
    catch(e){ if(retries>0){ await new Promise(r=>setTimeout(r,1500)); return send(body,retries-1); } return 'queued'; }
  }
  function queue(body){ const q=ls.get(K.queue,[]); q.push(body); ls.set(K.queue,q.slice(-20)); queueBar(); }
  function queueBar(){ const n=ls.get(K.queue,[]).length, b=$('fiQueueBar'); if(!b) return; b.hidden=!n; b.textContent=n?`${n} inspection${n===1?'':'s'} saved on this device, waiting for a connection to send.`:''; }
  async function flush(){
    const q=ls.get(K.queue,[]); if(!q.length||navigator.onLine===false) return;
    const left=[];
    for(const b of q){ const r=await send(b,0); if(!(r&&r.success)) left.push(b); }
    ls.set(K.queue,left); queueBar();
    if(left.length<q.length) toast(`${q.length-left.length} saved inspection${q.length-left.length===1?'':'s'} sent.`);
  }

  function done(msg){
    ls.set(K.sid,null);
    status={}; forcedNa=new Set(); photos=[]; drawThumbs();
    $('fiMeter').value=''; $('fiDefects').value=''; $('fiPmDone').checked=false; $('fiLpg').checked=false; $('fiDate').value=today();
    sig.clear(); renderList(); pmBanner();
    window.scrollTo({top:0,behavior:'smooth'});
    if(window.LWHUI&&LWHUI.toast) LWHUI.toast(msg); alert(msg);
    loadBoot(); // refresh last readings / PM after the save
  }

  // ---------------------------------------------------------------- start
  window.addEventListener('online',flush);
  document.addEventListener('DOMContentLoaded',()=>{
    const sec=$(VIEW); if(!sec) return;
    let started=false;
    const onShow=()=>{ build(); setTimeout(()=>sig.size(),30); certCheck(); if($('fiPmAdmin')) $('fiPmAdmin').hidden=!(me()&&me().is_manager); queueBar(); if(!started){ started=true; loadBoot(); } flush(); };
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
    setTimeout(flush,4000);
  });
})();
