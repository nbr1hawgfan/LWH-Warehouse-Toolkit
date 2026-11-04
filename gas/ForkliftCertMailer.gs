/**
 * LWH Forklift Certification — mailer (Google Apps Script)
 * Toolkit v1.76.0
 *
 * What it does
 *   1. doPost — the Toolkit sends {kind, id, token, pdf?}. This script trades
 *      the one-time token with Supabase (fc_mail_payload) for the recipients
 *      and details, then emails: employee (if they gave an email), their
 *      manager, and HR. The Toolkit can never choose who gets an email.
 *        kind 'result' — written test result (pass / not passed)
 *        kind 'cert'   — certificate issued, PDF attached
 *   2. sendExpirationReminders — run daily by a trigger. Emails employee,
 *      manager and HR when a cert is 60 days and 30 days from expiring.
 *
 * Setup (see docs/FORKLIFT_CERT_SETUP.md)
 *   Project Settings → Script Properties:
 *     SUPABASE_URL       https://tjivcqxnkftujceumdtx.supabase.co
 *     SUPABASE_ANON_KEY  (same anon key the Toolkit uses)
 *     FC_MAILER_KEY      (long random key — its hash goes in Supabase, see SQL file)
 *     APP_URL            https://nbr1hawgfan.github.io/LWH-Warehouse-Toolkit/   (optional)
 *   Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *   Paste the /exec URL into Toolkit → Forklift Certs → Settings → Mailer URL.
 *   Run setupDailyTrigger() once.
 */

var FROM_NAME = 'LWH Forklift Certification';
var BRAND = '#c8102e';

function props_() { return PropertiesService.getScriptProperties(); }
function appUrl_() { return props_().getProperty('APP_URL') || 'https://nbr1hawgfan.github.io/LWH-Warehouse-Toolkit/'; }

function rpc_(fn, args) {
  var p = props_();
  var url = p.getProperty('SUPABASE_URL'), key = p.getProperty('SUPABASE_ANON_KEY');
  if (!url || !key) throw new Error('Script Properties SUPABASE_URL / SUPABASE_ANON_KEY are not set.');
  var res = UrlFetchApp.fetch(url + '/rest/v1/rpc/' + fn, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify(args || {}),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('Supabase ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() { return json_({ ok: true, service: 'LWH forklift cert mailer' }); }

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (['result', 'cert'].indexOf(body.kind) < 0 || !body.id || !body.token) return json_({ ok: false, error: 'bad_request' });

    var payload = rpc_('fc_mail_payload', { p_kind: body.kind, p_id: String(body.id), p_token: String(body.token) });
    if (!payload || !payload.ok) return json_({ ok: false, error: (payload && payload.error) || 'bad_token' });

    var to = payload.to || [];
    if (!to.length) return json_({ ok: true, sent_to: [] });

    var msg = body.kind === 'cert' ? certEmail_(payload.cert) : resultEmail_(payload.result);
    var opts = { name: FROM_NAME, htmlBody: msg.html };

    if (body.kind === 'cert' && body.pdf) {
      var bytes = Utilities.base64Decode(String(body.pdf));
      // Only attach a real, reasonably sized PDF.
      var head = String.fromCharCode.apply(null, bytes.slice(0, 4));
      if (head === '%PDF' && bytes.length < 5 * 1024 * 1024) {
        var name = String(body.filename || ('Forklift_Certificate_' + payload.cert.cert_no + '.pdf')).replace(/[^\w.\-]+/g, '_');
        opts.attachments = [Utilities.newBlob(bytes, 'application/pdf', name)];
      }
    }
    MailApp.sendEmail(to.join(','), msg.subject, msg.text, opts);
    return json_({ ok: true, sent_to: to });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------- email bodies ----------
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
function d_(iso) {
  if (!iso) return '';
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (+m[2]) + '/' + (+m[3]) + '/' + m[1] : '';
}
function pct_(n) { return (Math.round((+n || 0) * 10) / 10) + '%'; }
function wrap_(title, color, rows, note) {
  var trs = rows.map(function (r) {
    return '<tr><td style="padding:6px 14px 6px 0;color:#5c5c6b;font-size:13px;white-space:nowrap">' + esc_(r[0]) +
      '</td><td style="padding:6px 0;font-weight:bold;font-size:14px">' + esc_(r[1]) + '</td></tr>';
  }).join('');
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#1c1c2b">' +
    '<div style="background:' + BRAND + ';color:#fff;padding:14px 18px;font-weight:bold;letter-spacing:.04em">LOGISTICS WAREHOUSE — FORKLIFT CERTIFICATION</div>' +
    '<div style="border:1px solid #e2e0e4;border-top:0;padding:18px">' +
    '<div style="font-size:20px;font-weight:bold;color:' + color + ';margin-bottom:10px">' + esc_(title) + '</div>' +
    '<table style="border-collapse:collapse">' + trs + '</table>' +
    (note ? '<p style="font-size:14px;line-height:1.5;margin:14px 0 0">' + note + '</p>' : '') +
    '</div><div style="font-size:11px;color:#888;padding:8px 2px">Sent automatically by the LWH Warehouse Toolkit.</div></div>';
}

function resultEmail_(r) {
  var passed = !!r.passed;
  var subject = 'Forklift written test ' + (passed ? 'PASSED' : 'not passed') + ' — ' + r.name;
  var rows = [
    ['Employee', r.name + ' (ID ' + r.emp_id + ')'],
    ['Location', r.location || ''],
    ['Score', pct_(r.score_pct) + '  (' + r.correct + ' of ' + r.total + ' — ' + pct_(r.pass_pct) + ' needed)'],
    ['Result', passed ? 'Passed' : 'Not passed'],
    ['Equipment', (r.truck_types || []).join(', ')],
    ['Manager', r.manager || '']
  ];
  var note = passed
    ? 'Next step: the manager or trainer completes the <b>driving evaluation</b> in the Toolkit (Forklift Certs). The certificate is issued when that is signed off.'
    : 'The employee should review the missed topics with a trainer before testing again.';
  var text = subject + '\n\n' + rows.map(function (x) { return x[0] + ': ' + x[1]; }).join('\n');
  return { subject: subject, html: wrap_(passed ? 'Written test passed' : 'Written test not passed', passed ? '#1a7a1a' : '#b91c1c', rows, note), text: text };
}

function certEmail_(c) {
  var subject = 'Forklift certification issued — ' + c.name + ' (' + c.cert_no + ')';
  var verify = appUrl_() + '?view=fcVerify&cert=' + encodeURIComponent(c.cert_no);
  var rows = [
    ['Employee', c.name + ' (ID ' + c.emp_id + ')'],
    ['Cert #', c.cert_no],
    ['Equipment', (c.truck_types || []).join(', ')],
    ['Written test', pct_(c.written_score) + ' on ' + d_(c.written_date)],
    ['Driving evaluation', d_(c.practical_date) + ' — ' + (c.evaluator || '')],
    ['Issued', d_(c.issued_on)],
    ['Expires', d_(c.expires_on)]
  ];
  var note = 'The certificate is attached. Wallet cards can be printed any time from the Toolkit (Forklift Certs → Certificates). ' +
    '<a href="' + esc_(verify) + '" style="color:' + BRAND + '">Verify this certification</a>.';
  var text = subject + '\n\n' + rows.map(function (x) { return x[0] + ': ' + x[1]; }).join('\n') + '\n\nVerify: ' + verify;
  return { subject: subject, html: wrap_('Certified forklift operator', '#1a7a1a', rows, note), text: text };
}

// ---------- daily expiration reminders ----------
function sendExpirationReminders() {
  var key = props_().getProperty('FC_MAILER_KEY');
  if (!key) throw new Error('Script Property FC_MAILER_KEY is not set.');
  var r = rpc_('fc_mail_expiring', { p_key: key });
  if (!r || !r.ok) throw new Error('fc_mail_expiring: ' + ((r && r.error) || 'failed'));
  (r.items || []).forEach(function (it) {
    if (!it.to || !it.to.length) return;
    var c = it.cert;
    var subject = 'Forklift certification expires in ' + c.days_left + ' days — ' + c.name;
    var rows = [['Employee', c.name + ' (ID ' + c.emp_id + ')'], ['Location', c.location || ''], ['Cert #', c.cert_no],
                ['Equipment', (c.truck_types || []).join(', ')], ['Expires', d_(c.expires_on)]];
    var note = 'Schedule refresher training: the employee retakes the written test in the Toolkit (Forklift Test), then the manager does a new driving evaluation. ' +
      'OSHA requires an evaluation at least every 3 years.';
    MailApp.sendEmail(it.to.join(','), subject, subject, { name: FROM_NAME, htmlBody: wrap_('Certification expiring', '#b45309', rows, note) });
  });
  console.log('Expiration reminders sent: ' + (r.items || []).length);
}

/** Run once: daily reminder at ~7 AM (script time zone). */
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendExpirationReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendExpirationReminders').timeBased().everyDays(1).atHour(7).create();
}

/** Optional: run from the editor to check the Supabase connection. */
function testConnection() {
  console.log(JSON.stringify(rpc_('fc_verify', { p_cert_no: 'TEST' })));
}
