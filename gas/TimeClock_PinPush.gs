/**
 * TimeClock_PinPush.gs  -  in the "New PTO and Attendance Tracker" sheet's Apps Script.
 *
 * v2 (Nov 2026): sends EVERY active employee's PIN (not just Transportation) plus their department,
 * so the same PTO / time off PIN signs people in to the Time Clock, the Driver Toolkit and the
 * Warehouse Toolkit. The PINs are hashed (bcrypt) the moment they arrive; nothing stores them in
 * plain text. Supabase decides who is a driver (Transportation, or a manual link) and who is a
 * Warehouse Toolkit employee (matched by name, or a manual link for legal-name differences).
 *
 * Install / update:  replace this whole file, Save, then run pushDriverPinsToTimeClock once and
 * check View > Executions. The 15-minute trigger you already have keeps working (same function name).
 * The log lists anyone it couldn't match to a driver or a Toolkit employee.
 *
 * Changing the tracker's columns: this finds columns by their header names (Employee ID, Name,
 * Department, STATUS on Employees; Employee ID, Employee Name, PIN on Employee_PINs).
 */
var TC_PIN_URL = 'https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/tc_sync_pins';
var TC_PUBLIC_KEY = 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
var TC_PIN_KEY = PropertiesService.getScriptProperties().getProperty('TC_PIN_KEY') || 'PASTE_YOUR_EXISTING_TC_PIN_KEY_HERE';
var TC_DEPARTMENTS = [];   // empty = everyone. Put department names here to limit it again, e.g. ['Transportation'].

function pushDriverPinsToTimeClock() {
  var ss = SpreadsheetApp.getActive();
  var emp = tcTable_(ss.getSheetByName('Employees'));
  var pins = tcTable_(ss.getSheetByName('Employee_PINs'));
  if (!emp || !pins) throw new Error('Employees or Employee_PINs tab not found.');

  var pinById = {};
  pins.rows.forEach(function (r) {
    var id = tcCell_(r, pins.col, ['Employee ID']).toUpperCase();
    if (id && !(id in pinById)) pinById[id] = tcCell_(r, pins.col, ['PIN']).replace(/\D/g, '');
  });

  var out = [];
  emp.rows.forEach(function (r) {
    var id = tcCell_(r, emp.col, ['Employee ID']).toUpperCase();
    var dept = tcCell_(r, emp.col, ['Department']);
    var status = tcCell_(r, emp.col, ['STATUS', 'Status', 'EmployeeStatus']).toLowerCase();
    if (!id || status === 'inactive') return;
    if (TC_DEPARTMENTS.length && TC_DEPARTMENTS.indexOf(dept) < 0) return;
    out.push({ id: id, name: tcCell_(r, emp.col, ['Name', 'Employee Name']), dept: dept, pin: pinById[id] || '' });
  });
  if (!out.length) throw new Error('No employees found - nothing sent.');

  var res = UrlFetchApp.fetch(TC_PIN_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: TC_PUBLIC_KEY },
    payload: JSON.stringify({ p_secret: TC_PIN_KEY, p_rows: out })
  });
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) {}
  if (res.getResponseCode() !== 200 || !body.ok) {
    throw new Error('PIN push failed: HTTP ' + res.getResponseCode() + ' ' + (body.error || res.getContentText()).toString().slice(0, 300));
  }
  Logger.log('Sent %s people (%s with a PIN, %s matched to a Warehouse Toolkit employee). Not matched to anyone: %s. Drivers with no PIN: %s',
             body.people, body.with_pin, body.toolkit_matched, (body.unmatched || []).join(', ') || 'none',
             (body.drivers_without_pin || []).join(', ') || 'none');
  return body;
}

function installTimeClockPinTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pushDriverPinsToTimeClock') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pushDriverPinsToTimeClock').timeBased().everyMinutes(15).create();
  return pushDriverPinsToTimeClock();
}

function tcTable_(sh) {
  if (!sh) return null;
  var v = sh.getDataRange().getDisplayValues();   // display values keep PINs like 0123 intact
  if (v.length < 2) return { col: {}, rows: [] };
  var col = {};
  v[0].forEach(function (h, i) { h = String(h).trim(); if (h && !(h in col)) col[h] = i; });   // first copy of each header wins
  return { col: col, rows: v.slice(1) };
}
function tcCell_(row, col, names) {
  for (var i = 0; i < names.length; i++) if (names[i] in col) return String(row[col[names[i]]] || '').trim();
  return '';
}
