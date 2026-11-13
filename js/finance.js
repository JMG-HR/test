/* JMG HR Portal — finance.js : payroll totals for the finance department and HR.
   Everybody who can open this page can only look. Excel export exists for HR only (the Excel library is not even loaded for others). */
(function () {
'use strict';
const A = window.App, PR = window.Payroll, V = window.AttView;
const { $, esc, t, call, icon, toast, errMsg, fmtNum } = A;
const nm = A.nm, money = V.money;
let meta = null, data = null, month = null, rows = [], isHR = false;

function compute() {
  if (!data) return;
  const dept = $('#dept').value, inc = $('#otInc').checked, off = $('#otOff').checked;
  const hols = (data.holidays || []).map(h => ({ date: h.date, name: V.holName(h) }));
  const pm = {}; data.punches.forEach(p => { (pm[PR.codeKey(p.code)] = pm[PR.codeKey(p.code)] || {})[p.date] = p.times ? p.times.split(',') : []; });
  const byUser = (list, id) => list.filter(r => PR.codeKey(r.userId) === PR.codeKey(id));
  rows = [];
  data.users.filter(u => !dept || (u.department || '') === dept).forEach(u => {
    const sh = data.shifts.find(s => s.id === u.shiftId) || data.shifts[0] || null;
    const r = PR.computeMonth({ user: u, month, punches: pm[PR.codeKey(u.id)] || {}, requests: byUser(data.requests, u.id), advances: byUser(data.advances, u.id), shift: sh, payroll: data.payroll, holidays: hols,
      weekend: A.CFG.WEEKEND, today: A.isoDate(new Date()), opts: { showOvertime: true, includeOvertime: inc, offsetLate: off } });
    if (r.summary.salary > 0 || r.summary.hasData || r.summary.advanceDed || r.summary.transport) rows.push({ u, S: r.summary });
  });
}
const sum = (list, f) => A.r2(list.reduce((a, x) => a + f(x), 0));
const th = keys => '<tr>' + keys.map(k => `<th>${esc(t(k))}</th>`).join('') + '</tr>';

function render() {
  if (!data) return;
  const c = t('cur');
  const tot = { salary: sum(rows, x => x.S.salary), pen: sum(rows, x => x.S.deductAmount), ab: sum(rows, x => x.S.absentAmount), la: sum(rows, x => x.S.lateEff), lv: sum(rows, x => x.S.leaveAmount),
    adv: sum(rows, x => x.S.advanceDed), left: sum(rows, x => x.S.advanceLeft), tr: sum(rows, x => x.S.transport), ot: sum(rows, x => x.S.overtimeEff), net: sum(rows, x => x.S.net) };
  const cards = [['fin_emps', fmtNum(rows.length), ''], ['fin_total_salaries', money(tot.salary) + ' ' + c, ''], ['fin_penalties', money(tot.pen) + ' ' + c, tot.pen ? 'bad' : ''],
    ['fin_absent', money(tot.ab) + ' ' + c, ''], ['fin_late', money(tot.la) + ' ' + c, ''], ['fin_leave', money(tot.lv) + ' ' + c, ''], ['fin_adv', money(tot.adv) + ' ' + c, ''], ['fin_adv_out', money(tot.left) + ' ' + c, ''],
    ['fin_transport', money(tot.tr) + ' ' + c, ''], ['fin_ot', money(tot.ot) + ' ' + c, tot.ot ? 'ok' : ''], ['fin_net', money(tot.net) + ' ' + c, 'ok']];
  $('#cards').innerHTML = cards.map(([k, v, cl]) => `<div class="stat ${cl}"><span>${esc(t(k))}</span><b>${esc(v)}</b></div>`).join('');
  $('#periodTxt').textContent = V.periodText(rows[0] ? rows[0].S.range : PR.periodRange(month, data.payroll.cycleStartDay));

  const groups = {};
  rows.forEach(x => { const k = x.u.department || t('fin_no_dept'); (groups[k] = groups[k] || []).push(x); });
  $('#deptHead').innerHTML = th(['col_dept', 'col_emps', 'col_salary', 'col_ded_amt', 'col_net']).replace('col_emps', 'col_emps');
  $('#deptBody').innerHTML = Object.keys(groups).sort().map(k => { const g = groups[k]; return `<tr><td class="nm">${esc(k)}</td><td class="num">${g.length}</td><td class="num">${money(sum(g, x => x.S.salary))}</td><td class="num">${money(sum(g, x => x.S.deductAmount))}</td><td class="num">${money(sum(g, x => x.S.net))}</td></tr>`; }).join('') || `<tr><td colspan="5"><div class="empty">${esc(t('fin_none'))}</div></td></tr>`;

  $('#topHead').innerHTML = th(['col_name', 'col_dept', 'col_ded_amt']);
  const top = rows.filter(x => x.S.deductAmount > 0).sort((a, b) => b.S.deductAmount - a.S.deductAmount).slice(0, 10);
  $('#topBody').innerHTML = top.map(x => `<tr><td class="nm">${esc(nm(x.u))}</td><td>${esc(x.u.department || '-')}</td><td class="num">${money(x.S.deductAmount)}</td></tr>`).join('') || `<tr><td colspan="3"><div class="empty">${esc(t('fin_none'))}</div></td></tr>`;

  $('#advHead').innerHTML = th(['col_name', 'col_adv', 'col_adv_left']);
  const adv = rows.filter(x => x.S.advanceLeft > 0 || x.S.advanceDed > 0);
  $('#advBody').innerHTML = adv.map(x => `<tr><td class="nm">${esc(nm(x.u))}</td><td class="num">${money(x.S.advanceDed)}</td><td class="num">${money(x.S.advanceLeft)}</td></tr>`).join('') || `<tr><td colspan="3"><div class="empty">${esc(t('fin_none'))}</div></td></tr>`;

  $('#otHead').innerHTML = th(['col_name', 'col_ot_min', 'col_ot_amt']);
  const ot = rows.filter(x => x.S.overtimeMin > 0).sort((a, b) => b.S.overtimeMin - a.S.overtimeMin);
  $('#otBody').innerHTML = ot.map(x => `<tr><td class="nm">${esc(nm(x.u))}</td><td class="num">${fmtNum(x.S.overtimeMin)}</td><td class="num">${money(x.S.overtimeAmount)}</td></tr>`).join('') || `<tr><td colspan="3"><div class="empty">${esc(t('fin_none'))}</div></td></tr>`;

  $('#allHead').innerHTML = th(['col_code', 'col_name', 'col_dept', 'col_salary', 'col_ded_amt', 'col_adv', 'col_transport', 'col_ot_amt', 'col_net']);
  $('#allBody').innerHTML = rows.map((x, i) => `<tr style="--i:${Math.min(i, 14)}"><td class="num">${esc(x.u.id)}</td><td class="nm">${esc(nm(x.u))}</td><td>${esc(x.u.department || '-')}</td><td class="num">${money(x.S.salary)}</td><td class="num">${money(x.S.deductAmount)}</td><td class="num">${money(x.S.advanceDed)}</td><td class="num">${money(x.S.transport)}</td><td class="num">${money(x.S.overtimeEff)}</td><td class="num"><b>${money(x.S.net)}</b></td></tr>`).join('') || `<tr><td colspan="9"><div class="empty">${esc(t('fin_none'))}</div></td></tr>`;
  if (isHR) $('#finExport').innerHTML = icon('download', 18) + esc(t('btn_export_fin'));
}

async function load() {
  try {
    if (!meta) { meta = await call('financeData', { metaOnly: true }); month = meta.currentPeriod; $('#month').max = meta.currentPeriod; }
    $('#month').value = month;
    const R = PR.periodRange(month, meta.payroll.cycleStartDay);
    data = await call('financeData', { from: R.from, to: R.to });
    const ds = Array.from(new Set(data.users.map(u => u.department).filter(Boolean))).sort(), cur = $('#dept').value;
    $('#dept').innerHTML = `<option value="">${esc(t('flt_all_depts'))}</option>` + ds.map(d => `<option value="${esc(d)}"${d === cur ? ' selected' : ''}>${esc(d)}</option>`).join('');
    if (!$('#otInc').dataset.init) { $('#otInc').checked = (data.payroll.overtime || {}).includeInPayroll !== false; $('#otOff').checked = !!(data.payroll.overtime || {}).offsetLate; $('#otInc').dataset.init = '1'; }
    compute(); render();
  } catch (e) { toast(errMsg(e), 'err'); }
}

function exportSummary() {
  if (typeof XLSX === 'undefined') { toast(t('err_NETWORK'), 'err'); return; }
  const c = t('cur'), wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: A.State.lang === 'ar' }] };
  const tot = k => sum(rows, x => x.S[k]);
  const add = (name, aoa, widths) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = widths.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); };
  add(t('fin_total_salaries').slice(0, 20), [[t('col_period'), `${month} (${rows[0] ? rows[0].S.range.from + ' - ' + rows[0].S.range.to : ''})`], [t('fin_emps'), rows.length], [t('fin_total_salaries'), tot('salary')], [t('fin_absent'), tot('absentAmount')], [t('fin_late'), tot('lateEff')], [t('fin_leave'), tot('leaveAmount')],
    [t('fin_penalties'), tot('deductAmount')], [t('fin_adv'), tot('advanceDed')], [t('fin_adv_out'), tot('advanceLeft')], [t('fin_transport'), tot('transport')], [t('fin_ot'), tot('overtimeEff')], [t('fin_net'), tot('net')]], [34, 22]);
  const groups = {}; rows.forEach(x => { const k = x.u.department || t('fin_no_dept'); (groups[k] = groups[k] || []).push(x); });
  add(t('fin_by_dept'), [[t('col_dept'), t('col_emps'), t('col_salary'), t('col_ded_amt'), t('col_net')], ...Object.keys(groups).sort().map(k => [k, groups[k].length, sum(groups[k], x => x.S.salary), sum(groups[k], x => x.S.deductAmount), sum(groups[k], x => x.S.net)])], [22, 12, 14, 14, 14]);
  add(t('fin_all'), [[t('col_code'), t('col_name'), t('col_dept'), t('col_salary'), t('col_absent_amt'), t('col_late_amt'), t('col_leave_amt'), t('col_ded_amt'), t('col_adv'), t('col_adv_left'), t('col_transport'), t('col_ot_amt'), t('col_net')],
    ...rows.map(x => [x.u.id, nm(x.u), x.u.department, x.S.salary, x.S.absentAmount, x.S.lateEff, x.S.leaveAmount, x.S.deductAmount, x.S.advanceDed, x.S.advanceLeft, x.S.transport, x.S.overtimeEff, x.S.net])], [10, 24, 16, 12, 12, 12, 12, 12, 12, 12, 12, 12, 14]);
  XLSX.writeFile(wb, `JMG-Finance-${month}.xlsx`);
  toast(t('export_done'));
}

A.boot({
  page: 'finance',
  roles: ['Employee', 'Manager', 'HR'],
  onReady(u) {
    isHR = u.role === 'HR';
    if (!isHR && !u.canFinance) { location.replace('./'); return; }
    $('#roNote').hidden = isHR;
    if (isHR) {                                                       // the Excel library is loaded for HR only
      const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; document.head.appendChild(sc);
      $('#finExport').hidden = false; $('#finExport').addEventListener('click', exportSummary);
    }
    $('#month').addEventListener('change', e => { if (e.target.value) { month = e.target.value; load(); } });
    ['#dept', '#otInc', '#otOff'].forEach(id => $(id).addEventListener('change', () => { compute(); render(); }));
    A.onLang(() => { if (data) { render(); } });
    A.watch(load);
    load();
  }
});
})();
