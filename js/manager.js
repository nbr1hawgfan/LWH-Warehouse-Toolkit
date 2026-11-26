/* MANAGER (v1.94.0; home card v1.94.1) — one place for warehouse managers.
   Shown only to people on the warehouse manager list (same sign-in as everything else — PTO PIN).
   Top: "Needs attention" cards with live counts (mgr_attention() in sql/manager_hub.sql, plus forklift PM
   from the forklift-pm Edge Function). Below: every manager / admin tool in the Toolkit and the related
   apps, each opening the screen it already lives on — nothing is moved, so people who know where things
   are can keep going there. Each tool still checks its own permissions. */
(function(){
  'use strict';
  const VIEW='managerHub';
  const API='https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const PM_FN='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/forklift-pm';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const me=()=>(window.LWHAuth&&LWHAuth.me&&LWHAuth.me())||null;
  const isMgr=()=>!!(me()&&me().is_manager);
  const ls={ get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
             set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };

  // Every manager / admin function. view = a Toolkit screen; href = another app (opens a new tab).
  const TOOLS=[
    {sec:'People',items:[
      {t:'Email Employees',d:'Pick people from the PTO list and send them an email — announcements, closings, reminders.',view:'emailBlast'},
      {t:'Manager Message Center',d:'Messages from employees, send to employees, read receipts.',view:'msgCenter'},
      {t:'Employee Sign-in',d:'Who has no PIN, setup codes for people not in the PTO tracker, sign someone out.',view:'msgCenter',hint:'Employee Sign-in tab'},
      {t:'PTO Approvals',d:'Approve or deny PTO requests and time off asks — right here, no extra PIN.',view:'timeOff',tab:'mgr'},
      {t:'PTO Manager app',d:'Record absences, reports, team analytics.',href:'https://nbr1hawgfan.github.io/LWH_PTO/manager/'},
      {t:'Absence Calendar',d:'PTO and absences from the PTO tracker, by month.',view:'absenceCal'}
    ]},
    {sec:'Inventory',items:[
      {t:'Cycle Counts',d:'Start counts, review differences, close counts, Excel export.',view:'cycleCount'}
    ]},
    {sec:'Safety & equipment',items:[
      {t:'Monthly Facility Inspections',d:'Assign, inspect, corrective actions, reports.',view:'inspections'},
      {t:'Forklift PM',d:'Fleet PM status, overdue lifts, log a completed PM.',view:'forkliftPm'},
      {t:'Forklift Certs',d:'Driving evaluations, certificates, wallet cards, renewals.',view:'forkliftCerts'},
      {t:'Forklift Costing',d:'PM and repair costs per lift.',href:'https://nbr1hawgfan.github.io/LWH_Forklift_Repair_Costing/'}
    ]},
    {sec:'Production & shipping',items:[
      {t:'Battery Box & BOM',d:'Orders, shipping with FedEx tracking and LD numbers.',view:'batteryBox'},
      {t:'Scrapping Production',d:'Production entry and analytics.',view:'production'}
    ]},
    {sec:'Reports',items:[
      {t:'App Usage',d:'Which apps and tools get used most.',href:'https://hub.logisticswarehouse.net/usage/'}
    ]}
  ];

  let built=false, last=null;
  function card(o){
    return `<button type="button" class="mh-att mh-${o.level}" ${o.view?`data-mh-view="${o.view}"`:''}>
      <b>${esc(o.n)}</b><span class="mh-att-t">${esc(o.t)}</span>${o.sub?`<span class="mh-att-s">${esc(o.sub)}</span>`:''}</button>`;
  }
  function build(){
    const sec=$(VIEW); if(!sec||built) return; built=true;
    sec.innerHTML=`<div class="mh-wrap">
      <div class="mh-top"><div><h2>Manager</h2><div class="mh-sub" id="mhWho"></div></div><button type="button" class="ghost mh-small" id="mhRefresh">Refresh</button></div>
      <h3 class="mh-h">Needs attention</h3>
      <div id="mhAtt" class="mh-attgrid"><div class="mh-sub">Loading…</div></div>
      <div id="mhTools"></div>
    </div>`;
    $('mhTools').innerHTML=TOOLS.map(g=>`<h3 class="mh-h">${esc(g.sec)}</h3><div class="mh-grid">${g.items.map(i=>
      i.href?`<a class="mh-tool" href="${i.href}" target="_blank" rel="noopener"><b>${esc(i.t)}</b><span>${esc(i.d)}</span><em>Opens ↗</em></a>`
            :`<button type="button" class="mh-tool" data-mh-view="${i.view}"${i.tab?` data-mh-tab="${i.tab}"`:''}><b>${esc(i.t)}</b><span>${esc(i.d)}</span>${i.hint?`<em>${esc(i.hint)}</em>`:''}</button>`).join('')}</div>`).join('');
    sec.addEventListener('click',e=>{
      const b=e.target.closest('[data-mh-view]'); if(!b) return;
      if(b.dataset.mhTab==='mgr'&&window.LWHTimeOff){ LWHTimeOff.openApprovals(); return; }
      if(window.LWHUI&&LWHUI.show) LWHUI.show(b.dataset.mhView);
    });
    $('mhRefresh').onclick=()=>load(true);
  }

  async function load(force){
    if(!isMgr()) return;
    if($('mhWho')) $('mhWho').textContent=(me().name||'')+' · warehouse manager';
    if(last&&!force) render(last.a,last.pm);
    let a=null, pm=null;
    try{
      const r=await fetch(API+'mgr_attention',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:'{}',cache:'no-store'});
      a=await r.json(); if(!a||a.ok===false) a=null;
    }catch(e){}
    try{
      const r=await fetch(PM_FN+'?action=status',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:'{}'});
      const j=await r.json(); if(j&&j.ok) pm=j.data||[];
    }catch(e){}
    if(!a&&!pm&&last){ render(last.a,last.pm,true); return; }
    last={a,pm,at:Date.now()}; ls.set('lwh_mhLast',last);
    render(a,pm);
  }
  function render(a,pm,stale){
    const cards=[];
    if(a){
      if(a.msgs_unread||a.msgs_open) cards.push({n:a.msgs_unread||a.msgs_open,t:a.msgs_unread?'unread employee messages':'messages not marked handled',level:'bad',view:'msgCenter'});
      if(a.cyc_review) cards.push({n:a.cyc_open_diffs,t:'cycle count differences to handle',sub:`${a.cyc_review} count${a.cyc_review===1?'':'s'} waiting for review`,level:'warn',view:'cycleCount'});
      if(a.cyc_counting) cards.push({n:a.cyc_counting,t:'cycle counts in progress',level:'info',view:'cycleCount'});
      const left=a.insp_zones_total-a.insp_zones_done;
      if(left>0) cards.push({n:left,t:`areas not inspected yet in ${a.insp_month}`,sub:`${a.insp_zones_done} of ${a.insp_zones_total} done`,level:'warn',view:'inspections'});
      if(a.insp_actions_overdue) cards.push({n:a.insp_actions_overdue,t:'inspection fixes past due',sub:`${a.insp_actions_open} open in all`,level:'bad',view:'inspections'});
      else if(a.insp_actions_open) cards.push({n:a.insp_actions_open,t:'inspection fixes open',level:'info',view:'inspections'});
      if(a.certs_expired) cards.push({n:a.certs_expired,t:'forklift certifications expired',level:'bad',view:'forkliftCerts'});
      if(a.certs_expiring) cards.push({n:a.certs_expiring,t:'forklift certs expiring in 60 days',level:'warn',view:'forkliftCerts'});
      if(a.no_pin) cards.push({n:a.no_pin,t:'people clocking in with no PIN',sub:'not in the PTO tracker and no Toolkit PIN yet',level:'info',view:'msgCenter'});
    }
    if(pm){
      const over=pm.filter(l=>l.status==='overdue').length, soon=pm.filter(l=>l.status==='dueSoon').length;
      if(over) cards.push({n:over,t:'forklifts overdue for PM',sub:soon?`${soon} more due soon`:'',level:'bad',view:'forkliftInsp'});
      else if(soon) cards.push({n:soon,t:'forklifts due for PM soon',level:'warn',view:'forkliftInsp'});
    }
    homeCard(a||pm?cards.length:null);
    const box=$('mhAtt'); if(!box) return;
    if(!a&&!pm){ box.innerHTML='<div class="mh-sub">Couldn\'t load — check your connection, then tap Refresh.</div>'; return; }
    box.innerHTML=(cards.length?cards.map(card).join(''):'<div class="mh-allgood">✓ Nothing waiting on you right now.</div>')
      +(stale?'<div class="mh-sub">No connection — showing the last numbers.</div>':'');
  }

  // Home page card (managers only) — right under Messages so nobody has to open the side menu to find it.
  function homeCard(n){
    const c=$('mhHomeCard'); if(!c) return;
    const sub=$('mhHomeSub'), b=$('mhHomeBadge');
    if(n==null) return;
    b.textContent=n; b.hidden=!n;
    sub.textContent=n?`${n} thing${n===1?'':'s'} need${n===1?'s':''} attention — tap to see them and every manager tool.`:'Nothing waiting on you right now. Tap for every manager tool.';
  }
  let peeked=0;
  function navVis(){
    const m=isMgr(), n=$('navManagerHub'), c=$('mhHomeCard');
    if(n) n.hidden=!m; if(c) c.hidden=!m;
    // Keep the home card count fresh (every 5 minutes while Home is showing).
    if(m&&c&&$('home')&&$('home').classList.contains('active')&&!document.hidden&&Date.now()-peeked>300000){ peeked=Date.now(); load(); }
  }
  document.addEventListener('DOMContentLoaded',()=>{
    navVis(); setInterval(navVis,5000);
    last=ls.get('lwh_mhLast',null);
    const wm=$('wmHomeCard');
    if(wm&&!$('mhHomeCard')) wm.insertAdjacentHTML('afterend',`<button type="button" id="mhHomeCard" class="wm-home mh-home" data-view="managerHub" hidden>
      <span class="wm-home-ic"><svg class="icon" viewBox="0 0 24 24"><path d="M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg></span>
      <span class="wm-home-text"><b>Manager</b><span id="mhHomeSub">Needs attention and every manager tool, in one place.</span></span>
      <span id="mhHomeBadge" class="wm-badge" hidden>0</span></button>`);
    navVis();
    const sec=$(VIEW); if(!sec) return;
    const onShow=()=>{ if(!isMgr()){ if(window.LWHUI) LWHUI.show('home'); return; } build(); load(); };
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
  });
})();
