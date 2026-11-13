/* JMG HR Portal — mypay.js : the employee's own attendance, deductions and pay (read-only) */
(function () {
'use strict';
const A = window.App, V = window.AttView;
const { $, esc, t, call, toast, errMsg } = A;
let month = null, data = null;   // null = the current payroll month

function render() {
  if (!data) return;
  const view = V.compute(data, { showOvertime: false }), sh = V.shiftOf(data);       // overtime is never shown to the employee
  $('#empName').textContent = A.nm(data.user) + ' (' + data.user.id + ')';
  $('#empMeta').textContent = [data.user.jobTitle, data.user.department, sh ? `${sh.name} ${sh.start} - ${sh.end}` : '', V.periodText(data.range)].filter(Boolean).join(' - ');
  $('#sum').innerHTML = V.summaryHTML(view.summary);
  $('#noData').hidden = view.summary.hasData;
  $('#dayHead').innerHTML = V.dayHeader(false);
  $('#dayBody').innerHTML = V.rowsHTML(view.rows, false);
  $('#msnBody').innerHTML = V.missionsHTML(data.requests);
}
async function load() {
  try {
    data = await call('myAttendance', { month: month || 'current' }); month = data.month;
    const mi = $('#month'); mi.value = month; mi.max = data.currentPeriod; render();
  } catch (e) { toast(errMsg(e), 'err'); }
}
A.boot({
  page: 'mypay',
  roles: ['Employee', 'Manager', 'HR'],
  onReady() {
    const mi = $('#month');
    mi.addEventListener('change', () => { if (mi.value) { month = mi.value; load(); } });
    A.onLang(render);
    A.watch(load);
    load();
  }
});
})();
