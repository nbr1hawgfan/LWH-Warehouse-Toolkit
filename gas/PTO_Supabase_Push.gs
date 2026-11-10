/**
 * PTO_Supabase_Push.gs — feeds the Warehouse Toolkit's Absence Calendar.
 *
 * Add this as a NEW script file in the "New PTO and Attendance Tracker" Apps Script project.
 * It only READS the three Export_ tabs that PTO_TLand_Export.gs already writes, and sends them to
 * Supabase (LWH Companion). It does not change any tab, the TLand export, or any other script.
 *
 * Every name in this file starts with ptoSb_ so it can't collide with the tracker's other
 * functions (all .gs files in a project share one namespace). There is no onOpen() here on
 * purpose — the tracker already has one.
 *
 * ONE-TIME SETUP
 *   1. Project Settings (gear) → Script Properties → Add property
 *        Property: PTO_SUPABASE_SECRET     Value: (the secret from PTO_SUPABASE_SECRET.txt)
 *   2. Run ptoSb_testPush once from the editor (approve the permissions prompt).
 *      The log should say "OK — N requests, N employees, N types".
 *   3. Run ptoSb_installTrigger once. That pushes every hour on its own.
 *
 * Only the columns the calendar needs are sent — no emails, no PINs, no manager emails.
 */

const PTO_SB_URL = 'https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/pto_sync_push';
const PTO_SB_KEY = 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';   // public key; the secret is what authorizes the push

const PTO_SB_TABS = {
  requests:  { name: 'Export_PTORequests',  cols: ['EmployeeID', 'EmployeeName', 'AbsenceType', 'StartDate', 'EndDate', 'Status', 'DaysCount'] },
  employees: { name: 'Export_Employees',    cols: ['EmployeeID', 'Name', 'Department', 'Manager', 'PTOBalance', 'PTOAllocation', 'EmployeeStatus'] },
  types:     { name: 'Export_AbsenceTypes', cols: ['AbsenceTypeName', 'Active'] }
};

/** Reads one Export_ tab by header name (column order doesn't matter). */
function ptoSb_readTab_(ss, tab) {
  const sh = ss.getSheetByName(tab.name);
  if (!sh) throw new Error('Tab not found: ' + tab.name + ' (run TLand Export once to create it)');
  const values = sh.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const headers = values[0].map(h => String(h).trim());
  const idx = {};
  tab.cols.forEach(c => {
    const i = headers.indexOf(c);
    if (i < 0 && (c === 'EmployeeID' || c === 'AbsenceTypeName')) throw new Error(tab.name + ' is missing the ' + c + ' column');
    idx[c] = i;
  });
  return values.slice(1)
    .filter(r => r.some(v => String(v).trim() !== ''))
    .map(r => {
      const o = {};
      tab.cols.forEach(c => { o[c] = idx[c] >= 0 ? String(r[idx[c]]).trim() : ''; });
      if ('StartDate' in o) o.StartDate = ptoSb_isoDate_(o.StartDate);
      if ('EndDate' in o) o.EndDate = ptoSb_isoDate_(o.EndDate);
      return o;
    });
}

/** yyyy-MM-dd stays as is; M/D/YYYY (if Sheets ever reformats the tab) becomes yyyy-MM-dd. */
function ptoSb_isoDate_(s) {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : '';
}

/** The push. Safe to run any time; Supabase refuses an empty push instead of wiping the calendar. */
function ptoSb_push() {
  const secret = PropertiesService.getScriptProperties().getProperty('PTO_SUPABASE_SECRET');
  if (!secret) throw new Error('Script Property PTO_SUPABASE_SECRET is not set — see the setup notes at the top of this file.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { console.log('Another run is in progress — skipping this one.'); return null; }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(ptoSb_sheetId_());
    const body = {
      p_secret: secret,
      p_requests:  ptoSb_readTab_(ss, PTO_SB_TABS.requests),
      p_employees: ptoSb_readTab_(ss, PTO_SB_TABS.employees),
      p_types:     ptoSb_readTab_(ss, PTO_SB_TABS.types)
    };
    const res = UrlFetchApp.fetch(PTO_SB_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: PTO_SB_KEY },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    const out = (() => { try { return JSON.parse(res.getContentText()); } catch (e) { return null; } })();
    if (code !== 200 || !out || !out.ok) {
      throw new Error('Supabase push failed (HTTP ' + code + '): ' + res.getContentText().slice(0, 300));
    }
    PropertiesService.getScriptProperties().setProperty('PTO_SUPABASE_LAST_OK', new Date().toISOString());
    console.log('OK — ' + out.requests + ' requests, ' + out.employees + ' employees, ' + out.types + ' types');
    return out;
  } finally {
    lock.releaseLock();
  }
}

/** Run once from the editor to check the setup. */
function ptoSb_testPush() {
  const out = ptoSb_push();
  if (out) Logger.log('OK — %s requests, %s employees, %s types', out.requests, out.employees, out.types);
}

/** Run once: pushes every hour. Re-running replaces the old timer instead of adding a second one. */
function ptoSb_installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'ptoSb_push')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('ptoSb_push').timeBased().everyHours(1).create();
  Logger.log('Hourly Supabase push installed.');
}

/** Turn the hourly push off (the calendar keeps the last data it received). */
function ptoSb_removeTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'ptoSb_push')
    .forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('Hourly Supabase push removed.');
}

/** Only used if this file is ever moved to a standalone script project. */
function ptoSb_sheetId_() {
  const id = PropertiesService.getScriptProperties().getProperty('PTO_SHEET_ID');
  if (!id) throw new Error('No active spreadsheet — set Script Property PTO_SHEET_ID if this script is standalone.');
  return id;
}
