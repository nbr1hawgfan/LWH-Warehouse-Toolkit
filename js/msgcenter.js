/* Manager Message Center inside the Toolkit.
   Managers on the warehouse manager list get a "Manager Messages" screen (menu + a button in Messages).
   It hosts ./messages/?embed=1, which uses this Toolkit sign-in — no second sign-in. Everyone else never sees it. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const API='https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const SRC='./messages/?embed=1';
  let loaded=false, lastTok='';
  const auth=()=>window.LWHAuth||null;
  const isMgr=()=>{ const a=auth(); const m=a&&a.isSignedIn()&&a.me(); return !!(m&&m.is_manager); };

  function setBadge(n){
    ['wmMgrBadge','navMcBadge'].forEach(id=>{ const b=$(id); if(b){ b.textContent=n; b.hidden=!n; } });
  }
  function showForManagers(){
    const on=isMgr();
    const nav=$('navMsgCenter'); if(nav) nav.hidden=!on;
    if(!on&&$('msgCenter')&&$('msgCenter').classList.contains('active')&&window.LWHUI) LWHUI.show('messages');
  }
  function size(){
    const f=$('mcFrame'); if(!f||!$('msgCenter').classList.contains('active')) return;
    const top=f.getBoundingClientRect().top+window.scrollY;
    f.style.height=Math.max(460,window.innerHeight-top-12)+'px';
  }
  function onShow(){
    if(!isMgr()){ if(window.LWHUI) LWHUI.show('messages'); return; }
    const f=$('mcFrame'), tok=auth().token();
    if(!loaded||tok!==lastTok){ f.src=SRC+'&r='+Date.now(); loaded=true; lastTok=tok; }
    requestAnimationFrame(size);
  }
  async function peek(){
    if(!isMgr()){ setBadge(0); return; }
    try{
      const r=await fetch(API+'whm_mgr_inbox',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({p_token:auth().token(),p_view:'open',p_days:7}),cache:'no-store'}).then(r=>r.ok?r.json():null);
      if(r&&r.ok!==false) setBadge(r.unread||0);
    }catch(e){}
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const sec=$('msgCenter'); if(!sec) return;
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
    showForManagers(); peek();
    // Messages fills in the manager flag after sign-in; re-check a few times, then every minute.
    [1500,4000,9000].forEach(t=>setTimeout(()=>{ showForManagers(); peek(); },t));
    setInterval(()=>{ showForManagers(); if(!document.hidden) peek(); },60000);
  });
  window.addEventListener('resize',size);
  window.addEventListener('message',e=>{
    if(e.origin!==location.origin||!e.data||e.data.lwhmc!=='unread') return;
    setBadge(e.data.n||0);
  });
  window.LWHMsgCenter={ peek, refreshAccess:showForManagers };
})();
