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
    for(let i=0;i<text.length;i++){
      const c=text[i],n=text[i+1];
      if(c==='"'){
        if(q&&n==='"'){cur+='"';i++;} else q=!q;
      } else if(!q && c===delim){
        row.push(cur);cur='';
      } else if(!q && (c==='\n'||c==='\r')){
        if(c==='\r'&&n==='\n')i++;
        row.push(cur); if(row.some(x=>String(x).trim())) lines.push(row); row=[]; cur='';
      } else cur+=c;
    }
    row.push(cur); if(row.some(x=>String(x).trim())) lines.push(row);
    if(!lines.length) return [];

    const rawHead=lines.shift().map(v=>String(v||'').trim());
    const head=rawHead.map(h=>h.toLowerCase().replace(/[^a-z0-9]/g,''));

    // Header aliases. Keep this very explicit because the receiving print module
    // depends on InvRec being column E in the new sheet, not ItemNm column G.
    const map={
      location:'location', warehouse:'location', whse:'location',
      lwhid:'lwhid', lwhidcontrolnumber:'lwhid', controlnumber:'lwhid', palletid:'lwhid',
      customerid:'custId', custid:'custId', comments:'custId',
      customer:'customer', subcustnm:'customer', subcustomer:'customer',
      invrec:'invRec', invreceipt:'invRec', invreceiptno:'invRec', invreceiptid:'invRec', invreceiptnumber:'invRec', invreceiptref:'invRec',
      billtoref:'billToRef', billtorefnum:'billToRef', billtoreference:'billToRef', billto:'billToRef',
      itemnm:'item', itemnumber:'item', item:'item', itemno:'item', itemnum:'item',
      itemdesc:'desc', description:'desc', itemdescription:'desc',
      lotnum:'lot', lotnumber:'lot', lot:'lot',
      qty:'qty', quantity:'qty',
      units:'units', unit:'units',
      bayname:'bay', baylocation:'bay', bay:'bay',
      datereceived:'dateReceived', received:'dateReceived', receiveddate:'dateReceived'
    };
    const idx={};
    head.forEach((h,i)=>{ if(map[h] && idx[map[h]]===undefined) idx[map[h]]=i; });

    // Special known layout from Tim's new receiving sheet:
    // Location,LWH_ID,Customer_ID,Customer,InvRec,BillToRef,ItemNm,ItemDesc,LotNum,Qty,Units,BayName,DateReceived
    const known13 = head.join('|').startsWith('location|lwhid|customerid|customer|invrec|billtoref|itemnm|itemdesc|lotnum|qty|units|bayname|datereceived');
    if(known13){
      Object.assign(idx,{location:0,lwhid:1,custId:2,customer:3,invRec:4,billToRef:5,item:6,desc:7,lot:8,qty:9,units:10,bay:11,dateReceived:12});
    }

    const hasHeader=Object.keys(idx).length>=2;
    const data=hasHeader?lines:[rawHead,...lines];

    function val(r,key,fallback){
      const i = idx[key];
      return (i!==undefined ? r[i] : r[fallback]) || '';
    }

    return data.map(r=>({
      location:val(r,'location',0),
      lwhid:val(r,'lwhid',1),
      custId:val(r,'custId',2),
      customer:val(r,'customer',3),
      invRec:val(r,'invRec',4),
      billToRef:val(r,'billToRef',5),
      item:val(r,'item',6),
      desc:val(r,'desc',7),
      lot:val(r,'lot',8),
      qty:val(r,'qty',9),
      units:val(r,'units',10),
      bay:val(r,'bay',11),
      dateReceived:val(r,'dateReceived',12)
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
  function getRows(){return rows.slice();}
  function printRows(list,target){
    if(!list || !list.length){LWHUI.toast('No rows to print'); return;}
    LWHLabels.generatePalletRows(list,target||lookupPrintOutput);
    LWHStorage.set('lookupCount',(+LWHStorage.get('lookupCount',0))+1);
  }
  function render(list){
    inventoryResults.innerHTML=''; lookupPrintOutput.innerHTML='';
    if(!list.length){inventoryResults.innerHTML='<div class="card">No matching inventory found.</div>'; return;}
    const top=document.createElement('div'); top.className='card';
    const invRecs=[...new Set(list.map(r=>String(r.invRec||'').trim()).filter(Boolean))];
    top.innerHTML=`<b>${list.length}</b> matching row(s)${invRecs.length===1?` · InvRec <b>${safe(invRecs[0])}</b>`:''}<div class="actions"><button type="button" id="lookupPrintAll">Print All Found Pallet Labels</button>${invRecs.length===1?`<button type="button" id="lookupOpenReceiving" class="ghost">Open Receiving Print</button>`:''}</div>`;
    inventoryResults.append(top);
    const wrap=document.createElement('div'); wrap.className='result-list';
    list.forEach((r,i)=>{const c=document.createElement('div'); c.className='result-card'; c.innerHTML=`<div><b>${safe(r.lwhid)}</b> <span>${safe(r.customer)}</span></div><div>${safe(r.location)} · Bay <b>${safe(r.bay)}</b> · Qty ${safe(r.qty)}${r.invRec?' · InvRec '+safe(r.invRec):''}</div><div>${safe(r.item)} — ${safe(r.desc)} · Lot ${safe(r.lot)}</div><div class="actions"><button type="button" data-print-pal="${i}">Print Pallet Label</button><button type="button" data-fill-pal="${i}" class="ghost">Fill Pallet Form</button><button type="button" data-rack="${i}" class="ghost">Rack Label</button></div>`; wrap.append(c);});
    inventoryResults.append(wrap);
    const printAll=document.getElementById('lookupPrintAll'); if(printAll) printAll.onclick=()=>printRows(list,lookupPrintOutput);
    const openRec=document.getElementById('lookupOpenReceiving'); if(openRec) openRec.onclick=()=>{recInvRec.value=invRecs[0]; LWHUI.show('receiving'); findReceiving();};
    wrap.onclick=e=>{const b=e.target.closest('button'); if(!b)return; const idx=+(b.dataset.printPal??b.dataset.fillPal??b.dataset.rack); const r=list[idx]; if(!r)return; if(b.dataset.printPal!==undefined){printRows([r],lookupPrintOutput);} if(b.dataset.fillPal!==undefined){fillPallet(r); LWHUI.show('pallet');} if(b.dataset.rack!==undefined){rackList.value=r.bay||r.lwhid; LWHUI.show('rack'); LWHLabels.generateRack();}};
  }
  function findReceiving(){
    const q=String((document.getElementById('recInvRec')||{}).value||'').trim();
    const out=document.getElementById('receivingResults'); const statusEl=document.getElementById('recStatus'); const printOut=document.getElementById('receivingPrintOutput');
    if(printOut) printOut.innerHTML='';
    if(!q){ if(statusEl) statusEl.textContent='Enter an InvRec first.'; return []; }
    const list=rows.filter(r=>String(r.invRec||'').trim().toLowerCase()===q.toLowerCase());
    if(statusEl) statusEl.textContent=`Found ${list.length} pallet(s) for InvRec ${q}.`;
    if(out){
      if(!list.length){out.innerHTML='<div class="card">No pallets found for that InvRec.</div>';} else {
        const cust=[...new Set(list.map(r=>r.customer).filter(Boolean))].join(', ');
        const bays=[...new Set(list.map(r=>r.bay).filter(Boolean))].slice(0,8).join(', ');
        out.innerHTML=`<div class="card"><h3>InvRec ${safe(q)}</h3><p><b>${list.length}</b> pallet(s) ${cust?`· ${safe(cust)}`:''}</p><p class="hint">Bays: ${safe(bays || 'n/a')}</p><div class="actions"><button type="button" id="recPrintAll2">Print All ${list.length}</button><button type="button" id="recFillBulk" class="ghost">Send to Pallet Bulk</button></div></div><div class="result-list">${list.slice(0,100).map((r,i)=>`<div class="result-card"><div><b>${safe(r.lwhid)}</b> <span>${safe(r.customer)}</span></div><div>${safe(r.location)} · Bay <b>${safe(r.bay)}</b> · Qty ${safe(r.qty)}</div><div>${safe(r.item)} — ${safe(r.desc)} · Lot ${safe(r.lot)}</div></div>`).join('')}</div>`;
        const b=document.getElementById('recPrintAll2'); if(b)b.onclick=()=>printRows(list,printOut||lookupPrintOutput);
        const bulk=document.getElementById('recFillBulk'); if(bulk) bulk.onclick=()=>{palletBulkText.value=toTSV(list); document.querySelector('[data-pallet-mode="bulk"]').click(); LWHUI.show('pallet'); LWHUI.toast('Rows sent to Pallet Bulk Paste');};
      }
    }
    return list;
  }
  function toTSV(list){
    const h=['Location','LWH_ID','Customer_ID','Customer','InvRec','BillToRef','ItemNm','ItemDesc','LotNum','Qty','Units','BayName','DateReceived'];
    const keys=['location','lwhid','custId','customer','invRec','billToRef','item','desc','lot','qty','units','bay','dateReceived'];
    return [h.join('\t'),...list.map(r=>keys.map(k=>String(r[k]??'').replace(/\t/g,' ')).join('\t'))].join('\n');
  }
function fillPallet(r){ if(window.palLocation) palLocation.value=r.location||''; palLwhid.value=r.lwhid||''; palCustId.value=r.custId||''; palCustomer.value=r.customer||''; palBay.value=r.bay||''; palItem.value=r.item||''; palLot.value=r.lot||''; palQty.value=r.qty||''; palDate.value=r.dateReceived||''; palDesc.value=r.desc||''; document.querySelector('[data-pallet-mode="simple"]').click(); }
  function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  window.LWHInventory={DEFAULT_URL,parseDelimited,loadFromUrl,loadCached,search,render,fillPallet,normalizeUrl,resetSource,getInventoryUrl,getRows,printRows,findReceiving,toTSV};
})();
