// Ship Weights — ported from the standalone Customer Shipment Weights PWA
// (nbr1hawgfan/Customer_Shipment_Weights) so everyone works out of one app.
// Same constants, same math — pulled straight from the source workbook
// (TCI_and_SB_Weight_Calculations.xlsx) that the standalone tool used.
const SW_TCI_FACTOR = { BX25: 1.08, BX55: 1.055, D250: 1.065 };
const SW_PALLET_WEIGHT = 45;
const SW_SB_REEL_WEIGHT = { '36': 102, '48': 275, '54': 354 };
const SW_SB_LABEL = { '36': '36" Reels', '48': '48" Reels', '54': '54" Reels' };
// Fixed freight classification line — printed on every Ship Weights label,
// regardless of product or customer, per Tim's request.
const SW_NMFC_LINE = 'NMFC 150005 · Class 60';

function swNum(id){
  const el = document.getElementById(id);
  const v = parseFloat(el && el.value);
  return isNaN(v) ? 0 : v;
}
function swFmt(n){
  return n.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}

function calcTCI(){
  let shipNet = 0, shipPallets = 0, shipGross = 0;
  const lines = [];
  ['BX25','BX55','D250'].forEach(p => {
    const net = swNum(`sw${p}Net`);
    const pallets = swNum(`sw${p}Pallets`);
    const gross = net * SW_TCI_FACTOR[p];
    const palletWt = pallets * SW_PALLET_WEIGHT;
    const total = gross + palletWt;

    document.getElementById(`sw${p}Gross`).textContent = swFmt(gross);
    document.getElementById(`sw${p}PalletWt`).textContent = swFmt(palletWt);
    document.getElementById(`sw${p}Total`).textContent = swFmt(total);

    if(net > 0 || pallets > 0){
      shipNet += net;
      shipPallets += pallets;
      shipGross += total;
      lines.push(`${p}: ${swFmt(net)} lb net, ${pallets} pallet${pallets===1?'':'s'}, ${swFmt(total)} lb gross`);
    }
  });

  document.getElementById('swTciShipNet').textContent = swFmt(shipNet) + ' lb';
  document.getElementById('swTciShipPallets').textContent = shipPallets;
  document.getElementById('swTciShipGross').textContent = swFmt(shipGross) + ' lb';
  document.getElementById('swTciShipList').textContent = lines.length ? lines.join(' · ') : 'No items entered yet.';
}

function calcSB(){
  let shipCount = 0, shipGross = 0;
  const lines = [];
  ['36','48','54'].forEach(s => {
    const count = swNum(`swSb${s}Count`);
    const total = count * SW_SB_REEL_WEIGHT[s];
    document.getElementById(`swSb${s}Total`).textContent = swFmt(total);
    if(count > 0){
      shipCount += count;
      shipGross += total;
      lines.push(`${SW_SB_LABEL[s]}: ${count} @ ${SW_SB_REEL_WEIGHT[s]} lb = ${swFmt(total)} lb`);
    }
  });
  document.getElementById('swSbShipCount').textContent = shipCount;
  document.getElementById('swSbShipGross').textContent = swFmt(shipGross) + ' lb';
  document.getElementById('swSbShipList').textContent = lines.length ? lines.join(' · ') : 'No items entered yet.';
}

function clearShipwt(){
  ['BX25','BX55','D250'].forEach(p => {
    document.getElementById(`sw${p}Net`).value = '';
    document.getElementById(`sw${p}Pallets`).value = '';
  });
  ['36','48','54'].forEach(s => {
    document.getElementById(`swSb${s}Count`).value = '';
  });
  calcTCI();
  calcSB();
}

function swDateStamp(){
  const d = new Date();
  return d.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
}

function printShipWeightLabel(){
  const mode = document.querySelector('[data-shipwt-mode].active').dataset.shipwtMode;
  const target = document.getElementById('shipwtOutput');
  let rows = '', totalLine = '', subLine = '';

  if(mode === 'tci'){
    ['BX25','BX55','D250'].forEach(p => {
      const net = swNum(`sw${p}Net`);
      const pallets = swNum(`sw${p}Pallets`);
      if(net <= 0 && pallets <= 0) return;
      const gross = net * SW_TCI_FACTOR[p];
      const total = gross + pallets * SW_PALLET_WEIGHT;
      rows += `<tr><td>${p}</td><td>${swFmt(net)}</td><td>${pallets}</td><td>${swFmt(total)}</td></tr>`;
    });
    if(!rows){ LWHUI.toast('Enter at least one weight before printing.'); return; }
    rows = `<table><thead><tr><th>Item</th><th>Net (lb)</th><th>Plts</th><th>Gross (lb)</th></tr></thead><tbody>${rows}</tbody></table>`;
    totalLine = document.getElementById('swTciShipGross').textContent;
    subLine = 'Total Pallets: ' + document.getElementById('swTciShipPallets').textContent;
  } else {
    ['36','48','54'].forEach(s => {
      const count = swNum(`swSb${s}Count`);
      if(count <= 0) return;
      const total = count * SW_SB_REEL_WEIGHT[s];
      rows += `<tr><td>${SW_SB_LABEL[s]}</td><td>${SW_SB_REEL_WEIGHT[s]}</td><td>${count}</td><td>${swFmt(total)}</td></tr>`;
    });
    if(!rows){ LWHUI.toast('Enter at least one reel count before printing.'); return; }
    rows = `<table><thead><tr><th>Size</th><th>Wt/Reel</th><th>Qty</th><th>Total (lb)</th></tr></thead><tbody>${rows}</tbody></table>`;
    totalLine = document.getElementById('swSbShipGross').textContent;
    subLine = 'Total Reels: ' + document.getElementById('swSbShipCount').textContent;
  }

  target.innerHTML = `<div class="label-page shipwt-label">
      <div class="swl-header">
        <div class="swl-co">Logistics Warehouse, Inc.</div>
        <div class="swl-meta">${swDateStamp()}</div>
      </div>
      ${rows}
      <div class="swl-total">
        <div class="swl-tlabel">Total Gross Weight</div>
        <div class="swl-tval">${totalLine}</div>
        <div class="swl-tsub">${subLine}</div>
      </div>
      <div class="swl-freight">${SW_NMFC_LINE}</div>
      <div class="swl-footer">Shipment Weight Label — Generated for shipping documents</div>
    </div>`;
  LWHLabels.setPrintPageSize(4,6); // portrait 4x6, matches the standalone tool's label size
  LWHStorage.set('printJobs',(+LWHStorage.get('printJobs',0))+1);
  window.print();
}

window.LWHShipWeights = { calcTCI, calcSB, clearShipwt, printShipWeightLabel };
