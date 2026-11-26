/* EMAIL EMPLOYEES (v1.103.0; Toolkit Messages v1.104.0) — managers pick people and send them an email.
   Names and emails come from the PTO tracker's Employees tab (only people with an email on file).
   The Toolkit only sends employee IDs; the PTO Apps Script (Api.gs v1.4.0, 'bridge.email*') looks up the
   addresses, checks the sender is a manager (PTO Managers tab or Toolkit warehouse manager), sends one
   email per person (reply-to the manager) and logs it on the 'Email_Broadcast_Log' tab.
   People who don't work here any more can be hidden from the list ("Not here") — the sheet is untouched.
   v1.104.0: "Also post in their Toolkit Messages" — the same message goes to each person's Toolkit Messages
   (normal whm_send, so phone notifications and read receipts work). PTO ID → Toolkit employee comes from
   whm_pto_map (sql/email_employees_map.sql). People with no email can be reached by Toolkit message only. */
(function(){
  'use strict';
  const VIEW='emailBlast';
  const SB='https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const SB_KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const MSG_MAX=1000;
  const PTO_API='https://script.google.com/macros/s/AKfycbwXblseav0VCgynTXxL6BYTLniZ4xJAiYholbDgnFPXBqL46_sxP1Rc49MWMga52QsV/exec';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const toast=t=>{ try{ LWHUI.toast(t); }catch(e){} };
  const me=()=>(window.LWHAuth&&LWHAuth.me&&LWHAuth.me())||null;
  const tok=()=>(window.LWHAuth&&LWHAuth.token&&LWHAuth.token())||'';
  const uid=()=>(me()&&me().emp_id)||'x';
  const ls={ get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
             set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };
  const KD=()=>'lwh_eb_draft_'+uid(), KG=()=>'lwh_eb_groups_'+uid();

  let map={}, mapOk=false;
  let data=null, sel=new Set(), show='active', q='', dept='', busy=false, setupNeeded=false;

  async function post(body,ms){
    const ctrl=new AbortController(), t=setTimeout(()=>ctrl.abort(),ms||60000);
    let r;
    try{ r=await fetch(PTO_API,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({appToken:tok()},body)),redirect:'follow',signal:ctrl.signal}); }
    catch(e){ throw new Error(e.name==='AbortError'?'The PTO server took too long. Check Recent sends before trying again.':(navigator.onLine?'Could not reach the PTO server.':'You are offline.')); }
    finally{ clearTimeout(t); }
    let j; try{ j=await r.json(); }catch(e){ throw new Error('Unexpected reply from the PTO server.'); }
    if(!j.ok){
      const e=String(j.error||'');
      if(/Unknown action/i.test(e)){ setupNeeded=true; throw new Error('setup'); }
      if(e==='SIGNED_OUT'){ if(window.LWHAuth) LWHAuth.requireSignIn('Please sign in again.'); throw new Error('Please sign in again.'); }
      throw new Error(e||'Something went wrong.');
    }
    return j.data;
  }

  async function rpc(name,args){
    const r=await fetch(SB+name,{method:'POST',headers:{apikey:SB_KEY,'Content-Type':'application/json'},body:JSON.stringify(args),cache:'no-store'});
    let j=null; try{ j=await r.json(); }catch(e){}
    if(!r.ok||!j) throw new Error('Could not reach Toolkit Messages.');
    return j;
  }
  async function loadMap(){
    try{ const j=await rpc('whm_pto_map',{p_token:tok()}); if(j.ok){ map=j.map||{}; mapOk=true; } }catch(e){}
  }
  const empOf=p=>map[String(p.id).toUpperCase()]||null;
  const hasEmail=p=>p.hasEmail!==false&&!!p.email;
  const reach=p=>({email:hasEmail(p), tk:!!empOf(p)});

  // ---------------------------------------------------------------- screen
  function build(){
    const sec=$(VIEW); if(!sec||sec.dataset.built) return; sec.dataset.built='1';
    sec.innerHTML=`<div class="mh-wrap eb">
      <div class="mh-top"><div><h2>Email Employees</h2><div class="mh-sub">Pick people, type a message, send. Each person gets their own email from Logistics Warehouse — replies come back to you. Emails come from the PTO tracker.</div></div>
        <button type="button" class="ghost mh-small" id="ebRefresh">Refresh</button></div>
      <div id="ebBody"><div class="mh-sub">Loading…</div></div>
    </div>`;
    sec.addEventListener('click',onClick);
    sec.addEventListener('input',onInput);
    sec.addEventListener('change',onChange);
  }

  async function load(){
    const body=$('ebBody'); if(!body) return;
    if(!data) body.innerHTML='<div class="mh-sub">Loading employees…</div>';
    try{
      const [d]=await Promise.all([post({action:'bridge.emailList'}),loadMap()]);
      data=d;
      const ids=new Set(data.people.map(p=>p.id)); sel.forEach(id=>{ if(!ids.has(id)) sel.delete(id); });
      draw();
    }catch(e){
      if(e.message==='setup'){ body.innerHTML=`<div class="panel eb-note"><b>One-time setup needed.</b> Paste <code>gas/PTO_Api_v1.4.1.gs</code> over Api.gs in the PTO Apps Script project, then Deploy → Manage deployments → edit → New version (same link). See <code>docs/EMAIL_EMPLOYEES_SETUP.md</code>.</div>`; return; }
      body.innerHTML=`<div class="panel eb-note">${esc(e.message)}</div>`;
    }
  }

  function shown(){
    if(!data) return [];
    const s=q.trim().toLowerCase();
    return data.people.filter(p=>{
      if(show==='active'&&(p.hidden||p.inactive)) return false;
      if(show==='hidden'&&!(p.hidden||p.inactive)) return false;
      if(dept&&p.department!==dept) return false;
      if(s&&!(p.name.toLowerCase().includes(s)||p.email.toLowerCase().includes(s)||p.department.toLowerCase().includes(s)||p.manager.toLowerCase().includes(s))) return false;
      return true;
    });
  }

  function draw(){
    const body=$('ebBody'); if(!body||!data) return;
    const d=ls.get(KD(),{subject:'',message:'',greet:true,copyMe:true,toolkit:true,ack:false});
    const depts=[...new Set(data.people.map(p=>p.department).filter(Boolean))].sort();
    const nHidden=data.people.filter(p=>p.hidden||p.inactive).length;
    body.innerHTML=`<div class="eb-grid">
      <div class="panel eb-pick">
        <div class="eb-h"><b>1. Who gets it</b><span class="eb-count" id="ebSelCount"></span></div>
        <div class="eb-filters">
          <input type="search" id="ebQ" placeholder="Search name, email, department, manager" value="${esc(q)}" autocomplete="off">
          <select id="ebDept"><option value="">All departments</option>${depts.map(x=>`<option${x===dept?' selected':''}>${esc(x)}</option>`).join('')}</select>
        </div>
        <div class="to-tabs eb-tabs"><button type="button" data-eb-show="active">Current</button><button type="button" data-eb-show="hidden">Not here (${nHidden})</button><button type="button" data-eb-show="all">All</button></div>
        <div class="eb-bar">
          <button type="button" class="ghost mh-small" data-eb="all">Select all shown</button>
          <button type="button" class="ghost mh-small" data-eb="none">Clear</button>
          <select id="ebGroup" class="eb-group"><option value="">Saved groups…</option></select>
          <button type="button" class="ghost mh-small" data-eb="saveGroup">Save as group</button>
        </div>
        <div class="eb-list" id="ebList"></div>
        <div class="mh-sub eb-foot">${data.noEmail?`${data.noEmail} current employee${data.noEmail===1?' has':'s have'} no email on the PTO sheet${data.v?' — they get the Toolkit message only':', so they aren\'t listed'}. `:''}Tap <b>Not here</b> on anyone who no longer works here — they move to the Not here tab and stay off your lists.</div>
      </div>
      <div class="panel eb-compose">
        <div class="eb-h"><b>2. Message</b></div>
        <label class="mh-field-label" for="ebSubj">Subject</label>
        <input id="ebSubj" maxlength="150" placeholder="e.g. Building closed Friday" value="${esc(d.subject)}">
        <label class="mh-field-label" for="ebMsg">Message</label>
        <textarea id="ebMsg" rows="10" maxlength="10000" placeholder="Type or paste your message. Links work.">${esc(d.message)}</textarea>
        <label class="eb-check"><input type="checkbox" id="ebGreet"${d.greet!==false?' checked':''}> Start each email with "Hi [first name],"</label>
        <label class="eb-check"><input type="checkbox" id="ebTk"${d.toolkit!==false?' checked':''}${mapOk?'':' disabled'}> Also post in their Toolkit Messages${mapOk?'':' (couldn\'t load — try Refresh)'}</label>
        <label class="eb-check eb-sub"><input type="checkbox" id="ebAck"${d.ack?' checked':''}> Ask them to tap "Got it" (shows you who read it)</label>
        <label class="eb-check"><input type="checkbox" id="ebCopy"${d.copyMe!==false?' checked':''}${data.me.email?'':' disabled'}> Send me a copy${data.me.email?` (${esc(data.me.email)})`:' — no email on file for you'}</label>
        <div class="mh-sub eb-how" id="ebHow"></div>
        <button type="button" class="eb-send" id="ebSend" disabled>Send</button>
        <div class="mh-sub" id="ebStatus">${data.quota!=null?`Google lets this account send ${esc(data.quota)} more email${data.quota===1?'':'s'} today. Up to ${esc(data.max)} people per send.`:''}</div>
        <details class="eb-prev"><summary>Preview</summary><div id="ebPrev"></div></details>
      </div>
    </div>
    <h3 class="mh-h">Recent sends</h3>
    <div class="eb-recent">${data.recent.length?data.recent.map(r=>`<div class="eb-rec"><div><b>${esc(r.subject)}</b><span class="mh-sub"> · ${esc(r.at)} · ${esc(r.by)}</span></div><div class="mh-sub">Emailed ${esc(r.count)}${r.toolkit?` · ${esc(r.toolkit)} in Toolkit Messages`:''}${r.failed?` · <span class="eb-bad">${esc(r.failed)} failed</span>`:''}: ${esc(r.to)}</div></div>`).join(''):'<div class="mh-sub">Nothing sent yet.</div>'}</div>`;
    drawGroups(); drawList(); drawPrev(); saveDraft();
  }

  function drawList(){
    const box=$('ebList'); if(!box) return;
    document.querySelectorAll('#'+VIEW+' [data-eb-show]').forEach(b=>b.classList.toggle('on',b.dataset.ebShow===show));
    const list=shown();
    box.innerHTML=list.length?list.map(p=>{
      const out=p.hidden||p.inactive, r=reach(p), none=!r.email&&!r.tk;
      const how=(r.email?'<i class="eb-ch">Email</i>':'')+(r.tk?'<i class="eb-ch tk">Toolkit</i>':'');
      return `<label class="eb-row${sel.has(p.id)?' on':''}${out?' out':''}${none?' none':''}">
        <input type="checkbox" data-eb-id="${esc(p.id)}"${sel.has(p.id)?' checked':''}${none?' disabled':''}>
        <span class="eb-who"><b>${esc(p.name)} ${how}</b><span>${esc(p.department||'—')}${p.manager?' · '+esc(p.manager):''}</span><span class="eb-mail">${r.email?esc(p.email):none?'No email and no Toolkit sign-in — can\'t be reached here':'No email — Toolkit message only'}</span></span>
        ${p.inactive?'<em class="eb-tag">Inactive on PTO sheet</em>':`<button type="button" class="mh-link" data-eb-hide="${esc(p.id)}" data-eb-to="${p.hidden?'0':'1'}">${p.hidden?'Back on list':'Not here'}</button>`}
      </label>`;}).join(''):'<div class="mh-sub eb-empty">No one matches.</div>';
    count();
  }
  function plan(){
    const tkOn=!!($('ebTk')&&$('ebTk').checked&&mapOk);
    const ppl=data?data.people.filter(p=>sel.has(p.id)):[];
    const em=ppl.filter(hasEmail), tk=tkOn?ppl.filter(p=>empOf(p)):[];
    const miss=ppl.filter(p=>!hasEmail(p)&&!(tkOn&&empOf(p)));
    const reached=new Set(em.map(p=>p.id).concat(tk.map(p=>p.id)));
    return {em,tk,miss,n:reached.size};
  }
  function count(){
    const c=$('ebSelCount'), b=$('ebSend'), h=$('ebHow'); if(!data) return;
    const P=plan();
    if(c) c.textContent=sel.size?`${sel.size} selected`:'';
    if(h) h.innerHTML=sel.size?`${P.em.length} by email${$('ebTk')&&$('ebTk').checked&&mapOk?` · ${P.tk.length} in Toolkit Messages`:''}`
      +(P.tk.length&&$('ebMsg')&&('📣 '+$('ebSubj').value.trim()+'\n\n'+$('ebMsg').value.trim()+'\n\n— '+(data.me.name||'')).length>MSG_MAX?' · <span class="eb-warn">Toolkit message will be shortened to 1,000 characters</span>':'')
      +(P.miss.length?` · <span class="eb-bad">${P.miss.length} can't be reached (no email${mapOk?'':' / Toolkit off'}): ${esc(P.miss.map(p=>p.name).join(', '))}</span>`:''):'';
    if(b){ b.textContent=busy?'Sending…':P.n?`Send to ${P.n} ${P.n===1?'person':'people'}`:'Pick people to send to'; b.disabled=busy||!P.n; }
  }
  function drawPrev(){
    const p=$('ebPrev'); if(!p) return;
    const subj=$('ebSubj').value.trim(), msg=$('ebMsg').value.trim(), greet=$('ebGreet').checked;
    const first=data&&data.people.find(x=>sel.has(x.id));
    const fn=first?first.name.split(/\s+/)[0]:'Jordan';
    p.innerHTML=`<div class="eb-mail-prev"><div class="eb-mp-head"><small>LOGISTICS WAREHOUSE</small><b>${esc(subj||'(subject)')}</b></div>
      <div class="eb-mp-body">${greet?`<p>Hi ${esc(fn)},</p>`:''}${esc(msg||'(message)').replace(/\n/g,'<br>')}<p>— ${esc(data?data.me.name:'')}</p></div></div>`;
  }
  function opts(){ return {greet:$('ebGreet').checked,copyMe:$('ebCopy').checked,toolkit:$('ebTk').checked&&mapOk,ack:$('ebAck').checked}; }
  function saveDraft(){
    ls.set(KD(),Object.assign({subject:$('ebSubj').value,message:$('ebMsg').value},opts()));
    const a=$('ebAck'); if(a) a.closest('label').hidden=!$('ebTk').checked;
  }

  // ---------------------------------------------------------------- saved groups (this device, per manager)
  function groups(){ return ls.get(KG(),{}); }
  function drawGroups(){
    const s=$('ebGroup'); if(!s) return; const g=groups(), names=Object.keys(g).sort();
    s.innerHTML='<option value="">Saved groups…</option>'+names.map(n=>`<option value="${esc(n)}">${esc(n)} (${g[n].length})</option>`).join('')
      +(names.length?'<option value="__del">Delete a group…</option>':'');
  }

  // ---------------------------------------------------------------- events
  function onInput(e){
    if(e.target.id==='ebQ'){ q=e.target.value; drawList(); }
    if(e.target.id==='ebSubj'||e.target.id==='ebMsg'){ saveDraft(); drawPrev(); count(); }
  }
  function onChange(e){
    const t=e.target;
    if(t.dataset.ebId){ t.checked?sel.add(t.dataset.ebId):sel.delete(t.dataset.ebId); t.closest('.eb-row').classList.toggle('on',t.checked); count(); drawPrev(); return; }
    if(t.id==='ebDept'){ dept=t.value; drawList(); }
    if(t.id==='ebGreet'||t.id==='ebCopy'||t.id==='ebTk'||t.id==='ebAck'){ saveDraft(); drawPrev(); count(); }
    if(t.id==='ebGroup'){
      const v=t.value; t.value=''; if(!v) return;
      const g=groups();
      if(v==='__del'){
        const n=prompt('Delete which group?\n'+Object.keys(g).join('\n')); if(!n||!g[n]) return;
        delete g[n]; ls.set(KG(),g); drawGroups(); toast('Group deleted'); return;
      }
      const ids=new Set(data.people.map(p=>p.id)); let miss=0;
      sel=new Set(); (g[v]||[]).forEach(id=>{ ids.has(id)?sel.add(id):miss++; });
      show='all'; drawList(); drawPrev(); toast(`${sel.size} selected from "${v}"`+(miss?` · ${miss} no longer on the list`:''));
    }
  }
  async function onClick(e){
    const b=e.target.closest('button'); if(!b) return;
    if(b.id==='ebRefresh'){ load(); return; }
    if(b.dataset.ebShow){ show=b.dataset.ebShow; drawList(); return; }
    if(b.dataset.eb==='all'){ shown().forEach(p=>{ const r=reach(p); if((r.email||r.tk)&&(show==='hidden'||!(p.hidden||p.inactive))) sel.add(p.id); }); drawList(); drawPrev(); return; }
    if(b.dataset.eb==='none'){ sel.clear(); drawList(); drawPrev(); return; }
    if(b.dataset.eb==='saveGroup'){
      if(!sel.size){ toast('Select people first'); return; }
      const n=(prompt(`Name this group of ${sel.size} (saved on this device), e.g. "5th St. crew":`)||'').trim().slice(0,40); if(!n) return;
      const g=groups(); g[n]=[...sel]; ls.set(KG(),g); drawGroups(); toast('Group saved'); return;
    }
    if(b.dataset.ebHide){
      e.preventDefault();
      const id=b.dataset.ebHide, hide=b.dataset.ebTo==='1', p=data.people.find(x=>x.id===id);
      if(hide&&!confirm(`Move ${p?p.name:'this person'} to "Not here"? They'll stay off the list for every manager (you can put them back).`)) return;
      b.disabled=true;
      try{ await post({action:'bridge.emailHide',employeeId:id,hide}); if(p) p.hidden=hide; if(hide) sel.delete(id); draw(); toast(hide?'Moved to Not here':'Back on the list'); }
      catch(err){ b.disabled=false; toast(err.message); }
      return;
    }
    if(b.id==='ebSend') send();
  }

  // Toolkit message text: subject on top, message, sender. Long ones are cut to fit (1,000 characters).
  function tkBody(subject,message,greet,hasMail){
    const head='📣 '+subject+'\n\n', foot='\n\n— '+(data.me.name||'');
    let body=message;
    const room=MSG_MAX-head.length-foot.length;
    if(body.length>room){
      const note=hasMail?'… (full message in your email)':'… (message shortened — ask your manager for the rest)';
      body=body.slice(0,Math.max(0,room-note.length)).replace(/\s+\S*$/,'')+note;
    }
    return head+body+foot;
  }
  async function postToolkit(list,subject,message){
    if(!list.length) return 0;
    const ack=$('ebAck').checked, type=ack?'ack':'notice';
    const groups=[list.filter(hasEmail),list.filter(p=>!hasEmail(p))];
    let n=0;
    for(const g of groups){
      if(!g.length) continue;
      const body=tkBody(subject,message,false,hasEmail(g[0]));
      for(let i=0;i<g.length;i+=200){
        const j=await rpc('whm_send',{p_token:tok(),p_audience:{drivers:g.slice(i,i+200).map(p=>String(empOf(p)))},p_type:type,p_body:body,
          p_reply_options:[],p_urgent:false,p_expires_at:null,p_reminder_of:null,p_reply_to:null,p_attachments:null});
        if(!j.ok) throw new Error(j.error==='not_manager'?'Toolkit Messages: only warehouse managers can post.':(j.error||'Toolkit Messages failed.'));
        n+=j.recipients||0;
      }
    }
    return n;
  }

  async function send(){
    if(busy||!sel.size) return;
    const subject=$('ebSubj').value.trim(), message=$('ebMsg').value.trim();
    if(!subject){ toast('Add a subject'); $('ebSubj').focus(); return; }
    if(!message){ toast('Type a message'); $('ebMsg').focus(); return; }
    const P=plan();
    if(!P.n) return;
    if(P.em.length>data.max){ toast(`Up to ${data.max} emails per send`); return; }
    const parts=[]; if(P.em.length) parts.push(`email ${P.em.length}`); if(P.tk.length) parts.push(`post to ${P.tk.length} in Toolkit Messages`);
    if(!confirm(`Send "${subject}"?\n\nThis will ${parts.join(' and ')}.`+(P.miss.length?`\n\n${P.miss.length} selected can't be reached: ${P.miss.map(p=>p.name).join(', ')}`:''))) return;
    busy=true; count();
    const st=$('ebStatus'); st.textContent=P.em.length>20?`Sending to ${P.n} people — this can take a minute or two. Keep this screen open.`:'Sending…';
    let tkN=0, tkErr='', r={sent:0,failed:[]};
    try{
      if(P.tk.length){ try{ tkN=await postToolkit(P.tk,subject,message); }catch(e){ tkErr=e.message; } }
      if(P.em.length||(tkN&&data.v)){
        r=await post({action:'bridge.emailSend',ids:P.em.map(p=>p.id),subject,message,greet:$('ebGreet').checked,copyMe:$('ebCopy').checked,toolkitCount:tkN,
          sendId:uid()+'-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6)},330000);
      }
      ls.set(KD(),Object.assign({subject:'',message:''},opts()));
      sel.clear(); busy=false;
      toast(`Sent${r.sent?' · '+r.sent+' emailed':''}${tkN?' · '+tkN+' in Toolkit':''}`);
      await load();
      const s2=$('ebStatus');
      if(s2) s2.innerHTML=`<span class="eb-ok">✓ ${r.sent?`Emailed ${esc(r.sent)}`:''}${r.sent&&tkN?' · ':''}${tkN?`Posted to ${esc(tkN)} in Toolkit Messages`:''}.</span>`
        +(r.failed&&r.failed.length?` <span class="eb-bad">Email didn't send: ${esc(r.failed.join(', '))}</span>`:'')
        +(tkErr?` <span class="eb-bad">Toolkit Messages didn't post: ${esc(tkErr)}</span>`:'');
    }catch(err){
      busy=false; count();
      st.innerHTML=(tkN?`<span class="eb-ok">✓ Posted to ${esc(tkN)} in Toolkit Messages.</span> `:'')+`<span class="eb-bad">Email: ${esc(err.message)}</span>`;
    }
  }

  // ---------------------------------------------------------------- show / hide
  const isMgr=()=>!!(me()&&me().is_manager);
  document.addEventListener('DOMContentLoaded',()=>{
    const sec=$(VIEW); if(!sec) return;
    const onShow=()=>{ if(!isMgr()){ if(window.LWHUI) LWHUI.show('home'); return; } build(); load(); };
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
  });
})();
