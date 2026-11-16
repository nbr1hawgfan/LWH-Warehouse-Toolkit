/* SONOCO REELS (v1.86.0) — production entry, incentive reports, issues and attendance for the
   Sonoco reels line. Replaces the "Employee Production Tracker" Apps Script web page. The records
   stay in the same Google Sheet; gas/SonocoReelsAPI.gs is the API and still sends the 8 AM daily
   email and the Monday incentive email, and still writes the CSV that feeds TLand.

   Who can use it is checked by the Apps Script on every request (not just on screen): it asks
   Supabase who the signed-in Toolkit session belongs to, and only employee IDs on the Sheet's
   Access tab get in. Everyone on that list sees pay, incentive and revenue figures.
   Setup: docs/SONOCO_REELS_SETUP.md */
(function(){
  'use strict';
  // Paste the Sonoco Reels Apps Script web app URL here (Deploy → Manage deployments → /exec URL).
  // It can also be set on a device from the Connect screen.
  const SR_API_DEFAULT='';
  const LS_URL='lwh_srApi', LS_ROLE='lwh_srRole', LS_EMAIL='lwh_srEmail', LS_EMP='lwh_srLastEmp';

  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const n=v=>{ const x=Number(String(v==null?'':v).replace(/[$,%\s]/g,'')); return isFinite(x)?x:0; };
  const money=v=>(n(v)<0?'−$':'$')+Math.abs(n(v)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const int=v=>Math.round(n(v)).toLocaleString('en-US');
  const num=v=>{ const x=Math.round(n(v)*100)/100; return x.toLocaleString('en-US',{maximumFractionDigits:2}); };
  const d1=v=>n(v).toFixed(1);
  const pad=x=>String(x).padStart(2,'0');
  const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());       // local date — no UTC slip
  const parse=s=>{ const p=String(s).split('-'); return new Date(+p[0],+p[1]-1,+p[2]); };
  const addDays=(s,k)=>{ const d=parse(s); d.setDate(d.getDate()+k); return ymd(d); };
  const today=()=>ymd(new Date());
  const monday=s=>{ const d=parse(s); d.setDate(d.getDate()-((d.getDay()+6)%7)); return ymd(d); };   // incentive weeks run Mon–Sun
  const nice=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s))?parse(s).toLocaleDateString('en-US',{weekday:'short',month:'numeric',day:'numeric'}):String(s);
  const ls={ get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
             set(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };
  const auth=()=>window.LWHAuth||null;
  const toast=m=>{ if(window.LWHUI&&LWHUI.toast) LWHUI.toast(m); };

  // ---------------------------------------------------------------- state
  let B=null, tab='enter', loading=false, built=false;
  const F={ date:today(), emp:'', part:'', qty:'', h:'', m:'' };
  let dayRows=null, daySeq=0;
  let dash=null, dashRange=null, dashPreset='month', dashFilter='';
  let rep={ type:'weeklyIncentive', start:monday(today()), end:addDays(monday(today()),6), rows:null, title:'' };
  let iss=null, issRange=null, att=null;

  const apiUrl=()=>String(ls.get(LS_URL,'')||SR_API_DEFAULT||'').trim();
  const empName=id=>{ const e=(B&&B.employees||[]).find(x=>String(x.id)===String(id)); return e?e.name:''; };

  // ---------------------------------------------------------------- API
  async function api(action,args){
    const url=apiUrl(); if(!url) throw new Error('not_connected');
    const a=auth(); const token=a&&a.token&&a.token();
    if(!token){ if(a) a.requireSignIn('Please sign in to use Sonoco Reels.'); throw new Error('signed_out'); }
    let res;
    try{ res=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({},args||{},{action,token})),cache:'no-store',redirect:'follow'}); }
    catch(e){ throw new Error('offline'); }
    let r; try{ r=await res.json(); }catch(e){ throw new Error('bad_reply'); }
    if(!r||!r.ok){
      const err=(r&&r.error)||'failed';
      if(err==='signed_out'&&a) a.requireSignIn('Your sign-in ran out. Please sign in again.');
      throw new Error(err);
    }
    return r;
  }
  function errText(e){
    const m=String(e&&e.message||e);
    if(m.startsWith('bad_input:')) return m.slice(10);
    return ({ not_connected:'Sonoco Reels isn\'t connected yet — the Apps Script link needs to be added.',
      offline:'Couldn\'t reach the server. Check your connection and try again.', signed_out:'Please sign in again.',
      no_access:'You don\'t have access to Sonoco Reels. Ask Tim to add your employee ID on the Access tab of the Sheet.',
      changed:'That record changed since this list was loaded. The list has been refreshed — check it and try again.',
      bad_reply:'The server sent back something unexpected. Check the Apps Script link (Connect).' })[m]
      || (m.startsWith('busy')?'Someone else is saving right now — try again in a moment.':'Something went wrong: '+m);
  }
  function msg(html,tone){ const m=$('srMsg'); if(!m) return; m.innerHTML=html||''; m.hidden=!html; m.className='pr-msg no-print'+(tone?' pr-msg-'+tone:''); }
  async function busy(btn,label,fn){
    const old=btn?btn.innerHTML:''; if(btn){ btn.disabled=true; btn.textContent=label; }
    try{ return await fn(); } finally{ if(btn){ btn.disabled=false; btn.innerHTML=old; } }
  }

  // ---------------------------------------------------------------- shared pieces
  const ICON='<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/></svg>';
  const empOptions=sel=>'<option value="">Select employee…</option>'+(B.employees||[]).map(e=>`<option value="${esc(e.id)}"${String(e.id)===String(sel)?' selected':''}>${esc(e.id)} — ${esc(e.name)}</option>`).join('');
  const partOptions=sel=>'<option value="">Select part…</option>'+(B.parts||[]).map(p=>`<option value="${esc(p)}"${p===sel?' selected':''}>${esc(p)}</option>`).join('');
  const perfClass=p=>p>=100?'sr-good':p>=85?'sr-mid':'sr-low';
  const empty=t=>`<div class="pr-empty">${esc(t)}</div>`;

  /** A server table (first row = headings). cell(v,colIndex,row) may return ready HTML for a <td>. */
  function table(rows,cell,rowClass){
    if(!rows||!rows.length) return empty('Nothing to show.');
    if(rows.length===1&&rows[0].length===1) return empty(rows[0][0]);
    return `<div class="pr-scroll"><table class="pr-table"><thead><tr>${rows[0].map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
      rows.slice(1).map(r=>`<tr${rowClass&&rowClass(r)?' class="'+rowClass(r)+'"':''}>${r.map((v,j)=>(cell&&cell(v,j,r))||`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  // Dashboard columns: 0 Date 1 Employee 2 Part 3 Qty 4 Hours 5 Pcs/Hr 6 Std 7 Performance 8 Cost 9 Incentive 10 Revenue
  function dashCell(v,j){
    if(j===0) return `<td class="nw">${esc(nice(v))}</td>`;
    if(j===3) return `<td class="r">${int(v)}</td>`;
    if(j===4||j===5||j===6) return `<td class="r">${num(v)}</td>`;
    if(j===7) return `<td class="r ${perfClass(n(v))}">${d1(v)}%</td>`;
    if(j>=8&&j<=10) return `<td class="r">${money(v)}</td>`;
    return '';
  }
  function emailBox(p){
    return `<div class="pr-email no-print"><input type="text" id="${p}To" inputmode="email" autocomplete="email" placeholder="name@logistics-warehouse.com" value="${esc(ls.get(LS_EMAIL,'')||'')}" aria-label="Email this to"><button type="button" class="ghost" id="${p}Send">Email</button></div>`;
  }
  function wireEmail(p,argsFn){
    const b=$(p+'Send'); if(!b) return;
    const go=()=>{
      const to=$(p+'To').value.trim(); if(!to){ $(p+'To').focus(); return toast('Enter an email address.'); }
      const a=argsFn(); if(!a) return;
      busy(b,'Sending…',()=>api('emailReport',Object.assign({to},a))).then(r=>{ ls.set(LS_EMAIL,to); toast(r.message||'Sent'); }).catch(e=>toast(errText(e)));
    };
    b.onclick=go; $(p+'To').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); go(); } };
  }
  function excel(file,sheetName,rows,numericFrom){
    if(!rows||rows.length<2) return toast('Nothing to export.');
    if(!window.LWHXlsx) return toast('Excel export isn\'t loaded.');
    const isNum=(j)=>j>=numericFrom&&rows.slice(1).every(r=>r[j]===''||r[j]==null||/^-?[\d,]*\.?\d+%?$/.test(String(r[j]).trim()));
    const cols=rows[0].map((h,j)=>({label:String(h),width:Math.max(10,Math.min(28,String(h).length+4)),type:isNum(j)?'n':undefined}));
    const body=rows.slice(1).map(r=>r.map((v,j)=>cols[j]&&cols[j].type==='n'&&v!==''&&v!=null?n(v):v));
    LWHXlsx.download(file,[{name:sheetName,columns:cols,rows:body}]);
  }

  // ---------------------------------------------------------------- shell
  function build(){
    const sec=$('sonocoReels'); if(!sec||built) return; built=true;
    sec.innerHTML=`<div class="pr-wrap">
      <div class="pr-top no-print">
        <div class="mh-entry-head">
          <div class="mh-entry-icon">${ICON}</div>
          <div><h2>Sonoco Reels</h2><div class="mh-entry-sub">Enter production, check incentives, log issues and absences. Daily report emails at 8 AM.</div></div>
          <div class="pr-who"><span id="srWho"></span><button type="button" class="ghost pr-small" id="srRefresh">Refresh</button></div>
        </div>
        <div class="pr-tabs" role="tablist" id="srTabs">
          <button type="button" data-srtab="enter" role="tab">Enter</button>
          <button type="button" data-srtab="dash" role="tab">Dashboard</button>
          <button type="button" data-srtab="reports" role="tab">Reports</button>
          <button type="button" data-srtab="issues" role="tab">Issues</button>
          <button type="button" data-srtab="attend" role="tab">Attendance</button>
          <button type="button" data-srtab="emps" role="tab">Employees</button>
        </div>
      </div>
      <div id="srMsg" class="pr-msg no-print" hidden></div>
      <div id="srBody"></div>
    </div>`;
    $('srTabs').addEventListener('click',e=>{ const b=e.target.closest('[data-srtab]'); if(b) setTab(b.dataset.srtab); });
    $('srRefresh').onclick=()=>{ dayRows=null; dash=null; iss=null; att=null; rep.rows=null; boot(true); };
  }

  async function boot(force){
    if(loading) return; if(B&&!force){ render(); return; }
    const a=auth();
    if(!a||!a.isSignedIn()){ msg('Please sign in to use Sonoco Reels.','warn'); $('srBody').innerHTML=''; return; }
    if(!apiUrl()){ renderConnect(); return; }
    loading=true; msg('Loading…');
    try{
      B=await api('bootstrap');
      ls.set(LS_ROLE,'user'); showNav();
      if(!F.emp){ const last=ls.get(LS_EMP,''); if(last&&empName(last)) F.emp=last; }
      msg(''); render();
    }catch(e){
      if(e.message==='no_access'){ ls.set(LS_ROLE,''); showNav(); }
      msg(esc(errText(e)),'bad');
      if(e.message==='bad_reply'||e.message==='not_connected') renderConnect(true);
      else $('srBody').innerHTML='';
    }finally{ loading=false; }
  }

  function renderConnect(keepMsg){
    if(!keepMsg) msg('');
    $('srBody').innerHTML=`<div class="card pr-card pr-narrow"><h3>Connect Sonoco Reels</h3>
      <p class="hint">Paste the Sonoco Reels Apps Script web app link (ends in <b>/exec</b>). It's saved on this device. See docs/SONOCO_REELS_SETUP.md — or ask Tim.</p>
      <label>Apps Script link<input id="srUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(apiUrl())}"></label>
      <div class="actions"><button type="button" id="srUrlSave">Save &amp; Connect</button></div></div>`;
    $('srUrlSave').onclick=()=>{ const v=$('srUrl').value.trim(); if(!/^https:\/\/script\.google\.com\/.+\/exec$/.test(v)){ toast('That doesn\'t look like an Apps Script /exec link.'); return; } ls.set(LS_URL,v); boot(true); };
  }

  function setTab(t){ if(t!==tab) msg(''); tab=t; render(); }
  function render(){
    if(!B) return;
    $('srWho').textContent=B.me.name;
    document.querySelectorAll('#srTabs [data-srtab]').forEach(b=>{ b.classList.toggle('active',b.dataset.srtab===tab); b.setAttribute('aria-selected',b.dataset.srtab===tab); });
    ({enter:renderEnter,dash:renderDash,reports:renderReports,issues:renderIssues,attend:renderAttend,emps:renderEmps})[tab]();
  }

  // ================================================================ ENTER
  function hoursDec(){ const h=Math.max(0,parseInt(F.h,10)||0), m=Math.max(0,Math.min(59,parseInt(F.m,10)||0)); return Math.round((h+m/60)*10000)/10000; }
  function renderEnter(){
    $('srBody').innerHTML=`<div class="sr-two">
      <div class="card pr-card">
        <h3>Add production</h3>
        <label>Production date<input type="date" id="srDate" value="${esc(F.date)}" max="${esc(addDays(today(),1))}"></label>
        <label>Employee<select id="srEmp">${empOptions(F.emp)}</select></label>
        <label>Part number<select id="srPart">${partOptions(F.part)}</select></label>
        <label>Quantity produced<input type="number" id="srQty" min="1" step="1" inputmode="numeric" placeholder="0" value="${esc(F.qty)}"></label>
        <div class="sr-time">
          <label>Hours worked<input type="number" id="srH" min="0" max="23" step="1" inputmode="numeric" placeholder="Hours" value="${esc(F.h)}"></label>
          <label>Minutes<input type="number" id="srM" min="0" max="59" step="1" inputmode="numeric" placeholder="Minutes" value="${esc(F.m)}"></label>
        </div>
        <div class="sr-calc" id="srCalc"></div>
        <div class="actions"><button type="button" id="srSave">Save entry</button><button type="button" class="ghost" id="srClear">Clear</button></div>
        <p class="hint">To fix an entry after it's saved, correct that row on the Production tab of the Sheet. The dashboard catches up within 5 minutes.</p>
      </div>
      <div class="card pr-card"><div class="pr-cardhead"><h3 id="srDayTitle"></h3></div><div id="srDay"></div></div>
    </div>`;
    const calc=()=>{ const t=hoursDec(); $('srCalc').textContent=t>0?`${parseInt(F.h,10)||0} h ${parseInt(F.m,10)||0} min = ${t} hours`:''; };
    $('srDate').onchange=e=>{ F.date=e.target.value; loadDay(); };
    $('srEmp').onchange=e=>{ F.emp=e.target.value; };
    $('srPart').onchange=e=>{ F.part=e.target.value; };
    $('srQty').oninput=e=>{ F.qty=e.target.value; };
    $('srH').oninput=e=>{ F.h=e.target.value; calc(); };
    $('srM').oninput=e=>{ if(n(e.target.value)>59) e.target.value='59'; F.m=e.target.value; calc(); };
    ['srQty','srH','srM'].forEach(id=>$(id).onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); saveEntry(); } });
    $('srSave').onclick=saveEntry;
    $('srClear').onclick=()=>{ Object.assign(F,{part:'',qty:'',h:'',m:''}); msg(''); renderEnter(); };
    calc(); if(dayRows&&dayRows.date===F.date) drawDay(); else loadDay();
  }
  async function loadDay(){
    const box=$('srDay'); if(!box) return;
    $('srDayTitle').textContent='Entered for '+nice(F.date);
    if(!F.date){ box.innerHTML=empty('Pick a date.'); return; }
    const seq=++daySeq, date=F.date; box.innerHTML=empty('Loading…');
    try{ const r=await api('dashboard',{start:date,end:date}); if(seq!==daySeq) return; dayRows={date,header:r.header,rows:r.rows}; drawDay(); }
    catch(e){ if(seq===daySeq) box.innerHTML=`<div class="pr-empty pr-neg">${esc(errText(e))}</div>`; }
  }
  function drawDay(){
    const box=$('srDay'); if(!box||!dayRows) return;
    $('srDayTitle').textContent='Entered for '+nice(dayRows.date);
    const rows=dayRows.rows;
    if(!rows.length){ box.innerHTML=empty('Nothing entered for this date yet.'); return; }
    const t=rows.reduce((a,r)=>{ a.q+=n(r[3]); a.h+=n(r[4]); a.i+=n(r[9]); return a; },{q:0,h:0,i:0});
    box.innerHTML=`<div class="pr-sumline">${rows.length} ${rows.length===1?'entry':'entries'} · ${int(t.q)} pieces · ${num(t.h)} hrs · ${money(t.i)} incentive</div>
      <div class="pr-scroll"><table class="pr-table"><thead><tr><th>Employee</th><th>Part</th><th class="r">Qty</th><th class="r">Hours</th><th class="r">Pcs/hr</th><th class="r">vs std</th><th class="r">Incentive</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td class="r">${int(r[3])}</td><td class="r">${num(r[4])}</td><td class="r">${num(r[5])}</td><td class="r ${perfClass(n(r[7]))}">${d1(r[7])}%</td><td class="r">${money(r[9])}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  async function saveEntry(){
    const btn=$('srSave'), hours=hoursDec(), qty=n(F.qty);
    if(!F.date) return toast('Pick the production date.');
    if(!F.emp) return toast('Pick the employee.');
    if(!F.part) return toast('Pick the part number.');
    if(!(qty>0)) return toast('Enter the quantity produced.');
    if(!(hours>0)) return toast('Enter the time worked.');
    try{
      await busy(btn,'Saving…',async()=>{
        const args={date:F.date,employeeId:F.emp,partNumber:F.part,quantity:qty,hours};
        let r;
        try{ r=await api('addProduction',args); }
        catch(e){
          if(e.message!=='duplicate') throw e;
          if(!confirm('This entry is already saved — same date, employee, part, quantity and time.\n\nSave it again anyway?')) return;
          r=await api('addProduction',Object.assign(args,{allowDuplicate:true}));
        }
        ls.set(LS_EMP,F.emp);
        const s=r.saved, who=empName(F.emp)||F.emp, part=F.part;
        Object.assign(F,{part:'',qty:'',h:'',m:''}); dash=null; rep.rows=null; dayRows=null;
        renderEnter(); toast('Saved');
        msg(`Saved: <b>${esc(who)}</b> · ${esc(part)} · ${int(qty)} pieces · ${num(hours)} hrs`+(s?` · <span class="${perfClass(n(s.performance))}">${d1(s.performance)}% of standard</span> · incentive ${money(s.incentive)}`:''),'good');
        const p=$('srPart'); if(p) p.focus();
      });
    }catch(e){ toast(errText(e)); msg(esc(errText(e)),'bad'); }
  }

  // ================================================================ DASHBOARD
  const PRESETS=[['today','Today'],['yday','Yesterday'],['week','This week'],['lweek','Last week'],['month','This month'],['lmonth','Last month'],['custom','Custom']];
  function presetRange(p){
    const t=today(), w=monday(t), d=parse(t);
    switch(p){
      case 'today': return {start:t,end:t};
      case 'yday': return {start:addDays(t,-1),end:addDays(t,-1)};
      case 'week': return {start:w,end:addDays(w,6)};
      case 'lweek': return {start:addDays(w,-7),end:addDays(w,-1)};
      case 'lmonth': return {start:ymd(new Date(d.getFullYear(),d.getMonth()-1,1)),end:ymd(new Date(d.getFullYear(),d.getMonth(),0))};
      case 'month': return {start:ymd(new Date(d.getFullYear(),d.getMonth(),1)),end:t};
      default: return dashRange||{start:w,end:t};
    }
  }
  function renderDash(){
    if(!dashRange) dashRange=presetRange(dashPreset);
    $('srBody').innerHTML=`<div class="pr-dashbar no-print">
        <div class="pr-presets">${PRESETS.map(([k,l])=>`<button type="button" class="pr-preset${dashPreset===k?' on':''}" data-srpreset="${k}">${l}</button>`).join('')}</div>
        <div class="pr-custom"${dashPreset==='custom'?'':' hidden'}><input type="date" id="srDStart" value="${esc(dashRange.start)}" aria-label="From"><span>to</span><input type="date" id="srDEnd" value="${esc(dashRange.end)}" aria-label="To"></div>
        <div class="pr-dashact"><button type="button" class="ghost pr-small" id="srDExcel">Excel</button><button type="button" class="ghost pr-small" id="srDPrint">Print</button></div>
      </div>
      <div id="srDash">${empty('Loading…')}</div>`;
    document.querySelectorAll('[data-srpreset]').forEach(b=>b.onclick=()=>{ dashPreset=b.dataset.srpreset; if(dashPreset!=='custom'){ dashRange=presetRange(dashPreset); dash=null; } renderDash(); });
    const cs=$('srDStart'), ce=$('srDEnd');
    const go=()=>{ if(cs.value&&ce.value&&ce.value>=cs.value){ dashRange={start:cs.value,end:ce.value}; dash=null; loadDash(); } };
    cs.onchange=go; ce.onchange=go;
    $('srDExcel').onclick=()=>{ if(dash) excel(`sonoco_reels_${dash.start}_to_${dash.end}.xlsx`,'Production',[dash.header].concat(dash.rows),3); };
    $('srDPrint').onclick=()=>window.print();
    if(dash&&dash.start===dashRange.start&&dash.end===dashRange.end) drawDash(); else loadDash();
  }
  async function loadDash(){
    const box=$('srDash'); if(!box) return; box.innerHTML=empty('Loading…');
    const range=dashRange;
    try{ const r=await api('dashboard',range); dash={start:range.start,end:range.end,header:r.header,rows:r.rows}; if(tab==='dash') drawDash(); }
    catch(e){ box.innerHTML=`<div class="pr-empty pr-neg">${esc(errText(e))}</div>`; }
  }
  function metrics(rows){
    const m={qty:0,hours:0,inc:0,rev:0,perf:0,pc:0,emps:{},parts:{}};
    rows.forEach(r=>{
      const q=n(r[3]); m.qty+=q; m.hours+=n(r[4]); m.inc+=n(r[9]); m.rev+=n(r[10]);
      if(String(r[7]).trim()!==''){ m.perf+=n(r[7]); m.pc++; }
      if(r[1]) m.emps[r[1]]=(m.emps[r[1]]||0)+q;
      if(r[2]) m.parts[r[2]]=(m.parts[r[2]]||0)+q;
    });
    const top=o=>Object.keys(o).map(k=>({name:k,val:o[k]})).sort((a,b)=>b.val-a.val).slice(0,5);
    return {qty:m.qty,hours:m.hours,inc:m.inc,rev:m.rev,avgPerf:m.pc?m.perf/m.pc:0,empCount:Object.keys(m.emps).length,topEmp:top(m.emps),topParts:top(m.parts)};
  }
  function drawDash(){
    const box=$('srDash'); if(!box||!dash) return;
    const x=metrics(dash.rows);
    const topList=a=>a.length?a.map(t=>`<div class="sr-top"><span>${esc(t.name)}</span><b>${int(t.val)} pcs</b></div>`).join(''):empty('No data');
    const when=dash.start===dash.end?nice(dash.start):nice(dash.start)+' – '+nice(dash.end);
    box.innerHTML=`<div class="pr-print-head">Sonoco Reels production — ${esc(dash.start)} to ${esc(dash.end)}</div>
      <div class="pr-tiles sr-tiles">
        <div class="pr-tile"><span>Total pieces</span><b>${int(x.qty)}</b><small class="pr-delta">${esc(when)}</small></div>
        <div class="pr-tile"><span>Total hours</span><b>${d1(x.hours)}</b><small class="pr-delta">${x.hours?num(x.qty/x.hours)+' pieces per hour':'&nbsp;'}</small></div>
        <div class="pr-tile"><span>Avg performance</span><b class="${x.qty?perfClass(x.avgPerf):''}">${d1(x.avgPerf)}%</b><small class="pr-delta">vs. standard</small></div>
        <div class="pr-tile"><span>Employees</span><b>${x.empCount}</b><small class="pr-delta">with production</small></div>
        <div class="pr-tile accent"><span>Incentives earned</span><b>${money(x.inc)}</b><small class="pr-delta">before absence rule</small></div>
        <div class="pr-tile accent"><span>Revenue</span><b>${money(x.rev)}</b><small class="pr-delta">production value</small></div>
      </div>
      <div class="sr-two sr-even">
        <div class="card pr-card"><h3>Top employees by pieces</h3>${topList(x.topEmp)}</div>
        <div class="card pr-card"><h3>Top parts by pieces</h3>${topList(x.topParts)}</div>
      </div>
      <div class="card pr-card">
        <div class="pr-cardhead"><h3>Production records <span class="pr-count">· ${dash.rows.length}</span></h3>${emailBox('srD')}</div>
        <input type="search" id="srDFilter" class="no-print" placeholder="Filter by employee or part" value="${esc(dashFilter)}" aria-label="Filter records">
        <div id="srDTable"></div>
      </div>`;
    const draw=()=>{ const q=dashFilter.trim().toLowerCase();
      const rows=dash.rows.filter(r=>!q||String(r[1]).toLowerCase().includes(q)||String(r[2]).toLowerCase().includes(q)||String(r[0]).includes(q));
      $('srDTable').innerHTML=rows.length?table([dash.header].concat(rows),dashCell):empty(dash.rows.length?'Nothing matches that filter.':'No production entered for these dates.'); };
    $('srDFilter').oninput=e=>{ dashFilter=e.target.value; draw(); };
    draw();
    wireEmail('srD',()=>({type:'dashboard',start:dash.start,end:dash.end}));
  }

  // ================================================================ REPORTS
  const REPORTS=[['weeklyIncentive','Weekly incentive',false],['monthlyPartSummary','Part summary',false],['dailyProduction','Daily production',true],['dailyEmployeePerformance','Daily employee performance',true]];
  const repOneDay=()=>(REPORTS.find(r=>r[0]===rep.type)||[])[2];
  function renderReports(){
    const one=repOneDay();
    $('srBody').innerHTML=`<div class="card pr-card no-print">
        <div class="pr-filters">
          <label>Report<select id="srRType">${REPORTS.map(([k,l])=>`<option value="${k}"${rep.type===k?' selected':''}>${l}</option>`).join('')}</select></label>
          <label>${one?'Date':'From'}<input type="date" id="srRStart" value="${esc(rep.start)}"></label>
          ${one?'':`<label>To<input type="date" id="srREnd" value="${esc(rep.end)}"></label>`}
          <div class="pr-quick">${one?'<button type="button" class="ghost pr-small" data-srq="today">Today</button><button type="button" class="ghost pr-small" data-srq="yday">Yesterday</button>'
            :'<button type="button" class="ghost pr-small" data-srq="week">This week</button><button type="button" class="ghost pr-small" data-srq="lweek">Last week</button><button type="button" class="ghost pr-small" data-srq="month">This month</button><button type="button" class="ghost pr-small" data-srq="lmonth">Last month</button>'}</div>
          <button type="button" id="srRGo">Show report</button>
        </div>
        ${rep.type==='weeklyIncentive'?'<p class="hint">Incentive weeks run Monday–Sunday. Anyone with a Call-In or Unexcused absence in the dates shows a $0.00 payout next to what they would have earned. PTO doesn\'t affect it.</p>':''}
      </div>
      <div id="srRep"></div>`;
    $('srRType').onchange=e=>{ rep.type=e.target.value; rep.rows=null;
      if(repOneDay()){ if(rep.start>today()) rep.start=today(); rep.end=rep.start; } else if(rep.end===rep.start){ rep.start=monday(today()); rep.end=addDays(rep.start,6); }
      renderReports(); };
    $('srRStart').onchange=e=>{ rep.start=e.target.value; if(repOneDay()) rep.end=rep.start; rep.rows=null; };
    const en=$('srREnd'); if(en) en.onchange=e=>{ rep.end=e.target.value; rep.rows=null; };
    document.querySelectorAll('[data-srq]').forEach(b=>b.onclick=()=>{ const r=presetRange(b.dataset.srq); rep.start=r.start; rep.end=r.end; rep.rows=null; renderReports(); loadReport(); });
    $('srRGo').onclick=loadReport;
    if(rep.rows) drawReport();
  }
  async function loadReport(){
    const box=$('srRep'); if(!box) return;
    if(repOneDay()) rep.end=rep.start;
    if(!rep.start||!rep.end) return toast('Pick the date'+(repOneDay()?'.':'s.'));
    if(rep.end<rep.start) return toast('The end date is before the start date.');
    box.innerHTML=empty('Loading…');
    const q={type:rep.type,start:rep.start,end:rep.end};
    try{ const r=await api('report',q); if(q.type!==rep.type||q.start!==rep.start||q.end!==rep.end) return; rep.rows=r.rows; rep.title=r.title; drawReport(); }
    catch(e){ box.innerHTML=`<div class="pr-empty pr-neg">${esc(errText(e))}</div>`; }
  }
  function drawReport(){
    const box=$('srRep'); if(!box||!rep.rows) return;
    const rows=rep.rows, h=rows[0]||[], type=rep.type;
    const iStatus=h.indexOf('Status'), iPay=h.indexOf('Payout'), iWould=h.indexOf('Would Have Earned');
    const inel=r=>iStatus>=0&&String(r[iStatus]).indexOf('INELIGIBLE')===0;
    let cell=null, rowClass=null;
    if(type==='weeklyIncentive'){
      rowClass=r=>inel(r)?'sr-inel':'';
      cell=(v,j,r)=> j===iStatus?`<td><b class="pr-badge ${inel(r)?'pr-t-bad':'pr-t-good'}">${esc(v)}</b></td>`
        : j===iPay?`<td class="r ${inel(r)?'sr-low':'sr-good'}">${money(v)}</td>`
        : j===iWould?`<td class="r"><b>${money(v)}</b></td>`
        : j>0?`<td class="r">${n(v)?money(v):'<span class="pr-small-t">—</span>'}</td>`:'';
    } else if(type==='dailyProduction'){
      cell=(v,j,r)=>r[0]==='TOTAL'?`<td class="${j>2?'r':''}"><b>${j===10?money(v):j===3?int(v):esc(v)}</b></td>`:dashCell(v,j);
    } else if(type==='monthlyPartSummary'){
      cell=(v,j)=> j===0?'':(j>=4&&j<=8)?`<td class="r">${money(v)}</td>`:`<td class="r">${v===''?'':num(v)}</td>`;
    } else {
      cell=(v,j)=> j===0?`<td class="nw">${esc(nice(v))}</td>`:(j===2||j===3)?`<td class="r">${num(v)}</td>`:j===4?`<td class="r ${perfClass(n(v))}">${d1(v)}%</td>`:'';
    }
    const when=rep.start===rep.end?rep.start:rep.start+' to '+rep.end;
    const hasData=rows.length>1;
    box.innerHTML=`<div class="card pr-card">
      <div class="pr-print-head">${esc(rep.title)} — ${esc(when)}</div>
      <div class="pr-cardhead no-print"><h3>${esc(rep.title)} <span class="pr-count">· ${esc(when)}</span></h3>
        ${hasData?`<div class="pr-dashact"><button type="button" class="ghost pr-small" id="srRExcel">Excel</button><button type="button" class="ghost pr-small" id="srRPrint">Print</button></div>`:''}</div>
      ${table(rows,cell,rowClass)}
      ${hasData?`<div class="pr-sub no-print">Email this report</div>${emailBox('srR')}${type==='weeklyIncentive'?'<p class="hint no-print">The email is the detailed version (by day and part, with the Excel file) — the same layout as the Monday incentive email.</p>':''}`:''}
    </div>`;
    if(!hasData) return;
    $('srRExcel').onclick=()=>excel(`${type}_${rep.start}_to_${rep.end}.xlsx`,'Report',rows,1);
    $('srRPrint').onclick=()=>window.print();
    wireEmail('srR',()=>({type,start:rep.start,end:rep.end}));
  }

  // ================================================================ ISSUES
  function renderIssues(){
    if(!issRange) issRange=presetRange('month');
    $('srBody').innerHTML=`<div class="sr-two">
      <div class="card pr-card no-print">
        <h3>Report a production issue</h3>
        <label>Issue date<input type="date" id="srIDate" value="${esc(today())}"></label>
        <label>Employee<select id="srIEmp">${empOptions('')}</select></label>
        <label>Part number<select id="srIPart">${partOptions('')}</select></label>
        <label>Lost production time (hours)<input type="number" id="srILost" min="0" step="0.1" inputmode="decimal" placeholder="0.0"></label>
        <label>Notes<textarea id="srINotes" rows="3" maxlength="1000" placeholder="What happened?"></textarea></label>
        <div class="actions"><button type="button" id="srISave">Save issue</button></div>
      </div>
      <div class="card pr-card">
        <div class="pr-cardhead"><h3>Issues log</h3></div>
        <div class="pr-filters no-print"><label>From<input type="date" id="srIStart" value="${esc(issRange.start)}"></label><label>To<input type="date" id="srIEnd" value="${esc(issRange.end)}"></label></div>
        <div id="srIList">${empty('Loading…')}</div>
      </div>
    </div>`;
    const go=()=>{ const s=$('srIStart').value, e=$('srIEnd').value; if(s&&e&&e>=s){ issRange={start:s,end:e}; iss=null; loadIssues(); } };
    $('srIStart').onchange=go; $('srIEnd').onchange=go;
    $('srISave').onclick=()=>{
      const a={date:$('srIDate').value,employeeId:$('srIEmp').value,partNumber:$('srIPart').value,lostTime:$('srILost').value,notes:$('srINotes').value};
      if(!a.date||!a.employeeId||!a.partNumber) return toast('Pick the date, employee and part.');
      busy($('srISave'),'Saving…',()=>api('addIssue',a)).then(()=>{ toast('Issue saved'); iss=null; renderIssues(); msg('Issue saved for <b>'+esc(empName(a.employeeId))+'</b> · '+esc(a.partNumber)+'.','good'); }).catch(e=>toast(errText(e)));
    };
    if(iss) drawIssues(); else loadIssues();
  }
  async function loadIssues(){
    const box=$('srIList'); if(!box) return; box.innerHTML=empty('Loading…');
    try{ const r=await api('issues',issRange); iss={header:r.header,rows:r.rows}; drawIssues(); }
    catch(e){ box.innerHTML=`<div class="pr-empty pr-neg">${esc(errText(e))}</div>`; }
  }
  function drawIssues(){
    const box=$('srIList'); if(!box||!iss) return;
    if(!iss.rows.length){ box.innerHTML=empty('No issues logged for these dates.'); return; }
    const lost=iss.rows.reduce((a,r)=>a+n(r[4]),0);
    // Columns: 0 Date 1 Emp ID 2 Name 3 Part 4 Lost hours 5 Notes 6 Timestamp — show the useful ones.
    const view=[['Date','Employee','Part','Lost hrs','Notes']].concat(iss.rows.map(r=>[r[0],r[2],r[3],r[4],r[5]]));
    box.innerHTML=`<div class="pr-sumline">${iss.rows.length} ${iss.rows.length===1?'issue':'issues'} · ${num(lost)} hours lost</div>
      ${table(view,(v,j)=>j===0?`<td class="nw">${esc(nice(v))}</td>`:j===3?`<td class="r">${num(v)}</td>`:'')}
      <div class="pr-sub no-print">Email this log</div>${emailBox('srI')}`;
    wireEmail('srI',()=>({type:'issues',start:issRange.start,end:issRange.end}));
  }

  // ================================================================ ATTENDANCE
  function renderAttend(){
    const types=B.absenceTypes||['Call-In','Unexcused','PTO'];
    $('srBody').innerHTML=`<div class="pr-msg pr-msg-warn no-print">A <b>Call-In</b> or <b>Unexcused</b> absence takes away that employee's incentive payout for that Monday–Sunday week. <b>PTO</b> doesn't. Deleting a record here makes them eligible again.</div>
      <div class="sr-two">
      <div class="card pr-card no-print">
        <h3>Mark an absence</h3>
        <label>Absence date<input type="date" id="srADate" value="${esc(today())}"></label>
        <label>Employee<select id="srAEmp">${empOptions('')}</select></label>
        <label>Absence type<select id="srAType"><option value="">Select type…</option>${types.map(t=>`<option value="${esc(t)}">${esc(t)}${t==='PTO'?' (doesn\'t affect incentive)':''}</option>`).join('')}</select></label>
        <label>Notes <span class="hint">(optional)</span><textarea id="srANotes" rows="2" maxlength="500"></textarea></label>
        <div class="actions"><button type="button" id="srASave">Save absence</button></div>
      </div>
      <div class="card pr-card"><div class="pr-cardhead"><h3>Attendance log</h3></div><div id="srAList">${empty('Loading…')}</div></div>
    </div>`;
    $('srASave').onclick=()=>{
      const a={date:$('srADate').value,employeeId:$('srAEmp').value,type:$('srAType').value,notes:$('srANotes').value};
      if(!a.date||!a.employeeId||!a.type) return toast('Pick the date, employee and type.');
      busy($('srASave'),'Saving…',()=>api('addAbsence',a)).then(()=>{ toast('Absence saved'); att=null; rep.rows=null; renderAttend(); msg(esc(a.type)+' saved for <b>'+esc(empName(a.employeeId))+'</b> on '+esc(nice(a.date))+'.','good'); }).catch(e=>toast(errText(e)));
    };
    if(att) drawAttend(); else loadAttend();
  }
  async function loadAttend(){
    const box=$('srAList'); if(!box) return; box.innerHTML=empty('Loading…');
    try{ const r=await api('attendance'); att=r.rows; drawAttend(); }
    catch(e){ box.innerHTML=`<div class="pr-empty pr-neg">${esc(errText(e))}</div>`; }
  }
  function drawAttend(){
    const box=$('srAList'); if(!box||!att) return;
    if(!att.length){ box.innerHTML=empty('No absences recorded.'); return; }
    box.innerHTML=`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Date</th><th>Employee</th><th>Type</th><th>Notes</th><th></th></tr></thead><tbody>
      ${att.map((a,i)=>{ const dq=a.type==='Call-In'||a.type==='Unexcused';
        return `<tr><td class="nw">${esc(nice(a.date))}</td><td>${esc(a.name)} <span class="pr-small-t">${esc(a.employeeId)}</span></td><td><b class="pr-badge ${dq?'pr-t-bad':'pr-t-good'}">${esc(a.type)}</b></td><td>${esc(a.notes)}</td>
          <td class="r"><button type="button" class="ghost pr-small pr-danger no-print" data-srdel="${i}">Delete</button></td></tr>`; }).join('')}
      </tbody></table></div>`;
    box.querySelectorAll('[data-srdel]').forEach(b=>b.onclick=async()=>{
      const a=att[+b.dataset.srdel];
      if(!confirm(`Delete this absence?\n\n${a.name} · ${nice(a.date)} · ${a.type}\n\nIf it was their only Call-In/Unexcused that week, their incentive payout comes back.`)) return;
      try{ await busy(b,'…',()=>api('deleteAbsence',{row:a.row,date:a.date,employeeId:a.employeeId,type:a.type})); toast('Deleted'); rep.rows=null; loadAttend(); }
      catch(e){ toast(errText(e)); if(e.message==='changed') loadAttend(); }
    });
  }

  // ================================================================ EMPLOYEES
  function renderEmps(){
    const list=B.employees||[];
    $('srBody').innerHTML=`<div class="sr-two">
      <div class="card pr-card">
        <h3>Add an employee</h3>
        <label>Employee ID<input id="srNId" maxlength="20" autocomplete="off" placeholder="e.g. EMP001"></label>
        <label>Full name<input id="srNName" maxlength="60" autocomplete="off" placeholder="First Last"></label>
        <label>Hourly rate ($)<input type="number" id="srNRate" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00"></label>
        <div class="actions"><button type="button" id="srNSave">Add employee</button></div>
        <p class="hint">Pay rates are kept on the Employees tab of the Sheet and aren't shown here. To change a rate or a name, edit it there.</p>
      </div>
      <div class="card pr-card"><h3>On the list <span class="pr-count">· ${list.length}</span></h3>
        ${list.length?`<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Employee ID</th><th>Name</th></tr></thead><tbody>${list.map(e=>`<tr><td>${esc(e.id)}</td><td>${esc(e.name)}</td></tr>`).join('')}</tbody></table></div>`:empty('No employees yet.')}
      </div></div>`;
    $('srNSave').onclick=()=>{
      const a={employeeId:$('srNId').value.trim(),name:$('srNName').value.trim(),hourlyRate:$('srNRate').value};
      if(!a.employeeId||!a.name||!(n(a.hourlyRate)>0)) return toast('Enter the ID, name and hourly rate.');
      busy($('srNSave'),'Saving…',()=>api('addEmployee',a)).then(r=>{ B.employees=r.employees; toast('Employee added'); renderEmps(); msg('<b>'+esc(a.name)+'</b> added.','good'); }).catch(e=>toast(errText(e)));
    };
  }

  // ---------------------------------------------------------------- nav + lifecycle
  function showNav(){
    const nav=$('navSonocoReels'); if(!nav) return;
    const a=auth();
    nav.hidden=!(a&&a.isSignedIn()&&ls.get(LS_ROLE,''));   // in the menu only after this device has got in once
  }
  function onShow(){ build(); showNav(); boot(false); }

  document.addEventListener('DOMContentLoaded',()=>{
    const sec=$('sonocoReels'); if(!sec) return;
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
    showNav(); [1500,4000].forEach(t=>setTimeout(showNav,t));
  });
  window.LWHSonocoReels={ refresh:()=>boot(true), _test:{metrics,hoursDec,F,monday,presetRange} };
})();
