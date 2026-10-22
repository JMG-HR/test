/* JMG HR Portal — attendance.js */
(function () {
'use strict';
const A = App, PR = window.Payroll;
const { $, $$, esc, t, call, icon, toast, errMsg, setBusy, fmtNum } = A;

let meta = null;                       // { users, shifts, payroll, titles }
let sel = null;                        // selected employee
let month = A.monthKey();
let view = null;                       // last computed month for the selected employee
const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const opt = (v, l, s) => `<option value="${esc(v)}"${s ? ' selected' : ''}>${esc(l)}</option>`;
const money = n => Number(n).toLocaleString(A.locale(), { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const today = () => A.isoDate(new Date());
const shiftFor = u => meta.shifts.find(s => s.id === u.shiftId) || meta.shifts[0] || null;
const normQ = s => PR.norm(s).toLowerCase();

function punchMap(rows, code) {
  const m = {};
  rows.filter(r => r.code.toLowerCase() === code.toLowerCase()).forEach(r => { m[r.date] = r.times ? r.times.split(',') : []; });
  return m;
}
const reqsOf = (all, id) => all.filter(r => r.userId.toLowerCase() === id.toLowerCase());

/* ---------- search ---------- */
let suggIdx = -1, suggUsers = [];
function showSugg() {
  const q = normQ($('#q').value), box = $('#sugg');
  suggUsers = (meta ? meta.users : []).filter(u => !q || normQ(u.name).indexOf(q) > -1 || normQ(u.id).indexOf(q) > -1 || normQ(u.jobTitle || '').indexOf(q) > -1).slice(0, 8);
  suggIdx = suggUsers.length ? 0 : -1;
  box.innerHTML = suggUsers.length
    ? suggUsers.map((u, i) => `<div class="sugg-item${i === 0 ? ' on' : ''}" role="option" data-i="${i}"><span>${esc(u.name)}<small> ${esc(u.jobTitle || '')}</small></span><small>${esc(u.id)}${u.department ? ' - ' + esc(u.department) : ''}</small></div>`).join('')
    : `<div class="sugg-none">${esc(t('att_none'))}</div>`;
  box.hidden = false; $('#q').setAttribute('aria-expanded', 'true');
}
function hideSugg() { $('#sugg').hidden = true; $('#q').setAttribute('aria-expanded', 'false'); }
function pick(u) { sel = u; $('#q').value = `${u.name} (${u.id})`; hideSugg(); loadEmployee(); }
function initSearch() {
  const q = $('#q');
  q.addEventListener('input', showSugg);
  q.addEventListener('focus', showSugg);
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!suggUsers.length) return;
      suggIdx = (suggIdx + (e.key === 'ArrowDown' ? 1 : -1) + suggUsers.length) % suggUsers.length;
      $$('.sugg-item').forEach((el, i) => el.classList.toggle('on', i === suggIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const exact = meta && meta.users.find(u => normQ(u.id) === normQ(q.value));
      const u = exact || suggUsers[suggIdx]; if (u) pick(u);
    } else if (e.key === 'Escape') hideSugg();
  });
  $('#sugg').addEventListener('mousedown', e => { const it = e.target.closest('.sugg-item'); if (it) { e.preventDefault(); pick(suggUsers[+it.dataset.i]); } });
  document.addEventListener('click', e => { if (!e.target.closest('.sugg')) hideSugg(); });
  const mi = $('#month'); mi.value = month; mi.max = A.monthKey();
  mi.addEventListener('change', () => { if (mi.value) { month = mi.value; loadEmployee(); } });
}

/* ---------- selected employee ---------- */
async function loadEmployee() {
  if (!sel || !meta) return;
  const R = PR.monthRange(month);
  $('#pick').hidden = true; $('#empView').hidden = false;
  $('#dayBody').innerHTML = `<tr><td colspan="9"><div class="sk" style="height:44px"></div></td></tr>`;
  let d;
  try { d = await call('hrAttendanceData', { from: R.from, to: R.to, codes: [sel.id] }); } catch (e) { toast(errMsg(e), 'err'); return; }
  view = PR.computeMonth({ user: sel, month, punches: punchMap(d.punches, sel.id), requests: reqsOf(d.requests, sel.id), shift: shiftFor(sel), payroll: meta.payroll, weekend: A.CFG.WEEKEND, today: today() });
  renderEmployee();
}
function renderEmployee() {
  if (!view || !sel) return;
  const S = view.summary, sh = shiftFor(sel), cur = t('cur');
  $('#empName').textContent = `${sel.name} (${sel.id})`;
  $('#empMeta').textContent = [sel.jobTitle, sel.department, sh ? `${sh.name} ${sh.start} - ${sh.end}` : ''].filter(Boolean).join(' - ');
  const cards = [
    ['sum_salary', `${money(S.salary)} ${cur}`, ''], ['sum_rate', `${money(S.rate)} ${cur}`, ''], ['sum_present', fmtNum(S.present), 'ok'], ['sum_absent', fmtNum(S.absent), S.absent ? 'bad' : ''],
    ['sum_leave', fmtNum(S.leaveDays), ''], ['sum_late', `${fmtNum(S.late)} (${fmtNum(S.lateDays)} ${t('u_days')})`, S.late ? 'bad' : ''], ['sum_ded', `${money(S.deductAmount)} ${cur}`, S.deductAmount ? 'bad' : ''], ['sum_net', `${money(S.net)} ${cur}`, 'ok']
  ];
  $('#sum').innerHTML = cards.map(([k, v, c]) => `<div class="stat ${c}"><span>${esc(t(k))}</span><b>${esc(v)}</b></div>`).join('');
  $('#noData').hidden = S.hasData;
  $('#dayBody').innerHTML = view.rows.map((r, i) => {
    const day = new Date(r.date + 'T12:00:00').toLocaleDateString(A.locale(), { weekday: 'long' });
    return `<tr style="--i:${Math.min(i, 14)}"><td class="num">${esc(r.date)}</td><td>${esc(day)}</td><td class="num">${esc(r.first || '-')}</td><td class="num">${esc(r.last || '-')}</td>
      <td class="times">${esc(r.times.join('  '))}</td><td class="num">${r.late ? fmtNum(r.late) : '-'}</td><td><span class="badge d-${esc(r.status)}">${esc(t('d_' + r.status))}</span></td>
      <td class="num">${r.ded ? fmtNum(r.ded) : '-'}</td><td class="num">${r.amount ? money(r.amount) : '-'}</td></tr>`;
  }).join('');
}

/* ---------- lateness rules ---------- */
const DED = [[0.25, 'ded_025'], [0.5, 'ded_05'], [0.75, 'ded_075'], [1, 'ded_1'], [1.5, 'ded_15'], [2, 'ded_2']];
function tierRow(tr) {
  const sel2 = DED.some(d => d[0] === tr.days) ? DED : DED.concat([[tr.days, 'ded_1']]);
  return `<div class="tier-row"><span>${esc(t('tier_after'))}</span><input class="input" type="number" min="1" max="1440" value="${esc(tr.after)}" data-after aria-label="${esc(t('tier_min'))}"><span>${esc(t('tier_min'))}</span><span>${esc(t('tier_deduct'))}</span>
    <select class="input" data-days>${sel2.map(d => opt(d[0], DED.some(x => x[0] === d[0]) ? t(d[1]) : `${d[0]} ${t('u_days')}`, d[0] === tr.days)).join('')}</select>
    <button class="btn btn-bad btn-xs" type="button" data-rm aria-label="${esc(t('btn_delete'))}">${icon('trash', 14)}</button></div>`;
}
function renderRules() {
  const P = meta.payroll;
  $('#tiers').innerHTML = P.lateTiers.map(tierRow).join('');
  $('#basis').value = P.dayBasis; $('#dedLeave').checked = P.deductApprovedLeave;
  $('#addTier').innerHTML = icon('plus', 14) + esc(t('btn_add_tier'));
}
function collectTiers() {
  return $$('#tiers .tier-row').map(r => ({ after: Math.round(Number($('[data-after]', r).value) || 0), days: Number($('[data-days]', r).value) }));
}
function initRules() {
  $('#addTier').addEventListener('click', () => {
    const cur = collectTiers(), last = cur[cur.length - 1];
    meta.payroll.lateTiers = cur.concat([{ after: last ? last.after + 30 : 15, days: 0.25 }]); renderRules();
  });
  $('#tiers').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    const rows = $$('#tiers .tier-row'), i = rows.indexOf(b.closest('.tier-row'));
    const cur = collectTiers(); cur.splice(i, 1); meta.payroll.lateTiers = cur; renderRules();
  });
  $('#saveRules').addEventListener('click', async e => {
    const btn = e.currentTarget; setBusy(btn, true);
    try {
      const d = await call('hrSaveSettings', { payroll: { lateTiers: collectTiers(), dayBasis: $('#basis').value, deductApprovedLeave: $('#dedLeave').checked } });
      meta.payroll = d.payroll; renderRules(); toast(t('toast_rules'));
      if (sel) loadEmployee();
    } catch (ex) { toast(errMsg(ex), 'err'); }
    setBusy(btn, false);
  });
}

/* ---------- shifts ---------- */
function renderShifts() {
  $('#shifts').innerHTML = meta.shifts.map((s, i) => `<div class="shift-row"><div><b>${esc(s.name)}</b>${i === 0 ? ` <span class="hint">(${esc(t('no_shift'))})</span>` : ''}<div class="tm">${esc(s.start)} - ${esc(s.end)}</div></div>
    <div class="acts"><button class="btn btn-soft btn-xs" type="button" data-sedit="${esc(s.id)}" aria-label="${esc(t('edit_shift_title'))}">${icon('edit', 14)}${esc(t('edit_shift_title'))}</button><button class="btn btn-bad btn-xs" type="button" data-sdel="${esc(s.id)}" aria-label="${esc(t('btn_delete'))}">${icon('trash', 14)}</button></div></div>`).join('');
  $('#addShift').innerHTML = icon('plus', 14) + esc(t('btn_add_shift'));
}
function shiftModal(s) {
  A.modal({
    title: t('edit_shift_title'),
    body: `<div class="form"><div class="field"><label for="shName">${esc(t('f_shift_name'))}</label><input class="input" id="shName" maxlength="40" value="${esc(s ? s.name : '')}"></div>
      <div class="row2"><div class="field"><label for="shStart">${esc(t('f_shift_start'))}</label><input class="input" id="shStart" type="time" value="${esc(s ? s.start : '09:00')}"></div>
      <div class="field"><label for="shEnd">${esc(t('f_shift_end'))}</label><input class="input" id="shEnd" type="time" value="${esc(s ? s.end : '17:00')}"></div></div></div>`,
    actions: [
      { label: t('btn_no'), cls: 'btn-soft' },
      { label: t('btn_save'), cls: 'btn-gold', onClick: async ov => {
        const p = { id: s ? s.id : '', name: $('#shName', ov).value.trim(), start: $('#shStart', ov).value, end: $('#shEnd', ov).value };
        if (!p.name || !p.start || !p.end) { toast(t('err_MISSING'), 'err'); return false; }
        try { const d = await call('hrSaveShift', p); meta.shifts = d.overview.shifts; renderShifts(); toast(t('toast_shift_saved')); if (sel) loadEmployee(); } catch (ex) { toast(errMsg(ex), 'err'); return false; }
      } }
    ]
  });
}
function initShifts() {
  $('#addShift').addEventListener('click', () => shiftModal(null));
  $('#shifts').addEventListener('click', async e => {
    const ed = e.target.closest('[data-sedit]'), del = e.target.closest('[data-sdel]');
    if (ed) shiftModal(meta.shifts.find(s => s.id === ed.dataset.sedit));
    else if (del) {
      const s = meta.shifts.find(x => x.id === del.dataset.sdel);
      if (!(await A.confirmDialog(t('confirm_del_shift', { name: s.name }), { danger: true }))) return;
      try { const d = await call('hrDeleteShift', { id: s.id }); meta.shifts = d.overview.shifts; renderShifts(); toast(t('toast_shift_deleted')); if (sel) loadEmployee(); } catch (ex) { toast(errMsg(ex), 'err'); }
    }
  });
}

/* ---------- fingerprint file upload ---------- */
function openUpload() {
  if (typeof XLSX === 'undefined') { toast(t('err_NETWORK'), 'err'); return; }
  let sheets = null, aoa = null, hdrRow = 0, parsed = null;
  const m = A.modal({
    title: t('up_title'),
    body: `<p>${esc(t('up_hint'))}</p>
      <div class="field"><label for="upFile">${esc(t('f_file'))}</label><input class="input" id="upFile" type="file" accept=".xlsx,.xls,.csv" style="height:auto;padding:10px"></div>
      <div id="upSheetWrap" class="field" hidden><label for="upSheet">${esc(t('up_sheet'))}</label><select class="input" id="upSheet"></select></div>
      <div id="upMap" hidden></div><div id="upInfo" class="note"></div><div class="pre" id="upPre" hidden></div>
      <div class="progress" id="upProg" hidden><i></i></div>`,
    actions: [
      { label: t('btn_no'), cls: 'btn-soft' },
      { label: t('btn_upload'), cls: 'btn-gold', onClick: ov => doUpload(ov) }
    ]
  });
  m.el.querySelector('.modal').classList.add('wide');
  const ov = m.el;

  function colSelect(id, label, headers, val, optional) {
    return `<div class="field"><label for="${id}">${esc(label)}</label><select class="input" id="${id}">${optional ? opt(-1, t('up_none'), val < 0) : ''}${headers.map((h, i) => opt(i, String(h || `#${i + 1}`), i === val)).join('')}</select></div>`;
  }
  function readSheet(name) {
    const ws = sheets.Sheets[name];
    aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    hdrRow = PR.findHeaderRow(aoa);
    const headers = (aoa[hdrRow] || []).map(String), map = PR.detectColumns(headers);
    $('#upMap', ov).innerHTML = `<div class="map-grid">
      ${colSelect('mCode', t('f_col_code'), headers, map.code, false)}${colSelect('mName', t('f_col_name'), headers, map.name, true)}
      ${colSelect('mDept', t('f_col_dept'), headers, map.dept, true)}${colSelect('mDate', t('f_col_date'), headers, map.combined ? map.datetime : map.date, false)}
      ${colSelect('mTime', t('f_col_time'), headers, map.time, true)}${colSelect('mTime2', t('f_col_time2'), headers, -1, true)}</div>
      <label class="check" style="margin-top:12px"><input type="checkbox" id="mComb"${map.combined ? ' checked' : ''}><span class="box">${CHECK}</span><span>${esc(t('f_combined'))}</span></label>`;
    $('#upMap', ov).hidden = false;
    $$('#upMap select, #upMap input', ov).forEach(el => el.addEventListener('change', recalc));
    recalc();
  }
  function currentMap() {
    const g = id => Number($('#' + id, ov).value), comb = $('#mComb', ov).checked;
    return { code: g('mCode'), name: g('mName'), dept: g('mDept'), date: comb ? -1 : g('mDate'), datetime: comb ? g('mDate') : -1, combined: comb, time: comb ? -1 : g('mTime'), time2: comb ? -1 : g('mTime2') };
  }
  function recalc() {
    const map = currentMap(), pre = $('#upPre', ov);
    $('#mTime', ov).disabled = $('#mTime2', ov).disabled = map.combined;
    if (map.code < 0 || (!map.combined && (map.date < 0 || map.time < 0))) { parsed = null; $('#upInfo', ov).textContent = t('err_up_cols'); pre.hidden = true; return; }
    parsed = PR.groupPunches(aoa, hdrRow, map);
    $('#upInfo', ov).textContent = t('up_rows_found', { n: parsed.ok, d: parsed.rows.length, b: parsed.bad });
    pre.hidden = !parsed.rows.length;
    pre.innerHTML = `<table><thead><tr><th>${esc(t('col_code'))}</th><th>${esc(t('th_date'))}</th><th>${esc(t('th_punches'))}</th><th>${esc(t('col_name'))}</th></tr></thead><tbody>${parsed.rows.slice(0, 6).map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('')}</tbody></table>`;
  }
  $('#upFile', ov).addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      sheets = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const names = sheets.SheetNames;
      $('#upSheet', ov).innerHTML = names.map((n, i) => opt(n, n, i === 0)).join('');
      $('#upSheetWrap', ov).hidden = names.length < 2;
      $('#upSheet', ov).onchange = ev => readSheet(ev.target.value);
      readSheet(names[0]);
    } catch (ex) { $('#upInfo', ov).textContent = t('err_up_file'); }
  });

  async function doUpload(box) {
    if (!parsed || !parsed.rows.length) { toast(t('err_up_cols'), 'err'); return false; }
    const rows = parsed.rows, prog = $('#upProg', box), bar = $('i', prog); prog.hidden = false;
    const tot = { added: 0, updated: 0, skipped: 0, unknown: {} };
    try {
      for (let i = 0; i < rows.length; i += 300) {
        const d = await call('hrUploadPunches', { rows: rows.slice(i, i + 300) });
        tot.added += d.added; tot.updated += d.updated; tot.skipped += d.skipped; d.unknown.forEach(c => { tot.unknown[c] = 1; });
        bar.style.width = Math.min(100, Math.round((i + 300) / rows.length * 100)) + '%';
      }
    } catch (ex) { toast(errMsg(ex), 'err'); prog.hidden = true; return false; }
    const unk = Object.keys(tot.unknown);
    A.modal({
      title: t('up_title'),
      body: `<p>${esc(t('up_done', { added: tot.added, updated: tot.updated }))}</p>${unk.length ? `<p>${esc(t('up_unknown', { n: unk.length, list: unk.slice(0, 40).join(', ') }))}</p>` : ''}`,
      actions: [{ label: t('btn_close'), cls: 'btn-gold' }]
    });
    if (sel) loadEmployee();
  }
}

/* ---------- payroll export ---------- */
function openPayroll() {
  if (typeof XLSX === 'undefined') { toast(t('err_NETWORK'), 'err'); return; }
  const users = meta.users.slice().sort((a, b) => a.name.localeCompare(b.name));
  const depts = Array.from(new Set(users.map(u => u.department).filter(Boolean))).sort();
  const m = A.modal({
    title: t('pay_title'),
    body: `<div class="form">
      <div class="field"><label for="pEmp">${esc(t('f_ex_emp'))}</label><select class="input" id="pEmp">${opt('', t('flt_all_emps'), true)}${users.map(u => opt(u.id, `${u.name} (${u.id})`)).join('')}</select></div>
      <div class="field"><label for="pDept">${esc(t('f_ex_dept'))}</label><select class="input" id="pDept">${opt('', t('flt_all_depts'), true)}${depts.map(d => opt(d, d)).join('')}</select></div>
      <div class="field"><label>${esc(t('f_ex_period'))}</label><div class="tabs" id="pMode"><button type="button" class="on" data-m="range">${esc(t('ex_range'))}</button><button type="button" data-m="all">${esc(t('ex_all'))}</button></div></div>
      <div class="row2" id="pRange"><div class="field"><label for="pFrom">${esc(t('pay_from'))}</label><input class="input" type="month" id="pFrom" value="${month}"></div>
      <div class="field"><label for="pTo">${esc(t('pay_to'))}</label><input class="input" type="month" id="pTo" value="${month}"></div></div></div>`,
    actions: [{ label: t('btn_no'), cls: 'btn-soft' }, { label: t('btn_download'), cls: 'btn-gold', onClick: ov => exportPayroll(ov) }]
  });
  $$('#pMode button', m.el).forEach(b => b.addEventListener('click', () => {
    $$('#pMode button', m.el).forEach(x => x.classList.toggle('on', x === b));
    $('#pRange', m.el).hidden = b.dataset.m === 'all';
  }));
}
function monthsBetween(a, b) {
  const out = []; let [y, m] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number);
  while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
async function exportPayroll(ov) {
  const emp = $('#pEmp', ov).value, dept = $('#pDept', ov).value, all = $('#pMode .on', ov).dataset.m === 'all';
  let from = $('#pFrom', ov).value, to = $('#pTo', ov).value;
  if (!all && (!from || !to || from > to)) { toast(t('err_BAD_RANGE'), 'err'); return false; }
  const cur = A.monthKey();
  const R1 = all ? '2000-01-01' : from + '-01', R2 = all ? today() : PR.monthRange(to).to;
  let d;
  try { d = await call('hrAttendanceData', { from: R1, to: R2 }); } catch (e) { toast(errMsg(e), 'err'); return false; }
  const users = d.users.filter(u => (!emp || u.id === emp) && (!dept || u.department === dept));
  if (!users.length) { toast(t('pay_empty'), 'err'); return false; }
  let months;
  if (all) {
    const seen = d.punches.map(p => p.date.slice(0, 7)).concat(d.requests.map(r => r.startDate.slice(0, 7))).sort();
    months = seen.length ? monthsBetween(seen[0], cur) : [cur];
  } else months = monthsBetween(from, to);
  const shiftOf = u => d.shifts.find(s => s.id === u.shiftId) || d.shifts[0] || null;
  const pm = {}; users.forEach(u => { pm[u.id] = punchMap(d.punches, u.id); });
  const H = {
    sum: [t('col_code'), t('col_name'), t('col_dept'), t('col_title'), t('col_salary'), t('col_rate'), t('col_present'), t('col_absent'), t('col_leave'), t('col_late_n'), t('col_late_days'), t('col_ded_days'), t('col_ded_amt'), t('col_net')],
    det: [t('th_date'), t('th_day'), t('col_code'), t('col_name'), t('col_status'), t('col_first'), t('col_last'), t('col_punches'), t('col_late_min'), t('th_ded_days'), t('th_ded_amt')]
  };
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: A.State.lang === 'ar' }] };
  let any = false;
  months.forEach(mo => {
    const sumRows = [], detRows = [], tot = { salary: 0, days: 0, amt: 0, net: 0 };
    users.forEach(u => {
      const r = PR.computeMonth({ user: u, month: mo, punches: pm[u.id], requests: reqsOf(d.requests, u.id), shift: shiftOf(u), payroll: d.payroll, weekend: A.CFG.WEEKEND, today: today() });
      const S = r.summary;
      if (!S.hasData && !S.leaveDays && !S.salary) return;
      any = true;
      sumRows.push([u.id, u.name, u.department, u.jobTitle, S.salary, S.rate, S.present, S.absent, S.leaveDays, S.late, S.lateDays, S.deductDays, S.deductAmount, S.net]);
      tot.salary += S.salary; tot.days += S.deductDays; tot.amt += S.deductAmount; tot.net += S.net;
      r.rows.filter(x => x.status !== 'off' && x.status !== 'pending').forEach(x => {
        detRows.push([x.date, new Date(x.date + 'T12:00:00').toLocaleDateString(A.locale(), { weekday: 'long' }), u.id, u.name, t('d_' + x.status), x.first, x.last, x.times.join(' '), x.late || '', x.ded || '', x.amount || '']);
      });
    });
    if (!sumRows.length) return;
    sumRows.push([t('totals'), '', '', '', A.r2(tot.salary), '', '', '', '', '', '', A.r2(tot.days), A.r2(tot.amt), A.r2(tot.net)]);
    const ws1 = XLSX.utils.aoa_to_sheet([H.sum, ...sumRows]); ws1['!cols'] = [10, 24, 16, 18, 12, 10, 10, 10, 12, 10, 14, 14, 14, 14].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws1, `${t('pay_sheet')} ${mo}`);
    const ws2 = XLSX.utils.aoa_to_sheet([H.det, ...detRows]); ws2['!cols'] = [12, 12, 10, 24, 14, 10, 10, 26, 12, 12, 12].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws2, `${t('pay_details')} ${mo}`);
  });
  if (!any) { toast(t('pay_empty'), 'err'); return false; }
  const who = emp || (dept ? dept.replace(/[^\w]+/g, '_') : 'All');
  XLSX.writeFile(wb, `JMG-Payroll-${who}-${all ? 'AllData' : from + '_' + to}.xlsx`);
  toast(t('export_done'));
}

/* ---------- boot ---------- */
async function loadMeta() {
  try { meta = await call('hrAttendanceData', { metaOnly: true }); renderRules(); renderShifts(); if (document.activeElement === $('#q')) showSugg(); } catch (e) { toast(errMsg(e), 'err'); }
}
function renderStatic() {
  $('#uploadBtn').innerHTML = icon('download', 18) + esc(t('btn_upload_punch'));
  $('#payBtn').innerHTML = icon('wallet', 18) + esc(t('btn_export_payroll'));
  if (meta) { renderRules(); renderShifts(); }
  if (view) renderEmployee();
}
A.boot({
  page: 'attendance',
  roles: ['HR'],
  onReady() {
    initSearch(); initRules(); initShifts();
    $('#uploadBtn').addEventListener('click', openUpload);
    $('#payBtn').addEventListener('click', () => { if (meta) openPayroll(); });
    renderStatic();
    A.onLang(renderStatic);
    loadMeta();
  }
});
})();
