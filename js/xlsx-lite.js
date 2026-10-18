/* LWH Warehouse Toolkit — tiny .xlsx writer (v1.72.0)
   Builds a real Excel workbook in the browser with no library: bold black
   header row, frozen header, filter arrows on every column, sensible column
   widths, and numbers stored as numbers (so SUM / sort / pivot just work).
   Long IDs (customer pallet IDs, 20-digit tags) stay as text so Excel
   never turns them into 1.23E+19.

   Usage:
     LWHXlsx.download('lookup.xlsx', [
       { name:'Pallets', columns:[{label:'LWH ID',type:'n',width:12}, ...], rows:[[...], ...], totals:[...] }
     ]);
   type: 'n' = number, anything else = text.
*/
(function(){
  const enc=new TextEncoder();

  // ---- CRC32 + "stored" (uncompressed) ZIP — all an .xlsx needs ----
  const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
  function crc32(bytes){let c=0xFFFFFFFF;for(let i=0;i<bytes.length;i++)c=CRC_TABLE[(c^bytes[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}

  function zip(files){
    const now=new Date();
    const dosTime=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1);
    const dosDate=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
    const parts=[], central=[]; let offset=0;
    files.forEach(f=>{
      const name=enc.encode(f.name), data=enc.encode(f.data), crc=crc32(data);
      const h=new DataView(new ArrayBuffer(30));
      h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(6,0x0800,true); h.setUint16(8,0,true);
      h.setUint16(10,dosTime,true); h.setUint16(12,dosDate,true); h.setUint32(14,crc,true);
      h.setUint32(18,data.length,true); h.setUint32(22,data.length,true); h.setUint16(26,name.length,true); h.setUint16(28,0,true);
      parts.push(new Uint8Array(h.buffer),name,data);
      const c=new DataView(new ArrayBuffer(46));
      c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x0800,true); c.setUint16(10,0,true);
      c.setUint16(12,dosTime,true); c.setUint16(14,dosDate,true); c.setUint32(16,crc,true);
      c.setUint32(20,data.length,true); c.setUint32(24,data.length,true); c.setUint16(28,name.length,true);
      c.setUint16(30,0,true); c.setUint16(32,0,true); c.setUint16(34,0,true); c.setUint16(36,0,true); c.setUint32(38,0,true); c.setUint32(42,offset,true);
      central.push(new Uint8Array(c.buffer),name);
      offset+=30+name.length+data.length;
    });
    const cdSize=central.reduce((s,p)=>s+p.length,0);
    const e=new DataView(new ArrayBuffer(22));
    e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true);
    e.setUint32(12,cdSize,true); e.setUint32(16,offset,true);
    return new Blob([...parts,...central,new Uint8Array(e.buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }

  // ---- Workbook XML ----
  function x(s){ return String(s??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
  function colName(i){ let s=''; i++; while(i>0){ const m=(i-1)%26; s=String.fromCharCode(65+m)+s; i=Math.floor((i-1)/26); } return s; }
  function sheetName(n,used){ let s=String(n||'Sheet').replace(/[\[\]:*?\/\\]/g,' ').slice(0,31)||'Sheet'; let base=s,k=2; while(used.has(s.toLowerCase())){ s=(base.slice(0,28)+' '+k++); } used.add(s.toLowerCase()); return s; }
  function asNumber(v){
    if(v===null||v===undefined||v==='') return null;
    if(typeof v==='number') return isFinite(v)?v:null;
    const s=String(v).trim().replace(/,/g,'');
    if(!/^-?\d+(\.\d+)?$/.test(s)) return null;
    if(s.replace(/[-.]/g,'').length>15) return null;   // keep long IDs as text
    return Number(s);
  }
  // Style ids: 0 normal, 1 header (bold white on black), 2 number #,##0, 3 total label, 4 total number
  function cell(ref,v,type,style){
    if(type==='n'){
      const n=asNumber(v);
      if(n!==null) return `<c r="${ref}" s="${style===3?4:2}"><v>${n}</v></c>`;
    }
    if(v===null||v===undefined||v==='') return style?`<c r="${ref}" s="${style}"/>`:'';
    return `<c r="${ref}" t="inlineStr"${style?` s="${style}"`:''}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
  }
  function sheetXml(sh){
    const cols=sh.columns, last=colName(Math.max(cols.length-1,0));
    const rows=[];
    rows.push(`<row r="1">${cols.map((c,i)=>cell(colName(i)+'1',c.label,'s',1)).join('')}</row>`);
    (sh.rows||[]).forEach((r,ri)=>{
      const rn=ri+2;
      rows.push(`<row r="${rn}">${cols.map((c,i)=>cell(colName(i)+rn,r[i],c.type,0)).join('')}</row>`);
    });
    const dataLast=(sh.rows||[]).length+1;
    if(sh.totals){
      const rn=dataLast+2; // one blank row so the filter range stays clean
      rows.push(`<row r="${rn}">${cols.map((c,i)=>cell(colName(i)+rn,sh.totals[i],c.type,3)).join('')}</row>`);
    }
    const widths=cols.map((c,i)=>{
      if(c.width) return c.width;
      let w=String(c.label).length;
      (sh.rows||[]).slice(0,400).forEach(r=>{ const l=String(r[i]??'').length; if(l>w) w=l; });
      return Math.min(Math.max(w+2,8),48);
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
      '<sheetFormatPr defaultRowHeight="15"/>'+
      `<cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols>`+
      `<sheetData>${rows.join('')}</sheetData>`+
      (cols.length?`<autoFilter ref="A1:${last}${Math.max(dataLast,1)}"/>`:'')+
      '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'+
      '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>'+
      '</worksheet>';
  }
  const STYLES='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>'+
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'+
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF161616"/><bgColor indexed="64"/></patternFill></fill></fills>'+
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF000000"/></top><bottom style="double"><color rgb="FF000000"/></bottom><diagonal/></border></borders>'+
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
    '<cellXfs count="5">'+
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'+
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'+
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>'+
      '<xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>'+
    '</cellXfs>'+
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'+
    '</styleSheet>';

  function build(sheets){
    const used=new Set();
    const named=sheets.map(s=>Object.assign({},s,{name:sheetName(s.name,used)}));
    const files=[
      {name:'[Content_Types].xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+named.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>'},
      {name:'_rels/.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {name:'xl/workbook.xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+named.map((s,i)=>`<sheet name="${x(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets>'+
        '<definedNames>'+named.map((s,i)=>`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${x(s.name).replace(/'/g,"''")}'!$A$1:$${colName(Math.max(s.columns.length-1,0))}$${Math.max((s.rows||[]).length+1,1)}</definedName>`).join('')+'</definedNames></workbook>'},
      {name:'xl/_rels/workbook.xml.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+named.map((s,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="rId${named.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
      {name:'xl/styles.xml',data:STYLES}
    ];
    named.forEach((s,i)=>files.push({name:`xl/worksheets/sheet${i+1}.xml`,data:sheetXml(s)}));
    return zip(files);
  }

  function download(filename,sheets){
    const blob=build(sheets);
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=/\.xlsx$/i.test(filename)?filename:filename+'.xlsx';
    document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  }

  window.LWHXlsx={build,download};
})();
