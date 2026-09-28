/* PAS SHEET READER — core extraction logic (no page UI here).
 *
 * Works on the OCR result of a scanned Shipping P.A.S. Sheet. Shared by the
 * Toolkit page (js/pasreader.js) and the offline accuracy test harness, so the
 * same rules run in both places.
 *
 * How it gets accuracy on a scanned sheet:
 *   1. Full-page OCR (grayscale, native resolution — no hard threshold, which
 *      was eating thin characters in the old V6 tool) gives every row with
 *      word positions.
 *   2. Each row's serial and date/time get a second, targeted read of just
 *      that spot with a character whitelist (digits/letters only, or digits,
 *      "/" and ":" only).
 *   3. Serial template: the sheet's serials share one shape (e.g. 4 digits,
 *      1 letter, 11 digits). The shape is learned from the rows themselves,
 *      then OCR look-alikes are fixed only where the shape allows exactly one
 *      reading (O→0 in a digit spot, 8→B in a letter spot, …). Every fix is
 *      recorded so the reviewer sees it.
 *   4. Dates/times are repaired from their fixed shapes (140408 → 14:04:08)
 *      and checked against Date Loaded.
 *   5. Cross-checks: pallet count vs "Pallets: N", missing/duplicate pallet #,
 *      duplicate serials, item # agreement, two reads disagreeing.
 */
(function(root){
  'use strict';

  const DIGIT_FIX={O:'0',Q:'0',D:'0',U:'0',I:'1',L:'1',T:'1',J:'1','|':'1','!':'1',Z:'2',S:'5',G:'6',B:'8',E:'8'};
  const LETTER_FIX={'0':'O','1':'I','2':'Z','4':'A','5':'S','6':'G','8':'B'};

  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const isDigit=c=>c>='0'&&c<='9';
  const isLetter=c=>c>='A'&&c<='Z';

  // ------------------------------------------------------------ lines
  // Flatten tesseract.js v5 "blocks" output into lines of words with boxes.
  function flattenLines(data){
    const out=[];
    (data.blocks||[]).forEach(b=>(b.paragraphs||[]).forEach(p=>(p.lines||[]).forEach(l=>{
      out.push({text:l.text||'',bbox:l.bbox,words:(l.words||[]).map(w=>({text:w.text||'',bbox:w.bbox,conf:w.confidence,symbols:(w.symbols||[]).map(s=>({text:s.text,conf:s.confidence}))}))});
    })));
    return out.sort((a,b)=>a.bbox.y0-b.bbox.y0);
  }

  // ------------------------------------------------------------ header
  function findHeader(lines){
    const text=lines.map(l=>l.text).join('\n');
    const pick=(re,src=text)=>{ const m=src.match(re); return m?clean(m[1]):''; };
    const h={};
    h.trailer=pick(/Trailer\s*#?\s*:?\s*([A-Z0-9][A-Z0-9-]{2,})/i);
    h.customer=pick(/Customer\s*Name\s*:?\s*([^\n]+)/i);
    h.carrier=pick(/Carrier\s*:?\s*(.+?)(?:\s{2,}|\s+Date\b|\n|$)/i).replace(/^[^A-Z0-9]+/i,'');
    h.dateLoaded=normDate(pick(/Date\s*Loaded\s*:?\s*([0-9OIl|\/\-.]{6,10})/i));
    h.dockDoor=pick(/Dock\s*Door\s*#?\s*:?\s*([A-Z0-9.]+)/i);
    h.bayLocation=pick(/Bay\s*Location\s*:?\s*([A-Z0-9.]+)/i);
    h.weight=pick(/Load\s*Weight\s*:?\s*([\d,]+(?:\.\d+)?)/i);
    // Order No: the value sits under/after "Order No" in the top-right block.
    const oi=lines.findIndex(l=>/Order\s*No/i.test(l.text));
    const scan=oi>=0?lines.slice(oi,oi+3):lines.slice(0,6);
    for(const l of scan){ const m=l.text.match(/\b(\d{5,9}\s?[A-Z]{0,3})\s*$/); if(m){ h.order=clean(m[1]); break; } }
    if(!h.order){ const m=text.slice(0,600).match(/\b(\d{6,8}\s[A-Z]{2})\b/); if(m) h.order=m[1]; }
    // Product line: "1.75L SEAGRAM'S 201988   Pallets: 22 PL   959H60-09   863850"
    const pl=lines.find(l=>/Pallets?\s*:?\s*\d+/i.test(l.text)&&!/Pallet\s*#/i.test(l.text));
    if(pl){
      const t=clean(pl.text);
      const m=t.match(/^(.*?)\s*Pallets?\s*:?\s*(\d+)\s*(?:PL)?\s*(.*)$/i);
      if(m){
        h.product=clean(m[1]); h.expected=+m[2];
        const rest=clean(m[3]).split(' ').filter(Boolean);
        h.itemHeader=(rest.slice().reverse().find(x=>/^\d{5,8}$/.test(x))||'');
        h.lotCode=rest.find(x=>x!==h.itemHeader)||'';
      }
    }
    return h;
  }

  // ------------------------------------------------------------ rows
  const PALLET_RE=/P[ao]?[l1I|]{1,2}[e3c]?[t+f][#t%é&$@*\s]*\s*(\d{1,3})\b/i;
  const ITEM_RE=/[Il1|]t[e3]m\s*#?\s*([0-9OIlS]{4,8})/i;

  // Candidate serial tokens: long alnum runs (after dropping stray punctuation)
  function serialTokens(str){
    return (String(str).toUpperCase().replace(/[.,;:'"`~=_]+/g,' ').match(/[A-Z0-9]{12,24}/g)||[])
      .filter(t=>/[0-9]/.test(t));
  }

  function findRows(lines){
    const rows=[];
    lines.forEach(l=>{
      const t=clean(l.text);
      if(/Pallets?\s*:\s*\d+\s*PL/i.test(t)) return;               // header product line
      const pm=t.match(PALLET_RE);
      const toks=serialTokens(t);
      if(!pm && !toks.length) return;
      if(!toks.length && !/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(t)) return;
      // word lookups (for re-read rectangles)
      const words=l.words||[];
      const serialWord=words.find(w=>serialTokens(w.text).length);
      const dateIdx=words.findIndex(w=>/\d{1,2}[\/\-][0-9OIl]{1,2}[\/\-]\d{2,4}/.test(w.text));
      const dateWord=dateIdx>=0?words[dateIdx]:null;
      const timeWord=dateIdx>=0?words.slice(dateIdx+1).find(w=>/\d/.test(w.text)&&w.text.replace(/[^0-9]/g,'').length>=4):null;
      const im=t.match(ITEM_RE);
      const after=pm?t.slice(pm.index+pm[0].length):t;
      const dm=after.match(/\b(\d{1,2}[\/\-][0-9OIl]{1,2}[\/\-]\d{2,4})\b/);
      const tm=dm?after.slice(after.indexOf(dm[1])+dm[1].length).match(/([0-9OIl|:.;]{6,10})/):null;
      const pWord=words.find(w=>/^P[ao]?[l1I|]{1,2}/i.test(w.text));
      rows.push({
        line:l, y0:l.bbox.y0, y1:l.bbox.y1, words0x:words.length?words[0].bbox.x0:null, palletX:pWord?pWord.bbox.x0:null,
        palletRaw:pm?pm[1]:'', itemRaw:im?im[1]:'',
        serialRaw:toks.sort((a,b)=>b.length-a.length)[0]||'',
        serialConf:serialWord?serialWord.conf:null,
        serialSymbols:serialWord?serialWord.symbols:[],
        dateRaw:dm?dm[1]:'', timeRaw:tm?tm[1]:'',
        boxes:{serial:serialWord?serialWord.bbox:null,date:dateWord?dateWord.bbox:null,time:timeWord?timeWord.bbox:null}
      });
    });
    return rows;
  }

  // ------------------------------------------------------------ serial template
  function learnTemplate(serials){
    const lens={}; serials.forEach(s=>{ if(s) lens[s.length]=(lens[s.length]||0)+1; });
    const L=+Object.keys(lens).sort((a,b)=>lens[b]-lens[a])[0];
    if(!L) return null;
    const same=serials.filter(s=>s&&s.length===L);
    if(same.length<2) return null;
    const cls=[];
    for(let i=0;i<L;i++){
      let d=0,a=0; same.forEach(s=>{ isDigit(s[i])?d++:a++; });
      cls.push(d>=a*3?'9':a>=d*3?'A':'?');   // '?' = position genuinely varies
    }
    return {length:L,pattern:cls.join(''),support:same.length};
  }

  // Coerce one serial to the learned template. Returns {value,fixes,ok}.
  function applyTemplate(raw,tpl){
    let s=String(raw||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const fixes=[];
    if(!tpl||!s) return {value:s,fixes,ok:!!s&&!tpl};
    // Too long by junk on the end/start (e.g. a trailing "1" from a period)? trim to fit
    if(s.length>tpl.length){
      const tail=s.slice(0,tpl.length), head=s.slice(s.length-tpl.length);
      const score=x=>[...x].reduce((n,c,i)=>n+((tpl.pattern[i]==='9'&&isDigit(c))||(tpl.pattern[i]==='A'&&isLetter(c))||tpl.pattern[i]==='?'?1:0),0);
      const pickHead=score(head)>score(tail);
      fixes.push({type:'trim',note:`dropped extra "${pickHead?s.slice(0,s.length-tpl.length):s.slice(tpl.length)}"`});
      s=pickHead?head:tail;
    }
    if(s.length!==tpl.length) return {value:s,fixes,ok:false};
    const out=[...s];
    for(let i=0;i<out.length;i++){
      const want=tpl.pattern[i], c=out[i];
      if(want==='9'&&!isDigit(c)){
        if(DIGIT_FIX[c]){ fixes.push({pos:i,from:c,to:DIGIT_FIX[c]}); out[i]=DIGIT_FIX[c]; }
        else return {value:out.join(''),fixes,ok:false};
      } else if(want==='A'&&!isLetter(c)){
        if(LETTER_FIX[c]){ fixes.push({pos:i,from:c,to:LETTER_FIX[c]}); out[i]=LETTER_FIX[c]; }
        else return {value:out.join(''),fixes,ok:false};
      }
    }
    return {value:out.join(''),fixes,ok:true};
  }

  // ------------------------------------------------------------ date/time
  function normDate(raw){
    let s=String(raw||'').replace(/[OoQ]/g,'0').replace(/[Il|]/g,'1').replace(/[.\-]/g,'/');
    let m=s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if(!m){ const d=s.replace(/\D/g,''); if(d.length===6) m=[0,d.slice(0,2),d.slice(2,4),d.slice(4)]; else return ''; }
    const mo=+m[1], da=+m[2]; let yr=m[3];
    if(mo<1||mo>12||da<1||da>31) return '';
    if(yr.length===4) yr=yr.slice(2);
    return `${String(mo).padStart(2,'0')}/${String(da).padStart(2,'0')}/${yr.padStart(2,'0')}`;
  }
  function validTime(h,m,s){ return h<24&&m<60&&s<60; }
  function normTime(raw){
    let s=String(raw||'').replace(/[OoQ]/g,'0').replace(/[Il|]/g,'1').replace(/[.;]/g,':');
    let m=s.match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if(m&&validTime(+m[1],+m[2],+m[3])) return {value:`${m[1].padStart(2,'0')}:${m[2]}:${m[3]}`,fixed:false};
    const d=s.replace(/\D/g,'');
    const tryParts=(a,b,c)=>validTime(+a,+b,+c)?`${a.padStart(2,'0')}:${b}:${c}`:null;
    if(d.length===6){ const v=tryParts(d.slice(0,2),d.slice(2,4),d.slice(4)); if(v) return {value:v,fixed:true}; }
    // a colon misread as "1": 1924148 → 19 24 [1] 48, 19124148 → 19 [1] 24 [1] 48
    if(d.length===7){
      for(const cut of [2,4]){ if(d[cut]==='1'){ const x=d.slice(0,cut)+d.slice(cut+1); const v=tryParts(x.slice(0,2),x.slice(2,4),x.slice(4)); if(v) return {value:v,fixed:true}; } }
    }
    if(d.length===8&&d[2]==='1'&&d[5]==='1'){ const v=tryParts(d.slice(0,2),d.slice(3,5),d.slice(6)); if(v) return {value:v,fixed:true}; }
    return {value:'',fixed:false};
  }
  function dateDiffDays(a,b){
    const p=x=>{ const m=String(x).match(/(\d\d)\/(\d\d)\/(\d\d)/); return m?new Date(2000+ +m[3],+m[1]-1,+m[2]):null; };
    const A=p(a),B=p(b); return A&&B?Math.round((A-B)/86400000):null;
  }

  // Per-position majority character across a set of equal-length strings.
  function consensus(list){
    const L=list.length?list[0].length:0, out=[];
    for(let i=0;i<L;i++){ const c={}; list.forEach(s=>{ if(s.length===L) c[s[i]]=(c[s[i]]||0)+1; }); out.push(Object.keys(c).sort((a,b)=>c[b]-c[a])[0]||''); }
    return out.join('');
  }
  const agree=(s,cons)=>[...s].reduce((n,ch,i)=>n+(ch===cons[i]?1:0),0);

  // Vote among independent reads of one field. cands: [{value,ok,weight}]
  // Returns {value, level, msg, alt} — level null means "confirmed".
  function vote(field,cands,tieBreak,label){
    const tried=cands.length, valid=cands.filter(c=>c.ok&&c.value);
    const counts={}; valid.forEach(c=>{ counts[c.value]=(counts[c.value]||0)+1; });
    const vals=Object.keys(counts).sort((a,b)=>counts[b]-counts[a]||tieBreak(b)-tieBreak(a));
    if(!vals.length) return {value:(cands.find(c=>c.value)||{}).value||'',level:'bad',msg:`${label} couldn't be read`};
    const top=vals[0], n=counts[top];
    if(vals.length===1&&n>=2) return {value:top,level:null};
    if(n>=2) return {value:top,level:'info',msg:`${n} of ${valid.length} reads agree (${vals.slice(1).join(', ')} outvoted)`};
    if(vals.length===1) return {value:top,level:tried>1?'check':null,msg:tried>1?`Only one of ${tried} reads could make this out`:''};
    return {value:top,level:'check',msg:`Reads disagree (${vals.join(' vs ')}) — picked the one that best fits the rest of the sheet`,alt:vals[1]};
  }

  // ------------------------------------------------------------ assemble
  // rows[i].reads = {serial:[raw…], date:[raw…], time:[raw…]} (page read first)
  function assemble(rows,header){
    const allSerials=[];
    rows.forEach(r=>r.reads.serial.forEach(x=>serialTokens(x).forEach(t=>allSerials.push(t))));
    const tpl=learnTemplate(allSerials);
    const fitSerial=raw=>{ const t=serialTokens(raw)[0]||String(raw||'').toUpperCase().replace(/[^A-Z0-9]/g,''); return applyTemplate(t,tpl); };

    // Sheet-wide consensus from rows whose first two reads agree (tie-breaker only)
    const firstTwo=rows.map(r=>r.reads.serial.slice(0,2).map(fitSerial));
    const agreed=firstTwo.filter(p=>p.length===2&&p[0].ok&&p[1].ok&&p[0].value===p[1].value).map(p=>p[0].value);
    const cons=consensus(agreed.length>=3?agreed:firstTwo.map(p=>p[0]).filter(x=>x&&x.ok).map(x=>x.value));
    const dateVotes={}; rows.forEach(r=>{ const d=r.reads.date.map(normDate).filter(Boolean); if(d.length>=2&&d[0]===d[1]) dateVotes[d[0]]=(dateVotes[d[0]]||0)+1; });
    if(header.dateLoaded) dateVotes[header.dateLoaded]=(dateVotes[header.dateLoaded]||0)+2;

    const itemCounts={};
    const recs=rows.map((r,idx)=>{
      const flags=[];
      // serial
      const sFits=r.reads.serial.map(fitSerial);
      const sv=vote('serial',sFits.map(f=>({value:f.value,ok:f.ok})),v=>agree(v,cons),'Serial');
      if(sv.level) flags.push({field:'serial',level:sv.level,msg:sv.msg,alt:sv.alt});
      const chosenFit=sFits.find(f=>f.ok&&f.value===sv.value);
      const fixes=chosenFit?chosenFit.fixes:[];
      if(sv.value&&!sFits.some(f=>f.ok&&f.value===sv.value)) flags.push({field:'serial',level:'bad',msg:`Doesn't match the serial pattern${tpl?' ('+tpl.length+' characters)':''}`});
      fixes.forEach(f=>flags.push({field:'serial',level:'info',msg:f.type==='trim'?'Auto-fixed: '+f.note:`Auto-fixed character ${f.pos+1}: read "${f.from}", the serial pattern says "${f.to}"`}));

      // date
      const dv=vote('date',r.reads.date.map(x=>{ const v=normDate(x); return {value:v,ok:!!v}; }),v=>dateVotes[v]||0,'Date');
      if(dv.level) flags.push({field:'date',level:dv.level,msg:dv.msg,alt:dv.alt});
      if(dv.value&&header.dateLoaded){ const dd=dateDiffDays(header.dateLoaded,dv.value); if(dd!==null&&(dd<0||dd>14)) flags.push({field:'date',level:'check',msg:`${Math.abs(dd)} day${Math.abs(dd)===1?'':'s'} ${dd<0?'after':'before'} Date Loaded — check it`}); }

      // time — a page read that kept its colons ranks first on a tie
      const tRes=r.reads.time.map(x=>normTime(x));
      const tv=vote('time',tRes.map(t=>({value:t.value,ok:!!t.value})),v=>(tRes[0]&&tRes[0].value===v&&!tRes[0].fixed)?1:0,'Time');
      if(tv.level) flags.push({field:'time',level:tv.level,msg:tv.msg,alt:tv.alt});

      const item=String(r.itemRaw||'').replace(/[OQ]/g,'0').replace(/[Il|]/g,'1').replace(/S/g,'5');
      if(item) itemCounts[item]=(itemCounts[item]||0)+1;
      return {idx,pallet:r.palletRaw?String(+r.palletRaw):'',palletInferred:false,item,
        serial:sv.value,serialFixes:fixes,date:dv.value,time:tv.value,flags,y0:r.y0,y1:r.y1,boxes:r.boxes};
    });

    // Pallet #: 0 or wildly out of range is a misread
    const maxP=Math.max(+header.expected||0,recs.length)+5;
    recs.forEach(r=>{ if(r.pallet&&(+r.pallet<1||+r.pallet>maxP)){ r.flags.push({field:'pallet',level:'check',msg:`Pallet # read as "${r.pallet}"`}); r.badPallet=r.pallet; r.pallet=''; } });
    // Rows run in order: a number that doesn't fit between its neighbours gets
    // the one that does (only when that number isn't already used elsewhere).
    const used=()=>new Set(recs.map(r=>r.pallet).filter(Boolean));
    recs.forEach((r,i)=>{
      const prev=recs[i-1], next=recs[i+1];
      if(!prev||!next||!prev.pallet||!next.pallet||!r.pallet) return;
      if(+next.pallet-+prev.pallet===2&&+r.pallet!==+prev.pallet+1&&!used().has(String(+prev.pallet+1))){
        r.flags.push({field:'pallet',level:'check',msg:`Pallet # read as ${r.pallet} — fits the sequence as ${+prev.pallet+1}`});
        r.pallet=String(+prev.pallet+1);
      }
    });
    // Pallet #: fill gaps from neighbours when missing
    recs.forEach((r,i)=>{
      if(r.pallet) return;
      const prev=recs[i-1], next=recs[i+1];
      const guess=prev&&prev.pallet?+prev.pallet+1:next&&next.pallet?+next.pallet-1:i+1;
      if(guess>0){ r.pallet=String(guess); r.palletInferred=true; if(!r.badPallet) r.flags.push({field:'pallet',level:'check',msg:'Pallet # not read — filled in from row order'}); else { const f=r.flags.find(f=>f.field==='pallet'); if(f) f.msg+=` — filled in as ${guess} from row order`; } }
    });
    const itemMajor=Object.keys(itemCounts).sort((a,b)=>itemCounts[b]-itemCounts[a])[0]||header.itemHeader||'';
    recs.forEach(r=>{ if(!r.item) r.item=itemMajor; else if(r.item!==itemMajor) r.flags.push({field:'item',level:'check',msg:`Item # ${r.item} differs from the rest (${itemMajor})`}); });
    return {records:recs,template:tpl,itemMajor};
  }

  // Sheet-level checks → list of {level,msg}
  function checkSheet(recs,header){
    const out=[];
    const exp=+header.expected||0;
    const nums=recs.map(r=>+r.pallet).filter(Boolean);
    const miss=[]; if(exp) for(let i=1;i<=exp;i++) if(!nums.includes(i)) miss.push(i);
    if(exp) out.push(recs.length===exp&&!miss.length?{level:'ok',msg:`All ${exp} pallets found`}:{level:'bad',msg:`Sheet says ${exp} pallets — found ${recs.length}`+(miss.length?` (missing #${miss.join(', #')})`:'')});
    else out.push({level:'check',msg:'Pallet count on the sheet wasn\'t read'});
    const dupP=[...new Set(nums.filter((n,i,a)=>a.indexOf(n)!==i))];
    if(dupP.length) out.push({level:'bad',msg:'Pallet # listed twice: '+dupP.join(', ')});
    const ser=recs.map(r=>r.serial).filter(Boolean);
    const dupS=[...new Set(ser.filter((s,i,a)=>a.indexOf(s)!==i))];
    out.push(dupS.length?{level:'bad',msg:'Duplicate serial: '+dupS.join(', ')}:{level:'ok',msg:'No duplicate serials'});
    const needs=recs.filter(r=>r.flags.some(f=>f.level==='bad'||f.level==='check')).length;
    out.push(needs?{level:'check',msg:`${needs} row${needs===1?'':'s'} to double-check`}:{level:'ok',msg:'Every field confirmed by at least two reads'});
    return out;
  }

  // ------------------------------------------------------------ image prep
  // Straighten a crooked scan: try small angles, keep the one where text rows
  // line up best (sharpest horizontal projection).
  function skewAngle(canvas,makeCanvas){
    const W=canvas.width,H=canvas.height,sc=Math.min(1,900/W);
    const w=Math.round(W*sc),h=Math.round(H*sc);
    const c=makeCanvas(w,h),x=c.getContext('2d'); x.drawImage(canvas,0,0,w,h);
    const d=x.getImageData(0,0,w,h).data, pts=[];
    for(let yy=0;yy<h;yy++) for(let xx=0;xx<w;xx++){ const i=(yy*w+xx)*4; if(d[i]*.3+d[i+1]*.59+d[i+2]*.11<140) pts.push(xx-w/2,yy-h/2); }
    const score=deg=>{ const a=deg*Math.PI/180,sn=Math.sin(a),cs=Math.cos(a),bins=new Float64Array(h*2); for(let i=0;i<pts.length;i+=2){ const y=Math.round(pts[i+1]*cs-pts[i]*sn+h); if(y>=0&&y<bins.length) bins[y]++; } let s=0; for(let i=0;i<bins.length;i++) s+=bins[i]*bins[i]; return s; };
    let best=0,bs=score(0);
    for(let a=-5;a<=5.001;a+=0.25){ const v=score(a); if(v>bs){bs=v;best=a;} }
    for(let a=best-0.25;a<=best+0.251;a+=0.05){ const v=score(a); if(v>bs){bs=v;best=a;} }
    return Math.round(best*100)/100;
  }
  function straighten(canvas,makeCanvas){
    const ang=skewAngle(canvas,makeCanvas);
    if(Math.abs(ang)<0.15) return {canvas,angle:0};
    const c=makeCanvas(canvas.width,canvas.height),x=c.getContext('2d');
    x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height);
    x.translate(c.width/2,c.height/2); x.rotate(-ang*Math.PI/180); x.drawImage(canvas,-canvas.width/2,-canvas.height/2);
    return {canvas:c,angle:ang};
  }
  // Enlarged, contrast-stretched close-up of one spot (for the tie-breaking read)
  function closeUp(canvas,r,makeCanvas,scale){
    const c=makeCanvas(Math.round(r.width*scale),Math.round(r.height*scale)),x=c.getContext('2d');
    x.imageSmoothingEnabled=true; x.imageSmoothingQuality='high';
    x.drawImage(canvas,r.left,r.top,r.width,r.height,0,0,c.width,c.height);
    const im=x.getImageData(0,0,c.width,c.height),d=im.data; let lo=255,hi=0;
    for(let i=0;i<d.length;i+=4){ const g=d[i]*.3+d[i+1]*.59+d[i+2]*.11; if(g<lo)lo=g; if(g>hi)hi=g; }
    const span=Math.max(1,hi-lo);
    for(let i=0;i<d.length;i+=4){ const g=(d[i]*.3+d[i+1]*.59+d[i+2]*.11-lo)*255/span; d[i]=d[i+1]=d[i+2]=g; }
    x.putImageData(im,0,0); return c;
  }

  // Box around the value that follows a header label (e.g. "Dock Door #: 015DR05"),
  // stopping at the next column so the right-hand label isn't included.
  function valueRect(lines,startRe,wordH,W,H){
    for(const l of lines){
      const ws=l.words||[]; const i=ws.findIndex(w=>startRe.test(w.text)); if(i<0) continue;
      let k=i; while(k<ws.length&&k<i+4&&!/[:#]/.test(ws[k].text)) k++;
      if(k>=ws.length) continue;
      const colonTail=ws[k].text.split(/[:#]/).pop();
      let j=colonTail&&/[A-Z0-9]/i.test(colonTail)?k:k+1;
      if(j>=ws.length) continue;
      const vals=[ws[j]];
      for(let m=j+1;m<ws.length;m++){ if(ws[m].bbox.x0-vals[vals.length-1].bbox.x1>wordH*1.6) break; vals.push(ws[m]); }
      const x0=Math.min(...vals.map(w=>w.bbox.x0)), x1=Math.max(...vals.map(w=>w.bbox.x1));
      const y0=Math.min(...vals.map(w=>w.bbox.y0)), y1=Math.max(...vals.map(w=>w.bbox.y1));
      if(y1-y0>wordH*2) continue;
      const px=wordH*0.4, py=wordH*0.3;
      const left=Math.max(0,Math.round(x0-px)), top=Math.max(0,Math.round(y0-py));
      return {left,top,width:Math.min(W-left,Math.round(x1-x0+2*px)),height:Math.min(H-top,Math.round(y1-y0+2*py))};
    }
    return null;
  }
  function tidyValue(t,key){
    let v=clean(t).replace(/^[^A-Z0-9]+/i,'').replace(/[^A-Z0-9.#)]+$/i,'');
    if(key==='bayLocation') v=v.replace(/[\s.]+$/,'').replace(/\s+/g,'');   // "015.0J2.0 . ." → "015.0J2.0"
    if(key==='dockDoor'){
      v=v.replace(/\s+/g,'').toUpperCase();
      // door codes look like 015DR05: digits · "DR" · digits
      const m=v.match(/^[O0]?([0-9OQIlSZB]{3})D[R8]([0-9OQIlSZBG]{1,3})$/i);
      if(m){ const d=x=>[...x].map(c=>DIGIT_FIX[c]||c).join(''); v=d(m[1])+'DR'+d(m[2]); }
    }
    return v;
  }

  // ------------------------------------------------------------ pipeline
  // worker: tesseract.js v5 worker. canvas: the rendered page.
  // env: {makeCanvas(w,h), toImage(canvas) → what worker.recognize accepts, progress(msg,frac)}
  async function extract(worker,srcCanvas,env){
    const say=env.progress||(()=>{}), toImg=env.toImage||(c=>c);
    say('Straightening the scan…',0.02);
    const {canvas,angle}=straighten(srcCanvas,env.makeCanvas);
    const W=canvas.width,H=canvas.height,image=toImg(canvas);

    say('Reading the whole sheet…',0.05);
    await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1',tessedit_char_whitelist:''});
    const page=await worker.recognize(image,{},{text:true,blocks:true});
    const lines=flattenLines(page.data);
    // Which kind of sheet? "ID-YYYYMMDDHHMMSS" tokens = Ardagh-style bill of lading.
    if(countIdDateTokens(lines)>=3) return extractIdDate(worker,canvas,image,lines,page,angle,env);
    const header=findHeader(lines);
    const rows=findRows(lines);
    rows.forEach(r=>{ r.reads={serial:[r.serialRaw],date:[r.dateRaw],time:[r.timeRaw]}; });
    say(`Found ${rows.length} pallet rows — reading each one again…`,0.4);

    const med=a=>{ const b=a.filter(x=>x!=null).sort((x,y)=>x-y); return b.length?b[Math.floor(b.length/2)]:null; };
    const col=k=>({x0:med(rows.map(r=>r.boxes[k]&&r.boxes[k].x0)),x1:med(rows.map(r=>r.boxes[k]&&r.boxes[k].x1))});
    const colSerial=col('serial'),colDate=col('date'),colTime=col('time');
    // Vertical extent comes from the words themselves, not the whole line —
    // lines beside the trailer diagram get stretched tall by the drawing.
    const wordH=med(rows.flatMap(r=>['serial','date','time'].map(k=>r.boxes[k]?r.boxes[k].y1-r.boxes[k].y0:null)))||40;
    const band=r=>{
      const ys=['serial','date','time'].map(k=>r.boxes[k]).filter(b=>b&&(b.y1-b.y0)<wordH*1.8);
      if(ys.length){ const c=med(ys.map(b=>(b.y0+b.y1)/2)); return {y0:c-wordH/2,y1:c+wordH/2}; }
      const c=(r.y0+r.y1)/2, lh=r.y1-r.y0;
      return lh<wordH*1.8?{y0:r.y0,y1:r.y1}:{y0:r.y0,y1:r.y0+wordH};   // stretched line: text sits at its top
    };
    const rect=(x0,x1,b)=>{ const h=b.y1-b.y0, px=Math.round(h*0.5), py=Math.round(h*0.3);
      const left=Math.max(0,Math.round(x0-px)), top=Math.max(0,Math.round(b.y0-py));
      return {left,top,width:Math.min(W-left,Math.round(x1-x0+2*px)),height:Math.min(H-top,Math.round(h+2*py))}; };
    rows.forEach(r=>{
      const b=band(r); r.band=b;
      const sb=r.boxes.serial&&(r.boxes.serial.y1-r.boxes.serial.y0)<wordH*1.8?r.boxes.serial:(colSerial.x0!=null?colSerial:null);
      r.rects={serial:sb?rect(sb.x0,sb.x1,b):null};
      const x0=(r.boxes.date&&r.boxes.date.x0)??colDate.x0, x1=(r.boxes.time&&r.boxes.time.x1)??colTime.x1;
      r.rects.dt=(x0!=null&&x1!=null)?rect(x0,Math.min(x1,(colTime.x1??x1)+wordH),b):null;
    });
    const SER='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', DT='0123456789/: ';
    const splitDT=t=>{ t=clean(t); const m=t.match(/([0-9\/]{6,10})\s+([0-9:]{6,10})/); return m?[m[1],m[2]]:[t.split(' ')[0]||'',t.split(' ').slice(1).join('')||'']; };

    // Pass 2 — every serial again, just that spot, letters+digits only
    await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:SER});
    for(let i=0;i<rows.length;i++){ const r=rows[i]; if(r.rects.serial){ const res=await worker.recognize(image,{rectangle:r.rects.serial}); r.reads.serial.push(clean(res.data.text).replace(/\s/g,'')); } say(`Second read of serials… ${i+1}/${rows.length}`,0.4+0.2*(i+1)/rows.length); }
    // Pass 3 — every date/time again, digits / : only
    await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:DT});
    for(let i=0;i<rows.length;i++){ const r=rows[i]; if(r.rects.dt){ const res=await worker.recognize(image,{rectangle:r.rects.dt}); const [d,t]=splitDT(res.data.text); r.reads.date.push(d); r.reads.time.push(t); } say(`Second read of dates and times… ${i+1}/${rows.length}`,0.6+0.15*(i+1)/rows.length); }

    // Pass 4 — tie-breaker: enlarged close-up only where the two reads didn't agree
    const first=assemble(rows,header);
    const needSer=[],needDT=[];
    first.records.forEach((rec,i)=>{
      const r=rows[i];
      if(rec.flags.some(f=>f.field==='serial'&&(f.level==='check'||f.level==='bad'))&&r.rects.serial) needSer.push(i);
      if(rec.flags.some(f=>(f.field==='date'||f.field==='time')&&(f.level==='check'||f.level==='bad'))&&r.rects.dt) needDT.push(i);
    });
    const total=needSer.length+needDT.length; let done=0;
    if(needSer.length){ await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:SER});
      for(const i of needSer){ const res=await worker.recognize(toImg(closeUp(canvas,rows[i].rects.serial,env.makeCanvas,2))); rows[i].reads.serial.push(clean(res.data.text).replace(/\s/g,'')); say(`Settling ${total} unclear spot${total===1?'':'s'}… ${++done}/${total}`,0.75+0.2*done/total); } }
    if(needDT.length){ await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:DT});
      for(const i of needDT){ const res=await worker.recognize(toImg(closeUp(canvas,rows[i].rects.dt,env.makeCanvas,2))); const [d,t]=splitDT(res.data.text); rows[i].reads.date.push(d); rows[i].reads.time.push(t); say(`Settling ${total} unclear spot${total===1?'':'s'}… ${++done}/${total}`,0.75+0.2*done/total); } }
    // Header values: close-up read of just the value next to each label
    await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:''});
    const HV=[['bayLocation',/^Bay/i],['dockDoor',/^Dock/i],['carrier',/^Carrier/i],['trailer',/^Trailer/i],['customer',/^Customer/i]];
    for(const [key,startRe] of HV){
      const r=valueRect(lines,startRe,wordH,W,H); if(!r) continue;
      const res=await worker.recognize(toImg(closeUp(canvas,r,env.makeCanvas,2.2)));
      const v=tidyValue(res.data.text,key);
      if(v) header[key]=v;
    }
    await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});

    const {records,template,itemMajor}=assemble(rows,header);
    if(!header.itemHeader) header.itemHeader=itemMajor;
    records.forEach((rec,i)=>{ rec.band=rows[i].band; });
    // left/right edges of the pallet table, for the per-row picture strips
    const tx0=med(rows.map(r=>r.palletX))??med(rows.map(r=>r.words0x))??med(rows.map(r=>r.line.bbox.x0));
    const tx1=(colTime.x1??med(rows.map(r=>r.boxes.time&&r.boxes.time.x1))??W*0.72)+wordH;
    // header strip: everything above the first pallet row
    const headerBottom=rows.length?Math.max(0,Math.min(...rows.map(r=>r.band.y0))-wordH*0.6):H*0.25;
    const checks=checkSheet(records,header);
    say('Done',1);
    return {format:'pas',header,records,template,checks,angle,canvas,table:{x0:Math.max(0,tx0-wordH*0.4),x1:Math.min(W,tx1)},headerBottom,wordH,rawText:page.data.text,lines};
  }


  // =================================================================
  // FORMAT 2 — Ardagh Glass style bill of lading
  // Pallets listed as  00201925716200369113-20260813185147
  //   = 20-digit pallet ID ("00" + GS1 SSCC-18, last digit is a check digit)
  //   - production date YYYYMMDD, time HHMMSS (only HH:MM is kept)
  // The GS1 check digit lets every read of an ID be verified by arithmetic.
  // =================================================================
  const digitsOnly=s=>String(s||'').toUpperCase().replace(/[OQDU]/g,'0').replace(/[IL|!\]\[]/g,'1').replace(/[S]/g,'5').replace(/[B]/g,'8').replace(/[Z]/g,'2').replace(/[G]/g,'6');
  function gs1Valid(d){ if(!/^\d{8,}$/.test(d)) return false; const n=[...d].map(Number), chk=n.pop(); const tot=n.reverse().reduce((t,v,i)=>t+v*(i%2===0?3:1),0); return (10-tot%10)%10===chk; }
  function palletIdOk(id){ return /^00\d{18}$/.test(id)&&gs1Valid(id.slice(2)); }
  // "id-datetime" out of any text (tolerates a lost/extra dash or spaces)
  function parseIdDate(txt){
    const t=digitsOnly(txt).replace(/[—–_~=]/g,'-').replace(/\s*-\s*/g,'-').replace(/\s+/g,'');
    // Split by structure first (20-digit ID with a good check digit, then a
    // date starting "20"), because a misread dash can land in the wrong spot.
    const d=t.replace(/[^0-9]/g,'');
    for(const k of [20,19,18,21,22,23]){
      if(d.length<k+14) continue;
      const id=d.slice(0,k), rest=d.slice(k);
      if(!/^20\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/.test(rest)) continue;
      if(!palletIdOk(fitId(id).value)) continue;
      return {id,dt:rest.slice(0,14)};
    }
    let m=t.match(/(\d{18,22})-(\d{12,16})/);
    if(!m){ if(d.length>=32&&d.length<=36) m=[0,d.slice(0,d.length-14),d.slice(-14)]; }
    if(!m) return null;
    return {id:m[1],dt:m[2]};
  }
  function idDateTokenRe(){ return /[0-9OQDIl|]{16,22}\s*[-—–_~=]?\s*[0-9OQDIl|]{12,16}/; }
  function countIdDateTokens(lines){ let n=0; lines.forEach(l=>{ const m=clean(l.text).match(new RegExp(idDateTokenRe().source,'g')); if(m) n+=m.length; }); return n; }
  function ymdToDate(ymd){ const m=String(ymd||'').match(/^(20\d\d)(\d\d)(\d\d)$/); if(!m) return ''; const mo=+m[2],da=+m[3]; if(mo<1||mo>12||da<1||da>31) return ''; return `${m[2]}/${m[3]}/${m[1].slice(2)}`; }
  function hmsToTime(hms){ const m=String(hms||'').match(/^(\d\d)(\d\d)(\d\d)$/); if(!m||!validTime(+m[1],+m[2],+m[3])) return ''; return `${m[1]}:${m[2]}`; }
  function splitDt(dt){ const d=String(dt||''); if(d.length===14) return {ymd:d.slice(0,8),hms:d.slice(8)}; if(d.length>14) return {ymd:d.slice(0,8),hms:d.slice(-6)}; return {ymd:d.slice(0,8),hms:d.slice(8)}; }
  // fit an ID read: must be 20 digits "00"+SSCC with a valid check digit
  function fitId(raw){
    let d=String(raw||'').replace(/\D/g,'');
    if(d.length===18) d='00'+d;                 // "00" dropped
    if(d.length===19&&d[0]==='0') d='0'+d;     // one leading zero dropped
    if(d.length===21&&d.startsWith('000')) d=d.slice(1);
    // one stray character stuck on either end ("1002019…" / "…3" + junk)
    if(d.length===21&&!palletIdOk(d)){ if(palletIdOk(d.slice(1))) d=d.slice(1); else if(palletIdOk(d.slice(0,20))) d=d.slice(0,20); }
    return {value:d,ok:palletIdOk(d)};
  }

  function findIdTokens(lines){
    const toks=[];
    lines.forEach(l=>{
      const ws=l.words||[];
      for(let i=0;i<ws.length;i++){
        // the token may be one word, or split in two where the dash was misread as a space
        for(const span of [1,2,3]){
          const grp=ws.slice(i,i+span); if(grp.length<span) break;
          const txt=grp.map(w=>w.text).join(' ');
          if(!idDateTokenRe().test(txt)) continue;
          const p=parseIdDate(txt); if(!p) continue;
          const bb={x0:Math.min(...grp.map(w=>w.bbox.x0)),x1:Math.max(...grp.map(w=>w.bbox.x1)),y0:Math.min(...grp.map(w=>w.bbox.y0)),y1:Math.max(...grp.map(w=>w.bbox.y1))};
          toks.push({raw:txt,id:p.id,dt:p.dt,bbox:bb});
          i+=span-1; break;
        }
      }
    });
    // reading order: top to bottom, then left to right within a printed row
    const h=toks.length?toks.map(t=>t.bbox.y1-t.bbox.y0).sort((a,b)=>a-b)[Math.floor(toks.length/2)]:30;
    toks.sort((a,b)=>Math.abs(a.bbox.y0-b.bbox.y0)>h*0.6?a.bbox.y0-b.bbox.y0:a.bbox.x0-b.bbox.x0);
    return {toks,wordH:h};
  }

  function findHeaderIdDate(lines){
    const text=lines.map(l=>l.text).join('\n');
    const pick=re=>{ const m=text.match(re); return m?clean(m[1]):''; };
    const h={};
    h.bol=pick(/BILL\s+OF\s+LADING\s+(\d{6,12})/i);
    h.shipment=pick(/Shipment\s*:?\s*(\d{5,12})/i);
    h.order=pick(/\bOrder\s*:\s*(\d{6,12})/i)||pick(/\bOrder\s+(\d{8,12})/i);
    const refLine=lines.find(l=>/BILL\s+OF\s+LADING/i.test(l.text));
    if(refLine){ const m=refLine.text.match(/^\D*?(\d[\d ]{3,8}\d)\s+BILL/i); if(m) h.ref=m[1].replace(/\s/g,''); }
    h.trailer=pick(/Trailer\s*No\.?\s*:?\s*([A-Z0-9-]+)/i);
    h.seal=pick(/Seal\s*:?\s*([A-Z0-9-]{4,})/i);
    h.carrier=pick(/Carrier\s*:?\s*(?:\d+\s+)?(.+?)(?:\s{2,}|\s+SCAC|\n|$)/i);
    h.scac=pick(/SCAC\s*:?\s*([A-Z]{2,4})\b/i);
    h.loading=pick(/Scheduled\s*Loading\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    h.perPallet=pick(/([\d,]+)\s*Bottles?\s*\/\s*PAL/i);
    const ex=text.match(/(\d{1,3})\s*PAL\s*[-\/]/i); h.expected=ex?+ex[1]:'';
    const mi=lines.findIndex(l=>/DESCRIPTION/i.test(l.text)&&/QUANTITY/i.test(l.text));
    if(mi>=0){
      const ml=lines.slice(mi+1,mi+4).find(l=>/^\s*\d{6,9}\b/.test(l.text));
      if(ml){ const m=clean(ml.text).match(/^(\d{6,9})\s+(.+?)(?:\s+[\d,]+\s*Bottles?.*)?$/i); if(m){ h.material=m[1]; h.description=clean(m[2]); } }
      const bl=lines.slice(mi+1,mi+6).find(l=>/PAL\s*-/i.test(l.text));
      if(bl){ const nums=clean(bl.text).split(' ').filter(x=>/^\d{4,6}$/.test(x)); h.batch=nums.length?nums[nums.length-1]:''; }
    }
    return h;
  }

  async function extractIdDate(worker,canvas,image,lines,page,angle,env){
    const say=env.progress||(()=>{}), toImg=env.toImage||(c=>c);
    const W=canvas.width,H=canvas.height;
    const header=findHeaderIdDate(lines);
    const {toks,wordH}=findIdTokens(lines);
    say(`Found ${toks.length} pallet IDs — reading each one again…`,0.4);
    const rectOf=b=>{ const px=Math.round(wordH*0.5),py=Math.round(wordH*0.35), left=Math.max(0,Math.round(b.x0-px)), top=Math.max(0,Math.round(b.y0-py));
      return {left,top,width:Math.min(W-left,Math.round(b.x1-b.x0+2*px)),height:Math.min(H-top,Math.round(b.y1-b.y0+2*py))}; };
    const rows=toks.map(t=>({tok:t,rect:rectOf(t.bbox),reads:[{id:t.id,dt:t.dt}]}));

    // Gap recovery: the IDs sit in a neat grid (columns × printed rows). Any
    // grid cell with no ID — or cells below the last row while we're short of
    // the sheet's pallet count — gets read on its own.
    const good=toks.filter(t=>palletIdOk(fitId(t.id).value));
    if(good.length>=3){
      const cl=(vals,tol)=>{ const g=[]; vals.slice().sort((a,b)=>a-b).forEach(v=>{ const last=g[g.length-1]; if(last&&v-last[last.length-1]<=tol) last.push(v); else g.push([v]); }); return g.map(a=>a[Math.floor(a.length/2)]); };
      const tokW=good.map(t=>t.bbox.x1-t.bbox.x0).sort((a,b)=>a-b)[Math.floor(good.length/2)];
      const colsX=cl(good.map(t=>t.bbox.x0),wordH*3);
      let rowsY=cl(good.map(t=>t.bbox.y0),wordH*0.6);
      const pitch=rowsY.length>1?rowsY.slice(1).map((y,i)=>y-rowsY[i]).sort((a,b)=>a-b)[Math.floor((rowsY.length-1)/2)]:wordH*1.3;
      // fill interior gaps in the row list (a whole printed row missed)
      const filled=[rowsY[0]]; for(let i=1;i<rowsY.length;i++){ let y=filled[filled.length-1]; while(rowsY[i]-y>pitch*1.5){ y+=pitch; filled.push(y); } filled.push(rowsY[i]); } rowsY=filled;
      const exp=+header.expected||0;
      const have=(cx,ry)=>toks.some(t=>Math.abs(t.bbox.x0-cx)<wordH*3&&Math.abs(t.bbox.y0-ry)<wordH*0.6);
      const cells=[];
      rowsY.forEach(ry=>colsX.forEach(cx=>{ if(!have(cx,ry)) cells.push({x0:cx,x1:cx+tokW,y0:ry,y1:ry+wordH}); }));
      if(exp&&toks.length<exp){ let ry=rowsY[rowsY.length-1]; for(let k=0;k<Math.ceil((exp-toks.length)/colsX.length)+1;k++){ ry+=pitch; colsX.forEach(cx=>cells.push({x0:cx,x1:cx+tokW,y0:ry,y1:ry+wordH})); } }
      if(cells.length){
        say(`Checking ${cells.length} gap${cells.length===1?'':'s'} in the list…`,0.38);
        await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789-'});
        for(const c of cells){
          if(c.y1>H) continue;
          const rect=rectOf(c);
          const res=await worker.recognize(image,{rectangle:rect});
          let pr=parseIdDate(res.data.text);
          if(!pr||!palletIdOk(fitId(pr.id).value)){ const r2=await worker.recognize(toImg(closeUp(canvas,rect,env.makeCanvas,2))); const p2=parseIdDate(r2.data.text); if(p2&&palletIdOk(fitId(p2.id).value)) pr=p2; }
          if(pr&&palletIdOk(fitId(pr.id).value)&&!rows.some(r=>fitId(r.reads[0].id).value===fitId(pr.id).value)){
            const t={raw:res.data.text,id:pr.id,dt:pr.dt,bbox:c,recovered:true};
            toks.push(t); rows.push({tok:t,rect,reads:[{id:pr.id,dt:pr.dt}]});
          }
        }
        rows.sort((a,b)=>Math.abs(a.tok.bbox.y0-b.tok.bbox.y0)>wordH*0.6?a.tok.bbox.y0-b.tok.bbox.y0:a.tok.bbox.x0-b.tok.bbox.x0);
      }
    }

    // Pass 2 — each token alone, digits and dash only
    await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789-'});
    for(let i=0;i<rows.length;i++){ const res=await worker.recognize(image,{rectangle:rows[i].rect}); const p=parseIdDate(res.data.text); rows[i].reads.push(p||{id:'',dt:''}); say(`Second read… ${i+1}/${rows.length}`,0.4+0.35*(i+1)/rows.length); }

    const decide=r=>{
      const ids=r.reads.map(x=>fitId(x.id));
      const parts=r.reads.map(x=>splitDt(x.dt));
      const cons=consensus(rows.map(q=>fitId(q.reads[0].id)).filter(f=>f.ok).map(f=>f.value));
      const iv=vote('id',ids.map(f=>({value:f.value,ok:f.ok})),v=>agree(v,cons),'Pallet ID');
      const dv=vote('date',parts.map(p=>{ const v=ymdToDate(p.ymd); return {value:v,ok:!!v}; }),()=>0,'Date');
      const tv=vote('time',parts.map(p=>{ const v=hmsToTime(p.hms); return {value:v,ok:!!v}; }),()=>0,'Time');
      return {iv,dv,tv};
    };
    // Pass 3 — enlarged close-up only where the reads didn't settle it
    // Third read — an enlarged close-up of EVERY row. These codes are long and
    // all digits, so two reads agreeing on one wrong digit is possible on a bad
    // copy; a third independent read makes that much less likely.
    const need=rows.map((r,i)=>i);
    if(need.length){
      for(let k=0;k<need.length;k++){ const r=rows[need[k]]; const res=await worker.recognize(toImg(closeUp(canvas,r.rect,env.makeCanvas,2))); const p=parseIdDate(res.data.text); r.reads.push(p||{id:'',dt:''}); say(`Third read (close-up)… ${k+1}/${need.length}`,0.75+0.2*(k+1)/need.length); }
    }
    await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});

    const loadDate=header.loading?normDate(header.loading):'';
    const records=rows.map((r,i)=>{
      const {iv,dv,tv}=decide(r), flags=[];
      if(iv.level) flags.push({field:'serial',level:iv.level,msg:iv.msg,alt:iv.alt});
      if(iv.value&&!palletIdOk(iv.value)) flags.push({field:'serial',level:'bad',msg:'Pallet ID fails its check digit — compare with the sheet'});
      if(dv.level) flags.push({field:'date',level:dv.level,msg:dv.msg,alt:dv.alt});
      if(dv.value&&loadDate){ const dd=dateDiffDays(loadDate,dv.value); if(dd!==null&&(dd<0||dd>180)) flags.push({field:'date',level:'check',msg:dd<0?'Date is after Scheduled Loading — check it':'Date is more than 6 months before loading — check it'}); }
      if(tv.level) flags.push({field:'time',level:tv.level,msg:tv.msg,alt:tv.alt});
      const b=r.tok.bbox;
      return {idx:i,pallet:String(i+1),palletInferred:false,item:header.material||'',serial:iv.value,serialFixes:[],date:dv.value,time:tv.value,flags,
        band:{y0:b.y0,y1:b.y1},crop:{x0:Math.max(0,b.x0-wordH*0.4),x1:Math.min(W,b.x1+wordH*0.4)}};
    });
    // Pallet IDs are numbered in production order, so date+time should rise
    // with the ID. A timestamp out of step with its neighbours gets flagged.
    const stamp=r=>{ const m=(r.date||'').match(/(\d\d)\/(\d\d)\/(\d\d)/), n=(r.time||'').match(/(\d\d):(\d\d)/); return m&&n?+(m[3]+m[1]+m[2]+n[1]+n[2]):null; };
    const byId=records.filter(r=>palletIdOk(r.serial)).slice().sort((a,b)=>a.serial<b.serial?-1:1);
    byId.forEach((r,i)=>{
      const me=stamp(r), prev=i>0?stamp(byId[i-1]):null, next=i<byId.length-1?stamp(byId[i+1]):null;
      if(me==null) return;
      const tooLate=next!=null&&me>next&&(prev==null||prev<=next);
      const tooEarly=prev!=null&&me<prev&&(next==null||prev<=next);
      if(tooLate||tooEarly) r.flags.push({field:'time',level:'check',msg:`Date/time is out of step with the pallet IDs just before and after it (${tooLate?'later than the next one':'earlier than the one before'}) — check it`});
    });

    const checks=[];
    const exp=+header.expected||0;
    checks.push(exp?(records.length===exp?{level:'ok',msg:`All ${exp} pallets found`}:{level:'bad',msg:`Sheet says ${exp} pallets — found ${records.length}`}):{level:'check',msg:'Pallet count on the sheet wasn\'t read'});
    const ser=records.map(r=>r.serial).filter(Boolean), dup=[...new Set(ser.filter((x,i,a)=>a.indexOf(x)!==i))];
    checks.push(dup.length?{level:'bad',msg:'Duplicate pallet ID: '+dup.join(', ')}:{level:'ok',msg:'No duplicate pallet IDs'});
    const badChk=records.filter(r=>r.serial&&!palletIdOk(r.serial)).length;
    checks.push(badChk?{level:'bad',msg:`${badChk} ID${badChk===1?'':'s'} fail the check digit`}:{level:'ok',msg:'Every pallet ID passes its check digit'});
    const needs=records.filter(r=>r.flags.some(f=>f.level==='bad'||f.level==='check')).length;
    checks.push(needs?{level:'check',msg:`${needs} row${needs===1?'':'s'} to double-check`}:{level:'ok',msg:'Every field confirmed by at least two reads'});
    const topY=toks.length?Math.min(...toks.map(t=>t.bbox.y0)):H*0.6;
    // header picture: the top of the sheet down to the pallet list
    say('Done',1);
    return {format:'iddate',header,records,template:{length:20,pattern:'99999999999999999999'},checks,angle,canvas,
      table:{x0:0,x1:W},headerBottom:Math.max(0,topY-wordH*0.6),wordH,rawText:page.data.text,lines};
  }

  const api={extract,palletIdOk,gs1Valid,parseIdDate,straighten,skewAngle,closeUp,flattenLines,findHeader,findRows,learnTemplate,applyTemplate,normDate,normTime,assemble,checkSheet,serialTokens,vote};
  if(typeof module!=='undefined'&&module.exports) module.exports=api; else root.LWHPasCore=api;
})(typeof window!=='undefined'?window:this);
