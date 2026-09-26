(function(){
  // FIFO / AGING — two views over current_inventory:
  //   Pick Oldest First: type an item, get its on-hand pallets in pick order
  //                      (oldest received first) with the first bay up top.
  //   Aging Report:      every pallet older than N days, grouped by customer.
  // Backed by toolkit_fifo_item() and toolkit_aging_pallets() — see
  // sql/fifo_functions.sql. Same anon-key plain-fetch RPC pattern as
  // inventory.js; both functions count each pallet_id once.
  const SUPABASE_URL='https://tjivcqxnkftujceumdtx.supabase.co';
  const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqaXZjcXhua2Z0dWpjZXVtZHR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTE5NDMsImV4cCI6MjEwMDQ2Nzk0M30.GzDc-_u92jvAHq7eG1X-1cet5Av9qF3ZDEVJMRKEP0E';

  let tab='pick';
  let pickRows=[], pickItem='', pickWhse='';
  let agingRows=[], agingDays=90, agingWhse='';

  function el(id){ return document.getElementById(id); }
  function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function status(msg,isErr){ const s=el('ffStatus'); if(!s) return; s.textContent=msg||''; s.style.color=isErr?'var(--bad)':'var(--muted)'; }
  function norm(s){ return String(s??'').trim().toUpperCase(); }
  function fmtDate(iso){
    const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})/); if(!m) return '—';
    return new Date(+m[1],+m[2]-1,+m[3]).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  }
  function fmtQty(n){ const v=Number(n); return isFinite(v)?v.toLocaleString():'—'; }
  function ageClass(d){ return d==null?'':d>=180?'ff-age-old':d>=90?'ff-age-warn':''; }
  function ageText(d){ return d==null?'No receive date':d===1?'1 day':d.toLocaleString()+' days'; }

  async function rpc(fn,body){
    const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`,{
      method:'POST',
      headers:{'apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+SUPABASE_ANON_KEY,'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    if(!res.ok) throw new Error('HTTP '+res.status);
    return res.json();
  }

  // A bay status is only worth flagging when it's unusual for this result set
  // (e.g. HOLD among normal pallets) — if every pallet says the same thing, skip it.
  function statusFlagger(rows){
    const counts={}; rows.forEach(r=>{ const s=norm(r.bay_status); counts[s]=(counts[s]||0)+1; });
    const common=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0]||'';
    return r=>{ const s=norm(r.bay_status); return s && s!==common ? `<span class="ff-flag">${safe(r.bay_status)}</span>` : ''; };
  }

  // ---------------- Pick Oldest First ----------------
  async function findItem(){
    const q=String(el('ffItem').value||'').trim();
    const out=el('ffResults');
    if(q.length<2){ status('Enter an item number (at least 2 characters).',true); el('ffItem').focus(); return; }
    status('Finding pallets…'); out.innerHTML='<div class="card">Loading…</div>';
    try{
      pickRows=await rpc('toolkit_fifo_item',{p_item:q})||[];
      pickItem=''; pickWhse='';
      const items=[...new Set(pickRows.map(r=>norm(r.item_number)))];
      if(items.length===1) pickItem=items[0];
      renderPick(q);
      status('');
    }catch(e){
      console.error('FIFO lookup failed',e);
      out.innerHTML='<div class="card">Couldn\'t load pallets right now — check your connection and try again.</div>';
      status('Load failed: '+e.message,true);
    }
  }

  function renderPick(q){
    const out=el('ffResults');
    if(!pickRows.length){ out.innerHTML=`<div class="card">No on-hand pallets found for "${safe(q||el('ffItem').value)}".</div>`; return; }

    // Several items matched a partial number → let them pick which one.
    const items={};
    pickRows.forEach(r=>{ const k=norm(r.item_number); (items[k]=items[k]||{desc:r.item_description,n:0}).n++; });
    if(!pickItem){
      out.innerHTML=`<div class="card"><b>${Object.keys(items).length} items start with "${safe(q)}"</b> — pick one:
        <div class="ff-chips" style="margin-top:10px">${Object.keys(items).map(k=>`<button type="button" class="ff-chip" data-item="${safe(k)}">${safe(k)}<span>${items[k].n} plt</span></button>`).join('')}</div></div>`;
      out.querySelectorAll('[data-item]').forEach(b=>b.onclick=()=>{ pickItem=b.dataset.item; renderPick(q); });
      return;
    }

    const rowsItem=pickRows.filter(r=>norm(r.item_number)===pickItem);
    const whses={}; rowsItem.forEach(r=>{ const w=r.warehouse||'—'; whses[w]=(whses[w]||0)+1; });
    const rows=pickWhse?rowsItem.filter(r=>(r.warehouse||'—')===pickWhse):rowsItem;
    const flag=statusFlagger(rowsItem);
    const first=rows[0];
    const totalQty=rows.reduce((s,r)=>s+(Number(r.quantity)||0),0);
    const back=Object.keys(items).length>1?`<button type="button" class="mh-link" id="ffBackItems">&lsaquo; Other items</button>`:'';
    const whseChips=Object.keys(whses).length>1?`<div class="ff-chips">${['',...Object.keys(whses).sort()].map(w=>`<button type="button" class="ff-chip${w===pickWhse?' active':''}" data-whse="${safe(w)}">${w?safe(w):'All warehouses'}<span>${w?whses[w]:rowsItem.length}</span></button>`).join('')}</div>`:'';

    const rest=rows.slice(1).map((r,i)=>`
      <div class="ff-row">
        <div class="ff-rank">${i+2}</div>
        <div class="ff-row-main"><b>${safe(r.bay_name||'—')}</b> ${flag(r)}<div class="ff-row-sub">Lot ${safe(r.lot_number||'—')} · ${safe(r.warehouse||'—')} · Qty ${fmtQty(r.quantity)} · Pallet ${safe(r.pallet_id)}</div></div>
        <div class="ff-row-age"><span class="${ageClass(r.age_days)}">${ageText(r.age_days)}</span><div class="ff-row-sub">${fmtDate(r.received_on)}</div></div>
      </div>`).join('');

    out.innerHTML=`
      <div class="card">
        ${back}
        <div class="ff-item-head"><b>${safe(first.item_number)}</b>${first.item_description?' — '+safe(first.item_description):''}</div>
        <div class="hint" style="margin:2px 0 8px">${safe(first.customer||'')} · ${rows.length} pallet${rows.length===1?'':'s'} on hand · ${fmtQty(totalQty)} total qty</div>
        ${whseChips}
      </div>
      <div class="card ff-first">
        <div class="ff-first-label">Pick this one first — oldest on hand</div>
        <div class="ff-first-bay">${safe(first.bay_name||'—')} ${flag(first)}</div>
        <div class="ff-first-grid">
          <div><span>Warehouse</span><b>${safe(first.warehouse||'—')}</b></div>
          <div><span>Lot</span><b>${safe(first.lot_number||'—')}</b></div>
          <div><span>Received</span><b>${fmtDate(first.received_on)}</b></div>
          <div><span>Age</span><b class="${ageClass(first.age_days)}">${ageText(first.age_days)}</b></div>
          <div><span>Qty</span><b>${fmtQty(first.quantity)}</b></div>
          <div><span>Pallet</span><b>${safe(first.pallet_id)}</b></div>
        </div>
      </div>
      ${rest?`<div class="card" style="margin-top:10px"><h3 style="margin-top:0">Then, in this order</h3>${rest}</div>`:''}
    `;
    out.querySelectorAll('[data-whse]').forEach(b=>b.onclick=()=>{ pickWhse=b.dataset.whse; renderPick(q); });
    const bk=el('ffBackItems'); if(bk) bk.onclick=()=>{ pickItem=''; pickWhse=''; renderPick(q); };
  }

  // ---------------- Aging Report ----------------
  async function runAging(){
    const out=el('ffResults');
    agingDays=Number(el('ffDays').value)||90;
    status('Building aging report…'); out.innerHTML='<div class="card">Loading…</div>';
    try{
      agingRows=await rpc('toolkit_aging_pallets',{p_min_days:agingDays})||[];
      agingWhse='';
      renderAging();
      status('');
    }catch(e){
      console.error('Aging report failed',e);
      out.innerHTML='<div class="card">Couldn\'t load the aging report right now — check your connection and try again.</div>';
      status('Load failed: '+e.message,true);
    }
  }

  function agingFiltered(){ return agingWhse?agingRows.filter(r=>(r.warehouse||'—')===agingWhse):agingRows; }

  function groupByCustomer(rows){
    const g={};
    rows.forEach(r=>{ const c=r.customer||'(No customer)'; (g[c]=g[c]||[]).push(r); });
    return Object.keys(g).map(c=>({customer:c,rows:g[c],oldest:Math.max(...g[c].map(r=>r.age_days||0))}))
      .sort((a,b)=>b.rows.length-a.rows.length||b.oldest-a.oldest);
  }

  function renderAging(){
    const out=el('ffResults');
    if(!agingRows.length){ out.innerHTML=`<div class="card">No pallets older than ${agingDays} days. Nice.</div>`; return; }
    const whses=[...new Set(agingRows.map(r=>r.warehouse||'—'))].sort();
    const rows=agingFiltered();
    const groups=groupByCustomer(rows);
    const flag=statusFlagger(agingRows);
    const capped=agingRows.length>=5000;

    const groupHtml=groups.map(g=>`
      <details class="ff-group">
        <summary><span class="ff-group-name">${safe(g.customer)}</span><span class="ff-group-count">${g.rows.length} pallet${g.rows.length===1?'':'s'}</span><span class="ff-group-oldest ${ageClass(g.oldest)}">oldest ${ageText(g.oldest)}</span></summary>
        <div class="ff-table-wrap"><table class="pls-table"><thead><tr><th>Item</th><th>Lot</th><th>Bay</th><th>Whse</th><th>Received</th><th>Age</th><th>Qty</th></tr></thead><tbody>
          ${g.rows.map(r=>`<tr><td><b>${safe(r.item_number)}</b>${r.item_description?`<div class="ff-row-sub">${safe(r.item_description)}</div>`:''}</td><td>${safe(r.lot_number||'—')}</td><td>${safe(r.bay_name||'—')} ${flag(r)}</td><td>${safe(r.warehouse||'—')}</td><td>${fmtDate(r.received_on)}</td><td class="${ageClass(r.age_days)}">${r.age_days}</td><td>${fmtQty(r.quantity)}</td></tr>`).join('')}
        </tbody></table></div>
      </details>`).join('');

    out.innerHTML=`
      <div class="card">
        <div class="ff-aging-total"><span class="mh-total-num">${rows.length.toLocaleString()}</span> <span class="mh-total-unit">pallet${rows.length===1?'':'s'} older than ${agingDays} days</span></div>
        <div class="hint">${groups.length} customer${groups.length===1?'':'s'} · oldest pallet ${ageText(Math.max(...rows.map(r=>r.age_days||0)))}${capped?' · showing the oldest 5,000 only':''}</div>
        ${whses.length>1?`<div class="ff-chips" style="margin-top:10px">${['',...whses].map(w=>`<button type="button" class="ff-chip${w===agingWhse?' active':''}" data-awhse="${safe(w)}">${w?safe(w):'All warehouses'}<span>${w?agingRows.filter(r=>(r.warehouse||'—')===w).length:agingRows.length}</span></button>`).join('')}</div>`:''}
        <div class="grid-2 no-print" style="margin-top:12px"><button type="button" id="ffCsvBtn" class="ghost">Download CSV</button><button type="button" id="ffPrintBtn" class="ghost">Print Report</button></div>
      </div>
      <div class="card" style="margin-top:10px"><div class="hint" style="margin-bottom:6px">Tap a customer to see its pallets.</div>${groupHtml}</div>
    `;
    out.querySelectorAll('[data-awhse]').forEach(b=>b.onclick=()=>{ agingWhse=b.dataset.awhse; renderAging(); });
    el('ffCsvBtn').onclick=agingCsv;
    el('ffPrintBtn').onclick=agingPrint;
  }

  function csvEscape(v){ const s=String(v??''); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
  function agingCsv(){
    const rows=agingFiltered(); if(!rows.length) return;
    const head=['Customer','Item','Description','Lot','Bay','Bay Status','Warehouse','Received','Age (days)','Qty','Pallet ID'];
    const body=rows.map(r=>[r.customer,r.item_number,r.item_description,r.lot_number,r.bay_name,r.bay_status,r.warehouse,r.received_on,r.age_days,r.quantity,r.pallet_id].map(csvEscape).join(','));
    const blob=new Blob([[head.join(','),...body].join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=`aging-over-${agingDays}-days${agingWhse?'-'+agingWhse:''}-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    LWHUI.toast(`Exported ${rows.length} pallet(s) to CSV`);
  }
  function agingPrint(){
    const rows=agingFiltered(); const out=el('ffPrintArea'); if(!rows.length||!out) return;
    const groups=groupByCustomer(rows);
    out.innerHTML=`<h2>Aging Report — pallets older than ${agingDays} days${agingWhse?' · '+safe(agingWhse):''}</h2>
      <p>${rows.length} pallet(s) · ${groups.length} customer(s) · printed ${new Date().toLocaleDateString()}</p>
      ${groups.map(g=>`<h3>${safe(g.customer)} — ${g.rows.length} pallet(s)</h3>
        <table class="txn-print-table"><thead><tr><th>Item</th><th>Description</th><th>Lot</th><th>Bay</th><th>Whse</th><th>Received</th><th>Age</th><th>Qty</th></tr></thead><tbody>
        ${g.rows.map(r=>`<tr><td>${safe(r.item_number)}</td><td>${safe(r.item_description||'')}</td><td>${safe(r.lot_number||'')}</td><td>${safe(r.bay_name||'')}</td><td>${safe(r.warehouse||'')}</td><td>${fmtDate(r.received_on)}</td><td>${r.age_days}</td><td>${fmtQty(r.quantity)}</td></tr>`).join('')}
        </tbody></table>`).join('')}`;
    if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(11,8.5);
    setTimeout(()=>print(),100);
  }

  // ---------------- Tabs ----------------
  function setTab(t){
    tab=t;
    document.querySelectorAll('#fifo [data-fftab]').forEach(b=>b.classList.toggle('active',b.dataset.fftab===t));
    el('ffPickControls').hidden=t!=='pick';
    el('ffAgingControls').hidden=t!=='aging';
    status('');
    if(t==='pick'){ if(pickRows.length) renderPick(el('ffItem').value.trim()); else el('ffResults').innerHTML=''; }
    else { if(agingRows.length) renderAging(); else el('ffResults').innerHTML=''; }
  }

  window.addEventListener('load',()=>{
    if(!el('ffFindBtn')) return;
    document.querySelectorAll('#fifo [data-fftab]').forEach(b=>b.onclick=()=>setTab(b.dataset.fftab));
    el('ffFindBtn').onclick=findItem;
    el('ffItem').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); findItem(); } };
    el('ffAgingBtn').onclick=runAging;
    el('ffDays').onchange=()=>{ if(agingRows.length) runAging(); };
  });
})();
