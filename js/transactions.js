(function(){
  const TRANSACTIONS_URL='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/transaction-history-csv';
  let transactionRows=[];
  let lastResults=[];
  let loaded=false;

  function el(id){ return document.getElementById(id); }
  function txnStatus(msg){ const s=el('txnStatus'); if(s) s.textContent=msg; }
  function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

  function formatSyncedAt(iso){
    if(!iso) return null;
    const d=new Date(iso.includes('T')?iso:iso.replace(' ','T'));
    if(isNaN(d)) return null;
    return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  }

  // Small self-contained CSV parser (quote-aware), matching the shape of
  // our own edge-function output — doesn't need to handle tab-delimited
  // paste or Google Sheets quirks like Master Lookup's parser does.
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
        lwhId:obj.LWH_ID||'', customerId:obj.Customer_ID||'', madeFrom:obj.MadeFrom||'',
        transactionType:obj.TransactionType||'', unique2:obj.Unique2||'', invReceipt:obj.INV_Receipt||'',
        billToRef:obj.BillToRef||'', subCustNm:obj.SubCustNm||'', itemNm:obj.ItemNm||'',
        itemDesc:obj.ItemDesc||'', lotNum:obj.LotNum||'', qty:obj.Qty||'',
        transactionDate:obj.TransactionDate||'', location:obj.Location||'', syncedAt:obj.SyncedAt||''
      };
    });
  }

  async function loadTransactions(force){
    if(loaded && !force){ return transactionRows; }
    txnStatus('Loading transaction history…');
    try{
      const bust=(TRANSACTIONS_URL.includes('?')?'&':'?')+'_='+Date.now();
      const res=await fetch(TRANSACTIONS_URL+bust,{cache:'no-store',mode:'cors'});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const text=await res.text();
      transactionRows=parseCsv(text);
      loaded=true;
      const synced=formatSyncedAt(transactionRows[0]?.syncedAt);
      txnStatus(`Loaded ${transactionRows.length} transaction(s).`+(synced?` Data as of ${synced}.`:''));
    }catch(e){
      txnStatus('Load failed: '+e.message+' — try Load / Refresh, or check your connection.');
      console.error(e);
    }
    return transactionRows;
  }

  const fieldOrder=['transactionDate','transactionType','lwhId','itemNm','itemDesc','qty','billToRef','subCustNm','customerId','lotNum','location','invReceipt','madeFrom','unique2'];
  const labels={transactionDate:'Date',transactionType:'Type',lwhId:'LWH ID',itemNm:'Item #',itemDesc:'Item Description',qty:'Qty',billToRef:'Bill-to-Ref',subCustNm:'Customer',customerId:'Customer ID',lotNum:'Lot #',location:'Location',invReceipt:'INV Receipt',madeFrom:'Made From',unique2:'Unique2'};

  function hasValue(v){ return v!==null && v!==undefined && String(v).trim()!==''; }

  function transactionSearch(q){
    q=String(q||'').toLowerCase().trim();
    if(!q) return [];
    const terms=q.split(/\s+/);
    const matched=transactionRows.filter(r=>{
      const hay=[r.billToRef,r.itemNm,r.lwhId,r.subCustNm,r.lotNum,r.invReceipt,r.madeFrom,r.itemDesc,r.customerId].join(' ').toLowerCase();
      return terms.every(t=>hay.includes(t));
    });
    // Most recent first — makes "last N times this moved" a plain read top-to-bottom.
    matched.sort((a,b)=> (b.transactionDate||'').localeCompare(a.transactionDate||''));
    return matched.slice(0,1000);
  }

  function renderTransactionResults(list, totalMatches){
    lastResults=list;
    const out=el('transactionResults'); if(!out) return;
    out.innerHTML='';
    if(!list.length){ out.innerHTML='<div class="card">No transaction history found.</div>'; return; }

    const inbound=list.filter(r=>r.transactionType==='Inbound').length;
    const outbound=list.length-inbound;
    const totalQty=list.reduce((sum,r)=>sum+(parseFloat(r.qty)||0),0);

    const top=document.createElement('div'); top.className='card';
    top.innerHTML=`<b>${totalMatches}</b> matching transaction(s)`+
      (totalMatches>list.length?` (showing first ${list.length})`:'')+
      `<div class="hint">${inbound} Inbound · ${outbound} Outbound · ${totalQty.toLocaleString()} total Qty</div>`;
    out.append(top);

    const wrap=document.createElement('div'); wrap.className='result-list customer-results';
    list.forEach(r=>{
      const c=document.createElement('div'); c.className='result-card customer-card';
      const grid=fieldOrder.map(k=>hasValue(r[k])?`<div class="cust-field"><b>${safe(labels[k])}</b><span>${safe(r[k])}</span></div>`:'').join('');
      const typeBadge=`<span class="warehouse-badge" style="background:${r.transactionType==='Inbound'?'#0f4a45':'#7d1935'}">${safe(r.transactionType)}</span>`;
      c.innerHTML=`<div>${typeBadge} <b>${safe(r.transactionDate)}</b> · LWH ${safe(r.lwhId)}</div>`+
        `<div>${safe(r.itemNm)} — ${safe(r.itemDesc)} · Qty ${safe(r.qty)}</div>`+
        `<div>Bill-to-Ref <b>${safe(r.billToRef||'—')}</b> · ${safe(r.subCustNm||'—')}</div>`+
        `<details><summary>All fields</summary><div class="cust-grid">${grid}</div></details>`;
      wrap.append(c);
    });
    out.append(wrap);
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
    a.href=url; a.download=`transaction-history-${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    LWHUI.toast(`Exported ${lastResults.length} row(s) to CSV`);
  }

  function renderPrintTable(){
    const out=el('txnPrintTable'); if(!out) return;
    if(!lastResults.length){ out.innerHTML=''; LWHUI.toast('No results to print — run a search first'); return; }
    const header=fieldOrder.map(k=>`<th>${safe(labels[k])}</th>`).join('');
    const rows=lastResults.map(r=>`<tr>${fieldOrder.map(k=>`<td>${safe(r[k])}</td>`).join('')}</tr>`).join('');
    out.innerHTML=`
      <h2>Transaction History — ${lastResults.length} result(s)</h2>
      <table class="txn-print-table">
        <thead><tr>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    setTimeout(()=>print(),100);
  }

  function getAllTransactions(){ return transactionRows; }

  function clearTransactionResults(){
    lastResults=[];
    const out=el('transactionResults'); if(out) out.innerHTML='';
    const printOut=el('txnPrintTable'); if(printOut) printOut.innerHTML='';
  }

  window.LWHTransactions={loadTransactions,transactionSearch,renderTransactionResults,clearTransactionResults,getAllTransactions,exportCsv,renderPrintTable};
})();
