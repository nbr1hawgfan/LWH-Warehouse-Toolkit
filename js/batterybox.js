/* BATTERY BOX & BOM (v1.89.0) — production / assembly model for the battery box shipments.
   Build masters from components → ship whole orders from built stock with FedEx tracking + LD numbers.
   Replaces the "BOM Inventory — Manager Portal" Apps Script page. The Google Sheet stays the database and
   the script keeps every email, timer and the Battery Box Shipment Tracking sheet sync:

     gas/BatteryBoxAPI.gs   (replaces Code.gs in the existing project)

   The script checks the Toolkit sign-in on every request and lets in only employee IDs on the Sheet's
   Access tab (Role: edit or view). Setup: docs/BATTERY_BOX_SETUP.md */
(function(){
  'use strict';
  // Apps Script web app URL (Deploy → Manage deployments → /exec). Can also be set per device on the Connect screen.
  const API_DEFAULT='';
  const LS_URL='lwh_bbApi', LS_OK='lwh_bbOk';

  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const n=v=>{ const x=Number(String(v==null?'':v).replace(/[,\s$]/g,'')); return isFinite(x)?x:0; };
  const int=v=>Math.round(n(v)).toLocaleString('en-US');
  const money=v=>'$'+n(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const pad=x=>String(x).padStart(2,'0');
  const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const ls={ get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
             set(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };
  const auth=()=>window.LWHAuth||null;
  const toast=m=>{ if(window.LWHUI&&LWHUI.toast) LWHUI.toast(m); };
  const empty=t=>`<div class="pr-empty">${esc(t)}</div>`;
  const plural=(k,w)=>int(k)+' '+w+(n(k)===1?'':'s');
  const badge=(t,tone)=>`<b class="pr-badge pr-t-${tone}">${esc(t)}</b>`;
  const has=(q,...xs)=>!q||xs.some(x=>String(x==null?'':x).toLowerCase().includes(q));
  // Tracking: "A|B|C". LD numbers keep their box position ("x||z" = box 2 has no LD).
  const parseTrk=s=>(!s||s==='N/A')?[]:String(s).split('|').map(x=>x.trim()).filter(Boolean);
  const parseLd=s=>(!s||s==='N/A')?[]:String(s).split('|').map(x=>x.trim());
  const fedex=t=>'https://www.fedex.com/fedextrack/?tracknumbers='+encodeURIComponent(t);

  // ---------------------------------------------------------------- state
  let D=null, ME=null, ERR='', loading=false, built=false;
  let tab='dashboard';
  let orderFilter='Open', orderQ='', orderForm=null, shipPO='';
  let prod={item:'',qty:'1',by:'',notes:''}, prodQ='';
  let msQ='';
  let compSub='stock', compQ='', compOnly='all', compEdit='', compEditMode='';
  let bomSel='', bomForm=null;
  let shipQ='';
  let custForm=null, custQ='';

  const apiUrl=()=>String(ls.get(LS_URL,'')||API_DEFAULT||'').trim();
  const canEdit=()=>!!(ME&&ME.role==='edit');

  // ---------------------------------------------------------------- API
  async function api(action,args){
    const url=apiUrl(); if(!url) throw new Error('not_connected');
    const a=auth(); const token=a&&a.token&&a.token();
    if(!token){ if(a) a.requireSignIn('Please sign in to use Battery Box & BOM.'); throw new Error('signed_out'); }
    let res;
    try{ res=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({},args||{},{action,token})),cache:'no-store',redirect:'follow'}); }
    catch(e){ throw new Error('offline'); }
    let r; try{ r=await res.json(); }catch(e){ throw new Error('bad_reply'); }
    if(!r||!r.ok){
      const err=(r&&r.error)||'failed';
      if(err==='signed_out'&&a) a.requireSignIn('Your sign-in ran out. Please sign in again.');
      throw new Error(err);
    }
    if(r.data) setData(r.data);
    return r;
  }
  function errText(e){
    const m=String(e&&e.message||e);
    if(m.startsWith('bad_input:')) return m.slice(10);
    return ({ not_connected:'Battery Box isn\'t connected yet — its Apps Script link needs to be added.',
      offline:'Couldn\'t reach the server. Check your connection and try again.', signed_out:'Please sign in again.',
      no_access:'You don\'t have access to Battery Box & BOM. Ask Tim to add your employee ID on the Access tab of the BOM Inventory Sheet.',
      view_only:'Your access here is view-only.', busy:'Someone else is saving right now — try again in a moment.',
      bad_reply:'The server sent back something unexpected. Check the Apps Script link (Connect).' })[m] || ('Something went wrong: '+m);
  }
  function msg(html,tone){ const m=$('bbMsg'); if(!m) return; m.innerHTML=html||''; m.hidden=!html; m.className='pr-msg no-print'+(tone?' pr-msg-'+tone:''); }
  async function busy(btn,label,fn){
    const old=btn?btn.innerHTML:''; if(btn){ btn.disabled=true; btn.textContent=label; }
    try{ return await fn(); } finally{ if(btn&&btn.isConnected){ btn.disabled=false; btn.innerHTML=old; } }
  }
  /** Run a saving action: button spinner, message, re-render with the fresh data the script sends back. */
  async function save(btn,action,args,after){
    try{
      const r=await busy(btn,'Saving…',()=>api(action,args));
      if(after) after(r);
      render(); msg(esc(r.message||'Saved'),'good'); toast('Saved');
      return r;
    }catch(e){ const t=errText(e); toast(t); msg(esc(t),'bad'); return null; }
  }
  function excel(file,sheetName,labels,rows,numCols){
    if(!rows||!rows.length) return toast('Nothing to export.');
    if(!window.LWHXlsx) return toast('Excel export isn\'t loaded.');
    LWHXlsx.download(file,[{name:sheetName,columns:labels.map((l,j)=>({label:l,width:Math.max(10,Math.min(40,l.length+6)),type:(numCols||[]).includes(j)?'n':undefined})),rows}]);
  }

  // ---------------------------------------------------------------- data helpers
  function setData(d){
    D={ components:d.components||[], bomItems:d.bomItems||[], history:d.history||[], openOrders:d.openOrders||[],
        shipments:d.shipments||[], customers:d.customers||[], receivingLog:d.receivingLog||[], masterStock:d.masterStock||[],
        productionLog:d.productionLog||[], buildCapacity:d.buildCapacity||[], dashboard:d.dashboard||null };
  }
  const comp=code=>D.components.find(c=>c.code===code)||null;
  const bom=code=>D.bomItems.find(b=>b.item===code)||null;
  const ms=code=>D.masterStock.find(m=>m.itemCode===code)||null;
  const cap=code=>D.buildCapacity.find(c=>c.item===code)||null;
  const avail=code=>{ const m=ms(code); return m?n(m.qtyAvailable):0; };
  const level=c=>n(c.quantity)<=n(c.criticalThreshold)?'critical':n(c.quantity)<=n(c.lowThreshold)?'low':'ok';
  const levelBadge=c=>({critical:badge('Critical','bad'),low:badge('Low','warn'),ok:badge('OK','good')})[level(c)];
  const stockTone=q=>q<=0?'sr-low':q<5?'':'sr-good';
  const poFor=s=>{ const h=D.history.find(h=>h.shipmentId&&h.shipmentId===s.id)||D.history.find(h=>String(h.shipmentId||'').indexOf('SH-')!==0&&h.item===s.item&&h.date===s.date); return h?h.poNumber:''; };
  /** BOM components added up per code (a component listed twice counts once, for the total). */
  function needsFor(item,qty){ const o={}; (item?item.components:[]).forEach(c=>{ o[c.code]=o[c.code]||{code:c.code,description:c.description,per:0}; o[c.code].per+=n(c.quantity); });
    return Object.values(o).map(r=>{ const s=comp(r.code); const have=s?n(s.quantity):0; return Object.assign(r,{need:r.per*qty,have,listed:!!s,after:have-r.per*qty}); }); }
  function trackStack(trk,ld){
    const t=parseTrk(trk), l=parseLd(ld);
    if(!t.length) return '<span class="pr-small-t">—</span>';
    return `<div class="bb-trk">${t.map((x,i)=>`<div><span class="bb-box">Box ${i+1}</span><a href="${fedex(x)}" target="_blank" rel="noopener">${esc(x)} ↗</a>${l[i]?`<span class="bb-ld">${esc(l[i])}</span>`:''}</div>`).join('')}</div>`;
  }
  const itemOptions=(sel,lbl)=>`<option value="">${esc(lbl||'Select item…')}</option>`+D.bomItems.map(b=>`<option value="${esc(b.item)}"${b.item===sel?' selected':''}>${esc(b.item)} — ${esc(String(b.description||'').slice(0,50))}</option>`).join('');
  const compOptions=(sel,lbl)=>`<option value="">${esc(lbl||'Select component…')}</option>`+D.components.map(c=>`<option value="${esc(c.code)}"${c.code===sel?' selected':''}>${esc(c.code)} — ${esc(String(c.description||'').slice(0,40))}</option>`).join('');

  // ---------------------------------------------------------------- shell
  const ICON='<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="12" rx="1"/><path d="M7 8V5h3v3M14 8V5h3v3"/><path d="M8 14h3M9.5 12.5v3M14 14h3"/></svg>';
  const TABS=[['dashboard','Dashboard'],['orders','Orders'],['build','Build'],['master','Master Stock'],['components','Components'],['bom','BOM'],['shipments','Shipments'],['customers','Customers'],['reports','Reports']];
  function build_(){
    const sec=$('batteryBox'); if(!sec||built) return; built=true;
    sec.innerHTML=`<div class="pr-wrap">
      <div class="pr-top no-print">
        <div class="mh-entry-head">
          <div class="mh-entry-icon">${ICON}</div>
          <div><h2>Battery Box &amp; BOM</h2><div class="mh-entry-sub">Build masters from components, then ship orders from built stock with FedEx tracking and LD numbers.</div></div>
          <div class="pr-who"><span id="bbWho"></span><button type="button" class="ghost pr-small" id="bbRefresh">Refresh</button></div>
        </div>
        <div class="pr-tabs" role="tablist" id="bbTabs">${TABS.map(([k,l])=>`<button type="button" data-bbtab="${k}" role="tab">${l}</button>`).join('')}</div>
      </div>
      <div id="bbMsg" class="pr-msg no-print" hidden></div>
      <div id="bbBody"></div>
    </div>`;
    $('bbTabs').addEventListener('click',e=>{ const b=e.target.closest('[data-bbtab]'); if(b) go(b.dataset.bbtab); });
    $('bbRefresh').onclick=()=>boot(true);
  }
  function go(t,keepMsg){ if(t!==tab&&!keepMsg) msg(''); tab=t; render(); window.scrollTo(0,0); }

  async function boot(force){
    if(loading) return; if(D&&!force){ render(); return; }
    const a=auth();
    if(!a||!a.isSignedIn()){ msg('Please sign in to use Battery Box & BOM.','warn'); $('bbBody').innerHTML=''; return; }
    if(!apiUrl()){ renderConnect(); return; }
    loading=true; msg('Loading…');
    try{
      const r=await api('bootstrap'); ME=r.me; ERR=''; ls.set(LS_OK,'1'); showNav(); msg(''); render();
    }catch(e){
      ERR=errText(e); ls.set(LS_OK,''); showNav(); msg(esc(ERR),'bad');
      if(['bad_reply','not_connected'].includes(e.message)) renderConnect(true); else if(!D) $('bbBody').innerHTML='';
    }finally{ loading=false; }
  }

  function renderConnect(keepMsg){
    if(!keepMsg) msg('');
    $('bbBody').innerHTML=`<div class="card pr-card pr-narrow"><h3>Connect Battery Box &amp; BOM</h3>
      <p class="hint">Paste the Apps Script web app link for the BOM Inventory Sheet (it ends in <b>/exec</b>). It's saved on this device. See docs/BATTERY_BOX_SETUP.md — or ask Tim.</p>
      <label>BOM Inventory (battery box) web app<input id="bbUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(apiUrl())}"></label>
      <div class="actions"><button type="button" id="bbUrlSave">Save &amp; Connect</button></div></div>`;
    $('bbUrlSave').onclick=()=>{
      const v=$('bbUrl').value.trim();
      if(!/^https:\/\/script\.google\.com\/.+\/exec$/.test(v)){ toast('That doesn\'t look like an Apps Script /exec link.'); return; }
      ls.set(LS_URL,v); boot(true);
    };
  }

  function render(){
    if(!D) return;
    $('bbWho').textContent=ME?(ME.name+(ME.role==='view'?' · view only':'')):'';
    document.querySelectorAll('#bbTabs [data-bbtab]').forEach(b=>{ b.classList.toggle('active',b.dataset.bbtab===tab); b.setAttribute('aria-selected',b.dataset.bbtab===tab); });
    ({dashboard:renderDash,orders:renderOrders,build:renderBuild,master:renderMaster,components:renderComponents,bom:renderBom,shipments:renderShipments,customers:renderCustomers,reports:renderReports})[tab]();
  }

  // ================================================================ DASHBOARD
  function renderDash(){
    const d=D.dashboard||{}, mst=D.masterStock, crit=D.components.filter(c=>level(c)==='critical'), low=D.components.filter(c=>level(c)==='low');
    const active=D.openOrders.filter(o=>o.status==='Open'||o.status==='Pending'), recent=D.shipments.slice(0,8);
    const week=d.weeklyChart||[], wmax=Math.max(1,...week.map(w=>w.count)), top=(d.byItem||[]).slice(0,6), tmax=Math.max(1,...top.map(t=>t.count));
    const shortOrders=active.filter(o=>avail(o.itemName)<n(o.dueQuantity||o.orderQuantity));
    $('bbBody').innerHTML=`<div class="pr-tiles bb-tiles">
        <div class="pr-tile"><span>Ready to ship</span><b>${int(d.totalReadyToShip||0)}</b><small class="pr-delta">built units</small></div>
        <div class="pr-tile${shortOrders.length?' accent':''}"><span>Open orders</span><b>${active.length}</b><small class="pr-delta">${shortOrders.length?shortOrders.length+' need a build first':'all covered by built stock'}</small></div>
        <div class="pr-tile${crit.length?' accent':''}"><span>Critical components</span><b>${crit.length}</b><small class="pr-delta">${low.length} more low</small></div>
        <div class="pr-tile"><span>Shipped today</span><b>${int(d.todayShipments||0)}</b><small class="pr-delta">${int(d.totalShipments||0)} all time</small></div>
      </div>
      ${crit.length?`<div class="pr-msg pr-msg-bad"><b>Critical:</b> ${crit.map(c=>esc(c.code)+' ('+int(c.quantity)+')').join(', ')}</div>`:''}
      ${low.length?`<div class="pr-msg pr-msg-warn"><b>Low:</b> ${low.map(c=>esc(c.code)+' ('+int(c.quantity)+')').join(', ')}</div>`:''}
      <div class="sr-two sr-even">
        <div class="card pr-card"><div class="pr-cardhead"><h3>Master stock — ready to ship</h3><button type="button" class="ghost pr-small no-print" data-bbgo="master">All →</button></div>
          ${mst.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Item</th><th class="r">Available</th><th class="r">Built</th><th class="r">Shipped</th></tr></thead><tbody>
          ${mst.map(m=>`<tr><td><b>${esc(m.itemCode)}</b><div class="pr-small-t">${esc(m.company)}</div></td><td class="r ${stockTone(n(m.qtyAvailable))}"><b>${int(m.qtyAvailable)}</b></td><td class="r">${int(m.qtyBuilt)}</td><td class="r">${int(m.qtyShipped)}</td></tr>`).join('')}
          </tbody></table></div>`:empty('No production runs recorded yet.')}</div>
        <div class="card pr-card"><div class="pr-cardhead"><h3>Components needing attention</h3><button type="button" class="ghost pr-small no-print" data-bbgo="components">All →</button></div>
          ${crit.length+low.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Code</th><th class="r">On hand</th><th class="r">Low / critical</th><th></th></tr></thead><tbody>
          ${crit.concat(low).map(c=>`<tr><td><b>${esc(c.code)}</b><div class="pr-small-t">${esc(c.description)}</div></td><td class="r">${int(c.quantity)}</td><td class="r">${int(c.lowThreshold)} / ${int(c.criticalThreshold)}</td><td>${levelBadge(c)}</td></tr>`).join('')}
          </tbody></table></div>`:empty('All components healthy.')}</div>
      </div>
      <div class="card pr-card"><div class="pr-cardhead"><h3>Recent shipments</h3><button type="button" class="ghost pr-small no-print" data-bbgo="shipments">All →</button></div>
        ${recent.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Date</th><th>Customer</th><th>Item</th><th class="r">Qty</th><th>FedEx tracking / LD</th><th>Shipped by</th></tr></thead><tbody>
        ${recent.map(s=>`<tr><td class="nw">${esc(s.date)}</td><td><b>${esc(s.customer)}</b></td><td>${esc(s.item)}</td><td class="r">${int(s.qtyShipped)}</td><td>${trackStack(s.tracking,s.ldNumbers)}</td><td class="pr-small-t">${esc(s.shippedBy)}</td></tr>`).join('')}
        </tbody></table></div>`:empty('No shipments recorded yet.')}</div>
      <div class="sr-two sr-even">
        <div class="card pr-card"><h3>Shipments — last 7 days</h3><div class="bb-bars">${week.map(w=>`<div class="bb-bar"><i style="height:${Math.round(w.count/wmax*100)}%"></i><b>${w.count||''}</b><span>${esc(w.day)}</span></div>`).join('')}</div></div>
        <div class="card pr-card"><h3>Top items shipped (units)</h3>${top.length?top.map(t=>`<div class="bb-hbar"><span>${esc(t.item)}</span><i><em style="width:${Math.round(t.count/tmax*100)}%"></em></i><b>${int(t.count)}</b></div>`).join(''):empty('No shipment data yet.')}</div>
      </div>`;
    $('bbBody').querySelectorAll('[data-bbgo]').forEach(b=>b.onclick=()=>go(b.dataset.bbgo));
  }

  // ================================================================ ORDERS (+ ship)
  const FILTERS=['Open','Pending','Shipped','Cancelled','All'];
  function renderOrders(){
    const rows=D.openOrders.filter(o=>(orderFilter==='All'||(o.status||'Open')===orderFilter)&&has(orderQ.trim().toLowerCase(),o.poNumber,o.customer,o.itemName,o.address));
    const count=f=>f==='All'?D.openOrders.length:D.openOrders.filter(o=>(o.status||'Open')===f).length;
    $('bbBody').innerHTML=`${shipPO?shipPanel():''}${orderForm?orderFormHtml():''}
      <div class="card pr-card"><div class="pr-cardhead"><h3>Orders <span class="pr-count">· ${rows.length}</span></h3>
        <div class="pr-dashact no-print"><button type="button" class="ghost pr-small" id="bbOX">Excel</button>${canEdit()?'<button type="button" class="pr-small" id="bbONew">+ New order</button>':''}</div></div>
        <div class="pr-dashbar no-print"><div class="pr-presets">${FILTERS.map(f=>`<button type="button" class="pr-preset${orderFilter===f?' on':''}" data-bbof="${f}">${f} (${count(f)})</button>`).join('')}</div></div>
        <input type="search" id="bbOQ" class="no-print" placeholder="Search PO, customer, item or address" value="${esc(orderQ)}" aria-label="Search orders">
        <div id="bbOTable"></div></div>`;
    const draw=()=>{
      const q2=orderQ.trim().toLowerCase(), list=D.openOrders.filter(o=>(orderFilter==='All'||(o.status||'Open')===orderFilter)&&has(q2,o.poNumber,o.customer,o.itemName,o.address));
      $('bbOTable').innerHTML=list.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>PO #</th><th>Customer</th><th>Item</th><th class="r">Qty</th><th>Status</th><th>Priority</th><th class="r">Built, ready</th><th>Ordered</th><th class="no-print"></th></tr></thead><tbody>
        ${list.map(o=>{ const st=o.status||'Open', open=st==='Open'||st==='Pending', need=n(o.dueQuantity||o.orderQuantity), a=avail(o.itemName);
          return `<tr${shipPO===o.poNumber?' class="bb-on"':''}><td><b>${esc(o.poNumber)}</b></td><td><b>${esc(o.customer)}</b>${o.address?`<div class="pr-small-t">${esc(o.address)}</div>`:''}${o.notes?`<div class="pr-small-t">${esc(o.notes)}</div>`:''}</td>
            <td>${esc(o.itemName)}</td><td class="r">${int(need)}</td>
            <td>${badge(st,st==='Shipped'?'good':st==='Cancelled'?'bad':'warn')}</td>
            <td>${o.priorityLevel==='Rush'?badge('Rush','bad'):o.priorityLevel==='High'?badge('High','warn'):esc(o.priorityLevel||'Normal')}</td>
            <td class="r">${open?`<b class="${a>=need?'sr-good':'sr-low'}">${int(a)}</b>`:''}</td><td class="nw">${esc(String(o.orderDate||'').slice(0,10))}</td>
            <td class="nw no-print">${open&&canEdit()?`<button type="button" class="pr-small" data-bbship="${esc(o.poNumber)}">Ship</button> <button type="button" class="ghost pr-small" data-bbedit="${esc(o.poNumber)}">Edit</button> <button type="button" class="ghost pr-small pr-danger" data-bbcancel="${esc(o.poNumber)}">Cancel</button>`:''}</td></tr>`; }).join('')}
        </tbody></table></div>`:empty('No orders found.');
      $('bbOTable').querySelectorAll('[data-bbship]').forEach(b=>b.onclick=()=>{ shipPO=b.dataset.bbship; orderForm=null; msg(''); renderOrders(); window.scrollTo(0,0); });
      $('bbOTable').querySelectorAll('[data-bbedit]').forEach(b=>b.onclick=()=>{ const o=D.openOrders.find(x=>x.poNumber===b.dataset.bbedit); if(!o) return;
        orderForm={isNew:false,poNumber:o.poNumber,customer:o.customer,address:o.address,itemName:o.itemName,qty:String(n(o.dueQuantity||o.orderQuantity)||1),priority:o.priorityLevel||'Normal',notes:o.notes}; shipPO=''; renderOrders(); window.scrollTo(0,0); });
      $('bbOTable').querySelectorAll('[data-bbcancel]').forEach(b=>b.onclick=()=>{ const po=b.dataset.bbcancel;
        if(!confirm('Cancel order '+po+'?\n\nThe cancellation email goes to the usual list.')) return;
        if(shipPO===po) shipPO=''; save(b,'cancelOrder',{poNumber:po}); });
    };
    draw();
    $('bbOQ').oninput=e=>{ orderQ=e.target.value; draw(); };
    $('bbBody').querySelectorAll('[data-bbof]').forEach(b=>b.onclick=()=>{ orderFilter=b.dataset.bbof; renderOrders(); });
    const nb=$('bbONew'); if(nb) nb.onclick=()=>{ orderForm={isNew:true,poNumber:'',customer:'',address:'',itemName:'',qty:'1',priority:'Normal',notes:''}; shipPO=''; renderOrders(); };
    $('bbOX').onclick=()=>excel('battery_box_orders_'+ymd(new Date())+'.xlsx','Orders',['Order Date','PO Number','Item','Order Qty','Shipped Qty','Due Qty','Customer','Priority','Status','Address','Notes'],
      D.openOrders.filter(o=>(orderFilter==='All'||(o.status||'Open')===orderFilter)&&has(orderQ.trim().toLowerCase(),o.poNumber,o.customer,o.itemName,o.address)).map(o=>[String(o.orderDate||'').slice(0,10),o.poNumber,o.itemName,n(o.orderQuantity),n(o.shippedQty),n(o.dueQuantity),o.customer,o.priorityLevel,o.status,o.address,o.notes]),[3,4,5]);
    if(orderForm) wireOrderForm();
    if(shipPO) wireShip();
  }

  function orderFormHtml(){
    const f=orderForm;
    return `<div class="card pr-card pr-formcard no-print"><div class="pr-cardhead"><h3>${f.isNew?'New order':'Edit order — '+esc(f.poNumber)}</h3><button type="button" class="ghost pr-small" id="bbOFClose">Close</button></div>
      <div class="pr-grid2">
        <label>PO Number *<input id="bbOFpo" value="${esc(f.poNumber)}"${f.isNew?'':' disabled'} autocomplete="off"></label>
        <label>Priority<select id="bbOFpr">${['Normal','High','Rush'].map(p=>`<option${p===f.priority?' selected':''}>${p}</option>`).join('')}</select></label>
        <label>Customer *<select id="bbOFcs"><option value="">— Pick a saved customer, or type below —</option>${D.customers.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}${c.city?' — '+esc(c.city):''}</option>`).join('')}</select>
          <input id="bbOFcu" value="${esc(f.customer)}" placeholder="Customer name" style="margin-top:6px"></label>
        <label>Ship-to address<input id="bbOFad" value="${esc(f.address)}" placeholder="Address"></label>
        <label>Item (BOM) *<select id="bbOFit">${itemOptions(f.itemName)}</select></label>
        <label>Order quantity *<input id="bbOFq" type="number" min="1" step="1" inputmode="numeric" value="${esc(f.qty)}"></label>
      </div>
      <label>Notes<input id="bbOFn" value="${esc(f.notes)}" placeholder="Special instructions…"></label>
      <div class="actions"><button type="button" id="bbOFSave">${f.isNew?'Create order':'Save changes'}</button></div></div>`;
  }
  function wireOrderForm(){
    $('bbOFClose').onclick=()=>{ orderForm=null; renderOrders(); };
    $('bbOFcs').onchange=e=>{ const c=D.customers.find(x=>x.name===e.target.value); if(c){ $('bbOFcu').value=c.name; $('bbOFad').value=[c.address,c.city].filter(Boolean).join(', '); } };
    $('bbOFSave').onclick=()=>{
      const a={isNew:orderForm.isNew,poNumber:$('bbOFpo').value.trim(),customer:$('bbOFcu').value.trim(),address:$('bbOFad').value.trim(),
        itemName:$('bbOFit').value,qty:$('bbOFq').value,priority:$('bbOFpr').value,notes:$('bbOFn').value.trim()};
      if(!a.poNumber) return toast('PO Number is required.'); if(!a.customer) return toast('Customer is required.');
      if(!a.itemName) return toast('Pick the item.'); if(!(n(a.qty)>0)) return toast('Enter the order quantity.');
      save($('bbOFSave'),'saveOrder',a,()=>{ orderForm=null; orderFilter='Open'; });
    };
  }

  function shipPanel(){
    const o=D.openOrders.find(x=>x.poNumber===shipPO); if(!o){ shipPO=''; return ''; }
    const qty=n(o.dueQuantity||o.orderQuantity)||1, a=avail(o.itemName), ok=a>=qty;
    let rows=''; for(let i=0;i<qty;i++) rows+=`<div class="bb-trkrow"><span>Box ${i+1}</span><input data-bbt="${i}" placeholder="FedEx tracking #" autocomplete="off" autocapitalize="characters" spellcheck="false"><input data-bbl="${i}" placeholder="LD number" autocomplete="off" autocapitalize="characters" spellcheck="false"><button type="button" class="ghost pr-small" data-bbclr="${i}" tabindex="-1" aria-label="Clear box ${i+1}">✕</button></div>`;
    return `<div class="card pr-card pr-formcard no-print"><div class="pr-cardhead"><h3>Ship order ${esc(o.poNumber)}</h3><button type="button" class="ghost pr-small" id="bbSClose">Close</button></div>
      <div class="bb-shipsum"><div><b>${esc(o.customer)}</b><div class="pr-small-t">${esc(o.address)}</div><div>${esc(o.itemName)}</div></div><div class="bb-big">${int(qty)}<small>boxes / units</small></div></div>
      <div class="pr-msg ${ok?'pr-msg-good':'pr-msg-bad'}">Master stock for ${esc(o.itemName)}: <b>${int(a)}</b> built and ready. ${ok?'Enough to ship this order.':'Not enough — record a build run first (Build tab).'}</div>
      ${ok?`<div class="bb-trkhead"><span></span><span>FedEx tracking</span><span>LD number</span><span></span></div>
      <div class="bb-prog"><i><em id="bbSProg"></em></i><b id="bbSProgT">0 / ${qty}</b></div>
      <div id="bbSRows">${rows}</div>
      <p class="hint">Scan or type each box. Enter jumps to the next field.</p>
      <div class="pr-grid2"><label>Shipped by *<input id="bbSBy" value="${esc(ME?ME.name:'')}"></label><label>Notes<input id="bbSN" placeholder="Optional"></label></div>
      <div class="actions"><button type="button" id="bbSSave">Ship order</button></div>`:`<div class="actions"><button type="button" id="bbSBuild">Go to Build</button></div>`}
    </div>`;
  }
  function wireShip(){
    $('bbSClose').onclick=()=>{ shipPO=''; renderOrders(); };
    const o=D.openOrders.find(x=>x.poNumber===shipPO); if(!o) return;
    const gb=$('bbSBuild'); if(gb){ gb.onclick=()=>{ prod.item=o.itemName; prod.qty=String(Math.max(1,n(o.dueQuantity||o.orderQuantity)-avail(o.itemName))); go('build'); }; return; }
    const qty=n(o.dueQuantity||o.orderQuantity)||1, box=$('bbSRows');
    const prog=()=>{ const f=[...box.querySelectorAll('[data-bbt]')].filter(i=>i.value.trim()).length; $('bbSProg').style.width=Math.round(f/qty*100)+'%'; $('bbSProg').classList.toggle('done',f===qty); $('bbSProgT').textContent=f+' / '+qty; };
    box.addEventListener('input',e=>{ const t=e.target; if(t.matches('input')){ t.value=t.value.replace(/[\s|]+/g,''); t.classList.toggle('bb-filled',!!t.value); prog(); } });
    box.addEventListener('keydown',e=>{ if(e.key!=='Enter') return; const t=e.target; if(!t.matches('input')) return; e.preventDefault();
      const nx=t.dataset.bbt!=null?box.querySelector(`[data-bbl="${t.dataset.bbt}"]`):box.querySelector(`[data-bbt="${+t.dataset.bbl+1}"]`);
      (nx||$('bbSBy')).focus(); if(nx) nx.select(); });
    box.addEventListener('click',e=>{ const b=e.target.closest('[data-bbclr]'); if(!b) return; const i=b.dataset.bbclr;
      [box.querySelector(`[data-bbt="${i}"]`),box.querySelector(`[data-bbl="${i}"]`)].forEach(x=>{ x.value=''; x.classList.remove('bb-filled'); }); prog(); box.querySelector(`[data-bbt="${i}"]`).focus(); });
    setTimeout(()=>{ const f=box.querySelector('[data-bbt="0"]'); if(f) f.focus(); },60);
    $('bbSSave').onclick=()=>{
      const trk=[...box.querySelectorAll('[data-bbt]')].map(i=>i.value.trim()), ld=[...box.querySelectorAll('[data-bbl]')].map(i=>i.value.trim());
      const filled=trk.filter(Boolean).length, by=$('bbSBy').value.trim();
      if(!filled) return toast('Enter at least one FedEx tracking number.');
      const orphan=ld.findIndex((l,i)=>l&&!trk[i]); if(orphan>=0) return toast('Box '+(orphan+1)+' has an LD number but no tracking number.');
      const dup=trk.filter(Boolean).find((t,i,a)=>a.indexOf(t)!==i); if(dup) return toast('Tracking '+dup+' is entered twice.');
      if(!by) return toast('Enter who is shipping.');
      if(filled<qty&&!confirm(filled+' of '+qty+' boxes have tracking. Ship anyway?')) return;
      if(!confirm('Ship '+o.poNumber+' — '+int(qty)+' × '+o.itemName+' to '+o.customer+'?\n\nThis takes '+int(qty)+' built units out of master stock and sends the shipment email.')) return;
      save($('bbSSave'),'ship',{poNumber:o.poNumber,tracking:trk,ldNumbers:ld,shippedBy:by,notes:$('bbSN').value.trim()},()=>{ shipPO=''; });
    };
  }

  // ================================================================ BUILD (production runs)
  function renderBuild(){
    const capList=D.buildCapacity, q=prodQ.trim().toLowerCase();
    $('bbBody').innerHTML=`<div class="sr-two">
      <div class="card pr-card pr-formcard no-print"><h3>Record build run</h3>
        <p class="hint">Components come out of stock here — not at ship time. Built units go into master stock, ready to ship.</p>
        ${canEdit()?`<label>Item to build *<select id="bbPItem">${itemOptions(prod.item,'Select BOM item…')}</select></label>
        <label>Quantity to build *<input id="bbPQty" type="number" min="1" step="1" inputmode="numeric" value="${esc(prod.qty)}"></label>
        <div id="bbPPrev"></div>
        <label>Built by *<input id="bbPBy" value="${esc(prod.by||(ME?ME.name:''))}" placeholder="Person or team"></label>
        <label>Notes<input id="bbPN" value="${esc(prod.notes)}" placeholder="Optional batch notes…"></label>
        <div class="actions"><button type="button" id="bbPSave">Record build run</button></div>`:'<p class="hint">Your access is view-only.</p>'}
      </div>
      <div class="card pr-card"><div class="pr-cardhead"><h3>What can be built now</h3></div>
        ${capList.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Item</th><th class="r">Can build</th><th class="r">Built, ready</th><th>Limited by</th></tr></thead><tbody>
        ${capList.map(c=>{ const lim=(c.components||[]).slice().sort((a,b)=>a.canMake-b.canMake)[0];
          return `<tr class="si-click" data-bbcap="${esc(c.item)}"><td><b>${esc(c.item)}</b><div class="pr-small-t">${esc(String(c.description||'').slice(0,50))}</div></td><td class="r"><b class="${c.maxBuildable>0?'sr-good':'sr-low'}">${int(c.maxBuildable)}</b></td><td class="r">${int(c.qtyAvailable)}</td><td class="pr-small-t">${lim?esc(lim.code)+' ('+int(lim.onHand)+' on hand, '+int(lim.qtyPerUnit)+' each)':'—'}</td></tr>`; }).join('')}
        </tbody></table></div><p class="hint no-print">Tap an item to start a build for it.</p>`:empty('No BOM items set up yet.')}
      </div></div>
      <div class="card pr-card"><div class="pr-cardhead"><h3>Production log</h3><div class="pr-dashact no-print"><button type="button" class="ghost pr-small" id="bbPX">Excel</button></div></div>
        <input type="search" id="bbPQ" class="no-print" placeholder="Search item, who or notes" value="${esc(prodQ)}" aria-label="Search production log"><div id="bbPLog"></div></div>`;
    const drawLog=()=>{ const q2=prodQ.trim().toLowerCase(), rows=D.productionLog.filter(r=>has(q2,r.itemCode,r.builtBy,r.notes,r.date,r.description));
      $('bbPLog').innerHTML=rows.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Date</th><th>Item</th><th class="r">Qty built</th><th>Built by</th><th>Components used</th><th>Notes</th></tr></thead><tbody>
        ${rows.slice(0,200).map(r=>`<tr><td class="nw">${esc(r.date)}</td><td><b>${esc(r.itemCode)}</b></td><td class="r">${int(r.qtyBuilt)}</td><td>${esc(r.builtBy)}</td><td class="pr-small-t">${esc(r.components)}</td><td class="pr-small-t">${esc(r.notes)}</td></tr>`).join('')}
        </tbody></table></div>${rows.length>200?'<p class="hint">Showing the newest 200 — search or use Excel for the rest.</p>':''}`:empty(D.productionLog.length?'Nothing matches.':'No production runs recorded yet.'); };
    drawLog(); $('bbPQ').oninput=e=>{ prodQ=e.target.value; drawLog(); };
    $('bbPX').onclick=()=>excel('battery_box_production_'+ymd(new Date())+'.xlsx','Production Log',['Log ID','Date','Item','Description','Qty Built','Built By','Components Used','Notes'],
      D.productionLog.map(r=>[r.logId,r.date,r.itemCode,r.description,n(r.qtyBuilt),r.builtBy,r.components,r.notes]),[4]);
    $('bbBody').querySelectorAll('[data-bbcap]').forEach(r=>r.onclick=()=>{ if(!canEdit()) return; prod.item=r.dataset.bbcap; renderBuild(); window.scrollTo(0,0); });
    if(!canEdit()) return;
    const keep=()=>{ prod.item=$('bbPItem').value; prod.qty=$('bbPQty').value; prod.by=$('bbPBy').value; prod.notes=$('bbPN').value; };
    const prev=()=>{ keep(); const box=$('bbPPrev'), item=bom(prod.item), qty=Math.floor(n(prod.qty));
      if(!item){ box.innerHTML=''; return; }
      const rows=needsFor(item,Math.max(qty,0)), c=cap(item.item), short=rows.filter(r=>r.after<0);
      box.innerHTML=`<div class="bb-capline"><span>Can build now <b class="${c&&c.maxBuildable>0?'sr-good':'sr-low'}">${int(c?c.maxBuildable:0)}</b></span><span>Built, ready <b>${int(avail(item.item))}</b></span></div>
        ${qty>0?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Component</th><th class="r">Each</th><th class="r">Needed</th><th class="r">On hand</th><th class="r">After</th></tr></thead><tbody>
        ${rows.map(r=>`<tr${r.after<0?' class="sr-inel"':''}><td><b>${esc(r.code)}</b><div class="pr-small-t">${esc(r.description)}</div></td><td class="r">${int(r.per)}</td><td class="r">${int(r.need)}</td><td class="r">${r.listed?int(r.have):badge('Not on Inventory tab','bad')}</td><td class="r ${r.after<0?'sr-low':''}">${r.after<0?'−'+int(-r.after):int(r.after)}</td></tr>`).join('')}
        </tbody></table></div>`:''}
        ${short.length&&qty>0?`<div class="pr-msg pr-msg-bad">Not enough of ${short.map(r=>esc(r.code)).join(', ')} to build ${int(qty)}. Receive stock or fix the count on the Components tab first.</div>`:''}`; };
    $('bbPItem').onchange=prev; $('bbPQty').oninput=prev; $('bbPBy').oninput=keep; $('bbPN').oninput=keep; prev();
    $('bbPSave').onclick=()=>{
      keep(); const item=bom(prod.item), qty=n(prod.qty);
      if(!item) return toast('Pick the item that was built.');
      if(!(qty>0)||Math.floor(qty)!==qty) return toast('Enter the quantity built as a whole number.');
      if(!prod.by.trim()) return toast('Enter who built it.');
      const short=needsFor(item,qty).filter(r=>r.after<0); if(short.length) return toast('Not enough components — see the list.');
      if(!confirm('Record '+int(qty)+' × '+item.item+'?\n\nThis takes '+plural(needsFor(item,qty).length,'component')+' out of stock and adds '+int(qty)+' to master stock.')) return;
      save($('bbPSave'),'build',{itemCode:item.item,qty,builtBy:prod.by.trim(),notes:prod.notes.trim()},()=>{ prod={item:'',qty:'1',by:'',notes:''}; });
    };
  }

  // ================================================================ MASTER STOCK
  function renderMaster(){
    $('bbBody').innerHTML=`<div class="card pr-card"><div class="pr-cardhead"><h3>Master stock — built units</h3><div class="pr-dashact no-print"><button type="button" class="ghost pr-small" id="bbMX">Excel</button></div></div>
      <input type="search" id="bbMQ" class="no-print" placeholder="Search items" value="${esc(msQ)}" aria-label="Search master stock"><div id="bbMGrid" class="bb-grid"></div></div>`;
    const draw=()=>{ const q=msQ.trim().toLowerCase();
      const items=D.bomItems.map(b=>({b,m:ms(b.item),c:cap(b.item)})).concat(D.masterStock.filter(m=>!bom(m.itemCode)).map(m=>({b:null,m,c:null})))
        .filter(x=>has(q,x.b?x.b.item:x.m.itemCode,x.b?x.b.description:x.m.description,x.b?x.b.company:x.m.company));
      $('bbMGrid').innerHTML=items.length?items.map(({b,m,c})=>{ const code=b?b.item:m.itemCode, a=m?n(m.qtyAvailable):0;
        return `<div class="bb-ms ${!m?'bb-ms-none':a<=0?'bb-ms-zero':a<5?'bb-ms-low':'bb-ms-ok'}">
          <div class="bb-ms-code">${esc(code)}</div><div class="pr-small-t">${esc((b?b.description:m.description)||'—')}${(b?b.company:m.company)?' · '+esc(b?b.company:m.company):''}</div>
          ${m?`<div class="bb-ms-stats"><div><span>Available</span><b class="${stockTone(a)}">${int(a)}</b></div><div><span>Built</span><b>${int(m.qtyBuilt)}</b></div><div><span>Shipped</span><b>${int(m.qtyShipped)}</b></div></div>`:'<p class="hint">No build runs recorded yet.</p>'}
          ${c?`<div class="pr-small-t">Can build <b class="${c.maxBuildable>0?'sr-good':'sr-low'}">${int(c.maxBuildable)}</b> more from components</div>`:''}
          ${m&&m.lastBuilt?`<div class="pr-small-t">Last built ${esc(m.lastBuilt)}${m.lastShipped?' · last shipped '+esc(m.lastShipped):''}</div>`:''}
          ${b&&canEdit()?`<button type="button" class="ghost pr-small no-print" data-bbbuild="${esc(code)}">Record build</button>`:''}</div>`; }).join(''):empty('No BOM items match.');
      $('bbMGrid').querySelectorAll('[data-bbbuild]').forEach(x=>x.onclick=()=>{ prod.item=x.dataset.bbbuild; go('build'); }); };
    draw(); $('bbMQ').oninput=e=>{ msQ=e.target.value; draw(); };
    $('bbMX').onclick=()=>excel('battery_box_master_stock_'+ymd(new Date())+'.xlsx','Master Stock',['Item Code','Description','Company','Qty Built','Qty Shipped','Qty Available','Last Built','Last Shipped'],
      D.masterStock.map(m=>[m.itemCode,m.description,m.company,n(m.qtyBuilt),n(m.qtyShipped),n(m.qtyAvailable),m.lastBuilt,m.lastShipped]),[3,4,5]);
  }

  // ================================================================ COMPONENTS (stock / receive / new)
  function renderComponents(){
    const subs=[['stock','Stock'],['receive','Receive stock'],['new','New component']];
    $('bbBody').innerHTML=`<div class="pr-presets pr-subtabs no-print" id="bbCSub">${subs.map(([k,l])=>`<button type="button" class="pr-preset${compSub===k?' on':''}" data-bbcs="${k}">${l}</button>`).join('')}</div><div id="bbCBody"></div>`;
    $('bbCSub').onclick=e=>{ const b=e.target.closest('[data-bbcs]'); if(b){ compSub=b.dataset.bbcs; msg(''); renderComponents(); } };
    ({stock:compStock,receive:compReceive,new:compNew})[compSub]();
  }
  function compStock(){
    const crit=D.components.filter(c=>level(c)==='critical').length, low=D.components.filter(c=>level(c)==='low').length;
    $('bbCBody').innerHTML=`<div class="pr-tiles bb-tiles"><div class="pr-tile"><span>Components</span><b>${D.components.length}</b></div><div class="pr-tile${crit?' accent':''}"><span>Critical</span><b>${crit}</b></div><div class="pr-tile${low?' accent':''}"><span>Low</span><b>${low}</b></div><div class="pr-tile"><span>Healthy</span><b>${D.components.length-crit-low}</b></div></div>
      <div class="card pr-card"><div class="pr-cardhead"><h3>Component stock</h3><div class="pr-dashact no-print"><button type="button" class="ghost pr-small" id="bbCX">Excel</button></div></div>
        <div class="pr-dashbar no-print"><div class="pr-presets">${[['all','All'],['attn','Needs attention'],['critical','Critical'],['low','Low'],['ok','Healthy']].map(([k,l])=>`<button type="button" class="pr-preset${compOnly===k?' on':''}" data-bbco="${k}">${l}</button>`).join('')}</div></div>
        <input type="search" id="bbCQ" class="no-print" placeholder="Search code or description" value="${esc(compQ)}" aria-label="Search components"><div id="bbCTable"></div></div>`;
    const draw=()=>{ const q=compQ.trim().toLowerCase();
      const rows=D.components.filter(c=>has(q,c.code,c.description)&&(compOnly==='all'||(compOnly==='attn'?level(c)!=='ok':level(c)===compOnly)));
      $('bbCTable').innerHTML=rows.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Code</th><th>Description</th><th class="r">On hand</th><th class="r">Reserved</th><th class="r">Low</th><th class="r">Critical</th><th></th><th>Updated</th><th class="no-print"></th></tr></thead><tbody>
        ${rows.map(c=>`<tr${level(c)==='critical'?' class="sr-inel"':''}><td><b>${esc(c.code)}</b></td><td>${esc(c.description)}</td><td class="r"><b>${int(c.quantity)}</b></td><td class="r">${int(c.reserved)}</td><td class="r">${int(c.lowThreshold)}</td><td class="r">${int(c.criticalThreshold)}</td><td>${levelBadge(c)}</td><td class="nw pr-small-t">${esc(String(c.lastUpdated||'').slice(0,10))}</td>
          <td class="nw no-print">${canEdit()?`<button type="button" class="ghost pr-small" data-bbcnt="${esc(c.code)}">Set count</button> <button type="button" class="ghost pr-small" data-bblim="${esc(c.code)}">Limits</button>`:''}</td></tr>
          ${compEdit===c.code?`<tr class="si-detail no-print"><td colspan="9">${compEditMode==='count'?`<div class="si-editrow"><label>New count for ${esc(c.code)}<input id="bbCNew" type="number" min="0" step="1" inputmode="numeric" value="${esc(int(c.quantity).replace(/,/g,''))}"></label><label>Reason <span class="hint">(goes on the Stock_Log tab)</span><input id="bbCNote" maxlength="300" placeholder="e.g. Cycle count"></label><div class="sr-calc" id="bbCCalc"></div><div class="actions"><button type="button" id="bbCSave">Save count</button> <button type="button" class="ghost" id="bbCCancel">Cancel</button></div></div>`
            :`<div class="si-editrow"><label>Low limit<input id="bbLLow" type="number" min="0" step="1" value="${esc(n(c.lowThreshold))}"></label><label>Critical limit<input id="bbLCrit" type="number" min="0" step="1" value="${esc(n(c.criticalThreshold))}"></label><div class="actions"><button type="button" id="bbLSave">Save limits</button> <button type="button" class="ghost" id="bbCCancel">Cancel</button></div></div>`}</td></tr>`:''}`).join('')}
        </tbody></table></div><p class="hint">To add stock that came in on a PO, use <b>Receive stock</b> (it keeps the receiving log). Set count is for corrections.</p>`:empty('No components match.');
      $('bbCTable').querySelectorAll('[data-bbcnt]').forEach(b=>b.onclick=()=>{ compEdit=b.dataset.bbcnt; compEditMode='count'; draw(); const f=$('bbCNew'); if(f){ f.focus(); f.select(); } });
      $('bbCTable').querySelectorAll('[data-bblim]').forEach(b=>b.onclick=()=>{ compEdit=b.dataset.bblim; compEditMode='limits'; draw(); });
      const cc=$('bbCCancel'); if(cc) cc.onclick=()=>{ compEdit=''; draw(); };
      const c=comp(compEdit);
      const cs=$('bbCSave'); if(cs&&c){ const calc=()=>{ const v=$('bbCNew').value; $('bbCCalc').textContent=v===''?'':int(c.quantity)+' now → '+int(v)+' ('+(n(v)-n(c.quantity)>=0?'+':'')+int(n(v)-n(c.quantity))+')'; }; $('bbCNew').oninput=calc; calc();
        cs.onclick=()=>{ const v=$('bbCNew').value; if(v===''||n(v)<0||Math.floor(n(v))!==n(v)) return toast('Enter the count as a whole number.');
          save(cs,'setStock',{code:c.code,quantity:n(v),note:$('bbCNote').value.trim()},()=>{ compEdit=''; }); }; }
      const lsb=$('bbLSave'); if(lsb&&c) lsb.onclick=()=>{ const lo=$('bbLLow').value, cr=$('bbLCrit').value;
        if(lo===''||cr==='') return toast('Enter both limits.'); if(n(cr)>n(lo)) return toast('Critical should be at or below Low.');
        save(lsb,'setLimits',{code:c.code,low:n(lo),critical:n(cr)},()=>{ compEdit=''; }); };
    };
    draw(); $('bbCQ').oninput=e=>{ compQ=e.target.value; draw(); };
    $('bbCBody').querySelectorAll('[data-bbco]').forEach(b=>b.onclick=()=>{ compOnly=b.dataset.bbco; compStock(); });
    $('bbCX').onclick=()=>excel('battery_box_components_'+ymd(new Date())+'.xlsx','Components',['Code','Description','Quantity','Reserved','Low Threshold','Critical Threshold','Status','Last Updated'],
      D.components.map(c=>[c.code,c.description,n(c.quantity),n(c.reserved),n(c.lowThreshold),n(c.criticalThreshold),level(c),String(c.lastUpdated||'').slice(0,10)]),[2,3,4,5]);
  }
  function compReceive(){
    $('bbCBody').innerHTML=`<div class="sr-two">
      <div class="card pr-card pr-formcard no-print"><h3>Receive stock</h3>${canEdit()?`
        <label>Component *<select id="bbRC">${compOptions('')}</select></label><div id="bbRInfo" class="pr-small-t"></div>
        <div class="pr-grid2"><label>PO Number *<input id="bbRPo" placeholder="e.g. PO-2026-0042"></label><label>Vendor / supplier<input id="bbRV"></label>
        <label>Quantity received *<input id="bbRQ" type="number" min="1" step="1" inputmode="numeric"></label><label>Unit cost ($)<input id="bbRU" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label></div>
        <div class="sr-calc" id="bbRCalc"></div>
        <div class="pr-grid2"><label>Received by<input id="bbRBy" value="${esc(ME?ME.name:'')}"></label><label>Notes<input id="bbRN"></label></div>
        <div class="actions"><button type="button" id="bbRSave">Receive + update inventory</button></div>`:'<p class="hint">Your access is view-only.</p>'}</div>
      <div class="card pr-card"><div class="pr-cardhead"><h3>Receiving history</h3><div class="pr-dashact no-print"><button type="button" class="ghost pr-small" id="bbRX">Excel</button></div></div>
        ${D.receivingLog.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Date</th><th>Component</th><th>PO #</th><th>Vendor</th><th class="r">Qty</th><th class="r">Total</th><th>By</th></tr></thead><tbody>
        ${D.receivingLog.slice(0,150).map(r=>`<tr><td class="nw">${esc(r.date)}</td><td><b>${esc(r.componentCode)}</b></td><td>${esc(r.poNumber)}</td><td>${esc(r.vendor)}</td><td class="r sr-good">+${int(r.qtyReceived)}</td><td class="r">${money(r.totalCost)}</td><td class="pr-small-t">${esc(r.receivedBy)}</td></tr>`).join('')}
        </tbody></table></div>`:empty('No receiving records yet.')}</div></div>`;
    $('bbRX').onclick=()=>excel('battery_box_receiving_'+ymd(new Date())+'.xlsx','Receiving',['Log ID','Date','Component','Component Name','PO Number','Vendor','Qty Received','Unit Cost','Total Cost','Received By','Notes'],
      D.receivingLog.map(r=>[r.id,r.date,r.componentCode,r.componentName,r.poNumber,r.vendor,n(r.qtyReceived),n(r.unitCost),n(r.totalCost),r.receivedBy,r.notes]),[6,7,8]);
    if(!canEdit()) return;
    const calc=()=>{ const c=comp($('bbRC').value), q=n($('bbRQ').value), u=n($('bbRU').value);
      $('bbRInfo').innerHTML=c?`On hand now <b>${int(c.quantity)}</b> · low ${int(c.lowThreshold)} · critical ${int(c.criticalThreshold)}`:'';
      $('bbRCalc').textContent=c&&q>0?`${int(c.quantity)} → ${int(n(c.quantity)+q)}`+(u>0?` · total ${money(q*u)}`:''):''; };
    ['bbRC','bbRQ','bbRU'].forEach(id=>$(id).addEventListener('input',calc)); $('bbRC').onchange=calc;
    $('bbRSave').onclick=()=>{
      const a={componentCode:$('bbRC').value,poNumber:$('bbRPo').value.trim(),vendor:$('bbRV').value.trim(),qtyReceived:$('bbRQ').value,unitCost:$('bbRU').value||0,receivedBy:$('bbRBy').value.trim(),notes:$('bbRN').value.trim()};
      if(!a.componentCode) return toast('Pick the component.'); if(!a.poNumber) return toast('PO Number is required.');
      if(!(n(a.qtyReceived)>0)||Math.floor(n(a.qtyReceived))!==n(a.qtyReceived)) return toast('Enter the quantity received as a whole number.');
      save($('bbRSave'),'receive',a);
    };
  }
  function compNew(){
    $('bbCBody').innerHTML=`<div class="card pr-card pr-formcard pr-narrow no-print"><h3>New component</h3>${canEdit()?`
      <div class="pr-grid2"><label>Component code *<input id="bbNCc" placeholder="e.g. S19845"></label><label>Starting quantity<input id="bbNCq" type="number" min="0" step="1" value="0"></label></div>
      <label>Description *<input id="bbNCd" placeholder="e.g. 18x14x14 Corrugated Box (25/bdl)"></label>
      <div class="pr-grid2"><label>Low limit<input id="bbNCl" type="number" min="0" step="1" value="10"></label><label>Critical limit<input id="bbNCx" type="number" min="0" step="1" value="10"></label></div>
      <div class="actions"><button type="button" id="bbNCSave">Add component</button></div>`:'<p class="hint">Your access is view-only.</p>'}</div>`;
    if(!canEdit()) return;
    $('bbNCSave').onclick=()=>{
      const a={code:$('bbNCc').value.trim(),description:$('bbNCd').value.trim(),quantity:$('bbNCq').value||0,low:$('bbNCl').value,critical:$('bbNCx').value};
      if(!a.code) return toast('Component code is required.'); if(!a.description) return toast('Description is required.');
      if(comp(a.code)||D.components.some(c=>c.code.toLowerCase()===a.code.toLowerCase())) return toast(a.code+' already exists.');
      if(n(a.critical)>n(a.low)) return toast('Critical should be at or below Low.');
      save($('bbNCSave'),'addComponent',a,()=>{ compSub='stock'; compQ=a.code; });
    };
  }

  // ================================================================ BOM
  function renderBom(){
    const item=bom(bomSel);
    $('bbBody').innerHTML=`${bomForm?bomFormHtml():''}<div class="card pr-card"><div class="pr-cardhead"><h3>Bills of material <span class="pr-count">· ${D.bomItems.length}</span></h3>
        <div class="pr-dashact no-print"><button type="button" class="ghost pr-small" id="bbBX">Excel</button>${canEdit()?'<button type="button" class="pr-small" id="bbBNew">+ New BOM item</button>':''}</div></div>
      <label class="no-print">Item<select id="bbBSel">${itemOptions(bomSel,'Select an item to see its BOM…')}</select></label>
      ${item?`<div class="pr-sub">${esc(item.item)}${item.company?' · '+esc(item.company):''}</div><div class="pr-small-t">${esc(item.description)}</div>
        <div class="pr-scroll"><table class="pr-table"><thead><tr><th>Component</th><th>Description</th><th class="r">Per unit</th><th class="r">In stock</th><th class="r">Enough for</th></tr></thead><tbody>
        ${needsFor(item,1).map(r=>`<tr><td><b>${esc(r.code)}</b></td><td>${esc(r.description)}</td><td class="r">${int(r.per)}</td><td class="r">${r.listed?int(r.have):badge('Not on Inventory tab','bad')}</td><td class="r ${r.per&&r.have<r.per?'sr-low':''}">${r.per?int(Math.floor(r.have/r.per)):'—'}</td></tr>`).join('')}
        </tbody></table></div>${canEdit()?'<div class="actions no-print"><button type="button" class="ghost" id="bbBEdit">Edit this BOM</button></div>':''}`
      :`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Item</th><th>Company</th><th>Description</th><th class="r">Components</th></tr></thead><tbody>
        ${D.bomItems.map(b=>`<tr class="si-click" data-bbbom="${esc(b.item)}"><td><b>${esc(b.item)}</b></td><td>${esc(b.company)}</td><td class="pr-small-t">${esc(String(b.description||'').slice(0,60))}</td><td class="r">${b.components.length}</td></tr>`).join('')}
        </tbody></table></div>`}</div>`;
    $('bbBSel').onchange=e=>{ bomSel=e.target.value; renderBom(); };
    $('bbBody').querySelectorAll('[data-bbbom]').forEach(r=>r.onclick=()=>{ bomSel=r.dataset.bbbom; renderBom(); });
    $('bbBX').onclick=()=>{ const rows=[]; D.bomItems.forEach(b=>b.components.forEach((c,i)=>rows.push([i?'':b.company,i?'':b.item,c.code,c.description,n(c.quantity)])));
      excel('battery_box_bom_'+ymd(new Date())+'.xlsx','BOM_Data',['Company','Item','Component','Description','Qty Per Unit'],rows,[4]); };
    const nb=$('bbBNew'); if(nb) nb.onclick=()=>{ bomForm={isNew:true,company:'',item:'',lines:[{code:'',qty:'1'}]}; renderBom(); window.scrollTo(0,0); };
    const eb=$('bbBEdit'); if(eb) eb.onclick=()=>{ bomForm={isNew:false,company:item.company,item:item.item,lines:item.components.map(c=>({code:c.code,qty:String(n(c.quantity))}))}; renderBom(); window.scrollTo(0,0); };
    if(bomForm) wireBomForm();
  }
  function bomFormHtml(){
    const f=bomForm;
    return `<div class="card pr-card pr-formcard no-print"><div class="pr-cardhead"><h3>${f.isNew?'New BOM item':'Edit BOM — '+esc(f.item)}</h3><button type="button" class="ghost pr-small" id="bbBFClose">Close</button></div>
      <div class="pr-grid2"><label>Company / customer<input id="bbBFc" value="${esc(f.company)}" placeholder="e.g. NISSAN, WPR"></label><label>Item code *<input id="bbBFi" value="${esc(f.item)}"${f.isNew?'':' disabled'} placeholder="e.g. N0260150140A009"></label></div>
      <div class="pr-sub">Components</div><div id="bbBFLines">${f.lines.map((l,i)=>`<div class="bb-bomline"><select data-bbfl="${i}">${compOptions(l.code)}</select><input type="number" min="1" step="1" data-bbfq="${i}" value="${esc(l.qty)}" aria-label="Quantity per unit"><button type="button" class="ghost pr-small" data-bbfx="${i}" aria-label="Remove line">✕</button></div>`).join('')}</div>
      <div class="actions"><button type="button" class="ghost" id="bbBFAdd">+ Add component</button> <button type="button" id="bbBFSave">${f.isNew?'Save BOM item':'Save changes'}</button></div>
      ${f.isNew?'':'<p class="hint">Saving replaces this item\'s rows on BOM_Data. Builds already recorded aren\'t changed.</p>'}
      <p class="hint">A component that isn't listed yet goes in first under Components → New component.</p></div>`;
  }
  function wireBomForm(){
    const f=bomForm, keep=()=>{ f.company=$('bbBFc').value; f.item=$('bbBFi').value; f.lines=f.lines.map((l,i)=>({code:$('bbBFLines').querySelector(`[data-bbfl="${i}"]`).value,qty:$('bbBFLines').querySelector(`[data-bbfq="${i}"]`).value})); };
    $('bbBFClose').onclick=()=>{ bomForm=null; renderBom(); };
    $('bbBFAdd').onclick=()=>{ keep(); f.lines.push({code:'',qty:'1'}); renderBom(); };
    $('bbBFLines').querySelectorAll('[data-bbfx]').forEach(b=>b.onclick=()=>{ keep(); f.lines.splice(+b.dataset.bbfx,1); if(!f.lines.length) f.lines.push({code:'',qty:'1'}); renderBom(); });
    $('bbBFSave').onclick=()=>{
      keep(); const item=f.item.trim(), lines=f.lines.filter(l=>l.code);
      if(!item) return toast('Item code is required.');
      if(f.isNew&&bom(item)) return toast(item+' already has a BOM. Pick it and use Edit.');
      if(!lines.length) return toast('Add at least one component.');
      if(lines.some(l=>!(n(l.qty)>0)||Math.floor(n(l.qty))!==n(l.qty))) return toast('Each quantity must be a whole number more than 0.');
      if(!f.isNew&&!confirm('Replace the BOM for '+item+' with these '+plural(lines.length,'component')+'?')) return;
      save($('bbBFSave'),'saveBom',{company:f.company.trim(),item,components:lines.map(l=>({code:l.code,qty:n(l.qty)}))},()=>{ bomForm=null; bomSel=item; });
    };
  }

  // ================================================================ SHIPMENTS
  function renderShipments(){
    $('bbBody').innerHTML=`<div class="card pr-card"><div class="pr-cardhead"><h3>Shipments <span class="pr-count" id="bbShCount"></span></h3>
        <div class="pr-dashact no-print"><button type="button" class="ghost pr-small" id="bbShX">Excel</button><button type="button" class="ghost pr-small" id="bbShP">Print log…</button></div></div>
      <input type="search" id="bbShQ" class="no-print" placeholder="Search customer, item, PO, tracking or LD number" value="${esc(shipQ)}" aria-label="Search shipments"><div id="bbShT"></div></div>`;
    const list=()=>{ const q=shipQ.trim().toLowerCase(); return D.shipments.filter(s=>has(q,s.customer,s.item,s.tracking,s.ldNumbers,s.shippedBy,s.id,s.notes,s.date,poFor(s))); };
    const draw=()=>{ const rows=list();
      $('bbShCount').textContent='· '+plural(rows.length,'shipment')+' · '+int(rows.reduce((a,s)=>a+n(s.qtyShipped),0))+' units';
      $('bbShT').innerHTML=rows.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Date</th><th>PO #</th><th>Customer</th><th>Item</th><th class="r">Qty</th><th>FedEx tracking / LD</th><th>Shipped by</th></tr></thead><tbody>
        ${rows.slice(0,300).map(s=>`<tr><td class="nw">${esc(s.date)}</td><td>${esc(poFor(s)||'—')}</td><td><b>${esc(s.customer)}</b>${s.address?`<div class="pr-small-t">${esc(s.address)}</div>`:''}</td><td>${esc(s.item)}</td><td class="r">${int(s.qtyShipped)}</td><td>${trackStack(s.tracking,s.ldNumbers)}</td><td class="pr-small-t">${esc(s.shippedBy)}${s.notes?'<br>'+esc(s.notes):''}</td></tr>`).join('')}
        </tbody></table></div>${rows.length>300?'<p class="hint">Showing the newest 300 — search to narrow it down, or use Excel for everything.</p>':''}`:empty('No shipments match.'); };
    draw(); $('bbShQ').oninput=e=>{ shipQ=e.target.value; draw(); };
    $('bbShX').onclick=()=>{ const rows=list(); const box=[]; for(let i=1;i<=10;i++) box.push('Box '+i+' FedEx','Box '+i+' LD');
      excel('battery_box_shipments_'+ymd(new Date())+'.xlsx','Shipments',['Shipment ID','Date','PO Number','Customer','Address','Item','Qty Shipped','Shipped By','Notes'].concat(box),
        rows.map(s=>{ const t=parseTrk(s.tracking), l=parseLd(s.ldNumbers), b=[]; for(let i=0;i<10;i++) b.push(t[i]||'',l[i]||''); return [s.id,s.date,poFor(s),s.customer,s.address,s.item,n(s.qtyShipped),s.shippedBy,s.notes].concat(b); }),[6]); };
    $('bbShP').onclick=()=>printLog();
  }
  async function printLog(){
    const v=prompt('Print the shipment log for how many days back?','30'); if(v==null) return;
    const days=Math.max(1,Math.min(365,parseInt(v,10)||30));
    const w=window.open('','_blank'); if(!w) return toast('Allow pop-ups for this site to print the log.');
    w.document.write('<p style="font-family:Arial;padding:30px">Building the shipment log…</p>');
    try{ const r=await api('printLog',{days}); w.document.open(); w.document.write(r.html); w.document.close(); }
    catch(e){ w.close(); toast(errText(e)); }
  }

  // ================================================================ CUSTOMERS
  function renderCustomers(){
    const f=custForm||{isNew:true,name:'',address:'',city:'',contact:''};
    $('bbBody').innerHTML=`<div class="sr-two">
      <div class="card pr-card pr-formcard no-print"><div class="pr-cardhead"><h3>${f.isNew?'New customer':'Edit customer'}</h3>${custForm?'<button type="button" class="ghost pr-small" id="bbCuClear">Clear</button>':''}</div>${canEdit()?`
        <label>Customer / company name *<input id="bbCuN" value="${esc(f.name)}"${f.isNew?'':' disabled'} placeholder="e.g. NISSAN, DC #6042"></label>
        <label>Ship-to address<input id="bbCuA" value="${esc(f.address)}"></label>
        <label>City, state, zip<input id="bbCuC" value="${esc(f.city)}" placeholder="e.g. Fort Smith, AR 72901"></label>
        <label>Contact name / phone<input id="bbCuP" value="${esc(f.contact)}"></label>
        <div class="actions"><button type="button" id="bbCuSave">Save customer</button></div>`:'<p class="hint">Your access is view-only.</p>'}</div>
      <div class="card pr-card"><div class="pr-cardhead"><h3>Customers <span class="pr-count">· ${D.customers.length}</span></h3></div>
        <input type="search" id="bbCuQ" class="no-print" placeholder="Search" value="${esc(custQ)}" aria-label="Search customers"><div id="bbCuT"></div></div></div>`;
    const draw=()=>{ const q=custQ.trim().toLowerCase(), rows=D.customers.filter(c=>has(q,c.name,c.address,c.city,c.contact));
      $('bbCuT').innerHTML=rows.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Name</th><th>Address</th><th>City / state</th><th>Contact</th><th class="no-print"></th></tr></thead><tbody>
        ${rows.map(c=>`<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.address)}</td><td>${esc(c.city)}</td><td>${esc(c.contact)}</td><td class="no-print">${canEdit()?`<button type="button" class="ghost pr-small" data-bbcu="${esc(c.name)}">Edit</button>`:''}</td></tr>`).join('')}
        </tbody></table></div>`:empty('No customers yet.');
      $('bbCuT').querySelectorAll('[data-bbcu]').forEach(b=>b.onclick=()=>{ const c=D.customers.find(x=>x.name===b.dataset.bbcu); if(c){ custForm=Object.assign({isNew:false},c); renderCustomers(); window.scrollTo(0,0); } }); };
    draw(); $('bbCuQ').oninput=e=>{ custQ=e.target.value; draw(); };
    const cl=$('bbCuClear'); if(cl) cl.onclick=()=>{ custForm=null; renderCustomers(); };
    if(!canEdit()) return;
    $('bbCuSave').onclick=()=>{
      const a={name:$('bbCuN').value.trim(),address:$('bbCuA').value.trim(),city:$('bbCuC').value.trim(),contact:$('bbCuP').value.trim()};
      if(!a.name) return toast('Customer name is required.');
      if(f.isNew&&D.customers.some(c=>c.name.toLowerCase()===a.name.toLowerCase())&&!confirm(a.name+' is already saved. Update it?')) return;
      save($('bbCuSave'),'saveCustomer',a,()=>{ custForm=null; });
    };
  }

  // ================================================================ REPORTS
  function renderReports(){
    const ed=canEdit();
    const card=(title,tag,body)=>`<div class="card pr-card"><div class="pr-cardhead"><h3>${title}</h3>${tag?badge(tag,'good'):''}</div>${body}</div>`;
    const dis=ed?'':' disabled';
    $('bbBody').innerHTML=`${ed?'':'<div class="pr-msg pr-msg-warn">Your access is view-only — reports and timers need edit access.</div>'}
      <p class="hint">Each email goes to the same list the old page used (set in the script's CONFIG). Only the weekly customer report takes addresses here.</p>
      <div class="bb-reports">
      ${card('Daily inventory report','',`<p class="hint">Stock levels, master stock ready to ship, critical and low components. Sends itself at 8 AM once the timer is on.</p>
        <div class="actions"><button type="button" data-bbrep="daily"${dis}>Send now</button> <button type="button" class="ghost" data-bbtrg="daily"${dis}>Turn on 8 AM timer</button></div>`)}
      ${card('Shipment history','',`<p class="hint">Every shipment with FedEx links, LD numbers, PO and customer.</p>
        <label>Days back<input type="number" id="bbRepSD" min="1" max="365" value="30"></label>
        <div class="actions"><button type="button" data-bbrep="ships"${dis}>Send email</button> <button type="button" class="ghost" id="bbRepPrint">Print / save PDF</button></div>`)}
      ${card('Open orders','',`<p class="hint">Open and pending orders with customer, item, quantity and priority.</p>
        <div class="actions"><button type="button" data-bbrep="orders"${dis}>Send now</button></div>`)}
      ${card('Receiving / PO report','',`<p class="hint">Receiving log with PO numbers, vendors, quantities and totals.</p>
        <label>Days back<input type="number" id="bbRepRD" min="1" max="365" value="30"></label>
        <div class="actions"><button type="button" data-bbrep="receiving"${dis}>Send now</button></div>`)}
      ${card('Weekly customer report','Auto — Sat 6 PM',`<p class="hint">The week's shipments with FedEx tracking, LD numbers and a CSV attached. The Saturday timer sends it to the customer list in the script; "Send now" sends it to the addresses below (the usual internal list is copied).</p>
        <label>Email(s), comma separated<input id="bbRepWE" value="${esc(ls.get('lwh_bbWeekly','')||'')}" placeholder="customer@company.com, other@company.com"></label>
        <div class="actions"><button type="button" data-bbrep="weekly"${dis}>Send now</button> <button type="button" class="ghost" data-bbtrg="weekly"${dis}>Turn on Saturday timer</button></div>`)}
      ${card('Battery Box tracking sheet','External sheet',`<p class="hint">Writes one row per box (tracking + LD number + ship date) to the shared Battery Box Shipment Tracking sheet. Skips numbers already there — safe to run any time. The Dealer Name column is never touched.</p>
        <div class="actions"><button type="button" data-bbrep="sync"${dis}>Sync now</button> <button type="button" class="ghost" data-bbtrg="sync"${dis}>Turn on 7 AM sync</button></div>`)}
      </div>`;
    $('bbRepPrint').onclick=async()=>{ const days=Math.max(1,Math.min(365,parseInt($('bbRepSD').value,10)||30));
      const w=window.open('','_blank'); if(!w) return toast('Allow pop-ups for this site to print the log.');
      w.document.write('<p style="font-family:Arial;padding:30px">Building the shipment log…</p>');
      try{ const r=await api('printLog',{days}); w.document.open(); w.document.write(r.html); w.document.close(); }catch(e){ w.close(); toast(errText(e)); } };
    if(!ed) return;
    const names={daily:'the daily inventory report',ships:'the shipment history email',orders:'the open orders report',receiving:'the receiving report',weekly:'the weekly customer report',sync:'the tracking sheet sync'};
    $('bbBody').querySelectorAll('[data-bbrep]').forEach(b=>b.onclick=()=>{
      const type=b.dataset.bbrep, a={type};
      if(type==='ships') a.days=$('bbRepSD').value; if(type==='receiving') a.days=$('bbRepRD').value;
      if(type==='weekly'){ a.emails=$('bbRepWE').value.trim(); if(!a.emails) return toast('Enter at least one email address.'); ls.set('lwh_bbWeekly',a.emails); }
      if(type!=='sync'&&!confirm('Send '+names[type]+' now?')) return;
      busy(b,type==='sync'?'Syncing…':'Sending…',()=>api('report',a)).then(r=>{ toast(r.message||'Done'); msg(esc(r.message||'Done'),'good'); }).catch(e=>{ toast(errText(e)); msg(esc(errText(e)),'bad'); });
    });
    $('bbBody').querySelectorAll('[data-bbtrg]').forEach(b=>b.onclick=()=>{
      if(!confirm('Turn on this timer? It replaces the existing one of the same kind, so it never runs twice.')) return;
      busy(b,'Setting…',()=>api('trigger',{type:b.dataset.bbtrg})).then(r=>{ toast(r.message||'Done'); msg(esc(r.message||'Done'),'good'); }).catch(e=>{ toast(errText(e)); msg(esc(errText(e)),'bad'); });
    });
  }

  // ---------------------------------------------------------------- nav + lifecycle
  function showNav(){ const nav=$('navBatteryBox'); if(!nav) return; const a=auth(); nav.hidden=!(a&&a.isSignedIn()&&ls.get(LS_OK,'')); }
  function onShow(){ build_(); showNav(); boot(false); }
  document.addEventListener('DOMContentLoaded',()=>{
    const sec=$('batteryBox'); if(!sec) return;
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
    showNav(); [1500,4000].forEach(t=>setTimeout(showNav,t));
  });
  window.LWHBatteryBox={ refresh:()=>boot(true) };
})();
