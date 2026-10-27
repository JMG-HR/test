/* JMG HR Portal — mypay.js : the employee's own attendance, deductions and pay (read-only) */
(function () {
'use strict';
const A = window.App, V = window.AttView;
const { $, esc, t, call, toast, errMsg } = A;
let month = A.monthKey(), data = null;

function render() {
  if (!data) return;
  const view = V.compute(data), sh = V.shiftOf(data);
  $('#empName').textContent = A.nm(data.user) + ' (' + data.user.id + ')';
  $('#empMeta').textContent = [data.user.jobTitle, data.user.department, sh ? `${sh.name} ${sh.start} - ${sh.end}` : ''].filter(Boolean).join(' - ');
  $('#sum').innerHTML = V.summaryHTML(view.summary);
  $('#noData').hidden = view.summary.hasData;
  $('#dayHead').innerHTML = V.dayHeader();
  $('#dayBody').innerHTML = V.rowsHTML(view.rows);
  $('#msnBody').innerHTML = V.missionsHTML(data.requests);
}
async function load() {
  try { data = await call('myAttendance', { month }); render(); } catch (e) { toast(errMsg(e), 'err'); }
}
A.boot({
  page: 'mypay',
  roles: ['Employee', 'Manager', 'HR'],
  onReady() {
    const mi = $('#month'); mi.value = month; mi.max = A.monthKey();
    mi.addEventListener('change', () => { if (mi.value) { month = mi.value; load(); } });
    A.onLang(render);
    A.watch(load);
    load();
  }
});
})();
