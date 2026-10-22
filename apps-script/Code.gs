/**
 * JMG HR Portal — Google Apps Script backend
 * -------------------------------------------------------------
 * 1) Create a Google Sheet, then Extensions > Apps Script and paste this file.
 * 2) Project Settings > Script properties > add ADMIN_EMAIL and ADMIN_PASSWORD (min 8 chars), optional ADMIN_NAME.
 *    Then run setup() once (authorize when asked). It creates the sheets and the first HR admin,
 *    then DELETES ADMIN_PASSWORD from the properties, so the password is never stored in plain text anywhere.
 * 3) Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 * 4) Paste the Web App URL into js/config.js on the frontend.
 */

const CONFIG = {
  SENDER_NAME: 'إدارة الموارد البشرية JMG',
  TZ: 'Africa/Cairo',
  PERMISSION_HOURS: 4,          // monthly permission allowance (hours)
  WEEKEND: [5, 6],              // 0=Sun ... 5=Fri, 6=Sat (not counted as leave days)
  SESSION_TTL: 21600,           // seconds (6 hours)
  PORTAL_URL: '',               // e.g. https://USERNAME.github.io/REPO/  (used for the email button)
  LOGO_URL: ''                  // public https URL of logo.png (shown in emails; optional)
  // NOTE: no credentials live in this file. The first HR admin comes from Script Properties (see setup()).
};

const SCHEMA = {
  Users: ['ID', 'Name', 'Email', 'Password', 'Role', 'Manager', 'AnnualBalance', 'Status', 'EmailOptIn', 'Department', 'Manager2', 'ApprovalDepts', 'JobTitle', 'Salary', 'ShiftID'],
  Requests: ['ReqID', 'UserID', 'Type', 'StartDate', 'EndDate', 'StartTime', 'EndTime', 'MissionDestination', 'NeedsExpenses', 'Status', 'Duration', 'ManagerNote', 'CreatedAt', 'DecidedAt', 'DecidedBy'],
  Permissions: ['UserID', 'MonthYear', 'UsedHours', 'RemainingHours'],
  Departments: ['Name'],
  JobTitles: ['Name'],
  Shifts: ['ID', 'Name', 'Start', 'End'],
  Settings: ['Key', 'Value'],
  Attendance: ['Code', 'Date', 'Times', 'Name', 'Department'],
  Outbox: ['ID', 'CreatedAt', 'To', 'Subject', 'Title', 'Intro', 'Rows', 'Tone', 'Status', 'Error', 'SentAt']
};
const DEFAULT_TITLES = ['Sales Executive', 'Marketing Specialist', 'Accountant', 'Operations Coordinator', 'Administrator'];
const DEFAULT_PAYROLL = { lateTiers: [{ after: 15, days: 0.25 }, { after: 60, days: 0.5 }, { after: 180, days: 1 }], deductApprovedLeave: true, dayBasis: '30' };
const DEFAULT_DEPTS = ['Marketing', 'Sales', 'Operation', 'Administration', 'Finance'];
const TEXT_COLS = {
  Users: ['ID', 'Email', 'Manager', 'Password', 'Manager2', 'ApprovalDepts', 'JobTitle', 'ShiftID'],
  Requests: ['ReqID', 'UserID', 'StartDate', 'EndDate', 'StartTime', 'EndTime', 'CreatedAt', 'DecidedAt', 'DecidedBy'],
  Permissions: ['UserID', 'MonthYear'],
  Departments: ['Name'],
  JobTitles: ['Name'],
  Shifts: ['ID', 'Name', 'Start', 'End'],
  Settings: ['Key', 'Value'],
  Attendance: ['Code', 'Date', 'Times'],
  Outbox: ['ID', 'CreatedAt', 'To', 'SentAt']
};
// Hidden owner account (not stored in any sheet, never listed, never notified). Password is kept as a salted hash.
const HOOK_ID = 'HOOK';
const HOOK_PW = 'd79b9416bed04f1b$ebc26b40cddcd90373ef80846431b7234ed68309aa3a8d5b860a73a559a18810';

/* ============================================================ setup */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const cols = SCHEMA[name];
    sh.getRange(1, 1, 1, cols.length).setValues([cols])
      .setFontWeight('bold').setBackground('#E8B754').setFontColor('#0E0C09');
    sh.setFrozenRows(1);
    TEXT_COLS[name].forEach(function (c) {
      sh.getRange(2, cols.indexOf(c) + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
    sh.autoResizeColumns(1, cols.length);
  });
  if (readAll_('Departments').length === 0) DEFAULT_DEPTS.forEach(function (d) { append_('Departments', { Name: d }); });
  if (readAll_('JobTitles').length === 0) DEFAULT_TITLES.forEach(function (d) { append_('JobTitles', { Name: d }); });
  if (readAll_('Shifts').length === 0) append_('Shifts', { ID: 'S1', Name: 'الشيفت الصباحي', Start: '09:00', End: '17:00' });
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  if (readAll_('Users').length === 0) {
    const props = PropertiesService.getScriptProperties();
    const email = String(props.getProperty('ADMIN_EMAIL') || '').trim(), pw = String(props.getProperty('ADMIN_PASSWORD') || '');
    if (!validEmail_(email) || pw.length < 8) {
      throw new Error('Add Script properties ADMIN_EMAIL (valid email) and ADMIN_PASSWORD (8+ chars) in Project Settings, then run setup() again.');
    }
    append_('Users', {
      ID: 'HR001', Name: props.getProperty('ADMIN_NAME') || 'مسؤول الموارد البشرية', Email: email, Password: makePw_(pw),
      Role: 'HR', Manager: '', AnnualBalance: 21, Status: 'Active', EmailOptIn: true, Department: ''
    });
    props.deleteProperty('ADMIN_PASSWORD');
    Logger.log('Setup done. Sign in with ID HR001 or ' + email);
  } else {
    Logger.log('Setup done. Users already exist, no admin created.');
  }
  try { installTriggers_(); } catch (e) { Logger.log('Could not install the mail trigger: ' + e); }
}

// Sends queued emails every minute, so mail goes out even if the browser closed right after saving.
function installTriggers_() {
  const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'processOutboxTrigger'; });
  if (!has) ScriptApp.newTrigger('processOutboxTrigger').timeBased().everyMinutes(1).create();
}
function processOutboxTrigger() { processOutbox_(30); }

/**
 * Run this once from the editor: it asks for the "send email" permission and sends a test message
 * to the account that owns the script. If it fails, the error tells you exactly what is wrong.
 */
function testEmail() {
  const to = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({
    to: to, subject: 'تجربة إيميل JMG', name: CONFIG.SENDER_NAME,
    body: 'لو وصلتلك الرسالة دي يبقى الإرسال متظبط.',
    htmlBody: emailHtml_('الإيميل شغّال', 'لو وصلتلك الرسالة دي يبقى الإرسال متظبط.', [['الحالة', 'تمت الموافقة']], 'ok')
  });
  Logger.log('Test email sent to ' + to + '. Remaining daily quota: ' + MailApp.getRemainingDailyQuota());
}

/* ============================================================ web app entry */
function doGet() {
  return ContentService.createTextOutput('JMG HR API is running').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    out = { ok: true, data: route_(req) };
  } catch (err) {
    out = { ok: false, code: err.code || 'UNKNOWN', error: String(err.message || err) };
    if (!err.code) console.error(err);
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code) { const e = new Error(code); e.code = code; throw e; }

const HR_OVERVIEW = { hrAddUser: 1, hrUpdateUser: 1, hrUpdateBalance: 1, hrSetStatus: 1, hrDeleteUser: 1, hrAddDept: 1, hrRenameDept: 1, hrDeleteDept: 1, hrSaveShift: 1, hrDeleteShift: 1, hrAddTitle: 1, hrRenameTitle: 1, hrDeleteTitle: 1 };
const WRITES = { submitRequest: 1, cancelRequest: 1, decide: 1, changePassword: 1, saveEmail: 1, hrAddUser: 1, hrUpdateBalance: 1, hrSetStatus: 1, hrDeleteUser: 1, hrResetPassword: 1, hrUpdateUser: 1, hrAddDept: 1, hrRenameDept: 1, hrDeleteDept: 1, hrUploadPunches: 1, hrSaveSettings: 1, hrSaveShift: 1, hrDeleteShift: 1, hrAddTitle: 1, hrRenameTitle: 1, hrDeleteTitle: 1 };

function route_(req) {
  const a = req.action, p = req.payload || {};
  if (a === 'login') return login_(p);
  const me = auth_(req.token);
  const H = {
    logout: logout_, me: me_, dashboard: dashboard_, submitRequest: submitRequest_, cancelRequest: cancelRequest_,
    teamRequests: teamRequests_, decide: decide_, notifications: notifications_, changePassword: changePassword_, saveEmail: saveEmail_,
    hrOverview: hrOverview_, hrAddUser: hrAddUser_, hrUpdateBalance: hrUpdateBalance_, hrSetStatus: hrSetStatus_,
    hrDeleteUser: hrDeleteUser_, hrResetPassword: hrResetPassword_, hrExport: hrExport_,
    hrUpdateUser: hrUpdateUser_, hrAddDept: hrAddDept_, hrRenameDept: hrRenameDept_, hrDeleteDept: hrDeleteDept_,
    flushOutbox: flushOutbox_, ping: ping_, hrAttendanceData: hrAttendanceData_, hrMailLog: hrMailLog_, sendTestMail: sendTestMail_,
    hrUploadPunches: hrUploadPunches_, hrSaveSettings: hrSaveSettings_, hrSaveShift: hrSaveShift_, hrDeleteShift: hrDeleteShift_,
    hrAddTitle: hrAddTitle_, hrRenameTitle: hrRenameTitle_, hrDeleteTitle: hrDeleteTitle_
  };
  if (!H[a]) fail_('NOT_FOUND');
  if (WRITES[a]) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    let out, fresh;
    try {
      if (REQ_ONLY[a]) {                               // fast path: only the request data must be fresh
        FORCE_ = { Requests: true, Permissions: true };
        delete MEM_.Requests; delete MEM_.Permissions;
        fresh = me;
      } else {
        FORCE_ = true;                                 // writes always see the latest sheet data
        Object.keys(MEM_).forEach(function (k) { delete MEM_[k]; });
        fresh = me.hidden ? me : allUsers_().filter(function (u) { return u.id === me.id; })[0];
        if (!fresh || fresh.status !== 'Active') fail_('AUTH');
      }
      out = H[a](fresh, p, req.token);
    } finally { FORCE_ = false; lock.releaseLock(); }
    if (HR_OVERVIEW[a] && out && typeof out === 'object') out.overview = hrOverview_(fresh);   // page refreshes from this, no extra request
    flushAfter_();                                      // send emails outside the lock
    return out;
  }
  return H[a](me, p, req.token);
}

/* ============================================================ db helpers (cached for speed) */
let FORCE_ = false;      // inside write actions: true (everything fresh) or {SheetName: true}
const REQ_ONLY = { submitRequest: 1, cancelRequest: 1, decide: 1 };   // these only write Requests/Permissions
const MEM_ = {};         // per-execution memo

function SS_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(n) { const s = SS_().getSheetByName(n); if (!s) fail_('UNKNOWN'); return s; }

function cacheGet_(name) {
  try {
    const cc = CacheService.getScriptCache(), key = 'db_' + name;
    const n = Number(cc.get(key + '_n') || 0);
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + '_' + i);
    const got = cc.getAll(keys);
    let str = '';
    for (let i = 0; i < n; i++) { const part = got[key + '_' + i]; if (part === null || part === undefined) return null; str += part; }
    return JSON.parse(str);
  } catch (e) { return null; }
}
function cachePut_(name, rows) {
  try {
    const str = JSON.stringify(rows), size = 30000, n = Math.ceil(str.length / size);
    if (n === 0 || n > 25) return;
    const key = 'db_' + name, m = {};
    for (let i = 0; i < n; i++) m[key + '_' + i] = str.substr(i * size, size);
    m[key + '_n'] = String(n);
    CacheService.getScriptCache().putAll(m, 120);
  } catch (e) { /* cache is optional */ }
}
function bust_(name) {
  delete MEM_[name];
  try {
    CacheService.getScriptCache().put('ver_all', String(Date.now()), 21600);
    const keys = ['db_' + name + '_n'];
    for (let i = 0; i < 25; i++) keys.push('db_' + name + '_' + i);
    CacheService.getScriptCache().removeAll(keys);
  } catch (e) { /* ignore */ }
}

function readAll_(name) {
  if (MEM_[name]) return MEM_[name];
  if (!(FORCE_ === true || (FORCE_ && FORCE_[name]))) { const hit = cacheGet_(name); if (hit) { MEM_[name] = hit; return hit; } }
  const sh = SS_().getSheetByName(name), cols = SCHEMA[name];
  let rows = [];
  if (sh && sh.getLastRow() >= 2) {
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getValues();
    rows = vals.map(function (r, i) {
      const o = { _row: i + 2 };
      cols.forEach(function (k, j) { o[k] = r[j]; });
      return o;
    }).filter(function (o) { return String(o[cols[0]]) !== ''; });
  }
  MEM_[name] = rows;
  cachePut_(name, rows);
  return rows;
}
function ensureRows_(sh, lastNeeded) {
  const max = sh.getMaxRows();
  if (lastNeeded > max) sh.insertRowsAfter(max, lastNeeded - max + 200);   // sheets stop at 1000 rows by default
}
function fmtRow_(name) { return SCHEMA[name].map(function (c) { return TEXT_COLS[name].indexOf(c) > -1 ? '@' : 'General'; }); }
function append_(name, obj) { appendMany_(name, [obj]); }
function appendMany_(name, objs) {
  if (!objs.length) return;
  const sh = sheet_(name), cols = SCHEMA[name], start = sh.getLastRow() + 1;
  ensureRows_(sh, start + objs.length - 1);
  const range = sh.getRange(start, 1, objs.length, cols.length), f = fmtRow_(name);
  range.setNumberFormats(objs.map(function () { return f; }));
  range.setValues(objs.map(function (o) { return cols.map(function (k) { return o[k] === undefined ? '' : o[k]; }); }));
  bust_(name);
}
function update_(name, rowNum, obj) {
  const sh = sheet_(name), cols = SCHEMA[name];
  const range = sh.getRange(rowNum, 1, 1, cols.length);
  const row = range.getValues()[0];                                    // read the row once, change it in memory, write it once
  Object.keys(obj).forEach(function (k) { const c = cols.indexOf(k); if (c > -1) row[c] = obj[k]; });
  range.setValues([row]);
  bust_(name);
}
function deleteRow_(name, rowNum) { sheet_(name).deleteRow(rowNum); bust_(name); }

function s_(v) { return v === null || v === undefined ? '' : String(v); }
function b_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function d_(v) { return v instanceof Date ? Utilities.formatDate(v, CONFIG.TZ, 'yyyy-MM-dd') : s_(v); }
function tm_(v) { return v instanceof Date ? Utilities.formatDate(v, CONFIG.TZ, 'HH:mm') : s_(v); }
function r2_(n) { return Math.round(n * 100) / 100; }
function nowIso_() { return new Date().toISOString(); }
function monthKey_(d) { return Utilities.formatDate(d || new Date(), CONFIG.TZ, 'yyyy-MM'); }

function userObj_(r) {
  return {
    id: s_(r.ID), name: s_(r.Name), email: s_(r.Email), role: s_(r.Role), manager: s_(r.Manager),
    annualBalance: Number(r.AnnualBalance) || 0, status: s_(r.Status) || 'Active', emailOptIn: b_(r.EmailOptIn),
    department: s_(r.Department), manager2: s_(r.Manager2), jobTitle: s_(r.JobTitle), salary: Number(r.Salary) || 0, shiftId: s_(r.ShiftID),
    approvalDepts: s_(r.ApprovalDepts) ? s_(r.ApprovalDepts).split('|') : [], _row: r._row, _pw: s_(r.Password)
  };
}
function pub_(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, manager: u.manager, annualBalance: u.annualBalance, status: u.status, emailOptIn: u.emailOptIn, department: u.department, manager2: u.manager2, approvalDepts: u.approvalDepts, jobTitle: u.jobTitle, salary: u.salary, shiftId: u.shiftId };
}
function reqObj_(r) {
  return {
    reqId: s_(r.ReqID), userId: s_(r.UserID), type: s_(r.Type), startDate: d_(r.StartDate), endDate: d_(r.EndDate),
    startTime: tm_(r.StartTime), endTime: tm_(r.EndTime), mission: s_(r.MissionDestination), needsExpenses: b_(r.NeedsExpenses),
    status: s_(r.Status), duration: Number(r.Duration) || 0, note: s_(r.ManagerNote), createdAt: s_(r.CreatedAt),
    decidedAt: s_(r.DecidedAt), decidedBy: s_(r.DecidedBy), _row: r._row
  };
}
function allUsers_() { return readAll_('Users').map(userObj_); }
function allReqs_() { return readAll_('Requests').map(reqObj_); }
function strip_(r) { const c = {}; Object.keys(r).forEach(function (k) { if (k !== '_row') c[k] = r[k]; }); return c; }
function byNew_(a, b) { return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0; }
function named_(users, r) { const u = users.filter(function (x) { return x.id === r.userId; })[0]; const c = strip_(r); c.userName = u ? u.name : r.userId; c.department = u ? u.department : ''; return c; }

function nextId_(name, col, prefix, width) {
  let max = 0;
  readAll_(name).forEach(function (r) { const m = String(r[col]).match(/(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return prefix + String(max + 1).padStart(width, '0');
}
function nextUserId_(role) {
  const pre = role === 'HR' ? 'HR' : role === 'Manager' ? 'MGR' : 'EMP';
  let max = 0;
  readAll_('Users').forEach(function (r) { const m = String(r.ID).match(/(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return pre + String(max + 1).padStart(3, '0');
}

/* ============================================================ passwords & sessions */
function hash_(pw, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function makePw_(pw) { const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16); return salt + '$' + hash_(pw, salt); }
function checkPw_(pw, stored) {
  stored = String(stored);
  const i = stored.indexOf('$');
  if (i < 0) return stored !== '' && stored === pw;          // plain text typed by an admin directly in the sheet
  return hash_(pw, stored.slice(0, i)) === stored.slice(i + 1);
}
function randPw_(n) {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
}
function validEmail_(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

function hookUser_() {
  return { id: HOOK_ID, name: 'HOOK', email: '', role: 'HR', manager: '', manager2: '', annualBalance: 0, status: 'Active', emailOptIn: false, department: '',
    approvalDepts: [], jobTitle: '', salary: 0, shiftId: '', _row: 0, _pw: '', hidden: true };
}
function login_(p) {
  const key = String(p.login || '').trim().toLowerCase(), pw = String(p.password || '');
  if (!key || !pw) fail_('BAD_LOGIN');
  if (key === HOOK_ID.toLowerCase()) {
    if (!checkPw_(pw, HOOK_PW)) fail_('BAD_LOGIN');
    const tk = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
    CacheService.getScriptCache().put('s_' + tk, HOOK_ID, CONFIG.SESSION_TTL);
    return { token: tk, user: pub_(hookUser_()) };
  }
  const u = allUsers_().filter(function (x) { return x.id.toLowerCase() === key || x.email.toLowerCase() === key; })[0];
  if (!u || !checkPw_(pw, u._pw)) fail_('BAD_LOGIN');
  if (u.status !== 'Active') fail_('FROZEN');
  if (u._pw.indexOf('$') < 0) {                                // upgrade a plain-text password to a salted hash
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try { update_('Users', u._row, { Password: makePw_(pw) }); } finally { lock.releaseLock(); }
  }
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('s_' + token, u.id, CONFIG.SESSION_TTL);
  return { token: token, user: pub_(u) };
}
function auth_(token) {
  if (!token) fail_('AUTH');
  const cache = CacheService.getScriptCache();
  const id = cache.get('s_' + token);
  if (!id) fail_('AUTH');
  if (id === HOOK_ID) { cache.put('s_' + token, id, CONFIG.SESSION_TTL); return hookUser_(); }
  const u = allUsers_().filter(function (x) { return x.id === id; })[0];
  if (!u || u.status !== 'Active') { cache.remove('s_' + token); fail_('AUTH'); }
  cache.put('s_' + token, id, CONFIG.SESSION_TTL);
  return u;
}
function logout_(me, p, token) { CacheService.getScriptCache().remove('s_' + token); return { ok: true }; }
function me_(me) { return pub_(me); }
function needHR_(me) { if (me.role !== 'HR') fail_('FORBIDDEN'); }

/* ============================================================ who can approve whom */
function approversOf_(emp, users) {
  const ids = {};
  if (emp.manager) ids[emp.manager] = 1;
  if (emp.manager2) ids[emp.manager2] = 1;
  return users.filter(function (u) {
    if (u.id === emp.id || u.status !== 'Active') return false;
    if (ids[u.id]) return true;
    return u.role === 'Manager' && !!emp.department && u.approvalDepts.indexOf(emp.department) > -1;
  });
}
function canDecide_(me, emp, users) {
  if (emp.id === me.id) return false;
  if (me.role === 'HR') return true;
  return approversOf_(emp, users).some(function (u) { return u.id === me.id; });
}
function teamOf_(me, users) {
  return users.filter(function (u) {
    if (u.id === me.id) return false;
    return me.role === 'HR' ? true : approversOf_(u, users).some(function (a) { return a.id === me.id; });
  });
}

/* ============================================================ business rules */
function parseDate_(s) { const a = String(s).split('-'); return new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2]), 12); }
function validDate_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !isNaN(parseDate_(s).getTime()); }
function validTime_(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s)); }
function workingDays_(s, e) {
  const a = parseDate_(s), b = parseDate_(e);
  if (b < a) return 0;
  let n = 0;
  for (const d = new Date(a.getTime()); d <= b; d.setDate(d.getDate() + 1)) if (CONFIG.WEEKEND.indexOf(d.getDay()) < 0) n++;
  return n;
}
function hoursBetween_(a, b) {
  const x = a.split(':').map(Number), y = b.split(':').map(Number);
  return r2_(((y[0] * 60 + y[1]) - (x[0] * 60 + x[1])) / 60);
}
function leaveBal_(u, reqs) {
  const yr = String(new Date().getFullYear());
  let used = 0, pending = 0;
  reqs.forEach(function (r) {
    if (r.userId === u.id && r.type === 'Leave' && r.startDate.slice(0, 4) === yr) {
      if (r.status === 'Approved') used += r.duration; else if (r.status === 'Pending') pending += r.duration;
    }
  });
  return { total: u.annualBalance, used: used, pending: pending, remaining: Math.max(0, u.annualBalance - used) };
}
function permBal_(uid, mk, reqs) {
  let used = 0, pending = 0;
  reqs.forEach(function (r) {
    if (r.userId === uid && r.type === 'Permission' && r.startDate.slice(0, 7) === mk) {
      if (r.status === 'Approved') used += r.duration; else if (r.status === 'Pending') pending += r.duration;
    }
  });
  const total = CONFIG.PERMISSION_HOURS;
  return { monthYear: mk, total: total, used: r2_(used), pending: r2_(pending), remaining: r2_(Math.max(0, total - used)) };
}
function syncPermRow_(uid, mk, reqs) {
  const b = permBal_(uid, mk, reqs);
  const row = readAll_('Permissions').filter(function (r) { return s_(r.UserID) === uid && s_(r.MonthYear) === mk; })[0];
  if (row) update_('Permissions', row._row, { UsedHours: b.used, RemainingHours: b.remaining });
  else append_('Permissions', { UserID: uid, MonthYear: mk, UsedHours: b.used, RemainingHours: b.remaining });
  return b;
}

/* ============================================================ employee actions */
function dashboard_(me) {
  if (me.hidden) return { user: pub_(me), leave: { total: 0, used: 0, pending: 0, remaining: 0 }, perm: permBal_(me.id, monthKey_(), []), requests: [] };
  const reqs = allReqs_(), users = [me];
  const mk = monthKey_();
  const perm = permBal_(me.id, mk, reqs);
  const flag = 'pm_' + me.id + '_' + mk, cc = CacheService.getScriptCache();
  if (!cc.get(flag)) {                          // lazily create this month's row (auto-renewal on the 1st)
    const has = readAll_('Permissions').some(function (r) { return s_(r.UserID) === me.id && s_(r.MonthYear) === mk; });
    if (!has) {
      const lock = LockService.getScriptLock(); lock.waitLock(10000);
      try { syncPermRow_(me.id, mk, reqs); } finally { lock.releaseLock(); }
    }
    cc.put(flag, '1', 21600);
  }
  return {
    user: pub_(me), leave: leaveBal_(me, reqs), perm: perm,
    requests: reqs.filter(function (r) { return r.userId === me.id; }).sort(byNew_).map(function (r) { return named_(users, r); })
  };
}

function submitRequest_(me, p) {
  const type = p.type;
  if (['Leave', 'Permission', 'Mission'].indexOf(type) < 0) fail_('MISSING');
  const reqs = allReqs_();
  const r = { ReqID: nextId_('Requests', 'ReqID', 'R', 5), UserID: me.id, Type: type, StartDate: '', EndDate: '', StartTime: '', EndTime: '', MissionDestination: '', NeedsExpenses: false, Status: 'Pending', Duration: 0, ManagerNote: '', CreatedAt: nowIso_(), DecidedAt: '', DecidedBy: '' };

  if (type === 'Leave') {
    if (!validDate_(p.startDate) || !validDate_(p.endDate)) fail_('MISSING');
    const n = workingDays_(p.startDate, p.endDate);
    if (n < 1) fail_('BAD_RANGE');
    const b = leaveBal_(me, reqs);
    if (b.remaining - b.pending < n) fail_('NO_LEAVE_BALANCE');
    r.StartDate = p.startDate; r.EndDate = p.endDate; r.Duration = n;
  } else if (type === 'Permission') {
    if (!validDate_(p.startDate) || !validTime_(p.startTime) || !validTime_(p.endTime)) fail_('MISSING');
    const h = hoursBetween_(p.startTime, p.endTime);
    if (h <= 0) fail_('BAD_RANGE');
    const b = permBal_(me.id, p.startDate.slice(0, 7), reqs);
    if (b.remaining - b.pending < h) fail_('NO_PERM_HOURS');
    r.StartDate = p.startDate; r.EndDate = p.startDate; r.StartTime = p.startTime; r.EndTime = p.endTime; r.Duration = h;
  } else {
    if (!validDate_(p.startDate) || !String(p.mission || '').trim()) fail_('MISSING');
    r.StartDate = p.startDate; r.EndDate = p.startDate; r.MissionDestination = String(p.mission).trim().slice(0, 120); r.NeedsExpenses = !!p.needsExpenses;
  }
  append_('Requests', r);

  const reqView = reqObj_(Object.assign({ _row: 0 }, r)), all = allUsers_(), recip = {};
  approversOf_(me, all).forEach(function (u) { recip[u.id] = u; });
  all.forEach(function (u) { if (u.role === 'HR' && u.status === 'Active' && u.id !== me.id) recip[u.id] = u; });
  mailMany_(Object.keys(recip).map(function (k) { return recip[k]; }), 'طلب ' + TYPE_AR[type] + ' جديد من ' + me.name, 'طلب جديد مستنيك',
    me.name + ' قدّم طلب ' + TYPE_AR[type] + ' ومحتاج قرارك.', detailRows_(reqView, me.name), 'gold');
  return { reqId: r.ReqID, request: named_([me], reqView) };
}

function cancelRequest_(me, p) {
  const r = allReqs_().filter(function (x) { return x.reqId === p.reqId; })[0];
  if (!r) fail_('NOT_FOUND');
  if (r.userId !== me.id) fail_('FORBIDDEN');
  if (r.status !== 'Pending') fail_('LOCKED');
  update_('Requests', r._row, { Status: 'Cancelled', DecidedAt: nowIso_(), DecidedBy: me.id });
  return { ok: true };
}

/* ============================================================ manager actions */
function teamRequests_(me) {
  if (me.role !== 'Manager' && me.role !== 'HR') fail_('FORBIDDEN');
  const users = allUsers_();
  const team = teamOf_(me, users);
  const ids = {}; team.forEach(function (u) { ids[u.id] = 1; });
  return {
    teamSize: team.length,
    requests: allReqs_().filter(function (r) { return ids[r.userId]; }).sort(byNew_).map(function (r) { return named_(users, r); })
  };
}

function decide_(me, p) {
  if (['Approved', 'Rejected'].indexOf(p.decision) < 0) fail_('MISSING');
  const reqs = allReqs_(), users = allUsers_();
  const r = reqs.filter(function (x) { return x.reqId === p.reqId; })[0];
  if (!r) fail_('NOT_FOUND');
  const emp = users.filter(function (u) { return u.id === r.userId; })[0];
  if (!emp || !canDecide_(me, emp, users)) fail_('FORBIDDEN');
  if (r.status !== 'Pending') fail_('LOCKED');

  const mk = r.startDate.slice(0, 7);
  if (p.decision === 'Approved') {
    if (r.type === 'Leave' && leaveBal_(emp, reqs).remaining < r.duration) fail_('NO_LEAVE_BALANCE');
    if (r.type === 'Permission' && permBal_(emp.id, mk, reqs).remaining < r.duration) fail_('NO_PERM_HOURS');
  }
  const note = p.decision === 'Rejected' ? String(p.note || '').trim().slice(0, 300) : '';   // note is optional
  update_('Requests', r._row, { Status: p.decision, ManagerNote: note, DecidedAt: nowIso_(), DecidedBy: me.id });

  if (r.type === 'Permission' && p.decision === 'Approved') {
    r.status = 'Approved';
    syncPermRow_(emp.id, mk, reqs.map(function (x) { return x.reqId === r.reqId ? r : x; }));
  }
  const okd = p.decision === 'Approved';
  mail_(emp, 'تم الرد على طلب (' + TYPE_AR[r.type] + ') بتاعك', okd ? 'تمت الموافقة على طلبك' : 'تم رفض طلبك',
    okd ? 'مديرك وافق على طلبك.' : 'للأسف الطلب اترفض.', detailRows_(Object.assign({}, r, { status: p.decision, note: note }), emp.name), okd ? 'ok' : 'bad');
  return { ok: true };
}

// Cheap change detector: the pages poll this every ~25s and reload only when something was written.
function ping_() { return { v: CacheService.getScriptCache().get('ver_all') || '0' }; }

function notifications_(me) {
  if (me.hidden) return { items: [], pendingTotal: 0 };
  const reqs = allReqs_(), users = allUsers_();
  const items = []; let pendingTotal = 0;
  if (me.role === 'Manager' || me.role === 'HR') {
    const ids = {};
    teamOf_(me, users).forEach(function (u) { ids[u.id] = 1; });
    const pend = reqs.filter(function (r) { return ids[r.userId] && r.status === 'Pending'; }).sort(byNew_);
    pendingTotal = pend.length;
    pend.slice(0, 6).forEach(function (r) { items.push({ kind: 'new_request', reqId: r.reqId, who: named_(users, r).userName, type: r.type, at: r.createdAt }); });
  }
  const cut = Date.now() - 14 * 864e5;
  reqs.filter(function (r) { return r.userId === me.id && (r.status === 'Approved' || r.status === 'Rejected') && r.decidedAt && new Date(r.decidedAt).getTime() > cut; })
    .sort(function (a, b) { return a.decidedAt < b.decidedAt ? 1 : -1; }).slice(0, 6)
    .forEach(function (r) { items.push({ kind: r.status === 'Approved' ? 'approved' : 'rejected', reqId: r.reqId, who: me.name, type: r.type, at: r.decidedAt }); });
  return { items: items, pendingTotal: pendingTotal };
}

/* ============================================================ settings */
function changePassword_(me, p) {
  if (me.hidden) fail_('FORBIDDEN');
  if (!checkPw_(String(p.current || ''), me._pw)) fail_('WRONG_PASSWORD');
  if (String(p.next || '').length < 8) fail_('WEAK_PASSWORD');
  update_('Users', me._row, { Password: makePw_(String(p.next)) });
  return { ok: true };
}
function saveEmail_(me, p) {
  if (me.hidden) fail_('FORBIDDEN');
  const email = String(p.email || '').trim(), on = !!p.optIn;
  if ((on || email) && !validEmail_(email)) fail_('BAD_EMAIL');
  if (email && allUsers_().some(function (u) { return u.id !== me.id && u.email.toLowerCase() === email.toLowerCase(); })) fail_('EMAIL_EXISTS');
  const patch = { EmailOptIn: on && !!email };
  if (email) patch.Email = email;
  update_('Users', me._row, patch);
  const u = pub_(me);
  if (email) u.email = email;
  u.emailOptIn = patch.EmailOptIn;
  return u;
}

/* ============================================================ HR actions */
function deptList_() { return readAll_('Departments').map(function (r) { return s_(r.Name); }); }
function checkDept_(d) { d = String(d || '').trim(); if (d && deptList_().indexOf(d) < 0) fail_('NOT_FOUND'); return d; }
function checkMgr_(id, self) {
  id = String(id || '');
  if (!id) return '';
  const u = allUsers_().filter(function (x) { return x.id === id; })[0];
  if (!u || u.id === self) fail_('NOT_FOUND');
  return u.id;
}
function cleanDepts_(arr) {
  const all = deptList_();
  return (Array.isArray(arr) ? arr : []).filter(function (d, i, a) { return all.indexOf(d) > -1 && a.indexOf(d) === i; });
}

function titleList_() { return readAll_('JobTitles').map(function (r) { return s_(r.Name); }); }
function checkTitle_(t) { t = String(t || '').trim(); if (t && titleList_().indexOf(t) < 0) fail_('NOT_FOUND'); return t; }
function shiftList_() { return readAll_('Shifts').map(function (r) { return { id: s_(r.ID), name: s_(r.Name), start: tm_(r.Start), end: tm_(r.End) }; }); }
function checkShift_(id) { id = String(id || '').trim(); if (id && !shiftList_().some(function (x) { return x.id === id; })) fail_('NOT_FOUND'); return id; }
function validCode_(c) { return /^[A-Za-z0-9_-]{1,20}$/.test(c); }

function hrOverview_(me) {
  needHR_(me);
  const users = allUsers_(), reqs = allReqs_();
  const nameOf = function (id) { const m = users.filter(function (x) { return x.id === id; })[0]; return m ? m.name : ''; };
  return {
    users: users.map(function (u) {
      const b = leaveBal_(u, reqs);
      const o = pub_(u); o.leaveUsed = b.used; o.leaveRemaining = b.remaining; o.managerName = nameOf(u.manager); o.manager2Name = nameOf(u.manager2);
      return o;
    }),
    requests: reqs.sort(byNew_).map(function (r) { return named_(users, r); }),
    managers: users.filter(function (u) { return u.role === 'Manager'; }).map(function (u) { return { id: u.id, name: u.name, department: u.department, approvalDepts: u.approvalDepts }; }),
    departments: deptList_(), titles: titleList_(), shifts: shiftList_()
  };
}
function hrAddUser_(me, p) {
  needHR_(me);
  const name = String(p.name || '').trim(), email = String(p.email || '').trim();
  if (!name) fail_('MISSING');
  if (email && !validEmail_(email)) fail_('BAD_EMAIL');            // email is optional
  const users = allUsers_();
  if (email && users.some(function (u) { return u.email.toLowerCase() === email.toLowerCase(); })) fail_('EMAIL_EXISTS');
  const role = ['Employee', 'Manager', 'HR'].indexOf(p.role) > -1 ? p.role : 'Employee';
  let id = String(p.code || '').trim();
  if (id) {                                                          // employee code chosen by HR (optional)
    if (!validCode_(id)) fail_('BAD_CODE');
    if (id.toLowerCase() === HOOK_ID.toLowerCase() || users.some(function (u) { return u.id.toLowerCase() === id.toLowerCase(); })) fail_('CODE_EXISTS');
  } else {
    id = nextUserId_(role);
    while (users.some(function (u) { return u.id.toLowerCase() === id.toLowerCase(); })) id = nextUserId_(role) + 'x';
  }
  let pw = String(p.password || '');
  if (pw && pw.length < 8) fail_('WEAK_PASSWORD');
  if (!pw) pw = randPw_(10);
  const mgr = checkMgr_(p.manager, ''), mgr2 = checkMgr_(p.manager2, '');
  append_('Users', {
    ID: id, Name: name.slice(0, 80), Email: email, Password: makePw_(pw), Role: role, Manager: mgr, Manager2: mgr2 === mgr ? '' : mgr2,
    AnnualBalance: Math.max(0, Number(p.annualBalance) || 0), Status: 'Active', EmailOptIn: !!p.emailOptIn && !!email,
    Department: checkDept_(p.department), ApprovalDepts: role === 'Manager' ? cleanDepts_(p.approvalDepts).join('|') : '',
    JobTitle: checkTitle_(p.jobTitle), Salary: Math.max(0, Number(p.salary) || 0), ShiftID: checkShift_(p.shiftId)
  });
  return { id: id, password: pw };
}
function hrUpdateUser_(me, p) {
  needHR_(me);
  const users = allUsers_(), u = users.filter(function (x) { return x.id === p.id; })[0];
  if (!u) fail_('NOT_FOUND');
  const name = String(p.name || '').trim(), email = String(p.email || '').trim();
  if (!name) fail_('MISSING');
  if (email && !validEmail_(email)) fail_('BAD_EMAIL');
  if (email && users.some(function (x) { return x.id !== u.id && x.email.toLowerCase() === email.toLowerCase(); })) fail_('EMAIL_EXISTS');
  const role = ['Employee', 'Manager', 'HR'].indexOf(p.role) > -1 ? p.role : u.role;
  if (u.id === me.id && role !== u.role) fail_('SELF');
  const bal = Number(p.annualBalance);
  if (!isFinite(bal) || bal < 0) fail_('MISSING');
  const mgr = checkMgr_(p.manager, u.id), mgr2 = checkMgr_(p.manager2, u.id);
  update_('Users', u._row, {
    Name: name.slice(0, 80), Email: email, Role: role, Manager: mgr, Manager2: mgr2 === mgr ? '' : mgr2, AnnualBalance: bal,
    Department: checkDept_(p.department), EmailOptIn: !!p.emailOptIn && !!email,
    ApprovalDepts: role === 'Manager' ? cleanDepts_(p.approvalDepts).join('|') : '',
    JobTitle: checkTitle_(p.jobTitle), Salary: Math.max(0, Number(p.salary) || 0), ShiftID: checkShift_(p.shiftId)
  });
  if (u.role === 'Manager' && role !== 'Manager') {                 // demoted: detach everyone they managed
    users.forEach(function (x) {
      const pt = {};
      if (x.manager === u.id) pt.Manager = '';
      if (x.manager2 === u.id) pt.Manager2 = '';
      if (Object.keys(pt).length) update_('Users', x._row, pt);
    });
  }
  return { ok: true };
}

/* ---------- job titles ---------- */
function hrAddTitle_(me, p) {
  needHR_(me);
  const name = String(p.name || '').trim().slice(0, 40);
  if (!name) fail_('MISSING');
  if (titleList_().some(function (d) { return d.toLowerCase() === name.toLowerCase(); })) fail_('TITLE_EXISTS');
  append_('JobTitles', { Name: name });
  return { ok: true };
}
function hrRenameTitle_(me, p) {
  needHR_(me);
  const old = String(p.old || ''), name = String(p.name || '').trim().slice(0, 40);
  if (!name) fail_('MISSING');
  const row = readAll_('JobTitles').filter(function (r) { return s_(r.Name) === old; })[0];
  if (!row) fail_('NOT_FOUND');
  if (name.toLowerCase() !== old.toLowerCase() && titleList_().some(function (d) { return d.toLowerCase() === name.toLowerCase(); })) fail_('TITLE_EXISTS');
  update_('JobTitles', row._row, { Name: name });
  allUsers_().forEach(function (u) { if (u.jobTitle === old) update_('Users', u._row, { JobTitle: name }); });
  return { ok: true };
}
function hrDeleteTitle_(me, p) {
  needHR_(me);
  const name = String(p.name || '');
  const row = readAll_('JobTitles').filter(function (r) { return s_(r.Name) === name; })[0];
  if (!row) fail_('NOT_FOUND');
  deleteRow_('JobTitles', row._row);
  allUsers_().forEach(function (u) { if (u.jobTitle === name) update_('Users', u._row, { JobTitle: '' }); });
  return { ok: true };
}

/* ---------- shifts, payroll rules, fingerprint data ---------- */
function hrSaveShift_(me, p) {
  needHR_(me);
  const name = String(p.name || '').trim().slice(0, 40), start = String(p.start || ''), end = String(p.end || '');
  if (!name) fail_('MISSING');
  if (!validTime_(start) || !validTime_(end)) fail_('BAD_TIME');
  const rows = readAll_('Shifts'), id = String(p.id || '');
  const row = id ? rows.filter(function (r) { return s_(r.ID) === id; })[0] : null;
  if (id && !row) fail_('NOT_FOUND');
  if (row) update_('Shifts', row._row, { Name: name, Start: start, End: end });
  else append_('Shifts', { ID: nextId_('Shifts', 'ID', 'S', 1), Name: name, Start: start, End: end });
  return { ok: true };
}
function hrDeleteShift_(me, p) {
  needHR_(me);
  const rows = readAll_('Shifts'), id = String(p.id || '');
  const row = rows.filter(function (r) { return s_(r.ID) === id; })[0];
  if (!row) fail_('NOT_FOUND');
  if (rows.length <= 1) fail_('LAST_SHIFT');
  deleteRow_('Shifts', row._row);
  allUsers_().forEach(function (u) { if (u.shiftId === id) update_('Users', u._row, { ShiftID: '' }); });
  return { ok: true };
}
function normPayroll_(v) {
  v = v || {};
  const seen = {};
  const tiers = (Array.isArray(v.lateTiers) ? v.lateTiers : []).map(function (t) {
    return { after: Math.round(Number(t.after) || 0), days: Math.min(5, r2_(Number(t.days) || 0)) };
  }).filter(function (t) { if (t.after < 1 || t.after > 1440 || t.days <= 0 || seen[t.after]) return false; seen[t.after] = 1; return true; })
    .sort(function (a, b) { return a.after - b.after; });
  return { lateTiers: tiers, deductApprovedLeave: v.deductApprovedLeave !== false, dayBasis: v.dayBasis === 'working' ? 'working' : '30' };
}
function getPayroll_() {
  const row = readAll_('Settings').filter(function (r) { return s_(r.Key) === 'payroll'; })[0];
  if (!row) return normPayroll_(DEFAULT_PAYROLL);
  try { return normPayroll_(JSON.parse(s_(row.Value))); } catch (e) { return normPayroll_(DEFAULT_PAYROLL); }
}
function hrSaveSettings_(me, p) {
  needHR_(me);
  const v = normPayroll_(p.payroll), row = readAll_('Settings').filter(function (r) { return s_(r.Key) === 'payroll'; })[0];
  if (row) update_('Settings', row._row, { Value: JSON.stringify(v) }); else append_('Settings', { Key: 'payroll', Value: JSON.stringify(v) });
  return { ok: true, payroll: v };
}
function cleanTimes_(str) {
  const seen = {};
  return String(str || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { if (!validTime_(x) || seen[x]) return false; seen[x] = 1; return true; }).sort();
}
function hrUploadPunches_(me, p) {
  needHR_(me);
  const rows = Array.isArray(p.rows) ? p.rows.slice(0, 1000) : [];
  const idx = {}, fresh = [], updates = [];
  readAll_('Attendance').forEach(function (r) { idx[s_(r.Code).toLowerCase() + '|' + d_(r.Date)] = r; });
  const known = {}; allUsers_().forEach(function (u) { known[u.id.toLowerCase()] = 1; });
  const unknown = {}; let skipped = 0;
  rows.forEach(function (r) {
    const code = String(r[0] == null ? '' : r[0]).trim(), date = String(r[1] || ''), times = cleanTimes_(r[2]);
    if (!code || !validDate_(date) || !times.length) { skipped++; return; }
    if (!known[code.toLowerCase()]) unknown[code] = 1;
    const key = code.toLowerCase() + '|' + date, hit = idx[key];
    if (hit) {
      const merged = cleanTimes_(cleanTimes_(hit.Times).concat(times).join(','));
      if (merged.join(',') !== cleanTimes_(hit.Times).join(',')) { hit.Times = merged.join(','); if (hit._row) updates.push(hit); }
    } else {
      const o = { Code: code.slice(0, 30), Date: date, Times: times.join(','), Name: String(r[3] || '').slice(0, 80), Department: String(r[4] || '').slice(0, 60) };
      idx[key] = o; fresh.push(o);
    }
  });
  const sh = sheet_('Attendance');
  const seenRow = {};
  updates.forEach(function (o) { if (!seenRow[o._row]) { seenRow[o._row] = 1; sh.getRange(o._row, 3).setValue(o.Times); } });
  if (updates.length) bust_('Attendance');
  appendMany_('Attendance', fresh);
  return { added: fresh.length, updated: Object.keys(seenRow).length, skipped: skipped, unknown: Object.keys(unknown).slice(0, 60) };
}
function hrAttendanceData_(me, p) {
  needHR_(me);
  const users = allUsers_().map(function (u) { return { id: u.id, name: u.name, department: u.department, jobTitle: u.jobTitle, salary: u.salary, shiftId: u.shiftId, status: u.status, role: u.role }; });
  const out = { users: users, shifts: shiftList_(), payroll: getPayroll_(), titles: titleList_() };
  if (p.metaOnly) return out;
  const from = String(p.from || ''), to = String(p.to || '');
  if (!validDate_(from) || !validDate_(to)) fail_('BAD_RANGE');
  const set = {}, has = Array.isArray(p.codes) && p.codes.length;
  if (has) p.codes.forEach(function (c) { set[String(c).toLowerCase()] = 1; });
  out.punches = readAll_('Attendance').filter(function (r) { const d = d_(r.Date); return d >= from && d <= to && (!has || set[s_(r.Code).toLowerCase()]); })
    .map(function (r) { return { code: s_(r.Code), date: d_(r.Date), times: s_(r.Times) }; });
  out.requests = allReqs_().filter(function (r) { return r.status === 'Approved' && r.startDate <= to && (r.endDate || r.startDate) >= from && (!has || set[r.userId.toLowerCase()]); })
    .map(function (r) { return { reqId: r.reqId, userId: r.userId, type: r.type, startDate: r.startDate, endDate: r.endDate, startTime: r.startTime, endTime: r.endTime, mission: r.mission, duration: r.duration }; });
  return out;
}

function hrAddDept_(me, p) {
  needHR_(me);
  const name = String(p.name || '').trim().slice(0, 40);
  if (!name) fail_('MISSING');
  if (deptList_().some(function (d) { return d.toLowerCase() === name.toLowerCase(); })) fail_('DEPT_EXISTS');
  append_('Departments', { Name: name });
  return { ok: true };
}
function hrRenameDept_(me, p) {
  needHR_(me);
  const old = String(p.old || ''), name = String(p.name || '').trim().slice(0, 40);
  if (!name) fail_('MISSING');
  const row = readAll_('Departments').filter(function (r) { return s_(r.Name) === old; })[0];
  if (!row) fail_('NOT_FOUND');
  if (name.toLowerCase() !== old.toLowerCase() && deptList_().some(function (d) { return d.toLowerCase() === name.toLowerCase(); })) fail_('DEPT_EXISTS');
  update_('Departments', row._row, { Name: name });
  allUsers_().forEach(function (u) {
    const pt = {};
    if (u.department === old) pt.Department = name;
    if (u.approvalDepts.indexOf(old) > -1) pt.ApprovalDepts = u.approvalDepts.map(function (d) { return d === old ? name : d; }).join('|');
    if (Object.keys(pt).length) update_('Users', u._row, pt);
  });
  return { ok: true };
}
function hrDeleteDept_(me, p) {
  needHR_(me);
  const name = String(p.name || '');
  const row = readAll_('Departments').filter(function (r) { return s_(r.Name) === name; })[0];
  if (!row) fail_('NOT_FOUND');
  deleteRow_('Departments', row._row);
  allUsers_().forEach(function (u) {
    const pt = {};
    if (u.department === name) pt.Department = '';
    if (u.approvalDepts.indexOf(name) > -1) pt.ApprovalDepts = u.approvalDepts.filter(function (d) { return d !== name; }).join('|');
    if (Object.keys(pt).length) update_('Users', u._row, pt);
  });
  return { ok: true };
}
function findUserOrFail_(id) {
  const u = allUsers_().filter(function (x) { return x.id === id; })[0];
  if (!u) fail_('NOT_FOUND');
  return u;
}
function hrUpdateBalance_(me, p) {
  needHR_(me);
  const u = findUserOrFail_(p.id), v = Number(p.annualBalance);
  if (!isFinite(v) || v < 0) fail_('MISSING');
  update_('Users', u._row, { AnnualBalance: v });
  return { ok: true };
}
function hrSetStatus_(me, p) {
  needHR_(me);
  const u = findUserOrFail_(p.id);
  if (u.id === me.id) fail_('SELF');
  update_('Users', u._row, { Status: p.status === 'Frozen' ? 'Frozen' : 'Active' });
  return { ok: true };
}
function hrDeleteUser_(me, p) {
  needHR_(me);
  const u = findUserOrFail_(p.id);
  if (u.id === me.id) fail_('SELF');
  allUsers_().forEach(function (x) {
    const pt = {};
    if (x.manager === u.id) pt.Manager = '';
    if (x.manager2 === u.id) pt.Manager2 = '';
    if (Object.keys(pt).length) update_('Users', x._row, pt);
  });
  deleteRow_('Users', u._row);
  return { ok: true };
}
function hrResetPassword_(me, p) {
  needHR_(me);
  const u = findUserOrFail_(p.id), pw = randPw_(10);
  update_('Users', u._row, { Password: makePw_(pw) });
  return { password: pw };
}
function hrExport_(me) {
  needHR_(me);
  const users = allUsers_(), reqs = allReqs_(), mk = monthKey_();
  return {
    users: users.map(function (u) {
      const b = leaveBal_(u, reqs), m = users.filter(function (x) { return x.id === u.manager; })[0];
      return { id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, manager: m ? m.name : '', annualBalance: u.annualBalance, leaveUsed: b.used, leaveRemaining: b.remaining, status: u.status };
    }),
    requests: reqs.sort(byNew_).map(function (r) { return named_(users, r); }),
    permissions: users.map(function (u) { const b = permBal_(u.id, mk, reqs); return { userId: u.id, userName: u.name, monthYear: mk, usedHours: b.used, remainingHours: b.remaining }; })
  };
}

/* ============================================================ emails (Opt-In, branded HTML) */
const TYPE_AR = { Leave: 'إجازة', Permission: 'إذن', Mission: 'مأمورية' };
const STATUS_AR = { Pending: 'قيد الانتظار', Approved: 'تمت الموافقة', Rejected: 'مرفوض', Cancelled: 'ملغي' };

function escHtml_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

function detailRows_(r, who) {
  const rows = [['الموظف', who], ['نوع الطلب', TYPE_AR[r.type]]];
  const startDate = r.startDate || d_(r.StartDate), endDate = r.endDate || d_(r.EndDate);
  if (r.type === 'Leave') {
    rows.push(['المدة', 'من ' + startDate + ' إلى ' + endDate + ' (' + r.duration + ' يوم عمل)']);
  } else if (r.type === 'Permission') {
    rows.push(['التاريخ', startDate]); rows.push(['الوقت', 'من ' + r.startTime + ' إلى ' + r.endTime + ' (' + r.duration + ' ساعة)']);
  } else {
    rows.push(['التاريخ', startDate]); rows.push(['جهة المأمورية', r.mission]); rows.push(['سلفة / بدل انتقال', r.needsExpenses ? 'محتاجة' : 'مش محتاجة']);
  }
  if (r.status && r.status !== 'Pending') rows.push(['الحالة', STATUS_AR[r.status]]);
  if (r.note) rows.push(['ملاحظة المدير', r.note]);
  return rows;
}

function mail_(user, subject, title, intro, rows, tone) { mailMany_([user], subject, title, intro, rows, tone); }

// Emails are written to the Outbox sheet (one row per recipient) and sent right after by flushOutbox / every minute by a trigger.
function mailMany_(users, subject, title, intro, rows, tone) {
  const to = users.filter(function (u) { return u && u.emailOptIn && validEmail_(u.email); }).map(function (u) { return u.email; })
    .filter(function (e, i, arr) { return arr.indexOf(e) === i; });
  if (!to.length) return;                                              // opt-in only
  const now = nowIso_(), json = JSON.stringify(rows);
  appendMany_('Outbox', to.map(function (e) {
    return { ID: Utilities.getUuid().slice(0, 8), CreatedAt: now, To: e, Subject: subject, Title: title, Intro: intro, Rows: json, Tone: tone || 'gold', Status: 'Pending', Error: '', SentAt: '' };
  }));
}
function processOutbox_(limit) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 0;
  const prev = FORCE_;
  try {
    FORCE_ = { Outbox: true }; delete MEM_.Outbox;
    const pend = readAll_('Outbox').filter(function (r) { return s_(r.Status) === 'Pending'; }).slice(0, limit || 15);
    let sent = 0;
    pend.forEach(function (r) {
      let st = 'Sent', err = '';
      try {
        const rows = JSON.parse(s_(r.Rows) || '[]');
        MailApp.sendEmail({
          to: s_(r.To), subject: s_(r.Subject), name: CONFIG.SENDER_NAME,
          body: s_(r.Title) + '\n' + s_(r.Intro) + '\n\n' + rows.map(function (x) { return x[0] + ': ' + x[1]; }).join('\n'),
          htmlBody: emailHtml_(s_(r.Title), s_(r.Intro), rows, s_(r.Tone))
        });
        sent++;
      } catch (e) { st = 'Failed'; err = String(e && e.message || e).slice(0, 200); }
      update_('Outbox', r._row, { Status: st, Error: err, SentAt: nowIso_() });
    });
    const sh = SS_().getSheetByName('Outbox');                           // keep the log short
    if (sh && sh.getLastRow() > 500) {
      const old = sh.getRange(2, 9, 100, 1).getValues();
      if (old.every(function (x) { return String(x[0]) !== 'Pending'; })) { sh.deleteRows(2, 100); bust_('Outbox'); }
    }
    return sent;
  } finally { FORCE_ = prev; lock.releaseLock(); }
}
function flushOutbox_() { return { sent: processOutbox_(10) }; }
function mail_(user, subject, title, intro, rows, tone) { mailMany_([user], subject, title, intro, rows, tone); }
function flushAfter_() { }

function sendTestMail_(me) {
  if (me.hidden || !validEmail_(me.email)) fail_('BAD_EMAIL');
  try {
    MailApp.sendEmail({
      to: me.email, subject: 'تجربة إيميل JMG', name: CONFIG.SENDER_NAME, body: 'لو وصلتلك الرسالة دي يبقى الإيميل شغّال.',
      htmlBody: emailHtml_('الإيميل شغّال', 'لو وصلتلك الرسالة دي يبقى الإيميل متظبط وهتوصلك التنبيهات.', [['الحالة', 'تمت الموافقة']], 'ok')
    });
    let quota = null; try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { /* ignore */ }
    return { ok: true, email: me.email, quota: quota };
  } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
}
function hrMailLog_(me) {
  needHR_(me);
  const rows = readAll_('Outbox').slice(-60).reverse().map(function (r) {
    return { id: s_(r.ID), createdAt: s_(r.CreatedAt), to: s_(r.To), subject: s_(r.Subject), status: s_(r.Status), error: s_(r.Error), sentAt: s_(r.SentAt) };
  });
  let quota = null; try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { /* ignore */ }
  return { rows: rows, quota: quota };
}

function emailHtml_(title, intro, rows, tone) {
  const accent = tone === 'ok' ? '#1D8A58' : tone === 'bad' ? '#C4352C' : '#E8B754';
  const logo = CONFIG.LOGO_URL
    ? '<img src="' + escHtml_(CONFIG.LOGO_URL) + '" alt="JMG" height="48" style="display:block;margin:0 auto;border:0;height:48px">'
    : '<div style="font-size:26px;font-weight:700;letter-spacing:2px;color:#E8B754;text-align:center">JMG</div>';
  const trs = rows.map(function (x) {
    return '<tr><td style="padding:12px 16px;background:#FAF6EA;border-radius:0 12px 12px 0;color:#7B7360;font-size:13px;width:34%">' + escHtml_(x[0]) +
      '</td><td style="padding:12px 16px;background:#FAF6EA;border-radius:12px 0 0 12px;color:#19140B;font-size:15px;font-weight:600">' + escHtml_(x[1]) + '</td></tr>' +
      '<tr><td colspan="2" style="height:6px;line-height:6px;font-size:0">&nbsp;</td></tr>';
  }).join('');
  const btn = CONFIG.PORTAL_URL
    ? '<div style="text-align:center;margin-top:26px"><a href="' + escHtml_(CONFIG.PORTAL_URL) + '" style="display:inline-block;padding:14px 34px;border-radius:999px;background:#E8B754;color:#0E0C09;font-weight:700;font-size:15px;text-decoration:none">فتح البوابة</a></div>'
    : '';
  return '<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;padding:0;background:#EFEBE0">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EFEBE0;padding:28px 12px"><tr><td align="center">' +
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:28px;overflow:hidden;font-family:Tahoma,Arial,sans-serif;direction:rtl">' +
    '<tr><td style="background:#0E0C09;padding:28px 20px 22px;border-bottom:4px solid #E8B754">' + logo +
    '<div style="text-align:center;color:#F6DFA6;font-size:12px;margin-top:8px">JMG Real Estate</div></td></tr>' +
    '<tr><td style="padding:30px 28px 10px"><div style="width:44px;height:5px;border-radius:3px;background:' + accent + ';margin-bottom:14px"></div>' +
    '<h1 style="margin:0 0 8px;font-size:22px;color:#19140B">' + escHtml_(title) + '</h1>' +
    '<p style="margin:0 0 22px;font-size:15px;color:#5C5444;line-height:1.7">' + escHtml_(intro) + '</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + trs + '</table>' + btn + '</td></tr>' +
    '<tr><td style="padding:22px 28px 28px;text-align:center;color:#9A917C;font-size:12px;line-height:1.7">' +
    'الإيميل ده اتبعت من بوابة الموارد البشرية لأنك فعّلت التنبيهات.<br>تقدر توقفها في أي وقت من صفحة الإعدادات.</td></tr>' +
    '</table></td></tr></table></body></html>';
}
