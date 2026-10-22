/* JMG HR Portal — settings.js */
(function () {
'use strict';
const A = App;
const { $, t, call, icon, toast, errMsg, setBusy } = A;

A.boot({
  page: 'settings',
  roles: ['Employee', 'Manager', 'HR'],
  async onReady(user) {
    $('#icoPw').innerHTML = icon('lock', 22);
    $('#icoMail').innerHTML = icon('bell', 22);
    $('#mgrDesc').hidden = user.role !== 'Manager';

    /* ----- change password ----- */
    $('#pwForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#pErr'), btn = $('#pBtn'); err.textContent = '';
      const cur = $('#pCur').value, nw = $('#pNew').value, conf = $('#pConf').value;
      if (!cur || !nw || !conf) { err.textContent = t('err_MISSING'); return; }
      if (nw.length < 8) { err.textContent = t('err_WEAK_PASSWORD'); return; }
      if (nw !== conf) { err.textContent = t('pw_mismatch'); return; }
      setBusy(btn, true);
      try {
        await call('changePassword', { current: cur, next: nw });
        $('#pwForm').reset(); refreshDirty();
        toast(t('toast_pw'));
      } catch (ex) { err.textContent = errMsg(ex); }
      setBusy(btn, false);
    });

    /* ----- unsaved-changes reminder (email / alerts / password) ----- */
    const saved = { email: '', optIn: false };
    const isDirty = () => $('#mAddr').value.trim() !== saved.email || $('#mOn').checked !== saved.optIn || !!($('#pCur').value || $('#pNew').value || $('#pConf').value);
    const bar = $('#dirtyBar');
    const refreshDirty = () => { const d = isDirty(); bar.hidden = !d; if (d) bar.innerHTML = icon('bell', 18) + '<span>' + t('dirty_msg').replace(/</g, '&lt;') + '</span>'; };
    ['#mAddr', '#mOn', '#pCur', '#pNew', '#pConf'].forEach(sel => { $(sel).addEventListener('input', refreshDirty); $(sel).addEventListener('change', refreshDirty); });
    window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
    A.onLang(refreshDirty);

    /* ----- email opt-in ----- */
    try {
      const me = await call('me');
      $('#mAddr').value = me.email || ''; $('#mOn').checked = !!me.emailOptIn;
      saved.email = (me.email || '').trim(); saved.optIn = !!me.emailOptIn;
    } catch (ex) { toast(errMsg(ex), 'err'); }

    $('#testBtn').addEventListener('click', async e => {
      if (!saved.email) { toast(t('test_need_email'), 'err'); return; }
      const btn = e.currentTarget; setBusy(btn, true);
      try {
        const r = await call('sendTestMail');
        if (r.ok) toast(t('toast_test_ok', { email: r.email })); else toast(t('test_fail', { err: r.error }), 'err');
      } catch (ex) { toast(errMsg(ex), 'err'); }
      setBusy(btn, false);
    });

    $('#mailForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#mErr'), btn = $('#mBtn'); err.textContent = '';
      const email = $('#mAddr').value.trim(), optIn = $('#mOn').checked;
      if (optIn && !email) { err.textContent = t('err_BAD_EMAIL'); return; }
      setBusy(btn, true);
      try {
        const u = await call('saveEmail', { email, optIn });
        A.Session.patch({ email: u.email, emailOptIn: u.emailOptIn });
        $('#mOn').checked = !!u.emailOptIn; saved.email = (u.email || '').trim(); saved.optIn = !!u.emailOptIn; refreshDirty();
        toast(t('toast_mail'));
      } catch (ex) { err.textContent = errMsg(ex); }
      setBusy(btn, false);
    });
  }
});
})();
