/* ACCESS (v1.96.0) — turn a person's access off (or back on) across the LWH apps, in one place.
   Only people on the access admin list (Supabase acc_admins — Tim to start) see it: a card at the top of
   Manager, and its own screen. Find a person (warehouse list and driver list, linked by their PTO
   number), type a reason, Turn off access. The server (acc_block) then, all at once:
     - blocks their warehouse sign-in and their driver sign-in — the nightly server sync can't turn them back on
     - signs them out of every phone / PC (Warehouse Toolkit, Driver Toolkit, Transportation Manager, Messages)
     - takes them off the warehouse manager list, sets their driver record Inactive
     - turns off their time clock cards and remembered time clock phones, and stops their notifications
     - keeps a record of who did it, when and why.
   Turn back on undoes the blocks and puts the manager list / driver status back (cards need reprinting). */
(function(){
  'use strict';
  const VIEW='accessCtl';
  const API='https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const tok=()=>(window.LWHAuth&&LWHAuth.token&&LWHAuth.token())||'';
  const toast=t=>{ try{ LWHUI.toast(t); }catch(e){} };
  const when=iso=>iso?new Date(iso).toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'';
  let admin=null, picked=null, timer=null;

  async function rpc(fn,args){
    const r=await fetch(API+fn,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(Object.assign({p_token:tok()},args||{})),cache:'no-store'});
    if(!r.ok) throw new Error('Server error '+r.status);
    return r.json();
  }
  async function isAdmin(){
    if(admin!==null) return admin;
    if(!tok()) return false;
    try{ const r=await rpc('acc_me'); admin=!!(r&&r.admin); }catch(e){ return false; }
    return admin;
  }

  // Things the button can't reach — shown after every Turn off.
  const CHECKLIST=[
    'Mark them terminated / inactive in the PTO tracker (their PTO PIN lives there).',
    'Google account (and anything they built or own in Google Drive / Apps Script) — Mark.',
    'Trailer Shop and the other Apps Script apps with their own manager PIN: remove them from the PIN list.',
    'Forklift PM Admin page (old Apps Script page) still takes the shared admin passcode — change it if they knew it.',
    'Samsara, McLeod, WEX fuel card, TLand, BirdsEye / WMS logins.',
    'Building, gate, alarm and door codes; keys and fobs.',
    'Company phone / tablet: collect it, or sign them out of the apps on it.'
  ];

  function build(){
    const sec=$(VIEW); if(!sec||sec.dataset.built) return; sec.dataset.built='1';
    sec.innerHTML=`<div class="mh-wrap acc">
      <div class="mh-top"><div><h2>Access</h2><div class="mh-sub">Turn someone's access off across the LWH apps — suspended, let go, or left. Only you can see this.</div></div></div>
      <div class="card acc-find">
        <label>Find a person (name or employee ID)<input id="accQ" type="search" autocomplete="off" placeholder="Start typing a name…"></label>
        <div id="accResults" class="acc-results"></div>
      </div>
      <div class="card acc-pick" id="accPick" hidden></div>
      <h3 class="mh-h">Turned off</h3>
      <div id="accList"><div class="mh-sub">Loading…</div></div>
    </div>`;
    $('accQ').addEventListener('input',()=>{ clearTimeout(timer); timer=setTimeout(search,250); });
    sec.addEventListener('click',onClick);
  }

  async function search(){
    const q=$('accQ').value.trim(), box=$('accResults');
    if(q.length<2){ box.innerHTML=''; return; }
    box.innerHTML='<div class="mh-sub">Searching…</div>';
    try{
      const r=await rpc('acc_search',{p_q:q});
      if(!r.ok){ box.innerHTML='<div class="mh-sub">'+esc(r.error==='not_admin'?'Only access admins can use this.':r.error)+'</div>'; return; }
      // one row per person: warehouse + driver records that are linked show together
      const rows=[], seen={};
      r.people.forEach(p=>{
        const key=p.kind==='emp'?'e'+p.emp_id:'d'+p.driver_id;
        const link=p.kind==='emp'?(p.driver_id?'d'+p.driver_id:null):(p.emp_id?'e'+p.emp_id:null);
        if(seen[key]) return;
        const other=link&&r.people.find(x=>(x.kind==='emp'?'e'+x.emp_id:'d'+x.driver_id)===link);
        const row={name:p.name, emp:p.kind==='emp'?p:(other&&other.kind==='emp'?other:null), drv:p.kind==='driver'?p:(other&&other.kind==='driver'?other:null)};
        if(!row.emp&&p.emp_id&&p.kind==='driver') row.empId=p.emp_id;
        if(!row.drv&&p.driver_id&&p.kind==='emp') row.drvId=p.driver_id;
        seen[key]=1; if(link) seen[link]=1; rows.push(row);
      });
      box.innerHTML=rows.length?rows.map((x,i)=>{
        const bits=[];
        if(x.emp) bits.push(`Warehouse #${x.emp.emp_id}${x.emp.wh_manager?' · manager':''}${x.emp.active?'':' · inactive'}`);
        if(x.drv) bits.push(`Transportation ${x.drv.driver_id} · ${x.drv.role||''}${x.drv.active?'':' · '+(x.drv.status||'inactive')}`);
        const blocked=(x.emp&&x.emp.blocked)||(x.drv&&x.drv.blocked);
        return `<button type="button" class="acc-person" data-acc-pick="${i}"><b>${esc(x.name)}</b><span>${esc(bits.join('  |  '))}</span>${blocked?'<em class="acc-tag">Turned off</em>':''}</button>`;
      }).join(''):'<div class="mh-sub">Nobody matches.</div>';
      box._rows=rows;
    }catch(e){ box.innerHTML='<div class="mh-sub">Couldn\'t search — check the connection.</div>'; }
  }

  function showPick(x){
    picked=x;
    const p=$('accPick'); p.hidden=false;
    const emp=x.emp, drv=x.drv;
    p.innerHTML=`<h3>${esc(x.name)}</h3>
      <div class="acc-recs">
        ${emp?`<label class="acc-rec"><input type="checkbox" id="accUseEmp" checked> <span><b>Warehouse</b> — employee #${emp.emp_id}${emp.wh_manager?', on the warehouse manager list':''}. Warehouse Toolkit, Messages, manager tools.</span></label>`:''}
        ${drv?`<label class="acc-rec"><input type="checkbox" id="accUseDrv" checked> <span><b>Transportation</b> — ${esc(drv.driver_id)} (${esc(drv.role||'')}). Driver Toolkit, Transportation Manager, time clock and cards.</span></label>`:''}
        ${!emp&&!drv?'<div class="mh-sub">No records found.</div>':''}
      </div>
      <label>Reason (kept on the record)<input id="accWhy" maxlength="200" placeholder="e.g. Suspended pending review"></label>
      <div class="actions"><button type="button" class="danger" id="accGo">Turn off access</button><button type="button" class="ghost" id="accCancel">Cancel</button></div>
      <div id="accDone"></div>`;
    p.scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function turnOff(){
    if(!picked) return;
    const useEmp=$('accUseEmp')&&$('accUseEmp').checked&&picked.emp, useDrv=$('accUseDrv')&&$('accUseDrv').checked&&picked.drv;
    const why=$('accWhy').value.trim();
    if(!useEmp&&!useDrv){ toast('Tick at least one.'); return; }
    if(!why){ toast('Type a reason.'); $('accWhy').focus(); return; }
    if(!confirm(`Turn off ${picked.name}'s access now?\n\nThey will be signed out everywhere and can't sign back in until you turn them back on.`)) return;
    const b=$('accGo'); b.disabled=true; b.textContent='Turning off…';
    try{
      const r=await rpc('acc_block',{p_emp_id:useEmp?picked.emp.emp_id:null,p_driver_id:useDrv?picked.drv.driver_id:null,p_reason:why});
      if(!r.ok){ toast(r.error==='not_admin'?'Only access admins can do this.':r.error); return; }
      const u=r.undone||{}, lines=[];
      if('warehouse_sign_ins' in u) lines.push(`Warehouse sign-ins ended: ${u.warehouse_sign_ins}`);
      if(r.was_wh_manager) lines.push('Taken off the warehouse manager list');
      if('driver_sign_ins' in u) lines.push(`Driver / manager app sign-ins ended: ${u.driver_sign_ins}`);
      if(r.was_driver_status) lines.push(`Driver record set Inactive (was ${r.was_driver_status})`);
      if(u.time_clock_cards) lines.push(`Time clock cards turned off: ${u.time_clock_cards}`);
      if(u.time_clock_devices) lines.push(`Remembered time clock phones cleared: ${u.time_clock_devices}`);
      const nn=(u.wt_notifications||0)+(u.driver_notifications||0); if(nn) lines.push(`Notification devices removed: ${nn}`);
      $('accDone').innerHTML=`<div class="acc-ok"><b>✓ ${esc(r.name)} is turned off.</b><ul>${lines.map(l=>'<li>'+esc(l)+'</li>').join('')}</ul></div>
        <div class="acc-check"><b>Still to do by hand</b> (these aren't connected to this button):<ul>${CHECKLIST.map(c=>'<li><label><input type="checkbox"> '+esc(c)+'</label></li>').join('')}</ul></div>`;
      b.hidden=true; $('accCancel').textContent='Done';
      list(); search();
    }catch(e){ toast('Could not reach the server. Try again.'); }
    finally{ b.disabled=false; b.textContent='Turn off access'; }
  }

  async function list(){
    const box=$('accList'); if(!box) return;
    try{
      const r=await rpc('acc_list');
      if(!r.ok){ box.innerHTML='<div class="mh-sub">'+esc(r.error)+'</div>'; return; }
      box.innerHTML=r.blocks.length?r.blocks.map(b=>{
        const on=!b.unblocked_at;
        const what=[b.emp_id?'Warehouse #'+b.emp_id:'',b.driver_id?'Transportation '+b.driver_id:''].filter(Boolean).join(' · ');
        return `<div class="acc-row ${on?'on':'off'}"><div><b>${esc(b.name)}</b> <span class="acc-what">${esc(what)}</span>
          <div class="mh-sub">Off ${esc(when(b.blocked_at))} by ${esc(b.blocked_by)} — ${esc(b.reason)}${b.unblocked_at?`<br>Back on ${esc(when(b.unblocked_at))} by ${esc(b.unblocked_by)}${b.unblock_note?' — '+esc(b.unblock_note):''}`:''}</div></div>
          ${on?`<button type="button" class="ghost" data-acc-undo="${b.id}" data-name="${esc(b.name)}">Turn back on</button>`:'<em class="acc-tag back">Back on</em>'}</div>`;
      }).join(''):'<div class="mh-sub">Nobody is turned off.</div>';
    }catch(e){ box.innerHTML='<div class="mh-sub">Couldn\'t load — check the connection.</div>'; }
  }

  async function undo(id,name){
    const note=prompt(`Turn ${name}'s access back on?\n\nOptional note (for example: suspension ended):`,'');
    if(note===null) return;
    try{
      const r=await rpc('acc_unblock',{p_id:Number(id),p_note:note});
      if(!r.ok){ toast(r.error); return; }
      toast(`${r.name} can sign in again. Print new time clock cards if they need one.`); list(); search();
    }catch(e){ toast('Could not reach the server.'); }
  }

  function onClick(e){
    const p=e.target.closest('[data-acc-pick]'); if(p){ showPick($('accResults')._rows[+p.dataset.accPick]); return; }
    const u=e.target.closest('[data-acc-undo]'); if(u){ undo(u.dataset.accUndo,u.dataset.name); return; }
    if(e.target.id==='accGo') turnOff();
    if(e.target.id==='accCancel'){ $('accPick').hidden=true; picked=null; }
  }

  // Card at the top of Manager (admins only)
  async function addHubCard(){
    const hub=$('managerHub'); if(!hub||!(await isAdmin())) return;
    const tools=$('mhTools'); if(!tools||$('accHubCard')) return;
    tools.insertAdjacentHTML('beforebegin',`<h3 class="mh-h">Admin</h3><div class="mh-grid"><button type="button" class="mh-tool acc-hub" id="accHubCard" data-mh-view="${VIEW}"><b>Access</b><span>Turn someone's access off across the apps — suspended, let go, or left. Record of who and why.</span><em>Admin only</em></button></div>`);
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const hub=$('managerHub');
    if(hub) new MutationObserver(()=>{ if(hub.classList.contains('active')) setTimeout(addHubCard,50); }).observe(hub,{attributes:true,attributeFilter:['class'],childList:true});
    const sec=$(VIEW); if(!sec) return;
    const onShow=async()=>{
      if(!(await isAdmin())){ sec.innerHTML='<div class="card"><h2>Access</h2><p>This screen is for access admins only.</p></div>'; delete sec.dataset.built; return; }
      build(); list();
    };
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
  });
  window.LWHAccess={ isAdmin };
})();
