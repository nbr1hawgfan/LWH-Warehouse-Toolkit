/* MANAGER SIGN-IN FOR MANAGER TOOLS (v1.83.0) — replaces the shared manager passcode.
   Missed Punches, Forklift Certs, Outbound (records + overrides) and Load Tag Scan (records + clear
   device) ask for a manager here.
   - Signed in to the Toolkit as someone on the warehouse manager list → nothing to type.
   - Otherwise (a loader's phone, a shared PC) → the manager types THEIR employee ID + 6-digit PIN,
     the same sign-in as the Toolkit and Messages. It's sent as 'pin:<id>:<pin>' in the existing
     p_passcode argument and checked by toolkit_manager_check() (sql/manager_pin_signin.sql), with
     the same 5-tries / 15-minute lockout.
   An approval typed on a device is kept in memory for this tab only (never saved to the device).
   Markup: put <div data-mgrcred-slot="xx"></div> where the fields go; inputs get ids xxMgrId, xxMgrPin. */
window.LWHMgr=(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  let mem='';
  try{ sessionStorage.removeItem('lwh_mgrPass'); }catch(e){}   // old shared passcode, no longer used
  const me=()=>{ const a=window.LWHAuth; return (a&&a.isSignedIn()&&a.me())||null; };
  const isMgr=()=>!!(me()&&me().is_manager);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  function fields(p){
    return `<div class="mgr-cred" data-mgrcred="${esc(p)}">
      <div class="mgr-cred-me" hidden><svg class="icon" viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg><span>Signed in as <b></b> (manager) — no code needed.</span></div>
      <div class="mgr-cred-pin">
        <div class="mgr-cred-hint">Manager: enter <b>your</b> employee ID and 6-digit PIN (same as the Toolkit sign-in).</div>
        <div class="mgr-cred-row">
          <label>Manager employee ID<input id="${esc(p)}MgrId" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="5-digit ID"></label>
          <label>6-digit PIN<input id="${esc(p)}MgrPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="••••••"></label>
        </div>
      </div>
    </div>`;
  }
  function fill(){
    document.querySelectorAll('[data-mgrcred-slot]').forEach(s=>{ s.outerHTML=fields(s.dataset.mgrcredSlot); });
  }
  function refresh(){
    const m=isMgr(), who=me();
    document.querySelectorAll('[data-mgrcred]').forEach(box=>{
      box.querySelector('.mgr-cred-me').hidden=!m;
      box.querySelector('.mgr-cred-pin').hidden=m;
      if(m) box.querySelector('.mgr-cred-me b').textContent=(who&&(who.name||who.first_name))||'you';
    });
  }
  // → {ok:true, cred:''|'pin:…'} or {ok:false, msg}
  function read(p){
    refresh();
    if(isMgr()) return {ok:true,cred:''};
    const idEl=$(p+'MgrId'), pinEl=$(p+'MgrPin');
    const id=String(idEl&&idEl.value||'').replace(/\D/g,''), pin=String(pinEl&&pinEl.value||'').trim();
    if(!id){ if(idEl) idEl.focus(); return {ok:false,msg:'Enter the manager\'s employee ID.'}; }
    if(!/^\d{6}$/.test(pin)){ if(pinEl) pinEl.focus(); return {ok:false,msg:'Enter the manager\'s 6-digit PIN.'}; }
    return {ok:true,cred:`pin:${id}:${pin}`};
  }
  function clear(p){ ['MgrId','MgrPin'].forEach(s=>{ const e=$(p+s); if(e) e.value=''; }); }
  function onEnter(p,fn){ ['MgrId','MgrPin'].forEach(s=>{ const e=$(p+s); if(e) e.addEventListener('keydown',ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); fn(); } }); }); }
  const ERR={
    not_manager:'Managers only — this sign-in isn\'t on the warehouse manager list.',
    bad_pin:'Employee ID or PIN not recognized, or not on the warehouse manager list.',
    pin_locked:'Too many wrong tries for that employee ID — wait 15 minutes, then try again.',
    bad_passcode:'That isn\'t right.',
    locked:'Too many wrong tries — locked for a few minutes.',
    not_set_up:'Managers only — sign in as a manager.'
  };
  const isAuthError=e=>Object.prototype.hasOwnProperty.call(ERR,e);
  const errText=e=>ERR[e]||'Couldn\'t check manager access.';

  fill();
  document.addEventListener('DOMContentLoaded',()=>{
    refresh();
    // The manager flag arrives after sign-in; re-check a few times, then every minute.
    [1500,4000,9000].forEach(t=>setTimeout(refresh,t));
    setInterval(refresh,60000);
  });
  return { isMgr, me, fields, refresh, read, clear, onEnter, errText, isAuthError,
           get:()=>mem, set:v=>{ mem=v||''; }, forget:()=>{ mem=''; } };
})();
