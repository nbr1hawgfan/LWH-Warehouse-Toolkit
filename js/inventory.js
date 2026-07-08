(function(){
  const DEFAULT_URL='https://docs.google.com/spreadsheets/d/e/2PACX-1vR88eoG2Hhmq_JCsS_jZMnBiTWlcmehB4i0A5Z6BXZ2oykJ0KqGB6IhrZc0Tr5l5ZOYxtuy8OffpPL-/pub?output=csv';
  const CUSTOMER_DEFAULT_URL='https://docs.google.com/spreadsheets/d/e/2PACX-1vR88eoG2Hhmq_JCsS_jZMnBiTWlcmehB4i0A5Z6BXZ2oykJ0KqGB6IhrZc0Tr5l5ZOYxtuy8OffpPL-/pub?output=csv';
  const OLD_SHEET_ID='1cMa6qXIJGsnCm5hOQmNUBtxZzFPU5lZIwaYqZzrLPR4';
  let rows=[];
  let customerRows=[];

  function el(id){ return document.getElementById(id); }
  function status(msg){ const s=el('invStatus'); if(s) s.textContent=msg; }
  function customerStatus(msg){ const s=el('custLookupStatus'); if(s) s.textContent=msg; }
  function setCurrentUrl(url){ const u=el('invCurrentUrl'); if(u) u.textContent=url || DEFAULT_URL; }
  function setCustomerCurrentUrl(url){ const u=el('custCurrentUrl'); if(u) u.textContent=url || CUSTOMER_DEFAULT_URL; }

  function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function cleanKey(h){return String(h||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');}

  function normalizeUrl(input, fallback){
    let url=String(input||'').trim();
    if(!url || url.includes(OLD_SHEET_ID)) return fallback || DEFAULT_URL;
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

  function splitDelimited(text){
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
    return lines;
  }

  function parseDelimited(text){
    const lines=splitDelimited(text); if(!lines.length) return [];
    const rawHead=lines.shift().map(v=>String(v||'').trim());
    const head=rawHead.map(cleanKey);
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
      bayname:'bay', baylocation:'bay', bay:'bay', currentbay:'bay',
      datereceived:'dateReceived', received:'dateReceived', receiveddate:'dateReceived'
    };
    const idx={}; head.forEach((h,i)=>{ if(map[h] && idx[map[h]]===undefined) idx[map[h]]=i; });
    const customerMasterLayout=head.join('|').startsWith('controlnumber|invreceipt|subcustnm|itemnm|lotnum|qty|location|comments|vendor|unique2|unique3|unique5|unique6|unique7|unique8|warehouse|bayname|stillininventory|currentbay');
    if(customerMasterLayout){
      return parseCustomerDelimited(text).map(customerToPalletRow).filter(r=>Object.values(r).some(Boolean));
    }
    const known13=head.join('|').startsWith('location|lwhid|customerid|customer|invrec|billtoref|itemnm|itemdesc|lotnum|qty|units|bayname|datereceived');
    if(known13) Object.assign(idx,{location:0,lwhid:1,custId:2,customer:3,invRec:4,billToRef:5,item:6,desc:7,lot:8,qty:9,units:10,bay:11,dateReceived:12});
    const hasHeader=Object.keys(idx).length>=2; const data=hasHeader?lines:[rawHead,...lines];
    function val(r,key,fallback){ const i=idx[key]; return (i!==undefined ? r[i] : r[fallback]) || ''; }
    return data.map(r=>({location:val(r,'location',0),lwhid:val(r,'lwhid',1),custId:val(r,'custId',2),customer:val(r,'customer',3),invRec:val(r,'invRec',4),billToRef:val(r,'billToRef',5),item:val(r,'item',6),desc:val(r,'desc',7),lot:val(r,'lot',8),qty:val(r,'qty',9),units:val(r,'units',10),bay:val(r,'bay',11),dateReceived:val(r,'dateReceived',12)})).filter(r=>Object.values(r).some(Boolean));
  }

  function parseCustomerDelimited(text){
    const lines=splitDelimited(text); if(!lines.length) return [];
    const rawHead=lines.shift().map(v=>String(v||'').trim());
    const head=rawHead.map(cleanKey);
    const map={
      controlnumber:'controlNumber', lwhid:'controlNumber', lwhidcontrolnumber:'controlNumber',
      invreceipt:'invReceipt', invreceiptno:'invReceipt', invrec:'invReceipt',
      subcustnm:'subCustNm', customer:'subCustNm', subcustomer:'subCustNm',
      itemnm:'itemNm', item:'itemNm', itemnumber:'itemNm',
      lotnum:'lotNum', lot:'lotNum', lotnumber:'lotNum',
      qty:'qty', quantity:'qty', location:'location', comments:'comments', vendor:'vendor',
      unique2:'unique2', unique3:'unique3', unique5:'unique5', unique6:'unique6', unique7:'unique7', unique8:'unique8',
      warehouse:'warehouse', bayname:'bayName', bay:'bayName', stillininventory:'stillInInventory', currentbay:'currentBay'
    };
    const idx={}; head.forEach((h,i)=>{ if(map[h] && idx[map[h]]===undefined) idx[map[h]]=i; });
    const known=head.join('|').startsWith('controlnumber|invreceipt|subcustnm|itemnm|lotnum|qty|location|comments|vendor|unique2|unique3|unique5|unique6|unique7|unique8|warehouse|bayname|stillininventory|currentbay');
    if(known){ Object.assign(idx,{controlNumber:0,invReceipt:1,subCustNm:2,itemNm:3,lotNum:4,qty:5,location:6,comments:7,vendor:8,unique2:9,unique3:10,unique5:11,unique6:12,unique7:13,unique8:14,warehouse:15,bayName:16,stillInInventory:17,currentBay:18}); }
    const data=Object.keys(idx).length>=3?lines:[rawHead,...lines];
    function val(r,key,fallback){ const i=idx[key]; return (i!==undefined ? r[i] : r[fallback]) || ''; }
    return data.map(r=>({
      controlNumber:val(r,'controlNumber',0), invReceipt:val(r,'invReceipt',1), subCustNm:val(r,'subCustNm',2), itemNm:val(r,'itemNm',3), lotNum:val(r,'lotNum',4), qty:val(r,'qty',5), location:val(r,'location',6), comments:val(r,'comments',7), vendor:val(r,'vendor',8), unique2:val(r,'unique2',9), unique3:val(r,'unique3',10), unique5:val(r,'unique5',11), unique6:val(r,'unique6',12), unique7:val(r,'unique7',13), unique8:val(r,'unique8',14), warehouse:val(r,'warehouse',15), bayName:val(r,'bayName',16), stillInInventory:val(r,'stillInInventory',17), currentBay:val(r,'currentBay',18)
    })).filter(r=>Object.values(r).some(Boolean));
  }

  function normalizeJson(data){
    const arr=Array.isArray(data)?data:(data && (data.rows||data.data||data.inventory))||[];
    return arr.map(x=>({location:x.Location||x.location||x.Warehouse||x.warehouse||'',lwhid:x.LWH_ID||x.LWHID||x.lwhid||x.ControlNumber||x.controlnumber||x.PalletID||'',custId:x.Customer_ID||x.CustomerID||x.custId||x.Comments||'',customer:x.Customer||x.customer||x.SubCustNm||x.subcustnm||'',invRec:x.InvRec||x.INV_Receipt||x.INVReceipt||x.invRec||'',billToRef:x.BillToRef||x.BillToRefNum||x.billToRef||'',item:x.ItemNm||x.Item||x.item||x.ItemNumber||'',desc:x.ItemDesc||x.Description||x.desc||'',lot:x.LotNum||x.Lot||x.lot||'',qty:x.Qty||x.Quantity||x.qty||'',units:x.Units||x.units||'',bay:x.BayName||x.Bay||x.bay||'',dateReceived:x.DateReceived||x.Received||x.dateReceived||''})).filter(r=>Object.values(r).some(Boolean));
  }

  async function fetchText(url){
    const bust=(url.includes('?')?'&':'?')+'_=' + Date.now();
    let res;
    try{ res=await fetch(url+bust,{cache:'no-store',mode:'cors'}); }
    catch(err){ throw new Error('Fetch blocked or network error while loading: '+url+' — '+err.message); }
    if(!res.ok) throw new Error('HTTP '+res.status+' while loading: '+url);
    const text=await res.text();
    if(/<html|<!doctype html|ServiceLogin|accounts\.google/i.test(text.slice(0,500))) throw new Error('Google returned a web/sign-in page instead of CSV. Loading from: '+url);
    return {text,ctype:(res.headers.get('content-type')||'').toLowerCase()};
  }

  function getInventoryUrl(){ const saved=LWHStorage.get('inventoryUrl',''); const input=el('setInventoryUrl'); const fromInput=input?input.value:''; const url=normalizeUrl(fromInput||saved||DEFAULT_URL,DEFAULT_URL); if(input&&input.value!==url)input.value=url; LWHStorage.set('inventoryUrl',url); setCurrentUrl(url); return url; }
  function getCustomerUrl(){ const saved=LWHStorage.get('customerLookupUrl',''); const input=el('setCustomerLookupUrl'); const fromInput=input?input.value:''; const url=normalizeUrl(fromInput||saved||CUSTOMER_DEFAULT_URL,CUSTOMER_DEFAULT_URL); if(input&&input.value!==url)input.value=url; LWHStorage.set('customerLookupUrl',url); setCustomerCurrentUrl(url); return url; }

  async function loadFromUrl(){ const url=getInventoryUrl(); status('Loading inventory from: '+url); const {text,ctype}=await fetchText(url); rows=(ctype.includes('json')||/^[\s\r\n]*[\[{]/.test(text))?normalizeJson(JSON.parse(text)):parseDelimited(text); LWHStorage.set('inventoryRows',rows); status(`Loaded ${rows.length} row(s) from Google CSV.`); return rows; }
  async function loadCustomerFromUrl(){ const url=getCustomerUrl(); customerStatus('Loading customer lookup from: '+url); const {text,ctype}=await fetchText(url); customerRows=(ctype.includes('json')||/^[\s\r\n]*[\[{]/.test(text))?parseCustomerJson(JSON.parse(text)):parseCustomerDelimited(text); LWHStorage.set('customerLookupRows',customerRows); customerStatus(`Loaded ${customerRows.length} customer lookup row(s).`); return customerRows; }
  function parseCustomerJson(data){ const arr=Array.isArray(data)?data:(data&&(data.rows||data.data))||[]; return arr.map(x=>({controlNumber:x.ControlNumber||x.controlNumber||'',invReceipt:x.INV_Receipt||x.InvRec||x.invReceipt||'',subCustNm:x.SubCustNm||x.Customer||'',itemNm:x.ItemNm||'',lotNum:x.LotNum||'',qty:x.Qty||'',location:x.Location||'',comments:x.Comments||'',vendor:x.Vendor||'',unique2:x.Unique2||'',unique3:x.Unique3||'',unique5:x.Unique5||'',unique6:x.Unique6||'',unique7:x.Unique7||'',unique8:x.Unique8||'',warehouse:x.Warehouse||'',bayName:x.BayName||'',stillInInventory:x.Still_In_Inventory||'',currentBay:x.CurrentBay||''})); }

  function loadCached(){ rows=LWHStorage.get('inventoryRows',[]); customerRows=LWHStorage.get('customerLookupRows',[]); setCurrentUrl(LWHStorage.get('inventoryUrl',DEFAULT_URL)||DEFAULT_URL); setCustomerCurrentUrl(LWHStorage.get('customerLookupUrl',CUSTOMER_DEFAULT_URL)||CUSTOMER_DEFAULT_URL); status(rows.length?`Using ${rows.length} cached receiving row(s) while auto-load refreshes.`:'Receiving data not loaded yet. Auto-load will try to refresh.'); customerStatus(customerRows.length?`Using ${customerRows.length} cached Master Lookup row(s) while auto-load refreshes.`:'Master Lookup data not loaded yet. Auto-load will try to refresh.'); }
  function resetSource(){ LWHStorage.set('inventoryUrl',DEFAULT_URL); const input=el('setInventoryUrl'); if(input) input.value=DEFAULT_URL; setCurrentUrl(DEFAULT_URL); status('Receiving Print source reset to the published CSV link. The app will auto-load it, or click Load / Refresh Data.'); }
  function resetCustomerSource(){ LWHStorage.set('customerLookupUrl',CUSTOMER_DEFAULT_URL); const input=el('setCustomerLookupUrl'); if(input) input.value=CUSTOMER_DEFAULT_URL; setCustomerCurrentUrl(CUSTOMER_DEFAULT_URL); customerStatus('Master Lookup source reset. Click Load / Refresh Data.'); }

  function search(q){ q=String(q||'').toLowerCase().trim(); if(!q) return rows.slice(0,50); const terms=q.split(/\s+/); return rows.filter(r=>{const hay=Object.values(r).join(' ').toLowerCase(); return terms.every(t=>hay.includes(t));}).slice(0,100); }

  const customerFieldOrder=['controlNumber','invReceipt','subCustNm','itemNm','lotNum','qty','location','comments','vendor','unique2','unique3','unique5','unique6','unique7','unique8','warehouse','bayName','stillInInventory','currentBay'];
  const customerDefaultLabels={controlNumber:'LWH ID / Control #',invReceipt:'INV Receipt',subCustNm:'Customer',itemNm:'Item #',lotNum:'Lot #',qty:'Qty',location:'Location',comments:'Comments / Customer ID',vendor:'Vendor',unique2:'Unique2',unique3:'Unique3',unique5:'Unique5',unique6:'Unique6',unique7:'Unique7',unique8:'Unique8',warehouse:'Warehouse',bayName:'Bay Name',stillInInventory:'Still In Inventory',currentBay:'Current Bay'};
  function customerLabels(){ return Object.assign({},customerDefaultLabels,LWHStorage.get('customerFieldLabels',{})||{}); }
  function saveCustomerLabelsFromSettings(){ const labels={}; customerFieldOrder.forEach(k=>{ const input=el('custLabel_'+k); if(input) labels[k]=input.value||customerDefaultLabels[k]; }); LWHStorage.set('customerFieldLabels',labels); LWHUI.toast('Customer lookup labels saved'); }
  function loadCustomerLabelsToSettings(){ const labels=customerLabels(); customerFieldOrder.forEach(k=>{ const input=el('custLabel_'+k); if(input) input.value=labels[k]||customerDefaultLabels[k]; }); }
  function bestMatchField(r,terms){ const labels=customerLabels(); for(const k of customerFieldOrder){ const value=String(r[k]||'').toLowerCase(); if(value && terms.some(t=>value.includes(t))) return {key:k,label:labels[k]||k,value:r[k]}; } return null; }
  function customerSearch(q){ q=String(q||'').toLowerCase().trim(); if(!q) return customerRows.slice(0,50).map(r=>({row:r,match:null})); const terms=q.split(/\s+/); return customerRows.filter(r=>{const hay=customerFieldOrder.map(k=>r[k]).join(' ').toLowerCase(); return terms.every(t=>hay.includes(t));}).slice(0,100).map(r=>({row:r,match:bestMatchField(r,terms)})); }
  function customerToPalletRow(r){ return {location:r.location||r.warehouse||'',lwhid:r.controlNumber||'',custId:r.comments||'',customer:r.subCustNm||'',invRec:r.invReceipt||'',billToRef:'',item:r.itemNm||'',desc:'',lot:r.lotNum||'',qty:r.qty||'',units:'',bay:r.currentBay||r.bayName||'',dateReceived:'',vendor:r.vendor||'',unique8:r.unique8||''}; }
  function copyCustomerResult(r){ const labels=customerLabels(); const text=customerFieldOrder.map(k=>`${labels[k]||k}: ${r[k]||''}`).join('\n'); navigator.clipboard?.writeText(text).then(()=>LWHUI.toast('Result copied')).catch(()=>alert(text)); }
  function renderCustomerResults(list){ const out=el('customerLookupResults'); const printOut=el('customerLookupPrintOutput'); if(printOut) printOut.innerHTML=''; if(!out)return; out.innerHTML=''; if(!list.length){ out.innerHTML='<div class="card">No customer lookup results found.</div>'; return; } const labels=customerLabels(); const top=document.createElement('div'); top.className='card'; top.innerHTML=`<b>${list.length}</b> matching row(s)<div class="actions"><button type="button" id="custPrintAll">Print Pallet Labels</button></div>`; out.append(top); const wrap=document.createElement('div'); wrap.className='result-list customer-results'; list.forEach((obj,i)=>{ const r=obj.row; const match=obj.match; const c=document.createElement('div'); c.className='result-card customer-card'; const grid=customerFieldOrder.map(k=>`<div class="cust-field"><b>${safe(labels[k]||k)}</b><span>${safe(r[k]||'')}</span></div>`).join(''); c.innerHTML=`<div><b>${safe(r.controlNumber)}</b> <span>${safe(r.subCustNm)}</span></div><div>${safe(r.warehouse||r.location)} · Bay <b>${safe(r.currentBay||r.bayName)}</b> · Qty ${safe(r.qty)} · INV ${safe(r.invReceipt)}</div>${match?`<div class="match-pill">Matched on ${safe(match.label)}: <b>${safe(match.value)}</b></div>`:''}<details open><summary>All customer lookup fields</summary><div class="cust-grid">${grid}</div></details><div class="actions"><button type="button" data-cust-print="${i}">Print Pallet Label</button><button type="button" data-cust-copy="${i}" class="ghost">Copy Result</button><button type="button" data-cust-fill="${i}" class="ghost">Fill Pallet Form</button></div>`; wrap.append(c); }); out.append(wrap); const rowsForLabels=list.map(x=>customerToPalletRow(x.row)); const pa=el('custPrintAll'); if(pa) pa.onclick=()=>printRows(rowsForLabels,printOut||lookupPrintOutput); wrap.onclick=e=>{ const b=e.target.closest('button'); if(!b)return; const idx=+(b.dataset.custPrint??b.dataset.custCopy??b.dataset.custFill); const obj=list[idx]; if(!obj)return; if(b.dataset.custPrint!==undefined) printRows([customerToPalletRow(obj.row)],printOut||lookupPrintOutput); if(b.dataset.custCopy!==undefined) copyCustomerResult(obj.row); if(b.dataset.custFill!==undefined){ fillPallet(customerToPalletRow(obj.row)); LWHUI.show('pallet'); } }; }

  function getRows(){return rows.slice();}
  function printRows(list,target){ if(!list||!list.length){LWHUI.toast('No rows to print'); return;} LWHLabels.generatePalletRows(list,target||lookupPrintOutput); LWHStorage.set('lookupCount',(+LWHStorage.get('lookupCount',0))+1); setTimeout(()=>window.print(),300); }
  function render(list){ inventoryResults.innerHTML=''; lookupPrintOutput.innerHTML=''; if(!list.length){inventoryResults.innerHTML='<div class="card">No matching inventory found.</div>'; return;} const top=document.createElement('div'); top.className='card'; const invRecs=[...new Set(list.map(r=>String(r.invRec||'').trim()).filter(Boolean))]; top.innerHTML=`<b>${list.length}</b> matching row(s)${invRecs.length===1?` · InvRec <b>${safe(invRecs[0])}</b>`:''}<div class="actions"><button type="button" id="lookupPrintAll">Print All Found Pallet Labels</button>${invRecs.length===1?`<button type="button" id="lookupOpenReceiving" class="ghost">Open Receiving Print</button>`:''}</div>`; inventoryResults.append(top); const wrap=document.createElement('div'); wrap.className='result-list'; list.forEach((r,i)=>{const c=document.createElement('div'); c.className='result-card'; c.innerHTML=`<div><b>${safe(r.lwhid)}</b> <span>${safe(r.customer)}</span></div><div>${safe(r.location)} · Bay <b>${safe(r.bay)}</b> · Qty ${safe(r.qty)}${r.invRec?' · InvRec '+safe(r.invRec):''}</div><div>${safe(r.item)} — ${safe(r.desc)} · Lot ${safe(r.lot)}</div><div class="actions"><button type="button" data-print-pal="${i}">Print Pallet Label</button><button type="button" data-fill-pal="${i}" class="ghost">Fill Pallet Form</button><button type="button" data-rack="${i}" class="ghost">Rack Label</button></div>`; wrap.append(c);}); inventoryResults.append(wrap); const printAll=el('lookupPrintAll'); if(printAll) printAll.onclick=()=>printRows(list,lookupPrintOutput); const openRec=el('lookupOpenReceiving'); if(openRec) openRec.onclick=()=>{recInvRec.value=invRecs[0]; LWHUI.show('receiving'); findReceiving();}; wrap.onclick=e=>{const b=e.target.closest('button'); if(!b)return; const idx=+(b.dataset.printPal??b.dataset.fillPal??b.dataset.rack); const r=list[idx]; if(!r)return; if(b.dataset.printPal!==undefined) printRows([r],lookupPrintOutput); if(b.dataset.fillPal!==undefined){fillPallet(r); LWHUI.show('pallet');} if(b.dataset.rack!==undefined){rackList.value=r.bay||r.lwhid; LWHUI.show('rack'); LWHLabels.generateRack();}}; }
  function findReceiving(){ const q=String((el('recInvRec')||{}).value||'').trim(); const out=el('receivingResults'); const statusEl=el('recStatus'); const printOut=el('receivingPrintOutput'); if(printOut) printOut.innerHTML=''; if(!q){ if(statusEl) statusEl.textContent='Enter an InvRec first.'; return []; } const list=rows.filter(r=>String(r.invRec||'').trim().toLowerCase()===q.toLowerCase()); if(statusEl) statusEl.textContent=`Found ${list.length} pallet(s) for InvRec ${q}.`; if(out){ if(!list.length){out.innerHTML='<div class="card">No pallets found for that InvRec.</div>';} else { const cust=[...new Set(list.map(r=>r.customer).filter(Boolean))].join(', '); const bays=[...new Set(list.map(r=>r.bay).filter(Boolean))].slice(0,8).join(', '); out.innerHTML=`<div class="card"><h3>InvRec ${safe(q)}</h3><p><b>${list.length}</b> pallet(s) ${cust?`· ${safe(cust)}`:''}</p><p class="hint">Bays: ${safe(bays || 'n/a')}</p><div class="actions"><button type="button" id="recPrintAll2">Print All ${list.length}</button><button type="button" id="recFillBulk" class="ghost">Send to Pallet Bulk</button></div></div><div class="result-list">${list.slice(0,100).map(r=>`<div class="result-card"><div><b>${safe(r.lwhid)}</b> <span>${safe(r.customer)}</span></div><div>${safe(r.location)} · Bay <b>${safe(r.bay)}</b> · Qty ${safe(r.qty)}</div><div>${safe(r.item)} — ${safe(r.desc)} · Lot ${safe(r.lot)}</div></div>`).join('')}</div>`; const b=el('recPrintAll2'); if(b)b.onclick=()=>printRows(list,printOut||lookupPrintOutput); const bulk=el('recFillBulk'); if(bulk) bulk.onclick=()=>{palletBulkText.value=toTSV(list); document.querySelector('[data-pallet-mode="bulk"]').click(); LWHUI.show('pallet'); LWHUI.toast('Rows sent to Pallet Bulk Paste');}; }} return list; }
  function toTSV(list){ const h=['Location','LWH_ID','Customer_ID','Customer','InvRec','BillToRef','ItemNm','ItemDesc','LotNum','Qty','Units','BayName','DateReceived']; const keys=['location','lwhid','custId','customer','invRec','billToRef','item','desc','lot','qty','units','bay','dateReceived']; return [h.join('\t'),...list.map(r=>keys.map(k=>String(r[k]??'').replace(/\t/g,' ')).join('\t'))].join('\n'); }
  function fillPallet(r){ if(window.palLocation) palLocation.value=r.location||''; palLwhid.value=r.lwhid||''; palCustId.value=r.custId||''; palCustomer.value=r.customer||''; palBay.value=r.bay||''; palItem.value=r.item||''; palLot.value=r.lot||''; palQty.value=r.qty||''; palDate.value=r.dateReceived||''; palDesc.value=r.desc||''; document.querySelector('[data-pallet-mode="simple"]').click(); }
  window.LWHInventory={DEFAULT_URL,CUSTOMER_DEFAULT_URL,parseDelimited,parseCustomerDelimited,loadFromUrl,loadCustomerFromUrl,loadCached,search,render,fillPallet,normalizeUrl,resetSource,resetCustomerSource,getInventoryUrl,getCustomerUrl,getRows,printRows,findReceiving,toTSV,customerSearch,renderCustomerResults,customerLabels,loadCustomerLabelsToSettings,saveCustomerLabelsFromSettings};
})();
