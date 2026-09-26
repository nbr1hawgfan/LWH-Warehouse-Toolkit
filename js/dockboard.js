(function(){
  // TODAY'S DOCK — one screen of the day's inbound and outbound loads, built
  // from the same load-details-csv feed Load Details already uses (no new
  // Supabase setup). The feed is one row per item line, so rows are grouped
  // by Pro # into loads. Refreshes itself every 5 minutes; TV Mode hides the
  // app chrome and enlarges everything for a shipping-office screen.
  const LOAD_DETAILS_URL='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/load-details-csv';
  const REFRESH_MS=5*60*1000;

  let rows=[], loadedAt=null, syncedAt='';
  let day=startOfDay(new Date());
  let whse='';
  let timer=null, loading=false;

  function el(id){ return document.getElementById(id); }
  function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function startOfDay(d){ return new Date(d.getFullYear(),d.getMonth(),d.getDate()); }
  function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
  function sameDay(a,b){ return a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }
  function num(v){ const n=parseFloat(String(v??'').replace(/,/g,'')); return isFinite(n)?n:0; }

  // LoadDate may arrive as 2026-09-25, 2026-09-25T00:00:00 or 9/25/2026.
  function parseDate(s){
    s=String(s||'').trim(); let m;
    if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(+m[1],+m[2]-1,+m[3]);
    if((m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) return new Date(+m[3]<100?2000+ +m[3]:+m[3],+m[1]-1,+m[2]);
    return null;
  }
  function dirOf(s){ const d=String(s||'').trim().toUpperCase(); return d.startsWith('I')||d.includes('RECEIV')?'in':d.startsWith('O')||d.includes('SHIP')?'out':'other'; }
  // Color a status by what it sounds like; the exact wording comes from birdsEye.
  function statusTone(s){
    const t=String(s||'').toLowerCase();
    if(!t) return 'none';
    if(/cancel|void/.test(t)) return 'cancel';
    if(/ship|complete|closed|received|done|delivered|invoiced|finished/.test(t)) return 'done';
    if(/progress|load|unload|open|active|dock|started|working|staged|picking/.test(t)) return 'active';
    return 'waiting';
  }

  function parseCsv(text){
    text=(text||'').replace(/^﻿/,'').trim(); if(!text) return [];
    const lines=[]; let cur='', row=[], q=false;
    for(let i=0;i<text.length;i++){
      const c=text[i],n=text[i+1];
      if(c==='"'){ if(q&&n==='"'){cur+='"';i++;} else q=!q; }
      else if(!q && c===','){ row.push(cur);cur=''; }
      else if(!q && (c==='\n'||c==='\r')){ if(c==='\r'&&n==='\n')i++; row.push(cur); if(row.some(x=>String(x).trim())) lines.push(row); row=[]; cur=''; }
      else cur+=c;
    }
    row.push(cur); if(row.some(x=>String(x).trim())) lines.push(row);
    if(!lines.length) return [];
    const head=lines.shift().map(h=>h.trim());
    return lines.map(r=>{ const o={}; head.forEach((h,i)=>{ o[h]=r[i]!==undefined?r[i]:''; }); return o; });
  }

  async function fetchRows(){
    if(loading) return; loading=true;
    const st=el('dbStatus'); if(st && !rows.length) st.textContent='Loading today\'s loads…';
    try{
      const res=await fetch(LOAD_DETAILS_URL+'?_='+Date.now(),{cache:'no-store',mode:'cors'});
      if(!res.ok) throw new Error('HTTP '+res.status);
      rows=parseCsv(await res.text());
      loadedAt=new Date();
      syncedAt=(rows.find(r=>r.SyncedAt)||{}).SyncedAt||'';
      render();
    }catch(e){
      console.error('Dock board load failed',e);
      if(st) st.textContent='Couldn\'t load loads right now — will try again automatically. ('+e.message+')';
      if(!rows.length) el('dbBoard').innerHTML='<div class="card">Couldn\'t load today\'s loads — check your connection.</div>';
    }finally{ loading=false; }
  }

  function groupLoads(){
    const map=new Map();
    rows.forEach(r=>{
      const d=parseDate(r.LoadDate); if(!sameDay(d,day)) return;
      const key=(r.ProNumber||'').trim()||('row-'+map.size);
      if(!map.has(key)) map.set(key,{pro:r.ProNumber||'—',related:r.RelatedPro||'',dir:dirOf(r.Direction),dirRaw:r.Direction||'',
        warehouse:r.Warehouse||'',customer:r.SubCustNm||r.BillToName||r.BusinessPartner||'',billToRef:r.BillToReference||'',
        carrier:r.Carrier||'',trailer:r.Trailer||'',seal:r.Seal||'',status:r.LoadStatus||'',pallets:0,qty:0,items:[]});
      const L=map.get(key);
      L.pallets+=num(r.TotalPallets); L.qty+=num(r.TotalQty);
      if(!L.carrier&&r.Carrier) L.carrier=r.Carrier; if(!L.trailer&&r.Trailer) L.trailer=r.Trailer; if(!L.status&&r.LoadStatus) L.status=r.LoadStatus;
      L.items.push({item:r.ItemNm||'',desc:r.ItemDesc||'',lot:r.LotNum||'',pallets:num(r.TotalPallets),qty:num(r.TotalQty)});
    });
    const order={active:0,waiting:1,none:1,done:2,cancel:3};
    return [...map.values()].sort((a,b)=>(order[statusTone(a.status)]-order[statusTone(b.status)])||a.customer.localeCompare(b.customer)||String(a.pro).localeCompare(String(b.pro)));
  }

  function loadCard(L){
    const tone=statusTone(L.status);
    const items=L.items.map(i=>`<tr><td><b>${safe(i.item||'—')}</b>${i.desc?`<div class="db-sub">${safe(i.desc)}</div>`:''}</td><td>${safe(i.lot||'—')}</td><td>${i.pallets.toLocaleString()}</td><td>${i.qty.toLocaleString()}</td></tr>`).join('');
    return `<details class="db-load db-tone-${tone}">
      <summary>
        <div class="db-load-top"><span class="db-pro">${safe(L.pro)}</span>${L.status?`<span class="db-badge db-badge-${tone}">${safe(L.status)}</span>`:''}</div>
        <div class="db-cust">${safe(L.customer||'—')}</div>
        <div class="db-meta"><span>${safe(L.carrier||'No carrier')}</span><span>Trailer ${safe(L.trailer||'—')}</span>${L.warehouse?`<span>${safe(L.warehouse)}</span>`:''}</div>
        <div class="db-pallets"><b>${L.pallets.toLocaleString()}</b> pallet${L.pallets===1?'':'s'}</div>
      </summary>
      <div class="db-detail">
        <div class="db-sub">${L.billToRef?'Bill-to-Ref '+safe(L.billToRef)+' · ':''}${L.seal?'Seal '+safe(L.seal)+' · ':''}${L.related?'Related Pro '+safe(L.related)+' · ':''}${L.qty.toLocaleString()} total qty</div>
        <div class="ff-table-wrap"><table class="pls-table"><thead><tr><th>Item</th><th>Lot</th><th>Pallets</th><th>Qty</th></tr></thead><tbody>${items}</tbody></table></div>
      </div>
    </details>`;
  }

  function column(title,list,cls){
    const pallets=list.reduce((s,L)=>s+L.pallets,0);
    const done=list.filter(L=>statusTone(L.status)==='done').length;
    return `<div class="db-col ${cls}">
      <div class="db-col-head"><h3>${title}</h3><div><b>${list.length}</b> load${list.length===1?'':'s'} · <b>${pallets.toLocaleString()}</b> plt${list.length?` · ${done} done`:''}</div></div>
      ${list.length?list.map(loadCard).join(''):'<div class="db-empty">No loads</div>'}
    </div>`;
  }

  function render(){
    const board=el('dbBoard'); if(!board) return;
    const all=groupLoads();
    const whses=[...new Set(all.map(L=>L.warehouse).filter(Boolean))].sort();
    if(whse && !whses.includes(whse)) whse='';
    const loads=whse?all.filter(L=>L.warehouse===whse):all;
    const inb=loads.filter(L=>L.dir==='in'), outb=loads.filter(L=>L.dir==='out'), other=loads.filter(L=>L.dir==='other');

    const isToday=sameDay(day,new Date());
    el('dbDate').textContent=day.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
    el('dbDateSub').textContent=isToday?'Today':sameDay(day,addDays(startOfDay(new Date()),-1))?'Yesterday':sameDay(day,addDays(startOfDay(new Date()),1))?'Tomorrow':day.getFullYear();
    el('dbToday').hidden=isToday;

    const counts={}; loads.forEach(L=>{ const s=L.status||'No status'; counts[s]=(counts[s]||0)+1; });
    const statusChips=Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).map(s=>`<span class="db-badge db-badge-${statusTone(s==='No status'?'':s)}">${safe(s)} · ${counts[s]}</span>`).join('');
    const whseChips=whses.length>1?`<div class="ff-chips">${['',...whses].map(w=>`<button type="button" class="ff-chip${w===whse?' active':''}" data-dbwhse="${safe(w)}">${w?safe(w):'All warehouses'}<span>${w?all.filter(L=>L.warehouse===w).length:all.length}</span></button>`).join('')}</div>`:'';

    board.innerHTML=`
      <div class="db-summary card">
        <div class="db-kpis">
          <div><span>Inbound</span><b>${inb.length}</b><em>${inb.reduce((s,L)=>s+L.pallets,0).toLocaleString()} plt</em></div>
          <div><span>Outbound</span><b>${outb.length}</b><em>${outb.reduce((s,L)=>s+L.pallets,0).toLocaleString()} plt</em></div>
          <div><span>Done</span><b>${loads.filter(L=>statusTone(L.status)==='done').length}</b><em>of ${loads.length} loads</em></div>
        </div>
        ${statusChips?`<div class="db-status-row">${statusChips}</div>`:''}
        ${whseChips}
      </div>
      ${loads.length?`<div class="db-cols">${column('Inbound',inb,'db-in')}${column('Outbound',outb,'db-out')}</div>${other.length?column('Other',other,'db-other'):''}`
        :`<div class="card">No loads on the schedule for ${isToday?'today':'this day'}${whse?' at '+safe(whse):''}.</div>`}
    `;
    board.querySelectorAll('[data-dbwhse]').forEach(b=>b.onclick=()=>{ whse=b.dataset.dbwhse; render(); });
    const st=el('dbStatus');
    if(st) st.textContent=`Updated ${loadedAt?loadedAt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'—'} · refreshes every 5 min${syncedAt?' · data synced '+fmtSynced(syncedAt):''}`;
  }
  function fmtSynced(s){ const d=new Date(String(s).includes('T')?s:String(s).replace(' ','T')); return isNaN(d)?s:d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }

  function startTimer(){ stopTimer(); timer=setInterval(()=>{ if(isVisible()) fetchRows(); },REFRESH_MS); }
  function stopTimer(){ if(timer){ clearInterval(timer); timer=null; } }
  function isVisible(){ const v=el('dockBoard'); return v && v.classList.contains('active') && !document.hidden; }
  function open(){
    // A new calendar day since the board was last opened → jump back to today.
    if(!sameDay(day,new Date()) && loadedAt && !sameDay(loadedAt,new Date())) day=startOfDay(new Date());
    if(!loadedAt || Date.now()-loadedAt>60000) fetchRows(); else render();
    startTimer();
  }

  function toggleTv(on){
    const want=on??!document.body.classList.contains('dock-tv');
    document.body.classList.toggle('dock-tv',want);
    el('dbTvBtn').textContent=want?'Exit TV Mode':'TV Mode';
    try{
      if(want && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
      if(!want && document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    }catch{}
    window.scrollTo(0,0);
  }

  window.addEventListener('load',()=>{
    if(!el('dbBoard')) return;
    el('dbPrev').onclick=()=>{ day=addDays(day,-1); render(); };
    el('dbNext').onclick=()=>{ day=addDays(day,1); render(); };
    el('dbToday').onclick=()=>{ day=startOfDay(new Date()); render(); };
    el('dbRefresh').onclick=()=>{ fetchRows(); LWHUI.toast('Refreshing loads…'); };
    el('dbTvBtn').onclick=()=>toggleTv();
    document.addEventListener('fullscreenchange',()=>{ if(!document.fullscreenElement && document.body.classList.contains('dock-tv')) toggleTv(false); });
    document.addEventListener('keydown',e=>{ if(e.key==='Escape' && document.body.classList.contains('dock-tv')) toggleTv(false); });
    document.addEventListener('visibilitychange',()=>{ if(isVisible() && loadedAt && Date.now()-loadedAt>REFRESH_MS) fetchRows(); });
    // Start/stop with the view.
    document.addEventListener('click',e=>{
      const v=e.target.closest('[data-view]'); if(!v) return;
      setTimeout(()=>{ if(v.dataset.view==='dockBoard') open(); else { stopTimer(); if(document.body.classList.contains('dock-tv')) toggleTv(false); } },0);
    });
  });
  // Opened straight from a link/shortcut (?view=dockBoard) — start it too.
  window.addEventListener('load',()=>setTimeout(()=>{ const v=el('dockBoard'); if(v&&v.classList.contains('active')) open(); },400));
  window.LWHDockBoard={open};
})();
