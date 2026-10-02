import { $, esc, icon } from '../util.js';
import { t, LANGS, getLang, setLang } from '../i18n.js';
import { post, session, ApiError } from '../api.js';
import { toast } from '../ui.js';
import { go, rerender } from '../app.js';

const langBar = () => `<div class="chips" style="justify-content:center">${LANGS.map((l) => `<button class="chip" aria-pressed="${l === getLang()}" data-lang="${l}">${{ uz: 'O\'zbekcha', ru: 'Русский', en: 'English' }[l]}</button>`).join('')}</div>`;
const bindLang = (root) => root.querySelectorAll('[data-lang]').forEach((b) => { b.onclick = () => { setLang(b.dataset.lang); rerender(); }; });
const frame = (inner) => `<div class="auth"><div class="logo">${icon('shield')}</div>${inner}${langBar()}</div>`;
const pw = (id, label, ac = 'current-password') => `<div><label class="lbl" for="${id}">${esc(label)}</label><div style="position:relative"><input id="${id}" class="field" type="password" autocomplete="${ac}" style="padding-right:96px"><button type="button" class="btn ghost sm" data-eye="${id}" style="position:absolute;right:2px;top:2px;min-height:48px">${esc(t('auth.show'))}</button></div></div>`;
const bindEye = (root) => root.querySelectorAll('[data-eye]').forEach((b) => { b.onclick = () => { const i = root.querySelector('#' + b.dataset.eye); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.textContent = t(show ? 'auth.hide' : 'auth.show'); }; });
const msg = (root, text, ok) => { const m = root.querySelector('#msg'); m.className = ok ? 'help' : 'err-text'; m.textContent = text; };
const errText = (e) => (!(e instanceof ApiError) ? t('common.offline') : e.status === 429 ? t('auth.tooMany') : e.status === 401 ? t('auth.wrong') : e.data.code === 'reset_invalid' ? t('auth.resetBad') : e.status < 500 && e.message !== 'error' ? e.message : t('common.error'));

export async function login({ view }) {
  view.innerHTML = frame(`
    <div><h1>${esc(t('auth.title'))}</h1><p class="muted" style="margin-top:6px">${esc(t('auth.sub'))}</p></div>
    <form id="f" class="stack" novalidate>
      <div><label class="lbl" for="em">${esc(t('auth.email'))}</label><input id="em" class="field" type="email" inputmode="email" autocomplete="username" autocapitalize="off"></div>
      ${pw('pw', t('auth.password'))}
      <label class="switch-row"><span class="switch"><input type="checkbox" id="rm" checked><i></i></span><span>${esc(t('auth.remember'))}</span></label>
      <div id="msg" class="err-text" role="alert"></div>
      <button class="btn pri xl block" type="submit">${esc(t('auth.login'))}</button>
      <button class="btn ghost block" type="button" id="bio" hidden>${icon('shield')}${esc(t('auth.bio'))}</button>
    </form>
    <div class="row" style="justify-content:space-between"><a href="#/forgot">${esc(t('auth.forgot'))}</a><a href="#/register">${esc(t('auth.register'))}</a></div>`);
  bindLang(view); bindEye(view);
  const f = $('#f', view);
  // Mobil ilova: Face ID / barmoq izi (native ko'prik bo'lsa)
  const nat = window.EFTeacherNative;
  if (nat && nat.biometricReady) nat.biometricReady().then((ok) => { if (ok) { $('#bio', view).hidden = false; } }).catch(() => {});
  $('#bio', view).onclick = async () => {
    try { const r = await nat.biometricLogin(); if (r && r.refreshToken) { session.set({ token: '', refreshToken: r.refreshToken }, true); const { refreshNow } = await import('../api.js'); if (await refreshNow()) return go('/', true); } } catch { /* */ }
    msg(view, t('auth.wrong'));
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#em', view).value.trim(), password = $('#pw', view).value;
    if (!email || !password) return msg(view, t('auth.fillAll'));
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const r = await post('/login', { email, password });
      session.set(r, $('#rm', view).checked);
      if (nat && nat.saveRefresh) nat.saveRefresh(r.refreshToken);
      go('/', true);
    } catch (err) { msg(view, errText(err)); } finally { btn.disabled = false; }
  };
}

export async function register({ view }) {
  view.innerHTML = frame(`
    <div><h1>${esc(t('auth.register'))}</h1></div>
    <form id="f" class="stack" novalidate>
      <div class="row nowrap"><div class="grow"><label class="lbl" for="n">${esc(t('auth.name'))}</label><input id="n" class="field" autocomplete="given-name"></div><div class="grow"><label class="lbl" for="sn">${esc(t('auth.surname'))}</label><input id="sn" class="field" autocomplete="family-name"></div></div>
      <div><label class="lbl" for="em">${esc(t('auth.email'))}</label><input id="em" class="field" type="email" autocomplete="email" autocapitalize="off"></div>
      <div><label class="lbl" for="sc">${esc(t('auth.school'))} <span class="muted">(${esc(t('common.optional'))})</span></label><input id="sc" class="field"></div>
      <div><label class="lbl" for="sj">${esc(t('auth.subject'))} <span class="muted">(${esc(t('common.optional'))})</span></label><input id="sj" class="field"></div>
      ${pw('pw', t('auth.password'), 'new-password')}<div class="help" style="margin-top:-8px">${esc(t('auth.pwHint'))}</div>
      <div id="msg" class="err-text" role="alert"></div>
      <button class="btn pri xl block" type="submit">${esc(t('auth.register'))}</button>
    </form>
    <a href="#/login" class="center">${esc(t('auth.haveAccount'))}</a>`);
  bindLang(view); bindEye(view);
  $('#f', view).onsubmit = async (e) => {
    e.preventDefault();
    const v = (id) => $('#' + id, view).value.trim();
    if (!v('n') || !v('em') || $('#pw', view).value.length < 6) return msg(view, t('auth.fillAll'));
    try { const r = await post('/register', { name: v('n'), surname: v('sn'), email: v('em'), school: v('sc'), subject: v('sj'), phone: '', password: $('#pw', view).value }); session.set(r, true); go('/', true); }
    catch (err) { msg(view, errText(err)); }
  };
}

export async function forgot({ view }) {
  view.innerHTML = frame(`
    <div><h1>${esc(t('auth.forgotTitle'))}</h1><p class="muted" style="margin-top:6px">${esc(t('auth.forgotSub'))}</p></div>
    <form id="f" class="stack" novalidate>
      <div><label class="lbl" for="em">${esc(t('auth.email'))}</label><input id="em" class="field" type="email" autocomplete="email" autocapitalize="off"></div>
      <div id="msg" class="err-text" role="alert"></div>
      <button class="btn pri xl block" type="submit">${esc(t('auth.forgotSend'))}</button>
    </form>
    <a href="#/login" class="center">${esc(t('common.back'))}</a>`);
  bindLang(view);
  $('#f', view).onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#em', view).value.trim(); if (!email) return msg(view, t('auth.fillAll'));
    try { await post('/auth/forgot', { email }); msg(view, t('auth.forgotSent'), true); } catch (err) { msg(view, errText(err)); }
  };
}

export async function reset({ view, query }) {
  view.innerHTML = frame(`
    <div><h1>${esc(t('auth.resetTitle'))}</h1></div>
    <form id="f" class="stack" novalidate>
      ${pw('pw', t('auth.newPassword'), 'new-password')}
      <div id="msg" class="err-text" role="alert"></div>
      <button class="btn pri xl block" type="submit">${esc(t('common.save'))}</button>
    </form>`);
  bindLang(view); bindEye(view);
  $('#f', view).onsubmit = async (e) => {
    e.preventDefault();
    const password = $('#pw', view).value; if (password.length < 8) return msg(view, t('auth.newPassword'));
    try { await post('/auth/reset', { token: query.token, password }); toast(t('auth.resetDone'), 'ok'); go('/login', true); } catch (err) { msg(view, errText(err)); }
  };
}
