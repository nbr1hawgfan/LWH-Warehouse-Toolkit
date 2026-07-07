let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;installBtn.hidden=false});
window.addEventListener('load',()=>{
  if('serviceWorker' in navigator){navigator.serviceWorker.register('./service-worker.js').then(()=>pwaStatus.textContent='Service worker registered. App should be installable from HTTPS/GitHub Pages.').catch(err=>pwaStatus.textContent='Service worker error: '+err.message)}else{pwaStatus.textContent='Service workers not supported in this browser.'}
});
document.addEventListener('click',e=>{
  const v=e.target.closest('[data-view]'); if(v){LWHUI.show(v.dataset.view); return}
});
installBtn.onclick=async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;installBtn.hidden=true};
rackGenerate.onclick=LWHLabels.generateRack; rackClear.onclick=()=>{rackList.value='';rackOutput.innerHTML=''}; rackBatchBtn.onclick=()=>{rackList.value=LWHLabels.generateBatch(rackBatchStart.value,rackBatchCount.value,+rackBatchPad.value)};
signGenerate.onclick=LWHLabels.generateSigns; signClear.onclick=()=>{signList.value='';signOutput.innerHTML=''};
document.querySelectorAll('[data-pallet-mode]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-pallet-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');palletSimple.hidden=b.dataset.palletMode!=='simple';palletBulk.hidden=b.dataset.palletMode!=='bulk'});
palGenerate.onclick=LWHLabels.generatePallet; palSample.onclick=()=>{palLwhid.value='1003140';palCustId.value='514FS6963';palCustomer.value='NISSAN';palBay.value='MR201';palItem.value='177977200';palLot.value='00-00-00';palQty.value='200';palDesc.value='Sample pallet label'};
conGenerate.onclick=LWHLabels.generateContact; conSample.onclick=()=>{conName.value='Tim Jennings';conTitle.value='Operations';conCompany.value='Logistics Warehouse';conPhone.value='';conEmail.value='tjennings@logistics-warehouse.com';conWebsite.value='';conAddress.value=''};
visGenerate.onclick=LWHVisitors.generateVisitor; visLogBtn.onclick=LWHVisitors.showVisitorLog;
calRack.onclick=()=>{rackList.value='TEST-4X6';LWHUI.show('rack');LWHLabels.generateRack();setTimeout(()=>print(),250)};
calLetter.onclick=()=>{signList.value='TEST SIGN';LWHUI.show('signs');LWHLabels.generateSigns();setTimeout(()=>print(),250)};
clearStorage.onclick=()=>{LWHStorage.clear();LWHUI.toast('Saved settings cleared')};
rackList.value=LWHStorage.get('rackList','');
