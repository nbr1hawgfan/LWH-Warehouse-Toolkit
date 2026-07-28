(function(){
  const LOAD_DETAILS_URL='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/load-details-csv';
  let loadRows=[];
  let lastResults=[];
  let loaded=false;

  function el(id){ return document.getElementById(id); }
  function ldStatus(msg){ const s=el('ldStatus'); if(s) s.textContent=msg; }
  function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

  function formatSyncedAt(iso){
    if(!iso) return null;
    const d=new Date(iso.includes('T')?iso:iso.replace(' ','T'));
    if(isNaN(d)) return null;
    return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  }

  // Same quote-aware CSV parser as transactions.js — matches our own
  // edge-function output shape.
  function parseCsv(text){
    text=(text||'').replace(/^\uFEFF/,'').trim(); if(!text) return [];
    const lines=[]; let cur='', row=[], q=false;
    for(let i=0;i<text.length;i++){
      const c=text[i],n=text[i+1];
      if(c==='"'){ if(q&&n==='"'){cur+='"';i++;} else q=!q; }
      else if(!q && c===','){ row.push(cur);cur=''; }
      else if(!q && (c==='\n'||c==='\r')){
        if(c==='\r'&&n==='\n')i++;
        row.push(cur); if(row.some(x=>String(x).trim())) lines.push(row); row=[]; cur='';
      } else cur+=c;
    }
    row.push(cur); if(row.some(x=>String(x).trim())) lines.push(row);
    if(!lines.length) return [];
    const head=lines.shift();
    return lines.map(r=>{
      const obj={};
      head.forEach((h,i)=>{ obj[h.trim()]=r[i]!==undefined?r[i]:''; });
      return {
        proNumber:obj.ProNumber||'', relatedPro:obj.RelatedPro||'', loadDate:obj.LoadDate||'',
        warehouse:obj.Warehouse||'', direction:obj.Direction||'', businessPartner:obj.BusinessPartner||'',
        billToName:obj.BillToName||'', billToReference:obj.BillToReference||'', subCustNm:obj.SubCustNm||'',
        itemNm:obj.ItemNm||'', itemDesc:obj.ItemDesc||'', lotNum:obj.LotNum||'',
        totalPallets:obj.TotalPallets||'', totalQty:obj.TotalQty||'',
        carrier:obj.Carrier||'', trailer:obj.Trailer||'', seal:obj.Seal||'',
        shipper:obj.Shipper||'', consignee:obj.Consignee||'', loadStatus:obj.LoadStatus||'',
        syncedAt:obj.SyncedAt||''
      };
    });
  }

  async function loadLoadDetails(force){
    if(loaded && !force){ return loadRows; }
    ldStatus('Loading load details…');
    try{
      const bust=(LOAD_DETAILS_URL.includes('?')?'&':'?')+'_='+Date.now();
      const res=await fetch(LOAD_DETAILS_URL+bust,{cache:'no-store',mode:'cors'});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const text=await res.text();
      loadRows=parseCsv(text);
      loaded=true;
      const synced=formatSyncedAt(loadRows[0]?.syncedAt);
      ldStatus(`Loaded ${loadRows.length} load item row(s).`+(synced?` Data as of ${synced}.`:''));
    }catch(e){
      ldStatus('Load failed: '+e.message+' — try Load / Refresh, or check your connection.');
      console.error(e);
    }
    return loadRows;
  }

  const fieldOrder=['loadDate','proNumber','direction','carrier','trailer','seal','billToReference','billToName','subCustNm','itemNm','itemDesc','lotNum','totalPallets','totalQty','warehouse','shipper','consignee','loadStatus','businessPartner','relatedPro'];
  const labels={loadDate:'Load Date',proNumber:'Pro #',direction:'Direction',carrier:'Carrier',trailer:'Trailer',seal:'Seal',billToReference:'Bill-to-Ref',billToName:'Bill-To Name',subCustNm:'Customer',itemNm:'Item #',itemDesc:'Item Description',lotNum:'Lot #',totalPallets:'Pallets',totalQty:'Qty',warehouse:'Warehouse',shipper:'Shipper',consignee:'Consignee',loadStatus:'Status',businessPartner:'Business Partner',relatedPro:'Related Pro #'};

  function loadDetailsSearch(q){
    q=(q||'').trim().toLowerCase();
    if(!q) return [];
    return loadRows.filter(r=>
      r.proNumber.toLowerCase().includes(q) ||
      r.carrier.toLowerCase().includes(q) ||
      r.trailer.toLowerCase().includes(q) ||
      r.seal.toLowerCase().includes(q) ||
      r.billToReference.toLowerCase().includes(q) ||
      r.billToName.toLowerCase().includes(q) ||
      r.subCustNm.toLowerCase().includes(q) ||
      r.itemNm.toLowerCase().includes(q) ||
      r.itemDesc.toLowerCase().includes(q)
    ).slice(0,300);
  }

  function groupByLoad(rows){
    const byLoad={};
    rows.forEach(r=>{
      if(!byLoad[r.proNumber]) byLoad[r.proNumber]={header:r, items:[], pallets:0, qty:0};
      const g=byLoad[r.proNumber];
      g.items.push(r);
      g.pallets+=parseFloat(r.totalPallets)||0;
      g.qty+=parseFloat(r.totalQty)||0;
    });
    return Object.values(byLoad).sort((a,b)=> (b.header.loadDate||'').localeCompare(a.header.loadDate||''));
  }

  function renderResults(rows, totalMatches){
    lastResults=rows;
    const out=el('loadDetailsResults'); if(!out) return;
    out.innerHTML='';
    if(!rows.length){ out.innerHTML='<div class="card">No matching loads found.</div>'; return; }

    const loads=groupByLoad(rows);
    const top=document.createElement('div'); top.className='card';
    top.innerHTML=`<b>${totalMatches}</b> matching item row(s) across <b>${loads.length}</b> load(s)`+
      (totalMatches>rows.length?` (showing first ${rows.length})`:'');
    out.append(top);

    loads.forEach(g=>{
      const h=g.header;
      const card=document.createElement('div'); card.className='card'; card.style.marginTop='10px';
      const dirColor=h.direction==='Inbound'?'#0f4a45':'#7d1935';
      const itemRows=g.items.map(it=>`<tr><td>${safe(it.subCustNm)}</td><td>${safe(it.itemNm)}</td><td>${safe(it.itemDesc)}</td><td>${safe(it.lotNum)}</td><td>${it.totalPallets}</td><td>${it.totalQty}</td></tr>`).join('');
      card.innerHTML=`
        <div><span class="warehouse-badge" style="background:${dirColor}">${safe(h.direction)}</span> <b>Pro ${safe(h.proNumber)}</b> · ${safe(h.loadDate)} · ${safe(h.loadStatus)}</div>
        <div class="hint" style="margin-top:4px">Carrier <b>${safe(h.carrier||'—')}</b> · Trailer <b>${safe(h.trailer||'—')}</b> · Seal <b>${safe(h.seal||'—')}</b></div>
        <div class="hint">Bill-to-Ref <b>${safe(h.billToReference||'—')}</b> · Bill-To ${safe(h.billToName||'—')}</div>
        <div class="hint">Shipper ${safe(h.shipper||'—')} → Consignee ${safe(h.consignee||'—')}</div>
        <div style="margin-top:8px;overflow-x:auto"><table class="pls-table"><thead><tr><th>Customer</th><th>Item #</th><th>Description</th><th>Lot #</th><th>Pallets</th><th>Qty</th></tr></thead><tbody>${itemRows}</tbody></table></div>
        <div class="hint" style="margin-top:6px"><b>Load total:</b> ${g.pallets.toLocaleString()} pallets · ${g.qty.toLocaleString()} qty</div>
        <div class="actions" style="margin-top:8px"><button type="button" class="ghost" data-pl-generate="${safe(h.proNumber)}">Generate Packing List</button></div>
      `;
      out.append(card);
    });
  }

  function csvEscape(v){
    const s=String(v??'');
    return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  }

  function exportCsv(){
    if(!lastResults.length){ LWHUI.toast('No results to export — run a search first'); return; }
    const header=fieldOrder.map(k=>labels[k]);
    const rows=lastResults.map(r=>fieldOrder.map(k=>csvEscape(r[k])));
    const csv=[header.join(','), ...rows.map(r=>r.join(','))].join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const stamp=new Date().toISOString().slice(0,10);
    a.href=url; a.download=`load-details-${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    LWHUI.toast(`Exported ${lastResults.length} row(s) to CSV`);
  }

  function renderPrintTable(){
    const out=el('ldPrintTable'); if(!out) return;
    if(!lastResults.length){ out.innerHTML=''; LWHUI.toast('No results to print — run a search first'); return; }
    const header=fieldOrder.map(k=>`<th>${labels[k]}</th>`).join('');
    const rows=lastResults.map(r=>`<tr>${fieldOrder.map(k=>`<td>${safe(r[k])}</td>`).join('')}</tr>`).join('');
    out.innerHTML=`
      <h2>Load Details — ${lastResults.length} result(s)</h2>
      <table class="txn-print-table">
        <thead><tr>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    setTimeout(()=>print(),100);
  }

  function clearResults(){
    lastResults=[];
    const out=el('loadDetailsResults'); if(out) out.innerHTML='';
    const printOut=el('ldPrintTable'); if(printOut) printOut.innerHTML='';
  }

  function getAllLoadDetails(){ return loadRows; }

  window.LWHLoadDetails={loadLoadDetails,loadDetailsSearch,renderResults,exportCsv,renderPrintTable,clearResults,getAllLoadDetails};

  window.addEventListener('load',()=>{
    if(!el('ldSearchBtn')) return;
    async function runSearch(){
      await loadLoadDetails(false);
      const q=el('ldSearch').value;
      const matches=loadDetailsSearch(q);
      renderResults(matches, matches.length);
    }
    el('ldSearchBtn').onclick=()=>{runSearch();};
    el('ldSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();el('ldSearchBtn').click();}};
    el('ldLoadBtn').onclick=async()=>{await loadLoadDetails(true); if(el('ldSearch').value.trim()) runSearch(); LWHUI.toast('Load details refreshed');};
    el('ldClearBtn').onclick=()=>{el('ldSearch').value=''; clearResults(); el('ldSearch').focus();};
    el('ldCsvBtn').onclick=exportCsv;
    el('ldPrintBtn').onclick=renderPrintTable;
    el('loadDetailsResults').addEventListener('click',e=>{
      const btn=e.target.closest('[data-pl-generate]'); if(!btn) return;
      window.LWHPackingList.generateFor(btn.dataset.plGenerate,'ldPackingListOutput','ldPackingListPrint');
      document.getElementById('ldPackingListOutput').scrollIntoView({behavior:'smooth',block:'start'});
    });
  });
})();
