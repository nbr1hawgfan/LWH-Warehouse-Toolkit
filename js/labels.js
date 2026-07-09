function page(cls,html){const d=document.createElement('div');d.className='label-page '+cls;d.innerHTML=html;const x=+LWHStorage.get('calX',0),y=+LWHStorage.get('calY',0),sc=+LWHStorage.get('calScale',100);d.style.transform=`translate(${x}px,${y}px) scale(${sc/100})`;d.style.transformOrigin='top left';return d}
// Sets/clears an explicit @page size for the *next* print job. Without this,
// the browser has no idea a given label is 6in-wide-by-4in-tall (landscape)
// vs. some other shape, and falls back to whatever page size/orientation was
// last used — usually portrait Letter — forcing a manual fix in the print
// dialog every time. Scoped narrowly (only pallet labels set this today);
// LWHUI.show() clears it whenever the active screen changes so it never
// leaks into a different label type's print job.
function setPrintPageSize(widthIn,heightIn){
  let style=document.getElementById('dynamicPageSize');
  if(!style){style=document.createElement('style');style.id='dynamicPageSize';document.head.appendChild(style);}
  style.textContent=(widthIn&&heightIn)?`@media print{@page{size:${widthIn}in ${heightIn}in;margin:0}}`:'';
}
function finishBarcodes(root){root.querySelectorAll('svg[data-barcode]').forEach(svg=>LWHBarcode.make(svg,svg.dataset.barcode,{height:+svg.dataset.height||80,width:+svg.dataset.width||2}));root.querySelectorAll('.qrbox[data-qr]').forEach(q=>LWHQR.make(q,q.dataset.qr,+q.dataset.size||110));}

function autoFitText(el,minPx=30){
  if(!el)return;
  const cs=getComputedStyle(el);
  const maxPx=parseFloat(el.dataset.maxFont || cs.fontSize) || 108;
  const rect=el.getBoundingClientRect();
  const padX=(parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0);
  const padY=(parseFloat(cs.paddingTop)||0)+(parseFloat(cs.paddingBottom)||0);
  const boxW=Math.max(10,(rect.width || el.clientWidth)-padX-10);
  const boxH=Math.max(10,(rect.height || el.clientHeight)-padY-6);
  const text=(el.textContent||'').trim();
  const canvas=autoFitText._canvas || (autoFitText._canvas=document.createElement('canvas'));
  const ctx=canvas.getContext('2d');
  let size=maxPx;
  function measure(px){ctx.font=`${cs.fontStyle} ${cs.fontWeight} ${px}px ${cs.fontFamily}`;return ctx.measureText(text).width;}
  const measured=measure(maxPx);
  if(measured>boxW) size=Math.floor(maxPx*(boxW/measured));
  size=Math.min(size,Math.floor(boxH/0.98));
  size=Math.max(minPx,Math.min(maxPx,size));
  el.style.fontSize=size+'px';
  el.style.lineHeight='0.95';
  el.style.whiteSpace='nowrap';
  el.style.overflow='hidden';
  el.style.textOverflow='clip';
  let guard=0;
  while(size>minPx && guard<40 && (el.scrollWidth>el.clientWidth+1 || el.scrollHeight>el.clientHeight+2)){
    size-=2; el.style.fontSize=size+'px'; guard++;
  }
}
function autoFitRackTitles(root){root.querySelectorAll('.rack-title').forEach(el=>{if(!el.dataset.maxFont)el.dataset.maxFont=parseFloat(getComputedStyle(el).fontSize);autoFitText(el,24);});requestAnimationFrame(()=>root.querySelectorAll('.rack-title').forEach(el=>autoFitText(el,24)));}
// Tap the big LWH ID or Item number on screen to copy it — handy for pasting
// into an email or another system. Bound once per output container (guarded
// by a flag) since generatePalletRows re-runs against the same container
// every time labels are regenerated.
function bindCopyToClipboard(out){
  if(out._copyBound) return; out._copyBound=true;
  out.addEventListener('click',e=>{
    const t=e.target.closest('.pallet-lwh,.pallet-item-big'); if(!t) return;
    const text=(t.textContent||'').trim(); if(!text) return;
    navigator.clipboard?.writeText(text).then(()=>LWHUI.toast('Copied: '+text)).catch(()=>{});
  });
}
function safeAttr(v){return LWHUI.safe(String(v??''));}

function generateRack(){const out=document.getElementById('rackOutput');out.innerHTML='';const vals=LWHUI.lines(rackList.value);const copies=+rackCopies.value||1;vals.forEach(v=>{for(let i=0;i<copies;i++){out.append(page(`rack-label rack-${rackSpacing.value}`,`<div class="rack-title">${safeAttr(v)}</div><div class="rack-code-row"><div class="barcode-wrap"><svg data-barcode="${safeAttr(v)}" data-height="${rackBarcodeHeight.value}" data-width="${rackBarcodeWidth.value}"></svg><div class="barcode-text">${safeAttr(v)}</div></div><div class="qrbox" data-qr="${safeAttr(v)}" data-size="126"></div></div>`))}});autoFitRackTitles(out);finishBarcodes(out);LWHStorage.set('rackList',rackList.value);LWHStorage.set('printJobs',(+LWHStorage.get('printJobs',0))+out.children.length);LWHUI.toast(`Generated ${out.children.length} rack label(s)`)}
function generateBatch(start,end,pad){const m=String(start).match(/^(.*?)(\d+)$/);if(!m)return '';const prefix=m[1],num=+m[2];const width=pad||m[2].length;let count=1;const em=String(end||'').match(/^(.*?)(\d+)$/);if(em){count=(+em[2]-num)+1}else{count=+end||1} if(count<1)count=1;return Array.from({length:count},(_,i)=>prefix+String(num+i).padStart(width,'0')).join('\n')}
function generateSigns(){const out=signOutput;out.innerHTML='';LWHUI.lines(signList.value).forEach(v=>{out.append(page(`sign-page ${signOrientation.value==='portrait'?'portrait':''}`,`<div class="sign-title">${safeAttr(v)}</div><div class="sign-subtitle">${safeAttr(signSubtitle.value||'Scan location barcode')}</div><div class="sign-codes">${signShowBarcode.checked?`<div class="barcode-wrap"><svg data-barcode="${safeAttr(v)}" data-height="150" data-width="3"></svg><div class="barcode-text">${safeAttr(v)}</div></div>`:''}${signShowQR.checked?`<div class="qrbox" data-qr="${safeAttr(v)}" data-size="210"></div>`:''}</div>`))});finishBarcodes(out);LWHStorage.set('printJobs',(+LWHStorage.get('printJobs',0))+out.children.length);LWHUI.toast(`Generated ${out.children.length} sign(s)`)}

function palletDataFromSimple(){return[{location:palLocation.value,lwhid:palLwhid.value,custId:palCustId.value,customer:palCustomer.value,bay:palBay.value,item:palItem.value,lot:palLot.value,qty:palQty.value,date:palDate.value,desc:palDesc.value}]}
function splitDelimitedLine(line,delim){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const c=line[i],n=line[i+1];if(c==='"'){if(q&&n==='"'){cur+='"';i++;}else q=!q;}else if(!q&&c===delim){out.push(cur.trim());cur='';}else cur+=c;}out.push(cur.trim());return out;}
function parseTable(text){text=(text||'').replace(/^\uFEFF/,'').trim();if(!text)return[];const delim=text.indexOf('\t')>-1?'\t':',';const lines=text.split(/\r?\n/).filter(x=>x.trim()).map(l=>splitDelimitedLine(l,delim));return lines;}
function palletDataFromBulk(){
  const lines=parseTable(palletBulkText.value); if(!lines.length)return[];
  const aliases={location:['location','warehouse','loc'],lwhid:['lwhid','lwh_id','lwh id','controlnumber','control number','palletid','pallet id'],custId:['customerid','customer_id','customer id','custid','cust id','comments'],customer:['customer','subcustnm','sub customer','subcust','cust'],item:['itemnm','item','itemnumber','item number','item #','item no'],desc:['itemdesc','description','item description','desc'],lot:['lotnum','lot','lotnumber','lot number'],qty:['qty','quantity'],bay:['bayname','bay','bay location','baylocation'],date:['datereceived','date received','received','receipt date','inv date'],invRec:['invrec','inv rec','invreceipt','inv receipt'],billToRef:['billtoref','bill to ref','billtorefnum','bill to ref num'],units:['units','unit']};
  const norm=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ' ).trim();
  const compact=s=>norm(s).replace(/\s/g,'');
  const header=lines[0]||[];
  const idx={};
  header.forEach((h,i)=>{const n=norm(h),c=compact(h);Object.entries(aliases).forEach(([key,list])=>{if(idx[key]!==undefined)return; if(list.some(a=>n===norm(a)||c===compact(a)))idx[key]=i;});});
  const hasHeader=Object.keys(idx).length>=2;
  const data=hasHeader?lines.slice(1):lines;
  const fallback = (data[0] && data[0].length >= 13)
    ? {location:0,lwhid:1,custId:2,customer:3,invRec:4,billToRef:5,item:6,desc:7,lot:8,qty:9,units:10,bay:11,date:12}
    : {location:0,lwhid:1,custId:2,customer:3,item:4,desc:5,lot:6,qty:7,bay:8,date:9};
  const ix=k=>idx[k]!==undefined?idx[k]:fallback[k];
  return data.map(r=>({location:r[ix('location')]||'',lwhid:r[ix('lwhid')]||'',custId:r[ix('custId')]||'',customer:r[ix('customer')]||'',invRec:r[ix('invRec')]||'',billToRef:r[ix('billToRef')]||'',item:r[ix('item')]||'',desc:r[ix('desc')]||'',lot:r[ix('lot')]||'',qty:r[ix('qty')]||'',units:r[ix('units')]||'',bay:r[ix('bay')]||'',date:r[ix('date')]||''})).filter(r=>Object.values(r).some(Boolean));
}
function normalizePalletRow(r){return{location:r.location||r.Location||'',lwhid:r.lwhid||r.LWH_ID||r.LWHID||'',custId:r.custId||r.Customer_ID||'',customer:r.customer||r.Customer||'',invRec:r.invRec||r.InvRec||'',billToRef:r.billToRef||r.BillToRef||'',item:r.item||r.ItemNm||'',desc:r.desc||r.ItemDesc||'',lot:r.lot||r.LotNum||'',qty:r.qty||r.Qty||'',units:r.units||r.Units||'',bay:r.bay||r.BayName||'',date:r.date||r.dateReceived||r.DateReceived||'',vendor:r.vendor||r.Vendor||'',unique8:r.unique8||r.Unique8||''}}
function palletLabelHtml(r){
  r=normalizePalletRow(r);
  const code=r.lwhid||r.bay||r.item||'PALLET';
  const custQr=(r.custId||'').trim();
  return `<div class="pallet-head"><div><div class="pallet-title">${safeAttr(r.customer||'PALLET LABEL')}</div></div><div class="pallet-lwh">${safeAttr(r.lwhid||'')}</div></div>${r.custId?`<div class="pallet-custid">${safeAttr(r.custId)}</div>`:''}<div class="pallet-grid"><div><b>Location</b><br>${safeAttr(r.location)}</div><div><b>Bay</b><br>${safeAttr(r.bay)}</div><div><b>Item</b><br>${safeAttr(r.item)}</div><div><b>Lot</b><br>${safeAttr(r.lot)}</div><div><b>Qty</b><br>${safeAttr(r.qty)}</div>${r.invRec?`<div><b>InvRec</b><br>${safeAttr(r.invRec)}</div>`:''}${r.billToRef?`<div><b>BillToRef</b><br>${safeAttr(r.billToRef)}</div>`:''}${r.vendor?`<div><b>Vendor</b><br>${safeAttr(r.vendor)}</div>`:''}${r.unique8?`<div><b>${(window.LWHInventory&&LWHInventory.customerLabels)?safeAttr(LWHInventory.customerLabels().unique8):'Item Description'}</b><br>${safeAttr(r.unique8)}</div>`:''}${r.date?`<div><b>Date Received</b><br>${safeAttr(r.date)}</div>`:''}${r.desc?`<div class="wide"><b>Description</b><br>${safeAttr(r.desc)}</div>`:''}${r.item?`<div class="pallet-item-big wide">${safeAttr(r.item)}</div>`:''}</div><div class="pallet-codes">${palBarcode.checked?`<div class="barcode-wrap lwh-code"><svg data-barcode="${safeAttr(code)}" data-height="55" data-width="2.3"></svg><div class="barcode-text">LWH ${safeAttr(code)}</div></div>`:''}${custQr&&palCustQR.checked?`<div class="qr-labeled cust-id-qr"><div class="qr-heading">CUSTOMER ID</div><div class="qrbox" data-qr="${safeAttr(custQr)}" data-size="72"></div><div class="cust-qr-value">${safeAttr(custQr)}</div></div>`:''}</div>`;
}
function generatePalletRows(rows,target){
  const out=target||palletOutput; out.innerHTML='';
  const copies=+palCopies.value||1;
  (rows||[]).map(normalizePalletRow).filter(r=>Object.values(r).some(Boolean)).forEach(r=>{for(let i=0;i<copies;i++){out.append(page('pallet-label',palletLabelHtml(r)))}});
  finishBarcodes(out);
  bindCopyToClipboard(out);
  setPrintPageSize(6,4); // force landscape 6x4 so it prints as shaped, no manual dialog fix needed
  LWHStorage.set('printJobs',(+LWHStorage.get('printJobs',0))+out.children.length);
  LWHUI.toast(`Generated ${out.children.length} pallet label(s)`);
}
function generatePallet(){const rows=document.querySelector('[data-pallet-mode].active').dataset.palletMode==='bulk'?palletDataFromBulk():palletDataFromSimple();generatePalletRows(rows,palletOutput)}
function generateContact(){const out=contactOutput;out.innerHTML='';LWHUI.readFile(conLogo,logo=>{const c={name:conName.value,title:conTitle.value,company:conCompany.value,phone:conPhone.value,email:conEmail.value,website:conWebsite.value,address:conAddress.value};for(let i=0;i<(+conCopies.value||1);i++){out.append(page(`contact-card ${conLayout.value==='qronly'?'qronly':''}`,`<div class="qrbox" data-qr="${safeAttr(LWHQR.vcard(c))}" data-size="122"></div>${conLayout.value==='qronly'?'':`<div class="contact-info">${logo?`<img class="contact-logo" src="${logo}">`:''}<div class="name">${safeAttr(c.name)}</div><div>${safeAttr(c.title)}</div><div><b>${safeAttr(c.company)}</b></div><div>${safeAttr(c.phone)}</div><div>${safeAttr(c.email)}</div></div>`}`))}finishBarcodes(out);LWHStorage.set('printJobs',(+LWHStorage.get('printJobs',0))+out.children.length);LWHUI.toast(`Generated ${out.children.length} contact card(s)`)})}
window.LWHLabels={generateRack,generateSigns,generatePallet,generatePalletRows,palletLabelHtml,generateContact,generateBatch,palletDataFromBulk,setPrintPageSize};
