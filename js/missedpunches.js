(function(){
  // MISSED PUNCHES — managers' view of timeclock problems for one Sunday–
  // Saturday week: missing clock-outs, missing clock-ins, shifts over an hour
  // limit, and usual workdays with no punches at all. Hours only, no pay.
  //
  // Backed by toolkit_timeclock_exceptions(passcode, date, max_hours) — see
  // sql/missed_punches.sql. The passcode is checked inside the database, so
  // the report can't be pulled without it. The passcode is kept only for this
  // browser tab (sessionStorage), never saved to the device.
  const SUPABASE_URL='https://tjivcqxnkftujceumdtx.supabase.co';
  const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqaXZjcXhua2Z0dWpjZXVtZHR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTE5NDMsImV4cCI6MjEwMDQ2Nzk0M30.GzDc-_u92jvAHq7eG1X-1cet5Av9qF3ZDEVJMRKEP0E';
  const PASS_KEY='lwh_mgrPass';
  const KINDS={
    missing_out:{label:'Missing clock-out',tone:'bad',rank:0},
    missing_in:{label:'Missing clock-in',tone:'bad',rank:1},
    long_shift:{label:'Long shift',tone:'warn',rank:2},
    no_punches:{label:'No punches',tone:'info',rank:3}
  };

  let passcode='';
  let weekStart=sundayOf(new Date());
  let data=null, kindFilter='', groupFilter='';
  let tab='missed';                       // 'missed' | 'hours'
  let hoursData=null, hQuery='', hGroup='', hSort='name';
  let seq=0;

  function el(id){ return document.getElementById(id); }
  function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function status(msg,isErr){ const s=el('mpStatus'); if(!s) return; s.textContent=msg||''; s.style.color=isErr?'var(--bad)':'var(--muted)'; }
  function sundayOf(d){ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()-x.getDay()); return x; }
  function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
  function isoDate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function parseLocal(s){ const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/); return m?new Date(+m[1],+m[2]-1,+m[3],+(m[4]||0),+(m[5]||0)):null; }
  function fmtShort(d){ return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
  function fmtDay(d){ return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}); }
  function fmtTime(d){ return d?d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):''; }
  function fmtHours(n){ return (Math.round((Number(n)||0)*100)/100).toFixed(2); }
  function weekLabel(s){ return `${fmtShort(s)} – ${fmtShort(addDays(s,6))}, ${addDays(s,6).getFullYear()}`; }
  function dayName(d){ return d.toLocaleDateString('en-US',{weekday:'long'}); }
  function getPass(){ try{ return sessionStorage.getItem(PASS_KEY)||''; }catch{ return ''; } }
  function setPass(v){ try{ if(v) sessionStorage.setItem(PASS_KEY,v); else sessionStorage.removeItem(PASS_KEY); }catch{} }

  async function fetchReport(){
    const hours=tab==='hours';
    const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${hours?'toolkit_manager_week_hours':'toolkit_timeclock_exceptions'}`,{
      method:'POST',
      headers:{'apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+SUPABASE_ANON_KEY,'Content-Type':'application/json'},
      body:JSON.stringify(hours?{p_passcode:passcode,p_week_date:isoDate(weekStart)}
                               :{p_passcode:passcode,p_week_date:isoDate(weekStart),p_max_hours:Number(el('mpLimit').value)||10})
    });
    if(!res.ok) throw new Error('HTTP '+res.status);
    return res.json();
  }

  function setUnlocked(on){
    el('mpLocked').hidden=on;
    el('mpUnlocked').hidden=!on;
    if(!on){ el('mpResults').innerHTML=''; data=null; hoursData=null; }
  }

  function renderWeekNav(){
    el('mpWeekLabel').textContent=weekLabel(weekStart);
    const cur=sundayOf(new Date());
    const back=Math.round((cur-weekStart)/(7*86400000));
    el('mpWeekSub').textContent=back===0?'This week (so far)':back===1?'Last week':back+' weeks ago';
    el('mpNext').disabled=weekStart>=cur;
    el('mpLastWeek').hidden=back===1;
  }

  async function run(){
    if(!passcode) return;
    const mine=++seq;
    status('Checking the timeclock…');
    el('mpResults').innerHTML='<div class="card">Loading…</div>';
    try{
      const r=await fetchReport();
      if(mine!==seq) return;
      if(!r || !r.ok){
        const err=r&&r.error;
        passcode=''; setPass('');
        setUnlocked(false);
        if(err==='bad_passcode') status('That passcode isn\'t right.',true);
        else if(err==='locked') status('Too many wrong tries — locked for a few minutes. Try again shortly.',true);
        else if(err==='not_set_up') status('The manager passcode hasn\'t been set up yet — see sql/missed_punches.sql.',true);
        else status('Couldn\'t open the report.',true);
        el('mpPass').value=''; el('mpPass').focus();
        return;
      }
      setPass(passcode);
      setUnlocked(true);
      if(tab==='hours'){ hoursData=r; renderHours(); }
      else { data=r; kindFilter=''; groupFilter=''; render(); }
      status('');
    }catch(e){
      if(mine!==seq) return;
      console.error('Manager report failed',e);
      el('mpResults').innerHTML='<div class="card">Couldn\'t load the report right now — check your connection and try again.</div>';
      status('Load failed: '+e.message,true);
    }
  }

  // A day where most regulars have no punches is almost always a holiday, a
  // closure, or the timeclock not having synced yet — not 20 people forgetting.
  function splitClosedDays(missed){
    const closed={}, keep=[];
    missed.forEach(m=>{
      const exp=Number(m.day_expected)||0, miss=Number(m.day_missing)||0;
      if(exp>=4 && miss/exp>=0.6){ closed[m.date]={miss,exp}; } else keep.push(m);
    });
    return {closed,keep};
  }

  function describe(it){
    const inT=parseLocal(it.in), outT=parseLocal(it.out), day=parseLocal(it.date);
    if(it.kind==='missing_out'){
      const open=Number(it.open_hours)||0;
      const openTxt=open>=48?`${Math.floor(open/24)} days ago`:`${Math.round(open)} hrs ago`;
      return `Clocked in ${fmtTime(inT)} — no clock-out (${openTxt})`;
    }
    if(it.kind==='missing_in') return `Clocked out ${fmtTime(outT)} — no clock-in`;
    if(it.kind==='long_shift'){
      const nextDay=inT&&outT&&isoDate(inT)!==isoDate(outT);
      return `${fmtTime(inT)} – ${fmtTime(outT)}${nextDay?(Math.round((outT-inT)/86400000)>1?' ('+fmtShort(outT)+')':' next day'):''} · <b>${fmtHours(it.hours)} hrs</b>`;
    }
    if(it.kind==='no_punches') return `No punches — usually works ${dayName(day)}s (${it.usual_weeks} of the last 4 weeks). Off, or missed?`;
    return '';
  }

  function allItems(){
    if(!data) return {items:[],closed:{}};
    const {closed,keep}=splitClosedDays(data.missed_days||[]);
    return {items:[...(data.exceptions||[]),...keep],closed};
  }
  function groupKey(it){ return [it.location,it.team].filter(Boolean).join(' · ')||'—'; }

  function render(){
    const out=el('mpResults');
    const {items,closed}=allItems();
    const counts={}; Object.keys(KINDS).forEach(k=>counts[k]=items.filter(i=>i.kind===k).length);
    const groups=[...new Set(items.map(groupKey))].filter(g=>g!=='—').sort();
    let shown=items.filter(i=>(!kindFilter||i.kind===kindFilter)&&(!groupFilter||groupKey(i)===groupFilter));

    // group by employee, worst problem first
    const byEmp=new Map();
    shown.forEach(i=>{ if(!byEmp.has(i.emp_id)) byEmp.set(i.emp_id,{id:i.emp_id,name:i.name,group:groupKey(i),items:[]}); byEmp.get(i.emp_id).items.push(i); });
    const emps=[...byEmp.values()].map(e=>{ e.items.sort((a,b)=>String(a.date).localeCompare(String(b.date))||KINDS[a.kind].rank-KINDS[b.kind].rank); e.worst=Math.min(...e.items.map(i=>KINDS[i.kind].rank)); return e; })
      .sort((a,b)=>a.worst-b.worst||b.items.length-a.items.length||a.name.localeCompare(b.name));

    const tiles=Object.keys(KINDS).map(k=>`<button type="button" class="mp-tile mp-${KINDS[k].tone}${kindFilter===k?' active':''}" data-kind="${k}"><b>${counts[k]}</b><span>${KINDS[k].label}${k==='long_shift'?' (over '+fmtHours(data.max_hours).replace(/\.00$/,'')+' hrs)':''}</span></button>`).join('');
    const groupChips=groups.length>1?`<div class="ff-chips" style="margin-top:12px">${['',...groups].map(g=>`<button type="button" class="ff-chip${g===groupFilter?' active':''}" data-group="${safe(g)}">${g?safe(g):'Everyone'}<span>${g?items.filter(i=>groupKey(i)===g).length:items.length}</span></button>`).join('')}</div>`:'';
    const closedNote=Object.keys(closed).length?`<div class="mp-closed">${Object.keys(closed).sort().map(d=>`<div><b>${fmtDay(parseLocal(d))}</b> left out — ${closed[d].miss} of ${closed[d].exp} regulars have no punches that day (holiday, closed, or the timeclock hasn't synced yet).</div>`).join('')}</div>`:'';
    const synced=data.last_synced_at?new Date(data.last_synced_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';

    const empHtml=emps.map(e=>`
      <div class="card mp-emp">
        <div class="mp-emp-head">
          <div><div class="mp-emp-name">${safe(e.name)}</div><div class="db-sub">ID ${safe(e.id)}${e.group!=='—'?' · '+safe(e.group):''}</div></div>
          <button type="button" class="mh-link" data-week="${safe(e.id)}">View week &rsaquo;</button>
        </div>
        ${e.items.map(i=>`<div class="mp-item"><span class="mp-badge mp-${KINDS[i.kind].tone}">${KINDS[i.kind].label}</span><div><div class="mp-when">${fmtDay(parseLocal(i.date))}</div><div class="mp-what">${describe(i)}</div></div></div>`).join('')}
      </div>`).join('');

    out.innerHTML=`
      <div class="card">
        <div class="mp-head"><b>${items.length?items.length+' thing'+(items.length===1?'':'s')+' to check':'Nothing to fix'}</b> · week of ${weekLabel(parseLocal(data.week_start))}</div>
        <div class="mp-tiles">${tiles}</div>
        ${groupChips}
        ${closedNote}
        ${items.length?`<div class="grid-2 no-print" style="margin-top:12px"><button type="button" id="mpCsv" class="ghost">Download CSV</button><button type="button" id="mpPrint" class="ghost">Print</button></div>`:''}
      </div>
      ${emps.length?empHtml:(items.length?'<div class="card" style="margin-top:10px">Nothing matches that filter.</div>':'<div class="card" style="margin-top:10px">Every punch this week has a clock-in and clock-out, nothing is over the hour limit, and no regulars are missing a usual day.</div>')}
      <div class="hint" style="margin-top:8px">"No punches" only counts days that are over, and only for people who worked that weekday in at least 3 of the previous 4 weeks. Timeclock last synced ${synced}.</div>
    `;
    out.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{ kindFilter=kindFilter===b.dataset.kind?'':b.dataset.kind; render(); });
    out.querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>{ groupFilter=b.dataset.group; render(); });
    out.querySelectorAll('[data-week]').forEach(b=>b.onclick=()=>{ if(window.LWHMyHours) LWHMyHours.open(b.dataset.week,data.week_start); });
    const c=el('mpCsv'); if(c) c.onclick=()=>exportCsv(shown);
    const p=el('mpPrint'); if(p) p.onclick=()=>printReport(emps);
  }

  function plain(html){ const d=document.createElement('div'); d.innerHTML=html; return d.textContent; }
  function csvEscape(v){ const s=String(v??''); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
  function exportCsv(list){
    if(!list.length) return;
    const head=['Employee','Employee ID','Location/Team','Date','Problem','Clock In','Clock Out','Hours','Details'];
    const rows=list.slice().sort((a,b)=>a.name.localeCompare(b.name)||String(a.date).localeCompare(String(b.date))).map(i=>[
      i.name,i.emp_id,groupKey(i),i.date,KINDS[i.kind].label,
      i.in?fmtTime(parseLocal(i.in)):'',i.out?fmtShort(parseLocal(i.out))+' '+fmtTime(parseLocal(i.out)):'',
      i.hours!=null?fmtHours(i.hours):'',plain(describe(i))
    ].map(csvEscape).join(','));
    const blob=new Blob([[head.join(','),...rows].join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=`missed-punches-week-of-${data.week_start}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    LWHUI.toast(`Exported ${list.length} row(s) to CSV`);
  }
  function printReport(emps){
    const out=el('mpPrintArea'); if(!out||!emps.length) return;
    out.innerHTML=`<h2>Missed Punches — week of ${weekLabel(parseLocal(data.week_start))}</h2>
      <p>Printed ${new Date().toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})} · long shift = over ${fmtHours(data.max_hours)} hrs</p>
      <table class="txn-print-table"><thead><tr><th>Employee</th><th>ID</th><th>Date</th><th>Problem</th><th>Details</th><th>Fixed</th></tr></thead><tbody>
      ${emps.map(e=>e.items.map((i,n)=>`<tr><td>${n?'':safe(e.name)}</td><td>${n?'':safe(e.id)}</td><td>${fmtDay(parseLocal(i.date))}</td><td>${KINDS[i.kind].label}</td><td>${safe(plain(describe(i)))}</td><td>☐</td></tr>`).join('')).join('')}
      </tbody></table>`;
    if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
    setTimeout(()=>print(),100);
  }


  // ---------------- Everyone's Hours ----------------
  function empGroup(e){ return [e.location,e.team].filter(Boolean).join(' · ')||'—'; }
  function hoursFiltered(){
    if(!hoursData) return [];
    const q=hQuery.trim().toLowerCase();
    let list=(hoursData.employees||[]).filter(e=>(!hGroup||empGroup(e)===hGroup)&&(!q||String(e.name).toLowerCase().includes(q)||String(e.emp_id).includes(q)));
    const tot=e=>Number(e.total)||0;
    if(hSort==='most') list.sort((a,b)=>tot(b)-tot(a)||a.name.localeCompare(b.name));
    else if(hSort==='least') list.sort((a,b)=>tot(a)-tot(b)||a.name.localeCompare(b.name));
    else list.sort((a,b)=>a.name.localeCompare(b.name));
    return list;
  }
  function cell(v){ const n=Number(v)||0; return n?fmtHours(n):'<span class="mp-dash">—</span>'; }

  function renderHours(){
    const out=el('mpResults'); if(!hoursData) return;
    const all=hoursData.employees||[];
    const groups=[...new Set(all.map(empGroup))].filter(g=>g!=='—').sort();
    if(hGroup && !groups.includes(hGroup)) hGroup='';
    out.innerHTML=`
      <div class="card">
        <div class="mp-head" id="mpHoursHead"></div>
        <div class="mp-hours-tools">
          <input id="mpSearch" type="search" placeholder="Search name or ID" value="${safe(hQuery)}" autocomplete="off" />
          <select id="mpSort"><option value="name">Sort: Name</option><option value="most">Sort: Most hours</option><option value="least">Sort: Fewest hours</option></select>
        </div>
        ${groups.length>1?`<div class="ff-chips" style="margin-top:10px">${['',...groups].map(g=>`<button type="button" class="ff-chip${g===hGroup?' active':''}" data-hgroup="${safe(g)}">${g?safe(g):'Everyone'}<span>${g?all.filter(e=>empGroup(e)===g).length:all.length}</span></button>`).join('')}</div>`:''}
        ${all.length?`<div class="grid-2 no-print" style="margin-top:12px"><button type="button" id="mpHoursCsv" class="ghost">Download CSV</button><button type="button" id="mpHoursPrint" class="ghost">Print</button></div>`:''}
      </div>
      <div class="card mp-hours-card" style="margin-top:10px"><div id="mpHoursTable"></div></div>
      <div class="hint" style="margin-top:8px">Shows everyone with at least one punch this week. Hours by clock-in day, decimal (7.50 = 7 hrs 30 min). Over 40 is highlighted. Tap a name to open their week with punch times. Timeclock last synced ${hoursData.last_synced_at?new Date(hoursData.last_synced_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—'}.</div>`;
    el('mpSort').value=hSort;
    el('mpSearch').oninput=e=>{ hQuery=e.target.value; renderHoursTable(); };
    el('mpSort').onchange=e=>{ hSort=e.target.value; renderHoursTable(); };
    out.querySelectorAll('[data-hgroup]').forEach(b=>b.onclick=()=>{ hGroup=b.dataset.hgroup; renderHours(); });
    const c=el('mpHoursCsv'); if(c) c.onclick=hoursCsv;
    const p=el('mpHoursPrint'); if(p) p.onclick=hoursPrint;
    renderHoursTable();
  }

  function renderHoursTable(){
    const box=el('mpHoursTable'); if(!box) return;
    const list=hoursFiltered();
    const start=parseLocal(hoursData.week_start);
    const dayTotals=[0,1,2,3,4,5,6].map(i=>list.reduce((s,e)=>s+(Number((e.days||[])[i])||0),0));
    const grand=list.reduce((s,e)=>s+(Number(e.total)||0),0);
    el('mpHoursHead').innerHTML=`<b>${list.length} employee${list.length===1?'':'s'}</b> · ${fmtHours(grand)} total hours · week of ${weekLabel(start)}`;
    if(!list.length){ box.innerHTML=`<div class="hint">${(hoursData.employees||[]).length?'No one matches that search.':'No punches recorded for this week yet.'}</div>`; return; }
    const heads=[0,1,2,3,4,5,6].map(i=>{ const d=addDays(start,i); return `<th>${d.toLocaleDateString('en-US',{weekday:'short'})}<div>${d.getMonth()+1}/${d.getDate()}</div></th>`; }).join('');
    box.innerHTML=`<div class="mp-hours-wrap"><table class="mp-hours-table">
      <thead><tr><th class="mp-name-col">Employee</th><th class="mp-total-col">Total</th>${heads}</tr></thead>
      <tbody>${list.map(e=>{
        const t=Number(e.total)||0;
        const tags=(e.open_punch?'<span class="mp-badge mp-warn">Open punch</span>':'')+(e.missing_in?'<span class="mp-badge mp-bad">No clock-in</span>':'');
        return `<tr><td class="mp-name-col"><button type="button" class="mp-name" data-hweek="${safe(e.emp_id)}">${safe(e.name)}</button><div class="db-sub">ID ${safe(e.emp_id)}${empGroup(e)!=='—'?' · '+safe(empGroup(e)):''}</div>${tags?`<div class="mp-tags">${tags}</div>`:''}</td><td class="mp-total mp-total-col${t>40?' mp-ot':''}">${fmtHours(t)}</td>${(e.days||[]).map(v=>`<td>${cell(v)}</td>`).join('')}</tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td class="mp-name-col">All shown</td><td class="mp-total mp-total-col">${fmtHours(grand)}</td>${dayTotals.map(v=>`<td>${cell(v)}</td>`).join('')}</tr></tfoot>
    </table></div>`;
    box.querySelectorAll('[data-hweek]').forEach(b=>b.onclick=()=>{ if(window.LWHMyHours) LWHMyHours.open(b.dataset.hweek,hoursData.week_start); });
  }

  function hoursCsv(){
    const list=hoursFiltered(); if(!list.length) return;
    const start=parseLocal(hoursData.week_start);
    const head=['Employee','Employee ID','Location/Team',...[0,1,2,3,4,5,6].map(i=>{ const d=addDays(start,i); return d.toLocaleDateString('en-US',{weekday:'short'})+' '+(d.getMonth()+1)+'/'+d.getDate(); }),'Total','Open punch'];
    const rows=list.map(e=>[e.name,e.emp_id,empGroup(e),...(e.days||[]).map(v=>fmtHours(v)),fmtHours(e.total),e.open_punch?'Yes':''].map(csvEscape).join(','));
    const blob=new Blob([[head.join(','),...rows].join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=`weekly-hours-week-of-${hoursData.week_start}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    LWHUI.toast(`Exported ${list.length} employee(s) to CSV`);
  }
  function hoursPrint(){
    const list=hoursFiltered(); const out=el('mpPrintArea'); if(!list.length||!out) return;
    const start=parseLocal(hoursData.week_start);
    out.innerHTML=`<h2>Weekly Hours — week of ${weekLabel(start)}${hGroup?' · '+safe(hGroup):''}</h2>
      <p>${list.length} employee(s) · printed ${new Date().toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})} · hours only</p>
      <table class="txn-print-table"><thead><tr><th>Employee</th><th>ID</th>${[0,1,2,3,4,5,6].map(i=>`<th>${addDays(start,i).toLocaleDateString('en-US',{weekday:'short'})}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${list.map(e=>`<tr><td>${safe(e.name)}</td><td>${safe(e.emp_id)}</td>${(e.days||[]).map(v=>`<td>${Number(v)?fmtHours(v):''}</td>`).join('')}<td><b>${fmtHours(e.total)}</b></td></tr>`).join('')}
      </tbody></table>`;
    if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(11,8.5);
    setTimeout(()=>print(),100);
  }

  function setTab(t){
    tab=t;
    document.querySelectorAll('#missedPunches [data-mptab]').forEach(b=>b.classList.toggle('active',b.dataset.mptab===t));
    el('mpLimitWrap').hidden=t!=='missed';
    const cur=t==='hours'?hoursData:data;
    if(cur && cur.week_start===isoDate(weekStart)){ t==='hours'?renderHours():render(); }
    else run();
  }

  function unlock(){
    const v=String(el('mpPass').value||'').trim();
    if(!v){ status('Enter the manager passcode.',true); el('mpPass').focus(); return; }
    passcode=v; run();
  }
  function lock(){
    passcode=''; setPass(''); setUnlocked(false); el('mpPass').value=''; status('Locked.');
  }

  window.addEventListener('load',()=>{
    if(!el('mpUnlockBtn')) return;
    renderWeekNav();
    el('mpUnlockBtn').onclick=unlock;
    el('mpPass').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); unlock(); } };
    el('mpPrev').onclick=()=>{ weekStart=addDays(weekStart,-7); renderWeekNav(); run(); };
    el('mpNext').onclick=()=>{ const n=addDays(weekStart,7); if(n>sundayOf(new Date())) return; weekStart=n; renderWeekNav(); run(); };
    el('mpLastWeek').onclick=()=>{ weekStart=addDays(sundayOf(new Date()),-7); renderWeekNav(); run(); };
    el('mpLimit').onchange=run;
    document.querySelectorAll('#missedPunches [data-mptab]').forEach(b=>b.onclick=()=>setTab(b.dataset.mptab));
    el('mpLockBtn').onclick=lock;
    // Same browser tab, already unlocked → open straight to the report.
    const saved=getPass();
    document.addEventListener('click',e=>{
      const v=e.target.closest('[data-view="missedPunches"]');
      if(v && !passcode && getPass()){ passcode=getPass(); run(); }
    });
    if(saved && el('missedPunches').classList.contains('active')){ passcode=saved; run(); }
  });
})();
