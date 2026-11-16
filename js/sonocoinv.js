/* SONOCO INVENTORY & BOM (v1.87.0) — finished spools, components, builds, open orders and shipments in
   one screen. Replaces two Apps Script pages: "Spool Works Dashboard" (Sonoco Inventory sheet) and
   "Sonoco Component Inventory" (Sonoco BOM Inventory sheet). Both Sheets stay the database and each
   project keeps its own emails; this screen talks to both:

     INV  gas/SonocoInventoryAPI.gs  finished inventory, add / ship, transactions, open orders, shipments
     BOM  gas/SonocoBomAPI.gs        component stock + limits, bills of material, builds, build history

   Each script checks the Toolkit sign-in on every request and lets in only employee IDs on its own
   Access tab (Role: edit or view). Setup: docs/SONOCO_INVENTORY_SETUP.md */
(function(){
  'use strict';
  // Apps Script web app URLs (Deploy → Manage deployments → /exec). Can also be set per device on the Connect screen.
  const API_DEFAULT={
    inv:'https://script.google.com/macros/s/AKfycbzLUPrfoKL0bpOu59DxJGOO2gvXxAm7L6DrLuitns3BcrUyvqfrrXPXwciqHduyOA5T5Q/exec',
    bom:'https://script.google.com/macros/s/AKfycbwqnmWARcsnhCsNG8N7Rv3Us70Hn1UCCUQWZW6Zd4W-tPVpkXmr9gy1rw8FgL_ta-T4Ug/exec'
  };
  const LS_URL={ inv:'lwh_siInvApi', bom:'lwh_siBomApi' }, LS_OK='lwh_siOk', LS_SECTION='lwh_sonocoSection';

  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const n=v=>{ const x=Number(String(v==null?'':v).replace(/[,\s]/g,'')); return isFinite(x)?x:0; };
  const int=v=>Math.round(n(v)).toLocaleString('en-US');
  const pad=x=>String(x).padStart(2,'0');
  const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const parse=s=>{ const p=String(s).split('-'); return new Date(+p[0],+p[1]-1,+p[2]); };
  const nice=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s))?parse(s).toLocaleDateString('en-US',{weekday:'short',month:'numeric',day:'numeric',year:'2-digit'}):String(s||'');
  const ls={ get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
             set(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };
  const auth=()=>window.LWHAuth||null;
  const toast=m=>{ if(window.LWHUI&&LWHUI.toast) LWHUI.toast(m); };
  const empty=t=>`<div class="pr-empty">${esc(t)}</div>`;
  const plural=(k,w)=>k+' '+w+(k===1?'':'s');

  // ---------------------------------------------------------------- state
  let INV=null, BOM=null, ERR={inv:'',bom:''};
  let tab='orders', loading=false, built=false;
  let openOrder=null, invFilter='', move='add';
  let ships=null, shipView='cal', shipFilter='', calY=new Date().getFullYear(), calM=new Date().getMonth(), calDay='';
  let compFilter='', compOnly='all', editCode='';
  let build={item:'',qty:''}, hist=null, histFilter='';
  let tx=null, txFilter='';

  const apiUrl=w=>String(ls.get(LS_URL[w],'')||API_DEFAULT[w]||'').trim();
  const canEdit=w=>{ const b=w==='inv'?INV:BOM; return !!(b&&b.me&&b.me.role==='edit'); };

  // ---------------------------------------------------------------- API
  async function api(which,action,args){
    const url=apiUrl(which); if(!url) throw new Error('not_connected');
    const a=auth(); const token=a&&a.token&&a.token();
    if(!token){ if(a) a.requireSignIn('Please sign in to use Sonoco Inventory.'); throw new Error('signed_out'); }
    let res;
    try{ res=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({},args||{},{action,token})),cache:'no-store',redirect:'follow'}); }
    catch(e){ throw new Error('offline'); }
    let r; try{ r=await res.json(); }catch(e){ throw new Error('bad_reply'); }
    if(!r||!r.ok){
      const err=(r&&r.error)||'failed';
      if(err==='signed_out'&&a) a.requireSignIn('Your sign-in ran out. Please sign in again.');
      throw new Error(err);
    }
    return r;
  }
  function errText(e,which){
    const m=String(e&&e.message||e), sheet=which==='bom'?'Sonoco BOM Inventory':which==='inv'?'Sonoco Inventory':'';
    if(m.startsWith('bad_input:')) return m.slice(10);
    return ({ not_connected:'This part isn\'t connected yet — its Apps Script link needs to be added.',
      offline:'Couldn\'t reach the server. Check your connection and try again.', signed_out:'Please sign in again.',
      no_access:'You don\'t have access to this part. Ask Tim to add your employee ID on the Access tab of the '+(sheet||'Sonoco')+' Sheet.',
      view_only:'Your access here is view-only.', busy:'Someone else is saving right now — try again in a moment.',
      bad_reply:'The server sent back something unexpected. Check the Apps Script link (Connect).' })[m] || ('Something went wrong: '+m);
  }
  function msg(html,tone){ const m=$('siMsg'); if(!m) return; m.innerHTML=html||''; m.hidden=!html; m.className='pr-msg no-print'+(tone?' pr-msg-'+tone:''); }
  async function busy(btn,label,fn){
    const old=btn?btn.innerHTML:''; if(btn){ btn.disabled=true; btn.textContent=label; }
    try{ return await fn(); } finally{ if(btn){ btn.disabled=false; btn.innerHTML=old; } }
  }
  function excel(file,sheetName,labels,rows,numCols){
    if(!rows||!rows.length) return toast('Nothing to export.');
    if(!window.LWHXlsx) return toast('Excel export isn\'t loaded.');
    LWHXlsx.download(file,[{name:sheetName,columns:labels.map((l,j)=>({label:l,width:Math.max(10,Math.min(40,l.length+6)),type:(numCols||[]).includes(j)?'n':undefined})),rows}]);
  }
  const need=(which,what)=>`<div class="pr-empty pr-neg">${esc(ERR[which]||('The '+what+' could not be loaded.'))}</div>`;

  // ---------------------------------------------------------------- matching (same rules the old pages used)
  /** Order item → BOM item: the exact number first, then the number with its "-suffix" removed. */
  function bomFor(itemNumber){
    if(!BOM) return null;
    const exact=String(itemNumber||'').trim(), clean=exact.split('-')[0].trim();
    return BOM.items.find(i=>i.item===exact)||BOM.items.find(i=>i.item===clean)||null;
  }
  /** Component stock by code. A code listed twice on the Sheet: the first row is the one builds use. */
  function stockMap(){ const m={}; (BOM?BOM.components:[]).forEach(c=>{ if(c.status!=='duplicate'&&!(c.code in m)) m[c.code]=c; }); return m; }
  /** Finished inventory rows for a Sonoco item number: the name itself, or the name followed by "-" or a space. */
  function finishedFor(num){ return (INV?INV.inventory:[]).filter(i=>{ const s=String(i.itemName||'').trim(); return s===num||s.startsWith(num+'-')||s.startsWith(num+' '); }); }
  function needsFor(item,qty){ const o={}; item.components.forEach(c=>{ o[c.code]=o[c.code]||{code:c.code,description:c.description,per:0,need:0}; o[c.code].per+=c.quantity; o[c.code].need+=c.quantity*qty; }); return Object.values(o); }

  // ---------------------------------------------------------------- shell
  const ICON='<svg class="icon" viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>';
  const TABS=[['orders','Open Orders'],['inventory','Inventory'],['shipments','Shipments'],['components','Components'],['builds','Builds'],['tx','Transactions']];
  function build_(){
    const sec=$('sonocoInv'); if(!sec||built) return; built=true;
    sec.innerHTML=`<div class="pr-wrap">
      <div class="pr-top no-print">
        <div class="si-switch"><span>Sonoco</span><button type="button" class="pr-preset" data-sonoco="sonocoReels">Reels Production</button><button type="button" class="pr-preset on" data-sonoco="sonocoInv">Inventory &amp; BOM</button></div>
        <div class="mh-entry-head">
          <div class="mh-entry-icon">${ICON}</div>
          <div><h2>Sonoco Inventory &amp; BOM</h2><div class="mh-entry-sub">Finished spools, components, builds, open orders and shipments.</div></div>
          <div class="pr-who"><span id="siWho"></span><button type="button" class="ghost pr-small" id="siRefresh">Refresh</button></div>
        </div>
        <div class="pr-tabs" role="tablist" id="siTabs">${TABS.map(([k,l])=>`<button type="button" data-sitab="${k}" role="tab">${l}</button>`).join('')}</div>
      </div>
      <div id="siMsg" class="pr-msg no-print" hidden></div>
      <div id="siBody"></div>
    </div>`;
    $('siTabs').addEventListener('click',e=>{ const b=e.target.closest('[data-sitab]'); if(b){ if(b.dataset.sitab!==tab) msg(''); tab=b.dataset.sitab; render(); } });
    $('siRefresh').onclick=()=>{ ships=null; hist=null; tx=null; boot(true); };
    sec.addEventListener('click',e=>{ const b=e.target.closest('[data-sonoco]'); if(b&&b.dataset.sonoco!=='sonocoInv'&&window.LWHUI) LWHUI.show(b.dataset.sonoco); });
  }

  async function boot(force){
    if(loading) return; if((INV||BOM)&&!force){ render(); return; }
    const a=auth();
    if(!a||!a.isSignedIn()){ msg('Please sign in to use Sonoco Inventory.','warn'); $('siBody').innerHTML=''; return; }
    if(!apiUrl('inv')&&!apiUrl('bom')){ renderConnect(); return; }
    loading=true; msg('Loading…');
    const [ri,rb]=await Promise.all(['inv','bom'].map(w=>api(w,'bootstrap').then(r=>({r}),e=>({e}))));
    loading=false;
    INV=ri.r||null; BOM=rb.r||null; ERR.inv=ri.e?errText(ri.e,'inv'):''; ERR.bom=rb.e?errText(rb.e,'bom'):'';
    if(!INV&&!BOM){
      ls.set(LS_OK,''); showNav();
      msg(esc(ERR.inv===ERR.bom?ERR.inv:('Inventory: '+ERR.inv+' — Components & builds: '+ERR.bom)),'bad');
      if([ri.e,rb.e].some(e=>e&&(e.message==='bad_reply'||e.message==='not_connected'))) renderConnect(true); else $('siBody').innerHTML='';
      return;
    }
    ls.set(LS_OK,'1'); showNav();
    if(!INV||!BOM){ const w=!INV?'inv':'bom'; msg((w==='inv'?'Finished inventory, orders and shipments':'Components and builds')+' aren\'t available: '+esc(ERR[w]),'warn'); } else msg('');
    render();
  }

  function renderConnect(keepMsg){
    if(!keepMsg) msg('');
    $('siBody').innerHTML=`<div class="card pr-card pr-narrow"><h3>Connect Sonoco Inventory</h3>
      <p class="hint">Paste the two Apps Script web app links (each ends in <b>/exec</b>). They're saved on this device. See docs/SONOCO_INVENTORY_SETUP.md — or ask Tim.</p>
      <label>Sonoco Inventory sheet (Spool Works)<input id="siUrlInv" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(apiUrl('inv'))}"></label>
      <label>Sonoco BOM Inventory sheet<input id="siUrlBom" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(apiUrl('bom'))}"></label>
      <div class="actions"><button type="button" id="siUrlSave">Save &amp; Connect</button></div></div>`;
    $('siUrlSave').onclick=()=>{
      const v={inv:$('siUrlInv').value.trim(),bom:$('siUrlBom').value.trim()};
      for(const w of ['inv','bom']) if(v[w]&&!/^https:\/\/script\.google\.com\/.+\/exec$/.test(v[w])){ toast('That doesn\'t look like an Apps Script /exec link.'); return; }
      if(!v.inv&&!v.bom){ toast('Paste at least one link.'); return; }
      ls.set(LS_URL.inv,v.inv||null); ls.set(LS_URL.bom,v.bom||null); boot(true);
    };
  }

  function render(){
    if(!INV&&!BOM) return;
    const me=(INV||BOM).me; $('siWho').textContent=me.name+((INV&&INV.me.role==='view')||(BOM&&BOM.me.role==='view')?' · view only':'');
    document.querySelectorAll('#siTabs [data-sitab]').forEach(b=>{ b.classList.toggle('active',b.dataset.sitab===tab); b.setAttribute('aria-selected',b.dataset.sitab===tab); });
    ({orders:renderOrders,inventory:renderInventory,shipments:renderShipments,components:renderComponents,builds:renderBuilds,tx:renderTx})[tab]();
  }
  const badge=(t,tone)=>`<b class="pr-badge pr-t-${tone}">${esc(t)}</b>`;

  // ================================================================ OPEN ORDERS
  function orderView(){
    const stock=stockMap(), total={};
    const orders=(INV?INV.orders:[]).filter(o=>o.itemNumber&&n(o.quantity)>0).map((o,idx)=>{
      const item=bomFor(o.itemNumber), qty=n(o.quantity);
      const comps=item?needsFor(item,qty).map(c=>{ const have=stock[c.code]?stock[c.code].quantity:0;
        total[c.code]=total[c.code]||{code:c.code,description:c.description,need:0,have,listed:!!stock[c.code]}; total[c.code].need+=c.need;
        return Object.assign(c,{have,listed:!!stock[c.code]}); }):[];
      return {o,idx,item,qty,comps,short:comps.filter(c=>c.have<c.need)};
    });
    const totals=Object.values(total).map(t=>Object.assign(t,{short:Math.max(0,t.need-t.have)})).sort((a,b)=>(b.short>0)-(a.short>0)||b.short-a.short||a.code.localeCompare(b.code));
    const byItem={}; orders.forEach(x=>{ const k=String(x.o.itemNumber).trim(); byItem[k]=(byItem[k]||0)+x.qty; });
    const finished=Object.keys(byItem).sort().map(k=>{ const m=finishedFor(k), on=m.reduce((s,i)=>s+n(i.quantity),0); return {item:k,ordered:byItem[k],matched:m,onHand:on,diff:on-byItem[k]}; });
    return {orders,totals,finished};
  }
  function renderOrders(){
    if(!INV){ $('siBody').innerHTML=need('inv','open orders'); return; }
    const v=orderView(), units=v.orders.reduce((s,x)=>s+x.qty,0), shortC=v.totals.filter(t=>t.short>0).length, noBom=v.orders.filter(x=>BOM&&!x.item).length;
    const fShort=v.finished.filter(f=>f.diff<0).length;
    const compCell=x=>!BOM?'<span class="pr-small-t">—</span>':!x.item?badge('No BOM','bad'):x.short.length?badge('Short '+x.short.length,'warn'):badge('Enough','good');
    $('siBody').innerHTML=`<div class="pr-tiles si-tiles">
        <div class="pr-tile"><span>Open orders</span><b>${v.orders.length}</b><small class="pr-delta">${int(units)} units</small></div>
        <div class="pr-tile${fShort?' accent':''}"><span>Items not covered by finished stock</span><b>${fShort}</b><small class="pr-delta">of ${v.finished.length} items on order</small></div>
        <div class="pr-tile${shortC?' accent':''}"><span>Components short</span><b>${BOM?shortC:'—'}</b><small class="pr-delta">to build every open order</small></div>
        <div class="pr-tile${noBom?' accent':''}"><span>Orders with no BOM</span><b>${BOM?noBom:'—'}</b><small class="pr-delta">item not on BOM_Data</small></div>
      </div>
      <div class="card pr-card"><div class="pr-cardhead"><h3>Open orders <span class="pr-count">· ${v.orders.length}</span></h3>
          <div class="pr-dashact no-print"><button type="button" class="ghost pr-small" id="siOX">Excel</button>${canEdit('inv')?'<button type="button" class="ghost pr-small" id="siOMail">Email daily report</button>':''}</div></div>
        ${v.orders.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>LWH ID</th><th>Customer #</th><th>Sonoco item #</th><th>PO #</th><th class="r">Qty</th><th>Components to build it</th></tr></thead><tbody>
        ${v.orders.map(x=>`<tr class="si-click" data-siord="${x.idx}"><td>${esc(x.o.lwhId)}</td><td>${esc(x.o.customerNumber)}</td><td><b>${esc(x.o.itemNumber)}</b></td><td>${esc(x.o.poNumber)}</td><td class="r">${int(x.qty)}</td><td>${compCell(x)}</td></tr>
          ${openOrder===x.idx&&x.item?`<tr class="si-detail"><td colspan="6"><div class="pr-small-t">${esc(x.item.item)} — ${esc(x.item.description)}</div>
            <table class="pr-table si-inner"><thead><tr><th>Component</th><th>Description</th><th class="r">Per unit</th><th class="r">Needed</th><th class="r">On hand</th><th></th></tr></thead><tbody>
            ${x.comps.map(c=>`<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.description)}</td><td class="r">${int(c.per)}</td><td class="r">${int(c.need)}</td><td class="r">${c.listed?int(c.have):'—'}</td><td>${!c.listed?badge('Not on Inventory tab','bad'):c.have<c.need?badge('Short '+int(c.need-c.have),'warn'):badge('OK','good')}</td></tr>`).join('')}
            </tbody></table></td></tr>`:''}`).join('')}
        </tbody></table></div><p class="hint no-print">Tap an order to see its components. "Enough" means stock covers that order on its own; the totals for all orders are below.</p>`:empty('No open orders.')}
      </div>
      <div class="sr-two sr-even">
        <div class="card pr-card"><h3>Finished stock vs. orders</h3>
          ${v.finished.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Sonoco item #</th><th class="r">Ordered</th><th class="r">On hand</th><th class="r">Difference</th><th></th></tr></thead><tbody>
          ${v.finished.map(f=>`<tr><td><b>${esc(f.item)}</b>${f.matched.length>1||(f.matched[0]&&f.matched[0].itemName!==f.item)?`<div class="pr-small-t">${f.matched.map(m=>esc(m.itemName)+' ('+int(m.quantity)+')').join(', ')}</div>`:''}</td><td class="r">${int(f.ordered)}</td><td class="r">${f.matched.length?int(f.onHand):'—'}</td>
            <td class="r ${f.diff<0?'sr-low':'sr-good'}">${f.matched.length?(f.diff>=0?'+':'')+int(f.diff):'—'}</td><td>${!f.matched.length?badge('Not in inventory','bad'):f.diff>=0?badge('Covered','good'):badge('Short','warn')}</td></tr>`).join('')}
          </tbody></table></div>`:empty('Nothing on order.')}
        </div>
        <div class="card pr-card"><h3>Components needed for all open orders</h3>
          ${!BOM?need('bom','components'):v.totals.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Component</th><th class="r">Needed</th><th class="r">On hand</th><th class="r">Short by</th></tr></thead><tbody>
          ${v.totals.map(t=>`<tr${t.short?' class="sr-inel"':''}><td><b>${esc(t.code)}</b><div class="pr-small-t">${esc(t.description)}</div></td><td class="r">${int(t.need)}</td><td class="r">${t.listed?int(t.have):'—'}</td><td class="r ${t.short?'sr-low':''}">${t.short?int(t.short):'—'}</td></tr>`).join('')}
          </tbody></table></div>`:empty('No component requirements.')}
        </div>
      </div>`;
    document.querySelectorAll('[data-siord]').forEach(r=>r.onclick=()=>{ const i=+r.dataset.siord; openOrder=openOrder===i?null:i; renderOrders(); });
    $('siOX').onclick=()=>excel('sonoco_open_orders_'+ymd(new Date())+'.xlsx','Open Orders',['LWH ID','Customer Number','Sonoco Item Number','PO Number','Quantity','Components'],
      v.orders.map(x=>[x.o.lwhId,x.o.customerNumber,x.o.itemNumber,x.o.poNumber,x.qty,!BOM?'':!x.item?'No BOM':x.short.length?'Short: '+x.short.map(c=>c.code).join(', '):'Enough']),[4]);
    wireMail('siOMail','inv',{type:'report'},'Send the daily inventory & open orders email now, to its usual list?');
  }
  function wireMail(id,which,args,question){
    const b=$(id); if(!b) return;
    b.onclick=()=>{ if(!confirm(question)) return; busy(b,'Sending…',()=>api(which,'sendReport',args)).then(r=>toast(r.message||'Sent')).catch(e=>toast(errText(e,which))); };
  }

  // ================================================================ INVENTORY (finished spools)
  function renderInventory(){
    if(!INV){ $('siBody').innerHTML=need('inv','inventory'); return; }
    const d=INV.inventory, tot=d.reduce((s,i)=>s+n(i.quantity),0), low=d.filter(i=>n(i.quantity)>0&&n(i.quantity)<=5).length, out=d.filter(i=>n(i.quantity)===0).length;
    const opts=d.map(i=>`<option value="${esc(i.itemName)}">${esc(i.itemName)} (${int(i.quantity)} ${esc(i.unit)})</option>`).join('');
    $('siBody').innerHTML=`<div class="pr-tiles si-tiles">
        <div class="pr-tile"><span>Items</span><b>${d.length}</b></div><div class="pr-tile"><span>Total on hand</span><b>${int(tot)}</b></div>
        <div class="pr-tile${low?' accent':''}"><span>Low (5 or fewer)</span><b>${low}</b></div><div class="pr-tile${out?' accent':''}"><span>Out of stock</span><b>${out}</b></div>
      </div>
      <div class="sr-two">
        ${canEdit('inv')?`<div class="card pr-card no-print"><h3>Add or ship</h3>
          <div class="pr-presets si-move"><button type="button" class="pr-preset${move==='add'?' on':''}" data-simove="add">Add to inventory</button><button type="button" class="pr-preset${move==='ship'?' on':''}" data-simove="ship">Ship from inventory</button></div>
          <label>Item<select id="siMItem"><option value="">Select item…</option>${opts}</select></label>
          <label>${move==='add'?'Quantity to add':'Quantity to ship'}<input type="number" id="siMQty" min="1" step="1" inputmode="numeric" placeholder="0"></label>
          <label>Notes <span class="hint">(optional)</span><textarea id="siMNotes" rows="2" maxlength="300" placeholder="${move==='add'?'e.g. Built today':'e.g. Shipped to customer'}"></textarea></label>
          <div class="sr-calc" id="siMCalc"></div>
          <div class="actions"><button type="button" id="siMSave">${move==='add'?'Add to inventory':'Ship from inventory'}</button></div>
        </div>`:'<div class="card pr-card no-print"><h3>Add or ship</h3><p class="hint">Your access is view-only.</p></div>'}
        <div class="card pr-card"><div class="pr-cardhead"><h3>Finished inventory</h3><div class="pr-dashact no-print"><button type="button" class="ghost pr-small" id="siIX">Excel</button></div></div>
          <input type="search" id="siIFilter" class="no-print" placeholder="Search items" value="${esc(invFilter)}" aria-label="Search inventory"><div id="siITable"></div></div>
      </div>`;
    const draw=()=>{ const q=invFilter.trim().toLowerCase(), rows=d.filter(i=>!q||String(i.itemName).toLowerCase().includes(q));
      $('siITable').innerHTML=rows.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Item</th><th class="r">Quantity</th><th>Unit</th><th></th></tr></thead><tbody>
        ${rows.map(i=>{ const q=n(i.quantity); return `<tr${q===0?' class="sr-inel"':''}><td><b>${esc(i.itemName)}</b></td><td class="r">${int(q)}</td><td>${esc(i.unit)}</td><td>${q===0?badge('Out','bad'):q<=5?badge('Low','warn'):''}</td></tr>`; }).join('')}</tbody></table></div>`:empty('Nothing matches.'); };
    $('siIFilter').oninput=e=>{ invFilter=e.target.value; draw(); }; draw();
    $('siIX').onclick=()=>excel('sonoco_inventory_'+ymd(new Date())+'.xlsx','Inventory',['Item Name','Quantity','Unit'],d.map(i=>[i.itemName,n(i.quantity),i.unit]),[1]);
    if(!canEdit('inv')) return;
    document.querySelectorAll('[data-simove]').forEach(b=>b.onclick=()=>{ move=b.dataset.simove; renderInventory(); });
    const calc=()=>{ const it=d.find(i=>i.itemName===$('siMItem').value), q=n($('siMQty').value); const c=$('siMCalc');
      if(!it||!(q>0)){ c.textContent=''; return; } const after=n(it.quantity)+(move==='add'?q:-q);
      c.textContent=`${int(it.quantity)} now → ${int(after)} after`; c.classList.toggle('pr-neg',after<0); };
    $('siMItem').onchange=calc; $('siMQty').oninput=calc;
    $('siMSave').onclick=()=>{
      const a={item:$('siMItem').value,quantity:$('siMQty').value,notes:$('siMNotes').value};
      if(!a.item) return toast('Pick the item.'); if(!(n(a.quantity)>0)) return toast('Enter the quantity.');
      busy($('siMSave'),'Saving…',()=>api('inv',move==='add'?'addStock':'shipStock',a)).then(r=>{ INV.inventory=r.inventory; tx=null; toast('Saved'); renderInventory(); msg(esc(r.message),'good'); })
        .catch(e=>{ toast(errText(e,'inv')); msg(esc(errText(e,'inv')),'bad'); });
    };
  }

  // ================================================================ SHIPMENTS
  function renderShipments(){
    if(!INV){ $('siBody').innerHTML=need('inv','shipments'); return; }
    $('siBody').innerHTML=`<div class="pr-dashbar no-print"><div class="pr-presets"><button type="button" class="pr-preset${shipView==='cal'?' on':''}" data-siview="cal">Calendar</button><button type="button" class="pr-preset${shipView==='list'?' on':''}" data-siview="list">List</button></div>
        <div class="pr-dashact"><button type="button" class="ghost pr-small" id="siSX">Excel</button>${canEdit('inv')?'<button type="button" class="ghost pr-small" id="siSMail">Email shipment report</button>':''}</div></div>
      <div id="siShip">${empty('Loading…')}</div>`;
    document.querySelectorAll('[data-siview]').forEach(b=>b.onclick=()=>{ shipView=b.dataset.siview; renderShipments(); });
    $('siSX').onclick=()=>{ if(ships) excel('sonoco_shipments_'+ymd(new Date())+'.xlsx','Shipments',['INV Receipt','Customer','Customer Number','Sonoco Number','PO Number','Quantity','Bill To Reference','Shipped Date'],
      ships.rows.map(s=>[s.invReceipt,s.subCustNm,s.customerNumber,s.sonocoNumber,s.poNumber,s.quantity,s.billToReference,s.date||s.shippedDate]),[5]); };
    wireMail('siSMail','inv',{type:'shipments'},'Send the shipment history email now, to its usual list?');
    if(ships) drawShipments(); else loadShipments(false);
  }
  async function loadShipments(all){
    try{ const r=await api('inv','shipments',{all}); r.rows.sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0); ships=r; if(tab==='shipments') drawShipments(); }
    catch(e){ const b=$('siShip'); if(b) b.innerHTML=`<div class="pr-empty pr-neg">${esc(errText(e,'inv'))}</div>`; }
  }
  const shipRow=s=>`<tr><td>${esc(s.invReceipt)}</td><td>${esc(s.customerNumber)}</td><td><b>${esc(s.sonocoNumber)}</b></td><td>${esc(s.poNumber)}</td><td class="r">${int(s.quantity)}</td><td>${esc(s.billToReference)}</td><td class="nw">${esc(s.date?nice(s.date):s.shippedDate)}</td></tr>`;
  const shipHead='<thead><tr><th>INV receipt</th><th>Customer #</th><th>Sonoco #</th><th>PO #</th><th class="r">Qty</th><th>Bill-to ref</th><th>Shipped</th></tr></thead>';
  function drawShipments(){
    const box=$('siShip'); if(!box||!ships) return;
    if(shipView==='list'){
      const q=shipFilter.trim().toLowerCase(), rows=ships.rows.filter(s=>!q||[s.invReceipt,s.customerNumber,s.sonocoNumber,s.poNumber,s.billToReference,s.subCustNm].some(x=>String(x).toLowerCase().includes(q)));
      box.innerHTML=`<div class="card pr-card"><div class="pr-cardhead"><h3>Shipment history <span class="pr-count">· ${rows.length}${ships.all?'':' · last 13 months'}</span></h3>${ships.all?'':'<button type="button" class="ghost pr-small no-print" id="siSAll">Load all history</button>'}</div>
        <input type="search" id="siSFilter" class="no-print" placeholder="Search receipt, customer, item, PO or reference" value="${esc(shipFilter)}" aria-label="Search shipments">
        <div class="pr-sumline">${int(rows.reduce((s,x)=>s+n(x.quantity),0))} units in ${plural(rows.length,'shipment')}</div>
        ${rows.length?`<div class="pr-scroll"><table class="pr-table">${shipHead}<tbody>${rows.slice(0,500).map(shipRow).join('')}</tbody></table></div>${rows.length>500?'<p class="hint">Showing the newest 500. Search to narrow it down, or use Excel for everything.</p>':''}`:empty('No shipments match.')}</div>`;
      const f=$('siSFilter'); f.oninput=e=>{ shipFilter=e.target.value; const pos=f.selectionStart; drawShipments(); const g=$('siSFilter'); g.focus(); try{ g.setSelectionRange(pos,pos); }catch(_){} };
      const a=$('siSAll'); if(a) a.onclick=()=>busy(a,'Loading…',()=>loadShipments(true));
      return;
    }
    const byDay={}; ships.rows.forEach(s=>{ if(s.date) (byDay[s.date]=byDay[s.date]||[]).push(s); });
    const first=new Date(calY,calM,1), days=new Date(calY,calM+1,0).getDate(), lead=first.getDay(), today=ymd(new Date());
    let cells=''; for(let i=0;i<lead;i++) cells+='<div class="si-day si-off"></div>';
    for(let dd=1;dd<=days;dd++){ const k=calY+'-'+pad(calM+1)+'-'+pad(dd), list=byDay[k]||[];
      const refs=[...new Set(list.map(s=>s.billToReference).filter(Boolean))];
      cells+=`<button type="button" class="si-day${list.length?' si-has':''}${k===today?' si-today':''}${k===calDay?' si-sel':''}" ${list.length?`data-siday="${k}"`:'disabled'}><span class="si-num">${dd}</span>${list.length?`<span class="si-cnt">${list.length}</span><span class="si-refs">${esc(refs.slice(0,3).join(', '))}${refs.length>3?'…':''}</span>`:''}</button>`; }
    const monthRows=ships.rows.filter(s=>s.date&&s.date.slice(0,7)===calY+'-'+pad(calM+1)), sel=byDay[calDay]||[];
    const before=!ships.all&&ships.since&&(calY+'-'+pad(calM+1)+'-01')<ships.since;
    box.innerHTML=`<div class="card pr-card"><div class="si-calhead"><div class="pr-presets no-print"><button type="button" class="pr-preset" id="siPrev">← Prev</button><button type="button" class="pr-preset" id="siToday">Today</button><button type="button" class="pr-preset" id="siNext">Next →</button></div>
        <h3>${first.toLocaleDateString('en-US',{month:'long',year:'numeric'})} <span class="pr-count">· ${plural(monthRows.length,'shipment')} · ${int(monthRows.reduce((s,x)=>s+n(x.quantity),0))} units</span></h3></div>
        ${before?'<p class="hint">Only the last 13 months are loaded. <button type="button" class="ghost pr-small" id="siSAll">Load all history</button></p>':''}
        <div class="si-cal">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=>`<div class="si-dow">${x}</div>`).join('')}${cells}</div></div>
      ${sel.length?`<div class="card pr-card"><h3>Shipped ${esc(nice(calDay))} <span class="pr-count">· ${plural(sel.length,'shipment')} · ${int(sel.reduce((s,x)=>s+n(x.quantity),0))} units</span></h3><div class="pr-scroll"><table class="pr-table">${shipHead}<tbody>${sel.map(shipRow).join('')}</tbody></table></div></div>`:'<p class="hint no-print">Tap a day with shipments to see them.</p>'}`;
    const go=k=>{ calM+=k; if(calM>11){ calM=0; calY++; } if(calM<0){ calM=11; calY--; } calDay=''; drawShipments(); };
    $('siPrev').onclick=()=>go(-1); $('siNext').onclick=()=>go(1);
    $('siToday').onclick=()=>{ const t=new Date(); calY=t.getFullYear(); calM=t.getMonth(); calDay=''; drawShipments(); };
    document.querySelectorAll('[data-siday]').forEach(b=>b.onclick=()=>{ calDay=calDay===b.dataset.siday?'':b.dataset.siday; drawShipments(); });
    const a=$('siSAll'); if(a) a.onclick=()=>busy(a,'Loading…',()=>loadShipments(true));
  }

  // ================================================================ COMPONENTS
  const ST={ out:['Out','bad'], critical:['Critical','bad'], low:['Low','warn'], ok:['OK','good'], duplicate:['Duplicate row','warn'] };
  function renderComponents(){
    if(!BOM){ $('siBody').innerHTML=need('bom','components'); return; }
    const c=BOM.components, cnt=s=>c.filter(x=>x.status===s).length, dup=cnt('duplicate');
    $('siBody').innerHTML=`<div class="pr-tiles si-tiles">
        <div class="pr-tile"><span>Components</span><b>${c.length-dup}</b></div><div class="pr-tile${cnt('out')?' accent':''}"><span>Out</span><b>${cnt('out')}</b></div>
        <div class="pr-tile${cnt('critical')?' accent':''}"><span>Critical</span><b>${cnt('critical')}</b><small class="pr-delta">at or under its critical limit</small></div>
        <div class="pr-tile"><span>Low</span><b>${cnt('low')}</b><small class="pr-delta">at or under its low limit</small></div>
      </div>
      ${dup?`<div class="pr-msg pr-msg-warn">${plural(dup,'component')} listed twice on the Inventory tab of the BOM Sheet. Builds and counts only use the first row; the extra row is marked below and should be deleted on the Sheet.</div>`:''}
      <div class="card pr-card"><div class="pr-cardhead"><h3>Component stock</h3><div class="pr-dashact no-print"><button type="button" class="ghost pr-small" id="siCX">Excel</button>${canEdit('bom')?'<button type="button" class="ghost pr-small" id="siCMail">Email stock report</button>':''}</div></div>
        <div class="pr-filters no-print"><div class="pr-presets"><button type="button" class="pr-preset${compOnly==='all'?' on':''}" data-sicomp="all">All</button><button type="button" class="pr-preset${compOnly==='attn'?' on':''}" data-sicomp="attn">Needs attention</button></div></div>
        <input type="search" id="siCFilter" class="no-print" placeholder="Search by code or description" value="${esc(compFilter)}" aria-label="Search components">
        <div id="siCTable"></div>
        <p class="hint">Low and critical limits come from the Thresholds tab of the BOM Sheet. A component with no limits there is only flagged when it's out.</p></div>`;
    document.querySelectorAll('[data-sicomp]').forEach(b=>b.onclick=()=>{ compOnly=b.dataset.sicomp; renderComponents(); });
    $('siCFilter').oninput=e=>{ compFilter=e.target.value; drawComponents(); };
    $('siCX').onclick=()=>excel('sonoco_components_'+ymd(new Date())+'.xlsx','Components',['Component Code','Description','Quantity','Low Limit','Critical Limit','Status','Last Updated'],
      c.map(x=>[x.code,x.description,x.quantity,x.low,x.critical,ST[x.status][0],x.lastUpdated]),[2,3,4]);
    wireMail('siCMail','bom',{},'Send the daily component stock email now, to its usual list?');
    drawComponents();
  }
  function drawComponents(){
    const q=compFilter.trim().toLowerCase(), edit=canEdit('bom');
    const rows=BOM.components.filter(x=>(compOnly==='all'||x.status!=='ok')&&(!q||x.code.toLowerCase().includes(q)||x.description.toLowerCase().includes(q)));
    $('siCTable').innerHTML=rows.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Component</th><th class="r">On hand</th><th class="r">Low / critical</th><th>Status</th><th>Updated</th>${edit?'<th></th>':''}</tr></thead><tbody>
      ${rows.map(x=>`<tr${x.status==='out'||x.status==='critical'?' class="sr-inel"':''}><td><b>${esc(x.code)}</b><div class="pr-small-t">${esc(x.description)}</div></td><td class="r"><b>${int(x.quantity)}</b></td>
        <td class="r pr-small-t">${x.low||x.critical?int(x.low)+' / '+int(x.critical):'—'}</td><td>${badge(ST[x.status][0],ST[x.status][1])}</td><td class="nw pr-small-t">${esc(x.lastUpdated)}</td>
        ${edit?`<td class="r">${x.status==='duplicate'?'':`<button type="button" class="ghost pr-small no-print" data-siedit="${esc(x.code)}">Set count</button>`}</td>`:''}</tr>
        ${edit&&editCode===x.code&&x.status!=='duplicate'?`<tr class="si-detail no-print"><td colspan="6"><div class="si-editrow"><label>New count for ${esc(x.code)}<input type="number" id="siENew" min="0" step="1" inputmode="numeric" placeholder="${int(x.quantity)}"></label>
          <label>Note <span class="hint">(optional)</span><input id="siENote" maxlength="300" placeholder="e.g. Cycle count, received 500"></label>
          <div class="sr-calc" id="siECalc"></div><div class="actions"><button type="button" id="siESave">Save count</button><button type="button" class="ghost" id="siECancel">Cancel</button></div></div></td></tr>`:''}`).join('')}
      </tbody></table></div>`:empty(compOnly==='attn'&&!q?'Nothing needs attention.':'Nothing matches.');
    document.querySelectorAll('[data-siedit]').forEach(b=>b.onclick=()=>{ editCode=editCode===b.dataset.siedit?'':b.dataset.siedit; drawComponents(); const i=$('siENew'); if(i) i.focus(); });
    const inp=$('siENew'); if(!inp) return;
    const cur=BOM.components.find(x=>x.code===editCode&&x.status!=='duplicate');
    inp.oninput=()=>{ const v=inp.value, d=n(v)-cur.quantity; $('siECalc').textContent=v===''?'':d===0?'No change':`${int(cur.quantity)} → ${int(v)} (${d>0?'+':'−'}${int(Math.abs(d))})`; };
    $('siECancel').onclick=()=>{ editCode=''; drawComponents(); };
    const save=()=>{ const v=inp.value; if(v===''||n(v)<0||Math.floor(n(v))!==n(v)) return toast('Enter the new count as a whole number.');
      busy($('siESave'),'Saving…',()=>api('bom','setStock',{code:editCode,quantity:n(v),note:$('siENote').value})).then(r=>{ BOM.components=r.components; const code=editCode; editCode=''; toast('Saved'); renderComponents(); msg('<b>'+esc(code)+'</b> set to '+int(v)+'.','good'); })
        .catch(e=>{ toast(errText(e,'bom')); msg(esc(errText(e,'bom')),'bad'); }); };
    $('siESave').onclick=save; inp.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); save(); } };
  }

  // ================================================================ BUILDS
  function renderBuilds(){
    if(!BOM){ $('siBody').innerHTML=need('bom','builds'); return; }
    const edit=canEdit('bom');
    $('siBody').innerHTML=`<div class="sr-two">
      <div class="card pr-card"><h3>${edit?'Record a build':'Bill of materials'}</h3>
        <label>Item<select id="siBItem"><option value="">Select item…</option>${BOM.items.map(i=>`<option value="${esc(i.item)}"${build.item===i.item?' selected':''}>${esc(i.item)} — ${esc(String(i.description).slice(0,60))}</option>`).join('')}</select></label>
        <label>Quantity built<input type="number" id="siBQty" min="1" step="1" inputmode="numeric" placeholder="1" value="${esc(build.qty)}"></label>
        <div id="siBPrev"></div>
        ${edit?'<div class="actions no-print"><button type="button" id="siBSave">Record build</button></div><p class="hint no-print">Recording a build takes its components out of stock. It doesn\'t add the finished spools to inventory — do that on the Inventory tab.</p>':''}
      </div>
      <div class="card pr-card"><div class="pr-cardhead"><h3>Build history</h3><div class="pr-dashact no-print"><button type="button" class="ghost pr-small" id="siHX">Excel</button></div></div>
        <input type="search" id="siHFilter" class="no-print" placeholder="Search item or date" value="${esc(histFilter)}" aria-label="Search build history"><div id="siHist">${empty('Loading…')}</div></div>
    </div>`;
    $('siBItem').onchange=e=>{ build.item=e.target.value; drawPreview(); };
    $('siBQty').oninput=e=>{ build.qty=e.target.value; drawPreview(); };
    $('siHFilter').oninput=e=>{ histFilter=e.target.value; drawHist(); };
    $('siHX').onclick=()=>{ if(hist) excel('sonoco_builds_'+ymd(new Date())+'.xlsx','Builds',['Date','Item','Description','Quantity','Entered By'],hist.rows.map(h=>[h.date,h.item,h.description,h.quantity,h.user]),[3]); };
    if(edit) $('siBSave').onclick=saveBuild;
    drawPreview(); if(hist) drawHist(); else loadHist();
  }
  function previewRows(){
    const item=BOM.items.find(i=>i.item===build.item); if(!item) return null;
    const qty=Math.max(1,Math.floor(n(build.qty))||1), stock=stockMap();
    return {item,qty,rows:needsFor(item,qty).map(c=>{ const s=stock[c.code]; return Object.assign(c,{listed:!!s,have:s?s.quantity:0,after:(s?s.quantity:0)-c.need}); })};
  }
  function drawPreview(){
    const box=$('siBPrev'); if(!box) return; const p=previewRows();
    if(!p){ box.innerHTML='<p class="hint">Pick an item to see its components.</p>'; return; }
    const short=p.rows.filter(r=>r.after<0);
    box.innerHTML=`<div class="pr-sub">${esc(p.item.item)} × ${int(p.qty)}${p.item.company?' · '+esc(p.item.company):''}</div><div class="pr-small-t">${esc(p.item.description)}</div>
      ${p.rows.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Component</th><th class="r">Per unit</th><th class="r">Needed</th><th class="r">On hand</th><th class="r">After</th></tr></thead><tbody>
      ${p.rows.map(r=>`<tr${r.after<0?' class="sr-inel"':''}><td><b>${esc(r.code)}</b><div class="pr-small-t">${esc(r.description)}</div></td><td class="r">${int(r.per)}</td><td class="r">${int(r.need)}</td><td class="r">${r.listed?int(r.have):badge('Not on Inventory tab','bad')}</td><td class="r ${r.after<0?'sr-low':''}">${r.listed?(r.after<0?'−':'')+int(Math.abs(r.after)):'—'}</td></tr>`).join('')}
      </tbody></table></div>`:empty('This item has no components on BOM_Data.')}
      ${short.length?`<div class="pr-msg pr-msg-bad">Not enough stock for ${plural(short.length,'component')}. This build won't save until the count${short.length===1?' is':'s are'} corrected on the Components tab.</div>`:''}`;
  }
  async function saveBuild(){
    const p=previewRows(); if(!p) return toast('Pick the item that was built.');
    if(!(n(build.qty)>0)||Math.floor(n(build.qty))!==n(build.qty)) return toast('Enter the quantity built as a whole number.');
    if(!confirm(`Record ${int(p.qty)} × ${p.item.item}?\n\nThis takes ${plural(p.rows.length,'component')} out of stock.`)) return;
    try{ const r=await busy($('siBSave'),'Saving…',()=>api('bom','build',{item:p.item.item,quantity:p.qty}));
      BOM.components=r.components; hist=null; build={item:'',qty:''}; toast('Build recorded'); renderBuilds(); msg('Recorded <b>'+int(p.qty)+' × '+esc(p.item.item)+'</b>. Components are deducted.','good'); }
    catch(e){ toast(errText(e,'bom')); msg(esc(errText(e,'bom')),'bad'); }
  }
  async function loadHist(){
    try{ hist=await api('bom','history',{limit:500}); if(tab==='builds') drawHist(); }
    catch(e){ const b=$('siHist'); if(b) b.innerHTML=`<div class="pr-empty pr-neg">${esc(errText(e,'bom'))}</div>`; }
  }
  function drawHist(){
    const box=$('siHist'); if(!box||!hist) return; const q=histFilter.trim().toLowerCase();
    const rows=hist.rows.filter(h=>!q||h.item.toLowerCase().includes(q)||h.date.includes(q)||h.description.toLowerCase().includes(q));
    box.innerHTML=rows.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Date</th><th>Item</th><th class="r">Qty</th><th>By</th></tr></thead><tbody>
      ${rows.slice(0,50).map(h=>`<tr><td class="nw">${esc(h.date)}</td><td><b>${esc(h.item)}</b><div class="pr-small-t">${esc(h.description)}</div></td><td class="r">${int(h.quantity)}</td><td class="pr-small-t">${esc(h.user==='Web User'?'':h.user)}</td></tr>`).join('')}
      </tbody></table></div><p class="hint">${rows.length>50?'Showing the newest 50 of '+rows.length+' — search to find older ones. ':''}${hist.total>hist.rows.length?'The newest '+hist.rows.length+' of '+int(hist.total)+' builds are loaded; the rest are on the Production_History tab.':''}</p>`:empty('No builds match.');
  }

  // ================================================================ TRANSACTIONS (finished add / ship log)
  function renderTx(){
    if(!INV){ $('siBody').innerHTML=need('inv','transactions'); return; }
    $('siBody').innerHTML=`<div class="card pr-card"><div class="pr-cardhead"><h3>Finished inventory transactions</h3><div class="pr-dashact no-print"><button type="button" class="ghost pr-small" id="siTX">Excel</button></div></div>
      <input type="search" id="siTFilter" class="no-print" placeholder="Search item, type or notes" value="${esc(txFilter)}" aria-label="Search transactions"><div id="siTx">${empty('Loading…')}</div></div>`;
    $('siTFilter').oninput=e=>{ txFilter=e.target.value; drawTx(); };
    $('siTX').onclick=()=>{ if(tx) excel('sonoco_transactions_'+ymd(new Date())+'.xlsx','Transactions',['Date/Time','Type','Item Name','Quantity','Previous Total','New Total','Notes','User'],tx.map(t=>[t.datetime,t.type,t.itemName,t.quantity,t.previousTotal,t.newTotal,t.notes,t.user]),[3,4,5]); };
    if(tx) drawTx(); else api('inv','transactions',{limit:300}).then(r=>{ tx=r.rows; if(tab==='tx') drawTx(); }).catch(e=>{ const b=$('siTx'); if(b) b.innerHTML=`<div class="pr-empty pr-neg">${esc(errText(e,'inv'))}</div>`; });
  }
  function drawTx(){
    const box=$('siTx'); if(!box||!tx) return; const q=txFilter.trim().toLowerCase();
    const rows=tx.filter(t=>!q||[t.itemName,t.type,t.notes,t.user].some(x=>String(x).toLowerCase().includes(q)));
    box.innerHTML=rows.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>When</th><th>Type</th><th>Item</th><th class="r">Qty</th><th class="r">Before</th><th class="r">After</th><th>Notes</th><th>By</th></tr></thead><tbody>
      ${rows.map(t=>`<tr><td class="nw">${esc(t.datetime)}</td><td>${badge(t.type,t.type==='ADD'?'good':'warn')}</td><td><b>${esc(t.itemName)}</b></td><td class="r">${int(t.quantity)}</td><td class="r">${int(t.previousTotal)}</td><td class="r">${int(t.newTotal)}</td><td>${esc(t.notes)}</td><td class="pr-small-t">${esc(t.user)}</td></tr>`).join('')}
      </tbody></table></div><p class="hint">The newest ${rows.length===tx.length?tx.length:rows.length+' of '+tx.length} loaded. Older ones are on the InventoryTransactions tab.</p>`:empty(tx.length?'Nothing matches.':'No transactions yet.');
  }

  // ---------------------------------------------------------------- nav + lifecycle
  function showNav(){ const nav=$('navSonocoInv'); if(!nav) return; const a=auth(); nav.hidden=!(a&&a.isSignedIn()&&ls.get(LS_OK,'')); }
  function onShow(){ ls.set(LS_SECTION,'sonocoInv'); build_(); showNav(); boot(false); }
  document.addEventListener('DOMContentLoaded',()=>{
    const sec=$('sonocoInv'); if(!sec) return;
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
    showNav(); [1500,4000].forEach(t=>setTimeout(showNav,t));
  });
  window.LWHSonocoInv={ refresh:()=>boot(true) };
})();
