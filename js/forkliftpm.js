/* FORKLIFT PM (v1.98.0) — its own screen in Manager (was a card at the bottom of Forklift Inspection).
   Warehouse managers only. Uses the manager's own Toolkit sign-in: the forklift-pm Edge Function checks
   they're on the manager list and talks to the forklift Apps Script with the admin passcode it keeps
   (nobody types a passcode). Shows the whole fleet sorted by hours until PM, overdue / due-soon counts,
   CSV and print, and "Log a completed PM". */
(function(){
  'use strict';
  const VIEW='forkliftPm';
  const FN='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/forklift-pm';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const toast=t=>{ try{ LWHUI.toast(t); }catch(e){} };
  const me=()=>{ try{ return JSON.parse(localStorage.getItem('lwh_whMsgMe')||'null'); }catch(e){ return null; } };
  const today=()=>new Date().toLocaleDateString('en-CA');
  let fleet=[], filter='all', loading=false;

  async function call(action,body){
    // auth.js adds the manager's sign-in (x-lwh-session) to this request
    const r=await fetch(FN+'?action='+action,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(body||{})});
    let j={}; try{ j=await r.json(); }catch(e){}
    if(!j.ok){
      if(j.error==='signed_out'&&window.LWHAuth) LWHAuth.requireSignIn('Please sign in again.');
      throw new Error(j.error==='setup_needed'?'Forklift PM needs one-time setup (the forklift admin passcode in Supabase). Ask Tim.':(j.error||'Could not reach the forklift server.'));
    }
    return j;
  }

  function build(){
    const sec=$(VIEW); if(!sec||sec.dataset.built) return; sec.dataset.built='1';
    sec.innerHTML=`<div class="mh-wrap fpm">
      <div class="mh-top"><div><h2>Forklift PM</h2><div class="mh-sub">Fleet PM status and completed PMs — managers. Hours come from the daily forklift inspections.</div></div>
        <div class="fpm-top-btns no-print"><button type="button" class="ghost" id="fpmRefresh">Refresh</button><button type="button" class="ghost" id="fpmCsv">Export CSV</button><button type="button" class="ghost" id="fpmPrint">Print</button></div></div>
      <div class="fpm-chips no-print" id="fpmChips"></div>
      <div class="card"><div id="fpmList" class="fi-pmlist"><div class="mh-sub">Loading the fleet…</div></div></div>
      <div class="card no-print" id="fpmLog">
        <h3>Log a completed PM</h3>
        <div class="fi-grid">
          <label>Forklift<select id="fpmLift"></select></label>
          <label>Meter reading at PM<input id="fpmMeter" type="number" inputmode="numeric" min="0" step="1"></label>
          <label>Performed by<input id="fpmBy" maxlength="80" placeholder="Mechanic / vendor name"></label>
          <label>Notes (optional)<input id="fpmNotes" maxlength="400" placeholder="e.g. oil change, filters"></label>
        </div>
        <button type="button" id="fpmSave">Record PM completion</button>
        <div class="mh-sub" style="margin-top:6px">Saved with your name. Resets that lift's PM countdown.</div>
      </div>
    </div>`;
    $('fpmRefresh').onclick=load; $('fpmCsv').onclick=csv; $('fpmPrint').onclick=()=>window.print(); $('fpmSave').onclick=save;
    $('fpmChips').addEventListener('click',e=>{ const b=e.target.closest('[data-fpm]'); if(!b) return; filter=b.dataset.fpm; draw(); });
    $('fpmList').addEventListener('click',e=>{ const b=e.target.closest('[data-fpm-log]'); if(!b) return; $('fpmLift').value=b.dataset.fpmLog; $('fpmMeter').focus(); $('fpmLog').scrollIntoView({behavior:'smooth',block:'center'}); });
  }

  async function load(){
    if(loading) return; loading=true;
    const btn=$('fpmRefresh'); if(btn){ btn.disabled=true; btn.textContent='Loading…'; }
    try{
      const j=await call('status'); fleet=(j.data||[]).slice().sort((a,b)=>a.hoursUntilPm-b.hoursUntilPm);
      const keep=$('fpmLift').value;
      $('fpmLift').innerHTML=fleet.map(l=>`<option value="${esc(l.liftNumber)}">${esc(l.liftNumber)} (${esc(l.type)})</option>`).join('');
      if(keep) $('fpmLift').value=keep;
      draw();
    }catch(e){ $('fpmList').innerHTML='<div class="mh-sub">'+esc(e.message)+'</div>'; toast(e.message); }
    finally{ loading=false; if(btn){ btn.disabled=false; btn.textContent='Refresh'; } }
  }
  function draw(){
    const over=fleet.filter(l=>l.status==='overdue').length, soon=fleet.filter(l=>l.status==='dueSoon').length;
    const chip=(k,t,n)=>`<button type="button" class="fpm-chip ${filter===k?'on':''} ${k}" data-fpm="${k}">${t} <b>${n}</b></button>`;
    $('fpmChips').innerHTML=chip('all','All lifts',fleet.length)+chip('overdue','Overdue',over)+chip('dueSoon','Due soon',soon)+chip('ok','OK',fleet.length-over-soon);
    const rows=fleet.filter(l=>filter==='all'||(filter==='ok'?(l.status!=='overdue'&&l.status!=='dueSoon'):l.status===filter));
    $('fpmList').innerHTML=rows.map(l=>`<div class="fi-pmrow fi-pm-${esc(l.status)}"><div><b>${esc(l.liftNumber)}</b> <span class="fi-sub">(${esc(l.type)})</span>
        <div class="fi-sub">Last PM ${esc(l.lastPmDate)} @ ${esc(l.lastPmMeter)} hrs · now ${esc(l.currentReading)} hrs · every ${esc(l.pmInterval)}</div></div>
        <div class="fpm-right"><div class="fi-pmhrs">${l.status==='overdue'?Math.abs(l.hoursUntilPm)+' hrs overdue':esc(l.hoursUntilPm)+' hrs left'}</div>
        <button type="button" class="ghost fi-small no-print" data-fpm-log="${esc(l.liftNumber)}">Log PM</button></div></div>`).join('')||'<div class="mh-sub">No lifts in this list.</div>';
  }
  async function save(){
    const m=me();
    const body={liftNumber:$('fpmLift').value,meterReading:$('fpmMeter').value,performedBy:$('fpmBy').value.trim(),notes:$('fpmNotes').value.trim()};
    if(!body.liftNumber||!/^\d+$/.test(body.meterReading)||!body.performedBy){ toast('Forklift, meter reading and performed-by are required.'); return; }
    const b=$('fpmSave'); b.disabled=true; b.textContent='Saving…';
    try{ await call('record',body); toast('PM recorded for '+body.liftNumber+(m&&m.name?' by '+m.name:'')); $('fpmMeter').value=''; $('fpmBy').value=''; $('fpmNotes').value=''; load(); }
    catch(e){ toast(e.message); }
    finally{ b.disabled=false; b.textContent='Record PM completion'; }
  }
  function csv(){
    if(!fleet.length){ toast('Load the fleet first.'); return; }
    const q=v=>{ const s=String(v==null?'':v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
    const rows=[['Lift Number','Type','PM Interval (hrs)','Last PM Meter','Last PM Date','Current Reading','Hours Until PM','Status']].concat(fleet.map(l=>[l.liftNumber,l.type,l.pmInterval,l.lastPmMeter,l.lastPmDate,l.currentReading,l.hoursUntilPm,l.status]));
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([rows.map(r=>r.map(q).join(',')).join('\n')],{type:'text/csv'})); a.download='forklift-pm-status-'+today()+'.csv'; a.click();
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const sec=$(VIEW); if(!sec) return;
    const onShow=()=>{
      const m=me();
      if(!(m&&m.is_manager)){ sec.innerHTML='<div class="card"><h2>Forklift PM</h2><p>This screen is for warehouse managers.</p></div>'; delete sec.dataset.built; return; }
      build(); load();
    };
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
  });
})();
