/**
 * LWH Monthly Facility Inspections — mailer + Sheet log (Google Apps Script)
 * Toolkit v1.88.0
 *
 * Runs every 15 minutes (time trigger). Each run asks Supabase (insp_mail_run) for:
 *   - inspections submitted since the last run → emails the report to the admins, the extra
 *     recipients set in Toolkit → Inspections → Setup → People & email, and whoever submitted it;
 *     and adds rows to this spreadsheet: one per inspection (Inspections tab) and one per item that
 *     didn't meet standard (Findings tab).
 *   - reminders that are due → "your zones this month" on the 1st (only when zones are assigned),
 *     and "still open" a few days before month end (to each assignee + a summary to admins).
 * Supabase marks each one as sent when it hands it over, so nothing is emailed twice.
 * Photos stay in Supabase — the email links to the inspection in the Toolkit.
 *
 * Setup (docs/INSPECTIONS_SETUP.md):
 *   1. Make a new Google Sheet "LWH Facility Inspections" → Extensions → Apps Script → paste this file.
 *   2. Project Settings → Script Properties:
 *        SUPABASE_URL        https://tjivcqxnkftujceumdtx.supabase.co
 *        SUPABASE_ANON_KEY   (same publishable key the Toolkit uses)
 *        INSP_MAILER_KEY     (long random key — its hash goes in Supabase, see the doc)
 *        APP_URL             https://nbr1hawgfan.github.io/LWH-Warehouse-Toolkit/   (optional)
 *   3. Run setup() once (makes the tabs and the 15-minute trigger; approve the permissions).
 */

var FROM_NAME = 'LWH Safety Inspections';
var BRAND = '#c8102e';

function props_() { return PropertiesService.getScriptProperties(); }
function appUrl_() { return props_().getProperty('APP_URL') || 'https://nbr1hawgfan.github.io/LWH-Warehouse-Toolkit/'; }

function rpc_(fn, args) {
  var p = props_();
  var url = p.getProperty('SUPABASE_URL'), key = p.getProperty('SUPABASE_ANON_KEY');
  if (!url || !key) throw new Error('Script Properties SUPABASE_URL / SUPABASE_ANON_KEY are not set.');
  var res = UrlFetchApp.fetch(url + '/rest/v1/rpc/' + fn, {
    method: 'post', contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify(args || {}), muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('Supabase ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}

// ------------------------------------------------------------------ setup
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  sheet_(ss, 'Inspections', ['Logged', 'Month', 'Site code', 'Site', 'Zone', 'Inspector', 'Submitted', 'Meets', "Doesn't meet", 'N/A', 'Items', 'Notes', 'Resubmitted', 'Link']);
  sheet_(ss, 'Findings', ['Logged', 'Month', 'Site code', 'Site', 'Zone', 'Inspector', 'Section', 'Form #', 'Item', 'Comment', 'Photos', 'Times found', 'Link']);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(15).create();
  run();
}
function sheet_(ss, name, header) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0 && header.length) {
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#161616').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ------------------------------------------------------------------ main
function run() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var key = props_().getProperty('INSP_MAILER_KEY');
    if (!key) throw new Error('Script Property INSP_MAILER_KEY is not set.');
    var r = rpc_('insp_mail_run', { p_key: key });
    if (!r || !r.ok) throw new Error('insp_mail_run: ' + ((r && r.error) || 'failed'));
    (r.reports || []).forEach(function (rep) {
      try { logReport_(rep); } catch (e) { console.error('Sheet log failed: ' + e); }
      try { if ((rep.to || []).length) sendReport_(rep); } catch (e) { console.error('Report email failed: ' + e); }
    });
    (r.reminders || []).forEach(function (rem) {
      try { if ((rem.to || []).filter(String).length) sendReminder_(rem); } catch (e) { console.error('Reminder failed: ' + e); }
    });
  } finally { lock.releaseLock(); }
}

// ------------------------------------------------------------------ helpers
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
function month_(iso) { var p = String(iso).split('-'); return Utilities.formatDate(new Date(+p[0], +p[1] - 1, 1), 'America/Chicago', 'MMMM yyyy'); }
function when_(iso) { return iso ? Utilities.formatDate(new Date(iso), 'America/Chicago', 'MMM d, yyyy h:mm a') : ''; }
function site_(o) { return o.location_name + (o.zones_in_location > 1 ? ' — ' + o.zone_name : ''); }
function link_(id) { return appUrl_() + '?view=inspections&insp=' + encodeURIComponent(id); }
function wrap_(title, inner) {
  return '<div style="font-family:Arial,sans-serif;max-width:680px;color:#1c1c2b">' +
    '<div style="background:#161616;color:#fff;padding:14px 18px;border-bottom:4px solid ' + BRAND + '">' +
    '<div style="font-size:11px;letter-spacing:1px;color:#ff9aa9">LOGISTICS WAREHOUSE</div>' +
    '<div style="font-size:19px;font-weight:bold">' + esc_(title) + '</div></div>' +
    '<div style="padding:16px 18px;border:1px solid #e2e0e4;border-top:0">' + inner + '</div></div>';
}

// ------------------------------------------------------------------ report email
function sendReport_(rep) {
  var site = site_({ location_name: rep.location_name, zone_name: rep.zone_name, zones_in_location: rep.zones_in_location });
  var subject = (rep.not ? '⚠ ' : '✓ ') + month_(rep.period) + ' inspection — ' + site + ' — ' +
    (rep.not ? rep.not + " item" + (rep.not === 1 ? '' : 's') + " didn't meet standard" : 'all items meet standard') +
    (rep.reopened ? ' (resubmitted)' : '');
  var tiles = [['Meets', rep.meets, '#1a7a1a'], ["Doesn't meet", rep.not, rep.not ? BRAND : '#1c1c2b'], ['N/A', rep.na, '#5c5c6b'], ['Items', rep.total, '#1c1c2b']]
    .map(function (t) { return '<td style="border:1px solid #e2e0e4;border-top:3px solid #161616;padding:8px 10px;width:25%"><div style="font-size:11px;color:#5c5c6b;text-transform:uppercase">' + t[0] + '</div><div style="font-size:22px;font-weight:bold;color:' + t[2] + '">' + t[1] + '</div></td>'; }).join('');
  var html = '<p style="margin:0 0 10px"><b>' + esc_(site) + '</b> (' + esc_(rep.location_code) + ') — ' + esc_(month_(rep.period)) +
    '<br>Submitted by <b>' + esc_(rep.submitted_name) + '</b>, ' + esc_(when_(rep.submitted_at)) + '</p>' +
    '<table style="border-collapse:collapse;width:100%;margin-bottom:14px"><tr>' + tiles + '</tr></table>';
  if (rep.findings && rep.findings.length) {
    html += '<h3 style="margin:16px 0 6px;font-size:15px;color:' + BRAND + '">Didn\'t meet standard — corrective actions opened</h3>' +
      rep.findings.map(function (f) {
        return '<div style="border-left:4px solid ' + BRAND + ';background:#fff7f7;padding:8px 10px;margin-bottom:8px">' +
          '<div style="font-size:11px;color:#5c5c6b;text-transform:uppercase">' + esc_(f.section) + (f.legacy_no ? ' · #' + f.legacy_no : '') + '</div>' +
          '<div style="font-weight:bold">' + esc_(f.text) + '</div>' +
          (f.comment ? '<div style="margin-top:3px">' + esc_(f.comment) + '</div>' : '') +
          '<div style="font-size:12px;color:#5c5c6b;margin-top:3px">' + (f.photos ? f.photos + ' photo' + (f.photos === 1 ? '' : 's') : 'No photo') +
          (f.times_found > 1 ? ' · <b style="color:' + BRAND + '">found ' + f.times_found + ' months running</b>' : '') + '</div></div>';
      }).join('');
  }
  if (rep.na_items && rep.na_items.length) {
    html += '<p style="font-size:13px;color:#5c5c6b;margin:12px 0 4px"><b>Marked N/A:</b> ' + rep.na_items.map(esc_).join('; ') + '</p>';
  }
  if (rep.notes) html += '<p style="margin:12px 0 4px"><b>Notes:</b> ' + esc_(rep.notes).replace(/\n/g, '<br>') + '</p>';
  html += '<p style="margin:18px 0 0"><a href="' + link_(rep.id) + '" style="background:' + BRAND + ';color:#fff;padding:10px 16px;text-decoration:none;font-weight:bold">Open in the Toolkit (photos)</a></p>';
  var text = subject + '\n\n' + site + ' — ' + month_(rep.period) + '\nSubmitted by ' + rep.submitted_name + '\n\n' +
    (rep.findings || []).map(function (f) { return "DOESN'T MEET: " + f.text + (f.comment ? ' — ' + f.comment : ''); }).join('\n') +
    '\n\nOpen in the Toolkit: ' + link_(rep.id);
  MailApp.sendEmail(rep.to.join(','), subject, text, { name: FROM_NAME, htmlBody: wrap_('Monthly Safety Inspection', html) });
}

function logReport_(rep) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), now = new Date();
  var a = sheet_(ss, 'Inspections', []), f = sheet_(ss, 'Findings', []);
  var zone = rep.zones_in_location > 1 ? rep.zone_name : '';
  a.appendRow([now, month_(rep.period), rep.location_code, rep.location_name, zone, rep.submitted_name, new Date(rep.submitted_at),
    rep.meets, rep.not, rep.na, rep.total, rep.notes || '', rep.reopened ? 'Yes' : '', link_(rep.id)]);
  (rep.findings || []).forEach(function (x) {
    f.appendRow([now, month_(rep.period), rep.location_code, rep.location_name, zone, rep.submitted_name, x.section, x.legacy_no || '',
      x.text, x.comment || '', x.photos || 0, x.times_found || 1, link_(rep.id)]);
  });
}

// ------------------------------------------------------------------ reminders
function sendReminder_(rem) {
  var to = rem.to.filter(String).join(','), m = month_(rem.period);
  var rows = (rem.zones || []).map(function (z) {
    return '<tr><td style="padding:5px 8px;border-bottom:1px solid #e2e0e4">' + esc_(z.location + (z.zones_in_location > 1 ? ' — ' + z.zone : '')) + '</td>' +
      (z.status ? '<td style="padding:5px 8px;border-bottom:1px solid #e2e0e4">' + esc_(z.status === 'draft' ? 'in progress' : z.status) + '</td>' : '') +
      (rem.kind === 'due_summary' ? '<td style="padding:5px 8px;border-bottom:1px solid #e2e0e4">' + esc_(z.assigned && z.assigned.indexOf('Employee ') !== 0 ? z.assigned : 'anyone') + '</td>' : '') + '</tr>';
  }).join('');
  var table = '<table style="border-collapse:collapse;width:100%;font-size:14px">' + rows + '</table>';
  var btn = '<p style="margin:18px 0 0"><a href="' + appUrl_() + '?view=inspections" style="background:' + BRAND + ';color:#fff;padding:10px 16px;text-decoration:none;font-weight:bold">Open Inspections</a></p>';
  var subject, html;
  if (rem.kind === 'start') {
    subject = m + ' safety inspections — your zones';
    html = '<p>Hi ' + esc_(String(rem.name || '').split(' ')[0]) + ', you\'re down for these ' + m + ' inspections:</p>' + table +
      '<p style="font-size:13px;color:#5c5c6b">Due by the end of the month. Each one takes photos of anything that doesn\'t meet standard.</p>' + btn;
  } else if (rem.kind === 'due') {
    subject = 'Reminder: ' + m + ' inspections still open (' + rem.days_left + ' day' + (rem.days_left === 1 ? '' : 's') + ' left)';
    html = '<p>Hi ' + esc_(String(rem.name || '').split(' ')[0]) + ', these ' + m + ' inspections assigned to you aren\'t submitted yet:</p>' + table + btn;
  } else {
    subject = m + ' inspections: ' + rem.zones.length + ' not submitted (' + rem.days_left + ' day' + (rem.days_left === 1 ? '' : 's') + ' left)';
    html = '<p>Not submitted yet for ' + m + ':</p>' + table +
      (rem.overdue_actions ? '<p><b style="color:' + BRAND + '">' + rem.overdue_actions + ' corrective action' + (rem.overdue_actions === 1 ? ' is' : 's are') + ' past due.</b></p>' : '') + btn;
  }
  MailApp.sendEmail(to, subject, subject, { name: FROM_NAME, htmlBody: wrap_('Monthly Safety Inspections', html) });
}
