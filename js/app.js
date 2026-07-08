let deferredInstallPrompt=null;
// Small helpers so the header/nav/hover colors always follow whatever brand
// color is picked in Settings, instead of a second color being hardcoded.
function hexToRgb(hex){hex=String(hex||'').trim().replace('#',''); if(hex.length===3)hex=hex.split('').map(c=>c+c).join(''); const n=parseInt(hex,16)||0; return {r:(n>>16)&255,g:(n>>8)&255,b:n&255};}
function rgbToHex(r,g,b){return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');}
function shadeColor(hex,percent){const {r,g,b}=hexToRgb(hex); const t=percent<0?0:255; const p=Math.abs(percent); return rgbToHex(r+(t-r)*p,g+(t-g)*p,b+(t-b)*p);}
function applySettings(){
  const company=LWHStorage.get('companyName','Logistics Warehouse'); document.getElementById('companyTitle').textContent=company+' Toolkit'; setCompany.value=company;
  const color=LWHStorage.get('primaryColor','#0f4a45');
  document.documentElement.style.setProperty('--brand',color);
  document.documentElement.style.setProperty('--brand-dark',shadeColor(color,-0.28));
  document.documentElement.style.setProperty('--brand-tint',shadeColor(color,0.88));
  setColor.value=color;
  const logo=LWHStorage.get('companyLogo',''); if(logo){brandLogoBox.hidden=false; brandLogoBox.style.backgroundImage=`url(${logo})`;} else {brandLogoBox.hidden=true;}
  let invUrl=LWHStorage.get('inventoryUrl',''); if(invUrl.includes('1cMa6qXIJGsnCm5hOQmNUBtxZzFPU5lZIwaYqZzrLPR4')){invUrl=LWHInventory.DEFAULT_URL; LWHStorage.set('inventoryUrl',invUrl);} setInventoryUrl.value=invUrl||LWHInventory.DEFAULT_URL; if(window.invCurrentUrl) invCurrentUrl.textContent=setInventoryUrl.value;
  if(window.setCustomerLookupUrl){ const custUrl=LWHStorage.get('customerLookupUrl','')||LWHInventory.CUSTOMER_DEFAULT_URL; setCustomerLookupUrl.value=custUrl; if(window.custCurrentUrl) custCurrentUrl.textContent=custUrl; }
  if(window.LWHInventory && LWHInventory.loadCustomerLabelsToSettings) LWHInventory.loadCustomerLabelsToSettings();
  calX.value=LWHStorage.get('calX',0); calY.value=LWHStorage.get('calY',0); calScale.value=LWHStorage.get('calScale',100);
  statPrints.textContent=LWHStorage.get('printJobs',0); statLookups.textContent=LWHStorage.get('lookupCount',0); statVisitors.textContent=(LWHStorage.get('visitorLog',[])||[]).length;
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;installBtn.hidden=false});
window.addEventListener('load',()=>{
  applySettings();
  LWHInventory.loadCached();
  // Auto-load both CSV sources so the team never has to remember to hit
  // Load / Refresh Data before searching. These are independent try/catch
  // blocks so a failure in one source (e.g. Receiving) doesn't stop the
  // other (Master Lookup) from loading.
  setTimeout(async()=>{
    try{
      await LWHInventory.loadCustomerFromUrl();
    }catch(e){
      if(window.custLookupStatus) custLookupStatus.textContent='Master Lookup auto-load failed: '+e.message+' — open Settings to check the source, or use Load / Refresh Data.';
      console.error(e);
    }
  },300);
  setTimeout(async()=>{
    try{
      await LWHInventory.loadFromUrl();
    }catch(e){
      if(window.invStatus) invStatus.textContent='Receiving auto-load failed: '+e.message+' — open Settings to check the source, or use Load / Refresh Data.';
      console.error(e);
    }
  },300);
  if('serviceWorker' in navigator){navigator.serviceWorker.register('./service-worker.js').then(()=>pwaStatus.textContent='Service worker registered. App is installable from HTTPS/GitHub Pages.').catch(err=>pwaStatus.textContent='Service worker error: '+err.message)}else{pwaStatus.textContent='Service workers not supported in this browser.'}
});
document.addEventListener('click',e=>{const v=e.target.closest('[data-view]'); if(v){LWHUI.show(v.dataset.view); return}});
installBtn.onclick=async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;installBtn.hidden=true};
rackGenerate.onclick=()=>{LWHLabels.generateRack();applySettings()}; rackClear.onclick=()=>{rackList.value='';rackOutput.innerHTML=''}; rackBatchBtn.onclick=()=>{rackList.value=LWHLabels.generateBatch(rackBatchStart.value,rackBatchEnd.value,+rackBatchPad.value)};
signGenerate.onclick=()=>{LWHLabels.generateSigns();applySettings()}; signClear.onclick=()=>{signList.value='';signOutput.innerHTML=''};
document.querySelectorAll('[data-pallet-mode]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-pallet-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');palletSimple.hidden=b.dataset.palletMode!=='simple';palletBulk.hidden=b.dataset.palletMode!=='bulk'});
palGenerate.onclick=()=>{LWHLabels.generatePallet();applySettings()}; palSample.onclick=()=>{if(window.palLocation) palLocation.value='WHSE10';palLwhid.value='4098207';palCustId.value='1512A12518300020';palCustomer.value='ANCHE';palBay.value='A14';palItem.value='869468';palLot.value='07-02-25';palQty.value='1736';palDesc.value='16 6 OZ PINT WM'};
conGenerate.onclick=()=>{LWHLabels.generateContact();applySettings()}; conSample.onclick=()=>{conName.value='Tim Jennings';conTitle.value='Operations';conCompany.value='Logistics Warehouse';conPhone.value='';conEmail.value='tjennings@logistics-warehouse.com';conWebsite.value='';conAddress.value=''};
visGenerate.onclick=()=>{LWHVisitors.generateVisitor();setTimeout(applySettings,100)}; visLogBtn.onclick=LWHVisitors.showVisitorLog;
if(window.invScanBtn){invScanBtn.onclick=()=>LWHScanner.start(value=>{invSearch.value=value; invSearchBtn.click();});}
if(window.custScanBtn){custScanBtn.onclick=()=>LWHScanner.start(value=>{custSearch.value=value; custSearchBtn.click();});}
invSearchBtn.onclick=()=>{const res=LWHInventory.search(invSearch.value); LWHInventory.render(res); LWHStorage.set('lookupCount',(+LWHStorage.get('lookupCount',0))+1); applySettings();};
invSearch.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();invSearchBtn.click();}};
if(window.custSearchBtn){custSearchBtn.onclick=()=>{const res=LWHInventory.customerSearch(custSearch.value); LWHInventory.renderCustomerResults(res); LWHStorage.set('lookupCount',(+LWHStorage.get('lookupCount',0))+1); applySettings();};}
if(window.custSearch){custSearch.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();custSearchBtn.click();}};}
invLoadBtn.onclick=async()=>{try{await LWHInventory.loadFromUrl();LWHUI.toast('Inventory loaded')}catch(e){invStatus.textContent='Inventory load failed: '+e.message; console.error(e);}};
invPasteBtn.onclick=()=>{const rows=LWHInventory.parseDelimited(invPaste.value);LWHStorage.set('inventoryRows',rows);LWHInventory.loadCached();LWHUI.toast(`Loaded ${rows.length} pasted row(s)`)};
if(window.custLoadBtn){custLoadBtn.onclick=async()=>{try{await LWHInventory.loadCustomerFromUrl();LWHUI.toast('Customer lookup loaded')}catch(e){custLookupStatus.textContent='Customer lookup load failed: '+e.message; console.error(e);}};}
if(window.custPasteBtn){custPasteBtn.onclick=()=>{const rows=LWHInventory.parseCustomerDelimited(custPaste.value);LWHStorage.set('customerLookupRows',rows);LWHInventory.loadCached();LWHUI.toast(`Loaded ${rows.length} pasted customer row(s)`)};}
if(window.recLoadBtn){recLoadBtn.onclick=invLoadBtn.onclick;}
if(window.recFindBtn){recFindBtn.onclick=()=>LWHInventory.findReceiving();}
if(window.recInvRec){recInvRec.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();recFindBtn.click();}};}
if(window.recPrintBtn){recPrintBtn.onclick=()=>{const list=LWHInventory.findReceiving(); if(list && list.length) LWHInventory.printRows(list,receivingPrintOutput);};}
if(window.recPasteBtn){recPasteBtn.onclick=()=>{const rows=LWHInventory.parseDelimited(recPaste.value);LWHStorage.set('inventoryRows',rows);LWHInventory.loadCached();LWHUI.toast(`Loaded ${rows.length} receiving row(s)`);};}
saveBrand.onclick=()=>{LWHStorage.set('companyName',setCompany.value||'Logistics Warehouse');LWHStorage.set('primaryColor',setColor.value||'#0f4a45');LWHUI.readFile(setLogo,logo=>{if(logo)LWHStorage.set('companyLogo',logo);applySettings();LWHUI.toast('Branding saved')})};
clearLogo.onclick=()=>{LWHStorage.set('companyLogo','');applySettings();LWHUI.toast('Logo cleared')};
saveCalibration.onclick=()=>{LWHStorage.set('calX',calX.value||0);LWHStorage.set('calY',calY.value||0);LWHStorage.set('calScale',calScale.value||100);LWHUI.toast('Calibration saved')};
saveInventoryUrl.onclick=()=>{const url=LWHInventory.normalizeUrl(setInventoryUrl.value||LWHInventory.DEFAULT_URL,LWHInventory.DEFAULT_URL); LWHStorage.set('inventoryUrl',url); setInventoryUrl.value=url; if(window.invCurrentUrl) invCurrentUrl.textContent=url; LWHUI.toast('Inventory source saved')};
testInventoryUrl.onclick=async()=>{try{await LWHInventory.loadFromUrl();LWHUI.toast('Inventory source works')}catch(e){invStatus.textContent='Inventory test failed: '+e.message; LWHUI.toast('Inventory load failed')}}; if(window.resetInventoryUrl){resetInventoryUrl.onclick=()=>{LWHInventory.resetSource(); LWHUI.toast('Inventory source reset')}};
if(window.saveCustomerLookupUrl){saveCustomerLookupUrl.onclick=()=>{const url=LWHInventory.normalizeUrl(setCustomerLookupUrl.value||LWHInventory.CUSTOMER_DEFAULT_URL,LWHInventory.CUSTOMER_DEFAULT_URL); LWHStorage.set('customerLookupUrl',url); setCustomerLookupUrl.value=url; if(window.custCurrentUrl) custCurrentUrl.textContent=url; LWHUI.toast('Customer source saved')};}
if(window.testCustomerLookupUrl){testCustomerLookupUrl.onclick=async()=>{try{await LWHInventory.loadCustomerFromUrl();LWHUI.toast('Customer source works')}catch(e){custLookupStatus.textContent='Customer source test failed: '+e.message; LWHUI.toast('Customer load failed')}};}
if(window.resetCustomerLookupUrl){resetCustomerLookupUrl.onclick=()=>{LWHInventory.resetCustomerSource(); LWHUI.toast('Customer source reset')}};
if(window.saveCustomerFieldLabels){saveCustomerFieldLabels.onclick=()=>{LWHInventory.saveCustomerLabelsFromSettings();};}
calRack.onclick=()=>{rackList.value='TEST-4X6';LWHUI.show('rack');LWHLabels.generateRack();setTimeout(()=>print(),250)};
calLetter.onclick=()=>{signList.value='TEST SIGN';LWHUI.show('signs');LWHLabels.generateSigns();setTimeout(()=>print(),250)};
clearStorage.onclick=()=>{if(confirm('Clear saved settings and cached data?')){LWHStorage.clear();applySettings();LWHUI.toast('Saved settings cleared')}};
rackList.value=LWHStorage.get('rackList','');
