(function(){
  function el(id){ return document.getElementById(id); }
  function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  let lastPallets=[];
  let lastHeader=null;

  // Both datasets are already being fetched for their own tabs — this
  // just makes sure they're loaded before we try to join them, without
  // forcing a re-fetch if the user already visited those tabs.
  async function ensureData(){
    await Promise.all([
      window.LWHTransactions.loadTransactions(false),
      window.LWHLoadDetails.loadLoadDetails(false)
    ]);
  }

  function findLoadHeader(proNumber){
    const rows=window.LWHLoadDetails.getAllLoadDetails();
    return rows.find(r=>String(r.proNumber).trim()===String(proNumber).trim())||null;
  }

  function findPallets(proNumber){
    const rows=window.LWHTransactions.getAllTransactions();
    return rows.filter(r=>String(r.invReceipt).trim()===String(proNumber).trim())
      .sort((a,b)=>(a.transactionDate||'').localeCompare(b.transactionDate||''));
  }

  // Supports searching by Pro # (exact) or Bill-to-Ref (exact, case-insensitive).
  // Bill-to-Ref can occasionally span more than one Pro #, so this returns
  // every distinct load that matched, letting the caller decide what to do
  // with 1 vs. many.
  function findMatchingLoads(query){
    query=String(query||'').trim();
    if(!query) return [];
    const rows=window.LWHLoadDetails.getAllLoadDetails();
    const qLower=query.toLowerCase();
    const matchedPros=new Set();
    rows.forEach(r=>{
      if(String(r.proNumber).trim()===query || String(r.billToReference).trim().toLowerCase()===qLower){
        matchedPros.add(String(r.proNumber).trim());
      }
    });
    return [...matchedPros].map(pro=>findLoadHeader(pro)).filter(Boolean);
  }

  function buildPackingListHtml(header, pallets){
    const totalQty=pallets.reduce((s,p)=>s+(parseFloat(p.qty)||0),0);
    const rows=pallets.map(p=>`<tr><td>${safe(p.lwhId)}</td><td>${safe(p.subCustNm)}</td><td>${safe(p.itemNm)}</td><td>${safe(p.itemDesc)}</td><td>${safe(p.lotNum)}</td><td>${p.qty}</td><td>${safe(p.transactionDate)}</td><td>${safe(p.transactionType)}</td></tr>`).join('');
    return `
      <h1 style="font-size:20px;margin-bottom:4px">Packing List — Pro ${safe(header.proNumber)}</h1>
      <p style="font-size:13px;color:#555;margin-top:0">${safe(header.loadDate)} · ${safe(header.direction)} · ${safe(header.loadStatus)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">
        <tr><td style="padding:4px 8px;border:1px solid #ccc"><b>Carrier</b></td><td style="padding:4px 8px;border:1px solid #ccc">${safe(header.carrier||'—')}</td>
            <td style="padding:4px 8px;border:1px solid #ccc"><b>Trailer</b></td><td style="padding:4px 8px;border:1px solid #ccc">${safe(header.trailer||'—')}</td>
            <td style="padding:4px 8px;border:1px solid #ccc"><b>Seal</b></td><td style="padding:4px 8px;border:1px solid #ccc">${safe(header.seal||'—')}</td></tr>
        <tr><td style="padding:4px 8px;border:1px solid #ccc"><b>Bill-to-Ref</b></td><td style="padding:4px 8px;border:1px solid #ccc">${safe(header.billToReference||'—')}</td>
            <td style="padding:4px 8px;border:1px solid #ccc"><b>Bill-To Name</b></td><td style="padding:4px 8px;border:1px solid #ccc" colspan="3">${safe(header.billToName||'—')}</td></tr>
        <tr><td style="padding:4px 8px;border:1px solid #ccc"><b>Shipper</b></td><td style="padding:4px 8px;border:1px solid #ccc">${safe(header.shipper||'—')}</td>
            <td style="padding:4px 8px;border:1px solid #ccc"><b>Consignee</b></td><td style="padding:4px 8px;border:1px solid #ccc" colspan="3">${safe(header.consignee||'—')}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-top:12px">
        <thead><tr>
          <th style="padding:5px 8px;border:1px solid #ccc;text-align:left">LWH ID</th>
          <th style="padding:5px 8px;border:1px solid #ccc;text-align:left">Customer</th>
          <th style="padding:5px 8px;border:1px solid #ccc;text-align:left">Item #</th>
          <th style="padding:5px 8px;border:1px solid #ccc;text-align:left">Description</th>
          <th style="padding:5px 8px;border:1px solid #ccc;text-align:left">Lot #</th>
          <th style="padding:5px 8px;border:1px solid #ccc;text-align:right">Qty</th>
          <th style="padding:5px 8px;border:1px solid #ccc;text-align:left">Date</th>
          <th style="padding:5px 8px;border:1px solid #ccc;text-align:left">Type</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="5" style="padding:5px 8px;border:1px solid #ccc"><b>${pallets.length} pallet(s)</b></td><td style="padding:5px 8px;border:1px solid #ccc;text-align:right"><b>${totalQty.toLocaleString()}</b></td><td colspan="2" style="padding:5px 8px;border:1px solid #ccc"></td></tr></tfoot>
      </table>
      ${pallets.length===0?'<p style="font-size:13px;color:#b91c1c;margin-top:10px">No pallet-level detail found for this load — it may be older than the 90-day Transaction History window, or predates load tracking.</p>':''}
    `;
  }

  function csvEscape(v){
    const s=String(v??'');
    return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  }

  function exportCsv(header, pallets){
    const headerLines=[
      `Packing List,Pro ${header.proNumber}`,
      `Carrier,${csvEscape(header.carrier)}`,
      `Trailer,${csvEscape(header.trailer)}`,
      `Seal,${csvEscape(header.seal)}`,
      `Bill-to-Ref,${csvEscape(header.billToReference)}`,
      `Bill-To Name,${csvEscape(header.billToName)}`,
      `Shipper,${csvEscape(header.shipper)}`,
      `Consignee,${csvEscape(header.consignee)}`,
      `Load Date,${csvEscape(header.loadDate)}`,
      ''
    ];
    const cols=['LWH ID','Customer','Item #','Description','Lot #','Qty','Date','Type'];
    const rows=pallets.map(p=>[p.lwhId,p.subCustNm,p.itemNm,p.itemDesc,p.lotNum,p.qty,p.transactionDate,p.transactionType].map(csvEscape));
    const csv=[...headerLines, cols.join(','), ...rows.map(r=>r.join(','))].join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=`packing-list-${header.proNumber}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // Renders into whatever container + print-area IDs the caller supplies,
  // so both the Load Details button and the standalone tab can reuse this.
  async function generateFor(proNumber, outContainerId, printAreaId){
    const out=el(outContainerId);
    if(out) out.innerHTML='<p class="hint">Loading pallet detail…</p>';
    await ensureData();
    const header=findLoadHeader(proNumber);
    if(!header){
      if(out) out.innerHTML='<div class="card">No load found for that Pro #.</div>';
      return;
    }
    const pallets=findPallets(proNumber);
    lastHeader=header; lastPallets=pallets;

    const html=buildPackingListHtml(header, pallets);
    if(out){
      out.innerHTML=`<div class="card">${html}<div class="actions" style="margin-top:14px"><button type="button" data-pl-print>Print</button><button type="button" data-pl-csv class="ghost">Export CSV</button></div></div>`;
      out.querySelector('[data-pl-print]').onclick=()=>{
        let printDiv=el(printAreaId);
        if(printDiv){ printDiv.innerHTML=html; setTimeout(()=>print(),100); }
      };
      out.querySelector('[data-pl-csv]').onclick=()=>exportCsv(header,pallets);
    }
  }

  window.LWHPackingList={generateFor, findMatchingLoads};

  window.addEventListener('load',()=>{
    if(!el('pkSearchBtn')) return;

    function renderMatchList(loads){
      const wrap=el('pkMatches');
      if(loads.length<=1){ wrap.innerHTML=''; return; }
      wrap.innerHTML=`<p class="hint">${loads.length} loads matched — pick one:</p>`+
        loads.map(l=>`<div class="card" style="margin-top:6px"><div><b>Pro ${safe(l.proNumber)}</b> · ${safe(l.loadDate)} · ${safe(l.carrier||'—')}</div>
          <div class="actions" style="margin-top:6px"><button type="button" class="ghost" data-pk-pick="${safe(l.proNumber)}">Generate for this load</button></div></div>`).join('');
    }

    async function runSearch(){
      const q=el('pkSearch').value.trim();
      if(!q){ LWHUI.toast('Enter a Pro # or Bill-to-Ref first'); return; }
      await ensureData();
      const matches=findMatchingLoads(q);
      if(!matches.length){ el('pkMatches').innerHTML=''; el('pkOutput').innerHTML='<div class="card">No load found for that Pro # or Bill-to-Ref.</div>'; return; }
      if(matches.length===1){
        el('pkMatches').innerHTML='';
        await generateFor(matches[0].proNumber,'pkOutput','pkPrintArea');
      }else{
        el('pkOutput').innerHTML='';
        renderMatchList(matches);
      }
    }

    el('pkSearchBtn').onclick=runSearch;
    el('pkSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();runSearch();}};
    el('pkClearBtn').onclick=()=>{ el('pkSearch').value=''; el('pkMatches').innerHTML=''; el('pkOutput').innerHTML=''; el('pkSearch').focus(); };
    el('pkMatches').addEventListener('click',e=>{
      const btn=e.target.closest('[data-pk-pick]'); if(!btn) return;
      generateFor(btn.dataset.pkPick,'pkOutput','pkPrintArea');
    });
  });
})();
