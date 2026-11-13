/**
 * LWH Production — Apps Script API (Warehouse Toolkit v1.85.0)
 * =========================================================================================
 * Replaces Code.gs in the existing "Scrapping Production Analytics" Apps Script project.
 * Same Google Sheet, same tabs, same history — the screens move into the Warehouse Toolkit
 * (Production), and this script becomes their JSON API plus the 9 AM daily email.
 *
 * Setup: docs/PRODUCTION_SETUP.md. Short version:
 *   1. Paste this file over Code.gs (keep a copy of the old one). Index.html can be deleted.
 *   2. Run setupProductionV2() once — adds the new tabs/columns. It never deletes data.
 *   3. Access tab: add your employee ID with role "admin".
 *   4. Deploy → Manage deployments → edit → New version. Execute as: Me, Who has access: Anyone.
 *   5. Paste the /exec URL into js/production.js (PROD_API) or Production → Settings.
 *   6. Run createDailyEmailTrigger() once (re-creates the 9 AM email).
 *
 * Who can use it — checked on every request, not just on screen:
 *   The Toolkit sends the signed-in session. This script asks Supabase (whm_me) who it is.
 *   - On the warehouse manager list            → "manager"
 *   - Access tab can set anyone's role:  admin | manager | entry | none
 *       admin   = everything, incl. pricing, pay rates, employees, settings, access
 *       manager = record/edit entries, all analytics and $, email reports, crews
 *       entry   = record/edit entries, units and hours only (no $ or pay rates anywhere)
 *   - Script Property ADMIN_EMP_IDS (comma list) is always admin (break-glass).
 *
 * Script Properties (Project Settings → Script Properties), all optional:
 *   SUPABASE_URL, SUPABASE_KEY    default: the Toolkit's project + publishable key
 *   PROD_TIMECLOCK_KEY            enables timeclock comparison (sql/production_timeclock.sql)
 *   ADMIN_EMP_IDS                 e.g. 12345
 *   TOOLKIT_URL                   default: https://nbr1hawgfan.github.io/LWH-Warehouse-Toolkit/
 * =========================================================================================
 */

var CONFIG = {
  MAIN_SHEET_ID: '1licP1Il9hz21YziiOPVBsdSA3mscJc6lcvPdWXpV4cQ',
  EMPLOYEES_SHEET_NAME: 'Employees',
  PRODUCTION_SHEET_NAME: 'Production',
  // Seed values only — after setupProductionV2() the live values are in the Projects,
  // Rate History and Settings tabs and are changed from the Toolkit.
  SEED_RATES: {
    scrapping: 7.91, repacking: 7.91, converter: 9.91, tqScrapping991: 9.91, tqScrapping791: 7.91,
    repackCCC: 7.91, buildRepairCrates: 7.91, disposalCrates: 5.50, exFluidWiping: 5.00
  },
  SEED_NAMES: {
    scrapping: 'Scrapping', repacking: 'Repacking', converter: 'Converter',
    tqScrapping991: 'TQ Scrapping ($9.91)', tqScrapping791: 'TQ Scrapping ($7.91)', repackCCC: 'Repack C-CC',
    buildRepairCrates: 'Build/Repair Crates', disposalCrates: 'Disposal of Crates', exFluidWiping: 'Ex. Fluid Wiping'
  },
  SEED_ORDER: ['scrapping','repacking','converter','tqScrapping991','tqScrapping791','repackCCC','buildRepairCrates','disposalCrates','exFluidWiping'],
  SEED_RECIPIENTS: [
    'tjennings@logistics-warehouse.com', 'administrator@logisticswarehouse.net', 'mwalker@logistics-warehouse.com',
    'sbolton@logistics-warehouse.com', 'tbolton@logistics-warehouse.com', 'rrobertson@logistics-warehouse.com'
  ]
};

var TAB = { PROJECTS: 'Projects', RATES: 'Rate History', SETTINGS: 'Settings', CREWS: 'Crews', AUDIT: 'Audit Log', ACCESS: 'Access' };
var SUPA_URL_DEFAULT = 'https://tjivcqxnkftujceumdtx.supabase.co';
var SUPA_KEY_DEFAULT = 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
var BRAND = '#c8102e';

// ── Production sheet columns (1-based). 1–13 are the original columns, unchanged. ─────────
var C = { DATE:1, EMP:2, PROJ:3, UNITS:4, HOURS:5, RATE:6, LABOR:7, REV:8, MARGIN:9, BILL:10,
          EMPOT:11, CUSTOT:12, CUSTOTREV:13, ENTRY:14, JOB:15, EMPID:16, REG:17, BY:18, AT:19, NOTES:20 };
var NCOL = 20;
var HEADERS = ['Date','Employee','Project Type','Total Units','Hours','Employee Rate','Labor Cost','Revenue','Margin',
  'Billing Rate','Emp OT Hours','Customer OT Hours','Customer OT Revenue','Entry ID','Job ID','Emp ID',
  'Regular Hours','Entered By','Entered At','Notes'];
var ROLE_LEVEL = { entry: 1, manager: 2, admin: 3 };

// =========================================================================================
// Web app
// =========================================================================================
function doGet(e) {
  if (e && e.parameter && e.parameter.health) return json_({ ok: true, service: 'LWH Production API', version: '1.85.0' });
  var url = toolkitUrl_() + '?view=production';
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;text-align:center">' +
    '<div style="border-top:5px solid ' + BRAND + ';padding:24px;border:1px solid #ddd">' +
    '<h2 style="margin:0 0 8px">Production has moved</h2>' +
    '<p>Record production and see the dashboard in the <b>Warehouse Toolkit → Production</b>.</p>' +
    '<p><a href="' + url + '" target="_top" style="display:inline-block;background:' + BRAND +
    ';color:#fff;padding:12px 20px;text-decoration:none;font-weight:bold">Open Production</a></p></div></div>'
  ).setTitle('Production has moved').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad_request' }); }
  try {
    var who = auth_(body.token);
    var fn = ROUTES[body.action];
    if (!fn) return json_({ ok: false, error: 'unknown_action' });
    var need = MIN_ROLE[body.action] || 'admin';
    if (ROLE_LEVEL[who.role] < ROLE_LEVEL[need]) return json_({ ok: false, error: 'not_allowed' });
    var out = fn(body, who) || {};
    out.ok = out.ok !== false;
    return json_(out);
  } catch (err) {
    var msg = String(err && err.message || err);
    if (!/^(signed_out|no_access|duplicate|bad_input:)/.test(msg)) Logger.log('Production API error (' + body.action + '): ' + (err && err.stack || msg));
    return json_({ ok: false, error: msg });
  }
}

var ROUTES = {
  bootstrap: apiBootstrap_, weekHours: apiWeekHours_, saveJob: apiSaveJob_, deleteJob: apiDeleteJob_,
  entries: apiEntries_, analytics: apiAnalytics_, timeclock: apiTimeclock_, sendReport: apiSendReport_,
  saveCrew: apiSaveCrew_, deleteCrew: apiDeleteCrew_,
  saveProject: apiSaveProject_, rateHistory: apiRateHistory_, saveEmployee: apiSaveEmployee_,
  saveSettings: apiSaveSettings_, saveAccess: apiSaveAccess_, removeAccess: apiRemoveAccess_,
  recalcOt: apiRecalcOt_, auditLog: apiAuditLog_, sendDailyNow: apiSendDailyNow_
};
var MIN_ROLE = {
  bootstrap: 'entry', weekHours: 'entry', saveJob: 'entry', deleteJob: 'entry', entries: 'entry', analytics: 'entry',
  timeclock: 'manager', sendReport: 'manager', saveCrew: 'entry', deleteCrew: 'manager',
  saveProject: 'admin', rateHistory: 'manager', saveEmployee: 'admin', saveSettings: 'admin', saveAccess: 'admin',
  removeAccess: 'admin', recalcOt: 'admin', auditLog: 'admin', sendDailyNow: 'admin'
};

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function props_() { return PropertiesService.getScriptProperties(); }
function toolkitUrl_() { return props_().getProperty('TOOLKIT_URL') || 'https://nbr1hawgfan.github.io/LWH-Warehouse-Toolkit/'; }
function ss_() { return SpreadsheetApp.openById(CONFIG.MAIN_SHEET_ID); }
function tz_() { return Session.getScriptTimeZone() || 'America/Chicago'; }
function bad_(msg) { throw new Error('bad_input:' + msg); }
function round2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function num_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function isMoney_(who) { return ROLE_LEVEL[who.role] >= ROLE_LEVEL.manager; }

// =========================================================================================
// Sign-in — the Toolkit's employee session, checked with Supabase
// =========================================================================================
function supa_(fn, args, opt) {
  var p = props_();
  var url = p.getProperty('SUPABASE_URL') || SUPA_URL_DEFAULT, key = p.getProperty('SUPABASE_KEY') || SUPA_KEY_DEFAULT;
  var res = UrlFetchApp.fetch(url + '/rest/v1/rpc/' + fn, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: key }, payload: JSON.stringify(args || {})
  });
  if (res.getResponseCode() >= 300) throw new Error('Supabase ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function auth_(token) {
  if (!token) throw new Error('signed_out');
  var cache = CacheService.getScriptCache(), ck = 'au_' + hash_(token);
  var hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  var me = supa_('whm_me', { p_token: String(token) });
  if (!me || !me.ok) throw new Error('signed_out');
  var role = roleFor_(me.emp_id, me.is_manager);
  if (!role) throw new Error('no_access');
  var who = { empId: me.emp_id, name: me.name || ('ID ' + me.emp_id), role: role };
  cache.put(ck, JSON.stringify(who), 300);   // 5 minutes — an Access change applies within 5 min
  return who;
}

function roleFor_(empId, isManager) {
  var admins = String(props_().getProperty('ADMIN_EMP_IDS') || '').split(/[,\s]+/).filter(String);
  if (admins.indexOf(String(empId)) >= 0) return 'admin';
  var sh = ss_().getSheetByName(TAB.ACCESS);
  if (sh && sh.getLastRow() > 1) {
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === String(empId)) {
        var r = String(rows[i][2] || '').trim().toLowerCase();
        if (r === 'none') return null;
        if (ROLE_LEVEL[r]) return r;
      }
    }
  }
  return isManager ? 'manager' : null;
}

// =========================================================================================
// Dates (all as 'yyyy-MM-dd' strings in the script's time zone — no UTC off-by-one)
// =========================================================================================
function ymd_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function cellYmd_(v) {
  if (!v) return '';
  if (v instanceof Date) return ymd_(v);
  var s = String(v).trim(), m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  var d = new Date(s); return isNaN(d) ? '' : ymd_(d);
}
function parseYmd_(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0); }
function addDays_(s, n) { var d = parseYmd_(s); d.setDate(d.getDate() + n); return ymd_(d); }
function weekStart_(s) { var d = parseYmd_(s); d.setDate(d.getDate() - d.getDay()); return ymd_(d); }
function today_() { return ymd_(new Date()); }
function validYmd_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(parseYmd_(s)); }
function stamp_(v) { return v instanceof Date ? v.getTime() : (v ? (new Date(v).getTime() || 0) : 0); }

// =========================================================================================
// Reference data: projects, rates, settings, employees, crews
// =========================================================================================
function sheet_(name, headers) {
  var ss = ss_(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); if (headers) { sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold'); sh.setFrozenRows(1); } }
  return sh;
}
function rows_(sh, ncol) {
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, ncol).getValues();
}

function getProjects_() {
  var list = rows_(ss_().getSheetByName(TAB.PROJECTS), 5).filter(function (r) { return String(r[0]).trim(); }).map(function (r) {
    return { key: String(r[0]).trim(), name: String(r[1] || r[0]).trim(), active: r[2] !== false && String(r[2]).toUpperCase() !== 'FALSE',
             sort: num_(r[3]), target: num_(r[4]) };
  });
  if (!list.length) list = CONFIG.SEED_ORDER.map(function (k, i) { return { key: k, name: CONFIG.SEED_NAMES[k], active: true, sort: i + 1, target: 0 }; });
  list.sort(function (a, b) { return (a.sort - b.sort) || a.name.localeCompare(b.name); });
  return list;
}

function getRateHistory_() {
  var hist = {};
  rows_(ss_().getSheetByName(TAB.RATES), 6).forEach(function (r) {
    var k = String(r[0]).trim(); if (!k) return;
    (hist[k] = hist[k] || []).push({ rate: num_(r[1]), from: cellYmd_(r[2]) || '2000-01-01', by: String(r[3] || ''),
      at: r[4] instanceof Date ? r[4].toISOString() : String(r[4] || ''), note: String(r[5] || '') });
  });
  Object.keys(hist).forEach(function (k) { hist[k].sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : stamp_(a.at) - stamp_(b.at); }); });
  if (!Object.keys(hist).length) CONFIG.SEED_ORDER.forEach(function (k) { hist[k] = [{ rate: CONFIG.SEED_RATES[k], from: '2000-01-01', by: 'seed', at: '', note: '' }]; });
  return hist;
}
function rateFor_(hist, key, date) {
  var h = hist[key]; if (!h || !h.length) return 0;
  var r = h[0].rate;
  for (var i = 0; i < h.length; i++) { if (h[i].from <= date) r = h[i].rate; }
  return r;
}

var SETTING_DEFAULTS = { OT_BILLING_RATE: 40, OT_WEEKLY_THRESHOLD: 40, OT_MULTIPLIER: 1.5, OT_WATCH_HOURS: 36,
  REPORT_RECIPIENTS: CONFIG.SEED_RECIPIENTS.join(', '), REPORT_ENABLED: true, TIMECLOCK_GAP_HOURS: 1 };
function getSettings_() {
  var s = {}; Object.keys(SETTING_DEFAULTS).forEach(function (k) { s[k] = SETTING_DEFAULTS[k]; });
  rows_(ss_().getSheetByName(TAB.SETTINGS), 2).forEach(function (r) {
    var k = String(r[0]).trim(); if (!(k in SETTING_DEFAULTS)) return;
    var d = SETTING_DEFAULTS[k];
    s[k] = typeof d === 'number' ? (r[1] === '' ? d : num_(r[1])) : typeof d === 'boolean' ? !(r[1] === false || String(r[1]).toUpperCase() === 'FALSE') : String(r[1]);
  });
  return s;
}
function recipients_(s) { return String(s.REPORT_RECIPIENTS || '').split(/[,;\s]+/).filter(function (x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); }); }

function getEmployees_() {
  return rows_(ss_().getSheetByName(CONFIG.EMPLOYEES_SHEET_NAME), 4).map(function (r) {
    return { name: String(r[0] || '').trim(), rate: num_(r[1]), active: !(r[2] === false || String(r[2]).toUpperCase() === 'FALSE'),
             empId: String(r[3] || '').replace(/\D/g, '') };
  }).filter(function (e) { return e.name; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function getCrews_() {
  return rows_(ss_().getSheetByName(TAB.CREWS), 3).filter(function (r) { return String(r[0]).trim(); }).map(function (r) {
    var m = []; try { m = JSON.parse(r[1] || '[]'); } catch (e) { m = String(r[1] || '').split('|'); }
    return { name: String(r[0]).trim(), members: m.map(String).filter(String), by: String(r[2] || '') };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

/** Legacy rows hold keys like 'scrapping' or display names. Unknown values are kept, never turned into 'scrapping'. */
function projectKey_(raw, projects) {
  var s = String(raw || '').trim(); if (!s) return '';
  var lower = s.toLowerCase();
  for (var i = 0; i < projects.length; i++) if (projects[i].key.toLowerCase() === lower || projects[i].name.toLowerCase() === lower) return projects[i].key;
  var n = lower;
  if (n.indexOf('converter') >= 0) return 'converter';
  if (n.indexOf('tqscrapping') >= 0 || n.indexOf('tq scrapping') >= 0) return (n.indexOf('7.91') >= 0 || n.indexOf('791') >= 0) ? 'tqScrapping791' : 'tqScrapping991';
  if (n.indexOf('repack') >= 0 && (n.indexOf('ccc') >= 0 || n.indexOf('c-cc') >= 0)) return 'repackCCC';
  if ((n.indexOf('build') >= 0 || n.indexOf('repair') >= 0) && n.indexOf('crate') >= 0) return 'buildRepairCrates';
  if (n.indexOf('disposal') >= 0 && n.indexOf('crate') >= 0) return 'disposalCrates';
  if ((n.indexOf('fluid') >= 0 && n.indexOf('wiping') >= 0) || n.indexOf('exfluid') >= 0) return 'exFluidWiping';
  return s;
}

// =========================================================================================
// Production data
// =========================================================================================
function prodSheet_() { return ss_().getSheetByName(CONFIG.PRODUCTION_SHEET_NAME); }
/** All production rows as objects. idx = 0-based index into values (sheet row = idx + 1). */
function readProd_(projects) {
  var sh = prodSheet_();
  var last = sh.getLastRow();
  var values = last > 1 ? sh.getRange(1, 1, last, NCOL).getValues() : [HEADERS];
  projects = projects || getProjects_();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i]; var date = cellYmd_(r[C.DATE - 1]);
    if (!date) continue;
    var hours = num_(r[C.HOURS - 1]), empOt = num_(r[C.EMPOT - 1]);
    out.push({
      idx: i, date: date, name: String(r[C.EMP - 1] || '').trim(), project: projectKey_(r[C.PROJ - 1], projects),
      units: num_(r[C.UNITS - 1]), hours: hours, rate: num_(r[C.RATE - 1]), labor: num_(r[C.LABOR - 1]),
      revenue: num_(r[C.REV - 1]), margin: num_(r[C.MARGIN - 1]), bill: num_(r[C.BILL - 1]), empOt: empOt,
      custOt: num_(r[C.CUSTOT - 1]), custOtRev: num_(r[C.CUSTOTREV - 1]), entryId: String(r[C.ENTRY - 1] || ''),
      jobId: String(r[C.JOB - 1] || ''), empId: String(r[C.EMPID - 1] || ''),
      reg: r[C.REG - 1] === '' ? Math.max(0, hours - empOt) : num_(r[C.REG - 1]),
      by: String(r[C.BY - 1] || ''), at: stamp_(r[C.AT - 1]), notes: String(r[C.NOTES - 1] || '')
    });
  }
  return { sheet: sh, values: values, rows: out };
}

function newId_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase(); }

/**
 * Weekly OT, recalculated from the whole Sun–Sat week every time it changes.
 * Hours are counted in date order, then in the order they were entered: the first
 * OT_WEEKLY_THRESHOLD hours are regular, the rest are employee OT at OT_MULTIPLIER.
 * Late, back-dated, edited and deleted entries all come out right.
 * keys: { 'Name|weekStart': true }   (pass null to recheck every row in data)
 */
function recalcWeeks_(keys, data) {
  var s = getSettings_(), thr = s.OT_WEEKLY_THRESHOLD, mult = s.OT_MULTIPLIER;
  data = data || readProd_();
  var groups = {};
  data.rows.forEach(function (r) {
    var k = r.name + '|' + weekStart_(r.date);
    if (keys && !keys[k]) return;
    (groups[k] = groups[k] || []).push(r);
  });
  var changed = [];
  Object.keys(groups).forEach(function (k) {
    var g = groups[k].sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at - b.at) || (a.idx - b.idx); });
    var used = 0;
    g.forEach(function (r) {
      var reg = round2_(Math.min(r.hours, Math.max(0, thr - used))), ot = round2_(r.hours - reg);
      used += r.hours;
      var labor = round2_(reg * r.rate + ot * r.rate * mult), margin = round2_(r.revenue - labor);
      var row = data.values[r.idx];
      if (round2_(row[C.LABOR - 1]) !== labor || round2_(row[C.EMPOT - 1]) !== ot || row[C.REG - 1] === '' || round2_(row[C.REG - 1]) !== reg || round2_(row[C.MARGIN - 1]) !== margin) {
        row[C.LABOR - 1] = labor; row[C.EMPOT - 1] = ot; row[C.REG - 1] = reg; row[C.MARGIN - 1] = margin;
        r.labor = labor; r.empOt = ot; r.reg = reg; r.margin = margin;
        changed.push(r.idx);
      }
    });
  });
  writeBack_(data, changed);
  return changed.length;
}

/** Writes columns Labor (7) … Regular Hours (17) for changed rows. */
function writeBack_(data, idxs) {
  if (!idxs.length) return;
  var sh = data.sheet, w = C.REG - C.LABOR + 1;
  if (idxs.length > 40) {
    var block = data.values.slice(1).map(function (r) { var a = r.slice(C.LABOR - 1, C.REG); while (a.length < w) a.push(''); return a; });
    sh.getRange(2, C.LABOR, block.length, w).setValues(block);
    return;
  }
  idxs.forEach(function (i) { sh.getRange(i + 1, C.LABOR, 1, w).setValues([data.values[i].slice(C.LABOR - 1, C.REG)]); });
}

function formatRows_(sh, firstRow, n) {
  if (n <= 0) return;
  var f = ['M/d/yyyy', '@', '@', '#,##0.##', '0.00', '$#,##0.00', '$#,##0.00', '$#,##0.00', '$#,##0.00', '$#,##0.00',
           '0.00', '0.00', '$#,##0.00', '@', '@', '@', '0.00', '@', 'M/d/yyyy h:mm am/pm', '@'];
  sh.getRange(firstRow, 1, n, NCOL).setNumberFormats(Array.apply(null, Array(n)).map(function () { return f; }));
}

function audit_(who, action, ref, details) {
  try {
    var sh = sheet_(TAB.AUDIT, ['When', 'Who', 'Emp ID', 'Action', 'Reference', 'Details']);
    sh.appendRow([new Date(), who.name, who.empId, action, ref || '', JSON.stringify(details || {}).slice(0, 4000)]);
  } catch (e) { Logger.log('audit failed: ' + e.message); }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('busy — someone else is saving, try again in a moment');
  try { return fn(); } finally { lock.releaseLock(); }
}

// =========================================================================================
// API — everyday
// =========================================================================================
function apiBootstrap_(b, who) {
  var money = isMoney_(who), s = getSettings_(), hist = getRateHistory_(), t = today_();
  var projects = getProjects_().map(function (p) {
    var o = { key: p.key, name: p.name, active: p.active, sort: p.sort, target: p.target };
    if (money) o.rate = rateFor_(hist, p.key, t);
    return o;
  });
  var emps = getEmployees_().map(function (e) {
    var o = { name: e.name, active: e.active, empId: e.empId };
    if (money) o.rate = e.rate;
    return o;
  });
  var out = { me: who, today: t, projects: projects, employees: emps, crews: getCrews_(),
    settings: { otThreshold: s.OT_WEEKLY_THRESHOLD, otWatch: s.OT_WATCH_HOURS } };
  if (money) { out.settings.otBillingRate = s.OT_BILLING_RATE; out.settings.otMultiplier = s.OT_MULTIPLIER;
    out.settings.timeclock = !!props_().getProperty('PROD_TIMECLOCK_KEY'); out.settings.gapHours = s.TIMECLOCK_GAP_HOURS; }
  if (who.role === 'admin') {
    out.settings.recipients = s.REPORT_RECIPIENTS; out.settings.reportEnabled = s.REPORT_ENABLED;
    out.access = rows_(ss_().getSheetByName(TAB.ACCESS), 4).filter(function (r) { return String(r[0]).trim(); })
      .map(function (r) { return { empId: String(r[0]).trim(), name: String(r[1] || ''), role: String(r[2] || '').toLowerCase(), note: String(r[3] || '') }; });
  }
  return out;
}

/** Hours already logged this Sun–Sat week, per person (for the live OT preview). */
function apiWeekHours_(b) {
  if (!validYmd_(b.date)) bad_('date');
  var ws = weekStart_(b.date), we = addDays_(ws, 6), names = {}, before = {}, total = {};
  (b.names || []).forEach(function (n) { n = String(n).trim(); names[n] = true; before[n] = 0; total[n] = 0; });
  readProd_().rows.forEach(function (r) {
    if (!names[r.name] || r.date < ws || r.date > we) return;
    if (b.excludeJobId && r.jobId === b.excludeJobId) return;
    total[r.name] += r.hours;
    // Only hours that come BEFORE this entry count toward its regular hours: earlier days in the week,
    // plus everything already entered for the same day. (Later days shift into OT instead.)
    if (r.date <= b.date) before[r.name] += r.hours;
  });
  Object.keys(total).forEach(function (k) { total[k] = round2_(total[k]); before[k] = round2_(before[k]); });
  return { weekStart: ws, weekEnd: we, before: before, total: total };
}

/**
 * Save a job: one project, one day, a crew of 1+ people, total units for the crew.
 * Units and customer OT hours are split by each person's share of the crew's hours.
 * b: { jobId?, date, project, units, custOtHours, notes, crew:[{name, hours}] }
 */
function apiSaveJob_(b, who) {
  if (!validYmd_(b.date)) bad_('Pick a date.');
  if (b.date > addDays_(today_(), 1)) bad_('That date is in the future.');
  var projects = getProjects_(), proj = null;
  projects.forEach(function (p) { if (p.key === b.project) proj = p; });
  if (!proj) bad_('Pick a project.');
  var units = num_(b.units), custOt = num_(b.custOtHours);
  if (units < 0 || custOt < 0) bad_('Units and hours can\'t be negative.');
  var emps = {}; getEmployees_().forEach(function (e) { emps[e.name] = e; });
  var seen = {}, crew = (b.crew || []).map(function (c) {
    var name = String(c.name || '').trim(), h = round2_(c.hours);
    if (!emps[name]) bad_('Unknown employee: ' + name);
    if (seen[name]) bad_(name + ' is on the crew twice.');
    if (!(h > 0) || h > 24) bad_('Hours for ' + name + ' must be between 0 and 24.');
    seen[name] = true; return { name: name, hours: h };
  });
  if (!crew.length) bad_('Pick at least one person.');
  var notes = String(b.notes || '').slice(0, 500);

  return withLock_(function () {
    var s = getSettings_(), hist = getRateHistory_(), data = readProd_(projects), sh = data.sheet;
    var keys = {}, old = [], jobId = b.jobId ? String(b.jobId) : '';
    if (jobId) {
      old = data.rows.filter(function (r) { return r.jobId === jobId; });
      if (!old.length) bad_('That entry was already deleted. Refresh and try again.');
      if (!proj.active && old[0].project !== proj.key) bad_('That project is turned off.');
    } else {
      if (!proj.active) bad_('That project is turned off.');
      if (!b.allowDuplicate) {   // same day + project + crew + units already saved → ask first (double-tap / double entry)
        var crewKey = crew.map(function (c) { return c.name; }).sort().join('|'), byJob = {};
        data.rows.forEach(function (r) { if (r.date === b.date && r.project === proj.key) { var j = byJob[r.jobId] = byJob[r.jobId] || { n: [], u: 0 }; j.n.push(r.name); j.u += r.units; } });
        Object.keys(byJob).forEach(function (k) { if (byJob[k].n.sort().join('|') === crewKey && round2_(byJob[k].u) === round2_(units)) throw new Error('duplicate'); });
      }
    }
    var oldRate = {}; old.forEach(function (r) { oldRate[r.name] = r.rate; keys[r.name + '|' + weekStart_(r.date)] = true; });

    var billRate = rateFor_(hist, proj.key, b.date);
    var totalH = crew.reduce(function (a, c) { return a + c.hours; }, 0);
    var custOtRevJob = round2_(custOt * s.OT_BILLING_RATE);
    var revJob = round2_(units * billRate + custOtRevJob);
    var acc = { u: 0, o: 0, r: 0, cr: 0 };
    var enteredAt = old.length ? new Date(old[0].at || Date.now()) : new Date();
    var enteredBy = old.length ? old[0].by : who.name;
    jobId = jobId || newId_('J');
    var newRows = crew.map(function (c, i) {
      var last = i === crew.length - 1, share = c.hours / totalH;
      var u = last ? round2_(units - acc.u) : round2_(units * share);
      var o = last ? round2_(custOt - acc.o) : round2_(custOt * share);
      var cr = last ? round2_(custOtRevJob - acc.cr) : round2_(custOtRevJob * share);
      var rev = last ? round2_(revJob - acc.r) : round2_(revJob * share);
      acc.u += u; acc.o += o; acc.r += rev; acc.cr += cr;
      var rate = (c.name in oldRate) ? oldRate[c.name] : emps[c.name].rate;
      keys[c.name + '|' + weekStart_(b.date)] = true;
      var labor = round2_(c.hours * rate);   // straight time for now — recalcWeeks_ applies OT below
      return [parseYmd_(b.date), c.name, proj.key, u, c.hours, rate, labor, rev, round2_(rev - labor), billRate,
              0, o, cr, newId_('E'), jobId, emps[c.name].empId || '', c.hours, enteredBy, enteredAt, notes];
    });

    // Edit = remove the old rows, write the new ones (same Job ID, original entered-by/at).
    old.map(function (r) { return r.idx + 1; }).sort(function (a, b) { return b - a; }).forEach(function (row) { sh.deleteRow(row); });
    var first = sh.getLastRow() + 1;
    sh.getRange(first, 1, newRows.length, NCOL).setValues(newRows);
    formatRows_(sh, first, newRows.length);
    SpreadsheetApp.flush();
    recalcWeeks_(keys);

    audit_(who, old.length ? 'edit job' : 'add job', jobId, { date: b.date, project: proj.key, units: units, custOt: custOt,
      crew: crew, before: old.length ? old.map(function (r) { return { name: r.name, hours: r.hours, units: r.units, date: r.date, project: r.project }; }) : undefined });
    var job = jobsFrom_(readProd_(projects).rows.filter(function (r) { return r.jobId === jobId; }), projects, who)[0];
    return { job: job };
  });
}

function apiDeleteJob_(b, who) {
  var jobId = String(b.jobId || ''); if (!jobId) bad_('jobId');
  return withLock_(function () {
    var data = readProd_(), rows = data.rows.filter(function (r) { return r.jobId === jobId; });
    if (!rows.length) return { deleted: 0 };
    var keys = {};
    rows.forEach(function (r) { keys[r.name + '|' + weekStart_(r.date)] = true; });
    rows.map(function (r) { return r.idx + 1; }).sort(function (a, b) { return b - a; }).forEach(function (row) { data.sheet.deleteRow(row); });
    SpreadsheetApp.flush();
    recalcWeeks_(keys);
    audit_(who, 'delete job', jobId, { rows: rows.map(function (r) { return { date: r.date, name: r.name, project: r.project, units: r.units, hours: r.hours, revenue: r.revenue }; }) });
    return { deleted: rows.length };
  });
}

function jobsFrom_(rows, projects, who) {
  var money = isMoney_(who), names = {}, jobs = {}, order = [];
  projects.forEach(function (p) { names[p.key] = p.name; });
  rows.forEach(function (r) {
    var id = r.jobId || ('row' + r.idx);
    var j = jobs[id];
    if (!j) { j = jobs[id] = { jobId: r.jobId, legacyRow: r.jobId ? null : r.idx + 1, date: r.date, project: r.project,
      projectName: names[r.project] || ('(unknown) ' + r.project), units: 0, hours: 0, custOtHours: 0, empOtHours: 0,
      revenue: 0, labor: 0, margin: 0, notes: r.notes, by: r.by, at: r.at, crew: [] }; order.push(id); }
    j.units += r.units; j.hours += r.hours; j.custOtHours += r.custOt; j.empOtHours += r.empOt;
    j.revenue += r.revenue; j.labor += r.labor; j.margin += r.margin;
    var c = { name: r.name, hours: r.hours, units: r.units, otHours: r.empOt };
    if (money) { c.labor = r.labor; c.revenue = r.revenue; }
    j.crew.push(c);
  });
  return order.map(function (id) {
    var j = jobs[id];
    ['units', 'hours', 'custOtHours', 'empOtHours', 'revenue', 'labor', 'margin'].forEach(function (k) { j[k] = round2_(j[k]); });
    j.uph = j.hours > 0 ? round2_(j.units / j.hours) : 0;
    if (!money) { delete j.revenue; delete j.labor; delete j.margin; }
    return j;
  }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.at - a.at; });
}

function apiEntries_(b, who) {
  if (!validYmd_(b.start) || !validYmd_(b.end)) bad_('dates');
  var projects = getProjects_();
  var rows = readProd_(projects).rows.filter(function (r) { return r.date >= b.start && r.date <= b.end; });
  return { jobs: jobsFrom_(rows, projects, who).slice(0, 1500) };
}

function apiSaveCrew_(b, who) {
  var name = String(b.name || '').trim().slice(0, 60), members = (b.members || []).map(String).filter(String);
  if (!name) bad_('Give the crew a name.');
  if (!members.length) bad_('A crew needs at least one person.');
  return withLock_(function () {
    var sh = sheet_(TAB.CREWS, ['Crew Name', 'Members', 'Updated By', 'Updated At']);
    var rows = rows_(sh, 1), at = -1;
    rows.forEach(function (r, i) { if (String(r[0]).trim().toLowerCase() === name.toLowerCase()) at = i; });
    var vals = [[name, JSON.stringify(members), who.name, new Date()]];
    if (at >= 0) sh.getRange(at + 2, 1, 1, 4).setValues(vals); else sh.appendRow(vals[0]);
    return { crews: getCrews_() };
  });
}
function apiDeleteCrew_(b) {
  return withLock_(function () {
    var sh = ss_().getSheetByName(TAB.CREWS), rows = rows_(sh, 1);
    for (var i = rows.length - 1; i >= 0; i--) if (String(rows[i][0]).trim() === String(b.name || '').trim()) sh.deleteRow(i + 2);
    return { crews: getCrews_() };
  });
}

// =========================================================================================
// Analytics
// =========================================================================================
function analytics_(start, end, opts) {
  opts = opts || {};
  var projects = opts.projects || getProjects_(), s = opts.settings || getSettings_();
  var all = opts.rows || readProd_(projects).rows;
  var rows = all.filter(function (r) { return r.date >= start && r.date <= end; });
  var pmap = {}; projects.forEach(function (p) { pmap[p.key] = p; });
  function blank() { return { units: 0, hours: 0, labor: 0, revenue: 0, margin: 0, empOtHours: 0, custOtHours: 0, custOtRevenue: 0, unitRevenue: 0, people: {}, jobs: {} }; }
  function add(t, r) {
    t.units += r.units; t.hours += r.hours; t.labor += r.labor; t.revenue += r.revenue; t.margin += r.margin;
    t.empOtHours += r.empOt; t.custOtHours += r.custOt; t.custOtRevenue += r.custOtRev; t.unitRevenue += r.units * r.bill;
    if (r.name) t.people[r.name] = true; t.jobs[r.jobId || ('row' + r.idx)] = true;
  }
  function finish(t, target) {
    ['units', 'hours', 'labor', 'revenue', 'margin', 'empOtHours', 'custOtHours', 'custOtRevenue'].forEach(function (k) { t[k] = round2_(t[k]); });
    t.employeeCount = Object.keys(t.people).length; t.jobCount = Object.keys(t.jobs).length;
    t.employees = Object.keys(t.people).sort(); delete t.people; delete t.jobs;
    t.uph = t.hours > 0 ? round2_(t.units / t.hours) : 0;
    t.marginPct = t.revenue > 0 ? round2_(t.margin / t.revenue * 100) : 0;
    t.laborPerUnit = t.units > 0 ? round2_(t.labor / t.units) : 0;
    var avgBill = t.units > 0 ? t.unitRevenue / t.units : 0;
    t.breakevenUnits = avgBill > 0 ? Math.ceil(Math.max(0, t.labor - t.custOtRevenue) / avgBill) : 0;
    delete t.unitRevenue;
    if (target) { t.target = target; t.targetPct = t.hours > 0 ? Math.round(t.uph / target * 100) : 0; }
    return t;
  }

  var total = blank(), byP = {}, byE = {}, byD = {};
  rows.forEach(function (r) {
    add(total, r);
    add(byP[r.project] = byP[r.project] || blank(), r);
    var e = byE[r.name] = byE[r.name] || { t: blank(), p: {} };
    add(e.t, r); add(e.p[r.project] = e.p[r.project] || blank(), r);
    add(byD[r.date] = byD[r.date] || blank(), r);
  });

  var projOut = Object.keys(byP).map(function (k) {
    var p = pmap[k] || { key: k, name: '(unknown) ' + k, target: 0, sort: 999 };
    var t = finish(byP[k], p.target); t.key = k; t.name = p.name; t.sort = p.sort; return t;
  }).sort(function (a, b) { return (a.sort - b.sort) || a.name.localeCompare(b.name); });

  var empOut = Object.keys(byE).map(function (n) {
    var e = byE[n], expected = 0, targetHours = 0;
    var projs = Object.keys(e.p).map(function (k) {
      var tg = (pmap[k] || {}).target || 0, t = finish(e.p[k], tg);
      if (tg) { expected += t.hours * tg; targetHours += t.hours; }
      return { key: k, name: (pmap[k] || {}).name || k, hours: t.hours, units: t.units, uph: t.uph, target: tg, targetPct: t.targetPct || 0 };
    }).sort(function (a, b) { return b.hours - a.hours; });
    var t = finish(e.t);
    var unitsOnTarget = projs.reduce(function (a, p) { return a + (p.target ? p.units : 0); }, 0);
    return { name: n, hours: t.hours, units: t.units, uph: t.uph, labor: t.labor, revenue: t.revenue, margin: t.margin,
      otHours: t.empOtHours, days: 0, projects: projs, targetPct: expected > 0 ? Math.round(unitsOnTarget / expected * 100) : null,
      targetHours: round2_(targetHours) };
  });
  var dayCount = {}; rows.forEach(function (r) { (dayCount[r.name] = dayCount[r.name] || {})[r.date] = true; });
  empOut.forEach(function (e) { e.days = Object.keys(dayCount[e.name] || {}).length; });
  empOut.sort(function (a, b) { return a.name.localeCompare(b.name); });

  // Trend: daily up to 92 days, weekly beyond.
  var spanDays = Math.round((parseYmd_(end) - parseYmd_(start)) / 864e5) + 1, trend = [];
  if (spanDays <= 92) {
    for (var d = start, guard = 0; d <= end && guard < 100; d = addDays_(d, 1), guard++) {
      var x = byD[d] ? finish(byD[d]) : finish(blank()); trend.push({ label: d, units: x.units, hours: x.hours, revenue: x.revenue, labor: x.labor, margin: x.margin, uph: x.uph });
    }
  } else {
    var wk = {};
    Object.keys(byD).forEach(function (dd) { var w = weekStart_(dd); var t = wk[w] = wk[w] || blank(); ['units','hours','labor','revenue','margin'].forEach(function (k) { t[k] += byD[dd][k]; }); });
    Object.keys(wk).sort().forEach(function (w) { var t = wk[w]; trend.push({ label: w, week: true, units: round2_(t.units), hours: round2_(t.hours), revenue: round2_(t.revenue), labor: round2_(t.labor), margin: round2_(t.margin), uph: t.hours ? round2_(t.units / t.hours) : 0 }); });
  }

  // OT watch: the Sun–Sat week that holds the end date (or today, if the range runs past today).
  var watchDay = end > today_() ? today_() : end, ws = weekStart_(watchDay), we = addDays_(ws, 6), wh = {};
  all.forEach(function (r) { if (r.date >= ws && r.date <= we && r.name) { var w = wh[r.name] = wh[r.name] || { hours: 0, ot: 0 }; w.hours += r.hours; w.ot += r.empOt; } });
  var otWatch = Object.keys(wh).map(function (n) { return { name: n, hours: round2_(wh[n].hours), otHours: round2_(wh[n].ot), left: round2_(Math.max(0, s.OT_WEEKLY_THRESHOLD - wh[n].hours)) }; })
    .filter(function (w) { return w.hours >= s.OT_WATCH_HOURS || w.otHours > 0; }).sort(function (a, b) { return b.hours - a.hours; });

  return { start: start, end: end, total: finish(total), projects: projOut, employees: empOut, trend: trend,
    otWatch: { weekStart: ws, weekEnd: we, threshold: s.OT_WEEKLY_THRESHOLD, watch: s.OT_WATCH_HOURS, people: otWatch } };
}

var MONEY_KEYS = ['labor', 'revenue', 'margin', 'marginPct', 'laborPerUnit', 'breakevenUnits', 'custOtRevenue'];
function stripMoney_(o) {
  if (Array.isArray(o)) { o.forEach(stripMoney_); return o; }
  if (o && typeof o === 'object') { MONEY_KEYS.forEach(function (k) { delete o[k]; }); Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') stripMoney_(o[k]); }); }
  return o;
}

function apiAnalytics_(b, who) {
  if (!validYmd_(b.start) || !validYmd_(b.end) || b.end < b.start) bad_('dates');
  var a = analytics_(b.start, b.end);
  if (b.compare) {   // the same-length period just before, for "vs previous" on the tiles
    var span = Math.round((parseYmd_(b.end) - parseYmd_(b.start)) / 864e5) + 1;
    a.previous = analytics_(addDays_(b.start, -span), addDays_(b.start, -1)).total;
  }
  return isMoney_(who) ? a : stripMoney_(a);
}

// =========================================================================================
// Timeclock comparison (optional — sql/production_timeclock.sql)
// =========================================================================================
function timeclockRows_(start, end, ids) {
  var key = props_().getProperty('PROD_TIMECLOCK_KEY');
  if (!key) return { configured: false };
  var r = supa_('prod_timeclock_hours', { p_key: key, p_start: start, p_end: end, p_emp_ids: ids.map(Number) });
  if (!r || !r.ok) return { configured: true, error: (r && r.error) || 'failed' };
  return { configured: true, rows: r.rows || [], synced: r.last_synced_at || null };
}

function timeclockCompare_(start, end, data) {
  var emps = getEmployees_(), byId = {}, ids = [];
  emps.forEach(function (e) { if (e.empId) { byId[e.empId] = e; ids.push(e.empId); } });
  data = data || readProd_();
  var dates = []; for (var d = start; d <= end; d = addDays_(d, 1)) dates.push(d);
  var prod = {};
  data.rows.forEach(function (r) { if (r.date >= start && r.date <= end) { var p = prod[r.name] = prod[r.name] || {}; p[r.date] = (p[r.date] || 0) + r.hours; } });
  var tc = ids.length ? timeclockRows_(start, end, ids) : { configured: !!props_().getProperty('PROD_TIMECLOCK_KEY'), rows: [] };
  var clock = {}, open = {};
  (tc.rows || []).forEach(function (x) { var e = byId[String(x.emp_id)]; if (!e) return; (clock[e.name] = clock[e.name] || {})[String(x.date).slice(0, 10)] = num_(x.hours); if (x.open_punch) (open[e.name] = open[e.name] || {})[String(x.date).slice(0, 10)] = true; });
  var people = emps.filter(function (e) { return e.empId && (e.active || prod[e.name] || clock[e.name]); }).map(function (e) {
    var days = dates.map(function (dd) { return { date: dd, prod: round2_((prod[e.name] || {})[dd] || 0), clock: round2_((clock[e.name] || {})[dd] || 0), open: !!((open[e.name] || {})[dd]) }; });
    var tp = days.reduce(function (a, x) { return a + x.prod; }, 0), tcl = days.reduce(function (a, x) { return a + x.clock; }, 0);
    return { name: e.name, empId: e.empId, days: days, prod: round2_(tp), clock: round2_(tcl), gap: round2_(tcl - tp) };
  }).filter(function (p) { return p.prod > 0 || p.clock > 0; });
  var unlinked = Object.keys(prod).filter(function (n) { return !emps.some(function (e) { return e.name === n && e.empId; }); }).sort();
  return { configured: tc.configured, error: tc.error || null, synced: tc.synced || null, dates: dates, people: people, unlinked: unlinked };
}

function apiTimeclock_(b) {
  if (!validYmd_(b.date)) bad_('date');
  var ws = weekStart_(b.date);
  var out = timeclockCompare_(ws, addDays_(ws, 6));
  out.gapHours = getSettings_().TIMECLOCK_GAP_HOURS;
  return out;
}

// =========================================================================================
// API — admin
// =========================================================================================
function apiSaveProject_(b, who) {
  var name = String(b.name || '').trim().slice(0, 60);
  if (!name) bad_('Give the project a name.');
  var target = Math.max(0, num_(b.target)), sort = num_(b.sort), active = b.active !== false;
  var hasRate = b.rate !== '' && b.rate != null;
  var rate = round2_(b.rate), from = b.effectiveDate || today_();
  if (hasRate && !(rate >= 0)) bad_('Billing rate must be a number.');
  if (hasRate && !validYmd_(from)) bad_('Pick the date the new price starts.');
  return withLock_(function () {
    var sh = sheet_(TAB.PROJECTS, ['Key', 'Display Name', 'Active', 'Sort', 'Target Units/Hr']), rows = rows_(sh, 5);
    var key = String(b.key || ''), at = -1;
    rows.forEach(function (r, i) {
      if (String(r[0]).trim() === key) at = i;
      if (String(r[1]).trim().toLowerCase() === name.toLowerCase() && String(r[0]).trim() !== key) bad_('There is already a project called ' + name + '.');
    });
    var hist = getRateHistory_();
    if (!key) {
      if (!hasRate) bad_('A new project needs a billing rate.');
      key = 'p' + name.replace(/[^A-Za-z0-9]+/g, '').slice(0, 24) + Utilities.getUuid().slice(0, 4);
      sh.appendRow([key, name, active, sort || rows.length + 1, target]);
    } else {
      if (at < 0) bad_('Project not found.');
      sh.getRange(at + 2, 2, 1, 4).setValues([[name, active, sort || rows[at][3], target]]);
    }
    var repriced = 0;
    if (hasRate && (!hist[key] || rateFor_(hist, key, from) !== rate)) {
      sheet_(TAB.RATES, ['Project Key', 'Rate', 'Effective Date', 'Changed By', 'Changed At', 'Note'])
        .appendRow([key, rate, parseYmd_(from), who.name, new Date(), String(b.note || '').slice(0, 200)]);
      if (b.applyToExisting) repriced = reprice_(key);
    }
    audit_(who, 'save project', key, { name: name, active: active, target: target, rate: hasRate ? rate : undefined, from: hasRate ? from : undefined, repriced: repriced });
    return { projectKey: key, repriced: repriced };
  });
}

/** Re-applies the price history to every saved row of one project (when a price change is back-dated). */
function reprice_(key) {
  var hist = getRateHistory_(), data = readProd_(), changed = [];
  data.rows.forEach(function (r) {
    if (r.project !== key) return;
    var bill = rateFor_(hist, key, r.date);
    if (bill === r.bill) return;
    var row = data.values[r.idx];
    var rev = round2_(r.units * bill + r.custOtRev);
    row[C.BILL - 1] = bill; row[C.REV - 1] = rev; row[C.MARGIN - 1] = round2_(rev - r.labor);
    changed.push(r.idx);
  });
  writeBack_(data, changed);
  return changed.length;
}

function apiRateHistory_(b) {
  var h = getRateHistory_()[String(b.key || '')] || [];
  return { history: h.slice().reverse() };
}

function apiSaveEmployee_(b, who) {
  var name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 60), orig = String(b.originalName || '').trim();
  var rate = round2_(b.rate), empId = String(b.empId || '').replace(/\D/g, ''), active = b.active !== false;
  if (!name) bad_('Enter a name.');
  if (!(rate > 0) || rate > 200) bad_('Enter the hourly pay rate.');
  return withLock_(function () {
    var sh = ss_().getSheetByName(CONFIG.EMPLOYEES_SHEET_NAME), rows = rows_(sh, 4), at = -1, dup = false;
    rows.forEach(function (r, i) {
      var n = String(r[0] || '').trim();
      if (orig && n === orig) at = i;
      if (n.toLowerCase() === name.toLowerCase() && n !== orig) dup = true;
      if (empId && String(r[3] || '').replace(/\D/g, '') === empId && n !== orig) bad_('Employee ID ' + empId + ' is already linked to ' + n + '.');
    });
    if (dup) bad_('There is already an employee called ' + name + '.');
    var renamed = 0;
    if (orig) {
      if (at < 0) bad_('Employee not found.');
      sh.getRange(at + 2, 1, 1, 6).setValues([[name, rate, active, empId, who.name, new Date()]]);
      if (name !== orig) renamed = renameEverywhere_(orig, name);
      if (empId) fillEmpId_(name, empId);
    } else {
      sh.appendRow([name, rate, active, empId, who.name, new Date()]);
    }
    sh.getRange(2, 2, Math.max(1, sh.getLastRow() - 1), 1).setNumberFormat('$#,##0.00');
    audit_(who, orig ? 'edit employee' : 'add employee', name, { from: orig || undefined, rate: rate, active: active, empId: empId, renamedRows: renamed });
    return { employees: getEmployees_() };
  });
}

function renameEverywhere_(from, to) {
  var sh = prodSheet_(), n = sh.getLastRow() - 1, count = 0;
  if (n > 0) {
    var col = sh.getRange(2, C.EMP, n, 1).getValues();
    col.forEach(function (r) { if (String(r[0]).trim() === from) { r[0] = to; count++; } });
    if (count) sh.getRange(2, C.EMP, n, 1).setValues(col);
  }
  var cs = ss_().getSheetByName(TAB.CREWS);
  rows_(cs, 2).forEach(function (r, i) {
    var m = []; try { m = JSON.parse(r[1] || '[]'); } catch (e) {}
    if (m.indexOf(from) >= 0) cs.getRange(i + 2, 2).setValue(JSON.stringify(m.map(function (x) { return x === from ? to : x; })));
  });
  return count;
}
function fillEmpId_(name, empId) {
  var sh = prodSheet_(), n = sh.getLastRow() - 1; if (n < 1) return;
  var rng = sh.getRange(2, C.EMP, n, C.EMPID - C.EMP + 1), v = rng.getValues(), hit = false, off = C.EMPID - C.EMP;
  v.forEach(function (r) { if (String(r[0]).trim() === name && String(r[off]) !== empId) { r[off] = empId; hit = true; } });
  if (hit) sh.getRange(2, C.EMPID, n, 1).setValues(v.map(function (r) { return [r[off]]; }));
}

function apiSaveSettings_(b, who) {
  var vals = {
    OT_BILLING_RATE: round2_(b.otBillingRate), OT_WEEKLY_THRESHOLD: num_(b.otThreshold), OT_MULTIPLIER: num_(b.otMultiplier),
    OT_WATCH_HOURS: num_(b.otWatch), REPORT_RECIPIENTS: String(b.recipients || ''), REPORT_ENABLED: b.reportEnabled !== false,
    TIMECLOCK_GAP_HOURS: num_(b.gapHours)
  };
  if (!(vals.OT_BILLING_RATE >= 0)) bad_('Customer OT rate');
  if (!(vals.OT_WEEKLY_THRESHOLD > 0 && vals.OT_WEEKLY_THRESHOLD <= 80)) bad_('Weekly OT threshold must be 1–80 hours.');
  if (!(vals.OT_MULTIPLIER >= 1 && vals.OT_MULTIPLIER <= 3)) bad_('OT multiplier must be between 1 and 3.');
  if (!(vals.OT_WATCH_HOURS > 0)) vals.OT_WATCH_HOURS = Math.max(0, vals.OT_WEEKLY_THRESHOLD - 4);
  if (!(vals.TIMECLOCK_GAP_HOURS > 0)) vals.TIMECLOCK_GAP_HOURS = 1;
  var bad = String(vals.REPORT_RECIPIENTS).split(/[,;\s]+/).filter(String).filter(function (x) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
  if (bad.length) bad_('Not an email address: ' + bad.join(', '));
  vals.REPORT_RECIPIENTS = recipients_(vals).join(', ');
  return withLock_(function () {
    var before = getSettings_();
    var sh = sheet_(TAB.SETTINGS, ['Setting', 'Value', 'Updated By', 'Updated At']), rows = rows_(sh, 1), where = {};
    rows.forEach(function (r, i) { where[String(r[0]).trim()] = i + 2; });
    Object.keys(vals).forEach(function (k) {
      var line = [k, vals[k], who.name, new Date()];
      if (where[k]) sh.getRange(where[k], 1, 1, 4).setValues([line]); else sh.appendRow(line);
    });
    var rechecked = 0;
    if (before.OT_WEEKLY_THRESHOLD !== vals.OT_WEEKLY_THRESHOLD || before.OT_MULTIPLIER !== vals.OT_MULTIPLIER) {
      // New OT rules apply from the current week on; past weeks keep what they were paid at.
      var ws = weekStart_(today_()), data = readProd_(), keys = {};
      data.rows.forEach(function (r) { if (r.date >= ws) keys[r.name + '|' + weekStart_(r.date)] = true; });
      rechecked = recalcWeeks_(keys, data);
    }
    audit_(who, 'save settings', '', { before: before, after: vals });
    return { rechecked: rechecked };
  });
}

function apiSaveAccess_(b, who) {
  var id = String(b.empId || '').replace(/\D/g, ''), role = String(b.role || '').toLowerCase();
  if (!id) bad_('Employee ID');
  if (!ROLE_LEVEL[role] && role !== 'none') bad_('Role must be admin, manager, entry or none.');
  if (id === String(who.empId) && role !== 'admin') bad_('You can\'t remove your own admin access here.');
  return withLock_(function () {
    var sh = sheet_(TAB.ACCESS, ['Emp ID', 'Name', 'Role', 'Note']), rows = rows_(sh, 1), at = -1;
    rows.forEach(function (r, i) { if (String(r[0]).trim() === id) at = i; });
    var line = [id, String(b.name || '').slice(0, 60), role, String(b.note || '').slice(0, 120)];
    if (at >= 0) sh.getRange(at + 2, 1, 1, 4).setValues([line]); else sh.appendRow(line);
    audit_(who, 'access', id, { role: role, name: b.name });
    return apiBootstrap_({}, who);
  });
}
function apiRemoveAccess_(b, who) {
  var id = String(b.empId || '').replace(/\D/g, '');
  if (id === String(who.empId)) bad_('You can\'t remove yourself.');
  return withLock_(function () {
    var sh = ss_().getSheetByName(TAB.ACCESS), rows = rows_(sh, 1);
    for (var i = rows.length - 1; i >= 0; i--) if (String(rows[i][0]).trim() === id) sh.deleteRow(i + 2);
    audit_(who, 'access removed', id, {});
    return apiBootstrap_({}, who);
  });
}

function apiRecalcOt_(b, who) {
  if (!validYmd_(b.start) || !validYmd_(b.end)) bad_('dates');
  return withLock_(function () {
    var data = readProd_(), keys = {}, ws = weekStart_(b.start), we = addDays_(weekStart_(b.end), 6);
    data.rows.forEach(function (r) { if (r.date >= ws && r.date <= we) keys[r.name + '|' + weekStart_(r.date)] = true; });
    var n = recalcWeeks_(keys, data);
    audit_(who, 'recheck OT', ws + '..' + we, { rowsChanged: n });
    return { changed: n, weeks: Object.keys(keys).length };
  });
}

function apiAuditLog_(b) {
  var sh = ss_().getSheetByName(TAB.AUDIT); if (!sh || sh.getLastRow() < 2) return { log: [] };
  var n = Math.min(sh.getLastRow() - 1, Math.max(10, Math.min(500, num_(b.limit) || 150)));
  var v = sh.getRange(sh.getLastRow() - n + 1, 1, n, 6).getValues().reverse();
  return { log: v.map(function (r) { return { at: r[0] instanceof Date ? r[0].toISOString() : String(r[0]), who: r[1], action: r[3], ref: r[4], details: String(r[5] || '') }; }) };
}

function apiSendReport_(b, who) {
  var email = String(b.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad_('Enter an email address.');
  if (!validYmd_(b.start) || !validYmd_(b.end) || b.end < b.start) bad_('dates');
  var r = buildRangeReport_(b.start, b.end);
  GmailApp.sendEmail(email, r.subject, 'Production analytics report. Please view in an HTML-capable email client.',
    { htmlBody: r.html, attachments: r.attachments, name: 'LWH Production' });
  audit_(who, 'email report', email, { start: b.start, end: b.end });
  return { message: 'Report sent to ' + email };
}

function apiSendDailyNow_(b, who) {
  var r = sendDailyReport(true);
  audit_(who, 'send daily report now', '', r);
  if (!r.success) throw new Error(r.error || 'failed');
  return { message: r.message };
}

// =========================================================================================
// Email
// =========================================================================================
function reportHtml_(o) {
  var num = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };
  var money = function (v) { return '$' + num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var integer = function (v) { return Math.round(num(v)).toLocaleString('en-US'); };
  var dec = function (v) { return num(v).toFixed(1); };
  var pct = function (v) { return dec(v) + '%'; };
  var esc = function (v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var ink = '#191919', red = BRAND, gray = '#64748B', border = '#E5E7EB', good = '#15803D', warn = '#B45309';
  var cell = 'font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;';
  var section = function (name, detail) { return '<tr><td style="padding:19px 22px 9px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:4px solid ' + red + ';padding:3px 0 3px 10px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:' + ink + ';">' + esc(name) + '</td><td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:' + gray + ';">' + esc(detail || '') + '</td></tr></table></td></tr>'; };
  var tile = function (label, value, accent, sub) { return '<td width="50%" valign="top" style="padding:4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td style="border:1px solid ' + border + ';border-top:3px solid ' + (accent ? red : ink) + ';background:#FFFFFF;padding:13px 12px 12px;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:.6px;color:' + gray + ';font-weight:bold;">' + esc(label).toUpperCase() + '</div><div style="font-family:Arial,Helvetica,sans-serif;font-size:21px;line-height:27px;font-weight:bold;color:' + ink + ';padding-top:4px;">' + esc(value) + '</div>' + (sub ? '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:' + gray + ';padding-top:2px;">' + sub + '</div>' : '') + '</td></tr></table></td>'; };
  var tiles = function (entries) { var out = ''; for (var i = 0; i < entries.length; i += 2) out += '<tr>' + tile.apply(null, entries[i]) + (entries[i + 1] ? tile.apply(null, entries[i + 1]) : '<td width="50%"></td>') + '</tr>'; return '<tr><td style="padding:0 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">' + out + '</table></td></tr>'; };
  var table = function (headers, rows, widths) { return '<tr><td style="padding:0 22px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;table-layout:fixed;"><tr>' + headers.map(function (h, i) { return '<th ' + (widths ? 'width="' + widths[i] + '"' : '') + ' align="' + (i === 0 ? 'left' : 'right') + '" style="' + cell + 'background:#F2F3F5;color:#343A40;padding:9px 6px;border-bottom:2px solid #D1D5DB;font-weight:bold;">' + esc(h) + '</th>'; }).join('') + '</tr>' + rows.map(function (r, j) { return '<tr>' + r.map(function (v, i) { return '<td align="' + (i === 0 ? 'left' : 'right') + '" valign="top" style="' + cell + 'padding:8px 6px;border-bottom:1px solid ' + border + ';background:' + (j % 2 ? '#FAFAFA' : '#FFFFFF') + ';color:' + ink + ';word-wrap:break-word;">' + v + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></td></tr>'; };
  var delta = function (cur, old, type, lowerIsBetter) { var d = num(cur) - num(old); var up = lowerIsBetter ? red : good, down = lowerIsBetter ? good : red; var f = type === 'money' ? money(Math.abs(d)) : type === 'int' ? integer(Math.abs(d)) : dec(Math.abs(d)); return '<span style="color:' + (d > 0 ? up : d < 0 ? down : gray) + ';font-weight:bold;">' + (d > 0 ? '+' : d < 0 ? '−' : '') + f + '</span>'; };
  var tgt = function (p) { if (p == null || !isFinite(p)) return '<span style="color:' + gray + ';">—</span>'; var c = p >= 100 ? good : p >= 85 ? warn : red; return '<span style="color:' + c + ';font-weight:bold;">' + (p >= 100 ? '▲ ' : p >= 85 ? '● ' : '▼ ') + Math.round(p) + '%</span>'; };

  var a = o.main, t = a.total, prev = o.previous, wk = o.week ? o.week.total : null, s = o.settings;
  var h = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Production Analytics</title></head><body style="margin:0;padding:0;background:#F3F4F6;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#F3F4F6;"><tr><td align="center" style="padding:18px 8px;"><table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;border-collapse:collapse;background:#FFFFFF;">';
  h += '<tr><td style="background:#191919;border-bottom:5px solid ' + red + ';padding:22px 24px;"><div style="font-family:Arial,Helvetica,sans-serif;color:#FFFFFF;font-size:19px;font-weight:bold;letter-spacing:.5px;">LOGISTICS WAREHOUSE</div><div style="font-family:Arial,Helvetica,sans-serif;color:#E5E7EB;font-size:12px;padding-top:5px;">PRODUCTION ANALYTICS &nbsp;|&nbsp; ' + esc(o.kicker) + '</div></td></tr>';
  h += '<tr><td style="padding:19px 22px 10px;"><div style="font-family:Arial,Helvetica,sans-serif;color:' + ink + ';font-size:19px;font-weight:bold;">' + esc(o.title) + '</div><div style="font-family:Arial,Helvetica,sans-serif;color:' + gray + ';font-size:12px;padding-top:5px;">' + esc(o.subtitle) + '</div></td></tr>';
  if (!t.hours && !t.units) h += '<tr><td style="padding:4px 22px 6px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:' + gray + ';">No production was recorded for this period.</td></tr>';
  h += section('Financial Snapshot', o.label);
  h += tiles([['Total Revenue', money(t.revenue), false], ['Labor Cost', money(t.labor), false], ['Operating Margin', money(t.margin), true], ['Margin %', pct(t.marginPct), true],
    ['Units', integer(t.units), false, dec(t.uph) + ' units / hour'], ['Production Hours', dec(t.hours), false, integer(t.employeeCount) + (t.employeeCount === 1 ? ' employee · ' : ' employees · ') + integer(t.jobCount) + (t.jobCount === 1 ? ' job' : ' jobs')]]);
  if (t.empOtHours > 0 || t.custOtHours > 0)
    h += section('Overtime', o.label) + tiles([['Employee OT Hours', dec(t.empOtHours), false], ['Customer OT Hours Billed', dec(t.custOtHours), false], ['Customer OT Revenue', money(t.custOtRevenue), true], ['Customer OT Rate / Hr', money(s.OT_BILLING_RATE), false]]);
  if (a.projects.length)
    h += section('Project Breakdown', o.label) + table(['Project', 'Units', 'Hours', 'Units/Hr', '% of Target', 'Revenue', 'Margin'],
      a.projects.map(function (p) { return [esc(p.name), integer(p.units), dec(p.hours), dec(p.uph), p.target ? tgt(p.targetPct) : '<span style="color:' + gray + ';">no target</span>', money(p.revenue), money(p.margin)]; }),
      ['22%', '11%', '10%', '11%', '14%', '16%', '16%']);
  if (a.employees.length) {
    var emps = a.employees.slice().sort(function (x, y) { return (num(y.targetPct) - num(x.targetPct)) || (y.uph - x.uph); }).slice(0, 30);
    h += section('Employee Performance', o.label) + table(['Employee', 'Project', 'Hours', 'Units', 'Units/Hr', '% of Target'],
      emps.map(function (e) { return [esc(e.name), esc(e.projects.map(function (p) { return p.name; }).join(', ')), dec(e.hours), integer(e.units), dec(e.uph), tgt(e.targetPct)]; }),
      ['24%', '26%', '11%', '12%', '12%', '15%']);
  }
  if (prev)
    h += section('Previous Day Comparison', 'DAY OVER DAY') + table(['Metric', 'Previous', 'Current', 'Change'], [
      ['Revenue', money(prev.revenue), money(t.revenue), delta(t.revenue, prev.revenue, 'money')],
      ['Labor Cost', money(prev.labor), money(t.labor), delta(t.labor, prev.labor, 'money', true)],
      ['Units', integer(prev.units), integer(t.units), delta(t.units, prev.units, 'int')],
      ['Units / Hr', dec(prev.uph), dec(t.uph), delta(t.uph, prev.uph, 'dec')],
      ['Hours', dec(prev.hours), dec(t.hours), delta(t.hours, prev.hours, 'dec')]], ['28%', '25%', '25%', '22%']);
  var ow = (o.week || a).otWatch;
  if (ow && ow.people.length)
    h += section('Weekly OT Watch', 'WEEK OF ' + ow.weekStart) + '<tr><td style="padding:0 22px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:' + gray + ';">At ' + ow.watch + '+ production hours this Sun–Sat week (OT starts at ' + ow.threshold + ').</td></tr>' +
      table(['Employee', 'Hours this week', 'OT hours', 'Left before OT'], ow.people.map(function (p) { return [esc(p.name), dec(p.hours), p.otHours > 0 ? '<b style="color:' + red + ';">' + dec(p.otHours) + '</b>' : '0.0', dec(p.left)]; }), ['40%', '22%', '18%', '20%']);
  if (o.timeclock && o.timeclock.configured && !o.timeclock.error) {
    var gap = s.TIMECLOCK_GAP_HOURS, flagged = o.timeclock.people.filter(function (p) { return Math.abs(p.gap) >= gap; });
    h += section('Timeclock Check', o.label);
    h += flagged.length
      ? '<tr><td style="padding:0 22px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:' + gray + ';">Production hours differ from timeclock hours by ' + gap + '+ hours. "No production" = clocked in but nothing entered.</td></tr>' +
        table(['Employee', 'Timeclock', 'Production', 'Difference'], flagged.map(function (p) { return [esc(p.name), dec(p.clock), p.prod ? dec(p.prod) : '<b style="color:' + red + ';">No production</b>', dec(p.gap)]; }), ['40%', '20%', '20%', '20%'])
      : '<tr><td style="padding:0 22px 6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:' + good + ';">✓ Production hours match the timeclock for everyone linked.</td></tr>';
  }
  if (wk)
    h += section('7-Day Performance', o.weekLabel) + tiles([['7-Day Revenue', money(wk.revenue), true], ['Average Daily Revenue', money(num(wk.revenue) / 7), false],
      ['7-Day Units', integer(wk.units), false, dec(wk.uph) + ' units / hour'], ['7-Day Hours', dec(wk.hours), false], ['7-Day Margin', money(wk.margin), false, pct(wk.marginPct)], ['7-Day Employees', integer(wk.employeeCount), false]]);
  h += '<tr><td style="padding:20px 22px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ' + border + ';"></td></tr></table></td></tr>';
  h += '<tr><td style="padding:15px 22px 20px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:' + gray + ';">LOGISTICS WAREHOUSE &nbsp;|&nbsp; Special Projects Analytics<br>' + esc(o.footer) + '<br><a href="' + toolkitUrl_() + '?view=production" style="color:' + red + ';">Open Production in the Warehouse Toolkit</a></td></tr>';
  h += '</table></td></tr></table></body></html>';
  return h;
}

function niceDate_(s) { return Utilities.formatDate(parseYmd_(s), tz_(), 'EEEE, MMMM d, yyyy'); }
function shortDate_(s) { return Utilities.formatDate(parseYmd_(s), tz_(), 'M/d/yyyy'); }

/** The 9 AM daily email (trigger). Same recipients idea as before — now edited in the Toolkit. */
function sendDailyReport(force) {
  try {
    var s = getSettings_();
    if (!s.REPORT_ENABLED && force !== true) return { success: true, message: 'Daily report is turned off in Settings.' };
    var to = recipients_(s);
    if (!to.length) return { success: false, error: 'No report recipients set.' };
    var y = addDays_(today_(), -1), dby = addDays_(y, -1), s7 = addDays_(y, -6);
    var projects = getProjects_(), data = readProd_(projects), opts = { projects: projects, settings: s, rows: data.rows };
    var main = analytics_(y, y, opts), prev = analytics_(dby, dby, opts).total, week = analytics_(s7, y, opts);
    var tc = null; try { if (props_().getProperty('PROD_TIMECLOCK_KEY')) tc = timeclockCompare_(y, y, data); } catch (e) { Logger.log('timeclock: ' + e.message); }
    var html = reportHtml_({ main: main, previous: prev, week: week, timeclock: tc, settings: s, kicker: 'DAILY OPERATIONS',
      title: 'Daily Performance Report', subtitle: niceDate_(y) + '  •  Previous completed day', label: 'YESTERDAY',
      weekLabel: shortDate_(s7) + ' – ' + shortDate_(y), footer: 'Automated daily report  •  Daily and 7-day CSV attachments included' });
    var att = [
      { fileName: 'production_data_' + y + '.csv', content: csv_(y, y, data), mimeType: 'text/csv' },
      { fileName: 'production_data_7day_' + y + '.csv', content: csv_(s7, y, data), mimeType: 'text/csv' }
    ];
    var subject = 'Production Analytics Report - ' + Utilities.formatDate(parseYmd_(y), tz_(), 'EEE MMM dd yyyy');
    to.forEach(function (email) { GmailApp.sendEmail(email, subject, 'Production analytics report. Please view in an HTML-capable email client.', { htmlBody: html, attachments: att, name: 'LWH Production' }); });
    Logger.log('Daily report sent to ' + to.join(', '));
    return { success: true, message: 'Daily report sent to ' + to.join(', ') };
  } catch (error) {
    Logger.log('Error in sendDailyReport: ' + (error.stack || error.message));
    return { success: false, error: error.message };
  }
}

function buildRangeReport_(start, end) {
  var s = getSettings_(), projects = getProjects_(), data = readProd_(projects), opts = { projects: projects, settings: s, rows: data.rows };
  var main = analytics_(start, end, opts), w0 = addDays_(end, -6), week = analytics_(w0, end, opts);
  var single = start === end, label = single ? shortDate_(start) : shortDate_(start) + ' – ' + shortDate_(end);
  var prev = single ? analytics_(addDays_(start, -1), addDays_(start, -1), opts).total : null;
  var html = reportHtml_({ main: main, previous: prev, week: week, timeclock: null, settings: s, kicker: 'REPORT',
    title: single ? 'Daily Performance Report' : 'Production Report', subtitle: single ? niceDate_(start) : niceDate_(start) + ' to ' + niceDate_(end),
    label: single ? 'DAY' : 'PERIOD', weekLabel: shortDate_(w0) + ' – ' + shortDate_(end), footer: 'Sent from the Warehouse Toolkit  •  CSV attached' });
  return { html: html, subject: 'Production Analytics Report - ' + label,
    attachments: [{ fileName: 'production_' + start + '_to_' + end + '.csv', content: csv_(start, end, data), mimeType: 'text/csv' }] };
}

function csv_(start, end, data) {
  var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var out = HEADERS.map(q).join(',') + '\n';
  data.rows.filter(function (r) { return r.date >= start && r.date <= end; }).forEach(function (r) {
    var row = data.values[r.idx].slice();
    row[C.DATE - 1] = shortDate_(r.date);
    if (row[C.AT - 1] instanceof Date) row[C.AT - 1] = Utilities.formatDate(row[C.AT - 1], tz_(), 'M/d/yyyy h:mm a');
    out += row.map(q).join(',') + '\n';
  });
  return out;
}

// =========================================================================================
// One-time setup / maintenance (run from the Apps Script editor)
// =========================================================================================
/** Adds the new tabs and columns. Never deletes or clears anything. Safe to run again. */
function setupProductionV2() {
  var ss = ss_(), log = [];
  // Production: header for new columns + IDs for old rows (each old row becomes a one-person job).
  var sh = ss.getSheetByName(CONFIG.PRODUCTION_SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(CONFIG.PRODUCTION_SHEET_NAME); sh.getRange(1, 1, 1, NCOL).setValues([HEADERS]).setFontWeight('bold'); sh.setFrozenRows(1); log.push('Created Production tab'); }
  if (sh.getMaxColumns() < NCOL) sh.insertColumnsAfter(sh.getMaxColumns(), NCOL - sh.getMaxColumns());
  var head = sh.getRange(1, 1, 1, NCOL).getValues()[0];
  for (var c = 13; c < NCOL; c++) if (!head[c]) { sh.getRange(1, c + 1).setValue(HEADERS[c]).setFontWeight('bold'); log.push('Added column ' + HEADERS[c]); }
  var last = sh.getLastRow();
  if (last > 1) {
    var rng = sh.getRange(2, C.ENTRY, last - 1, C.REG - C.ENTRY + 1), v = rng.getValues(), hv = sh.getRange(2, C.HOURS, last - 1, 1).getValues(),
        ov = sh.getRange(2, C.EMPOT, last - 1, 1).getValues(), filled = 0;
    v.forEach(function (r, i) {
      if (!r[0]) { var id = newId_('E'); r[0] = id; r[1] = r[1] || 'J' + id.slice(1); filled++; }
      if (r[3] === '' || r[3] == null) r[3] = round2_(Math.max(0, num_(hv[i][0]) - num_(ov[i][0])));
    });
    rng.setValues(v);
    sh.getRange(2, C.ENTRY, last - 1, 3).setNumberFormat('@');
    if (filled) log.push('Gave IDs to ' + filled + ' existing rows');
  }
  [[14, 120], [15, 120], [16, 70], [17, 90], [18, 140], [19, 150], [20, 220]].forEach(function (w) { sh.setColumnWidth(w[0], w[1]); });
  try { sh.getRange('C2:C').clearDataValidations(); } catch (e) {}   // project list now lives in the Projects tab

  // Employees: Active / Emp ID / Updated columns
  var es = ss.getSheetByName(CONFIG.EMPLOYEES_SHEET_NAME) || ss.insertSheet(CONFIG.EMPLOYEES_SHEET_NAME);
  var eh = ['Name', 'Hourly Rate', 'Active', 'Emp ID', 'Updated By', 'Updated At'];
  if (es.getMaxColumns() < 6) es.insertColumnsAfter(es.getMaxColumns(), 6 - es.getMaxColumns());
  var cur = es.getRange(1, 1, 1, 6).getValues()[0];
  eh.forEach(function (x, i) { if (!cur[i]) es.getRange(1, i + 1).setValue(x).setFontWeight('bold'); });
  if (es.getLastRow() > 1) {
    var ac = es.getRange(2, 3, es.getLastRow() - 1, 1), av = ac.getValues(); var n = 0;
    av.forEach(function (r) { if (r[0] === '' || r[0] == null) { r[0] = true; n++; } }); ac.setValues(av);
    if (n) log.push('Marked ' + n + ' employees Active');
  }
  es.setFrozenRows(1);

  // Projects + Rate History seeded from the old hard-coded list
  var ps = ss.getSheetByName(TAB.PROJECTS);
  if (!ps) {
    ps = sheet_(TAB.PROJECTS, ['Key', 'Display Name', 'Active', 'Sort', 'Target Units/Hr']);
    ps.getRange(2, 1, CONFIG.SEED_ORDER.length, 5).setValues(CONFIG.SEED_ORDER.map(function (k, i) { return [k, CONFIG.SEED_NAMES[k], true, i + 1, '']; }));
    log.push('Created Projects tab');
  }
  var rs = ss.getSheetByName(TAB.RATES);
  if (!rs) {
    rs = sheet_(TAB.RATES, ['Project Key', 'Rate', 'Effective Date', 'Changed By', 'Changed At', 'Note']);
    rs.getRange(2, 1, CONFIG.SEED_ORDER.length, 6).setValues(CONFIG.SEED_ORDER.map(function (k) { return [k, CONFIG.SEED_RATES[k], new Date(2000, 0, 1), 'setup', new Date(), 'Starting price (from the old code)']; }));
    rs.getRange('B:B').setNumberFormat('$#,##0.00'); rs.getRange('C:C').setNumberFormat('M/d/yyyy');
    log.push('Created Rate History tab');
  }
  if (!ss.getSheetByName(TAB.SETTINGS)) {
    var st = sheet_(TAB.SETTINGS, ['Setting', 'Value', 'Updated By', 'Updated At']);
    var keys = Object.keys(SETTING_DEFAULTS);
    st.getRange(2, 1, keys.length, 4).setValues(keys.map(function (k) { return [k, SETTING_DEFAULTS[k], 'setup', new Date()]; }));
    log.push('Created Settings tab');
  }
  if (!ss.getSheetByName(TAB.CREWS)) { sheet_(TAB.CREWS, ['Crew Name', 'Members', 'Updated By', 'Updated At']); log.push('Created Crews tab'); }
  if (!ss.getSheetByName(TAB.AUDIT)) { sheet_(TAB.AUDIT, ['When', 'Who', 'Emp ID', 'Action', 'Reference', 'Details']); log.push('Created Audit Log tab'); }
  if (!ss.getSheetByName(TAB.ACCESS)) {
    var acs = sheet_(TAB.ACCESS, ['Emp ID', 'Name', 'Role', 'Note']);
    acs.getRange('A:A').setNumberFormat('@');
    acs.getRange(2, 4).setValue('← add your employee ID here with role admin (roles: admin, manager, entry, none)');
    log.push('Created Access tab — add yourself as admin');
  }
  SpreadsheetApp.flush();
  Logger.log(log.join('\n') || 'Already set up — nothing to change.');
  return log;
}

/** Rechecks weekly OT for every row in the sheet. Optional — run once after setup if you like. */
function recheckAllOvertime() {
  var n = withLock_(function () { return recalcWeeks_(null); });
  Logger.log('Rows corrected: ' + n);
}

/** Create or recreate the daily 9 AM trigger. */
function createDailyEmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sendDailyReport') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendDailyReport').timeBased().atHour(9).everyDays(1).inTimezone(tz_()).create();
  return { success: true, message: 'Daily email trigger set for 9:00 AM' };
}

/** Send the daily report now (from the editor). */
function testDailyReport() { return sendDailyReport(true); }
