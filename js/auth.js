// TOOLKIT SIGN-IN (v1.80.0)
// Everyone signs in with their employee ID + 6-digit PIN (setup code from a manager the first time) —
// the same sign-in Messages uses, so signing in once covers both. Sessions last 30 days from last use
// ("Keep me signed in" off = until the tab is closed, for shared computers).
//
// The data side enforces it: the Toolkit's database functions and CSV exports only answer requests
// carrying the session (header x-lwh-session — see sql/toolkit_lock.sql). This file adds that header
// to every Toolkit request to Supabase, shows the sign-in screen, and brings it back if a session
// runs out.
//
// Public without sign-in: the forklift certificate check that the QR on wallet cards opens
// (?view=fcVerify).
(function(){
  const SUPA='https://tjivcqxnkftujceumdtx.supabase.co';
  const API=SUPA+'/rest/v1/rpc/';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const LOCKED_FUNCS=/^https:\/\/tjivcqxnkftujceumdtx\.supabase\.co\/(rest\/v1\/|functions\/v1\/(master-lookup-csv|transaction-history-csv|load-details-csv)(\?|$))/;
  const PUBLIC_VIEWS=['fcVerify'];
  const TK='lwh_whMsgToken', ME='lwh_whMsgMe', KEEP='lwh_whMsgKeep';

  // ---------------------------------------------------------------- storage (shared with Messages)
  const ls={ get(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } },
             set(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };
  const ss={ get(k){ try{ return sessionStorage.getItem(k)||''; }catch(e){ return ''; } },
             set(k,v){ try{ v?sessionStorage.setItem(k,v):sessionStorage.removeItem(k); }catch(e){} } };
  const token=()=>ls.get(TK)||ss.get(TK)||'';
  const keep=()=>ls.get(KEEP)!==false;
  function saveToken(t,keepIt){
    ls.set(KEEP,!!keepIt);
    if(keepIt){ ls.set(TK,t); ss.set(TK,''); } else { ss.set(TK,t); ls.set(TK,null); }
  }
  function clearSession(){ ls.set(TK,null); ss.set(TK,''); ls.set(ME,null); try{ if(window.caches) caches.delete('lwh-wh-msg-files'); }catch(e){} }
  const me=()=>ls.get(ME);

  // ---------------------------------------------------------------- add the session to Toolkit requests
  const realFetch=window.fetch.bind(window);
  let gateShown=false;
  window.fetch=function(input,init){
    try{
      const url=typeof input==='string'?input:(input&&input.url)||'';
      const t=token();
      if(t&&LOCKED_FUNCS.test(url)){
        if(input instanceof Request&&!init){ const h=new Headers(input.headers); h.set('x-lwh-session',t); input=new Request(input,{headers:h}); }
        else { init=Object.assign({},init); const h=new Headers(init.headers||(input instanceof Request?input.headers:undefined)); h.set('x-lwh-session',t); init.headers=h; }
      }
      const p=realFetch(input,init);
      if(LOCKED_FUNCS.test(url)){
        return p.then(res=>{
          if(res.status===401) res.clone().text().then(b=>{ if(/sign_in_required/.test(b)) requireSignIn('Please sign in to keep using the Toolkit.'); }).catch(()=>{});
          return res;
        });
      }
      return p;
    }catch(e){ return realFetch(input,init); }
  };

  // ---------------------------------------------------------------- sign-in screen
  async function rpc(name,args){
    const r=await realFetch(API+name,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(args||{}),cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function buildGate(msg){
    let g=document.getElementById('authGate');
    if(!g){
      g=document.createElement('div'); g.id='authGate'; g.className='auth-gate no-print';
      g.innerHTML=`<div class="auth-box" role="dialog" aria-modal="true" aria-labelledby="authTitle">
        <div class="auth-brand"><img src="./icons/company-logo.png" alt="" onerror="this.remove()"><div><b>Logistics Warehouse</b><span>Warehouse Toolkit</span></div></div>
        <h2 id="authTitle">Sign in</h2>
        <p class="auth-msg" id="authMsg"></p>
        <label>Employee ID<input id="authId" inputmode="numeric" autocomplete="username" maxlength="6" placeholder="5-digit ID"></label>
        <div id="authPinBox"><label>6-digit PIN<input id="authPin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" placeholder="••••••"></label></div>
        <div id="authSetupBox" hidden>
          <label>Setup code from your manager<input id="authCode" autocapitalize="characters" spellcheck="false" autocomplete="off" placeholder="8 letters and numbers"></label>
          <div class="auth-two"><label>New 6-digit PIN<input id="authNew1" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label>
          <label>Type it again<input id="authNew2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label></div>
        </div>
        <label class="auth-check"><input type="checkbox" id="authKeep"> Keep me signed in on this device <span>(uncheck on a shared computer)</span></label>
        <div class="auth-err" id="authErr" hidden></div>
        <button type="button" id="authGo" class="auth-go">Sign In</button>
        <button type="button" id="authToggle" class="auth-link">First time? Set up your PIN</button>
        <p class="auth-help">Your PIN is the same one you use for Messages. Forgot it, or no setup code yet? Ask a warehouse manager — they can give you a new code.</p>
      </div>`;
      document.body.appendChild(g);
      const $=id=>document.getElementById(id);
      let setup=false;
      $('authKeep').checked=keep();
      $('authId').value=(ls.get('lwh_whMsgLastId')||'');
      const setMode=on=>{ setup=on; $('authSetupBox').hidden=!on; $('authPinBox').hidden=on; $('authGo').textContent=on?'Create PIN & Sign In':'Sign In'; $('authToggle').textContent=on?'I already have a PIN':'First time? Set up your PIN'; err(''); };
      const err=m=>{ $('authErr').textContent=m||''; $('authErr').hidden=!m; };
      $('authToggle').onclick=()=>setMode(!setup);
      const go=async()=>{
        const id=($('authId').value||'').replace(/\D/g,'');
        if(!/^\d{4,6}$/.test(id)) return err('Enter your employee ID.');
        const b=$('authGo'); b.disabled=true; const label=b.textContent; b.textContent='Signing in…';
        try{
          let r;
          if(setup){
            const code=$('authCode').value.trim(), a=$('authNew1').value.trim(), c=$('authNew2').value.trim();
            if(!code){ err('Enter the setup code from your manager.'); return; }
            if(!/^\d{6}$/.test(a)){ err('Your new PIN must be exactly 6 digits.'); return; }
            if(a!==c){ err('The two PINs do not match.'); return; }
            r=await rpc('emp_create_pin',{p_emp_id:Number(id),p_setup_code:code,p_pin:a});
          }else{
            const pin=$('authPin').value.trim();
            if(!/^\d{6}$/.test(pin)){ err('Enter your 6-digit PIN.'); return; }
            r=await rpc('emp_login',{p_emp_id:Number(id),p_pin:pin});
          }
          if(!r.ok){ err(r.error+(setup?'':' First time? Tap “Set up your PIN”.')); return; }
          const keepIt=$('authKeep').checked;
          saveToken(r.token,keepIt);
          ls.set('lwh_whMsgLastId',keepIt?id:'');
          try{ const m=await rpc('whm_me',{p_token:r.token}); if(m.ok){ ls.set(ME,{emp_id:m.emp_id,name:m.name,first_name:m.first_name,location:m.location,is_manager:m.is_manager}); ls.set('lwh_userName',m.name); } }catch(e){}
          b.textContent='Signed in';
          location.reload();
        }catch(e){ err('Could not reach the server. Check your connection and try again.'); }
        finally{ if(b.textContent!=='Signed in'){ b.disabled=false; b.textContent=label; } }
      };
      $('authGo').onclick=go;
      g.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target.tagName==='INPUT') go(); });
    }
    document.getElementById('authMsg').textContent=msg||'Sign in with your employee ID and PIN to use the Toolkit.';
    g.hidden=false; document.documentElement.classList.add('auth-locked'); gateShown=true;
    setTimeout(()=>{ const i=document.getElementById(document.getElementById('authId').value?'authPin':'authId'); if(i) i.focus(); },50);
  }
  function requireSignIn(msg){
    if(isPublicView()&&!token()) return;
    if(token()&&!msg) return;
    clearSession();
    if(document.body) buildGate(msg); else document.addEventListener('DOMContentLoaded',()=>buildGate(msg));
  }
  function isPublicView(){
    try{ const v=new URLSearchParams(location.search).get('view'); return PUBLIC_VIEWS.includes(v||''); }catch(e){ return false; }
  }
  async function signOut(){
    if(!confirm('Sign out of the Warehouse Toolkit on this device?')) return;
    const t=token(); clearSession();
    try{ await rpc('emp_logout',{p_token:t}); }catch(e){}
    location.replace(location.pathname);
  }

  // ---------------------------------------------------------------- signed-in strip (menu + Settings)
  function addSignedInUI(){
    const m=me(); if(!m||!token()) return;
    const nav=document.querySelector('.nav-btn[data-view="settings"]');
    if(nav&&!document.getElementById('authNavOut')){
      const b=document.createElement('button'); b.type='button'; b.id='authNavOut'; b.className='nav-btn auth-nav-out';
      b.innerHTML='<svg class="icon" viewBox="0 0 24 24"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>Sign Out <small>'+esc(m.first_name||m.name||'')+'</small>';
      b.onclick=signOut; nav.insertAdjacentElement('afterend',b);
    }
    const grid=document.querySelector('#settings .settings-grid');
    if(grid&&!document.getElementById('authCard')){
      const c=document.createElement('div'); c.className='card'; c.id='authCard';
      c.innerHTML=`<h2>Signed In</h2><p><b>${esc(m.name)}</b> · employee ${esc(m.emp_id)}${m.is_manager?' · warehouse manager':''}</p>
        <p class="hint">${keep()?'Stays signed in on this device for 30 days from the last time it’s used.':'Signed in until this tab is closed.'} Your PIN is the same one Messages uses.</p>
        <div class="actions"><button type="button" class="ghost" id="authSettingsOut">Sign Out</button></div>`;
      grid.insertBefore(c,grid.firstChild);
      document.getElementById('authSettingsOut').onclick=signOut;
    }
  }

  // ---------------------------------------------------------------- start
  window.LWHAuth={ token, me, signOut, requireSignIn, isSignedIn:()=>!!token(), isPublicView };
  const m0=me(); if(m0&&m0.name&&token()){ try{ localStorage.setItem('lwh_userName',JSON.stringify(m0.name)); }catch(e){} }
  // On the public certificate-check page, any other tool asks for sign-in first.
  document.addEventListener('click',e=>{
    if(token()) return;
    const v=e.target.closest&&e.target.closest('[data-view]');
    if(v&&!PUBLIC_VIEWS.includes(v.dataset.view)){ e.preventDefault(); e.stopImmediatePropagation(); buildGate(); }
  },true);
  document.addEventListener('DOMContentLoaded',()=>{
    if(!token()){ if(!isPublicView()) buildGate(); return; }
    addSignedInUI();
    // Check the session is still good (skip when offline so cached tools keep working).
    if(navigator.onLine){
      rpc('whm_me',{p_token:token()}).then(r=>{
        if(r&&r.ok===false&&r.error==='signed_out') requireSignIn('Your sign-in ran out. Please sign in again.');
        else if(r&&r.ok){ ls.set(ME,{emp_id:r.emp_id,name:r.name,first_name:r.first_name,location:r.location,is_manager:r.is_manager}); }
      }).catch(()=>{});
    }
  });
})();
