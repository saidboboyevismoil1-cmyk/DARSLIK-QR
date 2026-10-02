import { $, $$, esc, icon } from '../util.js';
import { t, LANGS, getLang, setLang } from '../i18n.js';
import { get, post, api, session, flushQueue } from '../api.js';
import { toast, toastErr, confirmBox, promptBox, setTheme, getTheme } from '../ui.js';
import { go, rerender } from '../app.js';

const row = (href, ico, title, sub) => `<a class="item tap" href="${href}"><div class="ico">${icon(ico)}</div><div class="grow"><b>${esc(title)}</b>${sub ? `<div class="muted small">${esc(sub)}</div>` : ''}</div>${icon('next', 'muted')}</a>`;

export default async function more({ view, setTop }) {
  setTop({ title: t('more.title') });
  const me = session.teacher || {};
  view.innerHTML = `<div class="stack lg">
    <div class="card"><div class="row nowrap"><div class="logo" style="width:52px;height:52px;border-radius:16px;font-weight:800;font-size:20px">${esc((me.name || '?').slice(0, 1))}</div><div class="grow"><b>${esc(me.name || '')} ${esc(me.surname || '')}</b><div class="muted small ellipsis">${esc(me.email || '')}</div></div></div></div>
    <div class="card list">
      ${row('#/materials', 'file', t('more.materials'))}
      ${row('#/settings', 'settings', t('more.settings'))}
      <a class="item tap" href="#" id="tour"><div class="ico">${icon('help')}</div><div class="grow"><b>${esc(t('more.help'))}</b><div class="muted small">${esc(t('more.helpD'))}</div></div>${icon('next', 'muted')}</a>
      ${me.role === 'admin' ? row('#/admin', 'admin', t('nav.admin'), t('more.adminD')) : ''}
      ${me.role === 'admin' ? row('/lock.html', 'lock', t('more.lockPanel')) : ''}
      ${row('/privacy-policy', 'shield', t('set.privacy'))}
    </div></div>`;
  $('#tour', view).onclick = (e) => { e.preventDefault(); import('../tour.js').then((m) => m.open()); };
}

export async function settings({ view, setTop }) {
  setTop({ title: t('set.title'), backTo: '/more' });
  let me = session.teacher || {};
  try { me = await get('/profile'); session.setTeacher(me); } catch { /* oflayn */ }
  const chip = (attr, val, label, cur) => `<button class="chip" ${attr}="${val}" aria-pressed="${cur === val}">${esc(label)}</button>`;
  view.innerHTML = `<div class="stack lg">
    <section class="card stack"><h2>${esc(t('set.profile'))}</h2>
      <div class="row nowrap"><div class="grow"><label class="lbl" for="pn">${esc(t('auth.name'))}</label><input id="pn" class="field" value="${esc(me.name || '')}"></div><div class="grow"><label class="lbl" for="ps">${esc(t('auth.surname'))}</label><input id="ps" class="field" value="${esc(me.surname || '')}"></div></div>
      <div><label class="lbl" for="pp">${esc(t('set.phone'))}</label><input id="pp" class="field" type="tel" value="${esc(me.phone || '')}"></div>
      <div><label class="lbl" for="pc">${esc(t('auth.school'))}</label><input id="pc" class="field" value="${esc(me.school || '')}"></div>
      <div><label class="lbl" for="pj">${esc(t('auth.subject'))}</label><input id="pj" class="field" value="${esc(me.subject || '')}"></div>
      <button class="btn pri block" id="savep">${esc(t('common.save'))}</button></section>
    <section class="card stack"><h2>${esc(t('set.language'))}</h2><div class="chips">${LANGS.map((l) => chip('data-l', l, { uz: 'O\'zbekcha', ru: 'Русский', en: 'English' }[l], getLang())).join('')}</div>
      <h2 style="margin-top:8px">${esc(t('set.theme'))}</h2><div class="chips">${['auto', 'light', 'dark'].map((k) => chip('data-th', k, t({ auto: 'set.themeAuto', light: 'set.themeLight', dark: 'set.themeDark' }[k]), getTheme())).join('')}</div></section>
    <section class="card stack"><h2>${esc(t('set.notif'))}</h2><p class="muted">${esc(t('set.notifD'))}</p></section>
    <section class="card stack"><h2>${esc(t('set.password'))}</h2>
      <div><label class="lbl" for="op">${esc(t('set.oldPassword'))}</label><input id="op" class="field" type="password" autocomplete="current-password"></div>
      <div><label class="lbl" for="np">${esc(t('auth.newPassword'))}</label><input id="np" class="field" type="password" autocomplete="new-password"></div>
      <div id="pmsg"></div><button class="btn block" id="chp">${esc(t('set.password'))}</button></section>
    <button class="btn block" id="out">${icon('out')}${esc(t('set.logout'))}</button>
    <button class="btn danger-text block" id="del">${icon('trash')}${esc(t('set.deleteAcc'))}</button></div>`;
  $$('[data-l]', view).forEach((b) => { b.onclick = () => { setLang(b.dataset.l); rerender(); }; });
  $$('[data-th]', view).forEach((b) => { b.onclick = () => { setTheme(b.dataset.th); $$('[data-th]', view).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }; });
  $('#savep', view).onclick = async () => { try { const r = await api('PUT', '/profile', { name: $('#pn', view).value, surname: $('#ps', view).value, phone: $('#pp', view).value, school: $('#pc', view).value, subject: $('#pj', view).value }); session.setTeacher(r.teacher); toast(t('set.saved'), 'ok'); } catch (e) { toastErr(e); } };
  $('#chp', view).onclick = async () => {
    try { const r = await post('/auth/change-password', { oldPassword: $('#op', view).value, newPassword: $('#np', view).value }); session.set(r); $('#op', view).value = ''; $('#np', view).value = ''; $('#pmsg', view).innerHTML = ''; toast(t('set.passwordDone'), 'ok'); }
    catch (e) { $('#pmsg', view).innerHTML = `<p class="err-text">${esc(e.status === 403 ? t('set.oldPassword') : (e.message === 'error' ? t('common.error') : e.message))}</p>`; }
  };
  $('#out', view).onclick = async () => { try { await flushQueue(); await post('/auth/logout', { refreshToken: session.refresh }); } catch { /* */ } if (window.EFTeacherNative && window.EFTeacherNative.clear) window.EFTeacherNative.clear(); session.clear(); go('/login', true); };
  $('#del', view).onclick = async () => {
    const pw = await promptBox({ title: t('set.deleteAcc'), text: t('set.deleteAccD'), label: t('auth.password'), type: 'password', ok: t('common.delete'), danger: true });
    if (!pw) return;
    try { await api('DELETE', '/account', { password: pw }); if (window.EFTeacherNative && window.EFTeacherNative.clear) window.EFTeacherNative.clear(); session.clear(); toast(t('set.deleted'), 'ok'); go('/login', true); }
    catch (e) { toast(e.status === 403 ? t('auth.wrong') : (e.message === 'error' ? t('common.error') : e.message), 'bad'); }
  };
}
