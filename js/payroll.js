/* JMG HR Portal — payroll.js
   Pure functions (no DOM): fingerprint-file parsing and the attendance / payroll calculation. */
(function (root) {
'use strict';

const pad = n => String(n).padStart(2, '0');
const r2 = n => Math.round(n * 100) / 100;
const AR = '٠١٢٣٤٥٦٧٨٩', FA = '۰۱۲۳۴۵۶۷۸۹';
const norm = v => String(v == null ? '' : v).replace(/[٠-٩]/g, d => AR.indexOf(d)).replace(/[۰-۹]/g, d => FA.indexOf(d)).trim();
const fold = v => norm(v).toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[\u064B-\u0652]/g, '');
const ymd = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);

/* ---------- reading values from a fingerprint file ---------- */
// Excel stores dates as serial numbers (days since 1899-12-30) and times as fractions of a day.
function serialParts(n) {
  let days = Math.floor(n), mins = Math.round((n - days) * 1440);
  if (mins >= 1440) { days += 1; mins -= 1440; }
  const d = new Date(Date.UTC(1899, 11, 30) + days * 864e5);
  return { date: ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), time: (n - Math.floor(n)) > 0 ? `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}` : null };
}
function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v >= 1 ? serialParts(v).date : null;
  if (v instanceof Date) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  const s = norm(v);
  let m = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if (m) { const a = +m[1], b = +m[2]; return a > 12 ? ymd(+m[3], b, a) : b > 12 ? ymd(+m[3], a, b) : ymd(+m[3], b, a); }   // day/month/year unless clearly month/day
  m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2})(?!\d)/);
  if (m) { const a = +m[1], b = +m[2], y = 2000 + +m[3]; return a > 12 ? ymd(y, b, a) : b > 12 ? ymd(y, a, b) : ymd(y, b, a); }
  return null;
}
function parseTimes(v) {
  if (v == null || v === '') return [];
  if (typeof v === 'number') { const p = serialParts(v); return p.time ? [p.time] : []; }
  if (v instanceof Date) return [`${pad(v.getHours())}:${pad(v.getMinutes())}`];
  const s = norm(v), out = [], re = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm]|ص|م)?/g;
  let m;
  while ((m = re.exec(s))) {
    let h = +m[1]; const mi = +m[2], ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' || ap === 'م') { if (h < 12) h += 12; } else if ((ap === 'am' || ap === 'ص') && h === 12) h = 0;
    if (h <= 23 && mi <= 59) out.push(`${pad(h)}:${pad(mi)}`);
  }
  return out;
}
// one cell holding both date and time (number with fraction, Date object, or text)
function parseDateTime(v) {
  if (typeof v === 'number') { const p = serialParts(v); return { date: p.date, times: p.time ? [p.time] : [] }; }
  return { date: parseDate(v), times: parseTimes(v) };
}

const KEYS = {
  code: ['code', 'emp id', 'empid', 'employee id', 'employee no', 'user id', 'userid', 'badge', 'id', 'كود', 'رقم الموظف', 'الكود', 'رقم'],
  name: ['name', 'employee name', 'اسم', 'الاسم'],
  dept: ['department', 'dept', 'قسم', 'القسم'],
  datetime: ['datetime', 'date/time', 'date time', 'timestamp', 'تاريخ ووقت', 'التاريخ والوقت'],
  date: ['date', 'day', 'تاريخ', 'التاريخ', 'اليوم'],
  time: ['time', 'check', 'punch', 'in', 'out', 'وقت', 'الوقت', 'بصمة', 'حضور', 'انصراف', 'دخول', 'خروج'],
  title: ['job', 'title', 'position', 'role', 'وظيفة', 'المسمى', 'الدور', 'مسمى']
};
function detectColumns(headers) {
  const h = headers.map(fold);
  const find = (keys, skip) => { for (const k0 of keys) { const k = fold(k0); const i = h.findIndex((x, j) => !skip.includes(j) && (x === k || x.indexOf(k) > -1)); if (i > -1) return i; } return -1; };
  const used = [];
  const pick = (name, keys) => { const i = find(keys, used); if (i > -1) used.push(i); return i; };
  const datetime = pick('datetime', KEYS.datetime), code = pick('code', KEYS.code), name = pick('name', KEYS.name), dept = pick('dept', KEYS.dept);
  const date = datetime > -1 ? -1 : pick('date', KEYS.date), time = datetime > -1 ? -1 : pick('time', KEYS.time);
  const title = pick('title', KEYS.title);
  return { code, name, dept, title, date, time, time2: -1, datetime, combined: datetime > -1 };
}
function findHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const cells = (aoa[i] || []).filter(c => String(c).trim() !== '');
    if (cells.length >= 2 && cells.filter(c => typeof c === 'string' && isNaN(Number(norm(c)))).length >= Math.ceil(cells.length / 2) && aoa[i + 1]) return i;
  }
  return 0;
}
// rows -> one entry per employee per day with all punch times: [code, date, "HH:MM,HH:MM", name, dept]
function groupPunches(aoa, headerRow, map) {
  const g = {}, people = {}; let ok = 0, bad = 0;
  for (let i = headerRow + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    if (r.every(c => String(c).trim() === '')) continue;
    const code = String(r[map.code] == null ? '' : r[map.code]).trim().replace(/\.0+$/, '');
    let date = null, times = [];
    if (map.combined) { const dt = parseDateTime(r[map.datetime]); date = dt.date; times = dt.times; }
    else {
      date = parseDate(r[map.date]);
      if (!date && map.time > -1) { const dt = parseDateTime(r[map.time]); date = dt.date; }
      times = parseTimes(r[map.time]);
      if (map.time2 > -1) times = times.concat(parseTimes(r[map.time2]));
    }
    if (!code || !date || !times.length) { bad++; continue; }
    const k = code + '|' + date;
    if (!g[k]) g[k] = { code, date, times: new Set(), name: map.name > -1 ? String(r[map.name] || '') : '', dept: map.dept > -1 ? String(r[map.dept] || '') : '' };
    times.forEach(t => g[k].times.add(t));
    if (!people[code]) people[code] = { code, name: map.name > -1 ? String(r[map.name] || '').trim() : '', department: map.dept > -1 ? String(r[map.dept] || '').trim() : '', jobTitle: map.title > -1 ? String(r[map.title] || '').trim() : '' };
    ok++;
  }
  const rows = Object.values(g).map(x => [x.code, x.date, Array.from(x.times).sort().join(','), x.name, x.dept]);
  return { rows, ok, bad, people };
}

/* ---------- employees import (the downloadable form, or any similar Excel/CSV) ---------- */
const UKEYS = {
  accountRole: ['permission', 'account role', 'account type', 'صلاحية', 'نوع الحساب'],
  code: ['code', 'emp id', 'empid', 'employee id', 'employee no', 'badge', 'id', 'كود', 'رقم الموظف', 'الكود', 'رقم'],
  email: ['email', 'e-mail', 'mail', 'ايميل', 'بريد'],
  salary: ['salary', 'pay', 'مرتب', 'راتب'],
  annualBalance: ['balance', 'leave', 'رصيد', 'اجازات', 'اجازة'],
  shift: ['shift', 'شيفت', 'دوام'],
  manager: ['manager', 'مدير'],
  department: ['department', 'dept', 'قسم'],
  jobTitle: ['job', 'title', 'position', 'role', 'وظيفة', 'المسمى', 'الدور', 'مسمى'],
  name: ['name', 'اسم', 'الاسم']
};
function detectUserColumns(headers) {
  const h = headers.map(fold), used = [], map = {};
  Object.keys(UKEYS).forEach(field => {
    let idx = -1;
    for (const k0 of UKEYS[field]) { const k = fold(k0); idx = h.findIndex((x, j) => !used.includes(j) && (x === k || x.indexOf(k) > -1)); if (idx > -1) break; }
    map[field] = idx; if (idx > -1) used.push(idx);
  });
  return map;
}
function buildUserRows(aoa, headerRow, map) {
  const out = [], cell = (r, i) => (i > -1 && r[i] != null ? r[i] : '');
  for (let i = headerRow + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    if (r.every(c => String(c).trim() === '')) continue;
    const row = {
      code: String(cell(r, map.code)).trim().replace(/\.0+$/, ''), name: String(cell(r, map.name)).trim(), jobTitle: String(cell(r, map.jobTitle)).trim(),
      department: String(cell(r, map.department)).trim(), email: String(cell(r, map.email)).trim(), salary: cell(r, map.salary), annualBalance: cell(r, map.annualBalance),
      shift: String(cell(r, map.shift)).trim(), manager: String(cell(r, map.manager)).trim().replace(/\.0+$/, ''), role: String(cell(r, map.accountRole)).trim()
    };
    const num = v => Number(norm(v).replace(/[,٬\s]/g, '').replace('٫', '.'));
    if (row.salary !== '') row.salary = num(row.salary); if (row.annualBalance !== '') row.annualBalance = num(row.annualBalance);
    if (row.name || row.code) out.push(row);
  }
  return out;
}

/* ---------- payroll periods (a company month may start on any day, e.g. 26th) ---------- */
function periodRange(month, startDay) {
  const [y, m] = month.split('-').map(Number), sd = Math.max(1, Math.min(28, Number(startDay) || 1));
  if (sd <= 1) return { from: `${month}-01`, to: `${month}-${pad(new Date(y, m, 0).getDate())}`, y, m };
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  return { from: `${py}-${pad(pm)}-${pad(sd)}`, to: `${month}-${pad(sd - 1)}`, y, m };
}
function periodKey(dateStr, startDay) {
  const sd = Math.max(1, Math.min(28, Number(startDay) || 1)), y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7), d = +dateStr.slice(8, 10);
  if (sd <= 1 || d < sd) return dateStr.slice(0, 7);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
}
const monthRange = (month, startDay) => { const r = periodRange(month, startDay); return Object.assign(r, { days: Math.round((new Date(r.to + 'T12:00:00') - new Date(r.from + 'T12:00:00')) / 864e5) + 1 }); };
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
function eachDate(from, to, fn) {
  const x = new Date(from + 'T12:00:00'), y = new Date(to + 'T12:00:00');
  for (const d = new Date(x); d <= y; d.setDate(d.getDate() + 1)) fn(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, d.getDay());
}
const daysBetween = eachDate;

/* ---------- Egyptian official holidays (fixed dates + Coptic Easter + Hijri holidays, the Hijri ones are approximate) ---------- */
function orthodoxEaster(y) {                                        // Julian computus, converted to the Gregorian calendar (+13 days for 1900-2099)
  const a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7, mo = Math.floor((d + e + 114) / 31), dy = ((d + e + 114) % 31) + 1;
  const dt = new Date(y, mo - 1, dy + 13, 12);
  return dt;
}
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function egyptHolidays(year) {
  const out = [], push = (date, name, nameEn, approx) => out.push({ date, name, nameEn, approx: !!approx });
  [['01-07', 'عيد الميلاد المجيد', 'Coptic Christmas'], ['01-25', 'عيد الثورة وعيد الشرطة', 'January 25 Revolution & Police Day'], ['04-25', 'عيد تحرير سيناء', 'Sinai Liberation Day'],
   ['05-01', 'عيد العمال', 'Labour Day'], ['06-30', 'ثورة 30 يونيو', 'June 30 Revolution'], ['07-23', 'ثورة 23 يوليو', 'July 23 Revolution'], ['10-06', 'عيد القوات المسلحة', 'Armed Forces Day']]
    .forEach(h => push(`${year}-${h[0]}`, h[1], h[2], false));
  const easter = orthodoxEaster(year), sham = new Date(easter); sham.setDate(sham.getDate() + 1);
  push(iso(sham), 'شم النسيم', 'Sham El-Nessim', false);
  try {                                                             // Hijri holidays: dates follow the moon, so they are estimates to be confirmed against the official announcement
    const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric' }), map = {};
    eachDate(`${year}-01-01`, `${year}-12-31`, (ds) => {
      const parts = f.formatToParts(new Date(ds + 'T12:00:00')), m = +parts.find(p => p.type === 'month').value, d = +parts.find(p => p.type === 'day').value;
      (map[`${m}-${d}`] = map[`${m}-${d}`] || []).push(ds);
    });
    const at = (m, d) => (map[`${m}-${d}`] || [])[0];
    [[1, 1, 'رأس السنة الهجرية', 'Islamic New Year'], [3, 12, 'المولد النبوي الشريف', "Prophet's Birthday"],
     [10, 1, 'عيد الفطر (اليوم الأول)', 'Eid al-Fitr (day 1)'], [10, 2, 'عيد الفطر (اليوم الثاني)', 'Eid al-Fitr (day 2)'], [10, 3, 'عيد الفطر (اليوم الثالث)', 'Eid al-Fitr (day 3)'],
     [12, 9, 'وقفة عيد الأضحى', 'Arafat Day'], [12, 10, 'عيد الأضحى (اليوم الأول)', 'Eid al-Adha (day 1)'], [12, 11, 'عيد الأضحى (اليوم الثاني)', 'Eid al-Adha (day 2)'], [12, 12, 'عيد الأضحى (اليوم الثالث)', 'Eid al-Adha (day 3)']]
      .forEach(h => { const ds = at(h[0], h[1]); if (ds) push(ds, h[2], h[3], true); });
  } catch (e) { /* Intl calendar not available: only the fixed holidays are generated */ }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/* ---------- attendance + payroll for one employee and one payroll month ----------
   o: { user:{salary,annualBalance,leaveBefore}, month:'YYYY-MM', punches:{date:[times]}, requests:[approved], advances:[...], shift:{start,end}|null,
        payroll:{...rules, overtime:{...}|null}, holidays:[{date,name}], weekend:[5,6], today:'YYYY-MM-DD',
        opts:{ includeOvertime, offsetLate, showOvertime } } */
function computeMonth(o) {
  const P = o.payroll || {}, sd = P.cycleStartDay || 1, R = periodRange(o.month, sd), weekend = o.weekend || [5, 6];
  const OT = P.overtime || null, opts = o.opts || {}, showOT = OT && opts.showOvertime !== false;
  const hol = {}; (o.holidays || []).forEach(h => { hol[h.date] = h; });
  const hasData = Object.keys(o.punches).some(d => d >= R.from && d <= R.to);
  const leave = {}, mission = {}, perm = {}, missionInfo = {};
  let transport = 0;
  (o.requests || []).forEach(r => {
    if (r.type === 'Leave') eachDate(r.startDate, r.endDate || r.startDate, (d, dow) => { if (d >= R.from && d <= R.to && weekend.indexOf(dow) < 0 && !hol[d]) leave[d] = 1; });
    else if (r.type === 'Mission') { mission[r.startDate] = 1; missionInfo[r.startDate] = r.mission || ''; if (r.amount > 0 && r.startDate >= R.from && r.startDate <= R.to) transport += Number(r.amount); }
    else if (r.type === 'Permission') (perm[r.startDate] = perm[r.startDate] || []).push(r);
  });
  // advances: the approved amount is deducted in equal monthly installments starting with the payroll month of the request
  const mi = R.y * 12 + R.m;
  let advanceDed = 0, advanceLeft = 0;
  (o.advances || []).forEach(a => {
    const N = Math.max(1, Math.round(a.installments || 1)), st = periodKey(String(a.startDate), sd).split('-'), smi = +st[0] * 12 + +st[1], per = a.amount / N;
    if (mi < smi) return;
    const paid = Math.max(0, Math.min(N, mi - smi + 1));
    if (mi < smi + N) advanceDed += (mi === smi + N - 1) ? a.amount - per * (N - 1) : per;
    advanceLeft += paid >= N ? 0 : a.amount - per * paid;
  });
  let working = 0;
  eachDate(R.from, R.to, (d, dow) => { if (weekend.indexOf(dow) < 0 && !hol[d]) working++; });
  const salary = Number(o.user.salary) || 0, basis = P.dayBasis === 'working' ? working : 30, rate = basis ? salary / basis : 0;
  const shiftMin = o.shift ? toMin(o.shift.end) - toMin(o.shift.start) : 0, validShift = !!o.shift && shiftMin > 0, minuteRate = rate / (validShift ? shiftMin : 480);
  const tiers = (P.lateTiers || []).slice().sort((a, b) => b.after - a.after);
  const absentD = P.absentNoExcuseDays === undefined ? 1 : P.absentNoExcuseDays, beyondD = P.leaveBeyondBalanceDays === undefined ? 1 : P.leaveBeyondBalanceDays;
  const total = o.user.annualBalance === undefined || o.user.annualBalance === null ? Infinity : Number(o.user.annualBalance);
  let leaveUsed = Number(o.user.leaveBefore) || 0;
  const rows = [];
  const S = { salary, rate: r2(rate), basis, present: 0, absent: 0, leave: 0, late: 0, lateDays: 0, leaveDays: 0, absentDays: 0, leaveBeyond: 0, deductDays: 0, deductAmount: 0, net: salary, hasData, working,
    transport: r2(transport), advanceDed: r2(advanceDed), advanceLeft: r2(advanceLeft), overtimeMin: 0, overtimeAmount: 0, holidays: 0 };
  eachDate(R.from, R.to, (date, dow) => {
    const off = weekend.indexOf(dow) > -1, h = hol[date], times = (o.punches[date] || []).slice().sort(), first = times[0] || '', last = times.length > 1 ? times[times.length - 1] : '';
    let status, late = 0, ded = 0, info = '', ot = 0, otAmt = 0;
    const overtimeOn = (minutes, mult) => { if (showOT && minutes >= (OT.minMinutes || 0) && minutes > 0) { ot = minutes; otAmt = r2(minutes * minuteRate * mult); } };
    if (leave[date]) {
      status = 'leave'; S.leave++; leaveUsed++;
      if (leaveUsed > total) { ded = beyondD; S.leaveBeyond++; info = 'beyond'; } else ded = P.deductApprovedLeave ? 1 : 0;
      S.leaveDays += ded;
    } else if (h) {
      status = 'holiday'; info = h.name || ''; S.holidays++;
      if (times.length > 1) overtimeOn(toMin(last) - toMin(first), OT ? OT.multHoliday : 1);
    } else if (off) {
      status = times.length ? 'present' : 'off';
      if (times.length > 1) overtimeOn(toMin(last) - toMin(first), OT ? OT.multOff : 1);
    } else if (mission[date]) { status = 'mission'; S.present++; info = missionInfo[date] || ''; }
    else if (times.length) {
      status = 'present'; S.present++;
      if (validShift) {
        late = Math.max(0, toMin(first) - toMin(o.shift.start));
        const excused = (perm[date] || []).some(p => p.startTime <= o.shift.start && p.endTime >= first);
        if (excused) late = 0;
        else { const t = tiers.find(x => late >= x.after); if (t) { ded = t.days; S.late++; S.lateDays += ded; } }
        if (last) overtimeOn(toMin(last) - toMin(o.shift.end), OT ? OT.multNormal : 1);
      }
    }
    else if (!hasData) status = 'nodata';
    else if (date < o.today) { status = 'absent'; ded = absentD; S.absent++; S.absentDays += absentD; }
    else status = 'pending';
    S.deductDays += ded; S.overtimeMin += ot; S.overtimeAmount += otAmt;
    rows.push({ date, dow, status, first, last, times, late, ded: r2(ded), amount: r2(ded * rate), info, ot, otAmount: otAmt });
  });
  S.deductDays = r2(S.deductDays); S.lateDays = r2(S.lateDays); S.leaveDays = r2(S.leaveDays); S.absentDays = r2(S.absentDays);
  S.absentAmount = r2(S.absentDays * rate); S.lateAmount = r2(S.lateDays * rate); S.leaveAmount = r2(S.leaveDays * rate);
  S.overtimeAmount = r2(S.overtimeAmount);
  // overtime options (chosen when the payroll is produced): add it to pay or not, and whether lateness is paid back out of it
  const include = showOT && (opts.includeOvertime !== undefined ? opts.includeOvertime : OT.includeInPayroll !== false);
  const offset = include && (opts.offsetLate !== undefined ? opts.offsetLate : !!OT.offsetLate);
  S.lateEff = offset ? r2(Math.max(0, S.lateAmount - S.overtimeAmount)) : S.lateAmount;
  S.overtimeEff = include ? (offset ? r2(Math.max(0, S.overtimeAmount - S.lateAmount)) : S.overtimeAmount) : 0;
  S.deductAmount = r2(S.absentAmount + S.lateEff + S.leaveAmount);                    // total penalties actually taken from the salary
  S.net = r2(Math.max(0, salary - S.deductAmount - S.advanceDed) + S.transport + S.overtimeEff);
  S.showOvertime = !!showOT; S.range = { from: R.from, to: R.to };
  return { rows, summary: S };
}

const codeKey = c => { c = String(c == null ? '' : c).trim(); return /^\d+$/.test(c) ? c.replace(/^0+(?=\d)/, '') : c.toLowerCase(); };   // "0042" and "42" are the same device code
const api = { codeKey, periodRange, periodKey, egyptHolidays, orthodoxEaster, norm, fold, detectUserColumns, buildUserRows, parseDate, parseTimes, parseDateTime, detectColumns, findHeaderRow, groupPunches, computeMonth, monthRange, serialParts, r2 };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Payroll = api;
})(typeof window !== 'undefined' ? window : this);
