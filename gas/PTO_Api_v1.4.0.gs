// ============================================================================
// Api.gs  —  JSON API for the PTO & Absence PWAs on GitHub Pages
// ----------------------------------------------------------------------------
// ADD THIS AS A NEW FILE in the existing PTO Apps Script project.
// It is 100% ADDITIVE:
//   • It does NOT edit Code.gs, the sheets, the TLand export, the Export_ tabs,
//     the triggers, or the old HtmlService portals (doGet is untouched).
//   • It adds doPost(), which the old project never had, so the same /exec URL
//     now serves BOTH the old HTML portals (GET) and the new PWAs (POST).
//   • Every action just calls the functions that already exist in Code.gs
//     (submitPTORequest, approvePTORequest, recordManualAbsence, etc.), so all
//     sheet writes, balance math, emails and PDFs behave exactly as today.
//
// What it adds on top (safety only, no behavior changes to the data):
//   • Signed session tokens — PIN is checked once at login, then every call
//     carries a token. Employees can only see/touch their OWN requests.
//   • Real manager PIN check (the old approve flow accepted any PIN).
//   • Lockout: 5 wrong PINs on one account = locked for 15 minutes.
//   • Double-approve guard: a request can only be approved/denied while it is
//     still "Pending" (prevents double PTO deductions from double clicks).
//   • Script lock around writes so two managers can't collide.
//   • Dates are sent as yyyy-MM-dd text (no timezone day-shift).
//
// To sign everyone out instantly: Project Settings → Script Properties →
// delete API_TOKEN_SECRET. A new one is generated automatically.
//
// v1.2.0 (Nov 2026): 'bridge.login' — the Warehouse Toolkit (and later the Driver Toolkit /
// Transportation Manager) can open a PTO session for whoever is signed in there, with no second
// PIN. This server asks Supabase who the app's sign-in belongs to (pto_bridge_who) and gets back
// their PTO Employee ID. Anyone turned off in the Toolkit's Access screen, or inactive, gets nothing.
// Manager access still comes only from this sheet's Managers tab.
//
// v1.3.0: phone notifications. When a PTO request or time off ask is sent, the employee's manager gets
// one (Warehouse Toolkit / Driver Toolkit, if they turned notifications on). When it's approved, denied,
// recorded or declined, the employee gets one. Uses the same PTO_SUPABASE_SECRET Script Property as the
// hourly Absence Calendar push. A notification problem never stops the request itself.
// ============================================================================

const API_VERSION = '1.4.0';
const API_EMPLOYEE_SESSION_HOURS = 24 * 14; // employees: 14 days ("keep me signed in")
const API_MANAGER_SESSION_HOURS  = 12;      // managers: 12 hours
const API_MAX_PIN_FAILS          = 5;
const API_LOCKOUT_SECONDS        = 15 * 60;
const API_EMPLOYEE_TYPES         = ['Full Day PTO', 'Half Day PTO'];

// ----------------------------------------------------------------------------
// isPTOAbsenceType SAFETY NET
// Code.gs calls isPTOAbsenceType() everywhere but it wasn't in the files we
// reviewed. It is a tiny yes/no check: "does this absence type come out of the
// PTO balance?" If the project already has one (in another .gs file), THAT one
// is kept and this line does nothing. If it is missing, this fallback is used,
// matching how the rest of the code treats PTO: only Full Day PTO and Half Day
// PTO touch the balance. Run apiSelfTest() to see which one is active.
// ----------------------------------------------------------------------------
function apiFallbackIsPTO_(absenceType) {
  const t = String(absenceType || '').trim().toLowerCase();
  return t === 'full day pto' || t === 'half day pto';
}
// 'var' (not const/let) on purpose: if your original function lives in a file
// that loads before OR after this one, the original always wins.
var isPTOAbsenceType = (typeof isPTOAbsenceType === 'function') ? isPTOAbsenceType : apiFallbackIsPTO_;

// ============================================================================
// ENTRY POINT
// ============================================================================
function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return apiJson_({ ok: false, error: 'Bad request (invalid JSON).' });
  }

  try {
    // Branded emails (Emails.gs) — re-applied on every call so file order never matters.
    if (typeof emInstallBrandedEmails_ === 'function') emInstallBrandedEmails_();
    const action = String(body.action || '');
    const handler = API_ACTIONS_[action];
    if (!handler) return apiJson_({ ok: false, error: 'Unknown action: ' + action });

    let session = null;
    if (handler.role !== 'public') {
      session = apiVerifyToken_(body.token);
      if (!session) return apiJson_({ ok: false, error: 'SESSION_EXPIRED' });
      if (handler.role !== session.r) return apiJson_({ ok: false, error: 'Not allowed for this account.' });
    }

    let data;
    if (handler.write) {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) return apiJson_({ ok: false, error: 'System busy, please try again.' });
      try { data = handler.fn(body, session); } finally { lock.releaseLock(); }
    } else {
      data = handler.fn(body, session);
    }
    return apiJson_({ ok: true, data: apiClean_(data) });
  } catch (err) {
    Logger.log('❌ API error (' + body.action + '): ' + (err && err.stack || err));
    return apiJson_({ ok: false, error: String(err && err.message || err) });
  }
}

// ============================================================================
// ACTION TABLE
// role: 'public' (no login) | 'employee' | 'manager'
// write: true = runs inside a script lock
// ============================================================================
const API_ACTIONS_ = {
  // ---------- public ----------
  'ping':      { role: 'public', fn: function () { return { version: API_VERSION, time: new Date().toISOString() }; } },
  'employees': { role: 'public', fn: apiPublicEmployees_ },
  'managers':  { role: 'public', fn: apiPublicManagers_ },
  'hasPin':    { role: 'public', fn: function (b) { return { exists: checkIfPINExists(String(b.id || '')) }; } },
  'setupPin':  { role: 'public', write: true, fn: apiSetupPin_ },
  'login':     { role: 'public', fn: apiLogin_ },
  'bridge.login': { role: 'public', fn: apiBridgeLogin_ },
  // Email Employees (v1.4.0) — checks the Toolkit sign-in itself (appToken), managers only
  'bridge.emailList': { role: 'public', fn: apiBcList_ },
  'bridge.emailSend': { role: 'public', fn: apiBcSend_ },          // no script lock — a big send takes a while
  'bridge.emailHide': { role: 'public', write: true, fn: apiBcHide_ },

  // ---------- employee ----------
  'emp.bootstrap': { role: 'employee', fn: apiEmpBootstrap_ },
  'emp.checkDup':  { role: 'employee', fn: function (b, s) { return checkForDuplicateRequests(s.i, b.startDate, b.endDate || b.startDate); } },
  'emp.submit':    { role: 'employee', write: true, fn: apiEmpSubmit_ },
  'emp.cancel':    { role: 'employee', write: true, fn: apiEmpCancel_ },
  'emp.message':   { role: 'employee', fn: apiEmpMessage_ },
  'emp.ask':       { role: 'employee', write: true, fn: apiEmpAsk_ },
  'emp.askWithdraw': { role: 'employee', write: true, fn: apiEmpAskWithdraw_ },

  // ---------- manager ----------
  'mgr.bootstrap':   { role: 'manager', fn: apiMgrBootstrap_ },
  'mgr.requests':    { role: 'manager', fn: function () { return getDetailedEmployeeHistory('', null); } },
  'mgr.team':        { role: 'manager', fn: function () { return getManagerTeam(''); } },
  'mgr.approve':     { role: 'manager', write: true, fn: apiMgrApprove_ },
  'mgr.deny':        { role: 'manager', write: true, fn: apiMgrDeny_ },
  'mgr.record':      { role: 'manager', write: true, fn: apiMgrRecord_ },
  'mgr.checkDup':    { role: 'manager', fn: function (b) { return checkForDuplicateRequests(String(b.employeeId), b.startDate, b.endDate || b.startDate); } },
  'mgr.analytics':   { role: 'manager', fn: function (b) { return getTeamAbsenceSummary(b.department || '', parseInt(b.year, 10) || new Date().getFullYear()); } },
  'mgr.history':     { role: 'manager', fn: function (b) { return getDetailedEmployeeHistory(b.employeeId || '', parseInt(b.year, 10) || null); } },
  'mgr.emailReport': { role: 'manager', fn: apiMgrEmailReport_ },
  'mgr.exportTeam':  { role: 'manager', fn: function (b, s) { return exportTeamData(s.e); } },
  'mgr.exportAbsence': { role: 'manager', fn: function (b, s) { return exportAbsenceSummary(s.e, b.department || ''); } },
  'mgr.asks':        { role: 'manager', fn: function () { return apiAsksForManager_(); } },
  'mgr.askRecord':   { role: 'manager', write: true, fn: apiMgrAskRecord_ },
  'mgr.askDecline':  { role: 'manager', write: true, fn: apiMgrAskDecline_ }
};

// ============================================================================
// PUBLIC
// ============================================================================
function apiPublicEmployees_() {
  const all = getAllEmployees();
  return Object.keys(all)
    .map(function (id) { return all[id]; })
    .filter(function (e) { return String(e.status || '').trim().toLowerCase() !== 'inactive'; })
    .map(function (e) { return { id: String(e.id), name: String(e.name || '') }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function apiPublicManagers_() {
  const all = getAllManagers();
  return Object.keys(all)
    .map(function (id) { return { id: String(all[id].id), name: String(all[id].name || all[id].id) }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function apiSetupPin_(b) {
  const id = String(b.id || '');
  const role = b.role === 'manager' ? 'manager' : 'employee';
  if (role === 'manager' && !getAllManagers()[id]) throw new Error('Manager not found.');
  if (checkIfPINExists(id)) throw new Error('A PIN already exists for this account. Please log in.');
  const res = setupNewPIN(id, String(b.pin || ''));
  if (!res || !res.success) throw new Error((res && res.message) || 'PIN setup failed.');
  return apiIssueSession_(id, role);
}

function apiLogin_(b) {
  const id = String(b.id || '');
  const pin = String(b.pin || '');
  const role = b.role === 'manager' ? 'manager' : 'employee';
  if (!id) throw new Error('Please select your name.');
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits.');

  const cache = CacheService.getScriptCache();
  const failKey = 'pinfail_' + role + '_' + id;
  const fails = parseInt(cache.get(failKey) || '0', 10);
  if (fails >= API_MAX_PIN_FAILS) throw new Error('Too many wrong PINs. Account locked for 15 minutes.');

  if (role === 'manager' && !getAllManagers()[id]) throw new Error('Manager not found.');

  if (!apiCheckPin_(id, pin)) {
    cache.put(failKey, String(fails + 1), API_LOCKOUT_SECONDS);
    const left = API_MAX_PIN_FAILS - fails - 1;
    throw new Error('Invalid PIN.' + (left > 0 ? ' ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.' : ' Account locked for 15 minutes.'));
  }
  cache.remove(failKey);
  return apiIssueSession_(id, role);
}

/** Read-only PIN check — same rule as validateEmployeePIN(), but works for
 *  managers too (it doesn't require an Employees row to return true). */
function apiCheckPin_(id, pin) {
  const sheet = SS.getSheetByName(SHEET_NAMES.EMPLOYEE_PINS);
  if (!sheet || sheet.getLastRow() < 2) return false;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === id && String(data[i][2]) !== '' && String(data[i][2]) === pin) return true;
  }
  return false;
}

function apiIssueSession_(id, role) {
  let profile;
  if (role === 'manager') {
    const m = getAllManagers()[id];
    const emp = getEmployeeById(id);
    profile = {
      id: id,
      name: (m && m.name) || (emp && emp.name) || id,
      email: (m && m.email) || (emp && emp.email) || '',
      department: (emp && emp.department) || 'Management'
    };
  } else {
    const emp = getEmployeeById(id);
    if (!emp) throw new Error('Employee not found.');
    profile = { id: id, name: emp.name, email: emp.email, department: emp.department, manager: emp.manager };
  }
  const hours = role === 'manager' ? API_MANAGER_SESSION_HOURS : API_EMPLOYEE_SESSION_HOURS;
  const token = apiSignToken_({ i: id, r: role, n: profile.name, e: profile.email, x: Date.now() + hours * 3600 * 1000 });
  return { token: token, role: role, profile: profile, expires: Date.now() + hours * 3600 * 1000 };
}


// ============================================================================
// TOOLKIT BRIDGE (v1.2.0) — sign in with the Warehouse Toolkit's sign-in, no second PIN
// ============================================================================
const API_BRIDGE_WHO_URL = 'https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/pto_bridge_who';
const API_BRIDGE_KEY     = 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT'; // public key; the app sign-in is what proves who it is

function apiBridgeWho_(appToken) {
  const t = String(appToken || '');
  if (t.length < 20 || t.length > 200) throw new Error('Please sign in to the Toolkit again.');
  const cache = CacheService.getScriptCache();
  const key = 'bridge_' + apiB64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, t)).slice(0, 40);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const res = UrlFetchApp.fetch(API_BRIDGE_WHO_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: API_BRIDGE_KEY }, payload: JSON.stringify({ p_token: t })
  });
  let who = null;
  try { who = JSON.parse(res.getContentText()); } catch (e) {}
  if (res.getResponseCode() !== 200 || !who) throw new Error('Could not check your Toolkit sign-in. Try again.');
  if (who.ok) cache.put(key, JSON.stringify(who), 300);
  return who;
}

function apiBridgeLogin_(b) {
  const role = b.role === 'manager' ? 'manager' : 'employee';
  const who = apiBridgeWho_(b.appToken);
  if (!who.ok) {
    if (who.error === 'not_linked') throw new Error('Your Toolkit sign-in is not linked to a PTO record yet. Ask HR or Tim.');
    throw new Error('SIGNED_OUT');
  }
  const id = String(who.pto_id || '');
  const isMgr = !!getAllManagers()[id];
  if (role === 'manager' && !isMgr) throw new Error('Not a PTO manager.');
  if (role === 'employee' && !getEmployeeById(id)) throw new Error('No PTO record found for you. Ask HR.');
  const s = apiIssueSession_(id, role);
  s.isManager = isMgr;
  return s;
}

// ============================================================================
// EMAIL EMPLOYEES (v1.4.0)
// ============================================================================
const BC_MAX_RECIPIENTS = 250;
const BC_LOG_TAB        = 'Email_Broadcast_Log';
const BC_WHM_URL        = 'https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/whm_me';
const BC_EMAIL_RE       = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Who is sending, and are they allowed? PTO Managers tab, or a Toolkit warehouse manager. */
function apiBcWho_(appToken) {
  const who = apiBridgeWho_(appToken);
  if (!who.ok && who.error !== 'not_linked') throw new Error('SIGNED_OUT');
  const id = who.ok ? String(who.pto_id || '') : '';
  const m = id ? getAllManagers()[id] : null;
  let whm = false;
  if (!m) {
    const cache = CacheService.getScriptCache();
    const key = 'bcwhm_' + apiB64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(appToken))).slice(0, 40);
    const hit = cache.get(key);
    if (hit) whm = hit === '1';
    else {
      const res = UrlFetchApp.fetch(BC_WHM_URL, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { apikey: API_BRIDGE_KEY }, payload: JSON.stringify({ p_token: String(appToken) })
      });
      let me = null; try { me = JSON.parse(res.getContentText()); } catch (e) {}
      if (res.getResponseCode() !== 200 || !me) throw new Error('Could not check your Toolkit sign-in. Try again.');
      if (me.ok === false) throw new Error('SIGNED_OUT');
      whm = !!me.is_manager;
      cache.put(key, whm ? '1' : '0', 300);
    }
  }
  if (!m && !whm) throw new Error('Email Employees is for managers only.');
  const emp = id ? getEmployeeById(id) : null;
  const email = String((m && m.email) || (emp && emp.email) || '').trim();
  return { id: id, name: String((m && m.name) || (emp && emp.name) || who.name || 'Manager'), email: BC_EMAIL_RE.test(email) ? email : '' };
}

function apiBcHidden_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('BCAST_HIDDEN') || '[]').map(String); }
  catch (e) { return []; }
}

function apiBcLogSheet_() {
  let sh = SS.getSheetByName(BC_LOG_TAB);
  if (!sh) {
    sh = SS.insertSheet(BC_LOG_TAB);
    sh.appendRow(['Sent', 'Send ID', 'Sent By', 'Subject', 'Sent To (count)', 'Failed (count)', 'Recipients', 'Failed', 'Message']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 9).setFontWeight('bold');
  }
  return sh;
}

function apiBcList_(b) {
  const me = apiBcWho_(b.appToken);
  const hidden = apiBcHidden_();
  const all = getAllEmployees();
  let noEmail = 0;
  const people = Object.keys(all).map(function (k) { return all[k]; }).filter(function (e) {
    const ok = BC_EMAIL_RE.test(String(e.email || '').trim());
    if (!ok && String(e.status || '').trim().toLowerCase() !== 'inactive') noEmail++;
    return ok;
  }).map(function (e) {
    return {
      id: String(e.id), name: String(e.name || ''), email: String(e.email || '').trim(),
      department: String(e.department || ''), manager: String(e.manager || ''),
      inactive: String(e.status || '').trim().toLowerCase() === 'inactive',
      hidden: hidden.indexOf(String(e.id)) !== -1
    };
  }).sort(function (x, y) { return x.name.localeCompare(y.name); });

  let recent = [];
  const sh = SS.getSheetByName(BC_LOG_TAB);
  if (sh && sh.getLastRow() > 1) {
    const n = Math.min(15, sh.getLastRow() - 1);
    const tz = Session.getScriptTimeZone();
    recent = sh.getRange(sh.getLastRow() - n + 1, 1, n, 7).getValues().reverse().map(function (r) {
      return { at: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'MMM d, yyyy h:mm a') : String(r[0]),
               by: String(r[2]), subject: String(r[3]), count: r[4], failed: r[5], to: String(r[6]).slice(0, 600) };
    });
  }
  let quota = null; try { quota = MailApp.getRemainingDailyQuota(); } catch (e) {}
  return { me: { name: me.name, email: me.email }, people: people, noEmail: noEmail, recent: recent, quota: quota, max: BC_MAX_RECIPIENTS };
}

function apiBcHide_(b) {
  apiBcWho_(b.appToken);
  const id = String(b.employeeId || '');
  if (!id || !getEmployeeById(id)) throw new Error('Employee not found.');
  let list = apiBcHidden_().filter(function (x) { return x !== id; });
  if (b.hide !== false) list.push(id);
  PropertiesService.getScriptProperties().setProperty('BCAST_HIDDEN', JSON.stringify(list));
  return { hidden: b.hide !== false };
}

function apiBcSend_(b) {
  const me = apiBcWho_(b.appToken);
  const subject = String(b.subject || '').replace(/\s+/g, ' ').trim().slice(0, 150);
  const message = String(b.message || '').replace(/\r\n/g, '\n').trim().slice(0, 10000);
  if (!subject) throw new Error('Please enter a subject.');
  if (!message) throw new Error('Please type a message.');
  const sendId = String(b.sendId || '').slice(0, 40);
  const cache = CacheService.getScriptCache();
  if (sendId) {
    const done = cache.get('bcsend_' + sendId);
    if (done) return JSON.parse(done);           // double tap / retry — already sent, don't send again
  }

  // Look up every address on the sheet — never trust addresses from the browser.
  const all = getAllEmployees();
  const seen = {};
  const people = (b.ids || []).map(String).filter(function (id) {
    if (seen[id]) return false; seen[id] = true;
    const e = all[id]; return !!(e && BC_EMAIL_RE.test(String(e.email || '').trim()));
  }).map(function (id) { return all[id]; });
  if (!people.length) throw new Error('Pick at least one person with an email address.');
  if (people.length > BC_MAX_RECIPIENTS) throw new Error('Up to ' + BC_MAX_RECIPIENTS + ' people per send. Split the list and send twice.');
  const copyMe = !!b.copyMe && !!me.email;
  let quota = null; try { quota = MailApp.getRemainingDailyQuota(); } catch (e) {}
  if (quota !== null && quota < people.length + (copyMe ? 1 : 0)) {
    throw new Error('Google only lets this account send ' + quota + ' more email' + (quota === 1 ? '' : 's') + ' today. Pick fewer people or send tomorrow.');
  }

  const greet = b.greet !== false;
  const opts = { name: 'Logistics Warehouse — ' + me.name };
  if (me.email) opts.replyTo = me.email;
  const sent = [], failed = [];
  people.forEach(function (e) {
    const first = String(e.name || '').trim().split(/\s+/)[0] || '';
    try {
      const html = apiBcHtml_(subject, message, greet ? first : '', me);
      const plain = (greet && first ? 'Hi ' + first + ',\n\n' : '') + message + '\n\n— ' + me.name + '\nLogistics Warehouse';
      GmailApp.sendEmail(String(e.email).trim(), subject, plain, Object.assign({ htmlBody: html }, opts));
      sent.push(String(e.name));
    } catch (err) {
      failed.push(String(e.name) + ' (' + String(err && err.message || err).slice(0, 80) + ')');
    }
  });
  if (copyMe) {
    try {
      GmailApp.sendEmail(me.email, '[Copy] ' + subject, 'Your email went to ' + sent.length + ' people:\n' + sent.join(', ') + '\n\n' + message,
        Object.assign({ htmlBody: '<p style="font:13px Arial;color:#555">Your copy — sent to ' + sent.length + ' people: ' + apiBcEsc_(sent.join(', ')) + '</p>' + apiBcHtml_(subject, message, '', me) }, opts));
    } catch (e) {}
  }

  const lock = LockService.getScriptLock();
  if (lock.tryLock(20000)) {
    try {
      apiBcLogSheet_().appendRow([new Date(), sendId, me.name, subject, sent.length, failed.length, sent.join(', '), failed.join(', '), message.slice(0, 5000)]);
    } catch (e) { Logger.log('Broadcast log failed: ' + e); }
    finally { lock.releaseLock(); }
  }
  const out = { sent: sent.length, failed: failed };
  if (sendId) cache.put('bcsend_' + sendId, JSON.stringify(out), 1800);
  return out;
}

/** Company-branded email: red bar, white body, black footer rule. Message is plain text (escaped). */
function apiBcHtml_(subject, message, firstName, me) {
  const body = apiBcEsc_(message)
    .replace(/(https?:\/\/[^\s<\"']+)/g, '<a href="$1" style="color:#c8102e">$1</a>')
    .replace(/\n/g, '<br>');
  return '<div style="background:#f4f4f4;padding:20px 0;font-family:Arial,Helvetica,sans-serif">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e0e4">'
    + '<tr><td style="background:#c8102e;border-bottom:4px solid #161616;padding:16px 22px;color:#ffffff">'
    + '<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.9">Logistics Warehouse</div>'
    + '<div style="font-size:20px;font-weight:bold;margin-top:4px">' + apiBcEsc_(subject) + '</div></td></tr>'
    + '<tr><td style="padding:22px;color:#1c1c2b;font-size:15px;line-height:1.55">'
    + (firstName ? '<p style="margin:0 0 14px">Hi ' + apiBcEsc_(firstName) + ',</p>' : '')
    + body
    + '<p style="margin:18px 0 0">— ' + apiBcEsc_(me.name) + '</p></td></tr>'
    + '<tr><td style="padding:12px 22px;border-top:1px solid #e2e0e4;color:#5c5c6b;font-size:12px">'
    + 'Sent by ' + apiBcEsc_(me.name) + ' through the Warehouse Toolkit.'
    + (me.email ? ' Reply to this email to reach ' + apiBcEsc_(me.name) + '.' : '')
    + '</td></tr></table></div>';
}

function apiBcEsc_(s) { return apiEscapeHtml_(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// ============================================================================
// EMPLOYEE
// ============================================================================
function apiEmpBootstrap_(b, s) {
  const emp = getEmployeeById(s.i);
  if (!emp) throw new Error('Employee record not found.');
  return {
    profile: { id: s.i, name: emp.name, department: emp.department, manager: emp.manager, managerEmail: emp.managerEmail },
    balance: getCurrentPTOBalance(s.i),
    requests: getDetailedEmployeeHistory(s.i, null),
    asks: apiAskList_().filter(function (a) { return a.employeeId === s.i; }).slice(0, 60)
  };
}

function apiEmpSubmit_(b, s) {
  const type = String(b.absenceType || '');
  if (API_EMPLOYEE_TYPES.indexOf(type) === -1) throw new Error('Invalid absence type.');
  const start = String(b.startDate || '');
  const end = type === 'Half Day PTO' ? start : String(b.endDate || start);
  apiCheckDates_(start, end);
  const res = submitPTORequest(s.i, type, start, end, String(b.notes || '').slice(0, 1000), '', '');
  if (!res || !res.success) throw new Error((res && res.message) || 'Submit failed.');
  apiNotifyManagerOf_(s.i, 'PTO request: ' + apiFirstName_(s.i), type + ' · ' + apiNiceRange_(start, end) + ' · ' + apiNum_(res.daysCount) + ' day' + (res.daysCount == 1 ? '' : 's') + '. Tap to approve or deny.');
  return res;
}

function apiEmpCancel_(b, s) {
  const reqId = String(b.requestId || '');
  const reason = String(b.reason || '').trim();
  if (!reason) throw new Error('Please give a reason for withdrawing.');
  const row = apiFindRequest_(reqId);
  if (!row) throw new Error('Request not found.');
  if (row.employeeId !== s.i) throw new Error('You can only withdraw your own requests.');
  if (row.status !== 'Pending' && row.status !== 'Approved') throw new Error('This request is already ' + row.status + '.');
  const info = apiRequestInfo_(reqId);
  const res = cancelPTORequest(reqId, reason.slice(0, 500));
  if (!res || !res.success) throw new Error((res && res.message) || 'Cancel failed.');
  if (info) apiNotifyManagerOf_(s.i, 'Request withdrawn: ' + apiFirstName_(s.i), info.type + ' · ' + apiNiceRange_(info.start, info.end) + ' (was ' + row.status + '). Reason: ' + reason.slice(0, 120));
  return res;
}

function apiEmpMessage_(b, s) {
  const subject = String(b.subject || '').trim().slice(0, 120);
  const message = apiMaybeEsc_(String(b.message || '').trim().slice(0, 3000));
  if (!subject || !message) throw new Error('Subject and message are required.');
  const res = sendQuickMessageToManager(s.i, apiMaybeEsc_(subject), message);
  if (!res || !res.success) throw new Error((res && res.message) || 'Message failed.');
  return res;
}

// ============================================================================
// MANAGER
// ============================================================================
function apiMgrBootstrap_(b, s) {
  const types = getAbsenceTypes();
  return {
    profile: { id: s.i, name: s.n, email: s.e },
    employees: getAllEmployeesForManager(),
    absenceTypes: Object.keys(types).map(function (k) { return { name: k, deductFromPTO: types[k].deductFromPTO, isPTO: isPTOAbsenceType(k) }; }),
    team: getManagerTeam(''),
    requests: getDetailedEmployeeHistory('', null),
    asks: apiAsksForManager_(),
    hrEmails: HR_EMAILS
  };
}

function apiMgrApprove_(b, s) {
  const reqId = String(b.requestId || '');
  const row = apiFindRequest_(reqId);
  if (!row) throw new Error('Request not found.');
  if (row.status !== 'Pending') throw new Error('This request is already ' + row.status + ' — refresh to see the latest.');
  // approvePTORequest() looks up the approver's name by matching this value to
  // a Managers ID — passing the verified manager ID records the right name.
  const info = apiRequestInfo_(reqId);
  const res = approvePTORequest(reqId, s.i);
  if (!res || !res.success) throw new Error((res && res.message) || 'Approve failed.');
  if (info) apiNotify_([info.employeeId], 'employee', 'Time off approved ✓', info.type + ' · ' + apiNiceRange_(info.start, info.end) + ' — approved by ' + (s.n || 'your manager') + '.');
  return res;
}

function apiMgrDeny_(b, s) {
  const reqId = String(b.requestId || '');
  const reason = String(b.reason || '').trim();
  if (!reason) throw new Error('A denial reason is required.');
  const row = apiFindRequest_(reqId);
  if (!row) throw new Error('Request not found.');
  if (row.status !== 'Pending') throw new Error('This request is already ' + row.status + ' — refresh to see the latest.');
  const info = apiRequestInfo_(reqId);
  const res = denyPTORequest(reqId, s.i, apiMaybeEsc_(reason.slice(0, 500)));
  if (!res || !res.success) throw new Error((res && res.message) || 'Deny failed.');
  if (info) apiNotify_([info.employeeId], 'employee', 'Time off denied', info.type + ' · ' + apiNiceRange_(info.start, info.end) + '. ' + (s.n || 'Your manager') + ': ' + reason.slice(0, 120));
  return res;
}

function apiMgrRecord_(b) {
  const start = String(b.startDate || '');
  const end = String(b.endDate || start);
  apiCheckDates_(start, end);
  const res = recordManualAbsence(
    String(b.employeeId || ''), String(b.absenceType || ''), start, end,
    String(b.reason || '').slice(0, 1000), String(b.startTime || ''), String(b.endTime || '')
  );
  if (!res || !res.success) throw new Error((res && res.message) || 'Record failed.');
  return res;
}

function apiMgrEmailReport_(b) {
  const emails = (b.emails || []).map(function (x) { return String(x).trim(); })
    .filter(function (x) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x); });
  if (!emails.length) throw new Error('Enter at least one valid email address.');
  return emailDetailedReport(b.employeeId || '', parseInt(b.year, 10) || new Date().getFullYear(), emails.slice(0, 10));
}


// ============================================================================
// TIME OFF "ASKS"  — an employee asks, the manager decides.
// Lives on its own tab (Time_Off_Asks). It is NOT in PTO_Requests, so it never
// counts as an absence, never shows on calendars and never goes to TLand —
// until a manager uses Record, which writes a normal manager entry.
// ============================================================================
const ASK_SHEET = 'Time_Off_Asks';
const ASK_HEADERS = ['Ask ID', 'Submitted', 'Employee ID', 'Employee Name', 'Department', 'Manager', 'Manager Email',
  'Start Date', 'End Date', 'Timing', 'Start Time', 'End Time', 'Reason', 'Status', 'Handled By', 'Handled Date', 'Manager Note', 'Recorded As'];
const ASK_TIMINGS = { allday: 'All day', leave: 'Leave early', arrive: 'Come in late', custom: 'Part of the day' };

function apiAskSheet_() {
  let sh = SS.getSheetByName(ASK_SHEET);
  if (!sh) {
    sh = SS.insertSheet(ASK_SHEET);
    sh.getRange(1, 1, 1, ASK_HEADERS.length).setValues([ASK_HEADERS])
      .setBackground('#1C1C1C').setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('H:L').setNumberFormat('@'); // dates/times stay plain text (no timezone shifts)
  }
  return sh;
}

function apiTimingLabel_(timing, t1, t2) {
  if (timing === 'leave') return 'Leave early at ' + apiTime12_(t1);
  if (timing === 'arrive') return 'Come in late at ' + apiTime12_(t1);
  if (timing === 'custom') return apiTime12_(t1) + ' – ' + apiTime12_(t2);
  return 'All day';
}
function apiTime12_(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); if (!m) return String(t || '');
  let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + m[2] + ' ' + ap;
}

function apiAskList_() {
  const sh = SS.getSheetByName(ASK_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const tz = SS.getSpreadsheetTimeZone();
  const txt = function (v) { return Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v || ''); };
  const tm = function (v) { return Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, tz, 'HH:mm') : String(v || ''); };
  return sh.getRange(2, 1, sh.getLastRow() - 1, ASK_HEADERS.length).getValues()
    .filter(function (r) { return r[0]; })
    .map(function (r, i) {
      const timing = String(r[9] || 'allday');
      return {
        row: i + 2, askId: String(r[0]), submitted: r[1], employeeId: String(r[2]), employeeName: String(r[3]), department: String(r[4]),
        manager: String(r[5]), managerEmail: String(r[6]), startDate: txt(r[7]), endDate: txt(r[8]) || txt(r[7]),
        timing: timing, startTime: tm(r[10]), endTime: tm(r[11]), timingLabel: apiTimingLabel_(timing, tm(r[10]), tm(r[11])),
        reason: String(r[12] || ''), status: String(r[13] || 'Waiting'), handledBy: String(r[14] || ''), handledDate: r[15],
        managerNote: String(r[16] || ''), recordedAs: String(r[17] || '')
      };
    })
    .sort(function (a, b) { return String(b.askId).localeCompare(String(a.askId)); });
}

function apiAsksForManager_() {
  const cutoff = Date.now() - 75 * 864e5;
  return apiAskList_().filter(function (a) {
    if (a.status === 'Waiting') return true;
    const t = Object.prototype.toString.call(a.submitted) === '[object Date]' ? a.submitted.getTime() : Date.parse(a.submitted);
    return !t || t >= cutoff;
  });
}

function apiFindAsk_(askId) {
  const a = apiAskList_().filter(function (x) { return x.askId === String(askId || ''); })[0];
  if (!a) throw new Error('Ask not found — refresh to see the latest.');
  return a;
}

function apiSetAskStatus_(ask, status, by, note, recordedAs) {
  const sh = apiAskSheet_();
  sh.getRange(ask.row, 14, 1, 5).setValues([[status, by || '', new Date(), note || '', recordedAs || '']]);
}

function apiEmpAsk_(b, s) {
  const emp = getEmployeeById(s.i);
  if (!emp) throw new Error('Employee record not found.');
  const start = String(b.startDate || ''), end = String(b.endDate || b.startDate || '');
  apiCheckDates_(start, end);
  const tz = SS.getSpreadsheetTimeZone();
  if (start < Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd')) throw new Error('Asks are for today or later. For a past day, talk with your manager.');
  const timing = ASK_TIMINGS[b.timing] ? String(b.timing) : 'allday';
  const reTime = /^\d{2}:\d{2}$/;
  let t1 = '', t2 = '';
  if (timing === 'leave' || timing === 'arrive') { t1 = String(b.startTime || ''); if (!reTime.test(t1)) throw new Error('Please pick a time.'); }
  if (timing === 'custom') {
    t1 = String(b.startTime || ''); t2 = String(b.endTime || '');
    if (!reTime.test(t1) || !reTime.test(t2) || t2 <= t1) throw new Error('Please pick a start and end time.');
  }
  const reason = String(b.reason || '').trim().slice(0, 500);
  if (!reason) throw new Error('Please tell your manager why you need the time.');
  // one waiting ask per overlapping date range
  const dup = apiAskList_().filter(function (a) { return a.employeeId === s.i && a.status === 'Waiting' && a.startDate <= end && a.endDate >= start; });
  if (dup.length) throw new Error('You already have an ask waiting for those dates. Withdraw it first if something changed.');

  const ask = {
    askId: 'ASK-' + new Date().getTime(), submitted: new Date(), employeeId: s.i, employeeName: emp.name, department: emp.department || '',
    manager: emp.manager || '', managerEmail: emp.managerEmail || '', startDate: start, endDate: end, timing: timing,
    startTime: t1, endTime: t2, reason: reason, status: 'Waiting'
  };
  ask.timingLabel = apiTimingLabel_(timing, t1, t2);
  const sh = apiAskSheet_();
  const row = sh.getLastRow() + 1;
  const vals = [[ask.askId, ask.submitted, ask.employeeId, ask.employeeName, ask.department, ask.manager, ask.managerEmail,
    start, end, timing, t1, t2, reason, 'Waiting', '', '', '', '']];
  sh.getRange(row, 8, 1, 5).setNumberFormat('@');
  sh.getRange(row, 1, 1, ASK_HEADERS.length).setValues(vals);
  if (typeof emAskToManager_ === 'function') {
    emAskToManager_(ask, emp.managerEmail);
    emAskConfirm_(ask, emp.email, emp.manager);
  } else {
    GmailApp.sendEmail(emp.managerEmail, 'Time Off Ask — ' + emp.name + ' — ' + start + ' (not an official request)',
      emp.name + ' is asking for time off: ' + start + (end !== start ? ' to ' + end : '') + ' · ' + ask.timingLabel + '\nReason: ' + reason +
      '\n\nThis is an ask, not an official request. Record it in the PTO Manager app if approved.');
  }
  apiNotifyManagerOf_(s.i, 'Time off ask: ' + apiFirstName_(s.i), ask.timingLabel + ' · ' + apiNiceRange_(start, end) + ' — ' + reason.slice(0, 100));
  return ask;
}

function apiEmpAskWithdraw_(b, s) {
  const ask = apiFindAsk_(b.askId);
  if (ask.employeeId !== s.i) throw new Error('You can only withdraw your own asks.');
  if (ask.status !== 'Waiting') throw new Error('This ask is already ' + ask.status + '.');
  apiSetAskStatus_(ask, 'Withdrawn', s.n, '', '');
  if (typeof emAskWithdrawn_ === 'function') emAskWithdrawn_(ask, ask.managerEmail);
  return { success: true };
}

function apiMgrAskRecord_(b, s) {
  const ask = apiFindAsk_(b.askId);
  if (ask.status !== 'Waiting') throw new Error('This ask is already ' + ask.status + ' — refresh to see the latest.');
  const type = String(b.absenceType || '');
  const types = getAbsenceTypes();
  if (!types[type]) throw new Error('Pick an absence type.');
  if (isPTOAbsenceType(type)) throw new Error('Asks are recorded as non-PTO types. For PTO, the employee submits a PTO request.');
  const start = String(b.startDate || ask.startDate), end = String(b.endDate || start);
  apiCheckDates_(start, end);
  const reason = String(b.reason || ('Time off ask: ' + ask.reason)).slice(0, 1000);
  const res = recordManualAbsence(ask.employeeId, type, start, end, reason, String(b.startTime || ''), String(b.endTime || ''));
  if (!res || !res.success) throw new Error((res && res.message) || 'Record failed.');
  apiSetAskStatus_(ask, 'Recorded', s.n, String(b.note || '').slice(0, 300), type);
  apiNotify_([ask.employeeId], 'employee', 'Your ask: yes ✓', ask.timingLabel + ' · ' + apiNiceRange_(ask.startDate, ask.endDate) + ' — OK\'d by ' + (s.n || 'your manager') + ' (' + type + ').');
  return { success: true, daysCount: res.daysCount, message: res.message };
}

function apiMgrAskDecline_(b, s) {
  const ask = apiFindAsk_(b.askId);
  if (ask.status !== 'Waiting') throw new Error('This ask is already ' + ask.status + ' — refresh to see the latest.');
  const note = String(b.note || '').trim().slice(0, 500);
  if (!note) throw new Error('Please add a short note for the employee.');
  apiSetAskStatus_(ask, 'Declined', s.n, note, '');
  apiNotify_([ask.employeeId], 'employee', 'Your ask was declined', apiNiceRange_(ask.startDate, ask.endDate) + '. ' + (s.n || 'Your manager') + ': ' + note.slice(0, 120));
  const emp = getEmployeeById(ask.employeeId);
  if (emp && typeof emAskDeclined_ === 'function') emAskDeclined_(ask, emp.email, s.n, note);
  else if (emp) GmailApp.sendEmail(emp.email, 'Time Off Ask Declined — ' + ask.startDate, s.n + ': ' + note);
  return { success: true };
}


// ============================================================================
// PHONE NOTIFICATIONS (v1.3.0) — never throws; a notification problem never blocks a request
// ============================================================================
const API_NOTIFY_URL = 'https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/pto_notify';

function apiNotify_(ptoIds, kind, title, body) {
  try {
    const secret = PropertiesService.getScriptProperties().getProperty('PTO_SUPABASE_SECRET');
    const ids = (ptoIds || []).map(function (x) { return String(x || '').trim(); }).filter(String);
    if (!secret || !ids.length) return;
    UrlFetchApp.fetch(API_NOTIFY_URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { apikey: API_BRIDGE_KEY },
      payload: JSON.stringify({ p_secret: secret, p_to: ids.slice(0, 20), p_kind: kind, p_title: String(title || '').slice(0, 120), p_body: String(body || '').slice(0, 200) })
    });
  } catch (e) { Logger.log('⚠️ notify skipped: ' + e); }
}

/** The employee's own manager(s): the Managers tab row(s) whose email matches the employee's Manager Email. */
function apiNotifyManagerOf_(employeeId, title, body) {
  try {
    const emp = getEmployeeById(employeeId);
    const mEmail = String((emp && emp.managerEmail) || '').trim().toLowerCase();
    if (!mEmail) return;
    const all = getAllManagers();
    const ids = Object.keys(all).filter(function (id) { return String(all[id].email || '').trim().toLowerCase() === mEmail && String(id) !== String(employeeId); });
    if (ids.length) apiNotify_(ids, 'manager', title, body);
  } catch (e) { Logger.log('⚠️ notify (manager) skipped: ' + e); }
}

function apiRequestInfo_(requestId) {
  try {
    const sheet = SS.getSheetByName(SHEET_NAMES.PTO_REQUESTS);
    if (!sheet || sheet.getLastRow() < 2) return null;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(requestId)) return { employeeId: String(data[i][1]), type: String(data[i][4] || ''), start: data[i][5], end: data[i][6], days: data[i][7] };
    }
  } catch (e) {}
  return null;
}
function apiFirstName_(id) { const e = getEmployeeById(id); return e ? String(e.name || id) : String(id); }
function apiNum_(n) { const x = parseFloat(n); return isNaN(x) ? '0' : String(Math.round(x * 100) / 100); }
function apiNiceDate_(v) {
  const d = Object.prototype.toString.call(v) === '[object Date]' ? v : parseDate(String(v || '').trim());
  return d && !isNaN(d.getTime()) ? Utilities.formatDate(d, SS.getSpreadsheetTimeZone(), 'EEE MMM d') : String(v || '');
}
function apiNiceRange_(a, b) { const A = apiNiceDate_(a), B = apiNiceDate_(b || a); return A === B ? A : A + ' – ' + B; }

// ============================================================================
// HELPERS
// ============================================================================
function apiFindRequest_(requestId) {
  const sheet = SS.getSheetByName(SHEET_NAMES.PTO_REQUESTS);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === requestId) {
      return { row: i + 2, employeeId: String(data[i][1]), status: String(data[i][9] || '') };
    }
  }
  return null;
}

function apiCheckDates_(start, end) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(start) || !re.test(end)) throw new Error('Dates must be valid.');
  if (end < start) throw new Error('End date must be on or after the start date.');
}

/** The branded emails escape text themselves; the old templates don't, so escape only for them. */
function apiMaybeEsc_(s) { return typeof emInstallBrandedEmails_ === 'function' ? String(s) : apiEscapeHtml_(s); }

function apiEscapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Turn Date objects into yyyy-MM-dd text so nothing shifts a day in transit. */
function apiClean_(v) {
  if (v === null || v === undefined) return v;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, SS.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  if (Array.isArray(v)) return v.map(apiClean_);
  if (typeof v === 'object') {
    const out = {};
    Object.keys(v).forEach(function (k) { out[k] = apiClean_(v[k]); });
    return out;
  }
  if (typeof v === 'number' && !isFinite(v)) return 0;
  return v;
}

function apiJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- signed tokens (HMAC-SHA256, secret in Script Properties) ----------
function apiSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('API_TOKEN_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('API_TOKEN_SECRET', secret);
  }
  return secret;
}

function apiB64_(bytesOrString) {
  return Utilities.base64EncodeWebSafe(bytesOrString).replace(/=+$/, '');
}

function apiSignToken_(payload) {
  const body = apiB64_(Utilities.newBlob(JSON.stringify(payload)).getBytes());
  const sig = apiB64_(Utilities.computeHmacSha256Signature(body, apiSecret_()));
  return body + '.' + sig;
}

function apiVerifyToken_(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const parts = token.split('.');
  const expected = apiB64_(Utilities.computeHmacSha256Signature(parts[0], apiSecret_()));
  if (expected !== parts[1]) return null;
  try {
    let b = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const payload = JSON.parse(Utilities.newBlob(Utilities.base64Decode(b)).getDataAsString());
    if (!payload.x || Date.now() > payload.x) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ============================================================================
// RUN ONCE FROM THE EDITOR: authorizes the new pieces and checks everything.
// Select apiSelfTest in the function dropdown → Run → View → Execution log.
// ============================================================================
function apiSelfTest() {
  Logger.log('=== PTO API self-test (v' + API_VERSION + ') ===');
  Logger.log('isPTOAbsenceType: ' + (isPTOAbsenceType !== apiFallbackIsPTO_ ? 'using your EXISTING function ✅' : 'not found — using the Api.gs fallback (Full/Half Day PTO only) ✅'));
  Logger.log('  "Full Day PTO" → ' + isPTOAbsenceType('Full Day PTO') + ' | "Half Day PTO" → ' + isPTOAbsenceType('Half Day PTO') + ' | "Call-in" → ' + isPTOAbsenceType('Call-in'));
  Logger.log('Employees visible to login: ' + apiPublicEmployees_().length);
  Logger.log('Managers visible to login: ' + apiPublicManagers_().length);
  Logger.log('Absence types: ' + Object.keys(getAbsenceTypes()).join(', '));
  Logger.log('Requests on file: ' + getDetailedEmployeeHistory('', null).length);
  Logger.log('Time off asks on file: ' + apiAskList_().length + ' (tab "' + ASK_SHEET + '" is created on the first ask)');
  try {
    const allE = getAllEmployees();
    const withEmail = Object.keys(allE).filter(function (k) { return BC_EMAIL_RE.test(String(allE[k].email || '').trim()); }).length;
    Logger.log('Email Employees: ' + withEmail + ' people with an email, ' + apiBcHidden_().length + ' hidden, Gmail quota left today: ' + MailApp.getRemainingDailyQuota());
  } catch (e) { Logger.log('Email Employees check: ' + e); }
  Logger.log('Branded emails (Emails.gs): ' + (typeof emInstallBrandedEmails_ === 'function' ? 'ON ✅' : 'not installed — old email look'));
  const t = apiSignToken_({ i: 'TEST', r: 'employee', x: Date.now() + 60000 });
  Logger.log('Token sign/verify: ' + (apiVerifyToken_(t) ? 'OK ✅' : 'FAILED ❌'));
  CacheService.getScriptCache().put('api_selftest', '1', 10);
  Logger.log('Cache + Properties + Lock: OK ✅');
  Logger.log('Phone notifications: ' + (PropertiesService.getScriptProperties().getProperty('PTO_SUPABASE_SECRET') ? 'ready ✅ (uses PTO_SUPABASE_SECRET)' : 'OFF — Script Property PTO_SUPABASE_SECRET is missing ❌'));
  try {
    const r = UrlFetchApp.fetch(API_BRIDGE_WHO_URL, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { apikey: API_BRIDGE_KEY }, payload: JSON.stringify({ p_token: 'self-test-not-a-real-sign-in' }) });
    Logger.log('Toolkit bridge (Supabase): ' + (r.getResponseCode() === 200 ? 'reachable ✅' : 'HTTP ' + r.getResponseCode() + ' ❌'));
  } catch (e) { Logger.log('Toolkit bridge (Supabase): ' + e + ' ❌ — run again and approve the "connect to an external service" permission'); }
  Logger.log('=== Done. Now deploy: Deploy → Manage deployments → ✏️ → Version: New version → Deploy ===');
}
