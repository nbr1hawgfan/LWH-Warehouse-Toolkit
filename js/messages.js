// MESSAGES (v1.79.0) — messages from warehouse managers, and messages to them.
// - Sign in once with employee ID + 6-digit PIN (first time: setup code from a manager). Same PIN
//   system as the other company apps that use employee sign-in.
// - "Keep me signed in" can be turned off on shared computers (then it lasts until the tab closes).
// - Managers can attach a PDF or photo; files are saved on the device when the message arrives so
//   they open with no signal. Messages can be read out loud.
// - Employees message managers with a topic button, optional text and a photo. All warehouse
//   managers see it in the Warehouse Message Center (./messages/).
// Backend: Supabase whm_* functions + emp_login/emp_create_pin (sql/warehouse_messages.sql) and the
// msg-file Edge Function (shared with the Driver Toolkit).
(function(){
  const API='https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const FILE_API='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/msg-file';
  const FILE_CACHE='lwh-wh-msg-files';
  const PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const TOPICS=['Need help','Can’t find item','Equipment problem','Safety concern','Running late','Call me'];
  const POLL_MS=30000;
  const $=id=>document.getElementById(id);
  const safe=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const toast=m=>{ try{ window.LWHUI&&LWHUI.toast(m); }catch(e){} };
  const S=window.LWHStorage||{get:(k,d)=>d,set(){},remove(){}};
  const ss={get(k){ try{ return sessionStorage.getItem('lwh_'+k)||''; }catch(e){ return ''; } }, set(k,v){ try{ v?sessionStorage.setItem('lwh_'+k,v):sessionStorage.removeItem('lwh_'+k); }catch(e){} }};
  const store={
    get token(){ return S.get('whMsgToken','')||ss.get('whMsgToken'); },
    set token(v){ if(!v){ S.remove('whMsgToken'); ss.set('whMsgToken',''); return; } if(store.keep){ S.set('whMsgToken',v); ss.set('whMsgToken',''); } else { ss.set('whMsgToken',v); S.remove('whMsgToken'); } },
    get keep(){ return S.get('whMsgKeep',true)!==false; },
    set keep(v){ S.set('whMsgKeep',!!v); },
    get me(){ return S.get('whMsgMe',null); },
    set me(v){ v?S.set('whMsgMe',v):S.remove('whMsgMe'); },
    get seen(){ return S.get('whMsgSeen',[]); },
    set seen(v){ S.set('whMsgSeen',v.slice(-200)); },
    get autoRead(){ return S.get('whMsgAutoRead',false)===true; },
    set autoRead(v){ S.set('whMsgAutoRead',!!v); },
    get chime(){ return S.get('whMsgChime',true)!==false; },
    set chime(v){ S.set('whMsgChime',!!v); }
  };
  let messages=[], sentMsgs=[], pollTimer=null, loading=false, firstLoad=true, compose={replyTo:null,topic:'',photo:null};

  async function rpc(name,args){
    const r=await fetch(API+name,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(args||{}),cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }

  // ---------------------------------------------------------------- speech + chime
  const speechOk='speechSynthesis' in window;
  let voice=null;
  function pickVoice(){ if(!speechOk) return; const vs=speechSynthesis.getVoices()||[]; voice=vs.find(v=>/en[-_]US/i.test(v.lang)&&/google|samsung|microsoft/i.test(v.name))||vs.find(v=>/en[-_]US/i.test(v.lang))||vs.find(v=>/^en/i.test(v.lang))||null; }
  if(speechOk){ pickVoice(); speechSynthesis.addEventListener&&speechSynthesis.addEventListener('voiceschanged',pickVoice); }
  const canSpeakNow=()=>speechOk&&(!navigator.userActivation||navigator.userActivation.hasBeenActive);
  function chime(){
    if(!store.chime) return Promise.resolve();
    try{ const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return Promise.resolve();
      const ctx=new AC(), t=ctx.currentTime;
      [[880,0],[1175,0.18]].forEach(([f,d])=>{ const o=ctx.createOscillator(), g=ctx.createGain(); o.frequency.value=f;
        g.gain.setValueAtTime(0.0001,t+d); g.gain.exponentialRampToValueAtTime(0.35,t+d+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+d+0.16);
        o.connect(g).connect(ctx.destination); o.start(t+d); o.stop(t+d+0.18); });
      return new Promise(res=>setTimeout(()=>{ ctx.close().catch(()=>{}); res(); },450));
    }catch(e){ return Promise.resolve(); }
  }
  function spokenText(m){
    let t=`Message from ${m.sender_name}.`;
    if(m.in_reply_to) t+=` Answer to your message${m.in_reply_to.topic?' about '+m.in_reply_to.topic:''}.`;
    if(m.body) t+=` ${m.body}`;
    const files=(m.attachments||[]).filter(a=>!a.removed);
    if(files.length) t+=` . ${files.length===1?'One attachment':files.length+' attachments'}: ${files.map(a=>a.name.replace(/\.[a-z0-9]+$/i,'')).join(', ')}.`;
    if(m.msg_type==='ack'&&!m.acked_at) t+=' . Please tap Got it.';
    if(m.msg_type==='reply'&&!m.replied_at){ const o=m.reply_options||[]; t+=` . Reply options: ${o.length>1?o.slice(0,-1).join(', ')+', or '+o[o.length-1]:o[0]}.`; }
    return t;
  }
  function speak(list){
    if(!speechOk||!list.length) return;
    speechSynthesis.cancel();
    list.forEach(m=>{ const u=new SpeechSynthesisUtterance(spokenText(m)); u.lang='en-US'; if(voice) u.voice=voice; u.rate=0.95; speechSynthesis.speak(u); });
    list.forEach(m=>{ if(m.id&&!m.read_at) mark(m,'read',null,true); });
  }
  const stopSpeaking=()=>{ if(speechOk) speechSynthesis.cancel(); };

  // ---------------------------------------------------------------- data
  async function refresh(opts={}){
    if(!store.token||loading) return;
    if(!navigator.onLine){ setStatus('Offline — messages will update when you have signal.'); return; }
    loading=true;
    try{
      const r=await rpc('whm_inbox',{p_token:store.token});
      if(!r.ok){ if(r.error==='signed_out') return signedOut('Your sign-in ran out. Please sign in again.'); throw new Error(r.error); }
      const before=new Set(store.seen);
      messages=r.messages||[]; sentMsgs=r.sent||[];
      const fresh=messages.filter(m=>!before.has(m.id));
      store.seen=[...before,...fresh.map(m=>m.id)];
      setStatus('Updated '+new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}));
      render();
      if(!firstLoad&&fresh.length){
        if(store.autoRead&&canSpeakNow()) chime().then(()=>speak(fresh.slice().reverse()));
        else { chime(); toast(fresh.length===1?'New message from a manager':`${fresh.length} new messages`); }
      }else if(firstLoad&&opts.speakUnread&&store.autoRead&&canSpeakNow()){
        const unread=messages.filter(m=>!m.read_at); if(unread.length) chime().then(()=>speak(unread.slice().reverse()));
      }
      firstLoad=false;
      prefetchFiles();
    }catch(e){ setStatus('Could not check messages ('+(e.message||'network')+'). Trying again shortly.'); }
    finally{ loading=false; }
  }
  async function mark(m,action,reply,quiet){
    try{
      const r=await rpc('whm_mark',{p_token:store.token,p_message_id:m.id,p_action:action,p_reply:reply||null});
      if(!r.ok){ if(r.error==='signed_out') return signedOut(); if(!quiet) toast(r.error||'Could not save'); return; }
      const now=new Date().toISOString();
      if(action==='read') m.read_at=m.read_at||now;
      if(action==='open'){ m.opened_at=m.opened_at||now; m.read_at=m.read_at||now; }
      if(action==='ack'){ m.acked_at=now; m.read_at=m.read_at||now; }
      if(action==='reply'){ m.reply=reply; m.replied_at=now; m.acked_at=m.acked_at||now; m.read_at=m.read_at||now; }
      render();
      if(!quiet&&(action==='ack'||action==='reply')) toast(action==='reply'?'Reply sent':'Your manager will see you got it');
    }catch(e){ if(!quiet) toast('No signal — try again in a minute'); }
  }

  // ---------------------------------------------------------------- sign in
  function showLoginErr(msg){ const e=$('wmLoginErr'); if(e){ e.textContent=msg||''; e.hidden=!msg; } }
  function signedOut(msg){
    store.token=''; store.me=null; messages=[]; sentMsgs=[]; stopPoll(); stopSpeaking(); closeCompose(); closeViewer();
    try{ if(window.caches) caches.delete(FILE_CACHE); }catch(e){}
    render(); if(msg) showLoginErr(msg);
  }
  async function afterSignIn(token){
    store.keep=$('wmKeep').checked; store.token=token; store.seen=[]; firstLoad=true;
    try{ const me=await rpc('whm_me',{p_token:token}); if(me.ok) store.me={emp_id:me.emp_id,name:me.name,first_name:me.first_name,location:me.location,is_manager:me.is_manager}; }catch(e){}
    ['wmPin','wmSetupCode','wmNewPin','wmNewPin2'].forEach(id=>{ if($(id)) $(id).value=''; });
    showLoginErr(''); render(); startPoll(); refresh();
  }
  const cleanId=()=>String($('wmEmpId').value||'').replace(/\D/g,'');
  async function doLogin(){
    const id=cleanId(), pin=($('wmPin').value||'').trim();
    if(!/^\d{4,6}$/.test(id)||!/^\d{6}$/.test(pin)) return showLoginErr('Enter your employee ID and your 6-digit PIN.');
    const b=$('wmLoginBtn'); b.disabled=true; b.textContent='Signing in…';
    try{
      const r=await rpc('emp_login',{p_emp_id:Number(id),p_pin:pin});
      if(!r.ok) return showLoginErr(r.error+' First time? Tap “First time sign-in”.');
      S.set('whMsgLastId',$('wmKeep').checked?id:''); await afterSignIn(r.token);
    }catch(e){ showLoginErr('No signal — try again in a minute.'); }
    finally{ b.disabled=false; b.textContent='Sign In'; }
  }
  async function doSetup(){
    const id=cleanId(), code=($('wmSetupCode').value||'').trim(), p1=($('wmNewPin').value||'').trim(), p2=($('wmNewPin2').value||'').trim();
    if(!id||!code) return showLoginErr('Enter your employee ID and the setup code from your manager.');
    if(!/^\d{6}$/.test(p1)) return showLoginErr('Your new PIN must be exactly 6 digits.');
    if(p1!==p2) return showLoginErr('The two PINs do not match.');
    const b=$('wmSetupBtn'); b.disabled=true; b.textContent='Saving…';
    try{
      const r=await rpc('emp_create_pin',{p_emp_id:Number(id),p_setup_code:code,p_pin:p1});
      if(!r.ok) return showLoginErr(r.error);
      S.set('whMsgLastId',$('wmKeep').checked?id:''); setSetupMode(false); await afterSignIn(r.token); toast('PIN saved. You are signed in.');
    }catch(e){ showLoginErr('No signal — try again in a minute.'); }
    finally{ b.disabled=false; b.textContent='Create PIN & Sign In'; }
  }
  function setSetupMode(on){ $('wmSetupBox').hidden=!on; $('wmPinBox').hidden=on; $('wmSetupToggle').textContent=on?'I already have a PIN':'First time sign-in'; showLoginErr(''); }
  async function doLogout(){
    if(!confirm('Sign out of Messages on this device?')) return;
    const t=store.token; signedOut();
    try{ await rpc('emp_logout',{p_token:t}); }catch(e){}
  }

  // ---------------------------------------------------------------- polling
  function startPoll(){ stopPoll(); if(store.token) pollTimer=setInterval(()=>{ if(document.visibilityState==='visible') refresh(); },POLL_MS); }
  function stopPoll(){ if(pollTimer){ clearInterval(pollTimer); pollTimer=null; } }
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&store.token) refresh(); });
  window.addEventListener('online',()=>refresh());

  // ---------------------------------------------------------------- files (offline cache + viewer)
  const cacheKey=id=>new URL('./__whmsgfile/'+id,location.href).href;
  async function cachedFile(id){ try{ if(!window.caches) return null; const c=await caches.open(FILE_CACHE); const r=await c.match(cacheKey(id)); return r?await r.blob():null; }catch(e){ return null; } }
  async function downloadFile(id){
    const r=await fetch(FILE_API+'?action=url',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({token:store.token,id})});
    const j=await r.json().catch(()=>({ok:false,error:'HTTP '+r.status}));
    if(!j.ok){ if(j.error==='signed_out') signedOut('Your sign-in ran out. Please sign in again.'); throw new Error(j.error||'Could not get the file'); }
    const f=await fetch(j.url,{cache:'no-store'}); if(!f.ok) throw new Error('Download failed');
    const blob=await f.blob();
    try{ if(window.caches){ const c=await caches.open(FILE_CACHE); await c.put(cacheKey(id),new Response(blob,{headers:{'Content-Type':j.mime||blob.type}})); } }catch(e){}
    return blob;
  }
  const getFile=async id=>(await cachedFile(id))||downloadFile(id);
  let prefetching=false;
  async function prefetchFiles(){
    if(prefetching||!navigator.onLine||!window.caches) return; prefetching=true;
    try{
      const keep=new Set();
      for(const a of [...messages,...sentMsgs].flatMap(m=>(m.attachments||[]).filter(a=>!a.removed))){
        keep.add(cacheKey(a.id));
        if(!(await cachedFile(a.id))){ try{ await downloadFile(a.id); }catch(e){} }
        const el=document.querySelector(`[data-wm-saved="${a.id}"]`); if(el) el.textContent='Saved on this device';
      }
      const c=await caches.open(FILE_CACHE); (await c.keys()).forEach(k=>{ if(!keep.has(k.url)) c.delete(k); });
    }catch(e){} finally{ prefetching=false; }
  }
  let viewerZoom=1, viewerDoc=null, viewerUrl=null;
  function loadPdfJs(){
    if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=PDFJS_URL; s.onload=()=>{ pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER; res(pdfjsLib); }; s.onerror=()=>rej(new Error('PDF viewer did not load')); document.head.appendChild(s); });
  }
  async function openFile(id,name,mime,msgId){
    const body=$('wmViewerBody');
    $('wmViewerName').textContent=name||'File'; body.innerHTML='<p class="wm-viewer-note">Opening…</p>'; $('wmViewer').hidden=false; document.body.classList.add('wm-viewer-open');
    viewerZoom=1; viewerDoc=null;
    try{
      const blob=await getFile(id);
      if(msgId){ const m=messages.find(x=>x.id===msgId); if(m&&!m.opened_at) mark(m,'open',null,true); }
      if(viewerUrl) URL.revokeObjectURL(viewerUrl); viewerUrl=URL.createObjectURL(blob);
      if((mime||blob.type)==='application/pdf'){
        const lib=await loadPdfJs();
        viewerDoc=await lib.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;
        await renderPdf();
      }else{ body.innerHTML=`<img class="wm-viewer-img" src="${viewerUrl}" alt="">`; applyImgZoom(); }
    }catch(e){ body.innerHTML=`<p class="wm-viewer-note">Could not open this file. ${safe(e.message||'')}<br>${navigator.onLine?'':'You are offline and it was not saved on this device yet.'}</p>`; }
  }
  async function renderPdf(){
    const body=$('wmViewerBody'); if(!viewerDoc) return;
    const width=Math.min(body.clientWidth-16,1400)*viewerZoom, dpr=Math.min(window.devicePixelRatio||1,2);
    body.innerHTML='';
    for(let i=1;i<=viewerDoc.numPages;i++){
      const page=await viewerDoc.getPage(i), vp1=page.getViewport({scale:1}), vp=page.getViewport({scale:width/vp1.width*dpr});
      const cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height; cv.style.width=(vp.width/dpr)+'px'; cv.className='wm-viewer-page';
      body.appendChild(cv); await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
    }
  }
  function applyImgZoom(){ const img=document.querySelector('.wm-viewer-img'); if(img) img.style.width=(100*viewerZoom)+'%'; }
  function zoomViewer(f){ viewerZoom=Math.max(0.5,Math.min(4,viewerZoom*f)); if(viewerDoc) renderPdf(); else applyImgZoom(); }
  function closeViewer(){ const v=$('wmViewer'); if(!v) return; v.hidden=true; document.body.classList.remove('wm-viewer-open'); $('wmViewerBody').innerHTML=''; viewerDoc=null; if(viewerUrl){ URL.revokeObjectURL(viewerUrl); viewerUrl=null; } }

  // ---------------------------------------------------------------- message a manager
  function renderTopics(){ $('wmCmpTopics').innerHTML=TOPICS.map(t=>`<button type="button" class="wm-topic${compose.topic===t?' on':''}" data-wm-topic="${safe(t)}">${safe(t)}</button>`).join(''); }
  function renderPhoto(){ const p=$('wmCmpPhotoPrev'); if(compose.photo){ p.hidden=false; $('wmCmpPhotoImg').src=compose.photo.url; } else p.hidden=true; }
  function openCompose(replyTo){
    compose.replyTo=replyTo?replyTo.id:null;
    $('wmCmpTitle').textContent=replyTo?`Reply to ${replyTo.sender_name}`:'Message a Manager';
    $('wmCmpCtx').hidden=!replyTo; if(replyTo) $('wmCmpCtx').textContent='“'+(replyTo.body||'').slice(0,140)+'”';
    $('wmCmpErr').hidden=true; renderTopics(); renderPhoto();
    $('wmCompose').hidden=false; $('wmCompose').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function closeCompose(){ const c=$('wmCompose'); if(!c) return; c.hidden=true; compose={replyTo:null,topic:'',photo:null}; $('wmCmpText').value=''; $('wmCmpPhoto').value=''; }
  async function shrinkPhoto(file){
    const url=URL.createObjectURL(file);
    try{
      const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error('Could not read that photo')); i.src=url; });
      const k=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
      const cv=document.createElement('canvas'); cv.width=Math.round(img.naturalWidth*k); cv.height=Math.round(img.naturalHeight*k);
      cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
      return await new Promise(res=>cv.toBlob(res,'image/jpeg',0.8));
    }finally{ URL.revokeObjectURL(url); }
  }
  async function pickPhoto(e){ const f=e.target.files&&e.target.files[0]; if(!f) return; try{ const blob=await shrinkPhoto(f); compose.photo={blob,url:URL.createObjectURL(blob)}; renderPhoto(); }catch(err){ toast(err.message); } }
  async function sendCompose(){
    const err=$('wmCmpErr'), text=$('wmCmpText').value.trim(); err.hidden=true;
    if(!compose.topic&&!text&&!compose.photo){ err.textContent='Tap a topic or type a message.'; err.hidden=false; return; }
    if(!navigator.onLine){ err.textContent='No signal right now. Try again in a minute, or find a manager.'; err.hidden=false; return; }
    const b=$('wmCmpSend'); b.disabled=true; b.textContent='Sending…';
    try{
      let files=null;
      if(compose.photo){
        const up=await fetch(FILE_API+'?action=upload',{method:'POST',headers:{apikey:KEY,'Content-Type':'image/jpeg','x-msg-token':store.token,'x-file-name':encodeURIComponent('photo-'+new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')+'.jpg')},body:compose.photo.blob});
        const uj=await up.json().catch(()=>({ok:false,error:'HTTP '+up.status}));
        if(!uj.ok){ if(uj.error==='signed_out') return signedOut('Your sign-in ran out. Please sign in again.'); throw new Error(uj.error||'Photo did not upload'); }
        files=[uj.id];
      }
      const r=await rpc('whm_emp_send',{p_token:store.token,p_topic:compose.topic||'',p_body:text,p_reply_to:compose.replyTo,p_attachments:files});
      if(!r.ok){ if(r.error==='signed_out') return signedOut('Your sign-in ran out. Please sign in again.'); throw new Error(r.error); }
      closeCompose(); toast('Sent to managers'); refresh();
    }catch(e2){ err.textContent=(e2.message||'Could not send')+'. Try again, or find a manager.'; err.hidden=false; }
    finally{ b.disabled=false; b.textContent='Send to Managers'; }
  }

  // ---------------------------------------------------------------- render
  function setStatus(t){ if($('wmStatus')) $('wmStatus').textContent=t||''; }
  function ago(iso){
    const d=new Date(iso), s=(Date.now()-d)/1000;
    if(s<60) return 'just now'; if(s<3600) return Math.floor(s/60)+' min ago';
    const today=new Date(), t=d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
    if(d.toDateString()===today.toDateString()) return 'Today '+t;
    const y=new Date(today); y.setDate(y.getDate()-1); if(d.toDateString()===y.toDateString()) return 'Yesterday '+t;
    return d.toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'})+' '+t;
  }
  const needsAction=m=>(m.msg_type==='ack'&&!m.acked_at)||(m.msg_type==='reply'&&!m.replied_at);
  function fileBtn(a,msgId){
    if(a.removed) return `<span class="wm-file wm-file-gone">${safe(a.name)} — removed after 14 days</span>`;
    const icon=a.mime==='application/pdf'?'<svg class="icon" viewBox="0 0 24 24"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M8 13h8M8 17h5"/></svg>':'<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/></svg>';
    return `<button type="button" class="wm-file" data-wm-file="${a.id}" data-wm-file-msg="${msgId||''}" data-wm-file-name="${safe(a.name)}" data-wm-file-mime="${safe(a.mime)}">${icon}<span>Open ${safe(a.name)}</span><small data-wm-saved="${a.id}"></small></button>`;
  }
  function msgCard(m){
    const act=needsAction(m), unread=!m.read_at;
    let done='';
    if(m.msg_type==='ack'&&m.acked_at) done=`<div class="wm-done">✓ You acknowledged this · ${ago(m.acked_at)}</div>`;
    if(m.msg_type==='reply'&&m.replied_at) done=`<div class="wm-done">✓ You replied: <b>${safe(m.reply)}</b> · ${ago(m.replied_at)}</div>`;
    let actions=speechOk?`<button type="button" class="wm-speak" data-wm-speak="${m.id}"><svg class="icon" viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>Read Aloud</button>`:'';
    if(m.msg_type==='ack'&&!m.acked_at) actions+=`<button type="button" class="wm-ack" data-wm-ack="${m.id}">✓ Got It</button>`;
    if(m.msg_type==='reply'&&!m.replied_at) actions+=(m.reply_options||[]).map(o=>`<button type="button" class="ghost" data-wm-reply="${m.id}" data-reply="${safe(o)}">${safe(o)}</button>`).join('');
    if(m.msg_type==='notice'&&unread) actions+=`<button type="button" class="ghost" data-wm-read="${m.id}">Mark Read</button>`;
    actions+=`<button type="button" class="ghost" data-wm-answer="${m.id}">Reply</button>`;
    const ctx=m.in_reply_to?`<div class="wm-ctx">Answer to your message: <b>${safe(m.in_reply_to.topic||'')}</b>${m.in_reply_to.body?' — '+safe(m.in_reply_to.body):''}</div>`:'';
    const files=(m.attachments||[]).length?`<div class="wm-files">${m.attachments.map(a=>fileBtn(a,m.id)).join('')}</div>`:'';
    return `<article class="card wm-item${act?' act':''}${unread?' unread':''}${m.urgent?' urgent':''}">
      <div class="wm-meta"><b>${safe(m.sender_name)}</b><span>${ago(m.created_at)}</span>${m.urgent?'<span class="wm-tag urgent">Urgent</span>':''}${m.msg_type==='ack'?'<span class="wm-tag">Must acknowledge</span>':m.msg_type==='reply'?'<span class="wm-tag">Needs reply</span>':''}${unread?'<span class="wm-tag new">New</span>':''}</div>
      ${ctx}${m.body?`<p class="wm-body">${safe(m.body).replace(/\n/g,'<br>')}</p>`:''}${files}${done}
      <div class="wm-actions">${actions}</div></article>`;
  }
  function sentCard(m){
    let st='Sent — not seen yet';
    if(m.handled_at) st=`✓ Handled by ${safe(m.handled_by||'a manager')}`;
    else if(m.dispatch_read_at) st=`Seen by ${safe(m.dispatch_read_by||'a manager')} · ${ago(m.dispatch_read_at)}`;
    const rep=m.replies?` · ${m.replies===1?'1 answer':m.replies+' answers'} above`:'';
    const files=(m.attachments||[]).length?`<div class="wm-files">${m.attachments.map(a=>fileBtn(a,null)).join('')}</div>`:'';
    return `<article class="card wm-sent"><div class="wm-meta"><b>To managers</b><span>${ago(m.created_at)}</span>${m.topic?`<span class="wm-tag">${safe(m.topic)}</span>`:''}</div>
      ${m.body?`<p class="wm-sent-body">${safe(m.body)}</p>`:''}${files}<div class="wm-sent-st${m.handled_at||m.dispatch_read_at?' ok':''}">${st}${rep}</div></article>`;
  }
  function renderHome(){
    const c=$('wmHomeCard'); if(!c) return;
    c.classList.remove('alert','new');
    const title=$('wmHomeTitle'), sub=$('wmHomeSub'), badge=$('wmHomeBadge');
    if(!store.token){ title.textContent='Messages'; sub.textContent='Sign in to get messages from your managers — and send them one.'; badge.hidden=true; return; }
    const unread=messages.filter(m=>!m.read_at).length, act=messages.filter(needsAction).length, n=Math.max(unread,act);
    badge.hidden=!n; badge.textContent=n;
    if(act){ c.classList.add('alert'); title.textContent=act===1?'1 message needs your answer':`${act} messages need your answer`; sub.textContent='Tap to open.'; }
    else if(unread){ c.classList.add('new'); title.textContent=unread===1?'1 new message':`${unread} new messages`; sub.textContent='Tap to read.'; }
    else { title.textContent='Messages'; sub.textContent=messages.length?'No new messages. You are all caught up.':'No messages from managers right now.'; }
  }
  function render(){
    renderHome();
    if(!$('wmView')) return;
    const signed=!!store.token;
    $('wmLogin').hidden=signed; $('wmSigned').hidden=!signed;
    if(!signed){ if(!$('wmEmpId').value) $('wmEmpId').value=S.get('whMsgLastId','')||''; $('wmKeep').checked=store.keep; return; }
    const me=store.me||{};
    $('wmWho').textContent=me.name?`${me.name} (${me.emp_id})`:'';
    $('wmMgrLink').hidden=!me.is_manager;
    $('wmAutoRead').checked=store.autoRead; $('wmChime').checked=store.chime;
    $('wmSpeakAll').hidden=!speechOk||!messages.some(m=>!m.read_at||needsAction(m));
    $('wmList').innerHTML=messages.length?messages.map(msgCard).join(''):'<div class="card wm-empty"><b>No messages right now.</b><span>New messages from your managers show up here on their own.</span></div>';
    $('wmSentHead').hidden=!sentMsgs.length;
    $('wmSentList').innerHTML=sentMsgs.map(sentCard).join('');
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click',e=>{
    const f=e.target.closest('[data-wm-file]');
    if(f){ openFile(f.dataset.wmFile,f.dataset.wmFileName,f.dataset.wmFileMime,f.dataset.wmFileMsg?Number(f.dataset.wmFileMsg):null); return; }
    const an=e.target.closest('[data-wm-answer]'); if(an){ const m=messages.find(x=>x.id===Number(an.dataset.wmAnswer)); if(m) openCompose(m); return; }
    const tp=e.target.closest('[data-wm-topic]'); if(tp){ compose.topic=compose.topic===tp.dataset.wmTopic?'':tp.dataset.wmTopic; renderTopics(); return; }
    const t=e.target.closest('[data-wm-speak],[data-wm-ack],[data-wm-reply],[data-wm-read]'); if(!t) return;
    const id=Number(t.dataset.wmSpeak||t.dataset.wmAck||t.dataset.wmReply||t.dataset.wmRead);
    const m=messages.find(x=>x.id===id); if(!m) return;
    if(t.dataset.wmSpeak) speak([m]);
    else if(t.dataset.wmAck) mark(m,'ack');
    else if(t.dataset.wmReply) mark(m,'reply',t.dataset.reply);
    else if(t.dataset.wmRead) mark(m,'read');
  });
  function wire(){
    if(!$('wmView')) return;
    $('wmLoginBtn').onclick=doLogin;
    $('wmPin').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
    $('wmSetupBtn').onclick=doSetup;
    $('wmSetupToggle').onclick=()=>setSetupMode($('wmSetupBox').hidden);
    $('wmLogout').onclick=doLogout;
    $('wmRefresh').onclick=()=>refresh();
    $('wmSpeakAll').onclick=()=>{ const l=messages.filter(m=>!m.read_at||needsAction(m)).reverse(); speak(l.length?l:messages.slice(0,3).reverse()); };
    $('wmStop').onclick=stopSpeaking;
    $('wmAutoRead').onchange=e=>{ store.autoRead=e.target.checked; };
    $('wmChime').onchange=e=>{ store.chime=e.target.checked; };
    $('wmNewBtn').onclick=()=>openCompose(null);
    $('wmCmpCancel').onclick=closeCompose;
    $('wmCmpSend').onclick=sendCompose;
    $('wmCmpPhoto').onchange=pickPhoto;
    $('wmCmpPhotoDel').onclick=()=>{ compose.photo=null; $('wmCmpPhoto').value=''; renderPhoto(); };
    $('wmViewerClose').onclick=closeViewer;
    $('wmViewerZoomIn').onclick=()=>zoomViewer(1.25);
    $('wmViewerZoomOut').onclick=()=>zoomViewer(0.8);
    render();
    if(store.token){ startPoll(); refresh({speakUnread:true}); }
  }
  window.LWHMessages={refresh,render,isSignedIn:()=>!!store.token};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',wire); else wire();
})();
