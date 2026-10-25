/* LWH Warehouse Toolkit — Formula Builder (v1.75.0)
   Fill-in-the-blank builder for the Excel formulas people ask for help with
   most: XLOOKUP, VLOOKUP, IF / IFS, and SUMIFS / COUNTIFS / AVERAGEIFS, plus a
   "Fix an Error" cheat sheet. Everything runs in the browser — nothing typed
   here leaves the device. Formulas work the same in Excel and Google Sheets.
   The whole screen is built by this file into <section id="formulas">. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const RECENT_KEY = 'lwh_fbRecent';
  const TAB_KEY = 'lwh_fbTab';
  const PH_L = '‹', PH_R = '›'; // ‹ › mark a blank the person still needs to fill

  /* ---------------- reading what people type ---------------- */
  function colNum(c) { c = String(c).replace(/\$/g, '').toUpperCase(); let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
  function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function sheetPrefix(name) {
    name = String(name || '').trim().replace(/!$/, '');
    if (!name) return '';
    if (/^'.*'$/.test(name)) return name + '!';
    return (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : "'" + name.replace(/'/g, "''") + "'") + '!';
  }
  function onSheet(name) { name = String(name || '').trim().replace(/^'(.*)'$/, '$1'); return name ? ` on the <b>${esc(name)}</b> sheet` : ''; }

  // A column / range: "B", "B:E", "B-E", "B2:B500", "Inventory!B", or a named range / table column.
  function parseRange(raw, defSheet, lock) {
    let s = String(raw || '').trim().replace(/^=/, '');
    if (!s) return { empty: true };
    let sheet = String(defSheet || '').trim();
    const bang = s.lastIndexOf('!');
    if (bang > 0) { sheet = s.slice(0, bang).replace(/^'(.*)'$/, '$1').replace(/''/g, "'"); s = s.slice(bang + 1); }
    const ref = s.replace(/\$/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
    const pre = sheetPrefix(sheet);
    const L = lock ? '$' : '';
    const okCol = c => colNum(c) <= 16384;
    let m;
    if ((m = ref.match(/^([A-Z]{1,3})$/)) && okCol(m[1])) return mk(m[1], m[1], null, null);
    if ((m = ref.match(/^([A-Z]{1,3}) ?(?::|-|TO|THRU|THROUGH) ?([A-Z]{1,3})$/)) && okCol(m[1]) && okCol(m[2])) return mk(m[1], m[2], null, null);
    if ((m = ref.match(/^([A-Z]{1,3})(\d+) ?(?::|-|TO) ?([A-Z]{1,3})(\d+)$/)) && okCol(m[1]) && okCol(m[3])) return mk(m[1], m[3], +m[2], +m[4]);
    if ((m = ref.match(/^([A-Z]{1,3})(\d+) ?: ?([A-Z]{1,3})$/))) return { error: `“${raw}” has no end row — Excel needs one. Use just <b>${m[1]}</b> for the whole column, or something like <b>${m[1]}${m[2]}:${m[3]}5000</b>.` };
    if ((m = ref.match(/^([A-Z]{1,3})(\d+)$/))) return { error: `“${raw}” is a single cell. For a whole column type just the letter (<b>${m[1]}</b>), or a range like <b>${m[1]}${m[2]}:${m[1]}500</b>.` };
    const name = s.trim();
    if (/^[A-Za-z_][A-Za-z0-9_.]*(\[[^\]]*\])?$/.test(name)) return { text: pre + name, named: true, sheet, base: `<b>${esc(name)}</b>`, desc: `<b>${esc(name)}</b>${onSheet(sheet)}` };
    return { error: `Couldn't read “${esc(raw)}”. Type a column letter like <b>B</b>, or a range like <b>B2:B500</b>.` };

    function mk(c1, c2, r1, r2) {
      if (colNum(c1) > colNum(c2)) [c1, c2] = [c2, c1];
      if (r1 != null && r1 > r2) [r1, r2] = [r2, r1];
      const text = r1 == null ? `${pre}${L}${c1}:${L}${c2}` : `${pre}${L}${c1}${L}${r1}:${L}${c2}${L}${r2}`;
      let what;
      if (r1 == null) what = c1 === c2 ? `column <b>${c1}</b>` : `columns <b>${c1}–${c2}</b>`;
      else what = c1 === c2 ? `column <b>${c1}</b> (rows ${r1}–${r2})` : `<b>${c1}${r1}:${c2}${r2}</b>`;
      return { text, c1: colNum(c1), c2: colNum(c2), r1, r2, width: colNum(c2) - colNum(c1) + 1, sheet, pre, lock, base: what, desc: what + onSheet(sheet) };
    }
  }

  // A single value: a cell (A2), a number, a date, text, blank, TODAY, or "=anything".
  function parseValue(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return { empty: true };
    if (/^\(?blank\)?$/i.test(s) || s === '""') return { expr: '""', kind: 'blank', desc: 'blank' };
    if (s.length >= 2 && /^".*"$/.test(s)) return text(s.slice(1, -1).replace(/""/g, '"'));
    if (s.startsWith('=')) {
      const f = s.slice(1).trim();
      let d = `the result of <code>${esc(f)}</code>`;
      let mm;
      if (/^TODAY\(\)$/i.test(f)) d = "today's date";
      else if ((mm = f.match(/^TODAY\(\)\s*-\s*(\d+)$/i))) d = `${mm[1]} days ago`;
      else if ((mm = f.match(/^TODAY\(\)\s*\+\s*(\d+)$/i))) d = `${mm[1]} days from today`;
      return { expr: f, kind: 'formula', desc: d };
    }
    if (/^today$/i.test(s)) return { expr: 'TODAY()', kind: 'formula', desc: "today's date" };
    if (/^(true|false)$/i.test(s)) return { expr: s.toUpperCase(), kind: 'bool', desc: s.toUpperCase() };
    // Cell reference. Only columns A–AZ count as a cell, so bay names like VB220 or XLF019 stay text.
    let m = s.match(/^(?:('?)([^!]+)\1!)?(\$?)([A-Za-z]{1,2})(\$?)(\d{1,7})$/);
    if (m && colNum(m[4]) <= 52 && +m[6] >= 1 && +m[6] <= 1048576) {
      const ref = `${m[3]}${m[4].toUpperCase()}${m[5]}${m[6]}`;
      return { expr: (m[2] ? sheetPrefix(m[2]) : '') + ref, kind: 'cell', ref, desc: `the value in <b>${ref.replace(/\$/g, '')}</b>${m[2] ? onSheet(m[2]) : ''}` };
    }
    const num = s.replace(/,/g, '');
    if (/^-?(\d+\.?\d*|\.\d+)%?$/.test(num) && !/^-?0\d/.test(num)) return { expr: num, kind: 'number', lit: num, desc: `<b>${esc(s)}</b>` };
    m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
    if (m) {
      let y = +m[3]; if (y < 100) y += 2000;
      if (+m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) return { expr: `DATE(${y},${+m[1]},${+m[2]})`, kind: 'date', desc: `<b>${+m[1]}/${+m[2]}/${y}</b>` };
    }
    return text(s);
    function text(t) { return { expr: '"' + t.replace(/"/g, '""') + '"', kind: 'text', lit: t, desc: `<b>“${esc(t)}”</b>` }; }
  }

  const q = t => '"' + String(t).replace(/"/g, '""') + '"';
  const ph = label => PH_L + label + PH_R;

  /* ---------------- operators (shared by IF and SUMIFS) ---------------- */
  const OPS = [
    ['eq', 'equals'], ['ne', 'is not'], ['gt', 'is more than'], ['ge', 'is at least (≥)'], ['lt', 'is less than'], ['le', 'is at most (≤)'],
    ['between', 'is between'], ['contains', 'contains'], ['begins', 'starts with'], ['ends', 'ends with'], ['blank', 'is blank'], ['notblank', 'is not blank']
  ];
  const SYM = { gt: '>', ge: '>=', lt: '<', le: '<=' };
  const NO_VALUE = { blank: 1, notblank: 1 };
  function opWords(op, v, v2) {
    const date = v && (v.kind === 'date' || (v.kind === 'formula' && /TODAY/i.test(v.expr)));
    const D = v ? v.desc : '…', D2 = v2 ? v2.desc : '…';
    switch (op) {
      case 'eq': return `equals ${D}`;
      case 'ne': return `is not ${D}`;
      case 'gt': return date ? `is after ${D}` : `is more than ${D}`;
      case 'ge': return date ? `is on or after ${D}` : `is at least ${D}`;
      case 'lt': return date ? `is before ${D}` : `is less than ${D}`;
      case 'le': return date ? `is on or before ${D}` : `is at most ${D}`;
      case 'between': return `is between ${D} and ${D2}`;
      case 'contains': return `contains ${D}`;
      case 'begins': return `starts with ${D}`;
      case 'ends': return `ends with ${D}`;
      case 'blank': return 'is blank';
      case 'notblank': return 'is not blank';
    }
    return '';
  }
  const opOptions = sel => OPS.map(([k, l]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${l}</option>`).join('');

  // SUMIFS-style criteria → array of criteria arguments
  function criteria(op, v, v2) {
    const lit = v && (v.kind === 'text' || v.kind === 'number');
    switch (op) {
      case 'eq': return [v.expr];
      case 'ne': return [lit ? q('<>' + v.lit) : '"<>"&' + v.expr];
      case 'gt': case 'ge': case 'lt': case 'le': return [lit ? q(SYM[op] + v.lit) : q(SYM[op]) + '&' + v.expr];
      case 'contains': return [lit ? q('*' + v.lit + '*') : '"*"&' + v.expr + '&"*"'];
      case 'begins': return [lit ? q(v.lit + '*') : v.expr + '&"*"'];
      case 'ends': return [lit ? q('*' + v.lit) : '"*"&' + v.expr];
      case 'blank': return ['""'];
      case 'notblank': return ['"<>"'];
      case 'between': return [criteria('ge', v)[0], criteria('le', v2)[0]];
    }
    return [];
  }
  // IF-style condition → one logical test
  function condition(c, op, v, v2) {
    switch (op) {
      case 'eq': return `${c}=${v.expr}`;
      case 'ne': return `${c}<>${v.expr}`;
      case 'gt': case 'ge': case 'lt': case 'le': return `${c}${SYM[op]}${v.expr}`;
      case 'between': return `AND(${c}>=${v.expr},${c}<=${v2.expr})`;
      case 'contains': return `ISNUMBER(SEARCH(${v.expr},${c}))`;
      case 'begins': return v.kind === 'text' ? `LEFT(${c},${v.lit.length})=${v.expr}` : `LEFT(${c},LEN(${v.expr}))=${v.expr}`;
      case 'ends': return v.kind === 'text' ? `RIGHT(${c},${v.lit.length})=${v.expr}` : `RIGHT(${c},LEN(${v.expr}))=${v.expr}`;
      case 'blank': return `${c}=""`;
      case 'notblank': return `${c}<>""`;
    }
    return '';
  }

  // Ranges inside one formula must cover the same rows (XLOOKUP / SUMIFS give #VALUE! otherwise).
  function sameRows(list) {
    const real = list.filter(r => r && r.c1);
    if (real.length < 2) return true;
    const key = r => r.r1 == null ? 'full' : `${r.r1}-${r.r2}`;
    return real.every(r => key(r) === key(real[0]));
  }
  // When every range is on the same other sheet, say the sheet once at the end instead of after every column.
  function sheetOnce(list) {
    const real = list.filter(r => r && (r.c1 || r.named));
    const names = [...new Set(real.map(r => String(r.sheet || '').trim()))];
    if (real.length > 1 && names.length === 1 && names[0]) { real.forEach(r => { r.desc = r.base; }); return ` (All of these are on the <b>${esc(names[0].replace(/^'(.*)'$/, '$1'))}</b> sheet.)`; }
    return '';
  }
  const fieldVal = id => { const el = $(id); return el ? el.value : ''; };
  const checked = id => { const el = $(id); return !!(el && el.checked); };

  /* ---------------- the four builders ---------------- */
  function buildXlookup() {
    const out = { missing: false, warn: [], err: [] };
    const lock = checked('fbXlLock'), sheet = fieldVal('fbXlSheet');
    const v = parseValue(fieldVal('fbXlValue'));
    const sr = parseRange(fieldVal('fbXlSearch'), sheet, lock);
    const rr = parseRange(fieldVal('fbXlReturn'), sheet, lock);
    const nfRaw = fieldVal('fbXlNotFound');
    const nf = parseValue(nfRaw);
    const match = fieldVal('fbXlMatch');
    const last = checked('fbXlLast');
    [sr, rr].forEach(r => r.error && out.err.push(r.error));

    let lv = v.empty ? (out.missing = true, ph('what to find')) : v.expr;
    if (match === 'contains' && !v.empty) lv = v.kind === 'text' ? q('*' + v.lit + '*') : '"*"&' + v.expr + '&"*"';
    const args = [lv, sr.empty ? (out.missing = true, ph('search column')) : (sr.text || ph('search column')), rr.empty ? (out.missing = true, ph('answer column')) : (rr.text || ph('answer column'))];
    const mm = { exact: 0, contains: 2, smaller: -1, larger: 1 }[match] || 0;
    const tail = [nf.empty ? '' : nf.expr, mm ? String(mm) : '', last ? '-1' : ''];
    while (tail.length && tail[tail.length - 1] === '') tail.pop();
    out.formula = `=XLOOKUP(${args.concat(tail).join(',')})`;

    if (sr.c1 && sr.width > 1) out.err.push('The search column should be <b>one</b> column (like B), not several.');
    if (sr.c1 && rr.c1 && !sameRows([sr, rr])) out.err.push('The search column and answer column must cover the <b>same rows</b> (for example both B2:B500 and E2:E500, or both full columns). Otherwise Excel shows #VALUE!.');
    if (rr.c1 && rr.width > 1) out.warn.push(`This brings back ${rr.width} columns side by side, so the cells to the right need to be empty or you'll get #SPILL!.`);

    const xlSheet = sheetOnce([sr, rr]);
    const find = v.empty ? '…' : (match === 'contains' ? `anything containing ${v.desc}` : v.desc);
    let e = `Look for ${find} in ${sr.desc || '…'}, and bring back what's in ${rr.desc || '…'} on the same row.`;
    if (match === 'smaller') e += ' If there is no exact match, use the next <b>smaller</b> value.';
    if (match === 'larger') e += ' If there is no exact match, use the next <b>larger</b> value.';
    if (last) e += ' If it shows up more than once, use the <b>last</b> one in the list.';
    e += nf.empty ? ' If nothing matches, it shows <b>#N/A</b>.' : ` If nothing matches, show ${nf.desc === 'blank' ? 'a blank cell' : nf.desc}.`;
    out.english = e + xlSheet;
    out.note = 'XLOOKUP needs Excel 2021 or Microsoft 365 (it works in Google Sheets too). If his Excel shows #NAME?, use the VLOOKUP tab instead.';
    return out;
  }

  function buildVlookup() {
    const out = { missing: false, warn: [], err: [] };
    const lock = checked('fbVlLock'), sheet = fieldVal('fbVlSheet');
    const v = parseValue(fieldVal('fbVlValue'));
    const tr = parseRange(fieldVal('fbVlTable'), sheet, lock);
    const retRaw = fieldVal('fbVlReturn').trim().replace(/\$/g, '');
    const nf = parseValue(fieldVal('fbVlNotFound'));
    const approx = checked('fbVlApprox');
    if (tr.error) out.err.push(tr.error);

    let idx = null, retCol = null;
    if (retRaw) {
      if (/^\d+$/.test(retRaw)) {
        idx = +retRaw;
        if (tr.c1) retCol = tr.c1 + idx - 1;
      } else if (/^[A-Za-z]{1,3}$/.test(retRaw)) {
        retCol = colNum(retRaw);
        if (tr.c1) idx = retCol - tr.c1 + 1;
        else if (tr.named) out.err.push('With a named range, type the column <b>number</b> (1 = first column of the table).');
      } else out.err.push(`Couldn't read “${esc(retRaw)}”. Type a column letter (E) or a number (4).`);
    }
    if (tr.c1 && idx != null) {
      if (idx < 1) out.err.push(`Column ${colName(retCol)} is to the <b>left</b> of the table. VLOOKUP can only bring back columns to the right of the search column — start the table further left, or use XLOOKUP.`);
      else if (idx > tr.width) out.err.push(`Column ${colName(retCol)} is outside the table (${colName(tr.c1)} to ${colName(tr.c2)}). Widen the table so it reaches column ${colName(retCol)}, or Excel shows #REF!.`);
      else if (idx === 1) out.warn.push('That brings back the search column itself — usually you want a column to the right of it.');
    }
    const lv = v.empty ? (out.missing = true, ph('what to find')) : v.expr;
    const tbl = tr.empty ? (out.missing = true, ph('table')) : (tr.text || ph('table'));
    const ix = idx != null && idx >= 1 ? String(idx) : (out.missing = true, ph('column #'));
    let f = `VLOOKUP(${lv},${tbl},${ix},${approx ? 'TRUE' : 'FALSE'})`;
    if (!nf.empty) f = `IFERROR(${f},${nf.expr})`;
    out.formula = '=' + f;

    let e = tr.c1 ? `Look for ${v.empty ? '…' : v.desc} in column <b>${colName(tr.c1)}</b> — the first column of the table (${tr.desc})` : `Look for ${v.empty ? '…' : v.desc} in the first column of ${tr.desc || '…'}`;
    e += idx != null && idx >= 1 ? `, and bring back what's in ${retCol ? `column <b>${colName(retCol)}</b> (the ${ordinal(idx)} column of the table)` : `the ${ordinal(idx)} column of the table`}.` : ', and bring back …';
    e += approx ? ' Uses an <b>approximate</b> match — the first column must be sorted smallest to largest.' : ' Exact matches only.';
    e += nf.empty ? ' If nothing matches, it shows <b>#N/A</b>.' : ` If nothing matches, show ${nf.desc === 'blank' ? 'a blank cell' : nf.desc}.`;
    out.english = e;
    if (approx) out.warn.push('Approximate match is only for bracket tables (rates, weight breaks) sorted smallest to largest. For item numbers, IDs and names leave it off.');

    // Same answer with XLOOKUP, for anyone on Excel 365
    if (tr.c1 && idx >= 1 && idx <= tr.width && !v.empty && !approx) {
      const L = tr.lock ? '$' : '';
      const col = c => tr.r1 == null ? `${tr.pre}${L}${c}:${L}${c}` : `${tr.pre}${L}${c}${L}${tr.r1}:${L}${c}${L}${tr.r2}`;
      out.alt = { label: 'Same thing with XLOOKUP (Excel 365 / 2021):', formula: `=XLOOKUP(${v.expr},${col(colName(tr.c1))},${col(colName(retCol))}${nf.empty ? '' : ',' + nf.expr})` };
    }
    return out;
  }

  function buildIf() {
    const out = { missing: false, warn: [], err: [] };
    const mode = fieldVal('fbIfMode');
    const useIfs = checked('fbIfIfs');
    const rows = [...document.querySelectorAll('#fbIfRows .fb-row')].map(r => ({
      cell: r.querySelector('.fb-cell').value, op: r.querySelector('.fb-op').value,
      v: r.querySelector('.fb-v').value, v2: r.querySelector('.fb-v2').value, res: r.querySelector('.fb-res').value
    }));
    const yes = parseValue(fieldVal('fbIfYes'));
    const elseRaw = fieldVal('fbIfElse');
    const els = elseRaw.trim() ? parseValue(elseRaw) : { expr: '""', kind: 'blank', desc: 'blank' };
    const tests = [], words = [];
    rows.forEach((r, i) => {
      const c = parseValue(r.cell);
      let cExpr, cDesc;
      if (c.empty) { out.missing = true; cExpr = ph('cell'); cDesc = '…'; }
      else if (c.kind === 'cell' || c.kind === 'formula') { cExpr = c.expr; cDesc = c.kind === 'cell' ? `<b>${esc(c.ref.replace(/\$/g, ''))}</b>` : c.desc; }
      else { out.err.push(`Check ${i + 1}: “${esc(r.cell)}” isn't a cell. Type the cell to check, like <b>D2</b>.`); cExpr = ph('cell'); cDesc = '…'; }
      let v = null, v2 = null;
      if (!NO_VALUE[r.op]) {
        v = parseValue(r.v);
        if (v.empty) { out.missing = true; v = { expr: ph('value'), kind: 'ph', desc: '…' }; }
        if (r.op === 'between') { v2 = parseValue(r.v2); if (v2.empty) { out.missing = true; v2 = { expr: ph('value'), kind: 'ph', desc: '…' }; } }
      }
      const res = r.res.trim() ? parseValue(r.res) : { expr: '""', kind: 'blank', desc: 'blank' };
      tests.push({ t: condition(cExpr, r.op, v, v2), res });
      words.push({ w: `${cDesc} ${opWords(r.op, v, v2)}`, res });
    });
    const show = r => r.desc === 'blank' ? 'leave it blank' : `show ${r.desc}`;
    let f;
    if (mode === 'first') {
      if (tests.length === 1) f = `IF(${tests[0].t},${tests[0].res.expr},${els.expr})`;
      else if (useIfs) f = `IFS(${tests.map(x => `${x.t},${x.res.expr}`).join(',')},TRUE,${els.expr})`;
      else f = tests.reduceRight((acc, x) => `IF(${x.t},${x.res.expr},${acc})`, els.expr);
      out.english = words.map((x, i) => `${i ? 'Otherwise, if' : 'If'} ${x.w}, ${show(x.res)}.`).join(' ') + ` Otherwise, ${show(els)}.`;
      if (tests.length > 1) out.english += ' Checks run top to bottom and stop at the first one that is true — so put the strictest check first.';
    } else {
      const yesR = yes.empty ? (out.missing = true, { expr: ph('result'), desc: '…' }) : yes;
      const joined = tests.length === 1 ? tests[0].t : `${mode === 'all' ? 'AND' : 'OR'}(${tests.map(x => x.t).join(',')})`;
      f = `IF(${joined},${yesR.expr},${els.expr})`;
      const glue = mode === 'all' ? ' <b>and</b> ' : ' <b>or</b> ';
      out.english = `If ${words.map(x => x.w).join(glue)}, ${show(yesR)}. Otherwise, ${show(els)}.`;
    }
    out.formula = '=' + f;
    if (mode === 'first' && tests.length > 1 && useIfs) out.note = 'IFS needs Excel 2019 or newer. If his Excel shows #NAME?, untick “Use IFS” to get the same thing built from plain IFs.';
    if ((f.match(/\bIF\(/g) || []).length > 7) out.warn.push('That is a lot of checks. If it is really a list of codes → results, a lookup table with XLOOKUP is easier to keep up to date.');
    return out;
  }

  function buildSumifs() {
    const out = { missing: false, warn: [], err: [] };
    const what = fieldVal('fbSuWhat');
    const lock = checked('fbSuLock'), sheet = fieldVal('fbSuSheet');
    const sr = what === 'count' ? { skip: true } : parseRange(fieldVal('fbSuRange'), sheet, lock);
    if (sr.error) out.err.push(sr.error);
    const ranges = [sr];
    const rows = [...document.querySelectorAll('#fbSuRows .fb-row')].map(r => ({
      col: r.querySelector('.fb-cell').value, op: r.querySelector('.fb-op').value, v: r.querySelector('.fb-v').value, v2: r.querySelector('.fb-v2').value
    }));
    const pairs = [], words = [];
    const parsed = rows.map(r => parseRange(r.col, sheet, lock));
    const suSheet = sheetOnce([sr].concat(parsed));
    rows.forEach((r, i) => {
      const cr = parsed[i];
      if (cr.error) out.err.push(`Condition ${i + 1}: ${cr.error}`);
      if (cr.c1 && cr.width > 1) out.err.push(`Condition ${i + 1}: check <b>one</b> column at a time.`);
      ranges.push(cr);
      const rt = cr.empty ? (out.missing = true, ph('column')) : (cr.text || ph('column'));
      let v = null, v2 = null;
      if (!NO_VALUE[r.op]) {
        v = parseValue(r.v);
        if (v.empty) { out.missing = true; v = { expr: ph('value'), kind: 'ph', desc: '…' }; }
        if (r.op === 'between') { v2 = parseValue(r.v2); if (v2.empty) { out.missing = true; v2 = { expr: ph('value'), kind: 'ph', desc: '…' }; } }
      }
      criteria(r.op, v, v2).forEach(c => pairs.push(rt, c));
      words.push(`${cr.desc || '…'} ${opWords(r.op, v, v2)}`);
    });
    const fn = { sum: 'SUMIFS', count: 'COUNTIFS', avg: 'AVERAGEIFS' }[what];
    if (what === 'count') out.formula = `=${fn}(${pairs.join(',')})`;
    else out.formula = `=${fn}(${[sr.empty ? (out.missing = true, ph('column to add')) : (sr.text || ph('column to add'))].concat(pairs).join(',')})`;
    if (!sameRows(ranges)) out.err.push('Every column in this formula must cover the <b>same rows</b> (all full columns, or all rows 2–500, for example). Otherwise Excel shows #VALUE!.');
    if (sr.c1 && sr.width > 1) out.err.push('Add up <b>one</b> column at a time (like D), not several.');
    const lead = { sum: `Add up ${sr.desc || '…'}`, count: 'Count the rows', avg: `Average ${sr.desc || '…'}` }[what];
    out.english = `${lead}, but only rows where ${words.join(' <b>and</b> ')}.` + suSheet;
    if (words.length > 1) out.english += ' Every condition has to be true for a row to count.';
    if (what === 'avg') out.warn.push('If no rows match, AVERAGEIFS shows #DIV/0!. Wrap it in IFERROR( … ,0) if you would rather see 0.');
    return out;
  }

  function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  /* ---------------- examples ---------------- */
  const SAMPLE = `<div class="fb-sample-wrap"><table class="fb-sample"><caption>Sheet: <b>Inventory</b> (one row per pallet)</caption>
    <thead><tr><th></th><th>A</th><th>B</th><th>C</th><th>D</th><th>E</th><th>F</th></tr></thead>
    <tbody>
    <tr><th>1</th><td><b>LWH ID</b></td><td><b>Item #</b></td><td><b>Customer</b></td><td><b>Qty</b></td><td><b>Bay</b></td><td><b>Received</b></td></tr>
    <tr><th>2</th><td>100245</td><td>869731</td><td>ACME</td><td>480</td><td>VB220</td><td>10/02/2026</td></tr>
    <tr><th>3</th><td>100246</td><td>869744</td><td>ACME</td><td>120</td><td>XLF019</td><td>10/09/2026</td></tr>
    <tr><th>4</th><td>100247</td><td>512200</td><td>Beta Foods</td><td>960</td><td>VB104</td><td>10/15/2026</td></tr>
    </tbody></table></div>`;
  const EXAMPLES = {
    xlookup: {
      text: 'On his own sheet, column A has item numbers. He wants the <b>bay</b> for each one, pulled from the Inventory sheet.',
      fill: { fbXlValue: 'A2', fbXlSheet: 'Inventory', fbXlSearch: 'B', fbXlReturn: 'E', fbXlNotFound: 'Not found', fbXlMatch: 'exact', fbXlLast: false, fbXlLock: true }
    },
    vlookup: {
      text: 'Same job the old way: find the item number from A2 in column B of Inventory and bring back the <b>bay</b> from column E. The table starts at B because VLOOKUP searches the first column.',
      fill: { fbVlValue: 'A2', fbVlSheet: 'Inventory', fbVlTable: 'B:E', fbVlReturn: 'E', fbVlNotFound: 'Not found', fbVlApprox: false, fbVlLock: true }
    },
    if: {
      text: 'Flag aging pallets. In a new column next to Received (F), show “Over 90 days”, “Over 30 days”, or “OK”.',
      mode: 'first',
      rows: [{ cell: 'F2', op: 'lt', v: '=TODAY()-90', res: 'Over 90 days' }, { cell: 'F2', op: 'lt', v: '=TODAY()-30', res: 'Over 30 days' }],
      fill: { fbIfElse: 'OK', fbIfYes: '', fbIfIfs: true }
    },
    sumifs: {
      text: 'Total <b>Qty</b> for the customer typed in cell H2, received in October 2026.',
      what: 'sum',
      rows: [{ cell: 'C', op: 'eq', v: 'H2' }, { cell: 'F', op: 'between', v: '10/1/2026', v2: '10/31/2026' }],
      fill: { fbSuSheet: 'Inventory', fbSuRange: 'D', fbSuLock: true }
    }
  };

  /* ---------------- screen ---------------- */
  const TABS = [
    { id: 'xlookup', name: 'Look Up', sub: 'Find a value from another list (XLOOKUP)' },
    { id: 'vlookup', name: 'VLOOKUP', sub: 'The classic lookup, works in any Excel' },
    { id: 'if', name: 'IF / IFS', sub: 'Show something different depending on a value' },
    { id: 'sumifs', name: 'Add Up / Count', sub: 'Total or count only the rows that match (SUMIFS)' },
    { id: 'fix', name: 'Fix an Error', sub: '#N/A, #NAME?, #VALUE!, 0 when it shouldn\'t be…' }
  ];
  const valueHint = 'A cell like <b>A2</b>, or exact text / number. Put quotes around text that looks like a cell, like <b>"B12"</b>.';
  const lockBox = id => `<label class="fb-check"><input type="checkbox" id="${id}" checked> I'll copy this down a column — lock the ranges with <code>$</code> so they don't slide</label>`;
  const sheetBox = (id, label) => `<label>${label} <span class="fb-opt">optional</span><input id="${id}" placeholder="Leave blank if it's the same sheet — e.g. Inventory" autocomplete="off"></label>`;

  function rowHtml(kind, r) {
    r = r || {};
    const isIf = kind === 'if';
    return `<div class="fb-row">
      <div class="fb-row-top">
        <input class="fb-cell" placeholder="${isIf ? 'Cell, e.g. D2' : 'Column, e.g. C'}" value="${esc(r.cell || '')}" autocomplete="off" aria-label="${isIf ? 'Cell to check' : 'Column to check'}">
        <select class="fb-op" aria-label="Comparison">${opOptions(r.op || 'eq')}</select>
        <button type="button" class="ghost fb-del" title="Remove this check" aria-label="Remove">✕</button>
      </div>
      <div class="fb-row-vals">
        <input class="fb-v" placeholder="Value, e.g. ${isIf ? '100 or Yes or H1' : 'ACME or H2'}" value="${esc(r.v || '')}" autocomplete="off" aria-label="Value">
        <span class="fb-and">and</span>
        <input class="fb-v2" placeholder="Second value" value="${esc(r.v2 || '')}" autocomplete="off" aria-label="Second value">
      </div>
      ${isIf ? `<label class="fb-res-wrap">then show <input class="fb-res" placeholder="Result — text, number, cell, or =formula" value="${esc(r.res || '')}" autocomplete="off"></label>` : '<input class="fb-res" type="hidden">'}
    </div>`;
  }

  function examplesBox(tab) {
    return `<details class="fb-example"><summary>See an example</summary><p>${EXAMPLES[tab].text}</p>${SAMPLE}<button type="button" class="ghost fb-mini" data-fb-example="${tab}">Fill in this example</button></details>`;
  }

  function buildScreen(sec) {
    sec.innerHTML = `
    <div class="fb-head">
      <h2>Formula Builder</h2>
      <p class="hint">Answer the questions in plain words and it writes the Excel formula. Copy it, click the cell in Excel, and paste. Works the same in Google Sheets. Nothing you type leaves this device.</p>
    </div>
    <div class="fb-tabs" role="tablist">${TABS.map(t => `<button type="button" role="tab" class="fb-tab" data-fb-tab="${t.id}"><span class="fb-tab-name">${t.name}</span><span class="fb-tab-sub">${t.sub}</span></button>`).join('')}</div>
    <div class="fb-grid">
      <div class="fb-inputs">
        <div class="card fb-pane" data-fb-pane="xlookup">
          <h3>Look up a value</h3>
          ${examplesBox('xlookup')}
          <label>1. What are you looking for?<input id="fbXlValue" placeholder="e.g. A2" autocomplete="off"></label>
          <div class="hint">${valueHint}</div>
          ${sheetBox('fbXlSheet', '2. Which sheet is the list on?')}
          <label>3. Which column do you search in?<input id="fbXlSearch" placeholder="e.g. B" autocomplete="off"></label>
          <div class="hint">A column letter like <b>B</b>, or a range like <b>B2:B500</b>.</div>
          <label>4. Which column has the answer you want back?<input id="fbXlReturn" placeholder="e.g. E" autocomplete="off"></label>
          <div class="hint">Type <b>E:G</b> to bring back several columns at once.</div>
          <label>5. What should show if it isn't found?<input id="fbXlNotFound" value="Not found" placeholder="Leave empty to show #N/A" autocomplete="off"></label>
          <label>How should it match?<select id="fbXlMatch">
            <option value="exact">Exact match (most common)</option>
            <option value="contains">Contains the text (partial match)</option>
            <option value="smaller">Exact, or the next smaller value (rate brackets)</option>
            <option value="larger">Exact, or the next larger value</option>
          </select></label>
          <label class="fb-check"><input type="checkbox" id="fbXlLast"> If it's listed more than once, use the last (newest) one</label>
          ${lockBox('fbXlLock')}
        </div>

        <div class="card fb-pane" data-fb-pane="vlookup">
          <h3>VLOOKUP</h3>
          ${examplesBox('vlookup')}
          <label>1. What are you looking for?<input id="fbVlValue" placeholder="e.g. A2" autocomplete="off"></label>
          <div class="hint">${valueHint}</div>
          ${sheetBox('fbVlSheet', '2. Which sheet is the table on?')}
          <label>3. Where is the table?<input id="fbVlTable" placeholder="e.g. B:E" autocomplete="off"></label>
          <div class="hint">From the column you <b>search in</b>, across to the column you want back. The search column has to be the first (left-most) one.</div>
          <label>4. Which column do you want back?<input id="fbVlReturn" placeholder="e.g. E (or 4)" autocomplete="off"></label>
          <div class="hint">The column letter is easiest — it works out the number for you.</div>
          <label>5. What should show if it isn't found?<input id="fbVlNotFound" value="Not found" placeholder="Leave empty to show #N/A" autocomplete="off"></label>
          <label class="fb-check"><input type="checkbox" id="fbVlApprox"> Approximate match — only for sorted bracket tables (rates, weight breaks)</label>
          ${lockBox('fbVlLock')}
        </div>

        <div class="card fb-pane" data-fb-pane="if">
          <h3>IF / IFS</h3>
          ${examplesBox('if')}
          <label>How should the checks work?<select id="fbIfMode">
            <option value="first">Go down the list — first check that's true wins</option>
            <option value="all">ALL checks must be true (AND)</option>
            <option value="any">ANY one check can be true (OR)</option>
          </select></label>
          <div id="fbIfRows">${rowHtml('if')}</div>
          <button type="button" class="ghost fb-mini fb-add" data-fb-add="if">+ Add another check</button>
          <label class="fb-yes">If true, show<input id="fbIfYes" placeholder="Result — text, number, cell, or =formula" autocomplete="off"></label>
          <label>Otherwise show<input id="fbIfElse" placeholder="Leave empty for a blank cell" autocomplete="off"></label>
          <div class="hint">Results can be text (Yes), a number (0), a cell (B2), or a formula starting with = (=D2*0.1). Type <b>today</b> or <b>=TODAY()-90</b> for dates.</div>
          <label class="fb-check fb-ifs"><input type="checkbox" id="fbIfIfs" checked> Use IFS (Excel 2019, 2021 or 365) — easier to read</label>
        </div>

        <div class="card fb-pane" data-fb-pane="sumifs">
          <h3>Add up / count rows that match</h3>
          ${examplesBox('sumifs')}
          <label>What do you want?<select id="fbSuWhat">
            <option value="sum">Add up a column (SUMIFS)</option>
            <option value="count">Count the rows (COUNTIFS)</option>
            <option value="avg">Average a column (AVERAGEIFS)</option>
          </select></label>
          ${sheetBox('fbSuSheet', 'Which sheet is the data on?')}
          <label class="fb-sumcol">Which column do you add up?<input id="fbSuRange" placeholder="e.g. D" autocomplete="off"></label>
          <div class="fb-sub">Only rows where…</div>
          <div id="fbSuRows">${rowHtml('sumifs')}</div>
          <button type="button" class="ghost fb-mini fb-add" data-fb-add="sumifs">+ Add another condition</button>
          <div class="hint">Value can be text (ACME), a number (100), a date (10/1/2026), a cell (H2), or <b>today</b>. “is between” is handy for date ranges.</div>
          ${lockBox('fbSuLock')}
        </div>

        <div class="fb-pane fb-fix" data-fb-pane="fix">${FIX_HTML()}</div>
      </div>

      <aside class="card fb-result" aria-live="polite">
        <div class="fb-result-label">Your formula</div>
        <div id="fbFormula" class="fb-formula"></div>
        <div class="actions"><button type="button" id="fbCopy">Copy formula</button><button type="button" id="fbReset" class="ghost">Start over</button></div>
        <div class="fb-result-label">In plain English</div>
        <p id="fbEnglish" class="fb-english"></p>
        <div id="fbIssues"></div>
        <div id="fbAlt"></div>
        <div id="fbNote" class="hint"></div>
        <details class="fb-howto"><summary>How do I put it in Excel?</summary>
          <ol><li>Tap <b>Copy formula</b>.</li><li>In Excel, click the first cell where the answer should go (for example row 2 of an empty column).</li><li>Press <b>Ctrl+V</b> and then <b>Enter</b>.</li><li>To fill the rest of the column, double-click the small square at the bottom-right corner of that cell.</li></ol>
          <p class="hint">If the cell shows the formula as text instead of an answer, see <b>Fix an Error</b> → “The formula shows up as text”.</p>
        </details>
        <div id="fbRecent"></div>
      </aside>
    </div>`;
  }

  function FIX_HTML() {
    const items = [
      ['#N/A', 'It couldn’t find a match.', [
        'Check spelling, and look for extra spaces — clean a column with <code>=TRIM(A2)</code>.',
        'Number vs. text: <b>869731</b> typed as a number won’t match <b>869731</b> stored as text (often has a green triangle in the corner). Fix by selecting the column → Data → Text to Columns → Finish, or look up <code>A2&amp;""</code> / <code>--A2</code> instead of A2.',
        'Make sure the search column really covers all the rows (B:B instead of B2:B100).',
        'To show a friendly message instead, fill in “What should show if it isn’t found?”.']],
      ['#NAME?', 'Excel doesn’t recognize something in the formula.', [
        'His Excel may be too old for <b>XLOOKUP</b> (needs 2021 / 365) or <b>IFS</b> (needs 2019+). Use the VLOOKUP tab, or untick “Use IFS”.',
        'A sheet name with spaces needs quotes — the builder adds them for you.',
        'Text typed straight into a formula needs "quotes".']],
      ['#VALUE!', 'Something in the formula is the wrong size or type.', [
        'XLOOKUP and SUMIFS need every column to cover the <b>same rows</b> — D2:D500 with C2:C400 breaks it.',
        'Doing math on a cell that holds text (like “N/A” or a space).']],
      ['#REF!', 'It points at a cell or column that isn’t there.', [
        'In VLOOKUP, the column number is bigger than the table — widen the table.',
        'A column or sheet used by the formula was deleted.']],
      ['#SPILL!', 'The answer needs more cells than are free.', [
        'XLOOKUP bringing back several columns (E:G) needs the cells to the right to be empty. Clear them, or bring back one column.']],
      ['#DIV/0!', 'Dividing by zero or by an empty cell.', [
        'AVERAGEIFS with no matching rows does this. Wrap it: <code>=IFERROR(your formula,0)</code>.']],
      ['The formula shows up as text', 'You see <code>=XLOOKUP(…)</code> in the cell instead of an answer.', [
        'The cell is formatted as Text. Change it to <b>General</b> (Home → Number format), then click in the cell and press Enter.',
        'Make sure it starts with <b>=</b> and there is no space or apostrophe in front of it.']],
      ['SUMIFS / COUNTIFS gives 0', 'No rows matched every condition.', [
        'Dates or numbers stored as text won’t match “is between” or “is more than” — fix with Text to Columns as above.',
        'The customer name has to match exactly (extra spaces count). Try “contains” instead of “equals”.',
        'All conditions must be true at once — remove them one at a time to find the one that filters everything out.']],
      ['Breaks when dragged down', 'Right in row 2, wrong in row 3 and below.', [
        'The ranges slid down with the formula. Keep “lock the ranges with $” ticked. In Excel you can also click a reference and press <b>F4</b> to add the $ signs.',
        'Cells that should stay fixed (like a date in H1) need $ too — type <b>$H$1</b>.']],
      ['Answer doesn’t update', 'You change data and the result stays the same.', [
        'Calculation is set to Manual. Formulas tab → Calculation Options → <b>Automatic</b> (or press F9 to recalculate once).']]
    ];
    return `<div class="card"><h3>Fix an Error</h3><p class="hint">What the error means, and the usual fix.</p>
      ${items.map(([t, what, fixes]) => `<details class="fb-err"><summary><span class="fb-err-code">${t}</span><span class="fb-err-what">${what}</span></summary><ul>${fixes.map(x => `<li>${x}</li>`).join('')}</ul></details>`).join('')}
    </div>`;
  }

  /* ---------------- behavior ---------------- */
  let current = 'xlookup';
  let lastFormula = '';

  function setTab(id) {
    if (!TABS.some(t => t.id === id)) id = 'xlookup';
    current = id;
    document.querySelectorAll('#formulas [data-fb-tab]').forEach(b => { const on = b.dataset.fbTab === id; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    document.querySelectorAll('#formulas [data-fb-pane]').forEach(p => { p.hidden = p.dataset.fbPane !== id; });
    const sec = $('formulas');
    if (sec) sec.classList.toggle('fb-fixmode', id === 'fix');
    try { localStorage.setItem(TAB_KEY, id); } catch (e) {}
    render();
  }

  function syncRows() {
    document.querySelectorAll('#formulas .fb-row').forEach(r => {
      const op = r.querySelector('.fb-op').value;
      r.querySelector('.fb-v').hidden = !!NO_VALUE[op];
      const between = op === 'between';
      r.querySelector('.fb-v2').hidden = !between;
      r.querySelector('.fb-and').hidden = !between;
      r.querySelector('.fb-row-vals').classList.toggle('between', between);
      r.querySelector('.fb-del').hidden = r.parentElement.children.length < 2;
    });
    const mode = fieldVal('fbIfMode');
    document.querySelectorAll('#fbIfRows .fb-res-wrap').forEach(w => { w.hidden = mode !== 'first'; });
    const yes = document.querySelector('#formulas .fb-yes'); if (yes) yes.hidden = mode === 'first';
    const ifs = document.querySelector('#formulas .fb-ifs'); if (ifs) ifs.hidden = !(mode === 'first' && document.querySelectorAll('#fbIfRows .fb-row').length > 1);
    const sumcol = document.querySelector('#formulas .fb-sumcol');
    if (sumcol) {
      const w = fieldVal('fbSuWhat');
      sumcol.hidden = w === 'count';
      sumcol.firstChild.textContent = w === 'avg' ? 'Which column do you average?' : 'Which column do you add up?';
    }
  }

  function colorize(f) {
    return esc(f)
      .replace(new RegExp(PH_L + '([^' + PH_R + ']*)' + PH_R, 'g'), '<span class="fb-ph">$1</span>')
      .replace(/\b(XLOOKUP|VLOOKUP|IFERROR|IFS|IF|AND|OR|SUMIFS|COUNTIFS|AVERAGEIFS|ISNUMBER|SEARCH|LEFT|RIGHT|LEN|DATE|TODAY)\(/g, '<b class="fb-fn">$1</b>(');
  }

  function render() {
    if (current === 'fix' || !$('fbFormula')) return;
    syncRows();
    const b = { xlookup: buildXlookup, vlookup: buildVlookup, if: buildIf, sumifs: buildSumifs }[current];
    const out = b();
    $('fbFormula').innerHTML = colorize(out.formula);
    $('fbEnglish').innerHTML = out.english || '';
    const ready = !out.missing && !out.err.length;
    lastFormula = ready ? out.formula : '';
    const copy = $('fbCopy');
    copy.disabled = !ready;
    copy.textContent = out.err.length ? 'Fix the issue below first' : (out.missing ? 'Fill in the blanks to copy' : 'Copy formula');
    $('fbFormula').classList.toggle('ready', ready);
    $('fbIssues').innerHTML = out.err.map(x => `<div class="fb-issue bad">${x}</div>`).join('') + out.warn.map(x => `<div class="fb-issue">${x}</div>`).join('');
    $('fbAlt').innerHTML = out.alt && ready ? `<div class="fb-alt"><div class="hint">${out.alt.label}</div><code>${esc(out.alt.formula)}</code><button type="button" class="ghost fb-mini" data-fb-copy="${esc(out.alt.formula)}">Copy</button></div>` : '';
    $('fbNote').textContent = out.note || '';
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) {} ta.remove();
    }
    if (window.LWHUI && LWHUI.toast) LWHUI.toast('Copied — click a cell in Excel and press Ctrl+V');
    remember(t);
  }

  function getRecent() { try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function remember(t) {
    const a = getRecent().filter(x => x !== t); a.unshift(t);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(a.slice(0, 8))); } catch (e) {}
    showRecent();
  }
  function showRecent() {
    const box = $('fbRecent'); if (!box) return;
    const a = getRecent();
    box.innerHTML = a.length ? `<details class="fb-recentbox"><summary>Recently copied (${a.length})</summary>${a.map(f => `<div class="fb-recent"><code>${esc(f)}</code><button type="button" class="ghost fb-mini" data-fb-copy="${esc(f)}">Copy</button></div>`).join('')}<button type="button" class="ghost fb-mini" id="fbClearRecent">Clear list</button></details>` : '';
  }

  function setFields(map) {
    Object.entries(map).forEach(([id, v]) => { const el = $(id); if (!el) return; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; });
  }
  function fillExample(tab) {
    const ex = EXAMPLES[tab]; if (!ex) return;
    if (ex.mode) $('fbIfMode').value = ex.mode;
    if (ex.what) $('fbSuWhat').value = ex.what;
    if (ex.rows) $(tab === 'if' ? 'fbIfRows' : 'fbSuRows').innerHTML = ex.rows.map(r => rowHtml(tab, r)).join('');
    setFields(ex.fill);
    render();
  }
  function resetTab(tab) {
    const pane = document.querySelector(`#formulas [data-fb-pane="${tab}"]`); if (!pane) return;
    pane.querySelectorAll('input:not([type=hidden])').forEach(el => { if (el.type === 'checkbox') el.checked = el.defaultChecked; else el.value = el.defaultValue; });
    pane.querySelectorAll('select').forEach(el => { el.selectedIndex = 0; });
    if (tab === 'if') $('fbIfRows').innerHTML = rowHtml('if');
    if (tab === 'sumifs') $('fbSuRows').innerHTML = rowHtml('sumifs');
    render();
  }

  function init() {
    const sec = $('formulas'); if (!sec) return;
    buildScreen(sec);
    sec.addEventListener('input', render);
    sec.addEventListener('change', render);
    sec.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t || !sec.contains(t)) return;
      if (t.dataset.fbTab) return setTab(t.dataset.fbTab);
      if (t.dataset.fbExample) return fillExample(t.dataset.fbExample);
      if (t.dataset.fbCopy) return copyText(t.dataset.fbCopy);
      if (t.dataset.fbAdd) {
        const box = $(t.dataset.fbAdd === 'if' ? 'fbIfRows' : 'fbSuRows');
        if (box.children.length >= 8) { if (window.LWHUI) LWHUI.toast('8 checks is the limit here'); return; }
        box.insertAdjacentHTML('beforeend', rowHtml(t.dataset.fbAdd));
        render();
        const rows = box.querySelectorAll('.fb-cell'); rows[rows.length - 1].focus();
        return;
      }
      if (t.classList.contains('fb-del')) { t.closest('.fb-row').remove(); return render(); }
      if (t.id === 'fbCopy' && lastFormula) return copyText(lastFormula);
      if (t.id === 'fbReset') return resetTab(current);
      if (t.id === 'fbClearRecent') { try { localStorage.removeItem(RECENT_KEY); } catch (err) {} return showRecent(); }
    });
    let start = 'xlookup';
    try { start = localStorage.getItem(TAB_KEY) || 'xlookup'; } catch (e) {}
    showRecent();
    setTab(start);
  }

  window.LWHFormulas = { parseRange, parseValue, criteria, condition, setTab, render, _build: { buildXlookup, buildVlookup, buildIf, buildSumifs } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
