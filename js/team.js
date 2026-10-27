/* JMG HR Portal — team.js : a manager's view of his own team (search, attendance, deductions) */
(function () {
'use strict';
const A = window.App, V = window.AttView, PR = window.Payroll;
const { $, $$, esc, t, call, toast, errMsg } = A;
const nm = A.nm, normQ = s => PR.norm(s).toLowerCase();
let team = [], sel = null, month = A.monthKey(), data = null, idx = -1, list = [];

function showSugg() {
  const q = normQ($('#q').value), box = $('#sugg');
  list = team.filter(u => !q || [u.name, u.nameAr, u.nameEn, u.jobTitle].some(n => normQ(n || '').indexOf(q) > -1) || normQ(u.id).indexOf(q) > -1).slice(0, 8);
  idx = list.length ? 0 : -1;
  box.innerHTML = list.length
    ? list.map((u, i) => `<div class="sugg-item${i === 0 ? ' on' : ''}" role="option" data-i="${i}"><span>${esc(nm(u))}<small> ${esc(u.jobTitle || '')}</small></span><small>${esc(u.id)}${u.department ? ' - ' + esc(u.department) : ''}</small></div>`).join('')
    : `<div class="sugg-none">${esc(team.length ? t('att_none') : t('team_empty'))}</div>`;
  box.hidden = false; $('#q').setAttribute('aria-expanded', 'true');
}
function hideSugg() { $('#sugg').hidden = true; $('#q').setAttribute('aria-expanded', 'false'); }
function pick(u) { sel = u; $('#q').value = `${nm(u)} (${u.id})`; hideSugg(); load(); }

function render() {
  if (!data) return;
  const view = V.compute(data), sh = V.shiftOf(data);
  $('#pick').hidden = true; $('#empView').hidden = false;
  $('#empName').textContent = A.nm(data.user) + ' (' + data.user.id + ')';
  $('#empMeta').textContent = [data.user.jobTitle, data.user.department, sh ? `${sh.name} ${sh.start} - ${sh.end}` : ''].filter(Boolean).join(' - ');
  $('#sum').innerHTML = V.summaryHTML(view.summary);
  $('#noData').hidden = view.summary.hasData;
  $('#dayHead').innerHTML = V.dayHeader();
  $('#dayBody').innerHTML = V.rowsHTML(view.rows);
  $('#msnBody').innerHTML = V.missionsHTML(data.requests);
}
async function load() {
  if (!sel) return;
  try { data = await call('teamMember', { code: sel.id, month }); render(); } catch (e) { toast(errMsg(e), 'err'); }
}
A.boot({
  page: 'team',
  roles: ['Manager'],
  async onReady() {
    const q = $('#q');
    q.addEventListener('input', showSugg); q.addEventListener('focus', showSugg);
    q.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!list.length) return;
        idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        $$('.sugg-item').forEach((el, i) => el.classList.toggle('on', i === idx));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const exact = team.find(u => normQ(u.id) === normQ(q.value)); const u = exact || list[idx]; if (u) pick(u);
      } else if (e.key === 'Escape') hideSugg();
    });
    $('#sugg').addEventListener('mousedown', e => { const it = e.target.closest('.sugg-item'); if (it) { e.preventDefault(); pick(list[+it.dataset.i]); } });
    document.addEventListener('click', e => { if (!e.target.closest('.sugg')) hideSugg(); });
    const mi = $('#month'); mi.value = month; mi.max = A.monthKey();
    mi.addEventListener('change', () => { if (mi.value) { month = mi.value; load(); } });
    A.onLang(render);
    try { team = await call('teamList'); } catch (e) { toast(errMsg(e), 'err'); }
  }
});
})();
