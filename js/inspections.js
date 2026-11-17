/* MONTHLY FACILITY INSPECTIONS (v1.88.0) — warehouses, the Trailer Shop and the Corporate Office.
   Replaces the Google Form monthly safety inspection.

   - One inspection per zone per month. Big buildings are split into zones (5th St. = South End +
     North End) so two people can each do half; a site is done when all its zones are submitted.
   - Each site's checklist comes from its kind (warehouse / shop / office) and equipment (propane,
     electric lifts, compressors, docks), plus per-site exceptions — all set in Setup.
   - "Doesn't Meet Standard" needs a comment and (for most items) a photo, and opens a corrective
     action. A finding that's still open next month counts as "found again" instead of a duplicate.
   - Any inspector can do any zone. Admins (Tim, Ryan) can assign zones per month, edit the checklist,
     sites and email settings, and reopen a submitted inspection.
   - Answers save to the server as you go (and on this device, so a dropped signal loses nothing).

   Data: Supabase insp_* functions (sql/facility_inspections.sql). Photos: Edge Function insp-photo,
   private bucket. Emails + Google Sheet log: gas/InspectionMailer.gs. Setup: docs/INSPECTIONS_SETUP.md */
(function(){
  'use strict';
  const SUPA='https://tjivcqxnkftujceumdtx.supabase.co';
  const API=SUPA+'/rest/v1/rpc/';
  const FN=SUPA+'/functions/v1/insp-photo';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const VIEW='inspections';
  // A link from the report email: ?view=inspections&insp=<id>  (app.js clears the URL later, so read it now)
  const START_INSP=(()=>{ try{ const p=new URLSearchParams(location.search); return p.get('view')===VIEW?(p.get('insp')||''):''; }catch(e){ return ''; } })();

  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const auth=()=>window.LWHAuth||null;
  const toast=m=>{ if(window.LWHUI&&LWHUI.toast) LWHUI.toast(m); };
  const pad=x=>String(x).padStart(2,'0');
  const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const parseD=s=>{ const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m?new Date(+m[1],+m[2]-1,+m[3]):null; };
  const monthName=s=>{ const d=parseD(s); return d?d.toLocaleDateString('en-US',{month:'long',year:'numeric'}):''; };
  const shortDate=s=>{ if(!s) return ''; const d=/^\d{4}-\d{2}-\d{2}$/.test(s)?parseD(s):new Date(s); return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); };
  const when=s=>{ if(!s) return ''; const d=new Date(s); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); };
  const addMonths=(p,n)=>{ const d=parseD(p); d.setMonth(d.getMonth()+n); d.setDate(1); return ymd(d); };
  const plural=(k,w)=>k+' '+w+(k===1?'':'s');
  const ls={ get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
             set(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };

  const RESULTS=[['meets','Meets Standard'],['not','Doesn\'t Meet'],['na','N/A']];
  const RES_LABEL={meets:'Meets Standard',not:'Doesn\'t Meet Standard',na:'N/A'};
  const KIND_LABEL={warehouse:'Warehouse',shop:'Shop',office:'Office'};
  const REQ_LABEL={'':'Any site of those kinds',propane:'Sites with propane lifts',electric:'Sites with electric lifts',forklifts:'Sites with any forklifts',compressor:'Sites with air compressors',docks:'Sites with docks'};
  const EQUIP=[['has_propane','Propane lifts'],['has_electric','Electric lifts'],['has_compressor','Air compressor'],['has_docks','Docks']];
  const ICON='<svg class="icon" viewBox="0 0 24 24"><path d="M9 4h6v3H9z"/><path d="M7 5H5v16h14V5h-2"/><path d="M8.5 12.5l2 2 4-4"/><path d="M8 18h8"/></svg>';

  // ---------------------------------------------------------------- state
  let B=null;                 // bootstrap
  let M=null;                 // month data
  let period='';              // YYYY-MM-01 shown on the Month tab
  let tab='month', built=false, loading=false;
  let F=null;                 // open inspection form
  let A=null, aStatus='open', aLoc='';
  let H=null, hFrom='', hTo='', hLoc='';
  let setupPart='sites', setupLoc='', editItem=null;
  let onlyMine=false, prevTop=null;
  const photoUrl={};          // photo id -> signed URL (good for an hour)

  const me=()=>B&&B.me;
  const isAdmin=()=>!!(B&&B.me&&B.me.is_admin);
  const loc=code=>B&&B.locations.find(l=>l.code===code);
  const item=id=>B&&B.items.find(i=>i.id===id);
  const zoneById=id=>{ for(const l of (B?B.locations:[])) for(const z of l.zones) if(z.id===id) return {z,l}; return null; };
  const currentPeriod=()=>{ const t=parseD(B&&B.today)||new Date(); return ymd(new Date(t.getFullYear(),t.getMonth(),1)); };

  // ---------------------------------------------------------------- API
  async function rpc(name,args){
    let res;
    try{ res=await fetch(API+name,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(args||{}),cache:'no-store'}); }
    catch(e){ throw new Error('offline'); }
    if(res.status===401){ const a=auth(); if(a) a.requireSignIn('Please sign in to use Inspections.'); throw new Error('sign_in'); }
    if(!res.ok){ let t=''; try{ t=(await res.json()).message||''; }catch(e){} throw new Error(t||('HTTP '+res.status)); }
    const r=await res.json();
    if(r&&r.ok===false&&r.error==='sign_in'){ const a=auth(); if(a) a.requireSignIn('Please sign in to use Inspections.'); }
    return r;
  }
  const token=()=>{ const a=auth(); return (a&&a.token&&a.token())||''; };
  async function fnCall(qs,opts){
    let res;
    try{ res=await fetch(FN+'?'+qs,Object.assign({method:'POST',cache:'no-store'},opts,{headers:Object.assign({apikey:KEY,'x-lwh-session':token()},(opts&&opts.headers)||{})})); }
    catch(e){ throw new Error('offline'); }
    let r; try{ r=await res.json(); }catch(e){ throw new Error('HTTP '+res.status); }
    if(r&&r.error==='signed_out'){ const a=auth(); if(a) a.requireSignIn('Your sign-in ran out. Please sign in again.'); }
    return r;
  }
  const errText=e=>{
    const m=String(e&&e.message||e||'');
    if(m==='offline') return 'No connection. Your answers are kept on this device — they\'ll save when you\'re back online.';
    if(m==='sign_in'||m==='signed_out') return 'Please sign in again.';
    if(m==='no_access') return 'Inspections are for warehouse managers and inspectors. Ask Tim or Ryan to add you.';
    if(m==='already_submitted') return 'This inspection was already submitted. An admin can reopen it.';
    return m||'Something went wrong.';
  };

  // Load signed photo links for a list of ids, then fill any <img data-photo>.
  async function loadPhotos(ids){
    const need=[...new Set(ids)].filter(id=>id&&!photoUrl[id]);
    if(need.length){
      try{ const r=await fnCall('action=urls',{headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:need})});
        if(r&&r.ok) Object.assign(photoUrl,r.urls||{}); }catch(e){}
    }
    document.querySelectorAll('#inspections img[data-photo]').forEach(img=>{ const u=photoUrl[img.dataset.photo]; if(u&&img.src!==u) img.src=u; });
  }
  const thumb=(id,canRemove)=>`<span class="in-thumb"><a href="#" data-photo-open="${esc(id)}"><img data-photo="${esc(id)}" alt="Photo" src="${esc(photoUrl[id]||'')}"></a>${canRemove?`<button type="button" class="in-thumb-x" data-photo-remove="${esc(id)}" aria-label="Remove photo">×</button>`:''}</span>`;

  // Shrink a camera photo to ~1600px JPEG before upload (3–5 MB → ~300 KB).
  function shrink(file){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file), img=new Image();
      img.onload=()=>{
        const max=1600, s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
        const c=document.createElement('canvas'); c.width=Math.round(img.naturalWidth*s); c.height=Math.round(img.naturalHeight*s);
        c.getContext('2d').drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url);
        c.toBlob(b=>b?resolve(b):reject(new Error('Could not read that photo.')),'image/jpeg',0.72);
      };
      img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('Could not read that photo.')); };
      img.src=url;
    });
  }
  function pickPhoto(){
    return new Promise(resolve=>{
      const i=document.createElement('input'); i.type='file'; i.accept='image/*'; i.setAttribute('capture','environment');
      i.onchange=()=>resolve(i.files&&i.files[0]||null); i.click();
    });
  }

  // ---------------------------------------------------------------- shell
  const TABS=[['month','This Month'],['actions','Corrective Actions'],['history','History'],['setup','Setup']];
  function build(){
    const sec=$(VIEW); if(!sec||built) return; built=true;
    sec.innerHTML=`<div class="pr-wrap in-wrap">
      <div class="pr-top no-print">
        <div class="mh-entry-head">
          <div class="mh-entry-icon">${ICON}</div>
          <div><h2>Inspections</h2><div class="mh-entry-sub">Monthly safety inspections — warehouses, Trailer Shop, Corporate Office.</div></div>
          <div class="pr-who"><span id="inWho"></span><button type="button" class="ghost pr-small" id="inRefresh">Refresh</button></div>
        </div>
        <div class="pr-tabs" role="tablist" id="inTabs"></div>
      </div>
      <div id="inMsg" class="pr-msg no-print" hidden></div>
      <div id="inBody"></div>
      <div id="inViewer" class="in-viewer" hidden><button type="button" class="in-viewer-x" aria-label="Close">×</button><img alt="Photo"></div>
    </div>`;
    $('inTabs').addEventListener('click',e=>{ const b=e.target.closest('[data-intab]'); if(!b) return; if(F&&F.dirty) saveNow(); F=null; tab=b.dataset.intab; msg(''); render(); });
    $('inRefresh').onclick=()=>{ if(F&&F.dirty) saveNow(); boot(true); };
    sec.addEventListener('click',e=>{
      const o=e.target.closest('[data-photo-open]'); if(o){ e.preventDefault(); const u=photoUrl[o.dataset.photoOpen]; if(u){ $('inViewer').querySelector('img').src=u; $('inViewer').hidden=false; } }
    });
    $('inViewer').onclick=()=>{ $('inViewer').hidden=true; };
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&$('inViewer')) $('inViewer').hidden=true; });
  }
  function msg(html,tone){ const m=$('inMsg'); if(!m) return; m.innerHTML=html||''; m.hidden=!html; m.className='pr-msg no-print'+(tone?' pr-msg-'+tone:''); }

  async function boot(force){
    build();
    if(loading) return;
    const a=auth();
    if(!a||!a.isSignedIn()){ msg('Please sign in to use Inspections.','warn'); $('inBody').innerHTML=''; return; }
    if(B&&!force){ render(); return; }
    loading=true; if(!B) $('inBody').innerHTML='<div class="pr-empty">Loading…</div>';
    try{
      const r=await rpc('insp_bootstrap');
      if(!r.ok){ B=null; showNav(false); msg(esc(errText(r.error)),r.error==='no_access'?'warn':'bad'); $('inBody').innerHTML=''; return; }
      B=r; showNav(true);
      if(!period) period=currentPeriod();
      await loadMonth();
      if(START_INSP&&!boot.didStart){ boot.didStart=true; await openDetail(START_INSP); return; }
      render();
    }catch(e){ msg(esc(errText(e)),'bad'); }
    finally{ loading=false; }
  }
  async function loadMonth(){
    const r=await rpc('insp_month',{p_period:period}); if(!r.ok) throw new Error(r.error); M=r;
    // Admins: who had the most zones last month, for "next in rotation".
    if(isAdmin()&&(B.settings&&B.settings.rotation||[]).length){
      try{ const pr=await rpc('insp_month',{p_period:addMonths(period,-1)}); const c={};
        (pr.zones||[]).forEach(z=>{ if(z.assigned) c[z.assigned.emp_id]=(c[z.assigned.emp_id]||0)+1; });
        prevTop=+(Object.keys(c).sort((a,b)=>c[b]-c[a])[0]||0)||null; }catch(e){}
    }
  }

  function render(){
    if(!B) return;
    $('inWho').innerHTML=esc(B.me.name)+(isAdmin()?' <span class="pr-role pr-role-admin">Admin</span>':'');
    const tabs=TABS.filter(([k])=>k!=='setup'||isAdmin());
    $('inTabs').innerHTML=tabs.map(([k,l])=>`<button type="button" data-intab="${k}" role="tab" class="${k===tab&&!F?'active':''}">${l}${k==='actions'&&B.open_actions?` <b class="in-count${B.overdue_actions?' bad':''}">${B.open_actions}</b>`:''}</button>`).join('');
    if(F){ renderForm(); return; }
    ({month:renderMonth,actions:renderActions,history:renderHistory,setup:renderSetup})[tab]();
  }

  // ---------------------------------------------------------------- This Month
  function zoneState(zone){
    const zm=M&&M.zones.find(x=>x.zone_id===zone.id)||{};
    const i=zm.inspection;
    let st='none', label='Not started', cls='';
    if(i&&i.status==='submitted'){ st='done'; label='Done'; cls='pr-t-good'; }
    else if(i){ st='draft'; label='In progress · '+(i.answered||0)+'/'+(i.total||'?'); cls='pr-t-warn'; }
    return {st,label,cls,i,assigned:zm.assigned};
  }
  function renderMonth(){
    const cur=currentPeriod(), body=$('inBody');
    const active=B.locations.filter(l=>l.active||(M&&M.zones.some(z=>z.location_code===l.code&&z.inspection)));
    let total=0, done=0;
    active.forEach(l=>l.zones.filter(z=>z.active).forEach(z=>{ total++; if(zoneState(z).st==='done') done++; }));
    const mineCount=M?M.zones.filter(z=>z.assigned&&z.assigned.emp_id===B.me.emp_id).length:0;
    body.innerHTML=`
      <div class="in-monthbar">
        <div class="ac-monthnav">
          <button type="button" class="mh-arrow" id="inPrev" aria-label="Previous month"><svg class="icon" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
          <div class="ac-month">${esc(monthName(period))}</div>
          <button type="button" class="mh-arrow" id="inNext" aria-label="Next month" ${period>=cur?'disabled':''}><svg class="icon" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
          ${period!==cur?'<button type="button" class="ghost pr-small" id="inThis">This month</button>':''}
        </div>
        <div class="in-progress"><b>${done} of ${total}</b> zones submitted<div class="in-bar"><i style="width:${total?Math.round(done/total*100):0}%"></i></div></div>
        ${mineCount?`<label class="ac-check"><input type="checkbox" id="inMine" ${onlyMine?'checked':''}> Only mine (${mineCount})</label>`:''}
      </div>
      ${isAdmin()?assignCard():''}
      <div class="in-sites">${active.map(siteCard).join('')||'<div class="pr-empty">No sites set up yet.</div>'}</div>`;
    $('inPrev').onclick=()=>changeMonth(addMonths(period,-1));
    $('inNext').onclick=()=>{ if(period<cur) changeMonth(addMonths(period,1)); };
    if($('inThis')) $('inThis').onclick=()=>changeMonth(cur);
    if($('inMine')) $('inMine').onchange=e=>{ onlyMine=e.target.checked; renderMonth(); };
    body.querySelectorAll('[data-open-zone]').forEach(b=>b.onclick=()=>openForm(+b.dataset.openZone,period));
    body.querySelectorAll('[data-take-zone]').forEach(b=>b.onclick=()=>assign([+b.dataset.takeZone],B.me.emp_id));
    if(isAdmin()) wireAssign();
  }
  function siteCard(l){
    const zones=l.zones.filter(z=>z.active||(M&&M.zones.some(x=>x.zone_id===z.id&&x.inspection)));
    const shown=zones.filter(z=>!onlyMine||((zoneState(z).assigned||{}).emp_id===B.me.emp_id));
    if(!shown.length) return '';
    const st=zones.map(zoneState), allDone=st.length&&st.every(s=>s.st==='done');
    const open=(M&&M.actions_by_location&&M.actions_by_location[l.code])||0;
    const eq=EQUIP.filter(([k])=>l[k]).map(([,t])=>t);
    return `<div class="card in-site${allDone?' done':''}">
      <div class="in-site-head">
        <div><div class="in-site-name">${esc(l.name)}</div><div class="in-site-meta">${esc(l.code)} · ${esc(KIND_LABEL[l.kind]||l.kind)}${eq.length?' · '+esc(eq.join(', ')):''} · ${plural(l.items.length,'item')}</div></div>
        ${open?`<button type="button" class="in-badge-btn" data-intab-go="actions" data-loc="${esc(l.code)}">${plural(open,'open action')}</button>`:''}
        ${allDone?'<span class="pr-badge pr-t-good">✓ Done</span>':''}
      </div>
      ${shown.map(z=>{ const s=zoneState(z), i=s.i;
        const who=s.st==='done'?`${esc(i.submitted_name||'')} · ${shortDate(i.submitted_at)}${i.not?` · <b class="in-red">${i.not} not meeting</b>`:''}`
                 :s.st==='draft'?`Started by ${esc(i.started_name||'')}`:'';
        const btn=s.st==='done'?'View':s.st==='draft'?'Continue':'Start';
        return `<div class="in-zone">
          <div class="in-zone-main"><div class="in-zone-name">${esc(zones.length>1?z.name:'')}${zones.length>1?'':'Inspection'} <span class="pr-badge ${s.cls||'in-t-none'}">${esc(s.label)}</span></div>
            <div class="in-zone-sub">${who}${s.assigned?`${who?' · ':''}Assigned: <b>${esc(s.assigned.name)}</b>`:''}</div></div>
          <div class="in-zone-btns">${!s.assigned&&s.st!=='done'&&period===currentPeriod()&&!isAdmin()?`<button type="button" class="ghost pr-small" data-take-zone="${z.id}">Assign to me</button>`:''}
            <button type="button" class="${s.st==='done'?'ghost ':''}pr-small" data-open-zone="${z.id}">${btn}</button></div>
        </div>`; }).join('')}
    </div>`;
  }
  function assignCard(){
    const zones=[]; B.locations.filter(l=>l.active).forEach(l=>l.zones.filter(z=>z.active).forEach(z=>zones.push({l,z})));
    const opts=sel=>`<option value="">— Anyone —</option>`+B.inspectors.map(p=>`<option value="${p.emp_id}" ${String(sel)===String(p.emp_id)?'selected':''}>${esc(p.name)}</option>`).join('');
    const assigned=zones.filter(({z})=>zoneState(z).assigned).length;
    const sug=suggestNext();
    return `<details class="card in-assign" ${ls.get('lwh_inAssignOpen',false)?'open':''} id="inAssignBox">
      <summary><b>Assignments for ${esc(monthName(period))}</b> <span class="pr-small-t">${assigned?plural(assigned,'zone')+' assigned':'none — any inspector can do any zone'}</span></summary>
      <div class="in-assign-all">
        <label>Give every zone to<select id="inAllTo">${opts(sug?sug.emp_id:'')}</select></label>
        <button type="button" class="pr-small" id="inAllGo">Assign all</button>
        ${sug?`<span class="pr-small-t">Next in rotation: <b>${esc(sug.name)}</b></span>`:''}
      </div>
      <table class="pr-table in-assign-t"><tbody>${zones.map(({l,z})=>`<tr><td>${esc(l.name)}${l.zones.filter(x=>x.active).length>1?' — '+esc(z.name):''}</td>
        <td><select data-assign-zone="${z.id}">${opts((zoneState(z).assigned||{}).emp_id||'')}</select></td></tr>`).join('')}</tbody></table>
      <p class="hint">Assigned people get an email when the month starts and a reminder ${B.settings?B.settings.reminder_days:5} days before it ends. Anyone on the inspector list can still do any zone.</p>
    </details>`;
  }
  // The person after last month's main inspector in the rotation list (first in the list if none).
  function suggestNext(){
    const rot=(B.settings&&B.settings.rotation)||[]; if(!rot.length) return null;
    const idx=prevTop?rot.indexOf(prevTop):-1;
    return B.inspectors.find(x=>x.emp_id===rot[(idx+1)%rot.length])||null;
  }
  function wireAssign(){
    const box=$('inAssignBox'); if(!box) return;
    box.addEventListener('toggle',()=>ls.set('lwh_inAssignOpen',box.open));
    box.querySelectorAll('[data-assign-zone]').forEach(s=>s.onchange=()=>assign([+s.dataset.assignZone],s.value?+s.value:null));
    $('inAllGo').onclick=()=>{
      const v=$('inAllTo').value, ids=[...box.querySelectorAll('[data-assign-zone]')].map(s=>+s.dataset.assignZone);
      if(!confirm(v?`Assign all ${ids.length} zones for ${monthName(period)} to ${$('inAllTo').selectedOptions[0].textContent}?`:`Clear every assignment for ${monthName(period)}?`)) return;
      assign(ids,v?+v:null);
    };
  }
  async function assign(zoneIds,empId){
    try{ const r=await rpc('insp_admin_save',{p_kind:'assign',p_data:{period,zone_ids:zoneIds,emp_id:empId}});
      if(!r.ok) throw new Error(r.error); await loadMonth(); toast('Assignments saved'); render(); }
    catch(e){ toast(errText(e)); }
  }
  async function changeMonth(p){
    period=p; $('inBody').innerHTML='<div class="pr-empty">Loading…</div>';
    try{ await loadMonth(); }catch(e){ msg(esc(errText(e)),'bad'); }
    render();
  }

  // ---------------------------------------------------------------- inspection form
  const draftKey=(zone,p)=>'lwh_inDraft_'+zone+'_'+p;
  async function openForm(zoneId,p){
    const zl=zoneById(zoneId); if(!zl) return;
    msg(''); $('inBody').innerHTML='<div class="pr-empty">Loading…</div>';
    let r;
    try{ r=await rpc('insp_get',{p_zone_id:zoneId,p_period:p}); if(!r.ok) throw new Error(r.error); }
    catch(e){
      // Offline: carry on from what's saved on this device.
      const d=ls.get(draftKey(zoneId,p),null);
      if(String(e.message)!=='offline'||!d){ msg(esc(errText(e)),'bad'); render(); return; }
      r={inspection:null,answers:[],photos:[],open_actions:[]}; toast('Offline — working from this device.');
    }
    setForm(zl,p,r);
    render(); window.scrollTo(0,0);
  }
  async function openDetail(id){
    try{ const r=await rpc('insp_detail',{p_id:id}); if(!r.ok) throw new Error(r.error);
      const zl=zoneById(r.inspection.zone_id); if(!zl) throw new Error('not_found');
      setForm(zl,r.inspection.period,r); render(); window.scrollTo(0,0); }
    catch(e){ msg(esc(errText(e)),'bad'); render(); }
  }
  function setForm(zl,p,r){
    const ins=r.inspection;
    F={zone:zl.z, loc:zl.l, period:p, ins, answers:{}, photos:{}, notes:(ins&&ins.notes)||'', dirty:false, saving:false, savedAt:ins?ins.updated_at:null,
       readonly:!!(ins&&ins.status==='submitted'), openActions:{}, showErr:false};
    (r.answers||[]).forEach(a=>{ F.answers[a.item_id]={result:a.result,comment:a.comment||'',text:a.text,section:a.section,legacy_no:a.legacy_no,sort:a.sort}; });
    (r.photos||[]).forEach(ph=>{ (F.photos[ph.item_id]=F.photos[ph.item_id]||[]).push(ph.id); });
    (r.open_actions||[]).forEach(a=>{ F.openActions[a.item_id]=a; });
    if(!F.readonly){
      const d=ls.get(draftKey(F.zone.id,p),null);
      if(d&&(!F.savedAt||d.at>new Date(F.savedAt).getTime())){
        Object.keys(d.answers||{}).forEach(k=>{ F.answers[k]=Object.assign(F.answers[k]||{},d.answers[k]); });
        if(d.notes!=null) F.notes=d.notes; F.dirty=true; setTimeout(saveSoon,300);
      }
    }
  }
  // Items on the form: for a submitted inspection, exactly what was answered (with its wording at the time).
  function formItems(){
    if(F.readonly) return Object.keys(F.answers).map(k=>Object.assign({id:+k},F.answers[k])).sort((a,b)=>(a.sort||0)-(b.sort||0)||a.id-b.id)
      .map(a=>({id:a.id,section:a.section,text:a.text,legacy_no:a.legacy_no,photo_required:(item(a.id)||{}).photo_required}));
    return F.loc.items.map(item).filter(Boolean);
  }
  function problems(){
    const out={missing:[],comment:[],photo:[]};
    formItems().forEach(it=>{
      const a=F.answers[it.id];
      if(!a||!a.result) out.missing.push(it.id);
      else if(a.result==='not'){
        if(!String(a.comment||'').trim()) out.comment.push(it.id);
        if(it.photo_required&&!(F.photos[it.id]||[]).length) out.photo.push(it.id);
      }
    });
    return out;
  }
  function renderForm(){
    const items=formItems(), ro=F.readonly;
    const answered=items.filter(it=>F.answers[it.id]&&F.answers[it.id].result).length;
    const nots=items.filter(it=>F.answers[it.id]&&F.answers[it.id].result==='not').length;
    const p=F.showErr?problems():null;
    const bad=id=>p&&(p.missing.includes(id)||p.comment.includes(id)||p.photo.includes(id));
    const sections=[]; items.forEach(it=>{ let s=sections.find(x=>x.name===it.section); if(!s){ s={name:it.section,items:[]}; sections.push(s); } s.items.push(it); });
    const multi=F.loc.zones.filter(z=>z.active).length>1;
    const ins=F.ins;
    $('inBody').innerHTML=`<div class="in-form${ro?' ro':''}">
      <div class="in-form-head">
        <button type="button" class="ghost pr-small no-print" id="inBack">← Back</button>
        <div class="in-form-title"><h3>${esc(F.loc.name)}${multi?' — '+esc(F.zone.name):''}</h3>
          <div class="in-site-meta">${esc(F.loc.code)} · ${esc(monthName(F.period))} inspection${ro?` · submitted by <b>${esc(ins.submitted_name||'')}</b> ${when(ins.submitted_at)}`:ins?` · started by ${esc(ins.started_name||'')}`:''}</div></div>
        ${ro?`<div class="in-form-actions no-print"><button type="button" class="ghost pr-small" id="inPrint">Print</button>${isAdmin()?'<button type="button" class="ghost pr-small" id="inReopen">Reopen</button>':''}</div>`
            :`<div class="in-save-state no-print" id="inSaveState">${saveStateText()}</div>`}
      </div>
      ${ro?`<div class="pr-mini in-sum"><div><span>Meets</span><b>${ins.meets}</b></div><div><span>Doesn't meet</span><b class="${ins.not?'in-red':''}">${ins.not}</b></div><div><span>N/A</span><b>${ins.na}</b></div><div><span>Items</span><b>${items.length}</b></div></div>`
          :`<div class="in-progress in-sticky no-print"><b>${answered} of ${items.length}</b> answered${nots?` · <b class="in-red">${nots} doesn't meet</b>`:''}<div class="in-bar"><i style="width:${items.length?Math.round(answered/items.length*100):0}%"></i></div></div>`}
      ${p&&(p.missing.length||p.comment.length||p.photo.length)?`<div class="pr-msg pr-msg-bad">Before submitting: ${[p.missing.length?plural(p.missing.length,'item')+' not answered':'',p.comment.length?plural(p.comment.length,'item')+(p.comment.length===1?' needs':' need')+' a comment':'',p.photo.length?plural(p.photo.length,'item')+(p.photo.length===1?' needs':' need')+' a photo':''].filter(Boolean).join(' · ')}. They're marked in red.</div>`:''}
      ${sections.map(s=>{
        const done=s.items.filter(it=>F.answers[it.id]&&F.answers[it.id].result).length;
        return `<section class="in-sec"><h4>${esc(s.name)} <span class="pr-small-t">${done}/${s.items.length}</span></h4>
          ${s.items.map(it=>itemRow(it,ro,bad(it.id))).join('')}</section>`; }).join('')}
      <section class="in-sec"><h4>Notes</h4>
        ${ro?`<div class="in-notes">${F.notes?esc(F.notes).replace(/\n/g,'<br>'):'<span class="pr-small-t">No notes.</span>'}</div>`
            :`<textarea id="inNotes" rows="3" placeholder="Anything else from this inspection (optional)">${esc(F.notes)}</textarea>`}
      </section>
      ${ro?'':`<div class="in-submit no-print">
        <button type="button" id="inSubmit">Submit inspection</button>
        <button type="button" class="ghost" id="inSaveBtn">Save &amp; finish later</button>
        ${ins&&(isAdmin()||ins.started_by===B.me.emp_id)?'<button type="button" class="ghost in-danger" id="inDiscard">Discard draft</button>':''}
      </div>`}
    </div>`;
    wireForm();
    const ids=[].concat(...Object.values(F.photos)); if(ids.length) loadPhotos(ids);
  }
  function itemRow(it,ro,isBad){
    const a=F.answers[it.id]||{}, ph=F.photos[it.id]||[], oa=F.openActions[it.id];
    const num=it.legacy_no?`<span class="in-no">#${it.legacy_no}</span>`:'<span class="in-no in-new">New</span>';
    if(ro) return `<div class="in-item res-${a.result||'none'}">
        <div class="in-item-text">${num}${esc(it.text)}</div>
        <div class="in-item-res"><span class="pr-badge ${a.result==='not'?'pr-t-bad':a.result==='meets'?'pr-t-good':'in-t-none'}">${esc(RES_LABEL[a.result]||'—')}</span></div>
        ${a.comment?`<div class="in-item-comment">${esc(a.comment)}</div>`:''}
        ${ph.length?`<div class="in-thumbs">${ph.map(id=>thumb(id,false)).join('')}</div>`:''}
      </div>`;
    return `<div class="in-item res-${a.result||'none'}${isBad?' bad':''}" data-item="${it.id}">
      <div class="in-item-text">${num}${esc(it.text)}</div>
      ${oa?`<div class="in-prev">⚠ Still open from ${esc(shortDate(oa.opened_at))}${oa.times_found>1?` · found ${oa.times_found}×`:''} — check whether it's fixed.</div>`:''}
      <div class="in-res" role="radiogroup">${RESULTS.map(([k,l])=>`<button type="button" class="in-res-${k}${a.result===k?' on':''}" data-res="${k}" aria-pressed="${a.result===k}">${l}</button>`).join('')}</div>
      ${a.result==='not'?`<div class="in-not">
        <textarea data-comment rows="2" placeholder="What's wrong, and where? (required)">${esc(a.comment||'')}</textarea>
        <div class="in-thumbs">${ph.map(id=>thumb(id,true)).join('')}
          <button type="button" class="in-addphoto" data-addphoto><svg class="icon" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>${ph.length?'Add':'Photo'}${it.photo_required&&!ph.length?' <small>(required)</small>':''}</button></div>
      </div>`:''}
    </div>`;
  }
  function saveStateText(){
    if(!F) return '';
    if(F.saving) return 'Saving…';
    if(F.dirty) return navigator.onLine?'Not saved yet':'Offline — kept on this device';
    return F.savedAt?'Saved '+when(F.savedAt):'';
  }
  function setSaveState(){ const s=$('inSaveState'); if(s) s.textContent=saveStateText(); }
  function wireForm(){
    $('inBack').onclick=()=>{ if(F&&F.dirty) saveNow(); F=null; loadMonth().then(render,render); };
    if(F.readonly){
      if($('inPrint')) $('inPrint').onclick=()=>print();
      if($('inReopen')) $('inReopen').onclick=async()=>{
        if(!confirm('Reopen this inspection so it can be changed and submitted again? It will be emailed again when resubmitted.')) return;
        try{ const r=await rpc('insp_reopen',{p_id:F.ins.id}); if(!r.ok) throw new Error(r.error); toast('Reopened'); openForm(F.zone.id,F.period); }
        catch(e){ toast(errText(e)); }
      };
      return;
    }
    const body=$('inBody');
    body.querySelectorAll('.in-item[data-item]').forEach(row=>{
      const id=+row.dataset.item;
      row.querySelectorAll('[data-res]').forEach(b=>b.onclick=()=>{
        const a=F.answers[id]=F.answers[id]||{}; const was=a.result;
        a.result=a.result===b.dataset.res?'':b.dataset.res; changed();
        const keepY=row.getBoundingClientRect().top;
        renderForm();
        const nr=document.querySelector(`.in-item[data-item="${id}"]`);
        if(nr){ window.scrollBy(0,nr.getBoundingClientRect().top-keepY); if(a.result==='not'&&was!=='not'){ const t=nr.querySelector('[data-comment]'); if(t) t.focus(); } }
      });
      const c=row.querySelector('[data-comment]');
      if(c) c.oninput=()=>{ F.answers[id].comment=c.value; changed(); };
      const add=row.querySelector('[data-addphoto]');
      if(add) add.onclick=()=>addPhoto(id,add);
      row.querySelectorAll('[data-photo-remove]').forEach(x=>x.onclick=()=>removePhoto(id,x.dataset.photoRemove));
    });
    $('inNotes').oninput=e=>{ F.notes=e.target.value; changed(); };
    $('inSaveBtn').onclick=async()=>{ await saveNow(); if(F&&!F.dirty){ toast('Saved — finish any time this month.'); F=null; await loadMonth().catch(()=>{}); render(); } };
    $('inSubmit').onclick=submit;
    if($('inDiscard')) $('inDiscard').onclick=async()=>{
      if(!confirm('Throw away this draft, its answers and photos?')) return;
      try{ const r=await rpc('insp_discard',{p_id:F.ins.id}); if(!r.ok) throw new Error(r.error);
        ls.set(draftKey(F.zone.id,F.period),null); F=null; toast('Draft discarded'); await loadMonth(); render(); }
      catch(e){ toast(errText(e)); }
    };
  }
  let saveTimer=null;
  function changed(){
    F.dirty=true;
    ls.set(draftKey(F.zone.id,F.period),{at:Date.now(),answers:F.answers,notes:F.notes});
    setSaveState(); saveSoon();
  }
  function saveSoon(){ clearTimeout(saveTimer); saveTimer=setTimeout(saveNow,1500); }
  function payload(){
    return Object.keys(F.answers).filter(k=>F.answers[k].result).map(k=>({item_id:+k,result:F.answers[k].result,comment:F.answers[k].comment||''}));
  }
  async function saveNow(submitIt){
    clearTimeout(saveTimer);
    const f=F; if(!f||f.readonly) return null;
    if(!submitIt&&!f.dirty) return null;
    if(f.saving){ await new Promise(r=>setTimeout(r,400)); return saveNow(submitIt); }
    f.saving=true; setSaveState();
    try{
      const r=await rpc('insp_save',{p_zone_id:f.zone.id,p_period:f.period,p_answers:payload(),p_notes:f.notes,p_submit:!!submitIt});
      f.saving=false;
      if(r.ok||r.error==='incomplete'){
        f.dirty=false; f.savedAt=new Date().toISOString(); ls.set(draftKey(f.zone.id,f.period),null);
        if(!f.ins) f.ins={id:r.id,status:'draft',started_by:B.me.emp_id,started_name:B.me.name};
      }
      setSaveState();
      return r;
    }catch(e){
      f.saving=false; setSaveState();
      if(String(e.message)!=='offline') toast(errText(e));
      return {ok:false,error:e.message};
    }
  }
  async function submit(){
    const p=problems();
    if(p.missing.length||p.comment.length||p.photo.length){ F.showErr=true; renderForm(); scrollToFirstBad(); return; }
    if(!navigator.onLine){ toast('You\'re offline. Submit when you have signal — your answers are saved on this device.'); return; }
    const nots=payload().filter(a=>a.result==='not').length;
    if(!confirm(`Submit the ${monthName(F.period)} inspection for ${F.loc.name}${F.loc.zones.filter(z=>z.active).length>1?' — '+F.zone.name:''}?\n\n${nots?plural(nots,'item')+' doesn\'t meet standard and will open corrective actions.':'Everything meets standard or is N/A.'}\nIt can't be changed after this (an admin can reopen it).`)) return;
    const b=$('inSubmit'); b.disabled=true; b.textContent='Submitting…';
    const r=await saveNow(true);
    if(r&&r.ok){
      toast('Inspection submitted'+(nots?' — '+plural(nots,'corrective action')+' opened':''));
      const zid=F.zone.id, per=F.period; F=null;
      const bb=await rpc('insp_bootstrap').catch(()=>null); if(bb&&bb.ok) B=bb;
      await loadMonth().catch(()=>{});
      openForm(zid,per);
      return;
    }
    b.disabled=false; b.textContent='Submit inspection';
    if(r&&r.error==='incomplete'){ F.showErr=true; renderForm(); scrollToFirstBad(); }
    else if(r&&r.error==='already_submitted'){ toast(errText('already_submitted')); openForm(F.zone.id,F.period); }
    else if(r&&r.error) toast(errText(r.error));
  }
  function scrollToFirstBad(){ const x=document.querySelector('.in-item.bad'); if(x) x.scrollIntoView({behavior:'smooth',block:'center'}); }
  async function addPhoto(itemId,btn){
    if(!navigator.onLine){ toast('Photos need a connection. Try again when you have signal.'); return; }
    const file=await pickPhoto(); if(!file) return;
    btn.disabled=true; btn.innerHTML='Uploading…';
    try{
      // The inspection must exist before photos can hang off it — save first.
      if(F.dirty||!F.ins) await saveNow();
      const blob=await shrink(file);
      const r=await fnCall(`action=upload&zone=${F.zone.id}&period=${F.period}&item=${itemId}`,{headers:{'Content-Type':'image/jpeg'},body:blob});
      if(!r||!r.ok) throw new Error((r&&r.error)||'Photo did not upload');
      (F.photos[itemId]=F.photos[itemId]||[]).push(r.id);
      if(!F.ins&&r.inspection_id) F.ins={id:r.inspection_id,status:'draft',started_by:B.me.emp_id};
      try{ photoUrl[r.id]=URL.createObjectURL(blob); }catch(e){}
      renderForm();
    }catch(e){ toast(errText(e)); btn.disabled=false; renderForm(); }
  }
  async function removePhoto(itemId,photoId){
    if(!confirm('Remove this photo?')) return;
    try{ const r=await rpc('insp_photo_remove',{p_id:photoId}); if(!r.ok) throw new Error(r.error);
      F.photos[itemId]=(F.photos[itemId]||[]).filter(x=>x!==photoId); renderForm(); }
    catch(e){ toast(errText(e)); }
  }

  // ---------------------------------------------------------------- Corrective Actions
  async function renderActions(){
    const body=$('inBody');
    const locOpts=`<option value="">All sites</option>`+B.locations.map(l=>`<option value="${esc(l.code)}" ${aLoc===l.code?'selected':''}>${esc(l.name)}</option>`).join('');
    body.innerHTML=`<div class="in-filters">
        <div class="pr-presets">${[['open','Open'],['closed','Closed'],['all','All']].map(([k,l])=>`<button type="button" class="pr-preset${aStatus===k?' on':''}" data-astatus="${k}">${l}</button>`).join('')}</div>
        <select id="inALoc" aria-label="Site">${locOpts}</select>
      </div><div id="inAList"><div class="pr-empty">Loading…</div></div>`;
    body.querySelectorAll('[data-astatus]').forEach(b=>b.onclick=()=>{ aStatus=b.dataset.astatus; A=null; renderActions(); });
    $('inALoc').onchange=e=>{ aLoc=e.target.value; A=null; renderActions(); };
    if(!A){
      try{ const r=await rpc('insp_actions_list',{p_status:aStatus,p_location:aLoc||null}); if(!r.ok) throw new Error(r.error); A=r; }
      catch(e){ $('inAList').innerHTML=`<div class="pr-empty">${esc(errText(e))}</div>`; return; }
    }
    if(tab!=='actions'||F) return;
    const rows=A.rows;
    $('inAList').innerHTML=rows.length?rows.map(actionCard).join(''):`<div class="pr-empty">${aStatus==='open'?'No open corrective actions. 👍':'Nothing here.'}</div>`;
    wireActions();
    loadPhotos([].concat(...rows.map(r=>r.photos.map(p=>p.id))));
  }
  function actionCard(a){
    const overdue=a.status==='open'&&a.due_on&&a.due_on<A.today;
    const multi=(loc(a.location_code)||{zones:[]}).zones.filter(z=>z.active).length>1;
    const finds=a.photos.filter(p=>p.kind==='finding'), fixes=a.photos.filter(p=>p.kind==='fix');
    const opts=`<option value="">— Nobody —</option>`+B.inspectors.map(p=>`<option value="${p.emp_id}" ${a.assigned_emp===p.emp_id?'selected':''}>${esc(p.name)}</option>`).join('');
    return `<div class="card in-action${a.status==='closed'?' closed':''}${overdue?' overdue':''}" data-action="${a.id}">
      <div class="in-action-head">
        <div><div class="in-site-name">${esc(a.location_name)}${multi?' — '+esc(a.zone_name):''}</div>
          <div class="in-site-meta">${esc(a.section||'')} · found ${esc(monthName(a.period))} by ${esc(a.opened_name||'')}${a.times_found>1?` · <b class="in-red">found ${a.times_found}× (last ${esc(monthName(a.last_period))})</b>`:''}</div></div>
        <div class="in-action-status">${a.status==='closed'?`<span class="pr-badge pr-t-good">Closed ${esc(shortDate(a.closed_at))}</span>`
            :overdue?`<span class="pr-badge pr-t-bad">Overdue · due ${esc(shortDate(a.due_on))}</span>`
            :a.due_on?`<span class="pr-badge pr-t-warn">Due ${esc(shortDate(a.due_on))}</span>`:''}</div>
      </div>
      <div class="in-action-text">${esc(a.text)}</div>
      ${a.comment?`<div class="in-item-comment">${esc(a.comment)}</div>`:''}
      ${finds.length?`<div class="in-thumbs">${finds.map(p=>thumb(p.id,false)).join('')}</div>`:''}
      ${a.status==='closed'?`<div class="in-fixed"><b>Fixed:</b> ${esc(a.close_note||'')} <span class="pr-small-t">— ${esc(a.closed_name||'')}</span>
          ${fixes.length?`<div class="in-thumbs">${fixes.map(p=>thumb(p.id,false)).join('')}</div>`:''}</div>
        <div class="in-action-btns no-print"><button type="button" class="ghost pr-small" data-areopen>Reopen</button></div>`
      :`<div class="in-action-edit no-print">
          <label>Assigned to<select data-aassign>${opts}</select></label>
          <label>Due<input type="date" data-adue value="${esc(a.due_on||'')}"></label>
        </div>
        ${fixes.length?`<div class="in-thumbs"><span class="pr-small-t">Fixed photos:</span>${fixes.map(p=>thumb(p.id,true)).join('')}</div>`:''}
        <div class="in-action-btns no-print">
          <button type="button" class="ghost pr-small" data-anote>Add note</button>
          <button type="button" class="ghost pr-small" data-aphoto>Add "fixed" photo</button>
          <button type="button" class="pr-small" data-aclose>Mark fixed</button>
        </div>
        <div class="in-close" hidden><textarea rows="2" placeholder="What was done to fix it? (required)"></textarea>
          <div class="in-action-btns"><button type="button" class="pr-small" data-aclose-go>Close action</button><button type="button" class="ghost pr-small" data-aclose-cancel>Cancel</button></div></div>`}
      ${a.log&&a.log.length?`<details class="in-log"><summary>History (${a.log.length})</summary>${a.log.map(l=>`<div><span class="pr-small-t">${esc(when(l.at))} · ${esc(l.by)}</span> ${esc(l.what)}</div>`).join('')}</details>`:''}
    </div>`;
  }
  function wireActions(){
    document.querySelectorAll('#inAList [data-action]').forEach(card=>{
      const id=+card.dataset.action;
      const upd=async(data,ok)=>{ try{ const r=await rpc('insp_action_update',{p_id:id,p_data:data}); if(!r.ok) throw new Error(r.error); if(ok) toast(ok); A=null;
          const bb=await rpc('insp_bootstrap').catch(()=>null); if(bb&&bb.ok) B=bb; render(); }catch(e){ toast(errText(e)); } };
      const q=s=>card.querySelector(s);
      if(q('[data-aassign]')) q('[data-aassign]').onchange=e=>upd({assigned_emp:e.target.value||null},'Saved');
      if(q('[data-adue]')) q('[data-adue]').onchange=e=>upd({due_on:e.target.value||null},'Due date saved');
      if(q('[data-anote]')) q('[data-anote]').onclick=()=>{ const n=prompt('Add a note (parts ordered, who\'s on it, etc.):'); if(n&&n.trim()) upd({note:n.trim()},'Note added'); };
      if(q('[data-aclose]')) q('[data-aclose]').onclick=()=>{ q('.in-close').hidden=false; q('.in-close textarea').focus(); };
      if(q('[data-aclose-cancel]')) q('[data-aclose-cancel]').onclick=()=>{ q('.in-close').hidden=true; };
      if(q('[data-aclose-go]')) q('[data-aclose-go]').onclick=()=>{ const t=q('.in-close textarea').value.trim(); if(!t){ toast('Say what was done to fix it.'); return; } upd({close:true,close_note:t},'Action closed'); };
      if(q('[data-areopen]')) q('[data-areopen]').onclick=()=>{ const n=prompt('Why is it being reopened?'); if(n!==null) upd({reopen:true,note:n},'Reopened'); };
      if(q('[data-aphoto]')) q('[data-aphoto]').onclick=async()=>{
        const file=await pickPhoto(); if(!file) return;
        const b=q('[data-aphoto]'); b.disabled=true; b.textContent='Uploading…';
        try{ const blob=await shrink(file); const r=await fnCall('action=upload&action_id='+id,{headers:{'Content-Type':'image/jpeg'},body:blob});
          if(!r||!r.ok) throw new Error((r&&r.error)||'Photo did not upload'); toast('Photo added'); A=null; renderActions(); }
        catch(e){ toast(errText(e)); b.disabled=false; b.textContent='Add "fixed" photo'; }
      };
      card.querySelectorAll('[data-photo-remove]').forEach(x=>x.onclick=async()=>{
        if(!confirm('Remove this photo?')) return;
        try{ const r=await rpc('insp_photo_remove',{p_id:x.dataset.photoRemove}); if(!r.ok) throw new Error(r.error); A=null; renderActions(); }catch(e){ toast(errText(e)); }
      });
    });
  }

  // ---------------------------------------------------------------- History
  async function renderHistory(){
    const body=$('inBody'), cur=currentPeriod();
    if(!hTo) hTo=cur.slice(0,7); if(!hFrom) hFrom=addMonths(cur,-11).slice(0,7);
    body.innerHTML=`<div class="in-filters">
        <label>From<input type="month" id="inHFrom" value="${esc(hFrom)}"></label>
        <label>To<input type="month" id="inHTo" value="${esc(hTo)}"></label>
        <select id="inHLoc" aria-label="Site"><option value="">All sites</option>${B.locations.map(l=>`<option value="${esc(l.code)}" ${hLoc===l.code?'selected':''}>${esc(l.name)}</option>`).join('')}</select>
        <button type="button" class="ghost pr-small" id="inHExcel">Excel</button>
      </div><div id="inHList"><div class="pr-empty">Loading…</div></div>`;
    const reload=()=>{ hFrom=$('inHFrom').value||hFrom; hTo=$('inHTo').value||hTo; hLoc=$('inHLoc').value; H=null; renderHistory(); };
    $('inHFrom').onchange=reload; $('inHTo').onchange=reload; $('inHLoc').onchange=reload;
    $('inHExcel').onclick=exportExcel;
    if(!H){
      try{ const r=await rpc('insp_history',{p_from:hFrom+'-01',p_to:hTo+'-01',p_location:hLoc||null}); if(!r.ok) throw new Error(r.error); H=r; }
      catch(e){ $('inHList').innerHTML=`<div class="pr-empty">${esc(errText(e))}</div>`; return; }
    }
    if(tab!=='history'||F) return;
    $('inHList').innerHTML=H.rows.length?`<div class="in-tablewrap"><table class="pr-table in-htable"><thead><tr><th>Month</th><th>Site</th><th>Inspector</th><th>Status</th><th class="r">Meets</th><th class="r">Doesn't meet</th><th class="r">N/A</th><th class="r">Photos</th></tr></thead>
      <tbody>${H.rows.map(r=>`<tr data-hopen="${r.id}" tabindex="0"><td class="nw">${esc(monthName(r.period))}</td>
        <td>${esc(r.location_name)}${(loc(r.location_code)||{zones:[]}).zones.length>1?' — '+esc(r.zone_name):''}</td>
        <td>${esc(r.submitted_name||'')}${r.submitted_at?` <span class="pr-small-t">${esc(shortDate(r.submitted_at))}</span>`:''}</td>
        <td>${r.status==='submitted'?'<span class="pr-badge pr-t-good">Submitted</span>':'<span class="pr-badge pr-t-warn">Draft</span>'}</td>
        <td class="r">${r.meets}</td><td class="r">${r.not?`<b class="in-red">${r.not}</b>`:0}</td><td class="r">${r.na}</td><td class="r">${r.photos||''}</td></tr>`).join('')}</tbody></table></div>`
      :'<div class="pr-empty">No inspections in that range.</div>';
    $('inHList').querySelectorAll('[data-hopen]').forEach(tr=>{ const go=()=>openDetail(tr.dataset.hopen); tr.onclick=go; tr.onkeydown=e=>{ if(e.key==='Enter') go(); }; });
  }
  async function exportExcel(){
    if(!window.LWHXlsx){ toast('Excel export isn\'t loaded.'); return; }
    try{
      const r=await rpc('insp_export',{p_from:hFrom+'-01',p_to:hTo+'-01',p_location:hLoc||null}); if(!r.ok) throw new Error(r.error);
      if(!r.rows.length){ toast('Nothing to export.'); return; }
      const cols=[['Month',14],['Site code',10],['Site',22],['Zone',16],['Status',11],['Inspector',22],['Submitted',18],['Section',24],['Form #',8],['Item',70],['Result',22],['Comment',50]];
      LWHXlsx.download(`Inspections_${hFrom}_to_${hTo}.xlsx`,[{name:'Inspections',columns:cols.map(([label,width])=>({label,width,type:label==='Form #'?'n':'s'})),
        rows:r.rows.map(x=>[monthName(x.period),x.location_code,x.location_name,x.zone_name,x.status,x.inspector||'',x.submitted_at?when(x.submitted_at):'',x.section||'',x.legacy_no==null?'':x.legacy_no,x.item||'',RES_LABEL[x.result]||x.result,x.comment||''])}]);
    }catch(e){ toast(errText(e)); }
  }

  // ---------------------------------------------------------------- Setup (admins)
  function renderSetup(){
    if(!isAdmin()){ tab='month'; render(); return; }
    const parts=[['sites','Sites & zones'],['items','Checklist'],['bysite','Checklist by site'],['people','People & email']];
    $('inBody').innerHTML=`<div class="pr-presets in-setup-tabs">${parts.map(([k,l])=>`<button type="button" class="pr-preset${setupPart===k?' on':''}" data-spart="${k}">${l}</button>`).join('')}</div><div id="inSetup"></div>`;
    $('inBody').querySelectorAll('[data-spart]').forEach(b=>b.onclick=()=>{ setupPart=b.dataset.spart; editItem=null; renderSetup(); });
    ({sites:setupSites,items:setupItems,bysite:setupBySite,people:setupPeople})[setupPart]();
  }
  async function adminSave(kind,data,ok){
    try{ const r=await rpc('insp_admin_save',{p_kind:kind,p_data:data}); if(!r.ok) throw new Error(r.error);
      const bb=await rpc('insp_bootstrap'); if(bb.ok) B=bb; if(ok) toast(ok); return true; }
    catch(e){ toast(errText(e)); return false; }
  }
  function setupSites(){
    const box=$('inSetup');
    box.innerHTML=`<p class="hint">Equipment decides which checklist items a site gets (propane → propane items, electric lifts → battery charging and eyewash, any lifts → forklift operations, and so on). A new site starts with one zone, "Whole building"; add zones to split a big building between inspectors.</p>
      ${B.locations.map(l=>`<div class="card pr-card in-sitecfg${l.active?'':' inactive'}" data-site="${esc(l.code)}">
        <h3>${esc(l.code)} — ${esc(l.name)}</h3>
        <div class="pr-grid3">
          <label>Name<input data-f="name" value="${esc(l.name)}"></label>
          <label>Address<input data-f="address" value="${esc(l.address||'')}"></label>
          <label>Kind<select data-f="kind">${Object.entries(KIND_LABEL).map(([k,t])=>`<option value="${k}" ${l.kind===k?'selected':''}>${t}</option>`).join('')}</select></label>
        </div>
        <div class="in-checks">${EQUIP.map(([k,t])=>`<label class="ac-check"><input type="checkbox" data-f="${k}" ${l[k]?'checked':''}> ${t}</label>`).join('')}
          <label class="ac-check"><input type="checkbox" data-f="active" ${l.active?'checked':''}> Active</label>
          <label class="in-sortlbl">Order<input type="number" data-f="sort" value="${l.sort}"></label></div>
        <div class="in-zones"><b>${esc(l.code)} zones:</b> ${l.zones.map(z=>`<span class="in-zonechip${z.active?'':' off'}">${esc(z.name)} <button type="button" class="in-linkbtn" data-zedit="${z.id}">rename</button> <button type="button" class="in-linkbtn" data-ztoggle="${z.id}">${z.active?'turn off':'turn on'}</button></span>`).join(' ')}
          <button type="button" class="ghost pr-small" data-zadd>Add zone</button></div>
        <div class="actions"><button type="button" class="pr-small" data-sitesave>Save ${esc(l.code)}</button> <span class="pr-small-t">${plural(l.items.length,'checklist item')}</span></div>
      </div>`).join('')}
      <div class="card pr-card"><h3>Add a site</h3>
        <div class="pr-grid3"><label>Code<input id="inNewCode" placeholder="WHSE90" autocapitalize="characters"></label><label>Name<input id="inNewName" placeholder="Dallas"></label>
          <label>Kind<select id="inNewKind">${Object.entries(KIND_LABEL).map(([k,t])=>`<option value="${k}">${t}</option>`).join('')}</select></label></div>
        <div class="in-checks">${EQUIP.map(([k,t])=>`<label class="ac-check"><input type="checkbox" data-new="${k}"> ${t}</label>`).join('')}</div>
        <div class="actions"><button type="button" class="pr-small" id="inNewSite">Add site</button></div></div>`;
    box.querySelectorAll('[data-site]').forEach(card=>{
      const code=card.dataset.site, l=loc(code);
      card.querySelector('[data-sitesave]').onclick=async()=>{
        const d={code}; card.querySelectorAll('[data-f]').forEach(i=>{ d[i.dataset.f]=i.type==='checkbox'?i.checked:i.value; });
        if(await adminSave('location',d,code+' saved')) renderSetup();
      };
      card.querySelector('[data-zadd]').onclick=async()=>{ const n=prompt('New zone name for '+l.name+' (e.g. North End):'); if(n&&n.trim()&&await adminSave('zone',{location_code:code,name:n.trim(),sort:(l.zones.length+1)*10},'Zone added')) renderSetup(); };
      card.querySelectorAll('[data-zedit]').forEach(b=>b.onclick=async()=>{ const z=l.zones.find(x=>x.id===+b.dataset.zedit); const n=prompt('Rename zone:',z.name); if(n&&n.trim()&&await adminSave('zone',{id:z.id,name:n.trim()},'Zone renamed')) renderSetup(); });
      card.querySelectorAll('[data-ztoggle]').forEach(b=>b.onclick=async()=>{ const z=l.zones.find(x=>x.id===+b.dataset.ztoggle);
        if(z.active&&l.zones.filter(x=>x.active).length===1&&!confirm('This is the site\'s only active zone — turning it off removes the site from the monthly list. Continue?')) return;
        if(await adminSave('zone',{id:z.id,name:z.name,active:!z.active},'Zone updated')) renderSetup(); });
    });
    $('inNewSite').onclick=async()=>{
      const d={code:$('inNewCode').value.trim().toUpperCase(),name:$('inNewName').value.trim(),kind:$('inNewKind').value,sort:(Math.max(0,...B.locations.map(l=>l.sort))+10)};
      box.querySelectorAll('[data-new]').forEach(i=>{ d[i.dataset.new]=i.checked; });
      if(await adminSave('location',d,d.code+' added')) renderSetup();
    };
  }
  function itemForm(it){
    const sections=[...new Set(B.items.map(i=>i.section))];
    return `<div class="card pr-card in-itemform"><h3>${it.id?'Edit item'+(it.legacy_no?' (form #'+it.legacy_no+')':''):'New checklist item'}</h3>
      <label>Section<input id="inIfSec" list="inSecList" value="${esc(it.section||'')}"><datalist id="inSecList">${sections.map(s=>`<option value="${esc(s)}">`).join('')}</datalist></label>
      <label>Wording<textarea id="inIfText" rows="2">${esc(it.text||'')}</textarea></label>
      <div class="in-checks"><b>Kinds of site:</b>${Object.entries(KIND_LABEL).map(([k,t])=>`<label class="ac-check"><input type="checkbox" data-ifkind="${k}" ${(it.kinds||['warehouse','shop']).includes(k)?'checked':''}> ${t}</label>`).join('')}</div>
      <div class="pr-grid3">
        <label>Only at<select id="inIfReq">${Object.entries(REQ_LABEL).map(([k,t])=>`<option value="${k}" ${(it.requires||'')===k?'selected':''}>${t}</option>`).join('')}</select></label>
        <label>Order<input type="number" id="inIfSort" value="${it.sort==null?'':it.sort}"></label>
        <div class="in-checks in-checks-col"><label class="ac-check"><input type="checkbox" id="inIfPhoto" ${it.photo_required!==false?'checked':''}> Photo required when it doesn't meet</label>
          <label class="ac-check"><input type="checkbox" id="inIfActive" ${it.active!==false?'checked':''}> Active</label></div>
      </div>
      <p class="hint">Changing the wording doesn't change past inspections — each one keeps the wording it was answered with.</p>
      <div class="actions"><button type="button" class="pr-small" id="inIfSave">Save item</button> <button type="button" class="ghost pr-small" id="inIfCancel">Cancel</button></div></div>`;
  }
  function setupItems(){
    const box=$('inSetup');
    const sections=[]; B.items.forEach(i=>{ let s=sections.find(x=>x.name===i.section); if(!s){ s={name:i.section,items:[]}; sections.push(s); } s.items.push(i); });
    box.innerHTML=`${editItem?itemForm(editItem):'<div class="actions"><button type="button" class="pr-small" id="inAddItem">Add checklist item</button></div>'}
      ${sections.map(s=>`<div class="card pr-card"><h3>${esc(s.name)}</h3>${s.items.map(i=>`<div class="in-cfgitem${i.active?'':' inactive'}">
          <div><span class="in-no${i.legacy_no?'':' in-new'}">${i.legacy_no?'#'+i.legacy_no:'New'}</span>${esc(i.text)}
            <div class="pr-small-t">${i.kinds.map(k=>KIND_LABEL[k]).join(', ')}${i.requires?' · '+esc(REQ_LABEL[i.requires]):''}${i.photo_required?'':' · photo optional'}${i.active?'':' · <b>off</b>'}</div></div>
          <button type="button" class="ghost pr-small" data-iedit="${i.id}">Edit</button></div>`).join('')}</div>`).join('')}`;
    if($('inAddItem')) $('inAddItem').onclick=()=>{ editItem={}; renderSetup(); window.scrollTo(0,0); };
    box.querySelectorAll('[data-iedit]').forEach(b=>b.onclick=()=>{ editItem=item(+b.dataset.iedit); renderSetup(); window.scrollTo(0,0); });
    if(editItem){
      $('inIfCancel').onclick=()=>{ editItem=null; renderSetup(); };
      $('inIfSave').onclick=async()=>{
        const d={id:editItem.id||null,section:$('inIfSec').value.trim(),text:$('inIfText').value.trim(),
          kinds:[...box.querySelectorAll('[data-ifkind]:checked')].map(x=>x.dataset.ifkind),requires:$('inIfReq').value,
          sort:$('inIfSort').value===''?null:+$('inIfSort').value,photo_required:$('inIfPhoto').checked,active:$('inIfActive').checked};
        if(!d.kinds.length){ toast('Pick at least one kind of site.'); return; }
        if(await adminSave('item',d,'Checklist saved')){ editItem=null; renderSetup(); }
      };
    }
  }
  function setupBySite(){
    const box=$('inSetup'); if(!setupLoc) setupLoc=B.locations[0]&&B.locations[0].code;
    const l=loc(setupLoc); if(!l){ box.innerHTML=''; return; }
    const sections=[]; B.items.filter(i=>i.active).forEach(i=>{ let s=sections.find(x=>x.name===i.section); if(!s){ s={name:i.section,items:[]}; sections.push(s); } s.items.push(i); });
    box.innerHTML=`<div class="in-filters"><select id="inBySite">${B.locations.map(x=>`<option value="${esc(x.code)}" ${x.code===setupLoc?'selected':''}>${esc(x.name)} (${esc(x.code)})</option>`).join('')}</select>
        <span class="pr-small-t">${plural(l.items.length,'item')} on this site's checklist. "Default" follows the site's kind and equipment.</span></div>
      ${sections.map(s=>`<div class="card pr-card"><h3>${esc(s.name)}</h3>${s.items.map(i=>{
        const on=l.items.includes(i.id), ov=l.overrides[i.id];
        return `<div class="in-cfgitem${on?'':' inactive'}"><div>${on?'✓':'—'} ${esc(i.text)}</div>
          <select data-ov="${i.id}"><option value="" ${ov==null?'selected':''}>Default (${on&&ov==null?'on':ov==null?'off':'…'})</option><option value="1" ${ov===true?'selected':''}>Always on here</option><option value="0" ${ov===false?'selected':''}>Never here</option></select></div>`; }).join('')}</div>`).join('')}`;
    $('inBySite').onchange=e=>{ setupLoc=e.target.value; renderSetup(); };
    box.querySelectorAll('[data-ov]').forEach(s=>s.onchange=async()=>{
      if(await adminSave('override',{location_code:setupLoc,item_id:+s.dataset.ov,include:s.value===''?null:s.value==='1'},'Saved')) renderSetup();
    });
  }
  function setupPeople(){
    const s=B.settings||{}, box=$('inSetup');
    const name=id=>{ const p=B.inspectors.find(x=>x.emp_id===id); return p?p.name:'Employee '+id; };
    let rot=(s.rotation||[]).slice();
    const draw=()=>{
      box.innerHTML=`<div class="card pr-card pr-narrow"><h3>Emails</h3>
        <label>Also send every submitted report to (one email per line)<textarea id="inRecips" rows="3" placeholder="safety@logistics-warehouse.com">${esc((s.recipients||[]).join('\n'))}</textarea></label>
        <p class="hint">Reports always go to the admins and the person who submitted. ${s.mailer_set?'Mailer is connected.':'<b>Mailer not connected yet</b> — see docs/INSPECTIONS_SETUP.md.'}</p>
        <div class="pr-grid2"><label>"Still open" reminder, days before month end<input type="number" id="inRemDays" min="1" max="20" value="${s.reminder_days||5}"></label>
          <label>Corrective actions due after (days)<input type="number" id="inDueDays" min="1" max="120" value="${s.due_days||14}"></label></div>
        <div class="pr-sub">Rotation order <span class="pr-small-t">— used to suggest who gets next month</span></div>
        <ol class="in-rot">${rot.map((id,i)=>`<li>${esc(name(id))} <button type="button" class="in-linkbtn" data-rup="${i}" ${i?'':'disabled'}>↑</button> <button type="button" class="in-linkbtn" data-rdown="${i}" ${i<rot.length-1?'':'disabled'}>↓</button> <button type="button" class="in-linkbtn" data-rdel="${i}">remove</button></li>`).join('')||'<li class="pr-small-t">Nobody yet.</li>'}</ol>
        <div class="in-filters"><select id="inRotAdd"><option value="">Add to rotation…</option>${B.inspectors.filter(p=>!rot.includes(p.emp_id)).map(p=>`<option value="${p.emp_id}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="actions"><button type="button" class="pr-small" id="inSaveSettings">Save</button></div></div>
      <div class="card pr-card pr-narrow"><h3>Inspectors</h3>
        <p class="hint">Everyone on the warehouse manager list (Manager Messages) can inspect. Add anyone else here — e.g. the Trailer Shop lead. They sign in to the Toolkit with their own employee ID and PIN.</p>
        ${(s.extra_inspectors||[]).map(p=>`<div class="in-cfgitem${p.active?'':' inactive'}"><div>${esc(p.name)} <span class="pr-small-t">${p.emp_id}${p.email?' · '+esc(p.email):' · no email'}</span></div>
          <button type="button" class="ghost pr-small" data-xinsp="${p.emp_id}" data-active="${p.active?0:1}" data-email="${esc(p.email||'')}" data-name="${esc(p.name||'')}">${p.active?'Remove':'Add back'}</button></div>`).join('')}
        <div class="pr-grid3"><label>Employee ID<input id="inXId" inputmode="numeric"></label><label>Name (optional)<input id="inXName"></label><label>Email (for reminders)<input id="inXEmail" type="email"></label></div>
        <div class="actions"><button type="button" class="pr-small" id="inXAdd">Add inspector</button></div></div>
      <div class="card pr-card pr-narrow"><h3>Admins</h3>
        ${(s.admins||[]).map(p=>`<div class="in-cfgitem${p.active?'':' inactive'}"><div>${esc(p.name)} <span class="pr-small-t">${p.emp_id}</span></div>
          ${p.emp_id===B.me.emp_id?'<span class="pr-small-t">you</span>':`<button type="button" class="ghost pr-small" data-xadmin="${p.emp_id}" data-active="${p.active?0:1}">${p.active?'Remove':'Add back'}</button>`}</div>`).join('')}
        <div class="in-filters"><select id="inAdminAdd"><option value="">Make an inspector an admin…</option>${B.inspectors.filter(p=>!(s.admins||[]).some(a=>a.emp_id===p.emp_id&&a.active)).map(p=>`<option value="${p.emp_id}">${esc(p.name)}</option>`).join('')}</select></div></div>`;
      box.querySelectorAll('[data-rup]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.rup; [rot[i-1],rot[i]]=[rot[i],rot[i-1]]; draw(); });
      box.querySelectorAll('[data-rdown]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.rdown; [rot[i+1],rot[i]]=[rot[i],rot[i+1]]; draw(); });
      box.querySelectorAll('[data-rdel]').forEach(b=>b.onclick=()=>{ rot.splice(+b.dataset.rdel,1); draw(); });
      $('inRotAdd').onchange=e=>{ if(e.target.value){ rot.push(+e.target.value); draw(); } };
      $('inSaveSettings').onclick=async()=>{
        const d={recipients:$('inRecips').value.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean),reminder_days:+$('inRemDays').value,due_days:+$('inDueDays').value,rotation:rot};
        if(await adminSave('settings',d,'Settings saved')) setupPeople();
      };
      box.querySelectorAll('[data-xinsp]').forEach(b=>b.onclick=async()=>{ if(await adminSave('inspector',{emp_id:+b.dataset.xinsp,active:b.dataset.active==='1',email:b.dataset.email,name:b.dataset.name},'Saved')) setupPeople(); });
      $('inXAdd').onclick=async()=>{ const id=$('inXId').value.replace(/\D/g,''); if(!id){ toast('Enter the employee ID.'); return; }
        if(await adminSave('inspector',{emp_id:+id,name:$('inXName').value.trim(),email:$('inXEmail').value.trim(),active:true},'Inspector added')) setupPeople(); };
      box.querySelectorAll('[data-xadmin]').forEach(b=>b.onclick=async()=>{ if(await adminSave('admin',{emp_id:+b.dataset.xadmin,active:b.dataset.active==='1'},'Saved')) setupPeople(); });
      $('inAdminAdd').onchange=async e=>{ if(e.target.value&&confirm('Make '+e.target.selectedOptions[0].textContent+' an Inspections admin?')&&await adminSave('admin',{emp_id:+e.target.value,active:true},'Admin added')) setupPeople(); };
    };
    draw();
  }

  // ---------------------------------------------------------------- menu visibility, start
  function showNav(on){
    const show=on===undefined?!!(B||ls.get('lwh_inOk',false)||(auth()&&auth().me()&&auth().me().is_manager)):on;
    if(on!==undefined) ls.set('lwh_inOk',on?true:null);
    const nav=$('navInspections'); if(nav) nav.hidden=!show;
  }
  document.addEventListener('click',e=>{ const b=e.target.closest('#inspections [data-intab-go]'); if(b){ tab=b.dataset.intabGo; aLoc=b.dataset.loc||''; A=null; F=null; render(); } });
  window.addEventListener('online',()=>{ if(F&&F.dirty) saveNow(); else setSaveState(); });
  window.addEventListener('offline',setSaveState);
  window.addEventListener('pagehide',()=>{ if(F&&F.dirty) ls.set(draftKey(F.zone.id,F.period),{at:Date.now(),answers:F.answers,notes:F.notes}); });
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden'&&F&&F.dirty) saveNow(); });

  document.addEventListener('DOMContentLoaded',()=>{
    const sec=$(VIEW); if(!sec) return;
    const onShow=()=>{ build(); boot(false); };
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
    showNav(); [1500,4000,9000].forEach(t=>setTimeout(()=>showNav(),t));
  });
  window.LWHInspections={ refresh:()=>boot(true), open:openDetail };
})();
