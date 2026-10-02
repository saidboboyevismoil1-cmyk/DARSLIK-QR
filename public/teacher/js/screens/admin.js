import { $, $$, esc, icon, isoWeek } from '../util.js';
import { t } from '../i18n.js';
import { get, post, api, download } from '../api.js';
import { toast, toastErr, spinner, confirmBox } from '../ui.js';

export default async function admin({ view, setTop }) {
  setTop({ title: t('adm.title'), backTo: '/more' });
  view.innerHTML = spinner();
  let facs, users, sdata, tele, dels, weekly;
  const scopeSel = { v: 'global' };
  async function load() {
    try {
      [facs, users, tele, dels] = (await Promise.all([get('/admin/faculties'), get('/admin/users'), get('/admin/telemetry'), get('/admin/deletion-requests')])).map((x, i) => (i === 0 ? x.faculties : i === 1 ? x.users : i === 2 ? x : x.requests));
      sdata = await get('/admin/settings' + (scopeSel.v !== 'global' ? '?facultyId=' + encodeURIComponent(scopeSel.v) : ''));
      weekly = await get('/admin/reports/weekly');
    } catch (e) { toastErr(e); return; }
    const over = scopeSel.v === 'global' ? sdata.global : sdata.faculty;
    const keys = Object.keys(sdata.defaults).filter((k) => scopeSel.v === 'global' || !sdata.globalOnly.includes(k));
    view.innerHTML = `<div class="stack lg">
      <section class="card stack"><h2>${esc(t('adm.faculties'))}</h2>
        ${facs.map((f) => `<div class="row nowrap"><span class="grow">${esc(f.name)}</span><button class="btn sm danger-text" data-fd="${esc(f.id)}">${icon('trash')}</button></div>`).join('') || `<span class="muted">${esc(t('adm.none'))}</span>`}
        <div class="row nowrap"><input class="field" id="fn" placeholder="${esc(t('adm.facName'))}"><button class="btn pri" id="fa">${icon('plus')}</button></div></section>
      <section class="card stack"><h2>${esc(t('adm.users'))}</h2>
        ${users.map((u) => `<div class="stack" style="gap:6px;border-bottom:1px solid var(--line);padding-bottom:10px"><b>${esc(u.name)} ${esc(u.surname || '')} <span class="muted small">${esc(u.email)}</span></b>
          <div class="row nowrap"><select class="field" data-ur="${esc(u.id)}" aria-label="${esc(t('adm.role'))}"><option value="teacher" ${u.role === 'teacher' ? 'selected' : ''}>teacher</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select>
          <select class="field" data-uf="${esc(u.id)}" aria-label="${esc(t('adm.faculty'))}"><option value="">—</option>${facs.map((f) => `<option value="${esc(f.id)}" ${u.facultyId === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div></div>`).join('')}</section>
      <section class="card stack"><h2>${esc(t('adm.settings'))}</h2>
        <div><label class="lbl" for="sc">${esc(t('adm.scope'))}</label><select id="sc" class="field"><option value="global">${esc(t('adm.scopeAll'))}</option>${facs.map((f) => `<option value="${esc(f.id)}" ${scopeSel.v === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
        <p class="help">${esc(t('adm.setHelp'))}</p>
        ${keys.map((k) => `<div><label class="lbl" for="s_${esc(k)}">${esc(k)}${Object.prototype.hasOwnProperty.call(over, k) ? ' ●' : ''}</label><input class="field" id="s_${esc(k)}" data-k="${esc(k)}" value='${esc(JSON.stringify(sdata.effective[k]))}'></div>`).join('')}
        <div id="smsg"></div><button class="btn pri block" id="ssave">${esc(t('common.save'))}</button></section>
      <section class="card stack"><h2>${esc(t('adm.weekly'))}</h2><p class="muted small">${esc(weekly.weekFrom)} — ${esc(weekly.weekTo)} · ${esc(t('adm.lessons'))}: ${weekly.lessons}</p>
        <div class="tbl"><table><thead><tr><th>${esc(t('adm.faculty'))}</th><th>${esc(t('adm.teacher'))}</th><th>${esc(t('adm.lessons'))}</th><th>${esc(t('rep.students'))}</th><th>${esc(t('rep.avg'))}</th><th>${esc(t('rep.bypass'))}</th></tr></thead><tbody>${weekly.rows.map((r) => `<tr><td>${esc(r.faculty)}</td><td>${esc(r.teacher)}</td><td>${r.lessons}</td><td>${r.students}</td><td>${r.averageScore}</td><td>${r.bypass}</td></tr>`).join('')}</tbody></table></div>
        <button class="btn block" id="wcsv">${icon('download')}${esc(t('rep.csv'))}</button></section>
      <section class="card stack"><h2>${esc(t('adm.stats'))}</h2>
        <div class="tiles"><div class="tile" style="background:var(--primary-soft);color:var(--primary-text)"><b>${tele.lessons.total}</b><span>${esc(t('adm.lessons'))}</span></div><div class="tile ok"><b>${Object.values(tele.studentsByLevel).reduce((a, b) => a + b, 0)}</b><span>${esc(t('rep.students'))}</span></div><div class="tile warn"><b>${Object.values(tele.bypass.byType).reduce((a, b) => a + b, 0)}</b><span>${esc(t('rep.bypass'))}</span></div></div>
        <p class="muted small">${esc(t('adm.protShare'))}: ${Object.entries(tele.protectedSharePct).map(([k, v]) => `${esc(k)} ${v}%`).join(' · ') || '—'}</p></section>
      <section class="card stack"><h2>${esc(t('adm.deletions'))}</h2>
        ${dels.length ? dels.map((r) => `<div class="row nowrap"><div class="grow"><b>${esc(r.name_norm || r.contact || r.id)}</b><div class="muted small">${esc(r.contact || '')} · ${esc(new Date(r.created_at).toLocaleDateString())} · ${esc(r.status)}</div></div>${r.status === 'done' ? '' : `<button class="btn sm" data-dr="${esc(r.id)}">${esc(t('adm.done'))}</button>`}</div>`).join('') : `<span class="muted">${esc(t('adm.none'))}</span>`}</section></div>`;
    bind();
  }
  function bind() {
    $('#fa', view).onclick = async () => { try { await post('/admin/faculties', { name: $('#fn', view).value }); load(); } catch (e) { toastErr(e); } };
    $$('[data-fd]', view).forEach((b) => { b.onclick = async () => { if (await confirmBox({ title: t('common.delete') + '?', ok: t('common.delete'), danger: true })) { try { await api('DELETE', '/admin/faculties/' + b.dataset.fd); load(); } catch (e) { toastErr(e); } } }; });
    $$('[data-ur]', view).forEach((s) => { s.onchange = async () => { try { await api('PUT', '/admin/users/' + s.dataset.ur, { role: s.value }); toast(t('set.saved'), 'ok'); } catch (e) { toastErr(e); load(); } }; });
    $$('[data-uf]', view).forEach((s) => { s.onchange = async () => { try { await api('PUT', '/admin/users/' + s.dataset.uf, { facultyId: s.value }); toast(t('set.saved'), 'ok'); } catch (e) { toastErr(e); } }; });
    $('#sc', view).onchange = (e) => { scopeSel.v = e.target.value; load(); };
    $('#ssave', view).onclick = async () => {
      const values = {};
      try { $$('[data-k]', view).forEach((i) => { const v = JSON.parse(i.value); if (JSON.stringify(v) !== JSON.stringify(sdata.effective[i.dataset.k])) values[i.dataset.k] = v; }); } catch { $('#smsg', view).innerHTML = `<p class="err-text">JSON?</p>`; return; }
      if (!Object.keys(values).length) return;
      try { await api('PUT', '/admin/settings', { scope: scopeSel.v === 'global' ? 'global' : 'faculty', facultyId: scopeSel.v === 'global' ? '' : scopeSel.v, values }); toast(t('set.saved'), 'ok'); load(); }
      catch (e) { $('#smsg', view).innerHTML = `<p class="err-text">${esc(e.message)}</p>`; }
    };
    $('#wcsv', view).onclick = () => download('/admin/reports/weekly?format=csv', 'edufocus-haftalik.csv').catch(toastErr);
    $$('[data-dr]', view).forEach((b) => { b.onclick = async () => { try { await post(`/admin/deletion-requests/${b.dataset.dr}/resolve`); load(); } catch (e) { toastErr(e); } }; });
  }
  await load();
}
