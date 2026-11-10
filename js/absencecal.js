/* ABSENCE CALENDAR (v1.82.0) — managers only.
   PTO & absences from the PTO tracker as a printable month calendar (agenda list on phones), plus a
   PTO balance lookup. Ported from the standalone LWH Absence Calendar app.

   Data: toolkit_absence_calendar() in Supabase (sql/absence_calendar.sql). The tracker's own
   PTO_Supabase_Push.gs (gas/) sends the Export_ tabs every hour. The function only answers a
   signed-in Toolkit session that is on the warehouse manager list (msg_wh_managers) — the same
   list and 6-digit sign-in as Manager Messages. auth.js adds the session header to the request. */
(function(){
  'use strict';
  const API='https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/toolkit_absence_calendar';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const STALE_MS=5*60*1000;

  // Same type colors as the standalone calendar so managers see the same picture.
  const TYPE_COLORS={
    'Full Day PTO':'#2F7A63','Half Day PTO':'#5FA88F','Personal Day':'#3B6FA0','Personal Time':'#6FA8C9',
    'Call-in':'#C9A227','Late Unpaid':'#D97B29','Excused Unpaid':'#8A8F98','No Call No Show':'#B23A48',
    'Disciplinary':'#7A1F2B','Bereavement':'#7A5C8A','Comp Day':'#6C63B5'
  };
  const colorFor=t=>TYPE_COLORS[t]||'#4A4A4A';

  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const auth=()=>window.LWHAuth||null;
  const isMgr=()=>{ const a=auth(); const m=a&&a.isSignedIn()&&a.me(); return !!(m&&m.is_manager); };

  let days=[];            // {date, dept, name, type, status} one per weekday off
  let requests=[];        // {employeeId, type, status, days, year} one per request (real DaysCount)
  let empById={};         // EmployeeID -> employee
  let employees=[];
  let activeTypes=new Set(), allTypes=[];
  let loadedAt=0, loading=false, byDay={};
  const now=new Date();
  let viewYear=now.getFullYear(), viewMonth=now.getMonth();
  let tab='cal';

  // ---------------------------------------------------------------- dates
  function parseIso(s){
    const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m?new Date(+m[1],+m[2]-1,+m[3]):null;
  }
  // Same 6 company holidays as the tracker's isMajorHoliday() — nobody is "out" on a closed day.
  function isHoliday(d){
    const mo=d.getMonth()+1, day=d.getDate(), dow=d.getDay();
    return (mo===1&&day===1)||(mo===5&&dow===1&&day>=25)||(mo===7&&day===4)||
           (mo===9&&dow===1&&day<=7)||(mo===11&&dow===4&&day>=22&&day<=28)||(mo===12&&day===25);
  }
  function weekdays(start,end){
    const out=[]; if(!start) return out;
    const cur=new Date(start), last=end&&end>=start?end:start;
    let guard=0;
    while(cur<=last&&guard++<400){
      const dow=cur.getDay();
      if(dow!==0&&dow!==6&&!isHoliday(cur)) out.push(new Date(cur));
      cur.setDate(cur.getDate()+1);
    }
    return out;
  }
  const fmtDays=n=>String(Math.round(n*100)/100);
  const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();

  // ---------------------------------------------------------------- load
  function msg(html,tone){
    const m=$('acMsg'); if(!m) return;
    m.innerHTML=html||''; m.hidden=!html; m.className='ac-msg'+(tone?' ac-msg-'+tone:'');
  }
  async function load(force){
    if(loading) return;
    if(!force&&loadedAt&&Date.now()-loadedAt<STALE_MS){ render(); return; }
    if(!isMgr()){ showNotManager(); return; }
    loading=true; $('acStatus').textContent='Loading…';
    try{
      const res=await fetch(API,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:'{}',cache:'no-store'});
      if(res.status===401){ $('acStatus').textContent=''; msg('Please sign in to view the Absence Calendar.','warn'); return; }
      if(!res.ok) throw new Error('HTTP '+res.status);
      const r=await res.json();
      if(!r||!r.ok){
        if(r&&r.error==='not_manager'){ showNotManager(); return; }
        if(r&&r.error==='sign_in'){ if(auth()) auth().requireSignIn('Please sign in to view the Absence Calendar.'); return; }
        throw new Error((r&&r.error)||'no data');
      }
      ingest(r);
      loadedAt=Date.now();
      $('acBody').hidden=false; msg('');
      const lp=r.last_push?new Date(r.last_push):null;
      $('acStatus').textContent=lp
        ? 'Tracker data as of '+lp.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})
        : '';
      if(!lp) msg('No data from the PTO tracker yet. Once <b>PTO_Supabase_Push.gs</b> runs in the tracker, absences show up here (it pushes every hour).','warn');
      buildFilters(); render(); renderBalance();
    }catch(e){
      console.error('Absence calendar load failed',e);
      $('acStatus').textContent='';
      msg('Couldn\'t load the calendar right now — check your connection and tap Refresh.','bad');
    }finally{ loading=false; }
  }
  function showNotManager(){
    $('acBody').hidden=true; $('acStatus').textContent='';
    msg('The Absence Calendar is for managers on the warehouse manager list. Ask Tim if you need access.','warn');
  }
  function ingest(r){
    employees=(r.employees||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    empById={}; employees.forEach(e=>{ empById[e.employee_id]=e; });
    days=[]; requests=[];
    (r.requests||[]).forEach(q=>{
      const emp=empById[q.employee_id];
      const dept=(emp&&emp.department)||'Unassigned';
      const name=q.name||(emp&&emp.name)||q.employee_id;
      const start=parseIso(q.start), end=parseIso(q.end);
      weekdays(start,end).forEach(d=>days.push({date:d,dept,name,type:q.type||'Other',status:q.status}));
      if(start) requests.push({employeeId:q.employee_id,type:q.type||'Other',status:q.status,days:Number(q.days)||0,year:start.getFullYear()});
    });
    allTypes=[...new Set([...(r.types||[]),...days.map(d=>d.type)])].sort();
    // Keep the manager's legend choices across refreshes; new types start on.
    const prev=activeTypes; activeTypes=new Set(allTypes.filter(t=>!prev.size||prev.has(t)||!knownTypes.has(t)));
    allTypes.forEach(t=>knownTypes.add(t));
  }
  const knownTypes=new Set();

  // ---------------------------------------------------------------- filters + legend
  function buildFilters(){
    const sel=$('acDept'), cur=sel.value||'ALL';
    const depts=[...new Set(employees.map(e=>e.department).filter(Boolean))].sort();
    sel.innerHTML='<option value="ALL">All departments</option>'+depts.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');
    sel.value=depts.includes(cur)?cur:'ALL';
    $('acLegend').innerHTML=allTypes.map(t=>`<button type="button" class="ac-chip${activeTypes.has(t)?'':' off'}" data-actype="${esc(t)}"><span class="ac-dot" style="background:${colorFor(t)}"></span>${esc(t)}</button>`).join('');
    const es=$('acEmp'), curE=es.value;
    es.innerHTML='<option value="">Select an employee…</option>'+employees.map(e=>`<option value="${esc(e.employee_id)}">${esc(e.name)}${String(e.status||'').toLowerCase()==='active'?'':' (inactive)'}</option>`).join('');
    if(curE&&empById[curE]) es.value=curE;
  }

  // ---------------------------------------------------------------- calendar
  function filtered(){
    const dept=$('acDept').value, q=$('acSearch').value.trim().toLowerCase(), pend=$('acPending').checked;
    return days.filter(r=>r.date.getFullYear()===viewYear&&r.date.getMonth()===viewMonth&&
      (dept==='ALL'||r.dept===dept)&&activeTypes.has(r.type)&&(pend||r.status==='Approved')&&
      (!q||r.name.toLowerCase().includes(q)));
  }
  function entryLine(e,cls){
    const p=e.status==='Pending';
    return `<div class="${cls}${p?' pending':''}"><span class="ac-dot" style="background:${colorFor(e.type)}"></span><span class="ac-n">${esc(e.name)}</span> <span class="ac-t">${esc(e.type)}${p?' (pending)':''}</span></div>`;
  }
  function render(){
    if(!$('acCalBody')) return;
    const label=new Date(viewYear,viewMonth,1).toLocaleDateString('en-US',{month:'long',year:'numeric'});
    $('acMonth').textContent=label;
    const dept=$('acDept').value;
    $('acPrintHead').textContent='Absence Calendar — '+label+(dept&&dept!=='ALL'?' · '+dept:'');
    const list=filtered();
    const people=new Set(list.map(r=>r.name)).size;
    $('acSummary').innerHTML=`<b>${list.length}</b> day${list.length===1?'':'s'} off across <b>${people}</b> employee${people===1?'':'s'} this month`;

    byDay={};
    list.forEach(r=>{ (byDay[r.date.getDate()]=byDay[r.date.getDate()]||[]).push(r); });
    Object.values(byDay).forEach(a=>a.sort((x,y)=>x.name.localeCompare(y.name)));

    const first=new Date(viewYear,viewMonth,1), startDow=first.getDay();
    const dim=new Date(viewYear,viewMonth+1,0).getDate();
    const cells=Math.ceil((startDow+dim)/7)*7, today=new Date();
    const cur=new Date(viewYear,viewMonth,1-startDow);
    let html='';
    for(let i=0;i<cells;i++){
      if(i%7===0) html+='<tr>';
      const inM=cur.getMonth()===viewMonth, wk=cur.getDay()===0||cur.getDay()===6;
      const ents=inM?(byDay[cur.getDate()]||[]):[];
      const cls=[!inM&&'outside',wk&&'weekend',sameDay(cur,today)&&'today',ents.length&&'has'].filter(Boolean).join(' ');
      html+=`<td class="${cls}"${inM&&ents.length?` data-acday="${cur.getDate()}" tabindex="0"`:''}>`+
        `<div class="ac-daynum"><span>${cur.getDate()}</span>${ents.length?`<b>${ents.length}</b>`:''}</div>`+
        (inM&&isHoliday(cur)&&!wk?'<div class="ac-hol">Company holiday</div>':'')+
        ents.map(e=>entryLine(e,'ac-entry')).join('')+'</td>';
      if(i%7===6) html+='</tr>';
      cur.setDate(cur.getDate()+1);
    }
    $('acCalBody').innerHTML=html;

    const nums=Object.keys(byDay).map(Number).sort((a,b)=>a-b);
    $('acAgenda').innerHTML=nums.length?nums.map(n=>{
      const d=new Date(viewYear,viewMonth,n);
      return `<div class="ac-aday${sameDay(d,today)?' today':''}"><div class="ac-ahead"><span>${d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span><b>${byDay[n].length}</b></div>`+
        byDay[n].map(e=>{ const p=e.status==='Pending';
          return `<div class="ac-aentry${p?' pending':''}"><span class="ac-dot" style="background:${colorFor(e.type)}"></span><div><div class="ac-n">${esc(e.name)}</div><div class="ac-meta">${esc(e.dept)} — ${esc(e.type)}${p?' (pending)':''}</div></div></div>`;
        }).join('')+'</div>';
    }).join(''):'<div class="ac-empty">Nobody out this month with the current filters.</div>';
  }
  function openDay(n){
    const ents=byDay[n]; if(!ents||!ents.length) return;
    $('acModalDate').textContent=new Date(viewYear,viewMonth,n).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
    $('acModalBody').innerHTML=ents.map(e=>{ const p=e.status==='Pending';
      return `<div class="ac-aentry${p?' pending':''}"><span class="ac-dot" style="background:${colorFor(e.type)}"></span><div><div class="ac-n">${esc(e.name)}</div><div class="ac-meta">${esc(e.dept)} — ${esc(e.type)}${p?' (pending)':''}</div></div></div>`;
    }).join('');
    $('acModal').hidden=false;
  }
  function shift(n){ viewMonth+=n; if(viewMonth<0){viewMonth=11;viewYear--;} if(viewMonth>11){viewMonth=0;viewYear++;} render(); }

  // ---------------------------------------------------------------- balances
  function renderBalance(){
    const id=$('acEmp').value, out=$('acBalance');
    if(!out) return;
    if(!id||!empById[id]){ out.innerHTML='<div class="ac-empty">Pick an employee to see their PTO balance and this year\'s absences.</div>'; $('acBalPrint').disabled=true; return; }
    $('acBalPrint').disabled=false;
    const e=empById[id], bal=Number(e.balance)||0, alloc=Number(e.allocation)||0, low=bal<2;
    const yr=new Date().getFullYear(), use={};
    requests.forEach(r=>{ if(r.employeeId!==id||r.status!=='Approved'||r.year!==yr) return;
      (use[r.type]=use[r.type]||{n:0,d:0}); use[r.type].n++; use[r.type].d+=r.days; });
    const types=Object.keys(use).sort((a,b)=>use[b].d-use[a].d);
    out.innerHTML=`<div class="ac-bcard">
      <div class="ac-bhead"><div class="ac-bname">${esc(e.name)}</div><div class="ac-bmeta">${esc(e.department||'Unassigned')} — reports to ${esc(e.manager||'N/A')}</div>${String(e.status||'').toLowerCase()==='active'?'':'<span class="ac-tag">INACTIVE</span>'}</div>
      <div class="ac-bnums"><div><span>Annual allocation</span><b>${alloc.toFixed(1)}</b></div><div class="${low?'low':''}"><span>Current balance</span><b>${bal.toFixed(1)}</b>${low?'<em>Low</em>':''}</div></div>
      <div class="ac-bsec">${yr} absences by type (approved)</div>
      ${types.length?types.map(t=>`<div class="ac-brow"><span><span class="ac-dot" style="background:${colorFor(t)}"></span>${esc(t)}</span><span>${use[t].n} request${use[t].n===1?'':'s'} · ${fmtDays(use[t].d)} day${use[t].d===1?'':'s'}</span></div>`).join('')
        :`<div class="ac-brow ac-none">No approved absences recorded for ${yr} yet.</div>`}
    </div>`;
  }

  // ---------------------------------------------------------------- tabs, print, access
  function setTab(t){
    tab=t;
    document.querySelectorAll('#absenceCal [data-actab]').forEach(b=>b.classList.toggle('active',b.dataset.actab===t));
    $('acCalView').hidden=t!=='cal'; $('acBalView').hidden=t!=='bal';
  }
  function doPrint(){
    if(window.LWHLabels&&LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(tab==='cal'?11:8.5,tab==='cal'?8.5:11);
    setTimeout(()=>print(),100);
  }
  function showForManagers(){
    const nav=$('navAbsenceCal'); if(nav) nav.hidden=!isMgr();
  }
  function onShow(){ showForManagers(); load(false); }

  document.addEventListener('DOMContentLoaded',()=>{
    const sec=$('absenceCal'); if(!sec) return;
    $('acPrev').onclick=()=>shift(-1);
    $('acNext').onclick=()=>shift(1);
    $('acToday').onclick=()=>{ const d=new Date(); viewYear=d.getFullYear(); viewMonth=d.getMonth(); render(); };
    $('acDept').onchange=render; $('acSearch').oninput=render; $('acPending').onchange=render;
    $('acRefresh').onclick=()=>load(true);
    $('acPrint').onclick=doPrint; $('acBalPrint').onclick=doPrint;
    $('acEmp').onchange=renderBalance;
    document.querySelectorAll('#absenceCal [data-actab]').forEach(b=>b.onclick=()=>setTab(b.dataset.actab));
    $('acLegend').addEventListener('click',e=>{
      const c=e.target.closest('[data-actype]'); if(!c) return;
      const t=c.dataset.actype; activeTypes.has(t)?activeTypes.delete(t):activeTypes.add(t);
      c.classList.toggle('off',!activeTypes.has(t)); render();
    });
    $('acCalBody').addEventListener('click',e=>{ const td=e.target.closest('[data-acday]'); if(td) openDay(+td.dataset.acday); });
    $('acCalBody').addEventListener('keydown',e=>{ if(e.key==='Enter'){ const td=e.target.closest('[data-acday]'); if(td) openDay(+td.dataset.acday); } });
    $('acModalClose').onclick=()=>{ $('acModal').hidden=true; };
    $('acModal').addEventListener('click',e=>{ if(e.target===$('acModal')) $('acModal').hidden=true; });
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&$('acModal')) $('acModal').hidden=true; });

    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
    // The manager flag arrives after sign-in; re-check a few times, then every minute (same as Manager Messages).
    showForManagers();
    [1500,4000,9000].forEach(t=>setTimeout(showForManagers,t));
    setInterval(showForManagers,60000);
  });
  window.LWHAbsenceCal={ refresh:()=>load(true), refreshAccess:showForManagers };
})();
