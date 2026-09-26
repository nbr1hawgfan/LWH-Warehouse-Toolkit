(function(){
  // MY HOURS — an employee enters their 5-digit employee ID and sees their
  // own clocked hours for any Sunday–Saturday workweek. Hours only: no pay
  // rates or wages exist anywhere in this data path.
  //
  // Talks to ONE Postgres function, toolkit_my_week_hours(p_emp_id, p_week_date)
  // (see sql/my_hours_function.sql). The function returns just that one
  // employee's punches for the one week asked for — the punches table itself
  // is never downloaded to the device. Same anon-key plain-fetch RPC pattern
  // as inventory.js / itemtxnlookup.js.
  const SUPABASE_URL='https://tjivcqxnkftujceumdtx.supabase.co';
  const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqaXZjcXhua2Z0dWpjZXVtZHR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTE5NDMsImV4cCI6MjEwMDQ2Nzk0M30.GzDc-_u92jvAHq7eG1X-1cet5Av9qF3ZDEVJMRKEP0E';
  const DAY_LABELS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const ID_KEY='myHoursEmpId';

  let weekStart=sundayOf(new Date());
  let requestSeq=0;

  function el(id){ return document.getElementById(id); }
  function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function status(msg){ const s=el('mhStatus'); if(s) s.textContent=msg||''; }

  // ---- Dates (all local time; the timeclock stores plain local timestamps) ----
  function sundayOf(d){ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()-x.getDay()); return x; }
  function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
  function isoDate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function parseLocal(s){ // "2026-09-22T06:00:00" or "2026-09-22" → local Date, no timezone shift
    if(!s) return null;
    const m=String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if(!m) return null;
    return new Date(+m[1],+m[2]-1,+m[3],+(m[4]||0),+(m[5]||0));
  }
  function fmtShort(d){ return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
  function fmtTime(d){ return d ? d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}) : ''; }
  function fmtHours(n){ return (Math.round((Number(n)||0)*100)/100).toFixed(2); }
  function weekLabel(start){ return `${fmtShort(start)} – ${fmtShort(addDays(start,6))}, ${addDays(start,6).getFullYear()}`; }
  function timeAgo(iso){
    if(!iso) return null;
    const then=new Date(iso); if(isNaN(then)) return null;
    const mins=Math.round((Date.now()-then)/60000);
    if(mins<1) return 'just now';
    if(mins<60) return mins+' min ago';
    const hrs=Math.round(mins/60);
    if(hrs<24) return hrs+' hr'+(hrs===1?'':'s')+' ago';
    const days=Math.round(hrs/24);
    return days+' day'+(days===1?'':'s')+' ago';
  }

  function cleanId(){ return String(el('mhEmpId').value||'').replace(/\D/g,''); }

  function renderWeekNav(){
    el('mhWeekLabel').textContent=weekLabel(weekStart);
    const current=sundayOf(new Date());
    el('mhNextWeek').disabled=weekStart>=current;
    el('mhThisWeek').disabled=+weekStart===+current;
  }

  async function fetchWeek(empId,start){
    const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/toolkit_my_week_hours`,{
      method:'POST',
      headers:{
        'apikey':SUPABASE_ANON_KEY,
        'Authorization':'Bearer '+SUPABASE_ANON_KEY,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({p_emp_id:Number(empId),p_week_date:isoDate(start)})
    });
    if(!res.ok) throw new Error('HTTP '+res.status);
    return res.json();
  }

  async function load(){
    const id=cleanId();
    const out=el('mhResults');
    if(!/^\d{5}$/.test(id)){
      status('Enter your 5-digit employee ID.');
      el('mhEmpId').focus();
      return;
    }
    if(el('mhRemember').checked) LWHStorage.set(ID_KEY,id); else LWHStorage.remove(ID_KEY);

    const seq=++requestSeq;
    status('Loading your hours…');
    out.innerHTML='<div class="card">Loading…</div>';
    try{
      const data=await fetchWeek(id,weekStart);
      if(seq!==requestSeq) return; // a newer request (week change) already took over
      if(!data || !data.found){
        out.innerHTML='<div class="card">No active employee found with that ID. Double-check the number, or see your supervisor.</div>';
        status('');
        return;
      }
      render(data);
      status('');
    }catch(e){
      if(seq!==requestSeq) return;
      console.error('My Hours load failed',e);
      out.innerHTML='<div class="card">Couldn\'t load hours right now — check your connection and try again.</div>';
      status('Load failed: '+e.message);
    }
  }

  function render(data){
    const out=el('mhResults');
    const punches=Array.isArray(data.punches)?data.punches:[];
    const days=DAY_LABELS.map((label,i)=>({label,date:addDays(weekStart,i),hours:0,punches:[]}));

    punches.forEach(p=>{
      const d=parseLocal(p.date); if(!d) return;
      const idx=Math.round((d-weekStart)/86400000);
      if(idx<0||idx>6) return;
      days[idx].hours+=Number(p.hours)||0;
      days[idx].punches.push({in:parseLocal(p.in),out:parseLocal(p.out),hours:p.hours});
    });
    const total=days.reduce((s,d)=>s+d.hours,0);
    const openPunch=punches.some(p=>p.in && !p.out);
    const todayIso=isoDate(new Date());

    const dayCells=days.map(d=>{
      const isToday=isoDate(d.date)===todayIso;
      return `<td class="mh-day${isToday?' mh-today':''}"><div class="mh-day-name">${d.label}</div><div class="mh-day-date">${d.date.getMonth()+1}/${d.date.getDate()}</div><b>${d.hours?fmtHours(d.hours):'—'}</b></td>`;
    }).join('');

    const detailRows=days.filter(d=>d.punches.length).map(d=>{
      const lines=d.punches.map(p=>{
        const range=p.out?`${fmtTime(p.in)} – ${fmtTime(p.out)}`:`${fmtTime(p.in)} – <i>still clocked in</i>`;
        return `<div class="mh-punch"><span>${range}</span><span>${p.out?fmtHours(p.hours)+' hrs':''}</span></div>`;
      }).join('');
      return `<div class="mh-detail-day"><div class="mh-detail-head">${d.label} ${fmtShort(d.date)}</div>${lines}</div>`;
    }).join('');

    const synced=timeAgo(data.last_synced_at);
    const name=data.first_name||(data.full_name||'').split(' ')[0]||'';

    out.innerHTML=`
      <div class="card mh-summary">
        <div class="mh-hello">${name?'Hi '+safe(name)+' —':''} week of ${weekLabel(weekStart)}</div>
        <div class="mh-total"><span class="mh-total-num">${fmtHours(total)}</span> <span class="mh-total-unit">total hours</span></div>
        ${openPunch?'<div class="hint">You\'re clocked in right now — that shift will count once you clock out.</div>':''}
        <div class="mh-week-table"><table class="pls-table"><tbody><tr>${dayCells}</tr></tbody></table></div>
      </div>
      <div class="card" style="margin-top:10px">
        <h3 style="margin-top:0">Clock-in / clock-out times</h3>
        ${detailRows||'<div class="hint">No punches recorded for this week.</div>'}
      </div>
      <div class="hint" style="margin-top:8px">Hours shown as decimal (7.50 = 7 hrs 30 min). Timeclock last synced: ${synced||'—'}. If something looks wrong, see your supervisor.</div>
    `;
  }

  function changeWeek(delta){
    const next=addDays(weekStart,7*delta);
    if(next>sundayOf(new Date())) return;
    weekStart=next;
    renderWeekNav();
    if(/^\d{5}$/.test(cleanId())) load(); else el('mhResults').innerHTML='';
  }

  function forget(){
    LWHStorage.remove(ID_KEY);
    el('mhEmpId').value='';
    el('mhRemember').checked=false;
    el('mhResults').innerHTML='';
    weekStart=sundayOf(new Date());
    renderWeekNav();
    status('Cleared.');
    el('mhEmpId').focus();
  }

  window.addEventListener('load',()=>{
    if(!el('mhShowBtn')) return;
    const saved=LWHStorage.get(ID_KEY,'');
    if(saved){ el('mhEmpId').value=saved; el('mhRemember').checked=true; }
    renderWeekNav();

    el('mhShowBtn').onclick=load;
    el('mhEmpId').oninput=()=>{ const v=cleanId().slice(0,5); if(el('mhEmpId').value!==v) el('mhEmpId').value=v; };
    el('mhEmpId').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); load(); } };
    el('mhPrevWeek').onclick=()=>changeWeek(-1);
    el('mhNextWeek').onclick=()=>changeWeek(1);
    el('mhThisWeek').onclick=()=>{ weekStart=sundayOf(new Date()); renderWeekNav(); if(/^\d{5}$/.test(cleanId())) load(); };
    el('mhClearBtn').onclick=forget;

    // Opening My Hours with a remembered ID shows this week straight away.
    document.addEventListener('click',e=>{
      const v=e.target.closest('[data-view="myHours"]');
      if(v && /^\d{5}$/.test(cleanId()) && !el('mhResults').innerHTML.trim()) load();
    });
  });
})();
