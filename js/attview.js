/* JMG HR Portal — attview.js
   Shared read-only rendering of one employee's month (used by "My attendance & pay", "Team data" and the HR attendance page). */
(function () {
'use strict';
const A = window.App, PR = window.Payroll;
const { esc, t, fmtNum } = A;
const money = n => Number(n).toLocaleString(A.locale(), { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const shiftOf = d => (d.shifts || []).find(s => s.id === d.user.shiftId) || (d.shifts || [])[0] || null;
function punchMap(list) { const m = {}; (list || []).forEach(r => { m[r.date] = r.times ? r.times.split(',') : []; }); return m; }

// data = payload of myAttendance / teamMember
function compute(data) {
  return PR.computeMonth({ user: data.user, month: data.month, punches: punchMap(data.punches), requests: data.requests, advances: data.advances,
    shift: shiftOf(data), payroll: data.payroll, weekend: A.CFG.WEEKEND, today: A.isoDate(new Date()) });
}
function summaryHTML(S) {
  const c = t('cur');
  const cards = [
    ['sum_salary', `${money(S.salary)} ${c}`, ''], ['sum_rate', `${money(S.rate)} ${c}`, ''], ['sum_present', fmtNum(S.present), 'ok'], ['sum_absent', fmtNum(S.absent), S.absent ? 'bad' : ''],
    ['sum_leave', fmtNum(S.leaveDays), ''], ['sum_late', `${fmtNum(S.late)} (${fmtNum(S.lateDays)} ${t('u_days')})`, S.late ? 'bad' : ''],
    ['sum_ded', `${money(S.deductAmount)} ${c}`, S.deductAmount ? 'bad' : ''], ['sum_adv', `${money(S.advanceDed)} ${c}`, S.advanceDed ? 'bad' : ''],
    ['sum_adv_left', `${money(S.advanceLeft)} ${c}`, ''], ['sum_transport', `${money(S.transport)} ${c}`, S.transport ? 'ok' : ''], ['sum_net', `${money(S.net)} ${c}`, 'ok']
  ];
  return cards.map(([k, v, cl]) => `<div class="stat ${cl}"><span>${esc(t(k))}</span><b>${esc(v)}</b></div>`).join('');
}
function rowsHTML(rows) {
  return rows.map((r, i) => {
    const day = new Date(r.date + 'T12:00:00').toLocaleDateString(A.locale(), { weekday: 'long' });
    return `<tr style="--i:${Math.min(i, 14)}"><td class="num">${esc(r.date)}</td><td>${esc(day)}</td><td class="num">${esc(r.first || '-')}</td><td class="num">${esc(r.last || '-')}</td>
      <td class="times">${esc(r.times.join('  '))}</td><td class="num">${r.late ? fmtNum(r.late) : '-'}</td>
      <td><span class="badge d-${esc(r.status)}">${esc(t('d_' + r.status))}</span>${r.info ? `<span class="sm">${esc(r.info)}</span>` : ''}</td>
      <td class="num">${r.ded ? fmtNum(r.ded) : '-'}</td><td class="num">${r.amount ? money(r.amount) : '-'}</td></tr>`;
  }).join('');
}
function missionsHTML(requests) {
  const ms = (requests || []).filter(r => r.type === 'Mission').sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  if (!ms.length) return `<tr><td colspan="5"><div class="empty">-</div></td></tr>`;
  return ms.map(r => `<tr><td class="num">${esc(r.startDate)}</td><td>${esc(r.mission)}</td><td>${r.amount > 0 ? esc(money(r.amount)) + ' ' + esc(t('cur')) : '-'}</td><td>${esc(r.notes || '-')}</td>
    <td>${/^https:\/\/www\.google\.com\/maps/.test(r.mapUrl || '') ? `<a class="maplink" href="${esc(r.mapUrl)}" target="_blank" rel="noopener">${A.icon('pin', 13)}${esc(t('view_location'))}</a>` : '-'}</td></tr>`).join('');
}
const dayHeader = () => `<th>${esc(t('th_date'))}</th><th>${esc(t('th_day'))}</th><th>${esc(t('th_in'))}</th><th>${esc(t('th_out'))}</th><th>${esc(t('th_punches'))}</th><th>${esc(t('th_late'))}</th><th>${esc(t('th_status'))}</th><th>${esc(t('th_ded_days'))}</th><th>${esc(t('th_ded_amt'))}</th>`;

window.AttView = { compute, summaryHTML, rowsHTML, missionsHTML, dayHeader, shiftOf, punchMap, money };
})();
