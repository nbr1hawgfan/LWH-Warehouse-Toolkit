/* PRODUCTION (v1.85.0) — crew production entry, pricing, employees and analytics.
   Replaces the "Scrapping Production Analytics" Apps Script web app. The records stay in the same
   Google Sheet; gas/ProductionAPI.gs is the API and still sends the 9 AM daily email.

   Who can use it is checked by the Apps Script on every request (not just on screen): it asks
   Supabase who the signed-in Toolkit session belongs to.
     manager (warehouse manager list) → record/edit, all analytics and $, email reports
     entry   (Access tab)             → record/edit, units and hours only — no $ or pay rates
     admin   (Access tab)             → plus pricing, employees, pay rates, OT rules, report recipients
   Setup: docs/PRODUCTION_SETUP.md */
(function(){
  'use strict';
  // Paste the Production Apps Script web app URL here (Deploy → Manage deployments → /exec URL).
  // It can also be set on a device from Production → Settings → Connection.
  const PROD_API_DEFAULT='https://script.google.com/macros/s/AKfycbwTfl3WI53g3GMtxcyJgY8V5L5QJgK-LyGSiGMV_OpwDqLDBlpLf-bl7QR8GpYtchDweg/exec';
  const SUPA='https://tjivcqxnkftujceumdtx.supabase.co', KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const LS_URL='lwh_prodApi', LS_ROLE='lwh_prodRole', LS_LAST='lwh_prodLastJob', LS_EMAIL='lwh_prodEmail';
  const C_REV='#c8102e', C_LAB='#1d72c4';   // validated pair (dataviz validator, light surface)

  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const n=v=>{ const x=Number(v); return isFinite(x)?x:0; };
  const r2=v=>Math.round(n(v)*100)/100;
  const money=v=>(n(v)<0?'−$':'$')+Math.abs(n(v)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const money0=v=>(n(v)<0?'−$':'$')+Math.round(Math.abs(n(v))).toLocaleString('en-US');
  const int=v=>Math.round(n(v)).toLocaleString('en-US');
  const units=v=>{ const x=r2(v); return Number.isInteger(x)?x.toLocaleString('en-US'):x.toLocaleString('en-US',{maximumFractionDigits:2}); };
  const d1=v=>n(v).toFixed(1), d2=v=>n(v).toFixed(2);
  const pad=x=>String(x).padStart(2,'0');
  const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());       // local date — no UTC slip
  const parse=s=>{ const p=String(s).split('-'); return new Date(+p[0],+p[1]-1,+p[2]); };
  const addDays=(s,k)=>{ const d=parse(s); d.setDate(d.getDate()+k); return ymd(d); };
  const today=()=>ymd(new Date());
  const sunday=s=>{ const d=parse(s); d.setDate(d.getDate()-d.getDay()); return ymd(d); };
  const nice=s=>parse(s).toLocaleDateString('en-US',{weekday:'short',month:'numeric',day:'numeric'});
  const niceLong=s=>parse(s).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const ls={ get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
             set(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };
  const auth=()=>window.LWHAuth||null;
  const toast=m=>{ if(window.LWHUI&&LWHUI.toast) LWHUI.toast(m); };

  // ---------------------------------------------------------------- state
  let B=null;                    // bootstrap: me, projects, employees, crews, settings, access
  let tab='record', loading=false, built=false;
  const F={ jobId:'', date:today(), project:'', crew:[], units:'', custOt:'', notes:'', week:{before:{},total:{}}, filter:'' };
  let weekSeq=0, weekTimer=null;
  let entries=null, entriesRange={start:today(),end:today()}, entriesFilter='';
  let dash=null, dashRange=null, dashPreset='thisweek', empSort={k:'name',dir:1}, openEmp='';
  let tcWeek=sunday(today()), tc=null;
  let setTab_='projects', editProject=null, editEmp=null, directory=null, audit=null;

  const role=()=>B&&B.me&&B.me.role||'';
  const isMoney=()=>role()==='manager'||role()==='admin';
  const isAdmin=()=>role()==='admin';
  const apiUrl=()=>String(ls.get(LS_URL,'')||PROD_API_DEFAULT||'').trim();
  const projByKey=k=>(B&&B.projects||[]).find(p=>p.key===k);
  const empByName=nm=>(B&&B.employees||[]).find(e=>e.name===nm);

  // ---------------------------------------------------------------- API
  async function api(action,args){
    const url=apiUrl(); if(!url) throw new Error('not_connected');
    const a=auth(); const token=a&&a.token&&a.token();
    if(!token){ if(a) a.requireSignIn('Please sign in to use Production.'); throw new Error('signed_out'); }
    let res;
    try{ res=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({},args||{},{action,token})),cache:'no-store',redirect:'follow'}); }
    catch(e){ throw new Error('offline'); }
    let r; try{ r=await res.json(); }catch(e){ throw new Error('bad_reply'); }
    if(!r||!r.ok){
      const err=(r&&r.error)||'failed';
      if(err==='signed_out'&&a) a.requireSignIn('Your sign-in ran out. Please sign in again.');
      throw new Error(err);
    }
    return r;
  }
  function errText(e){
    const m=String(e&&e.message||e);
    if(m.startsWith('bad_input:')) return m.slice(10);
    return ({ not_connected:'Production isn\'t connected yet — an admin needs to add the Apps Script link (Settings → Connection).',
      offline:'Couldn\'t reach the server. Check your connection and try again.', signed_out:'Please sign in again.',
      no_access:'You don\'t have access to Production. Ask Tim to add you on the Access list.',
      not_allowed:'Your access level can\'t do that.', bad_reply:'The server sent back something unexpected. Check the Apps Script link in Settings → Connection.' })[m]
      || (m.startsWith('busy')?'Someone else is saving right now — try again in a moment.':'Something went wrong: '+m);
  }
  function msg(html,tone){ const m=$('prMsg'); if(!m) return; m.innerHTML=html||''; m.hidden=!html; m.className='pr-msg'+(tone?' pr-msg-'+tone:''); }
  async function busy(btn,label,fn){
    const old=btn?btn.innerHTML:''; if(btn){ btn.disabled=true; btn.textContent=label; }
    try{ return await fn(); } finally{ if(btn){ btn.disabled=false; btn.innerHTML=old; } }
  }

  // ---------------------------------------------------------------- shell
  const ICON='<svg class="icon" viewBox="0 0 24 24"><path d="M3 21h18"/><path d="M5 21V10l4 3V10l4 3V10l4 3V5h2v16"/></svg>';
  function build(){
    const sec=$('production'); if(!sec||built) return; built=true;
    sec.innerHTML=`<div class="pr-wrap">
      <div class="pr-top no-print">
        <div class="mh-entry-head">
          <div class="mh-entry-icon">${ICON}</div>
          <div><h2>Production</h2><div class="mh-entry-sub">Record crew production, track units per hour and margin. Daily report emails at 9 AM.</div></div>
          <div class="pr-who"><span id="prWho"></span><button type="button" class="ghost pr-small" id="prRefresh">Refresh</button></div>
        </div>
        <div class="pr-tabs" role="tablist" id="prTabs">
          <button type="button" data-prtab="record" role="tab">Record</button>
          <button type="button" data-prtab="entries" role="tab">Entries</button>
          <button type="button" data-prtab="dash" role="tab">Dashboard</button>
          <button type="button" data-prtab="tc" role="tab" data-need="money">Timeclock</button>
          <button type="button" data-prtab="settings" role="tab" data-need="admin">Settings</button>
        </div>
      </div>
      <div id="prMsg" class="pr-msg no-print" hidden></div>
      <div id="prBody"></div>
    </div>`;
    $('prTabs').addEventListener('click',e=>{ const b=e.target.closest('[data-prtab]'); if(b) setTab(b.dataset.prtab); });
    $('prRefresh').onclick=()=>{ entries=null; dash=null; tc=null; boot(true); };
  }

  async function boot(force){
    if(loading) return; if(B&&!force){ render(); return; }
    const a=auth();
    if(!a||!a.isSignedIn()){ msg('Please sign in to use Production.','warn'); $('prBody').innerHTML=''; return; }
    if(!apiUrl()){ renderConnect(); return; }
    loading=true; msg('Loading…');
    try{
      B=await api('bootstrap');
      ls.set(LS_ROLE,role()); showNav();
      if(!F.project){ const last=ls.get(LS_LAST,null); const p=last&&projByKey(last.project); F.project=p&&p.active?p.key:''; }
      msg(''); render();
    }catch(e){
      if(e.message==='no_access'){ ls.set(LS_ROLE,''); showNav(); }
      msg(esc(errText(e)),'bad');
      if(e.message==='bad_reply'||e.message==='not_connected') renderConnect();
      else $('prBody').innerHTML='';
    }finally{ loading=false; }
  }

  function renderConnect(){
    msg('');
    $('prBody').innerHTML=`<div class="card pr-card pr-narrow"><h3>Connect Production</h3>
      <p class="hint">Paste the Production Apps Script web app link (ends in <b>/exec</b>). It's saved on this device. See docs/PRODUCTION_SETUP.md — or ask Tim.</p>
      <label>Apps Script link<input id="prUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(apiUrl())}"></label>
      <div class="actions"><button type="button" id="prUrlSave">Save &amp; Connect</button></div></div>`;
    $('prUrlSave').onclick=()=>{ const v=$('prUrl').value.trim(); if(!/^https:\/\/script\.google\.com\/.+\/exec$/.test(v)){ toast('That doesn\'t look like an Apps Script /exec link.'); return; } ls.set(LS_URL,v); boot(true); };
  }

  function setTab(t){
    if(t==='tc'&&!isMoney()) t='record';
    if(t==='settings'&&!isAdmin()) t='record';
    if(t!==tab) msg('');
    tab=t; render();
  }
  function render(){
    if(!B) return;
    $('prWho').innerHTML=`${esc(B.me.name)} · <b class="pr-role pr-role-${esc(role())}">${esc(role())}</b>`;
    document.querySelectorAll('#prTabs [data-prtab]').forEach(b=>{
      const need=b.dataset.need; b.hidden=(need==='money'&&!isMoney())||(need==='admin'&&!isAdmin());
      b.classList.toggle('active',b.dataset.prtab===tab); b.setAttribute('aria-selected',b.dataset.prtab===tab);
    });
    ({record:renderRecord,entries:renderEntries,dash:renderDash,tc:renderTc,settings:renderSettings})[tab]();
  }

  // ================================================================ RECORD
  function renderRecord(){
    const projects=B.projects.filter(p=>p.active||p.key===F.project);
    const emps=B.employees.filter(e=>e.active||F.crew.some(c=>c.name===e.name));
    const editing=!!F.jobId;
    $('prBody').innerHTML=`
      ${editing?`<div class="pr-editing no-print"><span>Editing a saved job from <b>${esc(nice(F.date))}</b>. Saving replaces it.</span><button type="button" class="ghost pr-small" id="prCancelEdit">Cancel edit</button></div>`:''}
      <div class="pr-rec">
        <div class="card pr-card">
          <div class="pr-grid2">
            <label>Date<input type="date" id="prDate" value="${esc(F.date)}" max="${esc(addDays(today(),1))}"></label>
            <label>Project<select id="prProject"><option value="">Select project…</option>${projects.map(p=>`<option value="${esc(p.key)}"${p.key===F.project?' selected':''}>${esc(p.name)}${isMoney()&&p.rate!=null?' — '+money(p.rate)+'/unit':''}${p.active?'':' (off)'}</option>`).join('')}</select></label>
          </div>

          <div class="pr-sub">Crew <span class="pr-count" id="prCrewCount"></span></div>
          <div class="pr-crewbar">
            <select id="prCrewPick" aria-label="Saved crews"><option value="">Saved crews…</option>${(B.crews||[]).map(c=>`<option value="${esc(c.name)}">${esc(c.name)} (${c.members.length})</option>`).join('')}</select>
            <button type="button" class="ghost pr-small" id="prLastCrew" title="Same people as the last job you saved on this device">Last crew</button>
            <button type="button" class="ghost pr-small" id="prSaveCrew">Save as crew</button>
            ${isMoney()?'<button type="button" class="ghost pr-small" id="prDelCrew" hidden>Delete crew</button>':''}
          </div>
          <input type="search" id="prEmpSearch" placeholder="Find a person…" value="${esc(F.filter)}" autocomplete="off" aria-label="Find a person">
          <div class="pr-chips" id="prChips">${emps.map(e=>{ const on=F.crew.some(c=>c.name===e.name); return `<button type="button" class="pr-chip${on?' on':''}" data-emp="${esc(e.name)}" aria-pressed="${on}">${on?'✓ ':''}${esc(e.name)}</button>`; }).join('')||'<span class="hint">No employees yet.'+(isAdmin()?' Add them in Settings → Employees.':'')+'</span>'}</div>

          <div class="pr-allhours">
            <label>Hours for everyone<input type="number" id="prAllHours" min="0" max="24" step="0.25" inputmode="decimal" placeholder="e.g. 8"></label>
            <button type="button" class="ghost" id="prApplyHours">Apply to crew</button>
          </div>
          <div id="prCrewTable"></div>

          <div class="pr-grid2">
            <label>Total units (whole crew)<input type="number" id="prUnits" min="0" step="1" inputmode="numeric" value="${esc(F.units)}" placeholder="0"></label>
            <label>Customer OT hours${isMoney()&&B.settings.otBillingRate!=null?` <span class="pr-tag">${money(B.settings.otBillingRate)}/hr</span>`:''}<input type="number" id="prCustOt" min="0" step="0.25" inputmode="decimal" value="${esc(F.custOt)}" placeholder="0"></label>
          </div>
          <label>Notes <span class="hint">(optional)</span><input id="prNotes" maxlength="500" value="${esc(F.notes)}" placeholder="Anything worth knowing about this job"></label>
          <div class="actions">
            <button type="button" id="prSave">${editing?'Save changes':'Save job'}</button>
            <button type="button" class="ghost" id="prClear">${editing?'Cancel':'Clear'}</button>
          </div>
        </div>
        <div class="card pr-card pr-preview" id="prPreview"></div>
      </div>`;
    wireRecord(); renderCrewTable(); renderPreview(); fetchWeek();
  }

  function wireRecord(){
    $('prDate').onchange=e=>{ F.date=e.target.value; fetchWeek(); renderPreview(); };
    $('prProject').onchange=e=>{ F.project=e.target.value; renderPreview(); };
    $('prUnits').oninput=e=>{ F.units=e.target.value; renderPreview(); };
    $('prCustOt').oninput=e=>{ F.custOt=e.target.value; renderPreview(); };
    $('prNotes').oninput=e=>{ F.notes=e.target.value; };
    $('prEmpSearch').oninput=e=>{ F.filter=e.target.value; filterChips(); };
    $('prChips').onclick=e=>{ const c=e.target.closest('[data-emp]'); if(!c) return; toggleEmp(c.dataset.emp); };
    $('prApplyHours').onclick=()=>{ const h=r2($('prAllHours').value); if(!(h>0)){ toast('Enter the hours first.'); return; } F.crew.forEach(c=>c.hours=h); renderCrewTable(); renderPreview(); };
    $('prAllHours').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); $('prApplyHours').click(); } };
    $('prCrewPick').onchange=e=>{
      const c=(B.crews||[]).find(x=>x.name===e.target.value); const del=$('prDelCrew'); if(del) del.hidden=!c;
      if(!c) return;
      const h=F.crew.length?F.crew[0].hours:'';
      F.crew=c.members.filter(m=>empByName(m)).map(m=>({name:m,hours:h}));
      const missing=c.members.filter(m=>!empByName(m)); if(missing.length) toast('Not on the employee list anymore: '+missing.join(', '));
      refreshCrew();
    };
    const del=$('prDelCrew'); if(del) del.onclick=async()=>{
      const name=$('prCrewPick').value; if(!name||!confirm('Delete the saved crew "'+name+'"? (Nobody\'s entries change.)')) return;
      try{ const r=await api('deleteCrew',{name}); B.crews=r.crews; renderRecord(); toast('Crew deleted'); }catch(e){ toast(errText(e)); }
    };
    $('prLastCrew').onclick=()=>{
      const last=ls.get(LS_LAST,null); if(!last||!last.crew||!last.crew.length){ toast('No saved job on this device yet.'); return; }
      F.crew=last.crew.filter(c=>empByName(c.name)).map(c=>({name:c.name,hours:c.hours}));
      if(!F.project&&last.project&&projByKey(last.project)) F.project=last.project;
      renderRecord();
    };
    $('prSaveCrew').onclick=async()=>{
      if(!F.crew.length){ toast('Pick the crew first.'); return; }
      const name=(prompt('Name this crew (e.g. "Line 2 Scrapping"):',$('prCrewPick').value||'')||'').trim(); if(!name) return;
      try{ const r=await api('saveCrew',{name,members:F.crew.map(c=>c.name)}); B.crews=r.crews; renderRecord(); toast('Crew saved'); }catch(e){ toast(errText(e)); }
    };
    $('prSave').onclick=saveJob;
    $('prClear').onclick=()=>{ if(F.jobId){ clearForm(); setTab('entries'); } else { clearForm(); renderRecord(); } };
    const ce=$('prCancelEdit'); if(ce) ce.onclick=()=>{ clearForm(); setTab('entries'); };
    filterChips();
  }
  function filterChips(){
    const q=F.filter.trim().toLowerCase();
    document.querySelectorAll('#prChips [data-emp]').forEach(b=>{ b.hidden=!!q&&!b.dataset.emp.toLowerCase().includes(q)&&!b.classList.contains('on'); });
  }
  function toggleEmp(name){
    const i=F.crew.findIndex(c=>c.name===name);
    if(i>=0) F.crew.splice(i,1);
    else F.crew.push({name,hours:F.crew.length?F.crew[F.crew.length-1].hours:(r2($('prAllHours')&&$('prAllHours').value)||'')});
    refreshCrew();
    const s=$('prEmpSearch'); if(s&&s.value){ s.value=''; F.filter=''; filterChips(); s.focus(); }
  }
  function refreshCrew(){
    document.querySelectorAll('#prChips [data-emp]').forEach(b=>{ const on=F.crew.some(c=>c.name===b.dataset.emp); b.classList.toggle('on',on); b.setAttribute('aria-pressed',on); b.textContent=(on?'✓ ':'')+b.dataset.emp; });
    renderCrewTable(); renderPreview(); fetchWeek();
  }
  function renderCrewTable(){
    $('prCrewCount').textContent=F.crew.length?`· ${F.crew.length} ${F.crew.length===1?'person':'people'}`:'';
    const box=$('prCrewTable');
    if(!F.crew.length){ box.innerHTML='<div class="pr-empty">Tap names above to add them to this job — one person or the whole crew.</div>'; return; }
    const thr=B.settings.otThreshold||40;
    box.innerHTML=`<table class="pr-table pr-crew"><thead><tr><th>Person</th><th class="r">Hours</th><th class="r" title="Production hours already logged this Sun–Sat week">Week so far</th><th></th></tr></thead><tbody>
      ${F.crew.map((c,i)=>{ const wk=n(F.week.total[c.name]); const after=wk+n(c.hours); const ot=after>thr;
        return `<tr><td>${esc(c.name)}</td>
          <td class="r"><input type="number" class="pr-hrs" data-i="${i}" min="0" max="24" step="0.25" inputmode="decimal" value="${esc(c.hours)}" aria-label="Hours for ${esc(c.name)}"></td>
          <td class="r"><span class="pr-wk${ot?' ot':after>=(B.settings.otWatch||36)?' warn':''}">${d1(wk)} → ${d1(after)}</span>${ot?' <b class="pr-badge pr-badge-ot">OT</b>':''}</td>
          <td class="r"><button type="button" class="pr-x" data-rm="${i}" aria-label="Remove ${esc(c.name)}">✕</button></td></tr>`; }).join('')}
      </tbody></table>`;
    box.querySelectorAll('.pr-hrs').forEach(inp=>inp.oninput=()=>{ F.crew[+inp.dataset.i].hours=inp.value; renderPreview(); updateWeekCells(); });
    box.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{ F.crew.splice(+b.dataset.rm,1); refreshCrew(); });
  }
  function updateWeekCells(){
    const thr=B.settings.otThreshold||40;
    document.querySelectorAll('#prCrewTable tbody tr').forEach((tr,i)=>{
      const c=F.crew[i]; if(!c) return; const wk=n(F.week.total[c.name]), after=wk+n(c.hours), ot=after>thr;
      tr.cells[2].innerHTML=`<span class="pr-wk${ot?' ot':after>=(B.settings.otWatch||36)?' warn':''}">${d1(wk)} → ${d1(after)}</span>${ot?' <b class="pr-badge pr-badge-ot">OT</b>':''}`;
    });
  }
  function fetchWeek(){
    clearTimeout(weekTimer);
    const names=F.crew.map(c=>c.name); if(!names.length||!F.date) return;
    weekTimer=setTimeout(async()=>{
      const seq=++weekSeq;
      try{ const r=await api('weekHours',{date:F.date,names,excludeJobId:F.jobId||''}); if(seq!==weekSeq) return;
        F.week={before:r.before||{},total:r.total||{}}; updateWeekCells(); renderPreview(); }catch(e){}
    },350);
  }

  /** Same math as the server: split by hours share; OT from the week's earlier hours. */
  function computePreview(){
    const p=projByKey(F.project), totalH=F.crew.reduce((a,c)=>a+n(c.hours),0), u=n(F.units), cot=n(F.custOt);
    const thr=B.settings.otThreshold||40, mult=B.settings.otMultiplier||1.5, otRate=n(B.settings.otBillingRate), bill=p&&p.rate!=null?n(p.rate):0;
    const rows=F.crew.map(c=>{
      const h=n(c.hours), share=totalH>0?h/totalH:0, before=n(F.week.before[c.name]);
      const reg=Math.min(h,Math.max(0,thr-before)), ot=Math.max(0,h-reg);
      const e=empByName(c.name), rate=e&&e.rate!=null?n(e.rate):0;
      return {name:c.name,hours:h,units:u*share,reg,ot,labor:reg*rate+ot*rate*mult};
    });
    const labor=rows.reduce((a,x)=>a+x.labor,0), unitRev=u*bill, otRev=cot*otRate, rev=unitRev+otRev;
    return {p,rows,totalH,u,uph:totalH>0?u/totalH:0,labor,unitRev,otRev,rev,margin:rev-labor,pct:rev>0?(rev-labor)/rev*100:0,
      ot:rows.reduce((a,x)=>a+x.ot,0)};
  }
  function renderPreview(){
    const box=$('prPreview'); if(!box) return;
    const x=computePreview(), m=isMoney();
    const tgt=x.p&&x.p.target?x.p.target:0, tp=tgt&&x.totalH?x.uph/tgt*100:null;
    box.innerHTML=`<div class="pr-sub" style="margin-top:0">Live preview</div>
      <div class="pr-mini">
        <div><span>Crew hours</span><b>${d2(x.totalH)}</b></div>
        <div><span>Units / hour</span><b>${d1(x.uph)}</b>${tgt?`<small>${targetBadge(tp)} target ${d1(tgt)}</small>`:''}</div>
        ${m?`<div><span>Revenue</span><b>${money(x.rev)}</b>${x.otRev?`<small>${money(x.unitRev)} units + ${money(x.otRev)} cust OT</small>`:''}</div>
        <div><span>Labor</span><b>${money(x.labor)}</b>${x.ot>0?`<small class="pr-ot-t">incl. ${d2(x.ot)} OT hrs</small>`:''}</div>
        <div class="pr-mini-wide"><span>Margin</span><b class="${x.margin<0?'pr-neg':''}">${money(x.margin)}</b><small>${d1(x.pct)}% of revenue</small></div>`
        :(x.ot>0?`<div><span>Employee OT hrs</span><b class="pr-ot-t">${d2(x.ot)}</b></div>`:'')}
      </div>
      ${x.rows.length>1?`<table class="pr-table pr-split"><thead><tr><th>Split by hours</th><th class="r">Hrs</th><th class="r">Units</th>${m?'<th class="r">Labor</th>':''}</tr></thead><tbody>
        ${x.rows.map(r=>`<tr><td>${esc(r.name)}${r.ot>0?' <b class="pr-badge pr-badge-ot">OT '+d2(r.ot)+'</b>':''}</td><td class="r">${d2(r.hours)}</td><td class="r">${units(r.units)}</td>${m?`<td class="r">${money(r.labor)}</td>`:''}</tr>`).join('')}
      </tbody></table>`:''}
      <p class="hint">Units and customer OT hours are split by each person's share of the crew's hours. Employee OT is figured on the whole Sun–Sat week when you save${B.settings.otThreshold?` (over ${B.settings.otThreshold} hrs)`:''}.</p>`;
  }

  async function saveJob(){
    const btn=$('prSave');
    if(!F.date) return toast('Pick a date.');
    if(!F.project) return toast('Pick a project.');
    if(!F.crew.length) return toast('Pick at least one person.');
    const bad=F.crew.find(c=>!(n(c.hours)>0)); if(bad) return toast('Enter hours for '+bad.name+'.');
    if(F.units===''||n(F.units)<0) return toast('Enter total units (0 if none).');
    const x=computePreview();
    if(x.uph>0&&x.p&&x.p.target&&x.uph>x.p.target*3&&!confirm(`${d1(x.uph)} units/hour is over 3× the target of ${x.p.target}. Save anyway?`)) return;
    try{
      await busy(btn,'Saving…',async()=>{
        const args={jobId:F.jobId||'',date:F.date,project:F.project,units:n(F.units),custOtHours:n(F.custOt),notes:F.notes,crew:F.crew.map(c=>({name:c.name,hours:n(c.hours)}))};
        let r;
        try{ r=await api('saveJob',args); }
        catch(e){
          if(e.message!=='duplicate') throw e;
          if(!confirm('This looks like a job that\'s already saved — same day, project, crew and units.\n\nSave it again anyway?')) return;
          r=await api('saveJob',Object.assign(args,{allowDuplicate:true}));
        }
        ls.set(LS_LAST,{project:F.project,crew:F.crew.map(c=>({name:c.name,hours:n(c.hours)}))});
        const j=r.job, wasEdit=!!F.jobId;
        entries=null; dash=null; tc=null;
        const keepDate=F.date, keepProject=F.project;
        clearForm(); F.date=keepDate; F.project=keepProject;
        toast(wasEdit?'Changes saved':'Saved — '+units(j.units)+' units, '+j.crew.length+(j.crew.length===1?' person':' people'));
        if(wasEdit){ setTab('entries'); return; }
        renderRecord(); window.scrollTo(0,0);
        msg(`Saved: <b>${esc(j.projectName)}</b> · ${esc(nice(j.date))} · ${esc(j.crew.map(c=>c.name).join(', '))} · ${units(j.units)} units · ${d1(j.uph)}/hr${isMoney()?' · margin '+money(j.margin):''}${j.empOtHours>0?` · <span class="pr-ot-t">${d2(j.empOtHours)} OT hrs</span>`:''}`,'good');
      });
    }catch(e){ toast(errText(e)); msg(esc(errText(e)),'bad'); }
  }
  function clearForm(){ Object.assign(F,{jobId:'',date:today(),crew:[],units:'',custOt:'',notes:'',week:{before:{},total:{}},filter:''}); }
  function loadJob(j){
    clearForm();
    Object.assign(F,{jobId:j.jobId,date:j.date,project:j.project,crew:j.crew.map(c=>({name:c.name,hours:c.hours})),units:String(r2(j.units)),custOt:j.custOtHours?String(j.custOtHours):'',notes:j.notes||''});
    msg(''); setTab('record'); window.scrollTo(0,0);
  }

  // ================================================================ ENTRIES
  function renderEntries(){
    const m=isMoney();
    $('prBody').innerHTML=`<div class="card pr-card">
      <div class="pr-filters">
        <label>From<input type="date" id="prEStart" value="${esc(entriesRange.start)}"></label>
        <label>To<input type="date" id="prEEnd" value="${esc(entriesRange.end)}"></label>
        <div class="pr-quick"><button type="button" class="ghost pr-small" data-eq="today">Today</button><button type="button" class="ghost pr-small" data-eq="yday">Yesterday</button><button type="button" class="ghost pr-small" data-eq="week">This week</button><button type="button" class="ghost pr-small" data-eq="lweek">Last week</button></div>
        <input type="search" id="prEFilter" placeholder="Filter by person or project" value="${esc(entriesFilter)}" aria-label="Filter entries">
        <button type="button" class="ghost pr-small" id="prEExport">Excel</button>
      </div>
      <div id="prEList"><div class="pr-empty">Loading…</div></div></div>`;
    const go=()=>{ entriesRange={start:$('prEStart').value,end:$('prEEnd').value}; entries=null; loadEntries(); };
    $('prEStart').onchange=go; $('prEEnd').onchange=go;
    document.querySelectorAll('[data-eq]').forEach(b=>b.onclick=()=>{
      const t=today(), w=sunday(t);
      entriesRange=({today:{start:t,end:t},yday:{start:addDays(t,-1),end:addDays(t,-1)},week:{start:w,end:t},lweek:{start:addDays(w,-7),end:addDays(w,-1)}})[b.dataset.eq];
      entries=null; renderEntries();
    });
    $('prEFilter').oninput=e=>{ entriesFilter=e.target.value; drawEntries(); };
    $('prEExport').onclick=exportEntries;
    if(entries) drawEntries(); else loadEntries();
    void m;
  }
  async function loadEntries(){
    const box=$('prEList'); if(!box) return;
    if(!entriesRange.start||!entriesRange.end||entriesRange.end<entriesRange.start){ box.innerHTML='<div class="pr-empty">Pick a date range.</div>'; return; }
    box.innerHTML='<div class="pr-empty">Loading…</div>';
    try{ const r=await api('entries',entriesRange); entries=r.jobs||[]; drawEntries(); }
    catch(e){ box.innerHTML=`<div class="pr-empty pr-neg">${esc(errText(e))}</div>`; }
  }
  function filteredEntries(){
    const q=entriesFilter.trim().toLowerCase();
    return (entries||[]).filter(j=>!q||j.projectName.toLowerCase().includes(q)||j.crew.some(c=>c.name.toLowerCase().includes(q))||(j.notes||'').toLowerCase().includes(q));
  }
  function drawEntries(){
    const box=$('prEList'); if(!box||!entries) return;
    const list=filteredEntries(), m=isMoney();
    if(!list.length){ box.innerHTML='<div class="pr-empty">No production entered for these dates.</div>'; return; }
    const sum=list.reduce((a,j)=>{ a.u+=j.units; a.h+=j.hours; a.r+=n(j.revenue); a.m+=n(j.margin); return a; },{u:0,h:0,r:0,m:0});
    box.innerHTML=`<div class="pr-sumline">${list.length} ${list.length===1?'job':'jobs'} · ${units(sum.u)} units · ${d1(sum.h)} hrs · ${d1(sum.h?sum.u/sum.h:0)}/hr${m?' · '+money(sum.r)+' revenue · '+money(sum.m)+' margin':''}</div>
      <div class="pr-scroll"><table class="pr-table pr-entries"><thead><tr><th>Date</th><th>Project</th><th>Crew</th><th class="r">Units</th><th class="r">Hours</th><th class="r">Units/hr</th>${m?'<th class="r">Revenue</th><th class="r">Margin</th>':''}<th></th></tr></thead><tbody>
      ${list.map((j,i)=>`<tr>
        <td class="nw">${esc(nice(j.date))}</td>
        <td>${esc(j.projectName)}${j.custOtHours?`<div class="pr-small-t">+${d2(j.custOtHours)} cust OT hrs</div>`:''}${j.notes?`<div class="pr-small-t pr-note">${esc(j.notes)}</div>`:''}</td>
        <td class="pr-crewcell">${j.crew.map(c=>`<span class="pr-pill">${esc(c.name)} <i>${d2(c.hours)}h</i>${c.otHours>0?' <b class="pr-ot-t">OT</b>':''}</span>`).join('')}</td>
        <td class="r">${units(j.units)}</td><td class="r">${d2(j.hours)}</td><td class="r">${d1(j.uph)}</td>
        ${m?`<td class="r">${money(j.revenue)}</td><td class="r${j.margin<0?' pr-neg':''}">${money(j.margin)}</td>`:''}
        <td class="r nw">${j.jobId?`<button type="button" class="ghost pr-small" data-edit="${i}">Edit</button> <button type="button" class="ghost pr-small pr-danger" data-del="${i}">Delete</button>`:''}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="hint">Entered by and when is kept with every job; edits and deletes are logged.</p>`;
    box.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>loadJob(list[+b.dataset.edit]));
    box.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
      const j=list[+b.dataset.del];
      if(!confirm(`Delete this job?\n\n${nice(j.date)} · ${j.projectName}\n${j.crew.map(c=>c.name).join(', ')}\n${units(j.units)} units\n\nOvertime for the rest of that week is rechecked.`)) return;
      try{ await busy(b,'…',()=>api('deleteJob',{jobId:j.jobId})); toast('Deleted'); dash=null; tc=null; loadEntries(); }catch(e){ toast(errText(e)); }
    });
  }
  function exportEntries(){
    if(!entries||!entries.length) return toast('Nothing to export.');
    if(!window.LWHXlsx) return toast('Excel export isn\'t loaded.');
    const m=isMoney(), cols=[{label:'Date',width:11},{label:'Project',width:22},{label:'Employee',width:20},{label:'Hours',type:'n',width:8},{label:'Units',type:'n',width:9},{label:'Units/Hr',type:'n',width:9},{label:'Emp OT Hrs',type:'n',width:10}];
    if(m) cols.push({label:'Labor',type:'n',width:11},{label:'Revenue',type:'n',width:11});
    cols.push({label:'Job Units',type:'n',width:10},{label:'Cust OT Hrs (job)',type:'n',width:12},{label:'Notes',width:30});
    const rows=[];
    filteredEntries().forEach(j=>j.crew.forEach(c=>{ const r=[j.date,j.projectName,c.name,c.hours,r2(c.units),c.hours?r2(c.units/c.hours):0,c.otHours]; if(m) r.push(r2(c.labor),r2(c.revenue)); r.push(j.units,j.custOtHours,j.notes||''); rows.push(r); }));
    LWHXlsx.download(`production_${entriesRange.start}_to_${entriesRange.end}.xlsx`,[{name:'Entries',columns:cols,rows}]);
  }

  // ================================================================ DASHBOARD
  const PRESETS=[['today','Today'],['yday','Yesterday'],['thisweek','This week'],['lastweek','Last week'],['month','This month'],['lmonth','Last month'],['30','Last 30 days'],['custom','Custom']];
  function presetRange(p){
    const t=today(), w=sunday(t), d=parse(t);
    switch(p){
      case 'today': return {start:t,end:t};
      case 'yday': return {start:addDays(t,-1),end:addDays(t,-1)};
      case 'thisweek': return {start:w,end:t};
      case 'lastweek': return {start:addDays(w,-7),end:addDays(w,-1)};
      case 'month': return {start:ymd(new Date(d.getFullYear(),d.getMonth(),1)),end:t};
      case 'lmonth': return {start:ymd(new Date(d.getFullYear(),d.getMonth()-1,1)),end:ymd(new Date(d.getFullYear(),d.getMonth(),0))};
      case '30': return {start:addDays(t,-29),end:t};
      default: return dashRange||{start:w,end:t};
    }
  }
  function renderDash(){
    if(!dashRange) dashRange=presetRange(dashPreset);
    $('prBody').innerHTML=`<div class="pr-dashbar no-print">
        <div class="pr-presets">${PRESETS.map(([k,l])=>`<button type="button" class="pr-preset${dashPreset===k?' on':''}" data-preset="${k}">${l}</button>`).join('')}</div>
        <div class="pr-custom"${dashPreset==='custom'?'':' hidden'}><input type="date" id="prDStart" value="${esc(dashRange.start)}" aria-label="From"><span>to</span><input type="date" id="prDEnd" value="${esc(dashRange.end)}" aria-label="To"></div>
        <div class="pr-dashact"><button type="button" class="ghost pr-small" id="prDExport">Excel</button><button type="button" class="ghost pr-small" id="prDPrint">Print</button></div>
      </div>
      <div id="prDash"><div class="pr-empty">Loading…</div></div>`;
    document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{ dashPreset=b.dataset.preset; if(dashPreset!=='custom'){ dashRange=presetRange(dashPreset); dash=null; } renderDash(); });
    const cs=$('prDStart'), ce=$('prDEnd');
    const go=()=>{ if(cs.value&&ce.value&&ce.value>=cs.value){ dashRange={start:cs.value,end:ce.value}; dash=null; loadDash(); } };
    cs.onchange=go; ce.onchange=go;
    $('prDExport').onclick=exportDash; $('prDPrint').onclick=()=>window.print();
    if(dash&&dash.start===dashRange.start&&dash.end===dashRange.end) drawDash(); else loadDash();
  }
  async function loadDash(){
    const box=$('prDash'); if(!box) return; box.innerHTML='<div class="pr-empty">Loading…</div>';
    try{ dash=await api('analytics',{start:dashRange.start,end:dashRange.end,compare:true}); drawDash(); }
    catch(e){ box.innerHTML=`<div class="pr-empty pr-neg">${esc(errText(e))}</div>`; }
  }
  function deltaTxt(cur,prev,kind,lowerBetter){
    if(prev==null) return '';
    const d=n(cur)-n(prev); if(Math.abs(d)<0.005) return '<small class="pr-delta">same as previous period</small>';
    const good=lowerBetter?d<0:d>0, f=kind==='money'?money0(Math.abs(d)):kind==='int'?int(Math.abs(d)):d1(Math.abs(d));
    return `<small class="pr-delta ${good?'up':'down'}">${d>0?'▲':'▼'} ${f} vs previous</small>`;
  }
  function targetBadge(p){
    if(p==null||!isFinite(p)) return '';
    const cls=p>=100?'good':p>=85?'warn':'bad', ic=p>=100?'▲':p>=85?'●':'▼';
    return `<b class="pr-badge pr-t-${cls}">${ic} ${Math.round(p)}%</b>`;
  }
  function drawDash(){
    const box=$('prDash'); if(!box||!dash) return;
    const t=dash.total, p=dash.previous||null, m=isMoney();
    const label=dash.start===dash.end?niceLong(dash.start):nice(dash.start)+' – '+nice(dash.end);
    const tiles=m?[
      ['Revenue',money(t.revenue),deltaTxt(t.revenue,p&&p.revenue,'money'),'accent'],
      ['Labor cost',money(t.labor),deltaTxt(t.labor,p&&p.labor,'money',true)],
      ['Margin',money(t.margin),`<small class="pr-delta">${d1(t.marginPct)}% of revenue</small>`,'accent'],
      ['Units',units(t.units),deltaTxt(t.units,p&&p.units,'int')],
      ['Units / hour',d1(t.uph),deltaTxt(t.uph,p&&p.uph,'dec')],
      ['Hours',d1(t.hours),`<small class="pr-delta">${t.employeeCount} ${t.employeeCount===1?'person':'people'} · ${t.jobCount} ${t.jobCount===1?'job':'jobs'}</small>`],
      ['Labor per unit',money(t.laborPerUnit),`<small class="pr-delta">break-even ${int(t.breakevenUnits)} units</small>`],
      ['Overtime',d1(t.empOtHours)+' hrs',`<small class="pr-delta">${d1(t.custOtHours)} cust OT hrs billed · ${money(t.custOtRevenue)}</small>`]
    ]:[
      ['Units',units(t.units),deltaTxt(t.units,p&&p.units,'int'),'accent'],
      ['Units / hour',d1(t.uph),deltaTxt(t.uph,p&&p.uph,'dec')],
      ['Hours',d1(t.hours),`<small class="pr-delta">${t.employeeCount} people · ${t.jobCount} jobs</small>`],
      ['Employee OT',d1(t.empOtHours)+' hrs','']
    ];
    box.innerHTML=`<div class="pr-print-head">Production — ${esc(label)}</div>
      ${!t.hours&&!t.units?'<div class="pr-msg pr-msg-warn">No production was recorded for this period.</div>':''}
      <div class="pr-tiles">${tiles.map(x=>`<div class="pr-tile${x[3]?' accent':''}"><span>${x[0]}</span><b>${x[1]}</b>${x[2]||''}</div>`).join('')}</div>
      <div class="card pr-card"><div class="pr-cardhead"><h3>${m?'Revenue and labor':'Units'} ${dash.trend.some(x=>x.week)?'by week':'by day'}</h3>
        ${m?`<div class="pr-legend"><span><i style="background:${C_REV}"></i>Revenue</span><span><i style="background:${C_LAB}"></i>Labor</span></div>`:''}</div>
        <div class="pr-chart" id="prChart"></div>
        <details class="pr-details"><summary>Show as table</summary><div class="pr-scroll">${trendTable()}</div></details></div>
      <div class="card pr-card"><div class="pr-cardhead"><h3>Projects</h3><span class="hint">% of target = units/hr vs the project's target (set in Settings)</span></div>
        <div class="pr-scroll">${projTable()}</div></div>
      <div class="card pr-card"><div class="pr-cardhead"><h3>Employees</h3><span class="hint">Tap a name for project detail. % of target weighs each project's own target.</span></div>
        <div class="pr-scroll" id="prEmpTable">${empTable()}</div></div>
      ${otCard()}
      ${m?`<div class="card pr-card no-print"><div class="pr-cardhead"><h3>Email this report</h3><span class="hint">${esc(label)} — with a CSV of the entries</span></div>
        <div class="pr-email"><input type="email" id="prEmailTo" placeholder="name@logistics-warehouse.com" value="${esc(ls.get(LS_EMAIL,''))}" aria-label="Email address"><button type="button" id="prEmailGo">Send</button></div></div>`:''}`;
    drawChart();
    wireEmpTable();
    const eg=$('prEmailGo'); if(eg) eg.onclick=()=>{
      const to=$('prEmailTo').value.trim(); if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return toast('Enter an email address.');
      ls.set(LS_EMAIL,to);
      busy(eg,'Sending…',()=>api('sendReport',{email:to,start:dash.start,end:dash.end})).then(r=>toast(r.message||'Sent')).catch(e=>toast(errText(e)));
    };
  }
  function trendTable(){
    const m=isMoney();
    return `<table class="pr-table"><thead><tr><th>${dash.trend.some(x=>x.week)?'Week of':'Day'}</th><th class="r">Units</th><th class="r">Hours</th><th class="r">Units/hr</th>${m?'<th class="r">Revenue</th><th class="r">Labor</th><th class="r">Margin</th>':''}</tr></thead><tbody>
      ${dash.trend.map(x=>`<tr><td>${esc(nice(x.label))}</td><td class="r">${units(x.units)}</td><td class="r">${d1(x.hours)}</td><td class="r">${d1(x.uph)}</td>${m?`<td class="r">${money(x.revenue)}</td><td class="r">${money(x.labor)}</td><td class="r">${money(x.margin)}</td>`:''}</tr>`).join('')}</tbody></table>`;
  }
  function projTable(){
    const m=isMoney();
    if(!dash.projects.length) return '<div class="pr-empty">No projects worked in this period.</div>';
    return `<table class="pr-table"><thead><tr><th>Project</th><th class="r">Units</th><th class="r">Hours</th><th class="r">Units/hr</th><th class="r">Target</th><th class="r">% of target</th>${m?'<th class="r">Revenue</th><th class="r">Labor</th><th class="r">Margin</th><th class="r">Margin %</th>':''}<th class="r">People</th></tr></thead><tbody>
      ${dash.projects.map(p=>`<tr><td>${esc(p.name)}</td><td class="r">${units(p.units)}</td><td class="r">${d1(p.hours)}</td><td class="r">${d1(p.uph)}</td><td class="r">${p.target?d1(p.target):'<span class="hint">—</span>'}</td><td class="r">${p.target?targetBadge(p.targetPct):''}</td>
        ${m?`<td class="r">${money(p.revenue)}</td><td class="r">${money(p.labor)}</td><td class="r${p.margin<0?' pr-neg':''}">${money(p.margin)}</td><td class="r">${d1(p.marginPct)}%</td>`:''}<td class="r">${p.employeeCount}</td></tr>`).join('')}</tbody></table>`;
  }
  function empTable(){
    const m=isMoney(), k=empSort.k, dir=empSort.dir;
    if(!dash.employees.length) return '<div class="pr-empty">Nobody logged production in this period.</div>';
    const list=dash.employees.slice().sort((a,b)=>{ const x=a[k],y=b[k]; return (typeof x==='string'?String(x).localeCompare(String(y)):(n(x)-n(y)))*dir; });
    const th=(key,lbl,r)=>`<th class="${r?'r ':''}pr-sort${k===key?' on':''}" data-sort="${key}">${lbl}${k===key?(dir>0?' ↑':' ↓'):''}</th>`;
    return `<table class="pr-table pr-emps"><thead><tr>${th('name','Employee')}${th('days','Days',1)}${th('hours','Hours',1)}${th('units','Units',1)}${th('uph','Units/hr',1)}${th('targetPct','% of target',1)}${th('otHours','OT hrs',1)}${m?th('labor','Labor',1)+th('revenue','Revenue',1):''}</tr></thead><tbody>
      ${list.map(e=>`<tr class="pr-emprow${openEmp===e.name?' open':''}" data-emp-open="${esc(e.name)}" tabindex="0"><td><b>${esc(e.name)}</b><div class="pr-small-t">${esc(e.projects.map(p=>p.name).join(', '))}</div></td><td class="r">${e.days}</td><td class="r">${d1(e.hours)}</td><td class="r">${units(e.units)}</td><td class="r">${d1(e.uph)}</td><td class="r">${e.targetPct!=null?targetBadge(e.targetPct):'<span class="hint">—</span>'}</td><td class="r${e.otHours>0?' pr-ot-t':''}">${d1(e.otHours)}</td>${m?`<td class="r">${money(e.labor)}</td><td class="r">${money(e.revenue)}</td>`:''}</tr>
        ${openEmp===e.name?`<tr class="pr-empdetail"><td colspan="${m?9:7}"><table class="pr-table pr-inner"><thead><tr><th>Project</th><th class="r">Hours</th><th class="r">Units</th><th class="r">Units/hr</th><th class="r">Target</th><th class="r">% of target</th></tr></thead><tbody>
          ${e.projects.map(p=>`<tr><td>${esc(p.name)}</td><td class="r">${d1(p.hours)}</td><td class="r">${units(p.units)}</td><td class="r">${d1(p.uph)}</td><td class="r">${p.target?d1(p.target):'—'}</td><td class="r">${p.target?targetBadge(p.targetPct):''}</td></tr>`).join('')}</tbody></table></td></tr>`:''}`).join('')}
      </tbody></table>`;
  }
  function wireEmpTable(){
    const box=$('prEmpTable'); if(!box) return;
    box.querySelectorAll('[data-sort]').forEach(h=>h.onclick=()=>{ const k=h.dataset.sort; empSort={k,dir:empSort.k===k?-empSort.dir:(k==='name'?1:-1)}; box.innerHTML=empTable(); wireEmpTable(); });
    box.querySelectorAll('[data-emp-open]').forEach(r=>{ const f=()=>{ openEmp=openEmp===r.dataset.empOpen?'':r.dataset.empOpen; box.innerHTML=empTable(); wireEmpTable(); }; r.onclick=f; r.onkeydown=e=>{ if(e.key==='Enter') f(); }; });
  }
  function otCard(){
    const w=dash.otWatch; if(!w) return '';
    return `<div class="card pr-card"><div class="pr-cardhead"><h3>Weekly OT watch</h3><span class="hint">Week of ${esc(nice(w.weekStart))} · ${w.watch}+ production hours · OT after ${w.threshold}</span></div>
      ${w.people.length?`<table class="pr-table"><thead><tr><th>Employee</th><th class="r">Hours this week</th><th class="r">OT hours</th><th class="r">Left before OT</th><th style="width:34%"></th></tr></thead><tbody>
        ${w.people.map(x=>`<tr><td>${esc(x.name)}</td><td class="r">${d1(x.hours)}</td><td class="r${x.otHours>0?' pr-ot-t':''}">${d1(x.otHours)}</td><td class="r">${d1(x.left)}</td>
          <td><div class="pr-bar" title="${d1(x.hours)} of ${w.threshold}"><i style="width:${Math.min(100,x.hours/w.threshold*100)}%" class="${x.hours>w.threshold?'ot':x.hours>=w.watch?'warn':''}"></i></div></td></tr>`).join('')}</tbody></table>`
      :'<div class="pr-empty">Nobody is close to overtime this week.</div>'}</div>`;
  }

  // ---- chart: grouped bars (revenue + labor) or single series (units); one axis; hover tooltip
  function drawChart(){
    const box=$('prChart'); if(!box) return;
    const data=dash.trend, m=isMoney();
    if(!data.length){ box.innerHTML='<div class="pr-empty">No data.</div>'; return; }
    const series=m?[{k:'revenue',c:C_REV,l:'Revenue'},{k:'labor',c:C_LAB,l:'Labor'}]:[{k:'units',c:C_REV,l:'Units'}];
    const W=Math.max(320,box.clientWidth||700), H=240, L=m?58:44, R=8, T=10, Bm=26, pw=W-L-R, ph=H-T-Bm;
    const max=Math.max(1,...data.flatMap(d=>series.map(s=>n(d[s.k]))));
    const step=niceStep(max/4), top=Math.ceil(max/step)*step;
    const band=pw/data.length, gap=2, inner=Math.max(2,Math.min(28,(band*0.72-gap*(series.length-1))/series.length));
    const groupW=inner*series.length+gap*(series.length-1);
    const y=v=>T+ph-(n(v)/top)*ph, fmtAx=v=>m?(v>=1000?'$'+(v/1000).toFixed(v%1000?1:0)+'k':'$'+v):int(v);
    let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${m?'Revenue and labor':'Units'} by ${data.some(d=>d.week)?'week':'day'}">`;
    for(let v=0;v<=top+1e-9;v+=step){ s+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="#e8e6ea" stroke-width="1"/><text x="${L-6}" y="${y(v)+4}" text-anchor="end" class="pr-ax">${fmtAx(r2(v))}</text>`; }
    const every=Math.ceil(data.length/Math.max(1,Math.floor(pw/58)));
    data.forEach((d,i)=>{
      const x0=L+i*band+(band-groupW)/2;
      series.forEach((se,j)=>{ const v=n(d[se.k]); if(v<=0) return; const x=x0+j*(inner+gap), yy=y(v), h=T+ph-yy, rr=Math.min(4,inner/2,h);
        s+=`<path d="M${x},${T+ph}V${yy+rr}Q${x},${yy} ${x+rr},${yy}H${x+inner-rr}Q${x+inner},${yy} ${x+inner},${yy+rr}V${T+ph}Z" fill="${se.c}"/>`; });
      if(i%every===0){ const lb=parse(d.label); s+=`<text x="${L+i*band+band/2}" y="${H-8}" text-anchor="middle" class="pr-ax">${lb.getMonth()+1}/${lb.getDate()}</text>`; }
      s+=`<rect x="${L+i*band}" y="${T}" width="${band}" height="${ph}" fill="transparent" data-i="${i}" class="pr-hit"/>`;
    });
    s+=`<line x1="${L}" x2="${W-R}" y1="${T+ph}" y2="${T+ph}" stroke="#bdbac2" stroke-width="1"/></svg><div class="pr-tip" id="prTip" hidden></div>`;
    box.innerHTML=s;
    const tip=$('prTip');
    box.querySelectorAll('.pr-hit').forEach(r=>{
      r.addEventListener('mouseenter',()=>{ const d=data[+r.dataset.i];
        tip.innerHTML=`<b>${d.week?'Week of ':''}${esc(nice(d.label))}</b>${series.map(se=>`<div><i style="background:${se.c}"></i>${se.l}<span>${m?money(d[se.k]):units(d[se.k])}</span></div>`).join('')}
          ${m?`<div class="pr-tip-sub">Margin<span>${money(d.margin)}</span></div>`:''}<div class="pr-tip-sub">Units<span>${units(d.units)} · ${d1(d.uph)}/hr</span></div>`;
        tip.hidden=false; r.setAttribute('fill','rgba(28,28,43,.05)'); });
      r.addEventListener('mousemove',e=>{ const b=box.getBoundingClientRect(); let x=e.clientX-b.left+14; if(x+190>b.width) x=e.clientX-b.left-200; tip.style.left=x+'px'; tip.style.top=Math.max(0,e.clientY-b.top-30)+'px'; });
      r.addEventListener('mouseleave',()=>{ tip.hidden=true; r.setAttribute('fill','transparent'); });
    });
  }
  function niceStep(x){ const p=Math.pow(10,Math.floor(Math.log10(Math.max(x,1e-9)))), f=x/p; return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p; }

  function exportDash(){
    if(!dash) return; if(!window.LWHXlsx) return toast('Excel export isn\'t loaded.');
    const m=isMoney(), N={type:'n',width:11};
    const pc=[{label:'Project',width:24},Object.assign({label:'Units'},N),Object.assign({label:'Hours'},N),Object.assign({label:'Units/Hr'},N),Object.assign({label:'Target'},N),Object.assign({label:'% of Target'},N)];
    if(m) pc.push(Object.assign({label:'Revenue'},N),Object.assign({label:'Labor'},N),Object.assign({label:'Margin'},N),Object.assign({label:'Margin %'},N));
    const ec=[{label:'Employee',width:22},Object.assign({label:'Days'},N),Object.assign({label:'Hours'},N),Object.assign({label:'Units'},N),Object.assign({label:'Units/Hr'},N),Object.assign({label:'% of Target'},N),Object.assign({label:'OT Hours'},N)];
    if(m) ec.push(Object.assign({label:'Labor'},N),Object.assign({label:'Revenue'},N));
    const tcols=[{label:dash.trend.some(x=>x.week)?'Week of':'Date',width:12},Object.assign({label:'Units'},N),Object.assign({label:'Hours'},N),Object.assign({label:'Units/Hr'},N)];
    if(m) tcols.push(Object.assign({label:'Revenue'},N),Object.assign({label:'Labor'},N),Object.assign({label:'Margin'},N));
    LWHXlsx.download(`production_dashboard_${dash.start}_to_${dash.end}.xlsx`,[
      {name:'Projects',columns:pc,rows:dash.projects.map(p=>{ const r=[p.name,p.units,p.hours,p.uph,p.target||'',p.target?p.targetPct:'']; if(m) r.push(p.revenue,p.labor,p.margin,p.marginPct); return r; })},
      {name:'Employees',columns:ec,rows:dash.employees.map(e=>{ const r=[e.name,e.days,e.hours,e.units,e.uph,e.targetPct==null?'':e.targetPct,e.otHours]; if(m) r.push(e.labor,e.revenue); return r; })},
      {name:'By Day',columns:tcols,rows:dash.trend.map(x=>{ const r=[x.label,x.units,x.hours,x.uph]; if(m) r.push(x.revenue,x.labor,x.margin); return r; })}
    ]);
  }

  // ================================================================ TIMECLOCK
  function renderTc(){
    $('prBody').innerHTML=`<div class="card pr-card">
      <div class="pr-cardhead"><h3>Production hours vs timeclock</h3>
        <div class="pr-weeknav"><button type="button" class="mh-arrow" id="prTcPrev" aria-label="Previous week"><svg class="icon" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <b id="prTcLabel"></b><button type="button" class="mh-arrow" id="prTcNext" aria-label="Next week"><svg class="icon" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button></div></div>
      <div id="prTcBody"><div class="pr-empty">Loading…</div></div></div>`;
    $('prTcLabel').textContent='Week of '+nice(tcWeek);
    $('prTcPrev').onclick=()=>{ tcWeek=addDays(tcWeek,-7); tc=null; renderTc(); };
    $('prTcNext').onclick=()=>{ if(addDays(tcWeek,7)>today()) return; tcWeek=addDays(tcWeek,7); tc=null; renderTc(); };
    if(tc&&tc.week===tcWeek) drawTc(); else loadTc();
  }
  async function loadTc(){
    try{ const r=await api('timeclock',{date:tcWeek}); r.week=tcWeek; tc=r; drawTc(); }
    catch(e){ const b=$('prTcBody'); if(b) b.innerHTML=`<div class="pr-empty pr-neg">${esc(errText(e))}</div>`; }
  }
  function drawTc(){
    const box=$('prTcBody'); if(!box) return;
    if(!tc.configured){ box.innerHTML=`<div class="pr-msg pr-msg-warn">The timeclock link isn't set up yet. ${isAdmin()?'Run <b>sql/production_timeclock.sql</b> in Supabase and add <b>PROD_TIMECLOCK_KEY</b> to the Production script\'s Script Properties (docs/PRODUCTION_SETUP.md, step 6).':'Ask Tim to finish the setup.'}</div>`; return; }
    if(tc.error){ box.innerHTML=`<div class="pr-msg pr-msg-bad">Couldn't read the timeclock (${esc(tc.error)}). Check that the key in Supabase matches PROD_TIMECLOCK_KEY.</div>`; return; }
    const gap=n(tc.gapHours)||1;
    box.innerHTML=`${tc.people.length?`<div class="pr-scroll"><table class="pr-table pr-tc"><thead><tr><th>Employee</th>${tc.dates.map(d=>`<th class="r">${esc(parse(d).toLocaleDateString('en-US',{weekday:'short'}))}<div class="pr-small-t">${parse(d).getMonth()+1}/${parse(d).getDate()}</div></th>`).join('')}<th class="r">Production</th><th class="r">Timeclock</th><th class="r" title="Timeclock hours minus production hours">Difference</th></tr></thead><tbody>
      ${tc.people.map(p=>`<tr><td><b>${esc(p.name)}</b><div class="pr-small-t">ID ${esc(p.empId)}</div></td>
        ${p.days.map(x=>{ const g=x.clock-x.prod, flag=Math.abs(g)>=gap; return `<td class="r pr-tcd${flag?(x.prod===0?' none':' gap'):''}" title="Production ${d2(x.prod)} · Timeclock ${d2(x.clock)}${x.open?' · still clocked in':''}">${x.prod||x.clock?`<div>${d1(x.prod)}</div><div class="pr-small-t">${d1(x.clock)}${x.open?'*':''}</div>`:'<span class="hint">·</span>'}</td>`; }).join('')}
        <td class="r">${d1(p.prod)}</td><td class="r">${d1(p.clock)}</td><td class="r${Math.abs(p.gap)>=gap?' pr-neg':''}"><b>${d1(p.gap)}</b></td></tr>`).join('')}
      </tbody></table></div>`:'<div class="pr-empty">No production or timeclock hours this week for linked employees.</div>'}
      <p class="hint">Each day shows <b>production hours</b> over <span class="pr-small-t">timeclock hours</span>. Shaded = they differ by ${gap}+ hrs; red = clocked in with no production entered. * = still clocked in.
      Difference = timeclock minus production.${tc.synced?' Timeclock data as of '+esc(new Date(tc.synced).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))+'.':''}</p>
      ${tc.unlinked&&tc.unlinked.length?`<div class="pr-msg pr-msg-warn">Not linked to a timeclock ID: ${esc(tc.unlinked.join(', '))}. ${isAdmin()?'Add their employee ID in Settings → Employees.':'An admin can link them in Settings → Employees.'}</div>`:''}`;
  }

  // ================================================================ SETTINGS (admin)
  function renderSettings(){
    const tabs=[['projects','Pricing & projects'],['employees','Employees'],['report','OT & daily report'],['access','Access'],['tools','Tools & log'],['connect','Connection']];
    $('prBody').innerHTML=`<div class="pr-subtabs">${tabs.map(([k,l])=>`<button type="button" class="pr-preset${setTab_===k?' on':''}" data-stab="${k}">${l}</button>`).join('')}</div><div id="prSet"></div>`;
    document.querySelectorAll('[data-stab]').forEach(b=>b.onclick=()=>{ setTab_=b.dataset.stab; editProject=null; editEmp=null; renderSettings(); });
    ({projects:setProjects,employees:setEmployees,report:setReport,access:setAccess,tools:setTools,connect:setConnect})[setTab_]();
  }

  // ---- projects & pricing
  function setProjects(){
    const box=$('prSet');
    box.innerHTML=`<div class="card pr-card"><div class="pr-cardhead"><h3>Projects &amp; billing rates</h3><button type="button" class="pr-small" id="prPAdd">+ Add project</button></div>
      <p class="hint">Price changes start on the date you pick. Jobs already saved keep the price they were saved with unless you choose to re-price them.</p>
      <div class="pr-scroll"><table class="pr-table"><thead><tr><th>Project</th><th class="r">Rate / unit</th><th class="r">Target units/hr</th><th class="r">Order</th><th>Status</th><th></th></tr></thead><tbody>
      ${B.projects.map(p=>`<tr class="${p.active?'':'pr-off'}"><td><b>${esc(p.name)}</b></td><td class="r">${money(p.rate)}</td><td class="r">${p.target?d1(p.target):'<span class="hint">—</span>'}</td><td class="r">${p.sort||''}</td><td>${p.active?'Active':'Off'}</td><td class="r"><button type="button" class="ghost pr-small" data-pedit="${esc(p.key)}">Edit</button></td></tr>`).join('')}
      </tbody></table></div></div><div id="prPForm"></div>`;
    $('prPAdd').onclick=()=>{ editProject={key:'',name:'',active:true,target:'',sort:'',rate:''}; projectForm(); };
    box.querySelectorAll('[data-pedit]').forEach(b=>b.onclick=()=>{ editProject=Object.assign({},projByKey(b.dataset.pedit)); projectForm(); });
    if(editProject) projectForm();
  }
  async function projectForm(){
    const p=editProject, isNew=!p.key, box=$('prPForm');
    box.innerHTML=`<div class="card pr-card pr-formcard"><h3>${isNew?'New project':'Edit '+esc(p.name)}</h3>
      <div class="pr-grid3">
        <label>Name<input id="prPName" maxlength="60" value="${esc(p.name)}"></label>
        <label>Target units / hour <span class="hint">(optional)</span><input id="prPTarget" type="number" min="0" step="0.1" value="${esc(p.target||'')}"></label>
        <label>List order<input id="prPSort" type="number" min="0" step="1" value="${esc(p.sort||'')}"></label>
      </div>
      <label class="pr-check"><input type="checkbox" id="prPActive"${p.active!==false?' checked':''}> Active (shows on the Record screen)</label>
      <div class="pr-pricebox">
        <div class="pr-sub" style="margin-top:0">${isNew?'Billing rate':'Change the billing rate'} ${isNew?'':`<span class="hint">— now ${money(p.rate)} per unit</span>`}</div>
        <div class="pr-grid3">
          <label>${isNew?'Rate per unit':'New rate per unit'}<input id="prPRate" type="number" min="0" step="0.01" placeholder="${isNew?'0.00':'leave blank to keep '+d2(p.rate)}"></label>
          <label>Starts on<input id="prPFrom" type="date" value="${esc(today())}"></label>
          <label>Note <span class="hint">(optional)</span><input id="prPNote" maxlength="200" placeholder="e.g. customer approved 11/10"></label>
        </div>
        ${isNew?'':`<label class="pr-check"><input type="checkbox" id="prPApply"> Re-price jobs already saved on or after the start date</label>`}
      </div>
      <div class="actions"><button type="button" id="prPSave">Save project</button><button type="button" class="ghost" id="prPCancel">Cancel</button></div>
      ${isNew?'':'<div class="pr-sub">Price history</div><div id="prPHist" class="pr-empty">Loading…</div>'}</div>`;
    $('prPCancel').onclick=()=>{ editProject=null; box.innerHTML=''; };
    $('prPSave').onclick=()=>{
      const rate=$('prPRate').value.trim(), apply=$('prPApply')&&$('prPApply').checked;
      if(isNew&&rate==='') return toast('Enter the billing rate.');
      if(rate!==''&&!(n(rate)>=0)) return toast('Rate must be a number.');
      if(apply&&!confirm('Re-price saved jobs for this project from '+$('prPFrom').value+' on? Their revenue and margin will change.')) return;
      busy($('prPSave'),'Saving…',()=>api('saveProject',{key:p.key,name:$('prPName').value,target:$('prPTarget').value,sort:$('prPSort').value,active:$('prPActive').checked,rate,effectiveDate:$('prPFrom').value,note:$('prPNote').value,applyToExisting:apply}))
        .then(async r=>{ toast('Saved'+(r.repriced?' — '+r.repriced+' saved rows re-priced':'')); editProject=null; dash=null; entries=null; B=await api('bootstrap'); renderSettings(); })
        .catch(e=>toast(errText(e)));
    };
    box.scrollIntoView({behavior:'smooth',block:'start'}); $('prPName').focus({preventScroll:true});
    if(!isNew){ try{ const r=await api('rateHistory',{key:p.key}); const h=$('prPHist'); if(h) h.outerHTML=`<table class="pr-table"><thead><tr><th>Starts</th><th class="r">Rate</th><th>Changed by</th><th>Note</th></tr></thead><tbody>${r.history.map(x=>`<tr><td>${x.from<='2000-01-01'?'(original)':esc(nice(x.from))}</td><td class="r">${money(x.rate)}</td><td>${esc(x.by)}${x.at?' · '+esc(new Date(x.at).toLocaleDateString()):''}</td><td>${esc(x.note)}</td></tr>`).join('')}</tbody></table>`; }catch(e){} }
  }

  // ---- employees
  function setEmployees(){
    const box=$('prSet');
    box.innerHTML=`<div class="card pr-card"><div class="pr-cardhead"><h3>Employees &amp; pay rates</h3><button type="button" class="pr-small" id="prEAdd">+ Add employee</button></div>
      <p class="hint">Turning someone off hides them from the Record screen; their history stays. Link the timeclock employee ID to compare production hours with punches.</p>
      <input type="search" id="prEmpFind" placeholder="Search" aria-label="Search employees" style="max-width:320px">
      <div class="pr-scroll"><table class="pr-table" id="prEmpList"><thead><tr><th>Name</th><th class="r">Pay rate</th><th>Timeclock ID</th><th>Status</th><th></th></tr></thead><tbody>
      ${B.employees.map(e=>`<tr class="${e.active?'':'pr-off'}" data-ename="${esc(e.name.toLowerCase())}"><td><b>${esc(e.name)}</b></td><td class="r">${money(e.rate)}/hr</td><td>${e.empId?esc(e.empId):'<span class="hint">not linked</span>'}</td><td>${e.active?'Active':'Off'}</td><td class="r"><button type="button" class="ghost pr-small" data-eedit="${esc(e.name)}">Edit</button></td></tr>`).join('')}
      </tbody></table></div></div><div id="prEForm"></div>`;
    $('prEmpFind').oninput=e=>{ const q=e.target.value.trim().toLowerCase(); box.querySelectorAll('[data-ename]').forEach(r=>r.hidden=!!q&&!r.dataset.ename.includes(q)); };
    $('prEAdd').onclick=()=>{ editEmp={name:'',rate:'',empId:'',active:true,isNew:true}; empForm(); };
    box.querySelectorAll('[data-eedit]').forEach(b=>b.onclick=()=>{ editEmp=Object.assign({},empByName(b.dataset.eedit)); empForm(); });
    if(editEmp) empForm();
  }
  async function loadDirectory(){
    if(directory) return directory;
    const a=auth(); const res=await fetch(SUPA+'/rest/v1/rpc/whm_directory',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({p_token:a.token()}),cache:'no-store'});
    const r=await res.json(); if(!r||!r.ok) throw new Error('directory');
    directory=(r.drivers||[]).map(d=>({id:String(d.driver_id),name:d.name,location:d.location||''})).sort((x,y)=>x.name.localeCompare(y.name));
    return directory;
  }
  async function empForm(){
    const e=editEmp, box=$('prEForm');
    box.innerHTML=`<div class="card pr-card pr-formcard"><h3>${e.isNew?'New employee':'Edit '+esc(e.name)}</h3>
      <label>Pick from the timeclock list <span class="hint">(fills name and ID — optional)</span><select id="prEDir"><option value="">Loading employee list…</option></select></label>
      <div class="pr-grid3">
        <label>Name<input id="prEName" maxlength="60" value="${esc(e.name)}"></label>
        <label>Hourly pay rate<input id="prERate" type="number" min="0" step="0.01" value="${esc(e.rate)}"></label>
        <label>Timeclock employee ID<input id="prEId" inputmode="numeric" maxlength="6" value="${esc(e.empId||'')}"></label>
      </div>
      <label class="pr-check"><input type="checkbox" id="prEActive"${e.active!==false?' checked':''}> Active</label>
      ${e.isNew?'':'<p class="hint">Changing the name renames them on all past entries and saved crews too. A new pay rate applies to jobs saved from now on.</p>'}
      <div class="actions"><button type="button" id="prESave">Save employee</button><button type="button" class="ghost" id="prECancel">Cancel</button></div></div>`;
    $('prECancel').onclick=()=>{ editEmp=null; box.innerHTML=''; };
    box.scrollIntoView({behavior:'smooth',block:'start'});
    $('prESave').onclick=()=>{
      const name=$('prEName').value.trim(), rate=$('prERate').value;
      if(!name) return toast('Enter a name.'); if(!(n(rate)>0)) return toast('Enter the hourly pay rate.');
      if(!e.isNew&&name!==e.name&&!confirm(`Rename "${e.name}" to "${name}" everywhere, including past entries?`)) return;
      busy($('prESave'),'Saving…',()=>api('saveEmployee',{originalName:e.isNew?'':e.name,name,rate,empId:$('prEId').value,active:$('prEActive').checked}))
        .then(r=>{ B.employees=r.employees; editEmp=null; toast('Saved'); tc=null; renderSettings(); }).catch(err=>toast(errText(err)));
    };
    try{
      const dir=await loadDirectory(), sel=$('prEDir'); if(!sel) return;
      const used=new Set(B.employees.map(x=>x.empId).filter(Boolean));
      sel.innerHTML='<option value="">— choose —</option>'+dir.map(d=>`<option value="${esc(d.id)}" data-name="${esc(d.name)}">${esc(d.name)} · ${esc(d.id)}${d.location?' · '+esc(d.location):''}${used.has(d.id)&&d.id!==e.empId?' (already linked)':''}</option>`).join('');
      sel.onchange=()=>{ const o=sel.selectedOptions[0]; if(!o||!o.value) return; $('prEId').value=o.value; if(!$('prEName').value.trim()||e.isNew) $('prEName').value=o.dataset.name; };
    }catch(err){ const sel=$('prEDir'); if(sel) sel.innerHTML='<option value="">Timeclock list not available — type the ID</option>'; }
  }

  // ---- OT rules + daily report
  function setReport(){
    const s=B.settings;
    $('prSet').innerHTML=`<div class="card pr-card pr-narrow"><h3>Overtime &amp; billing</h3>
      <div class="pr-grid2">
        <label>Customer OT billing rate ($/hr)<input id="prSOtRate" type="number" min="0" step="0.01" value="${esc(s.otBillingRate)}"></label>
        <label>Employee OT after (hrs per Sun–Sat week)<input id="prSThr" type="number" min="1" max="80" step="0.5" value="${esc(s.otThreshold)}"></label>
        <label>Employee OT pay multiplier<input id="prSMult" type="number" min="1" max="3" step="0.05" value="${esc(s.otMultiplier)}"></label>
        <label>OT watch starts at (hrs)<input id="prSWatch" type="number" min="0" max="80" step="0.5" value="${esc(s.otWatch)}"></label>
        <label>Timeclock gap to flag (hrs)<input id="prSGap" type="number" min="0.25" step="0.25" value="${esc(s.gapHours||1)}"></label>
      </div>
      <p class="hint">A new customer OT rate applies to jobs saved from now on. A new OT threshold or multiplier rechecks this week's jobs; past weeks keep what they were figured at.</p>
      <h3>Daily report (9 AM)</h3>
      <label class="pr-check"><input type="checkbox" id="prSOn"${s.reportEnabled!==false?' checked':''}> Send the daily report</label>
      <label>Send to <span class="hint">(one email per line, or separated by commas)</span><textarea id="prSTo" rows="6">${esc(String(s.recipients||'').split(/[,;\s]+/).filter(Boolean).join('\n'))}</textarea></label>
      <div class="actions"><button type="button" id="prSSave">Save settings</button><button type="button" class="ghost" id="prSSend">Send yesterday's report now</button></div></div>`;
    $('prSSave').onclick=()=>busy($('prSSave'),'Saving…',()=>api('saveSettings',{otBillingRate:$('prSOtRate').value,otThreshold:$('prSThr').value,otMultiplier:$('prSMult').value,otWatch:$('prSWatch').value,gapHours:$('prSGap').value,recipients:$('prSTo').value,reportEnabled:$('prSOn').checked}))
      .then(async r=>{ toast('Settings saved'+(r.rechecked?' — '+r.rechecked+' rows rechecked':'')); B=await api('bootstrap'); dash=null; renderSettings(); }).catch(e=>toast(errText(e)));
    $('prSSend').onclick=()=>{ if(!confirm('Email yesterday\'s report to everyone on the list now?')) return; busy($('prSSend'),'Sending…',()=>api('sendDailyNow')).then(r=>toast(r.message||'Sent')).catch(e=>toast(errText(e))); };
  }

  // ---- access
  function setAccess(){
    const list=B.access||[];
    $('prSet').innerHTML=`<div class="card pr-card"><h3>Who can use Production</h3>
      <p class="hint">Warehouse managers (the Manager Messages list) are <b>manager</b> automatically. Use this list to make someone an <b>admin</b>, give a lead <b>entry</b> access (record jobs, units and hours only — no dollars or pay), or block someone with <b>none</b>. Changes apply within 5 minutes.</p>
      <div class="pr-scroll"><table class="pr-table"><thead><tr><th>Employee ID</th><th>Name</th><th>Role</th><th>Note</th><th></th></tr></thead><tbody>
      ${list.map(a=>`<tr><td>${esc(a.empId)}</td><td>${esc(a.name)}</td><td><b class="pr-role pr-role-${esc(a.role)}">${esc(a.role)}</b></td><td>${esc(a.note)}</td><td class="r">${a.empId===String(B.me.empId)?'<span class="hint">you</span>':`<button type="button" class="ghost pr-small pr-danger" data-arm="${esc(a.empId)}">Remove</button>`}</td></tr>`).join('')||'<tr><td colspan="5" class="hint">Nobody added yet.</td></tr>'}
      </tbody></table></div>
      <div class="pr-sub">Add or change</div>
      <label>Pick from the employee list<select id="prADir"><option value="">Loading…</option></select></label>
      <div class="pr-grid3"><label>Employee ID<input id="prAId" inputmode="numeric" maxlength="6"></label><label>Name<input id="prAName" maxlength="60"></label>
        <label>Role<select id="prARole"><option value="entry">entry — record only, no $</option><option value="manager">manager — record + all analytics</option><option value="admin">admin — everything</option><option value="none">none — no access</option></select></label></div>
      <label>Note <span class="hint">(optional)</span><input id="prANote" maxlength="120"></label>
      <div class="actions"><button type="button" id="prASave">Save access</button></div></div>`;
    $('prASave').onclick=()=>{ const id=$('prAId').value.replace(/\D/g,''); if(!id) return toast('Enter the employee ID.');
      busy($('prASave'),'Saving…',()=>api('saveAccess',{empId:id,name:$('prAName').value,role:$('prARole').value,note:$('prANote').value})).then(r=>{ B=r; toast('Saved'); renderSettings(); }).catch(e=>toast(errText(e))); };
    document.querySelectorAll('[data-arm]').forEach(b=>b.onclick=()=>{ if(!confirm('Remove '+b.dataset.arm+' from the list? (Warehouse managers keep manager access.)')) return;
      api('removeAccess',{empId:b.dataset.arm}).then(r=>{ B=r; renderSettings(); }).catch(e=>toast(errText(e))); });
    loadDirectory().then(dir=>{ const sel=$('prADir'); if(!sel) return;
      sel.innerHTML='<option value="">— choose —</option>'+dir.map(d=>`<option value="${esc(d.id)}" data-name="${esc(d.name)}">${esc(d.name)} · ${esc(d.id)}</option>`).join('');
      sel.onchange=()=>{ const o=sel.selectedOptions[0]; if(o&&o.value){ $('prAId').value=o.value; $('prAName').value=o.dataset.name; } };
    }).catch(()=>{ const sel=$('prADir'); if(sel) sel.innerHTML='<option value="">List not available — type the ID</option>'; });
  }

  // ---- tools & audit log
  function setTools(){
    const w=sunday(today());
    $('prSet').innerHTML=`<div class="card pr-card pr-narrow"><h3>Recheck overtime</h3>
      <p class="hint">Refigures employee OT for every Sun–Sat week in the range from the hours saved. Use it after fixing entries directly in the Sheet.</p>
      <div class="pr-grid2"><label>From<input type="date" id="prRStart" value="${esc(addDays(w,-28))}"></label><label>To<input type="date" id="prREnd" value="${esc(today())}"></label></div>
      <div class="actions"><button type="button" id="prRGo">Recheck OT</button></div></div>
      <div class="card pr-card"><div class="pr-cardhead"><h3>Change log</h3><button type="button" class="ghost pr-small" id="prLogLoad">Load latest 150</button></div><div id="prLog"></div></div>`;
    $('prRGo').onclick=()=>busy($('prRGo'),'Checking…',()=>api('recalcOt',{start:$('prRStart').value,end:$('prREnd').value})).then(r=>{ toast(`${r.changed} rows corrected across ${r.weeks} employee-weeks`); dash=null; entries=null; }).catch(e=>toast(errText(e)));
    $('prLogLoad').onclick=()=>busy($('prLogLoad'),'Loading…',()=>api('auditLog',{limit:150})).then(r=>{ audit=r.log; drawLog(); }).catch(e=>toast(errText(e)));
    if(audit) drawLog();
  }
  function drawLog(){
    const box=$('prLog'); if(!box) return;
    box.innerHTML=audit.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody>
      ${audit.map(a=>`<tr><td class="nw">${esc(new Date(a.at).toLocaleString('en-US',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'}))}</td><td>${esc(a.who)}</td><td>${esc(a.action)}</td><td class="pr-logd"><code>${esc(a.details.slice(0,300))}</code></td></tr>`).join('')}</tbody></table></div>`:'<div class="pr-empty">Nothing logged yet.</div>';
  }
  function setConnect(){
    $('prSet').innerHTML=`<div class="card pr-card pr-narrow"><h3>Connection</h3>
      <p class="hint">The Production Apps Script link this device uses. ${PROD_API_DEFAULT?'The built-in link is used when this is blank.':'Put the link in js/production.js (PROD_API_DEFAULT) so every device has it.'}</p>
      <label>Apps Script /exec link<input id="prUrl2" value="${esc(ls.get(LS_URL,'')||'')}" placeholder="${esc(PROD_API_DEFAULT||'https://script.google.com/macros/s/…/exec')}"></label>
      <div class="actions"><button type="button" id="prUrl2Save">Save</button></div></div>`;
    $('prUrl2Save').onclick=()=>{ const v=$('prUrl2').value.trim(); if(v&&!/^https:\/\/script\.google\.com\/.+\/exec$/.test(v)) return toast('That doesn\'t look like an Apps Script /exec link.'); ls.set(LS_URL,v||null); toast('Saved'); boot(true); };
  }

  // ---------------------------------------------------------------- nav + lifecycle
  function showNav(){
    const nav=$('navProduction'); if(!nav) return;
    const a=auth(), m=a&&a.isSignedIn()&&a.me();
    nav.hidden=!((m&&m.is_manager)||ls.get(LS_ROLE,''));
  }
  function onShow(){ build(); showNav(); boot(false); }

  document.addEventListener('DOMContentLoaded',()=>{
    const sec=$('production'); if(!sec) return;
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
    showNav(); [1500,4000,9000].forEach(t=>setTimeout(showNav,t));
    let rt=null; window.addEventListener('resize',()=>{ clearTimeout(rt); rt=setTimeout(()=>{ if(tab==='dash'&&dash&&sec.classList.contains('active')) drawChart(); },200); });
  });
  window.LWHProduction={ refresh:()=>boot(true), _test:{computePreview,F,setB:b=>{B=b;},render,setTab} };
})();
