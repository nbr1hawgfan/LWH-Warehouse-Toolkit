/**
 * LWH Sonoco Reels — Employee Production Tracker (Warehouse Toolkit v1.86.0)
 * =========================================================================================
 * This is the complete Code.gs for the existing Sonoco reels "Employee Production Tracker"
 * Apps Script project (the one attached to the Sheet with the Production / Employees / Parts /
 * Standards / Incentives / Prices / Dashboard tabs).
 *
 * What stays exactly as it was:
 *   - the Sheet is still the database
 *   - the 8:00 AM daily production email, the Monday 10:30 weekly incentive email (with XLSX)
 *   - the error alert emails, the 5-minute Dashboard rebuild, the Drive CSV that feeds TLand
 *
 * What is new (search for "TOOLKIT API" near the bottom):
 *   - doPost() — a JSON API the Warehouse Toolkit's "Sonoco Reels" screen calls
 *   - every request is checked: the Toolkit sends the signed-in session, this script asks
 *     Supabase who it is, and only employee IDs on the "Access" tab get in
 *   - the Dashboard rebuild is locked (one at a time) and no longer blanks the tab first
 *   - Toolkit entries record who entered them (new columns at the right; nothing is moved)
 *   - deleting an absence checks the row still matches what was on screen
 *
 * Setup: docs/SONOCO_REELS_SETUP.md in the Toolkit repo. Short version:
 *   1. Keep a copy of the old Code.gs. Paste this file over Code.gs. Leave Index.html alone.
 *   2. Run setupToolkitApi() once. On the new "Access" tab add the employee IDs allowed in.
 *   3. Deploy → NEW deployment → Web app → Execute as: Me, Who has access: Anyone.
 *      (A new deployment leaves the old web app link working until you archive it.)
 *   4. Put the new /exec link in the Toolkit (Sonoco Reels → Connect, or js/sonocoreels.js).
 *
 * Script Properties (Project Settings → Script Properties), all optional:
 *   ADMIN_EMP_IDS                 comma list of employee IDs that always get in (break-glass)
 *   SUPABASE_URL, SUPABASE_KEY    default: the Toolkit's project + publishable key
 *   TOOLKIT_URL                   default: https://nbr1hawgfan.github.io/LWH-Warehouse-Toolkit/
 * =========================================================================================
 */

// ------------------------
// CONFIG — edit recipients here, not buried in functions
// ------------------------
var ERROR_ALERT_RECIPIENT = 'tjennings@logistics-warehouse.com';

var DAILY_REPORT_RECIPIENTS =
  'tjennings@logistics-warehouse.com,rrobertson@logistics-warehouse.com,rhewitt@logistics-warehouse.com,cknautz@logistics-warehouse.com';

var WEEKLY_INCENTIVE_RECIPIENTS =
  'aduggar@logistics-warehouse.com,tjennings@logistics-warehouse.com,rhewitt@logistics-warehouse.com,cknautz@logistics-warehouse.com,rrobertson@logistics-warehouse.com';

  // ============================================================
// ADDITIONS FOR Code.gs -- Dashboard -> Drive CSV export
// (Mirrors the Sonoco sync pattern: one always-current CSV,
//  overwritten in place, picked up by a PowerShell/Task
//  Scheduler job that MERGEs it into TLand.)
//
// HOW TO APPLY:
//   1. Add the two CONFIG lines below near your existing
//      CONFIG block (with ERROR_ALERT_RECIPIENT etc).
//   2. Add the three new functions (getOrCreateExportFolder,
//      writeCsvToFolder, exportDashboardToDrive) anywhere in
//      Code.gs.
//   3. REPLACE your existing updateDashboard() function with
//      the version below -- it's the same logic, plus it now
//      also builds a clean numeric "syncRows" array alongside
//      the display array, and calls exportDashboardToDrive()
//      at the end.
//
// Because updateDashboard() already runs both on every new
// production entry (via submitProductionData) AND every 5
// minutes (via the existing autoRebuildDashboard trigger),
// no new trigger is needed -- the CSV export just rides along
// on both of those.
// ============================================================

// ------------------------
// CONFIG -- add alongside your existing CONFIG block
// ------------------------
var DASHBOARD_EXPORT_FOLDER_NAME = 'ProductionTracker_Exports';
var DASHBOARD_EXPORT_FILE_NAME = 'production_dashboard_current.csv';

// ------------------------
// Drive folder / file helpers
// ------------------------
function getOrCreateExportFolder(folderName) {
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}

function writeCsvToFolder(folder, fileName, csvContent) {
  var files = folder.getFilesByName(fileName);
  if (files.hasNext()) {
    var existing = files.next();
    existing.setContent(csvContent);
    return existing;
  }
  return folder.createFile(fileName, csvContent, MimeType.CSV);
}

// ------------------------
// Push a clean numeric snapshot of the Dashboard to Drive.
// syncRows is an array of arrays (no header) shaped:
// [SourceRow, Date, Employee, PartNumber, Quantity, HoursWorked,
//  PiecesPerHour, StandardPiecesPerHour, PerformancePct, Cost,
//  Incentive, Revenue]
// ------------------------
function exportDashboardToDrive(syncRows) {
  try {
    var header = ['SourceRow', 'WorkDate', 'EmployeeName', 'PartNumber', 'Quantity', 'HoursWorked',
                  'PiecesPerHour', 'StandardPiecesPerHour', 'PerformancePct', 'Cost', 'Incentive', 'Revenue'];
    var csv = buildCsv([header].concat(syncRows));
    var folder = getOrCreateExportFolder(DASHBOARD_EXPORT_FOLDER_NAME);
    writeCsvToFolder(folder, DASHBOARD_EXPORT_FILE_NAME, csv);
  } catch (e) {
    Logger.log('Error in exportDashboardToDrive: ' + e.toString());
    notifyScriptError('exportDashboardToDrive', e);
  }
}

function updateDashboard() {
  // One rebuild at a time (a new entry and the 5-minute trigger can land together).
  // Returns true when rebuilt, 'busy' when another rebuild already holds the lock (not an error), false on error.
  var dashLock = LockService.getScriptLock();
  if (!dashLock.tryLock(25000)) {
    Logger.log('updateDashboard: another rebuild was still running after 25s — skipped.');
    return 'busy';
  }
  var t0 = Date.now(), lap = function (what) { Logger.log('updateDashboard: ' + what + ' at ' + ((Date.now() - t0) / 1000).toFixed(1) + 's'); };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var dashboardSheet = ss.getSheetByName('Dashboard');
    var productionSheet = ss.getSheetByName('Production');
    var employeesSheet = ss.getSheetByName('Employees');
    var standardsSheet = ss.getSheetByName('Standards');
    var incentivesSheet = ss.getSheetByName('Incentives');

    if (!dashboardSheet) throw new Error('Sheet "Dashboard" not found — check the tab name/spelling.');
    if (!productionSheet) throw new Error('Sheet "Production" not found — check the tab name/spelling.');
    if (!employeesSheet) throw new Error('Sheet "Employees" not found — check the tab name/spelling.');
    if (!standardsSheet) throw new Error('Sheet "Standards" not found — check the tab name/spelling.');
    if (!incentivesSheet) throw new Error('Sheet "Incentives" not found — check the tab name/spelling.');

    var productionData = productionSheet.getDataRange().getValues();
    var employeesData = employeesSheet.getDataRange().getValues();
    var standardsData = standardsSheet.getDataRange().getValues();
    var incentivesData = incentivesSheet.getDataRange().getValues();
    var prices = getPrices();
    var inputsFp = dashboardFingerprint_(productionData, employeesData, standardsData, incentivesData, prices);
    lap('read ' + (productionData.length - 1) + ' production rows');

    // (No clear() up front any more — the old rows stay readable until the new ones are written.)
    var oldLastRow = dashboardSheet.getLastRow();
    var dashboard = [['Date', 'Employee', 'Part Number', 'Quantity', 'Hours Worked', 'Pieces/Hour', 'Standard Pieces/Hour', 'Performance', 'Cost', 'Incentive', 'Revenue']];
    var syncRows = [];  // clean numeric rows for the Drive/SQL export

    for (var i = 1; i < productionData.length; i++) {
      var row = productionData[i];
      var date = row[0] instanceof Date ? row[0] : new Date(row[0]);
      var formattedDate = formatDateKey(date);
      var employeeId = row[1];
      var partNumber = row[2];
      var quantity = row[3];
      var hoursWorked = row[4];

      var employee = employeesData.find(function (e) { return e[0] == employeeId; });
      var employeeName = employee ? employee[1] : 'Unknown';
      var hourlyRate = employee ? employee[2] : 0;

      var standard = standardsData.find(function (s) { return s[0] == partNumber; });
      var standardPPH = standard ? standard[1] : 0;

      var piecesPerHour = hoursWorked > 0 ? quantity / hoursWorked : 0;
      var performance = standardPPH > 0 ? (piecesPerHour / standardPPH) * 100 : 0;
      var cost = hoursWorked * hourlyRate;

      var incentive = 0;
      var piecesOverStandard = quantity - (standardPPH * hoursWorked);
      if (piecesOverStandard > 0) {
        var incentiveRate = incentivesData.find(function (inc) { return inc[0] == partNumber; });
        if (incentiveRate) incentive = piecesOverStandard * incentiveRate[2];
      }

      var price = prices[partNumber] || 0;
      var revenue = quantity * price;

      dashboard.push([
        formattedDate, employeeName, partNumber,
        quantity.toString(), hoursWorked.toString(),
        piecesPerHour.toFixed(4), standardPPH.toString(),
        performance.toFixed(2) + '%',
        cost.toFixed(2), incentive.toFixed(2), revenue.toFixed(2)
      ]);

      // SourceRow = i, matching the Production row this came from 1:1 --
      // stable as long as Production rows are only ever appended, never
      // reordered/deleted (true today per submitProductionData()).
      syncRows.push([
        i, formattedDate, employeeName, partNumber,
        quantity, hoursWorked,
        Number(piecesPerHour.toFixed(4)), standardPPH,
        Number(performance.toFixed(2)),
        Number(cost.toFixed(2)), Number(incentive.toFixed(2)), Number(revenue.toFixed(2))
      ]);
    }

    dashboardSheet.getRange(1, 1, dashboard.length, dashboard[0].length).setValues(dashboard);
    if (oldLastRow > dashboard.length) {
      dashboardSheet.getRange(dashboard.length + 1, 1, oldLastRow - dashboard.length,
        Math.max(dashboardSheet.getLastColumn(), dashboard[0].length)).clearContent();
    }
    if (dashboard.length > 1) {
      dashboardSheet.getRange(2, 1, dashboard.length - 1, 1).setNumberFormat('yyyy-MM-dd');
    }
    SpreadsheetApp.flush();
    lap('wrote Dashboard');

    exportDashboardToDrive(syncRows);
    lap('wrote Drive CSV');

    // Remember what this rebuild was built from, so the 5-minute trigger can skip when nothing has changed.
    PropertiesService.getScriptProperties().setProperty(DASH_FP_KEY, inputsFp + '|' + dashboard.length);
    return true;
  } catch (e) {
    Logger.log('Error in updateDashboard: ' + e.toString());
    notifyScriptError('updateDashboard', e);
    return false;
  } finally {
    dashLock.releaseLock();
  }
}

// ------------------------
// Error alerting
// ------------------------
function notifyScriptError(context, err) {
  try {
    var detail = (err && err.stack) ? err.stack : (err && err.message ? err.message : String(err));
    MailApp.sendEmail({
      to: ERROR_ALERT_RECIPIENT,
      subject: 'Production Tracker ERROR: ' + context,
      body: 'An error occurred in "' + context + '" at ' + new Date().toString() + ':\n\n' + detail
    });
  } catch (e2) {
    // If this fails too, at least it's in the log.
    Logger.log('notifyScriptError itself failed: ' + e2);
  }
}

/** Run this manually once to confirm alert emails actually reach your inbox. */
function testErrorAlert() {
  notifyScriptError('testErrorAlert (manual test — this is expected, not a real failure)', new Error('This is a test of the error alert system.'));
  return 'Test alert sent to ' + ERROR_ALERT_RECIPIENT;
}

// ------------------------
// Web App Entry
// ------------------------
function doGet(e) {
  // The screens now live in the Warehouse Toolkit (Sonoco Reels). This script is their API.
  // (An OLDER deployment that is still pinned to the previous version keeps serving the old page.)
  if (e && e.parameter && e.parameter.health) {
    return json_({ ok: true, service: 'LWH Sonoco Reels API', version: TOOLKIT_API_VERSION });
  }
  var url = toolkitUrl_() + '?view=sonocoReels';
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;text-align:center">' +
    '<div style="border:1px solid #ddd;border-top:5px solid #c8102e;padding:24px">' +
    '<h2 style="margin:0 0 8px">The Production Tracker has moved</h2>' +
    '<p>Enter production and see the dashboard in the <b>Warehouse Toolkit &rarr; Sonoco Reels</b>.</p>' +
    '<p><a href="' + url + '" target="_top" style="display:inline-block;background:#c8102e' +
    ';color:#fff;padding:12px 20px;text-decoration:none;font-weight:bold">Open Sonoco Reels</a></p></div></div>'
  ).setTitle('Production Tracker has moved').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function openWebApp() {
  var url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(url);
}

// ------------------------
// Date Functions
// ------------------------
function getTZ() {
  return Session.getScriptTimeZone() || 'America/Chicago';
}

function getTodayString() {
  return Utilities.formatDate(new Date(), getTZ(), 'yyyy-MM-dd');
}

function getYesterdayStringFixed() {
  var now = new Date();
  var tz = getTZ();
  var todayInTZ = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var parts = todayInTZ.split('-');
  var todayLocal = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  var yesterday = new Date(todayLocal);
  yesterday.setDate(yesterday.getDate() - 1);
  return Utilities.formatDate(yesterday, tz, 'yyyy-MM-dd');
}

function getDateStringFixed(daysOffset) {
  var now = new Date();
  var tz = getTZ();
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var parts = todayStr.split('-');
  var baseDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  var targetDate = new Date(baseDate);
  targetDate.setDate(baseDate.getDate() + daysOffset);
  return Utilities.formatDate(targetDate, tz, 'yyyy-MM-dd');
}

function formatDateKey(dateObj) {
  if (!dateObj) return '';
  return Utilities.formatDate(dateObj instanceof Date ? dateObj : new Date(dateObj), getTZ(), 'yyyy-MM-dd');
}

function getCurrentMonthRange() {
  var now = new Date();
  var tz = getTZ();
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var parts = todayStr.split('-');
  var firstOfMonth = parts[0] + '-' + parts[1] + '-01';
  return { start: firstOfMonth, end: todayStr };
}

function getLast30Days() {
  var end = new Date();
  var start = new Date();
  start.setDate(start.getDate() - 30);
  return { start: formatDateKey(start), end: formatDateKey(end) };
}

// ------------------------
// Auto-rebuild dashboard every 5 minutes
// ------------------------
function setupDashboardRebuildTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'autoRebuildDashboard') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('autoRebuildDashboard').timeBased().everyMinutes(5).create();
  return 'Dashboard auto-rebuild trigger set: every 5 minutes.';
}

var DASH_FP_KEY = 'DASHBOARD_INPUTS_FP';

/** A short hash of everything the Dashboard is calculated from. */
function dashboardFingerprint_(productionData, employeesData, standardsData, incentivesData, prices) {
  return hash_(JSON.stringify([productionData, employeesData, standardsData, incentivesData, prices]));
}

/**
 * Runs every 5 minutes. Saves made in the Toolkit already rebuild the Dashboard straight away, so this is only
 * here to pick up edits made directly on the Sheet (a fixed quantity, a new rate or standard). It reads the
 * input tabs and skips the rebuild — no Dashboard write, no Drive write — when nothing has changed since the
 * last rebuild. Most runs end in a second or two.
 */
function autoRebuildDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var read = function (name) { var sh = ss.getSheetByName(name); return sh ? sh.getDataRange().getValues() : []; };
  var dash = ss.getSheetByName('Dashboard');
  var current = dashboardFingerprint_(read('Production'), read('Employees'), read('Standards'), read('Incentives'), getPrices()) +
    '|' + (dash ? dash.getLastRow() : 0);
  if (current === PropertiesService.getScriptProperties().getProperty(DASH_FP_KEY)) return;   // nothing changed

  var ok = updateDashboard();
  if (!ok) notifyScriptError('autoRebuildDashboard', 'updateDashboard() returned false — check Logger for the underlying cause.');
}

// ------------------------
// Sheets Accessors
// ------------------------
function getEmployees() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Employees');
    var data = sheet.getDataRange().getValues();
    return data.slice(1).map(function (row) { return { id: row[0], name: row[1] }; });
  } catch (e) {
    Logger.log('Error in getEmployees: ' + e.toString());
    notifyScriptError('getEmployees', e);
    return [];
  }
}

function getParts() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Parts');
    var data = sheet.getDataRange().getValues();
    return data.slice(1).map(function (row) { return row[0]; });
  } catch (e) {
    Logger.log('Error in getParts: ' + e.toString());
    notifyScriptError('getParts', e);
    return [];
  }
}

function getPrices() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Prices');
    var data = sheet.getDataRange().getValues();
    return data.slice(1).reduce(function (acc, row) {
      if (row[0] && row[1]) acc[row[0]] = row[1];
      return acc;
    }, {});
  } catch (e) {
    Logger.log('Error in getPrices: ' + e.toString());
    notifyScriptError('getPrices', e);
    return {};
  }
}

// ------------------------
// Submit Handlers
// ------------------------
function submitProductionData(data) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Production');
    if (!data || !data.productionDate) throw new Error('Invalid production data');

    var quantity = parseFloat(data.quantity);
    var hoursWorked = parseFloat(data.hoursWorked);
    if (isNaN(quantity) || quantity <= 0) throw new Error('Quantity must be a positive number');
    if (isNaN(hoursWorked) || hoursWorked <= 0) throw new Error('Hours worked must be a positive number');

    var dateParts = data.productionDate.split('-');
    var date = new Date(parseInt(dateParts[0], 10), parseInt(dateParts[1], 10) - 1, parseInt(dateParts[2], 10), 12, 0, 0, 0);

    var prodRow = [date, data.employeeId, data.partNumber, quantity, hoursWorked];
    if (data.enteredBy) prodRow.push(data.enteredBy, new Date());   // columns F-G: Entered By, Entered At
    sheet.appendRow(prodRow);

    try {
      var ok = updateDashboard();
      if (!ok) notifyScriptError('submitProductionData -> updateDashboard', 'Dashboard rebuild returned false after a new entry was saved.');
    } catch (dashErr) {
      Logger.log('Dashboard rebuild error: ' + dashErr);
      notifyScriptError('submitProductionData -> updateDashboard', dashErr);
    }

    return 'Production data submitted successfully!';
  } catch (e) {
    Logger.log('Error in submitProductionData: ' + e.toString());
    return 'Error submitting production data: ' + e.message;
  }
}

function submitNewEmployee(data) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Employees');
    if (!data || !data.employeeId || !data.name) throw new Error('Invalid employee data');

    var hourlyRate = parseFloat(data.hourlyRate);
    if (isNaN(hourlyRate) || hourlyRate <= 0) throw new Error('Hourly rate must be a positive number');

    var existingData = sheet.getDataRange().getValues();
    var exists = existingData.some(function (row) { return row[0] === data.employeeId; });
    if (exists) throw new Error('Employee ID already exists');

    sheet.appendRow([data.employeeId, data.name, hourlyRate]);
    return 'New employee added successfully!';
  } catch (e) {
    Logger.log('Error in submitNewEmployee: ' + e.toString());
    return 'Error adding new employee: ' + e.message;
  }
}

// ------------------------
// Attendance / Absence Tracking
// (Call-In / Unexcused disqualify incentive pay for the week; PTO never does)
// ------------------------
function getOrCreateAttendanceSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Attendance');
  if (!sheet) {
    sheet = ss.insertSheet('Attendance');
    sheet.appendRow(['Date', 'Employee ID', 'Employee Name', 'Absence Type', 'Notes']);
    sheet.setFrozenRows(1);
    var headerRange = sheet.getRange(1, 1, 1, 5);
    headerRange.setFontWeight('bold').setBackground('#1e3a8a').setFontColor('#ffffff');
    sheet.getRange('A:A').setNumberFormat('yyyy-MM-dd');
  }
  return sheet;
}

function submitAbsence(data) {
  try {
    if (!data || !data.absenceDate || !data.employeeId || !data.absenceType) {
      throw new Error('Missing required absence data');
    }
    var sheet = getOrCreateAttendanceSheet();
    var dateParts = data.absenceDate.split('-');
    var date = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]), 12, 0, 0);

    var employees = getEmployees();
    var emp = employees.find(function (e) { return String(e.id) === String(data.employeeId); });
    var empName = emp ? emp.name : 'Unknown';

    var absRow = [date, data.employeeId, empName, data.absenceType, data.notes || ''];
    if (data.enteredBy) absRow.push(data.enteredBy, new Date());    // columns F-G: Entered By, Entered At
    sheet.appendRow(absRow);
    var newRow = sheet.getLastRow();
    sheet.getRange(newRow, 1).setNumberFormat('yyyy-MM-dd');

    return 'Absence recorded successfully for ' + empName + '.';
  } catch (e) {
    Logger.log('Error in submitAbsence: ' + e.toString());
    return 'Error recording absence: ' + e.message;
  }
}

function getAttendanceRecords() {
  try {
    var sheet = getOrCreateAttendanceSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [['Date', 'Employee ID', 'Employee Name', 'Absence Type', 'Notes']];
    return sheet.getRange(1, 1, lastRow, 5).getDisplayValues();
  } catch (e) {
    Logger.log('Error in getAttendanceRecords: ' + e.toString());
    return [['Date', 'Employee ID', 'Employee Name', 'Absence Type', 'Notes']];
  }
}

function deleteAttendanceRecord(rowIndex) {
  try {
    var sheet = getOrCreateAttendanceSheet();
    if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row index: ' + rowIndex);
    sheet.deleteRow(rowIndex);
    return 'Absence record deleted successfully.';
  } catch (e) {
    Logger.log('Error in deleteAttendanceRecord: ' + e.toString());
    return 'Error deleting record: ' + e.message;
  }
}

function getIneligibleEmployeesForWeek(weekStartStr, weekEndStr) {
  try {
    var sheet = getOrCreateAttendanceSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return {};

    var data = sheet.getRange(1, 1, lastRow, 5).getDisplayValues();
    var ineligible = {};
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var rowDate = String(row[0]);
      var empId = String(row[1]);
      var absType = String(row[3]);
      if (absType !== 'Call-In' && absType !== 'Unexcused') continue;
      if (rowDate >= weekStartStr && rowDate <= weekEndStr) ineligible[empId] = absType;
    }
    return ineligible;
  } catch (e) {
    Logger.log('Error in getIneligibleEmployeesForWeek: ' + e.toString());
    notifyScriptError('getIneligibleEmployeesForWeek', e);
    return {};
  }
}

// ------------------------
// Dashboard
// ------------------------


function getAllDashboardData() {
  try {
    var dashboardSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
    if (!dashboardSheet) throw new Error('Sheet "Dashboard" not found — check the tab name/spelling.');
    var lastRow = dashboardSheet.getLastRow();
    if (lastRow === 0) return [['Error retrieving dashboard data']];

    var data = dashboardSheet.getRange(1, 1, lastRow, dashboardSheet.getLastColumn()).getDisplayValues();
    if (data.length <= 1) return data;

    var header = data[0];
    var dataRows = data.slice(1);
    dataRows.sort(function (a, b) {
      if (b[0] > a[0]) return 1;
      if (b[0] < a[0]) return -1;
      return 0;
    });
    return [header].concat(dataRows);
  } catch (e) {
    Logger.log('Error in getAllDashboardData: ' + e.toString());
    notifyScriptError('getAllDashboardData', e);
    return [['Error retrieving dashboard data']];
  }
}

/** Powers the Dashboard tab's "Email Report" button (previously missing/broken). */
function emailDashboardData(emailAddresses) {
  try {
    var recipients = emailAddresses.split(',').map(function (e) { return e.trim(); }).filter(function (e) { return e; });
    if (recipients.length === 0) throw new Error('No valid email addresses provided');

    var range = getCurrentMonthRange();
    var data = getAllDashboardData();
    var filtered = data.filter(function (row, i) {
      if (i === 0) return true;
      var d = String(row[0]);
      return d >= range.start && d <= range.end;
    });

    var subject = 'Dashboard Export - ' + range.start + ' to ' + range.end;
    var csv = buildCsv(filtered);
    var blob = Utilities.newBlob(csv, 'text/csv', subject.replace(/[^a-zA-Z0-9\s-]/g, '') + '.csv');
    var html = buildSimpleOutlookHTML(filtered, subject, range.start + ' to ' + range.end);

    MailApp.sendEmail({ to: recipients.join(','), subject: subject, htmlBody: html, attachments: [blob] });
    return 'Dashboard export sent to ' + recipients.join(', ');
  } catch (e) {
    Logger.log('Error in emailDashboardData: ' + e.toString());
    notifyScriptError('emailDashboardData', e);
    return 'Error sending dashboard export: ' + e.message;
  }
}

// ------------------------
// CSV helper (shared)
// ------------------------
function buildCsv(rows) {
  return (rows || []).map(function (row) {
    return row.map(function (cell) {
      var s = String(cell == null ? '' : cell);
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',');
  }).join('\n');
}

// ------------------------
// Report Functions
// ------------------------
function getDailyProductionReport(targetDate) {
  try {
    var dashboardSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
    if (!dashboardSheet) throw new Error('Sheet "Dashboard" not found — check the tab name/spelling.');
    var lastRow = dashboardSheet.getLastRow();
    if (lastRow === 0) return [['No production data found']];

    var data = dashboardSheet.getRange(1, 1, lastRow, dashboardSheet.getLastColumn()).getDisplayValues();
    var targetKey = targetDate.split('T')[0];

    var dailyData = data.filter(function (row, index) {
      if (index === 0) return true;
      return String(row[0]) === targetKey;
    });

    if (dailyData.length <= 1) return [['No production data found for ' + targetKey]];

    var totalQuantity = 0, totalHours = 0, totalRevenue = 0;
    for (var i = 1; i < dailyData.length; i++) {
      totalQuantity += parseInt(dailyData[i][3]) || 0;
      totalHours += parseFloat(dailyData[i][4]) || 0;
      totalRevenue += parseFloat(dailyData[i][10]) || 0;
    }
    dailyData.push(['TOTAL', '', '', String(totalQuantity), totalHours.toFixed(2), '', '', '', '', '', totalRevenue.toFixed(2)]);
    return dailyData;
  } catch (e) {
    Logger.log('Error in getDailyProductionReport: ' + e.toString());
    notifyScriptError('getDailyProductionReport', e);
    return [['Error generating daily production report: ' + e.message]];
  }
}

function getWeeklyIncentiveReport(startDate, endDate) {
  try {
    var data = getAllDashboardData();
    var startKey = typeof startDate === 'string' ? startDate : formatDateKey(startDate);
    var endKey = typeof endDate === 'string' ? endDate : formatDateKey(endDate);

    var startParts = startKey.split('-');
    var endParts = endKey.split('-');
    var cur = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
    var endObj = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));
    var dateKeys = [];
    while (cur <= endObj) { dateKeys.push(formatDateKey(cur)); cur.setDate(cur.getDate() + 1); }

    var ineligibleMap = getIneligibleEmployeesForWeek(startKey, endKey);

    var empSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Employees');
    if (!empSheet) throw new Error('Sheet "Employees" not found — check the tab name/spelling.');
    var empRows = empSheet.getDataRange().getValues().slice(1);
    var nameToId = {};
    empRows.forEach(function (r) { nameToId[r[1]] = String(r[0]); });

    var employeeData = {};
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var rowKey = String(row[0]);
      if (dateKeys.indexOf(rowKey) === -1) continue;
      var empName = row[1];
      var incentive = parseFloat(row[9]) || 0;
      if (!employeeData[empName]) employeeData[empName] = { total: 0, daily: {}, employeeId: nameToId[empName] || '' };
      employeeData[empName].daily[rowKey] = (employeeData[empName].daily[rowKey] || 0) + incentive;
      employeeData[empName].total += incentive;
    }

    var headers = ['Employee'].concat(dateKeys).concat(['Would Have Earned', 'Payout', 'Status']);
    var report = [headers];

    Object.keys(employeeData).sort().forEach(function (emp) {
      var r = employeeData[emp];
      var reason = ineligibleMap[r.employeeId];
      var eligible = !reason;
      var line = [emp];
      var total = 0;
      dateKeys.forEach(function (k) {
        var v = r.daily[k] || 0;
        line.push(v.toFixed(2));
        total += v;
      });
      line.push(total.toFixed(2));
      line.push(eligible ? total.toFixed(2) : '0.00');
      line.push(eligible ? 'Eligible' : 'INELIGIBLE - ' + reason);
      report.push(line);
    });

    return report;
  } catch (e) {
    Logger.log('Error in getWeeklyIncentiveReport: ' + e.toString());
    notifyScriptError('getWeeklyIncentiveReport', e);
    return [['Error generating report: ' + e.message]];
  }
}

function getMonthlyPartSummaryReport(startDate, endDate) {
  // Kept only because the Reports dropdown in the web UI still offers this
  // as an ad-hoc, on-demand report. No scheduled trigger sends this anymore.
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var dashboardSheet = ss.getSheetByName('Dashboard');
    if (!dashboardSheet) throw new Error('Sheet "Dashboard" not found.');
    var lastRow = dashboardSheet.getLastRow();
    if (lastRow <= 1) return [['No production data found']];

    var data = dashboardSheet.getRange(1, 1, lastRow, dashboardSheet.getLastColumn()).getDisplayValues();
    var startKey = startDate.split('T')[0];
    var endKey = endDate.split('T')[0];
    var partMap = {};

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var rowDate = String(row[0]).split('T')[0];
      if (rowDate < startKey || rowDate > endKey) continue;
      var part = String(row[2] || '');
      if (!part) continue;
      var qty = parseFloat(row[3]) || 0;
      var hours = parseFloat(row[4]) || 0;
      var cost = parseFloat(row[8]) || 0;
      var incentive = parseFloat(row[9]) || 0;
      var revenue = parseFloat(row[10]) || 0;
      var employee = String(row[1] || '');

      if (!partMap[part]) partMap[part] = { pieces: 0, revenue: 0, hours: 0, laborCost: 0, incentives: 0, employees: {} };
      partMap[part].pieces += qty;
      partMap[part].revenue += revenue;
      partMap[part].hours += hours;
      partMap[part].laborCost += cost;
      partMap[part].incentives += incentive;
      partMap[part].employees[employee] = true;
    }

    if (Object.keys(partMap).length === 0) return [['No production data found for ' + startKey + ' to ' + endKey]];

    var header = ['Part Number', 'Total Pieces', 'Total Hours', 'Avg Pieces/Hr', 'Total Revenue', 'Labor Cost', 'Incentives Paid', 'Total Cost', 'Revenue per Hour', 'Unique Employees'];
    var rows = [header];
    var parts = Object.keys(partMap).sort(function (a, b) { return partMap[b].pieces - partMap[a].pieces; });
    var totPieces = 0, totHours = 0, totRevenue = 0, totLabor = 0, totIncentives = 0;

    parts.forEach(function (part) {
      var p = partMap[part];
      var avgPPH = p.hours > 0 ? (p.pieces / p.hours).toFixed(2) : '0.00';
      var totalCost = p.laborCost + p.incentives;
      var revPerHr = p.hours > 0 ? (p.revenue / p.hours).toFixed(2) : '0.00';
      var empCount = Object.keys(p.employees).length;
      rows.push([part, String(Math.round(p.pieces)), p.hours.toFixed(2), avgPPH, p.revenue.toFixed(2), p.laborCost.toFixed(2), p.incentives.toFixed(2), totalCost.toFixed(2), revPerHr, String(empCount)]);
      totPieces += p.pieces; totHours += p.hours; totRevenue += p.revenue; totLabor += p.laborCost; totIncentives += p.incentives;
    });

    rows.push(['TOTAL', String(Math.round(totPieces)), totHours.toFixed(2), totHours > 0 ? (totPieces / totHours).toFixed(2) : '0.00', totRevenue.toFixed(2), totLabor.toFixed(2), totIncentives.toFixed(2), (totLabor + totIncentives).toFixed(2), totHours > 0 ? (totRevenue / totHours).toFixed(2) : '0.00', '']);
    return rows;
  } catch (e) {
    Logger.log('Error in getMonthlyPartSummaryReport: ' + e.toString());
    return [['Error generating monthly report: ' + e.message]];
  }
}

function generateReport(reportType, startDate, endDate) {
  try {
    if (reportType === 'dailyProduction') return getDailyProductionReport(startDate);
    if (reportType === 'dailyEmployeePerformance') return getDailyEmployeePerformanceReport(startDate);
    if (reportType === 'weeklyIncentive') return getWeeklyIncentiveReport(startDate, endDate);
    if (reportType === 'monthlyPartSummary') return getMonthlyPartSummaryReport(startDate, endDate);
    return [['Report type not supported: ' + reportType]];
  } catch (e) {
    Logger.log('Error in generateReport: ' + e.toString());
    return [['Error generating report: ' + e.message]];
  }
}

function getDailyEmployeePerformanceReport(targetDate) {
  // Kept for the ad-hoc Reports dropdown; not part of any scheduled send.
  try {
    var dashboardSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
    if (!dashboardSheet) throw new Error('Sheet "Dashboard" not found.');
    var lastRow = dashboardSheet.getLastRow();
    if (lastRow === 0) return [['No production data found']];

    var data = dashboardSheet.getRange(1, 1, lastRow, dashboardSheet.getLastColumn()).getDisplayValues();
    var targetKey = targetDate.split('T')[0];
    var filtered = data.filter(function (row, index) { if (index === 0) return false; return String(row[0]) === targetKey; });
    if (filtered.length === 0) return [['No production data found for ' + targetKey]];

    var summary = {};
    filtered.forEach(function (row) {
      var employee = row[1];
      var quantity = parseInt(row[3]) || 0;
      var hours = parseFloat(row[4]) || 0;
      var performance = parseFloat(row[7]) || 0;
      var part = row[2];
      if (!summary[employee]) summary[employee] = { totalQuantity: 0, totalHours: 0, performances: [], parts: {} };
      summary[employee].totalQuantity += quantity;
      summary[employee].totalHours += hours;
      summary[employee].performances.push(performance);
      summary[employee].parts[part] = (summary[employee].parts[part] || 0) + quantity;
    });

    var out = [['Date', 'Employee', 'Total Quantity', 'Total Hours', 'Avg Performance', 'Parts Produced']];
    Object.keys(summary).forEach(function (emp) {
      var s = summary[emp];
      var avg = s.performances.length ? s.performances.reduce(function (a, b) { return a + b; }, 0) / s.performances.length : 0;
      var parts = Object.keys(s.parts).map(function (p) { return p + ': ' + s.parts[p]; }).join(', ');
      out.push([targetKey, emp, String(s.totalQuantity), s.totalHours.toFixed(2), avg.toFixed(2) + '%', parts]);
    });
    return out;
  } catch (e) {
    Logger.log('Error in getDailyEmployeePerformanceReport: ' + e.toString());
    return [['Error generating daily employee performance report: ' + e.message]];
  }
}

// ------------------------
// Email HTML Builder (generic — Outlook-compatible, light theme, no emoji)
// ------------------------
function buildSimpleOutlookHTML(report, title, dateString, tableOnly) {
  function esc(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtNumber(n) { var x = Number(n); return isNaN(x) ? '0' : x.toLocaleString(); }
  function fmtHours(n) { var x = Number(n); return isNaN(x) ? '0.0' : x.toFixed(1); }
  function fmtMoney(n) { var x = Number(n); return isNaN(x) ? '$0.00' : '$' + x.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  var recordCount = 0, employeeCount = 0, totalQuantity = 0, totalHours = 0, totalRevenue = 0, totalIncentives = 0;
  var seenEmployees = {};

  if (report && report.length > 1) {
    recordCount = report.length - 1;
    for (var i = 1; i < report.length; i++) {
      var row = report[i] || [];
      var emp = row[1] != null ? String(row[1]) : '';
      if (emp && !seenEmployees[emp]) { seenEmployees[emp] = true; employeeCount++; }
      if (row[3] != null) totalQuantity += parseInt(row[3], 10) || 0;
      if (row[4] != null) totalHours += parseFloat(row[4]) || 0;
      if (row[9] != null) totalIncentives += parseFloat(row[9]) || 0;
      if (row[10] != null) totalRevenue += parseFloat(row[10]) || 0;
    }
  }

  var tableHtml = '';
  if (report && report.length > 0) {
    var hdr = report[0];
    tableHtml += '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border:1px solid #e5e7eb;border-collapse:collapse;">';
    tableHtml += '<thead><tr>';
    for (var h = 0; h < hdr.length; h++) {
      tableHtml += '<th align="left" style="padding:10px 8px;background:#1e3a5f;color:#ffffff;font-family:Arial,sans-serif;font-size:12px;font-weight:700;border-bottom:2px solid #0f2340;">' + esc(String(hdr[h])) + '</th>';
    }
    tableHtml += '</tr></thead><tbody>';
    for (var r = 1; r < report.length; r++) {
      var bg = (r % 2 === 0) ? '#ffffff' : '#f8fafc';
      tableHtml += '<tr>';
      for (var c = 0; c < report[r].length; c++) {
        var cv = report[r][c] == null ? '' : String(report[r][c]);
        tableHtml += '<td style="padding:8px;background:' + bg + ';color:#1e293b;font-family:Arial,sans-serif;font-size:12px;border-bottom:1px solid #e5e7eb;">' + esc(cv) + '</td>';
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table>';
  }

  function card(label, value) {
    return '<td valign="top" width="50%" style="width:50%;padding:0 0 12px 0;">'
      + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border:1px solid #e5e7eb;border-radius:4px;">'
      + '<tr><td style="padding:12px 14px;background:#f8fafc;">'
      + '<div style="font-family:Arial,sans-serif;font-size:11px;color:#64748b;margin:0 0 4px 0;">' + esc(label) + '</div>'
      + '<div style="font-family:Arial,sans-serif;font-size:18px;color:#1e3a5f;font-weight:700;">' + esc(String(value)) + '</div>'
      + '</td></tr></table></td>';
  }

  var kpis = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:separate;border-spacing:10px 0;margin:0 0 14px 0;">'
    + '<tr>' + card('Total Records', fmtNumber(recordCount)) + card('Active Employees', fmtNumber(employeeCount)) + '</tr>'
    + '<tr>' + card('Total Pieces', fmtNumber(totalQuantity)) + card('Total Hours', fmtHours(totalHours)) + '</tr>'
    + '</table>';

  var moneyBand = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 14px 0;border:1px solid #f59e0b;background:#fffbeb;">'
    + '<tr>'
    + '<td style="padding:12px 16px;font-family:Arial,sans-serif;font-size:13px;color:#92400e;"><strong>Total Revenue:</strong> <span style="color:#1e293b;">' + fmtMoney(totalRevenue) + '</span></td>'
    + '<td style="padding:12px 16px;font-family:Arial,sans-serif;font-size:13px;color:#92400e;"><strong>Total Incentives:</strong> <span style="color:#1e293b;">' + fmtMoney(totalIncentives) + '</span></td>'
    + '</tr></table>';

  return '<!doctype html><html><head><meta http-equiv="x-ua-compatible" content="ie=edge">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1.0"/>'
    + '<title>' + esc(title) + '</title>'
    + '<style>@media screen and (max-width:680px){.container{width:100%!important}.px{padding-left:14px!important;padding-right:14px!important}}</style>'
    + '</head><body style="margin:0;padding:0;background:#f1f5f9;">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;"><tr><td align="center" style="padding:20px 10px;">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="680" class="container" style="width:680px;max-width:680px;background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;">'
    + '<tr><td style="padding:0;">'
    + '<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:680px;height:110px;"><v:fill type="gradient" color="#1e3a5f" color2="#0f2340" angle="180"/><v:textbox inset="0,0,0,0"><![endif]-->'
    + '<div style="background:linear-gradient(180deg,#1e3a5f 0%,#0f2340 100%);height:110px;width:100%;">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="height:110px;width:100%;"><tr><td align="center" style="padding:16px 24px;">'
    + '<div style="font-family:Arial,sans-serif;font-size:20px;color:#ffffff;font-weight:700;">' + esc(title) + '</div>'
    + '<div style="font-family:Arial,sans-serif;font-size:12px;color:#f59e0b;margin-top:6px;">Date: ' + esc(dateString) + '</div>'
    + '</td></tr></table></div>'
    + '<!--[if gte mso 9]></v:textbox></v:rect><![endif]--></td></tr>'
    + '<tr><td class="px" style="padding:20px 24px;">'
    + (tableOnly ? '' :
        '<h2 style="margin:0 0 10px 0;font-family:Arial,sans-serif;font-size:15px;color:#1e3a5f;">Daily Summary</h2>'
        + kpis + moneyBand
        + '<h2 style="margin:16px 0 10px 0;font-family:Arial,sans-serif;font-size:15px;color:#1e3a5f;">Production Details</h2>')
    + tableHtml
    + '<p style="margin:16px 0 0 0;font-family:Arial,sans-serif;font-size:11px;color:#94a3b8;text-align:center;">Generated by Employee Production Tracker | ' + esc(new Date().toLocaleString()) + '</p>'
    + '</td></tr></table></td></tr></table></body></html>';
}

// ------------------------
// DAILY PRODUCTION REPORT (CSV + email) — the report you actually rely on
// ------------------------
function sendReportEmail(emailAddresses, reportType, startDate, endDate) {
  try {
    var recipients = emailAddresses.split(',').map(function (e) { return e.trim(); }).filter(function (e) { return e; });
    if (recipients.length === 0) throw new Error('No valid email addresses provided');

    var report = generateReport(reportType, startDate, endDate);
    var titleMap = {
      dailyProduction: 'Daily Production Report - ' + startDate,
      dailyEmployeePerformance: 'Daily Employee Performance Report - ' + startDate,
      weeklyIncentive: 'Weekly Incentive Report',
      monthlyPartSummary: 'Monthly Part Summary Report'
    };
    var subject = titleMap[reportType] || 'Production Tracker Report';

    var csv = buildCsv(report);
    var blob = Utilities.newBlob(csv, 'text/csv', subject.replace(/[^a-zA-Z0-9\s-]/g, '') + '.csv');
    var html = buildSimpleOutlookHTML(report, subject, startDate);

    MailApp.sendEmail({ to: recipients.join(','), subject: subject, htmlBody: html, attachments: [blob] });
    Logger.log('sendReportEmail: sent "' + subject + '" to ' + recipients.join(', '));
    return 'Report sent to ' + recipients.join(', ');
  } catch (e) {
    Logger.log('Error in sendReportEmail: ' + e.toString());
    notifyScriptError('sendReportEmail (' + reportType + ')', e);
    return 'Error sending report email: ' + e.message;
  }
}

/**
 * Sends the PREVIOUS day's production data. Runs at 8:00 AM, which is
 * before the current day's shift has produced anything worth reporting —
 * sending "today" at that hour is why past reports looked empty even
 * though nothing was actually broken. Yesterday's data is complete by
 * the time this runs.
 */
function sendDailyReportPreviousDay() {
  try {
    var dateString = getYesterdayStringFixed();
    var result = sendReportEmail(DAILY_REPORT_RECIPIENTS, 'dailyProduction', dateString, dateString);
    if (String(result).indexOf('Error') === 0) {
      notifyScriptError('sendDailyReportPreviousDay', result);
    } else {
      Logger.log('sendDailyReportPreviousDay: ' + result);
    }
    return result;
  } catch (e) {
    Logger.log('Error in sendDailyReportPreviousDay: ' + e.toString());
    notifyScriptError('sendDailyReportPreviousDay', e);
    return 'Error: ' + e.message;
  }
}

function setupDailyReportPreviousDay() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (['sendDailyReport', 'sendDailyReportWithFixedDate', 'sendDailyReportCurrentDay', 'sendDailyReportPreviousDay'].indexOf(fn) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('sendDailyReportPreviousDay').timeBased().atHour(8).nearMinute(0).everyDays(1).create();
  return 'Daily report (previous day\'s data) scheduled for 08:00.';
}

/** Send yesterday's report right now, to yourself only — for verifying delivery end-to-end. */
function testDailyReportNow() {
  var dateString = getYesterdayStringFixed();
  var result = sendReportEmail(ERROR_ALERT_RECIPIENT, 'dailyProduction', dateString, dateString);
  return result;
}

// ------------------------
// WEEKLY INCENTIVE — Detailed per-part report (XLSX + email)
// ------------------------
function getPreviousWeekRange() {
  var today = new Date();
  var day = today.getDay();
  var deltaToMonday = (day + 6) % 7;
  var currentMonday = new Date(today);
  currentMonday.setDate(today.getDate() - deltaToMonday);
  currentMonday.setHours(0, 0, 0, 0);
  var prevMonday = new Date(currentMonday);
  prevMonday.setDate(currentMonday.getDate() - 7);
  var prevSunday = new Date(prevMonday);
  prevSunday.setDate(prevMonday.getDate() + 6);
  prevSunday.setHours(23, 59, 59, 999);
  return { start: prevMonday, end: prevSunday };
}

function getDetailedWeeklyIncentiveData(startDate, endDate) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var dashboardSheet = ss.getSheetByName('Dashboard');
    var standardsSheet = ss.getSheetByName('Standards');
    var incentivesSheet = ss.getSheetByName('Incentives');
    if (!dashboardSheet) throw new Error('Sheet "Dashboard" not found.');
    if (!standardsSheet) throw new Error('Sheet "Standards" not found.');
    if (!incentivesSheet) throw new Error('Sheet "Incentives" not found.');

    var lastRow = dashboardSheet.getLastRow();
    if (lastRow <= 1) return {};

    var data = dashboardSheet.getRange(1, 1, lastRow, dashboardSheet.getLastColumn()).getDisplayValues();
    var standardsData = standardsSheet.getDataRange().getValues();
    var incentivesData = incentivesSheet.getDataRange().getValues();

    var standardsMap = {};
    standardsData.slice(1).forEach(function (row) { if (row[0]) standardsMap[row[0]] = parseFloat(row[1]) || 0; });

    var incentivesMap = {};
    incentivesData.slice(1).forEach(function (row) { if (row[0]) incentivesMap[row[0]] = parseFloat(row[2]) || 0; });

    var startParts = startDate.split('-');
    var endParts = endDate.split('-');
    var startObj = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
    var endObj = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));
    var dateRange = [];
    var cur = new Date(startObj);
    while (cur <= endObj) { dateRange.push(formatDateKey(cur)); cur.setDate(cur.getDate() + 1); }

    var employeeData = {};
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var rowDate = String(row[0]);
      if (dateRange.indexOf(rowDate) === -1) continue;

      var empName = String(row[1] || '');
      var partNum = String(row[2] || '');
      var qty = parseFloat(row[3]) || 0;
      var hours = parseFloat(row[4]) || 0;
      var incentive = parseFloat(row[9]) || 0;
      var standard = standardsMap[partNum] || 0;
      var overStd = Math.max(0, qty - (standard * hours));

      if (!employeeData[empName]) employeeData[empName] = {};
      if (!employeeData[empName][rowDate]) employeeData[empName][rowDate] = {};
      if (!employeeData[empName][rowDate][partNum]) {
        employeeData[empName][rowDate][partNum] = { qty: 0, hours: 0, overStandard: 0, incentive: 0, standard: standard };
      }
      var cell = employeeData[empName][rowDate][partNum];
      cell.qty += qty;
      cell.hours += hours;
      cell.overStandard += overStd;
      cell.incentive += incentive;
    }

    var empSheet = ss.getSheetByName('Employees');
    if (!empSheet) throw new Error('Sheet "Employees" not found.');
    var empRows = empSheet.getDataRange().getValues().slice(1);
    var nameToId = {};
    empRows.forEach(function (r) { nameToId[r[1]] = String(r[0]); });

    var ineligibleMap = getIneligibleEmployeesForWeek(startDate, endDate);

    return { employeeData: employeeData, dateRange: dateRange, ineligibleMap: ineligibleMap, nameToId: nameToId };
  } catch (e) {
    Logger.log('Error in getDetailedWeeklyIncentiveData: ' + e.toString());
    notifyScriptError('getDetailedWeeklyIncentiveData', e);
    return {};
  }
}

function buildDetailedWeeklyIncentiveHTML(startDate, endDate) {
  var result = getDetailedWeeklyIncentiveData(startDate, endDate);
  if (!result.employeeData) return '<p>No data found.</p>';

  var employeeData = result.employeeData;
  var dateRange = result.dateRange;
  var ineligibleMap = result.ineligibleMap || {};
  var nameToId = result.nameToId || {};

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function fmtMoney(n) { var x = parseFloat(n); return isNaN(x) ? '$0.00' : '$' + x.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtNum(n) { var x = parseFloat(n); return isNaN(x) ? '0' : x.toLocaleString(); }

  var FONT = 'font-family:Arial,Helvetica,sans-serif;';
  var CELL = 'padding:8px 10px;border-bottom:1px solid #e5e7eb;' + FONT + 'font-size:12px;color:#1e293b;';
  var TH = 'padding:9px 10px;background:#1e3a5f;color:#ffffff;' + FONT + 'font-size:12px;font-weight:600;border-bottom:2px solid #0f2340;text-align:left;';
  var TH_R = TH + 'text-align:right;';
  var TD_R = CELL + 'text-align:right;';

  var title = 'Detailed Weekly Incentive Report';
  var dateRangeStr = startDate + ' to ' + endDate;

  var grandTotalIncentive = 0, grandTotalPieces = 0;
  var empNames = Object.keys(employeeData).sort();
  var empTotals = {};

  empNames.forEach(function (emp) {
    empTotals[emp] = { pieces: 0, overStd: 0, incentive: 0 };
    Object.keys(employeeData[emp]).forEach(function (d) {
      Object.keys(employeeData[emp][d]).forEach(function (part) {
        var cell = employeeData[emp][d][part];
        empTotals[emp].pieces += cell.qty;
        empTotals[emp].overStd += cell.overStandard;
        empTotals[emp].incentive += cell.incentive;
      });
    });
    grandTotalIncentive += empTotals[emp].incentive;
    grandTotalPieces += empTotals[emp].pieces;
  });

  var bodyHtml = '';

  bodyHtml += '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 20px 0;">'
    + '<tr>'
    + '<td style="width:33%;padding:14px 16px;background:#f0f6ff;border:1px solid #bfdbfe;border-radius:4px;">'
    + '<div style="' + FONT + 'font-size:12px;color:#64748b;">Employees</div>'
    + '<div style="' + FONT + 'font-size:20px;color:#1e3a5f;font-weight:700;">' + empNames.length + '</div></td>'
    + '<td style="width:12px;"></td>'
    + '<td style="width:33%;padding:14px 16px;background:#f0f6ff;border:1px solid #bfdbfe;border-radius:4px;">'
    + '<div style="' + FONT + 'font-size:12px;color:#64748b;">Total Pieces Built</div>'
    + '<div style="' + FONT + 'font-size:20px;color:#1e3a5f;font-weight:700;">' + fmtNum(grandTotalPieces) + '</div></td>'
    + '<td style="width:12px;"></td>'
    + '<td style="width:33%;padding:14px 16px;background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;">'
    + '<div style="' + FONT + 'font-size:12px;color:#92400e;">Total Incentive Paid Out</div>'
    + '<div style="' + FONT + 'font-size:20px;color:#92400e;font-weight:700;">' + fmtMoney(grandTotalIncentive) + '</div></td>'
    + '</tr></table>';

  empNames.forEach(function (emp) {
    var days = employeeData[emp];
    var empTotal = empTotals[emp];
    var empId = nameToId[emp] || '';
    var ineligReason = ineligibleMap[empId];
    var isIneligible = !!ineligReason;
    var payout = isIneligible ? 0 : empTotal.incentive;

    var headerBg = isIneligible ? '#7f1d1d' : '#1e3a5f';
    var badgeHtml = isIneligible
      ? '<span style="' + FONT + 'font-size:11px;background:#fecaca;color:#7f1d1d;padding:2px 8px;border-radius:3px;margin-left:12px;font-weight:700;">INELIGIBLE - ' + esc(ineligReason) + '</span>'
      : '';

    bodyHtml += '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 2px 0;">'
      + '<tr><td style="padding:10px 14px;background:' + headerBg + ';border-radius:4px 4px 0 0;">'
      + '<span style="' + FONT + 'font-size:14px;font-weight:700;color:#ffffff;">' + esc(emp) + '</span>'
      + badgeHtml
      + '<span style="' + FONT + 'font-size:12px;color:#fbbf24;margin-left:16px;">Would Have Earned: <strong>' + fmtMoney(empTotal.incentive) + '</strong></span>'
      + '<span style="' + FONT + 'font-size:12px;color:#fbbf24;margin-left:12px;">Payout: <strong>' + fmtMoney(payout) + '</strong></span>'
      + '</td></tr></table>';

    bodyHtml += '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 20px 0;border:1px solid #e2e8f0;">'
      + '<thead><tr>'
      + '<th style="' + TH + ' width:90px;">Date</th>'
      + '<th style="' + TH + '">Part #</th>'
      + '<th style="' + TH_R + ' width:80px;">Qty Built</th>'
      + '<th style="' + TH_R + ' width:80px;">Standard<br/>(pcs/hr)</th>'
      + '<th style="' + TH_R + ' width:70px;">Hours</th>'
      + '<th style="' + TH_R + ' width:90px;">Std Pcs<br/>(for hrs)</th>'
      + '<th style="' + TH_R + ' width:80px;">Over Std</th>'
      + '<th style="' + TH_R + ' width:90px;">Would Earn</th>'
      + '<th style="' + TH_R + ' width:90px;">Payout</th>'
      + '</tr></thead><tbody>';

    var rowIdx = 0;
    dateRange.forEach(function (dateKey) {
      if (!days[dateKey]) return;
      var parts = Object.keys(days[dateKey]).sort();
      var dayPieces = 0, dayIncentive = 0;

      parts.forEach(function (part) {
        var cell = days[dateKey][part];
        var stdHrs = cell.standard * cell.hours;
        var bg = (rowIdx % 2 === 0) ? '#ffffff' : '#f8fafc';
        rowIdx++;
        dayPieces += cell.qty;
        dayIncentive += cell.incentive;
        var cellPayout = isIneligible ? 0 : cell.incentive;

        bodyHtml += '<tr>'
          + '<td style="' + CELL + 'background:' + bg + ';">' + esc(dateKey) + '</td>'
          + '<td style="' + CELL + 'background:' + bg + ';font-weight:600;">' + esc(part) + '</td>'
          + '<td style="' + TD_R + 'background:' + bg + ';">' + fmtNum(cell.qty) + '</td>'
          + '<td style="' + TD_R + 'background:' + bg + ';">' + fmtNum(cell.standard) + '</td>'
          + '<td style="' + TD_R + 'background:' + bg + ';">' + cell.hours.toFixed(2) + '</td>'
          + '<td style="' + TD_R + 'background:' + bg + ';">' + stdHrs.toFixed(2) + '</td>'
          + '<td style="' + TD_R + 'background:' + bg + ';color:' + (cell.overStandard > 0 ? '#15803d' : '#94a3b8') + ';font-weight:' + (cell.overStandard > 0 ? '700' : '400') + ';">'
          + (cell.overStandard > 0 ? '+' : '') + cell.overStandard.toFixed(2) + '</td>'
          + '<td style="' + TD_R + 'background:' + bg + ';color:' + (cell.incentive > 0 ? '#15803d' : '#94a3b8') + ';font-weight:' + (cell.incentive > 0 ? '700' : '400') + ';">'
          + fmtMoney(cell.incentive) + '</td>'
          + '<td style="' + TD_R + 'background:' + bg + ';color:' + (cellPayout > 0 ? '#15803d' : (isIneligible ? '#b91c1c' : '#94a3b8')) + ';font-weight:700;">'
          + fmtMoney(cellPayout) + '</td>'
          + '</tr>';
      });

      if (parts.length > 1) {
        var dayPayout = isIneligible ? 0 : dayIncentive;
        bodyHtml += '<tr>'
          + '<td colspan="2" style="' + CELL + 'background:#eff6ff;font-weight:600;font-style:italic;color:#1d4ed8;">  ' + esc(dateKey) + ' Day Total</td>'
          + '<td style="' + TD_R + 'background:#eff6ff;font-weight:600;">' + fmtNum(dayPieces) + '</td>'
          + '<td colspan="3" style="' + TD_R + 'background:#eff6ff;"></td>'
          + '<td style="' + TD_R + 'background:#eff6ff;"></td>'
          + '<td style="' + TD_R + 'background:#eff6ff;font-weight:700;color:#1d4ed8;">' + fmtMoney(dayIncentive) + '</td>'
          + '<td style="' + TD_R + 'background:#eff6ff;font-weight:700;color:' + (isIneligible ? '#b91c1c' : '#1d4ed8') + ';">' + fmtMoney(dayPayout) + '</td>'
          + '</tr>';
      }
    });

    bodyHtml += '<tr>'
      + '<td colspan="2" style="padding:10px;background:' + headerBg + ';color:#ffffff;' + FONT + 'font-size:13px;font-weight:700;">WEEK TOTAL - ' + esc(emp) + '</td>'
      + '<td style="padding:10px;background:' + headerBg + ';color:#ffffff;' + FONT + 'font-size:13px;font-weight:700;text-align:right;">' + fmtNum(empTotal.pieces) + '</td>'
      + '<td colspan="3" style="padding:10px;background:' + headerBg + ';"></td>'
      + '<td style="padding:10px;background:' + headerBg + ';color:#ffffff;' + FONT + 'font-size:13px;font-weight:700;text-align:right;">' + empTotal.overStd.toFixed(2) + '</td>'
      + '<td style="padding:10px;background:#f59e0b;color:#000000;' + FONT + 'font-size:13px;font-weight:700;text-align:right;">' + fmtMoney(empTotal.incentive) + '</td>'
      + '<td style="padding:10px;background:' + (isIneligible ? '#b91c1c' : '#f59e0b') + ';color:' + (isIneligible ? '#ffffff' : '#000000') + ';' + FONT + 'font-size:13px;font-weight:700;text-align:right;">' + fmtMoney(payout) + '</td>'
      + '</tr>';

    bodyHtml += '</tbody></table>';
  });

  return '<!doctype html><html><head><meta http-equiv="x-ua-compatible" content="ie=edge">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1.0"/>'
    + '<title>' + esc(title) + '</title></head>'
    + '<body style="margin:0;padding:0;background:#f1f5f9;">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;"><tr><td align="center" style="padding:20px 10px;">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="780" style="width:780px;max-width:780px;background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;">'
    + '<tr><td style="padding:0;">'
    + '<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:780px;height:100px;"><v:fill type="gradient" color="#1e3a5f" color2="#0a1628" angle="180"/><v:textbox inset="0,0,0,0"><![endif]-->'
    + '<div style="background:linear-gradient(180deg,#1e3a5f 0%,#0a1628 100%);height:100px;width:100%;">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="height:100px;width:100%;"><tr><td align="center" style="padding:16px 24px;">'
    + '<div style="' + FONT + 'font-size:20px;font-weight:700;color:#ffffff;">' + esc(title) + '</div>'
    + '<div style="' + FONT + 'font-size:12px;color:#fbbf24;margin-top:5px;">Week: ' + esc(dateRangeStr) + '</div>'
    + '</td></tr></table></div>'
    + '<!--[if gte mso 9]></v:textbox></v:rect><![endif]--></td></tr>'
    + '<tr><td style="padding:20px 24px;">' + bodyHtml
    + '<p style="margin:16px 0 0 0;' + FONT + 'font-size:11px;color:#94a3b8;text-align:center;">Generated by Employee Production Tracker | ' + esc(new Date().toLocaleString()) + '</p>'
    + '</td></tr></table></td></tr></table></body></html>';
}

function buildDetailedIncentiveXlsx(startDate, endDate) {
  var result = getDetailedWeeklyIncentiveData(startDate, endDate);
  if (!result || !result.employeeData) throw new Error('No incentive data found for ' + startDate + ' to ' + endDate);

  var employeeData = result.employeeData;
  var dateRange = result.dateRange;
  var ineligibleMap = result.ineligibleMap || {};
  var nameToId = result.nameToId || {};
  var empNames = Object.keys(employeeData).sort();

  var ss = SpreadsheetApp.create('_TEMP_IncentiveDetail_' + startDate);
  var sheet = ss.getActiveSheet();
  sheet.setName('Weekly Incentive Detail');

  var NAVY = '#1E3A5F', NAVY_DARK = '#0A1628', AMBER = '#F59E0B';
  var INDIGO_LT = '#EEF2FF', INDIGO = '#3730A3', GREEN = '#15803D';
  var GRAY = '#9CA3AF', STRIPE = '#F8FAFC', TOTAL_BG = '#FEF3C7', WHITE = '#FFFFFF';
  var RED_DARK = '#7F1D1D', RED_LT = '#FEE2E2';

  function setCell(r, c, value, opts) {
    var cell = sheet.getRange(r, c);
    if (value !== null && value !== undefined) cell.setValue(value);
    if (opts) {
      if (opts.bg) cell.setBackground(opts.bg);
      if (opts.fc) cell.setFontColor(opts.fc);
      if (opts.bold) cell.setFontWeight('bold');
      if (opts.italic) cell.setFontStyle('italic');
      if (opts.size) cell.setFontSize(opts.size);
      if (opts.align) cell.setHorizontalAlignment(opts.align);
      if (opts.fmt) cell.setNumberFormat(opts.fmt);
      if (opts.font) cell.setFontFamily(opts.font);
    }
    return cell;
  }

  var NUM_COLS = 10;
  sheet.setColumnWidth(1, 90); sheet.setColumnWidth(2, 148); sheet.setColumnWidth(3, 90);
  sheet.setColumnWidth(4, 78); sheet.setColumnWidth(5, 82); sheet.setColumnWidth(6, 58);
  sheet.setColumnWidth(7, 88); sheet.setColumnWidth(8, 78); sheet.setColumnWidth(9, 96); sheet.setColumnWidth(10, 96);

  sheet.getRange(1, 1, 1, NUM_COLS).merge().setValue('DETAILED WEEKLY INCENTIVE REPORT')
    .setBackground(NAVY_DARK).setFontColor(WHITE).setFontSize(13).setFontWeight('bold')
    .setHorizontalAlignment('center').setFontFamily('Arial');
  sheet.setRowHeight(1, 26);

  sheet.getRange(2, 1, 1, NUM_COLS).merge().setValue('Week: ' + startDate + ' to ' + endDate)
    .setBackground(NAVY).setFontColor('#93C5FD').setFontSize(9)
    .setHorizontalAlignment('center').setFontFamily('Arial');
  sheet.setRowHeight(2, 15);

  var headers = ['Date', 'Employee', 'Part #', 'Qty Built', 'Std (pcs/hr)', 'Hours', 'Std for Hrs', 'Over Std', 'Would Earn', 'Payout'];
  for (var h = 0; h < headers.length; h++) {
    sheet.getRange(3, h + 1).setValue(headers[h])
      .setBackground(NAVY).setFontColor(WHITE).setFontSize(9).setFontWeight('bold')
      .setFontFamily('Arial').setHorizontalAlignment(h < 3 ? 'left' : 'right')
      .setWrap(true).setVerticalAlignment('middle');
  }
  sheet.setRowHeight(3, 28);
  sheet.setFrozenRows(3);

  var currentRow = 4;
  var allIncentiveRows = [];

  empNames.forEach(function (emp) {
    var days = employeeData[emp];
    var empId = nameToId[emp] || '';
    var ineligReason = ineligibleMap[empId];
    var isIneligible = !!ineligReason;
    var headerBg = isIneligible ? RED_DARK : NAVY;
    var empDetailRows = [];

    var empHeaderLabel = emp + (isIneligible ? '   [INELIGIBLE - ' + ineligReason + ']' : '');
    sheet.getRange(currentRow, 1, 1, NUM_COLS).merge()
      .setValue(empHeaderLabel)
      .setBackground(headerBg).setFontColor(WHITE).setFontSize(10).setFontWeight('bold')
      .setFontFamily('Arial').setHorizontalAlignment('left');
    sheet.setRowHeight(currentRow, 20);
    currentRow++;

    dateRange.forEach(function (dateKey) {
      if (!days[dateKey]) return;
      var parts = Object.keys(days[dateKey]).sort();
      var dayDetailRows = [];

      parts.forEach(function (part) {
        var cell = days[dateKey][part];
        var isEven = (currentRow % 2 === 0);
        var bg = isEven ? WHITE : STRIPE;
        var stdHrs = cell.standard * cell.hours;
        var payout = isIneligible ? 0 : cell.incentive;

        setCell(currentRow, 1, dateKey, { bg: bg, align: 'left', size: 9, font: 'Arial', fmt: 'yyyy-mm-dd' });
        setCell(currentRow, 2, emp, { bg: bg, align: 'left', size: 9, font: 'Arial' });
        setCell(currentRow, 3, part, { bg: bg, align: 'left', size: 9, font: 'Arial', bold: true });
        setCell(currentRow, 4, cell.qty, { bg: bg, align: 'right', size: 9, font: 'Arial', fmt: '#,##0.0' });
        setCell(currentRow, 5, cell.standard, { bg: bg, align: 'right', size: 9, font: 'Arial', fmt: '#,##0.0' });
        setCell(currentRow, 6, cell.hours, { bg: bg, align: 'right', size: 9, font: 'Arial', fmt: '0.00' });
        setCell(currentRow, 7, stdHrs, { bg: bg, align: 'right', size: 9, font: 'Arial', fmt: '#,##0.0' });
        setCell(currentRow, 8, cell.overStandard, { bg: bg, align: 'right', size: 9, font: 'Arial', fmt: '#,##0.0', fc: cell.overStandard > 0 ? GREEN : GRAY, bold: cell.overStandard > 0 });
        setCell(currentRow, 9, cell.incentive, { bg: bg, align: 'right', size: 9, font: 'Arial', fmt: '$#,##0.00', fc: cell.incentive > 0 ? GREEN : GRAY, bold: cell.incentive > 0 });
        setCell(currentRow, 10, payout, { bg: isIneligible ? RED_LT : bg, align: 'right', size: 9, font: 'Arial', fmt: '$#,##0.00', fc: isIneligible ? RED_DARK : (payout > 0 ? GREEN : GRAY), bold: true });

        sheet.setRowHeight(currentRow, 16);
        dayDetailRows.push(currentRow);
        empDetailRows.push(currentRow);
        allIncentiveRows.push(currentRow);
        currentRow++;
      });

      if (parts.length > 1) {
        var dayQtyF = '=' + dayDetailRows.map(function (r) { return 'D' + r; }).join('+');
        var dayIncF = '=' + dayDetailRows.map(function (r) { return 'I' + r; }).join('+');
        var dayPayF = '=' + dayDetailRows.map(function (r) { return 'J' + r; }).join('+');
        sheet.getRange(currentRow, 1, 1, 3).merge()
          .setValue('  Day Total: ' + dateKey)
          .setBackground(INDIGO_LT).setFontColor(INDIGO).setFontSize(9)
          .setFontWeight('bold').setFontStyle('italic').setFontFamily('Arial').setHorizontalAlignment('left');
        setCell(currentRow, 4, dayQtyF, { bg: INDIGO_LT, fc: INDIGO, bold: true, size: 9, align: 'right', fmt: '#,##0.0' });
        for (var c = 5; c <= 8; c++) sheet.getRange(currentRow, c).setBackground(INDIGO_LT);
        setCell(currentRow, 9, dayIncF, { bg: INDIGO_LT, fc: INDIGO, bold: true, size: 9, align: 'right', fmt: '$#,##0.00' });
        setCell(currentRow, 10, dayPayF, { bg: INDIGO_LT, fc: isIneligible ? RED_DARK : INDIGO, bold: true, size: 9, align: 'right', fmt: '$#,##0.00' });
        sheet.setRowHeight(currentRow, 16);
        currentRow++;
      }
    });

    var empQtyF = '=' + empDetailRows.map(function (r) { return 'D' + r; }).join('+');
    var empHrsF = '=' + empDetailRows.map(function (r) { return 'F' + r; }).join('+');
    var empOvrF = '=' + empDetailRows.map(function (r) { return 'H' + r; }).join('+');
    var empIncF = '=' + empDetailRows.map(function (r) { return 'I' + r; }).join('+');
    var empPayF = '=' + empDetailRows.map(function (r) { return 'J' + r; }).join('+');

    sheet.getRange(currentRow, 1, 1, 3).merge()
      .setValue('WEEK TOTAL - ' + emp + (isIneligible ? ' [INELIGIBLE]' : ''))
      .setBackground(headerBg).setFontColor(WHITE).setFontSize(10).setFontWeight('bold')
      .setFontFamily('Arial').setHorizontalAlignment('left');
    setCell(currentRow, 4, empQtyF, { bg: headerBg, fc: WHITE, bold: true, size: 10, align: 'right', fmt: '#,##0.0' });
    sheet.getRange(currentRow, 5).setBackground(headerBg);
    setCell(currentRow, 6, empHrsF, { bg: headerBg, fc: WHITE, bold: true, size: 10, align: 'right', fmt: '0.00' });
    sheet.getRange(currentRow, 7).setBackground(headerBg);
    setCell(currentRow, 8, empOvrF, { bg: headerBg, fc: WHITE, bold: true, size: 10, align: 'right', fmt: '#,##0.0' });
    setCell(currentRow, 9, empIncF, { bg: AMBER, fc: '#000000', bold: true, size: 11, align: 'right', fmt: '$#,##0.00' });
    setCell(currentRow, 10, empPayF, { bg: isIneligible ? RED_DARK : AMBER, fc: isIneligible ? WHITE : '#000000', bold: true, size: 11, align: 'right', fmt: '$#,##0.00' });
    sheet.setRowHeight(currentRow, 20);
    currentRow++;
    sheet.setRowHeight(currentRow, 8);
    currentRow++;
  });

  var grandQtyF = '=' + allIncentiveRows.map(function (r) { return 'D' + r; }).join('+');
  var grandHrsF = '=' + allIncentiveRows.map(function (r) { return 'F' + r; }).join('+');
  var grandOvrF = '=' + allIncentiveRows.map(function (r) { return 'H' + r; }).join('+');
  var grandIncF = '=' + allIncentiveRows.map(function (r) { return 'I' + r; }).join('+');
  var grandPayF = '=' + allIncentiveRows.map(function (r) { return 'J' + r; }).join('+');

  sheet.getRange(currentRow, 1, 1, 3).merge().setValue('GRAND TOTAL - ALL EMPLOYEES')
    .setBackground(TOTAL_BG).setFontColor(NAVY_DARK).setFontSize(11).setFontWeight('bold')
    .setFontFamily('Arial').setHorizontalAlignment('left');
  setCell(currentRow, 4, grandQtyF, { bg: TOTAL_BG, fc: NAVY_DARK, bold: true, size: 11, align: 'right', fmt: '#,##0.0' });
  sheet.getRange(currentRow, 5).setBackground(TOTAL_BG);
  setCell(currentRow, 6, grandHrsF, { bg: TOTAL_BG, fc: NAVY_DARK, bold: true, size: 11, align: 'right', fmt: '0.00' });
  sheet.getRange(currentRow, 7).setBackground(TOTAL_BG);
  setCell(currentRow, 8, grandOvrF, { bg: TOTAL_BG, fc: NAVY_DARK, bold: true, size: 11, align: 'right', fmt: '#,##0.0' });
  setCell(currentRow, 9, grandIncF, { bg: TOTAL_BG, fc: NAVY_DARK, bold: true, size: 11, align: 'right', fmt: '$#,##0.00' });
  setCell(currentRow, 10, grandPayF, { bg: TOTAL_BG, fc: NAVY_DARK, bold: true, size: 11, align: 'right', fmt: '$#,##0.00' });
  sheet.setRowHeight(currentRow, 22);

  var ssId = ss.getId();
  var exportUrl = 'https://docs.google.com/spreadsheets/d/' + ssId
    + '/export?format=xlsx&portrait=false&fitw=true&size=LETTER'
    + '&top_margin=0.4&bottom_margin=0.4&left_margin=0.4&right_margin=0.4'
    + '&printtitle=false&sheetnames=false&gridlines=false';

  var token = ScriptApp.getOAuthToken();
  var response = UrlFetchApp.fetch(exportUrl, { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true });
  DriveApp.getFileById(ssId).setTrashed(true);

  if (response.getResponseCode() !== 200) {
    throw new Error('Drive export failed: HTTP ' + response.getResponseCode() + '. This usually means the DriveApp/UrlFetchApp scopes need re-authorization — open the script editor and run buildDetailedIncentiveXlsx manually once to trigger the consent prompt.');
  }
  return response.getBlob().setName('Detailed_Weekly_Incentive_' + startDate + '_to_' + endDate + '.xlsx');
}

function sendDetailedWeeklyIncentiveReport() {
  try {
    var range = getPreviousWeekRange();
    var startIso = formatDateKey(range.start);
    var endIso = formatDateKey(range.end);
    var html = buildDetailedWeeklyIncentiveHTML(startIso, endIso);
    var xlsxBlob = buildDetailedIncentiveXlsx(startIso, endIso);

    MailApp.sendEmail({
      to: WEEKLY_INCENTIVE_RECIPIENTS,
      subject: 'Detailed Weekly Incentive Report (' + startIso + ' to ' + endIso + ')',
      htmlBody: html,
      attachments: [xlsxBlob]
    });
    Logger.log('sendDetailedWeeklyIncentiveReport: sent for ' + startIso + ' to ' + endIso + ' to ' + WEEKLY_INCENTIVE_RECIPIENTS);
    return 'Sent for ' + startIso + ' to ' + endIso;
  } catch (e) {
    Logger.log('Error in sendDetailedWeeklyIncentiveReport: ' + e.toString());
    notifyScriptError('sendDetailedWeeklyIncentiveReport', e);
    return 'Error: ' + e.message;
  }
}

function setupDetailedWeeklyIncentiveReportTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDetailedWeeklyIncentiveReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDetailedWeeklyIncentiveReport')
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(10).nearMinute(30).create();
  return 'Detailed Weekly Incentive Report trigger set: Mondays at 10:30 AM.';
}

/** Send last week's detailed incentive report right now, to yourself only. */
function testDetailedWeeklyIncentiveReport() {
  try {
    var range = getPreviousWeekRange();
    var startIso = formatDateKey(range.start);
    var endIso = formatDateKey(range.end);
    var html = buildDetailedWeeklyIncentiveHTML(startIso, endIso);
    var xlsxBlob = buildDetailedIncentiveXlsx(startIso, endIso);
    MailApp.sendEmail({
      to: ERROR_ALERT_RECIPIENT,
      subject: '[TEST] Detailed Weekly Incentive (' + startIso + ' to ' + endIso + ')',
      htmlBody: html,
      attachments: [xlsxBlob]
    });
    return 'Test sent for ' + startIso + ' to ' + endIso;
  } catch (e) {
    notifyScriptError('testDetailedWeeklyIncentiveReport', e);
    return 'Error: ' + e.message;
  }
}

// ------------------------
// Production Issues
// ------------------------
function getProductionIssues() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Production Issues');
    if (!sheet) {
      sheet = ss.insertSheet('Production Issues');
      sheet.appendRow(['Date', 'Employee ID', 'Employee Name', 'Part Number', 'Lost Production Time (hours)', 'Notes', 'Timestamp']);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#1e3a5f').setFontColor('#ffffff');
      return [['Date', 'Employee ID', 'Employee Name', 'Part Number', 'Lost Production Time (hours)', 'Notes', 'Timestamp']];
    }
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [['Date', 'Employee ID', 'Employee Name', 'Part Number', 'Lost Production Time (hours)', 'Notes', 'Timestamp']];
    return sheet.getRange(1, 1, lastRow, 7).getDisplayValues();
  } catch (e) {
    Logger.log('Error in getProductionIssues: ' + e.toString());
    return [['Date', 'Employee ID', 'Employee Name', 'Part Number', 'Lost Production Time (hours)', 'Notes', 'Timestamp']];
  }
}

function submitProductionIssue(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Production Issues');
    if (!sheet) {
      sheet = ss.insertSheet('Production Issues');
      sheet.appendRow(['Date', 'Employee ID', 'Employee Name', 'Part Number', 'Lost Production Time (hours)', 'Notes', 'Timestamp']);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#1e3a5f').setFontColor('#ffffff');
    }
    if (!data || !data.issueDate) throw new Error('Invalid production issue data');

    var lostTime = parseFloat(data.lostTime);
    if (isNaN(lostTime) || lostTime < 0) throw new Error('Lost time must be a positive number');

    var dateParts = data.issueDate.split('-');
    var date = new Date(parseInt(dateParts[0], 10), parseInt(dateParts[1], 10) - 1, parseInt(dateParts[2], 10), 12, 0, 0);

    var empSheet = ss.getSheetByName('Employees');
    var empData = empSheet.getDataRange().getValues();
    var employee = empData.find(function (e) { return e[0] == data.employeeId; });
    var empName = employee ? employee[1] : 'Unknown';

    var newRow = sheet.getLastRow() + 1;
    sheet.appendRow([date, data.employeeId, empName, data.partNumber, lostTime, data.notes || '', new Date(), data.enteredBy || '']);
    sheet.getRange(newRow, 1).setNumberFormat('yyyy-MM-dd');
    sheet.getRange(newRow, 7).setNumberFormat('yyyy-MM-dd HH:mm:ss');

    return 'Production issue recorded successfully!';
  } catch (e) {
    Logger.log('Error in submitProductionIssue: ' + e.toString());
    return 'Error recording production issue: ' + e.message;
  }
}

function sendProductionIssuesEmail(emailAddresses, startDate, endDate) {
  try {
    var recipients = emailAddresses.split(',').map(function (e) { return e.trim(); }).filter(function (e) { return e; });
    if (recipients.length === 0) throw new Error('No valid email addresses provided');

    var data = getProductionIssues();
    var subject = 'Production Issues Report (' + startDate + ' to ' + endDate + ')';
    var csv = buildCsv(data);
    var blob = Utilities.newBlob(csv, 'text/csv', 'Production_Issues_' + startDate + '_to_' + endDate + '.csv');
    var html = buildSimpleOutlookHTML(data, subject, startDate + ' to ' + endDate);

    MailApp.sendEmail({ to: recipients.join(','), subject: subject, htmlBody: html, attachments: [blob] });
    return 'Report sent to ' + recipients.join(', ');
  } catch (e) {
    Logger.log('Error in sendProductionIssuesEmail: ' + e.toString());
    return 'Error sending report: ' + e.message;
  }
}

// ------------------------
// UI Menu
// ------------------------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Production Tracker')
    .addItem('Open Web App', 'openWebApp')
    .addItem('Toolkit: set up Access tab', 'setupToolkitApi')
    .addSeparator()
    .addItem('Update Dashboard', 'updateDashboard')
    .addSeparator()
    .addItem('Schedule Daily 8AM Report (previous day)', 'setupDailyReportPreviousDay')
    .addItem('Send Yesterday\'s Daily Report Now (to me)', 'testDailyReportNow')
    .addSeparator()
    .addItem('Setup Weekly Incentive Trigger (Mon 10:30AM)', 'setupDetailedWeeklyIncentiveReportTrigger')
    .addItem('Send Last Week\'s Incentive Report Now (to me)', 'testDetailedWeeklyIncentiveReport')
    .addSeparator()
    .addItem('Test Error Alert Email', 'testErrorAlert')
    .addToUi();
}

// =========================================================================================
// =========================================================================================
// TOOLKIT API  (Warehouse Toolkit → Sonoco Reels)
// Everything below is new. It calls the same functions above that the old web page called,
// so the Sheet, the emails and the TLand export see no difference.
// =========================================================================================
// =========================================================================================
var TOOLKIT_API_VERSION = '1.86.0';
var ACCESS_TAB = 'Access';
var SUPA_URL_DEFAULT = 'https://tjivcqxnkftujceumdtx.supabase.co';
var SUPA_KEY_DEFAULT = 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
var ABSENCE_TYPES = ['Call-In', 'Unexcused', 'PTO'];
var REPORT_TITLES = {
  dailyProduction: 'Daily Production Report',
  dailyEmployeePerformance: 'Daily Employee Performance Report',
  weeklyIncentive: 'Weekly Incentive Report',
  monthlyPartSummary: 'Part Summary Report',
  dashboard: 'Production Records',
  issues: 'Production Issues Report'
};

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad_request' }); }
  try {
    var who = auth_(body.token);
    var fn = API_ROUTES[body.action];
    if (!fn) return json_({ ok: false, error: 'unknown_action' });
    var out = fn(body, who) || {};
    out.ok = out.ok !== false;
    return json_(out);
  } catch (err) {
    var msg = String((err && err.message) || err);
    if (!/^(signed_out|no_access|duplicate|changed|bad_input:)/.test(msg)) {
      Logger.log('Sonoco Reels API error (' + body.action + '): ' + ((err && err.stack) || msg));
    }
    return json_({ ok: false, error: msg });
  }
}

var API_ROUTES = {
  bootstrap: apiBootstrap_, dashboard: apiDashboard_, addProduction: apiAddProduction_,
  addEmployee: apiAddEmployee_, issues: apiIssues_, addIssue: apiAddIssue_,
  attendance: apiAttendance_, addAbsence: apiAddAbsence_, deleteAbsence: apiDeleteAbsence_,
  report: apiReport_, emailReport: apiEmailReport_
};

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function props_() { return PropertiesService.getScriptProperties(); }
function toolkitUrl_() { return props_().getProperty('TOOLKIT_URL') || 'https://nbr1hawgfan.github.io/LWH-Warehouse-Toolkit/'; }
function bad_(msg) { throw new Error('bad_input:' + msg); }
function validYmd_(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  var d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}
function range_(b) {
  if (!validYmd_(b.start) || !validYmd_(b.end)) bad_('Pick a start and end date.');
  if (b.end < b.start) bad_('The end date is before the start date.');
  return { start: b.start, end: b.end };
}
/** Result strings from the original functions: "Error…" means it failed. */
function okOrBad_(result) {
  var s = String(result == null ? '' : result);
  if (/^Error/i.test(s)) bad_(s.replace(/^Error[^:]*:\s*/i, '') || s);
  return s;
}

// ---- Sign-in: the Toolkit's employee session, checked with Supabase ---------------------
function supa_(fn, args) {
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
  var cache = CacheService.getScriptCache(), ck = 'sr_' + hash_(token);
  var hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  var me = supa_('whm_me', { p_token: String(token) });
  if (!me || !me.ok) throw new Error('signed_out');
  if (!hasAccess_(me.emp_id)) throw new Error('no_access');
  var who = { empId: String(me.emp_id), name: me.name || ('ID ' + me.emp_id) };
  cache.put(ck, JSON.stringify(who), 300);   // 5 minutes — removing someone from Access applies within 5 min
  return who;
}

/** Only employee IDs on the Access tab (column A) or in Script Property ADMIN_EMP_IDS. */
function hasAccess_(empId) {
  var id = String(empId == null ? '' : empId).trim();
  if (!id) return false;
  var admins = String(props_().getProperty('ADMIN_EMP_IDS') || '').split(/[,\s]+/).filter(String);
  if (admins.indexOf(id) >= 0) return true;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ACCESS_TAB);
  if (!sh || sh.getLastRow() < 2) return false;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]).trim() === id) return true;
  return false;
}

/** Run once from the editor (or the Production Tracker menu). Never deletes or moves anything. */
function setupToolkitApi() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ACCESS_TAB);
  if (!sh) {
    sh = ss.insertSheet(ACCESS_TAB);
    sh.getRange(1, 1, 1, 3).setValues([['Employee ID', 'Name', 'Note']])
      .setFontWeight('bold').setBackground('#1e3a5f').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
    sh.setColumnWidth(1, 120); sh.setColumnWidth(2, 220); sh.setColumnWidth(3, 320);
  }
  function label(tabName, col, text) {
    var t = ss.getSheetByName(tabName);
    if (!t) return;
    if (t.getMaxColumns() < col) t.insertColumnsAfter(t.getMaxColumns(), col - t.getMaxColumns());
    var c = t.getRange(1, col);
    if (String(c.getValue()) === '') c.setValue(text);
  }
  label('Production', 6, 'Entered By'); label('Production', 7, 'Entered At');
  label('Attendance', 6, 'Entered By'); label('Attendance', 7, 'Entered At');
  label('Production Issues', 8, 'Entered By');
  var msg = 'Toolkit API is set up. On the "' + ACCESS_TAB + '" tab, put the employee ID of each person allowed in ' +
    '(column A, one per row — the same ID they sign in to the Toolkit with).';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor — no UI */ }
  return msg;
}

// ---- Actions ----------------------------------------------------------------------------
function apiBootstrap_(b, who) {
  var employees = getEmployees().filter(function (e) { return String(e.id) !== ''; })
    .map(function (e) { return { id: String(e.id), name: String(e.name) }; });
  var parts = getParts().filter(function (p) { return String(p) !== ''; }).map(String);
  return { me: who, employees: employees, parts: parts, today: getTodayString(), absenceTypes: ABSENCE_TYPES, version: TOOLKIT_API_VERSION };
}

function dashboardRows_(start, end) {
  var data = getAllDashboardData();
  if (!data || !data.length || /^Error/.test(String(data[0][0]))) throw new Error('The Dashboard tab could not be read.');
  var rows = data.slice(1).filter(function (r) { var d = String(r[0]); return d >= start && d <= end; });
  return { header: data[0], rows: rows };
}

function apiDashboard_(b) {
  var r = range_(b);
  return dashboardRows_(r.start, r.end);
}

function apiAddProduction_(b, who) {
  if (!validYmd_(b.date)) bad_('Pick the production date.');
  if (b.date > getDateStringFixed(1)) bad_('That date is in the future.');
  var empId = String(b.employeeId == null ? '' : b.employeeId).trim(), part = String(b.partNumber == null ? '' : b.partNumber).trim();
  var qty = Number(b.quantity), hours = Number(b.hours);
  if (!empId) bad_('Pick the employee.');
  if (!part) bad_('Pick the part number.');
  if (!isFinite(qty) || qty <= 0) bad_('Quantity must be more than 0.');
  if (!isFinite(hours) || hours <= 0) bad_('Enter the time worked.');
  if (hours > 24) bad_('Time worked can\'t be more than 24 hours.');
  var emp = null, emps = getEmployees();
  for (var i = 0; i < emps.length; i++) if (String(emps[i].id) === empId) { emp = emps[i]; break; }
  if (!emp) bad_('That employee isn\'t on the Employees tab.');
  if (getParts().map(String).indexOf(part) < 0) bad_('That part number isn\'t on the Parts tab.');

  if (!b.allowDuplicate) {
    var prod = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Production').getDataRange().getValues();
    for (var r = prod.length - 1; r >= 1; r--) {
      var row = prod[r];
      if (!row[0]) continue;
      if (formatDateKey(row[0]) === b.date && String(row[1]) === empId && String(row[2]) === part &&
          Number(row[3]) === qty && Math.abs(Number(row[4]) - hours) < 0.0005) throw new Error('duplicate');
    }
  }

  var msg = okOrBad_(submitProductionData({ productionDate: b.date, employeeId: emp.id, partNumber: part,
    quantity: qty, hoursWorked: hours, enteredBy: who.name }));

  // The Dashboard was just rebuilt in Production order, so its last row is this entry.
  var saved = null;
  try {
    var dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
    var last = dash.getLastRow();
    if (last > 1) {
      var d = dash.getRange(last, 1, 1, 11).getDisplayValues()[0];
      if (String(d[0]) === b.date && String(d[2]) === part && Number(d[3]) === qty) {
        saved = { date: d[0], employee: d[1], part: d[2], quantity: d[3], hours: d[4], pph: d[5], standard: d[6], performance: d[7], incentive: d[9] };
      }
    }
  } catch (e2) { /* the entry is saved either way */ }
  return { message: msg, saved: saved };
}

function apiAddEmployee_(b, who) {
  var id = String(b.employeeId == null ? '' : b.employeeId).trim(), name = String(b.name == null ? '' : b.name).trim();
  var rate = Number(b.hourlyRate);
  if (!id) bad_('Enter the employee ID.');
  if (!name) bad_('Enter the employee\'s name.');
  if (!isFinite(rate) || rate <= 0) bad_('Hourly rate must be more than 0.');
  var emps = getEmployees();
  for (var i = 0; i < emps.length; i++) {
    if (String(emps[i].id).trim().toLowerCase() === id.toLowerCase()) bad_('Employee ID ' + id + ' is already on the list (' + emps[i].name + ').');
  }
  var msg = okOrBad_(submitNewEmployee({ employeeId: id, name: name, hourlyRate: rate }));
  Logger.log('Sonoco Reels: employee ' + id + ' added by ' + who.name);
  return { message: msg, employees: apiBootstrap_(b, who).employees };
}

function apiIssues_(b) {
  var r = range_(b);
  var data = getProductionIssues();
  var rows = data.slice(1).filter(function (x) { var d = String(x[0]); return d >= r.start && d <= r.end; });
  rows.sort(function (a, c) { return a[0] < c[0] ? 1 : a[0] > c[0] ? -1 : 0; });
  return { header: data[0], rows: rows };
}

function apiAddIssue_(b, who) {
  if (!validYmd_(b.date)) bad_('Pick the issue date.');
  if (!String(b.employeeId || '').trim()) bad_('Pick the employee.');
  if (!String(b.partNumber || '').trim()) bad_('Pick the part number.');
  var lost = b.lostTime === '' || b.lostTime == null ? 0 : Number(b.lostTime);
  if (!isFinite(lost) || lost < 0) bad_('Lost time can\'t be negative.');
  var msg = okOrBad_(submitProductionIssue({ issueDate: b.date, employeeId: String(b.employeeId).trim(),
    partNumber: String(b.partNumber).trim(), lostTime: lost, notes: String(b.notes || '').slice(0, 1000), enteredBy: who.name }));
  return { message: msg };
}

function apiAttendance_() {
  var data = getAttendanceRecords();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    // Sheet row number = i + 1 (row 1 is the header).
    rows.push({ row: i + 1, date: String(data[i][0]), employeeId: String(data[i][1]), name: String(data[i][2]),
      type: String(data[i][3]), notes: String(data[i][4]) });
  }
  rows.sort(function (a, c) { return a.date < c.date ? 1 : a.date > c.date ? -1 : c.row - a.row; });
  return { rows: rows };
}

function apiAddAbsence_(b, who) {
  if (!validYmd_(b.date)) bad_('Pick the absence date.');
  if (!String(b.employeeId || '').trim()) bad_('Pick the employee.');
  if (ABSENCE_TYPES.indexOf(String(b.type)) < 0) bad_('Pick the absence type.');
  var msg = okOrBad_(submitAbsence({ absenceDate: b.date, employeeId: String(b.employeeId).trim(),
    absenceType: String(b.type), notes: String(b.notes || '').slice(0, 500), enteredBy: who.name }));
  return { message: msg };
}

/** Deletes by row number, but only if that row is still the record that was on screen. */
function apiDeleteAbsence_(b, who) {
  var row = parseInt(b.row, 10);
  if (!(row >= 2)) bad_('That record can\'t be found.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('busy');
  try {
    var sheet = getOrCreateAttendanceSheet();
    if (row > sheet.getLastRow()) throw new Error('changed');
    var cur = sheet.getRange(row, 1, 1, 5).getDisplayValues()[0];
    if (String(cur[0]) !== String(b.date) || String(cur[1]) !== String(b.employeeId) || String(cur[3]) !== String(b.type)) {
      throw new Error('changed');
    }
    var msg = okOrBad_(deleteAttendanceRecord(row));
    Logger.log('Sonoco Reels: absence deleted by ' + who.name + ' — ' + cur.join(' | '));
    return { message: msg };
  } finally {
    lock.releaseLock();
  }
}

function reportRows_(type, start, end) {
  if (type === 'dashboard') { var d = dashboardRows_(start, end); return [d.header].concat(d.rows); }
  if (type === 'issues') { var i = apiIssues_({ start: start, end: end }); return [i.header].concat(i.rows); }
  if (['dailyProduction', 'dailyEmployeePerformance', 'weeklyIncentive', 'monthlyPartSummary'].indexOf(type) < 0) bad_('Unknown report.');
  return generateReport(type, start, end);
}

function apiReport_(b) {
  var r = range_(b);
  var rows = reportRows_(String(b.type), r.start, r.end);
  var only = rows.length === 1 && rows[0].length === 1 ? String(rows[0][0]) : '';
  if (/^Error/i.test(only)) bad_(only);
  return { rows: rows, title: REPORT_TITLES[b.type] || 'Report' };
}

function recipients_(to) {
  var list = String(to || '').split(/[,;\s]+/).filter(String);
  if (!list.length) bad_('Enter an email address.');
  if (list.length > 10) bad_('That\'s more than 10 addresses.');
  for (var i = 0; i < list.length; i++) {
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(list[i])) bad_('"' + list[i] + '" doesn\'t look like an email address.');
  }
  return list;
}

function apiEmailReport_(b, who) {
  var r = range_(b), type = String(b.type), to = recipients_(b.to);
  var when = r.start === r.end ? r.start : r.start + ' to ' + r.end;
  var subject = (REPORT_TITLES[type] || 'Production Tracker Report') + ' (' + when + ')';
  var mail = { to: to.join(','), subject: subject };

  if (type === 'weeklyIncentive') {
    // Same detailed layout and XLSX as the Monday email, for the dates picked.
    mail.subject = 'Detailed Weekly Incentive Report (' + when + ')';
    mail.htmlBody = buildDetailedWeeklyIncentiveHTML(r.start, r.end);
    mail.attachments = [buildDetailedIncentiveXlsx(r.start, r.end)];
  } else {
    var rows = reportRows_(type, r.start, r.end);
    var only = rows.length === 1 && rows[0].length === 1 ? String(rows[0][0]) : '';
    if (/^Error/i.test(only)) bad_(only);
    // The summary cards read Dashboard columns, so they only go on Dashboard-shaped tables.
    var dashShaped = (type === 'dashboard' || type === 'dailyProduction') && !only;
    mail.htmlBody = buildSimpleOutlookHTML(rows, subject, when, !dashShaped);
    mail.attachments = [Utilities.newBlob(buildCsv(rows), 'text/csv', subject.replace(/[^a-zA-Z0-9\s-]/g, '') + '.csv')];
  }
  MailApp.sendEmail(mail);
  Logger.log('Sonoco Reels: "' + mail.subject + '" emailed to ' + mail.to + ' by ' + who.name);
  return { message: 'Sent to ' + to.join(', ') };
}
