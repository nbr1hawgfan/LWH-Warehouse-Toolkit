(function(){
  const DEFAULT_URL='https://docs.google.com/spreadsheets/d/e/2PACX-1vQrB8PJ7Mok49e-HmIrEmArRUMyRkA8d1bhq0PIbkp80pEN3viACRzh0y7XxWSmw3EmqjIfXfWZv6af/pub?output=csv';
  const OLD_SHEET_ID='1cMa6qXIJGsnCm5hOQmNUBtxZzFPU5lZIwaYqZzrLPR4';
  let rows=[];

  function el(id){ return document.getElementById(id); }
  function status(msg){ const s=el('invStatus'); if(s) s.textContent=msg; }
  function setCurrentUrl(url){ const u=el('invCurrentUrl'); if(u) u.textContent=url || DEFAULT_URL; }

  function normalizeUrl(input){
    let url=String(input||'').trim();
    if(!url || url.includes(OLD_SHEET_ID)) return DEFAULT_URL;
    if(url.includes('/pub?') || url.includes('/pubhtml?')){
      return url.replace('/pubhtml?','/pub?').replace(/output=html/i,'output=csv').replace(/single=true&?/i,'').replace(/&&/g,'&');
    }
    const m=url.match(/spreadsheets\/d\/([^/]+)/);
    if(m && !/export\?format=csv|gviz\/tq|script\.google\.com/.test(url)){
      const gid=(url.match(/[?&#]gid=(\d+)/)||[])[1]||'0';
      return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&gid=${gid}`;
    }
    return url;
  }

  function getInventoryUrl(){
    const saved=LWHStorage.get('inventoryUrl','');
    const input=el('setInventoryUrl');
    const fromInput=input ? input.value : '';
    const url=normalizeUrl(fromInput || saved || DEFAULT_URL);
    if(input && input.value !== url) input.value=url;
    LWHStorage.set('inventoryUrl',url);
    setCurrentUrl(url);
    return url;
  }

  function parseDelimited(text){
    text=(text||'').replace(/^\uFEFF/,'').trim(); if(!text) return [];
    const delim=text.indexOf('\t')>-1?'\t':',';
    const lines=[]; let cur='', row=[], q=false;
    for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1]; if(c==='"'){ if(q&&n==='"'){cur+='"';i++;} else q=!q; } else if(!q && c===delim){row.push(cur);cur='';} else if(!q && (c==='\n'||c==='\r')){ if(c==='\r'&&n==='\n')i++; row.push(cur); if(row.some(x=>String(x).trim())) lines.push(row); row=[]; cur='';} else cur+=c;}
    row.push(cur); if(row.some(x=>String(x).trim())) lines.push(row);
    if(!lines.length) return [];
    const rawHead=lines.shift();
    const head=rawHead.map(h=>String(h||'').trim().toLowerCase().replace(/[^a-z0-9]/g,''));
    const map={location:'location',warehouse:'location',lwhid:'lwhid',lwhidcontrolnumber:'lwhid',controlnumber:'lwhid',palletid:'lwhid',customerid:'custId',comments:'custId',customer:'customer',subcustnm:'customer',subcustomer:'customer',invrec:'invRec',invreceipt:'invRec',invreceiptno:'invRec',invreceiptid:'invRec',billtoref:'billToRef',billtorefnum:'billToRef',billtoreference:'billToRef',itemnm:'item',itemnumber:'item',item:'item',itemdesc:'desc',description:'desc',lotnum:'lot',lotnumber:'lot',lot:'lot',qty:'qty',quantity:'qty',units:'units',unit:'units',bayname:'bay',baylocation:'bay',bay:'bay',datereceived:'dateReceived',received:'dateReceived'};
    const idx={}; head.forEach((h,i)=>{ if(map[h]) idx[map[h]]=i; });
    const hasHeader=Object.keys(idx).length>=2;
    const data=hasHeader?lines:[rawHead,...lines];
    return data.map(r=>({
      location:r[idx.location??0]||'',
      lwhid:r[idx.lwhid??1]||'',
      custId:r[idx.custId??2]||'',
      customer:r[idx.customer??3]||'',
      invRec:r[idx.invRec??4]||'',
      billToRef:r[idx.billToRef??5]||'',
      item:r[idx.item??6]||'',
      desc:r[idx.desc??7]||'',
      lot:r[idx.lot??8]||'',
      qty:r[idx.qty??9]||'',
      units:r[idx.units??10]||'',
      bay:r[idx.bay??11]||'',
      dateReceived:r[idx.dateReceived??12]||''
    })).filter(r=>Object.values(r).some(Boolean));
  }

  function normalizeJson(data){
    const arr=Array.isArray(data)?data:(data && (data.rows||data.data||data.inventory))||[];
    return arr.map(x=>({
      location:x.Location||x.location||x.Warehouse||x.warehouse||'',
      lwhid:x.LWH_ID||x.LWHID||x.lwhid||x.ControlNumber||x.controlnumber||x.PalletID||'',
      custId:x.Customer_ID||x.CustomerID||x.custId||x.Comments||'',
      customer:x.Customer||x.customer||x.SubCustNm||x.subcustnm||'',
      invRec:x.InvRec||x.INV_Receipt||x.INVReceipt||x.invRec||'',
      billToRef:x.BillToRef||x.BillToRefNum||x.billToRef||'',
      item:x.ItemNm||x.Item||x.item||x.ItemNumber||'',
      desc:x.ItemDesc||x.Description||x.desc||'',
      lot:x.LotNum||x.Lot||x.lot||'',
      qty:x.Qty||x.Quantity||x.qty||'',
      units:x.Units||x.units||'',
      bay:x.BayName||x.Bay||x.bay||'',
      dateReceived:x.DateReceived||x.Received||x.dateReceived||''
    })).filter(r=>Object.values(r).some(Boolean));
  }

  async function loadFromUrl(){
    const url=getInventoryUrl();
    status('Loading inventory from: '+url);
    const bust=(url.includes('?')?'&':'?')+'_=' + Date.now();
    let res;
    try{
      res=await fetch(url+bust,{cache:'no-store',mode:'cors'});
    }catch(err){
      throw new Error('Fetch blocked or network error while loading: '+url+' — '+err.message);
    }
    if(!res.ok) throw new Error('HTTP '+res.status+' while loading: '+url);
    const ctype=(res.headers.get('content-type')||'').toLowerCase();
    const text=await res.text();
    if(/<html|<!doctype html|ServiceLogin|accounts\.google/i.test(text.slice(0,500))){
      throw new Error('Google returned a web/sign-in page instead of CSV. Loading from: '+url);
    }
    if(ctype.includes('json') || /^[\s\r\n]*[\[{]/.test(text)) rows=normalizeJson(JSON.parse(text));
    else rows=parseDelimited(text);
    LWHStorage.set('inventoryRows',rows);
    status(`Loaded ${rows.length} row(s) from Google CSV.`);
    return rows;
  }

  function loadCached(){ rows=LWHStorage.get('inventoryRows',[]); setCurrentUrl(LWHStorage.get('inventoryUrl',DEFAULT_URL)||DEFAULT_URL); status(rows.length?`Using ${rows.length} cached row(s).`:'Inventory not loaded yet.'); }
  function resetSource(){ LWHStorage.set('inventoryUrl',DEFAULT_URL); const input=el('setInventoryUrl'); if(input) input.value=DEFAULT_URL; setCurrentUrl(DEFAULT_URL); status('Inventory source reset to the published CSV link. Click Load / Refresh Data.'); }
  function search(q){ q=String(q||'').toLowerCase().trim(); if(!q) return rows.slice(0,50); const terms=q.split(/\s+/); return rows.filter(r=>{const hay=Object.values(r).join(' ').toLowerCase(); return terms.every(t=>hay.includes(t));}).slice(0,100); }
  function render(list){ inventoryResults.innerHTML=''; lookupPrintOutput.innerHTML=''; if(!list.length){inventoryResults.innerHTML='<div class="card">No matching inventory found.</div>'; return;} const wrap=document.createElement('div'); wrap.className='result-list'; list.forEach((r,i)=>{const c=document.createElement('div'); c.className='result-card'; c.innerHTML=`<div><b>${safe(r.lwhid)}</b> <span>${safe(r.customer)}</span></div><div>${safe(r.location)} · Bay <b>${safe(r.bay)}</b> · Qty ${safe(r.qty)}${r.invRec?' · InvRec '+safe(r.invRec):''}</div><div>${safe(r.item)} — ${safe(r.desc)} · Lot ${safe(r.lot)}</div><div class="actions"><button type="button" data-print-pal="${i}">Print Pallet Label</button><button type="button" data-fill-pal="${i}" class="ghost">Fill Pallet Form</button><button type="button" data-rack="${i}" class="ghost">Rack Label</button></div>`; wrap.append(c);}); inventoryResults.append(wrap); wrap.onclick=e=>{const b=e.target.closest('button'); if(!b)return; const r=list[+Object.values(b.dataset)[0]]; if(b.dataset.printPal!==undefined){fillPallet(r); LWHUI.show('pallet'); LWHLabels.generatePallet(); LWHStorage.set('lookupCount',(+LWHStorage.get('lookupCount',0))+1);} if(b.dataset.fillPal!==undefined){fillPallet(r); LWHUI.show('pallet');} if(b.dataset.rack!==undefined){rackList.value=r.bay||r.lwhid; LWHUI.show('rack'); LWHLabels.generateRack();}}; }
  function fillPallet(r){ if(window.palLocation) palLocation.value=r.location||''; palLwhid.value=r.lwhid||''; palCustId.value=r.custId||''; palCustomer.value=r.customer||''; palBay.value=r.bay||''; palItem.value=r.item||''; palLot.value=r.lot||''; palQty.value=r.qty||''; palDate.value=r.dateReceived||''; palDesc.value=r.desc||''; document.querySelector('[data-pallet-mode="simple"]').click(); }
  function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  window.LWHInventory={DEFAULT_URL,parseDelimited,loadFromUrl,loadCached,search,render,fillPallet,normalizeUrl,resetSource,getInventoryUrl};
})();
