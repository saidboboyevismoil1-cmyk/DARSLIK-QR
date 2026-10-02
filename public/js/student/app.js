// EduFocus talaba ilovasi — kirish nuqtasi: til, rozilik, onboarding, ruxsatlar, ism, bosh sahifa, profil, navigatsiya.
import { $, $$, esc, store, toast } from './util.js';
import { S, bus, actions, reset, push, pop, hasStack, currentScreen, onEnter, closeOverlay, topOverlay } from './state.js';
import { initI18n, t, LANGS, lang, setLang, onLangChange } from './i18n.js';
import { native } from './native.js';
import * as net from './net.js';
import * as prot from './protection.js';
import { track } from './track.js';
import { askConfirm } from './lesson.js';   // lesson.js quiz/materials/join'dan oldin ro'yxatdan o'tishi kerak
import './quiz.js';
import './materials.js';
import './tools.js';
import { openScanner, parseCode } from './scanner.js';
import { updateHomeReady, levelLabel } from './setup.js';
import { startJoin } from './join.js';

const CONSENT_VERSION = 1;
const VERSION = '5.0';

// ---------- Mavzu ----------
const getTheme = () => store.get('ef_theme', 'auto');
function applyTheme() {
  const th = getTheme();
  if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme;
  const dark = th === 'dark' || (th === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#theme-ico').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  $$('#theme-seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === th));
  native.fire('setSystemBarsDark', { dark });
}
actions['theme-set'] = (el) => { store.set('ef_theme', el.dataset.v); applyTheme(); };
actions.theme = () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  store.set('ef_theme', dark ? 'light' : 'dark');
  applyTheme();
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------- Til ----------
function langButtons(cls) {
  return LANGS.map((l) => `<button type="button" class="${cls}${l.code === lang() ? ' on' : ''}" data-act="set-lang" data-v="${l.code}" lang="${l.code}">${esc(l.label)}</button>`).join('');
}
function renderLang() {
  $('#lang-chips').innerHTML = langButtons('lchip');
  $('#lang-seg').innerHTML = langButtons('');
  $('#lang-seg').style.gridTemplateColumns = `repeat(${LANGS.length}, 1fr)`;
}
actions['set-lang'] = async (el) => { await setLang(el.dataset.v); };
onLangChange(() => { renderLang(); renderName(); fillProfile(); applyTheme(); updateHomeReady(); });

// ---------- Ism ----------
function renderName() {
  const n = S.name || t('home.student');
  const ch = n.trim().charAt(0).toUpperCase() || 'T';
  $('#home-name').textContent = n; $('#prof-name').textContent = n;
  $('#home-avatar').textContent = ch; $('#prof-avatar').textContent = ch;
}
function showName(editing) {
  $('#name-bar').hidden = !editing;
  $('#name-input').value = S.name || '';
  $('#name-err').textContent = '';
  if (editing) push('s-name'); else reset('s-name');
}
actions['edit-name'] = () => showName(true);
bus.on('need-name', () => showName(false));
$('#name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#name-input').value.trim().replace(/\s+/g, ' ');
  if (v.length < 2) { $('#name-err').textContent = t('name.err'); return; }
  S.name = v;
  store.set('ef_name', v);
  renderName();
  document.activeElement && document.activeElement.blur();
  if (S.pendingCode) { const c = S.pendingCode; S.pendingCode = ''; goHome(); startJoin(c); }
  else if (hasStack()) pop();
  else goHome();
});

// ---------- Marshrutlash: rozilik → onboarding → sozlash → ism → bosh sahifa ----------
const consentOk = () => { const c = store.get('ef_consent'); return !!(c && c.v === CONSENT_VERSION); };
function route() {
  if (!consentOk()) { track('consent', 'reached'); return reset('s-consent'); }
  if (!store.get('ef_onboarded')) return reset('s-onboard');
  if (native.present && !store.get('ef_setup_seen')) { track('ready', 'reached'); return reset('s-setup'); }
  if (!S.name) return showName(false);
  goHome();
  if (S.pendingCode) { const c = S.pendingCode; S.pendingCode = ''; startJoin(c); }
}

actions['consent-accept'] = () => { store.set('ef_consent', { v: CONSENT_VERSION, at: Date.now(), lang: lang() }); track('consent', 'granted'); route(); };
actions['consent-decline'] = () => { track('consent', 'denied'); reset('s-declined'); };
actions['consent-review'] = () => reset('s-consent');
actions['consent-withdraw'] = () => askConfirm({ title: t('consent.withdrawT'), text: t('consent.withdrawD'), ok: t('consent.withdrawOk'), danger: true }, () => { store.del('ef_consent'); net.leave(); reset('s-consent'); });

// ---------- Onboarding ----------
const slides = $('#slides');
const slideIndex = () => Math.round(slides.scrollLeft / (slides.clientWidth || 1));
slides.addEventListener('scroll', () => {
  const i = slideIndex();
  $$('#dots i').forEach((d, k) => d.classList.toggle('on', k === i));
  $('#onb-next').textContent = i >= 2 ? t('onb.start') : t('onb.next');
}, { passive: true });
function finishOnboarding() { store.set('ef_onboarded', true); route(); }
actions['onb-next'] = () => { const i = slideIndex(); if (i >= 2) finishOnboarding(); else slides.scrollTo({ left: (i + 1) * slides.clientWidth, behavior: 'smooth' }); };
actions['onb-skip'] = finishOnboarding;

// ---------- Ruxsatlarni sozlash (davomi) ----------
function finishSetup() {
  store.set('ef_setup_seen', true);
  if (hasStack()) pop(); else route();
}
actions['setup-continue'] = () => { track('ready', prot.missingForBest().length ? 'skipped' : 'granted'); finishSetup(); };
actions['setup-later'] = () => { track('ready', 'skipped'); finishSetup(); };
actions['skip-setup-info'] = () => toast(t('setup.whyText'), 8000);

// ---------- Bosh sahifa ----------
function goHome() { renderName(); updateHomeReady(); reset('s-home'); }
const codeInput = $('#code-input');
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
  $('#code-err').textContent = '';
  $('#join-gate').hidden = true;
  if (codeInput.value.length === 6) startJoin(codeInput.value);
});
$('#code-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (codeInput.value.length !== 6) { $('#code-err').textContent = t('home.codeErr'); return; }
  startJoin(codeInput.value);
});
bus.on('scanned', (code) => { if (currentScreen() === 's-scan') pop(); startJoin(code); });
bus.on('gone', () => { toast(t('join.err.gone')); goHome(); });
bus.on('leave', () => { net.leave(); goHome(); });
actions.scan = () => openScanner();
actions.home = () => { closeOverlay('o-rate'); net.leave(); goHome(); };
actions['go-profile'] = () => push('s-profile');

// ---------- Profil ----------
function fillProfile() {
  renderName();
  applyTheme();
  const info = prot.P.info || {};
  $('#prof-level').textContent = levelLabel(prot.P.level);
  const c = store.get('ef_consent');
  $('#prof-consent').textContent = c ? new Date(c.at).toLocaleDateString(lang()) : '';
  $('#prof-version').textContent = `EduFocus ${VERSION}${info.appVersion ? ` · app ${info.appVersion}` : ''}${info.flavor ? ` · ${info.flavor}` : ''}`;
  $('#exit-row').hidden = !(native.present && native.platform === 'android');
  $$('#lang-seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === lang()));
}
onEnter('s-profile', fillProfile);

actions['reset-ask'] = () => {
  if (S.phase === 'joined' && S.locked) { toast(t('profile.deleteLocked')); return; }
  askConfirm({ title: t('profile.deleteT'), text: t('profile.deleteD'), ok: t('profile.deleteOk'), danger: true }, async () => {
    const items = net.history().map((h) => ({ sessionId: h.sessionId, studentId: h.studentId }));
    try {
      const r = await fetch('/api/student-data/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceKey: await prot.deviceKey(), items }) });
      if (!r.ok) throw new Error(String(r.status));
    } catch { toast(t('profile.deleteFailed'), 6000); return; }
    net.leave();
    store.clearApp();
    toast(t('profile.deleted'));
    setTimeout(() => location.replace('/student.html'), 700);
  });
};
actions['exit-app'] = () => {
  if (S.phase === 'joined' && S.locked) { toast(t('lesson.noExit')); return; }
  native.fire('exitApp');
};

// ---------- Umumiy amallar va navigatsiya ----------
actions.back = () => { if (!pop() && !topOverlay()) bus.emit('noback'); };
actions['close-overlay'] = (el) => closeOverlay(el.dataset.id);

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el, e);
});
$$('.overlay').forEach((o) => {
  o.setAttribute('inert', '');
  o.addEventListener('click', (e) => { if (e.target === o && o.id !== 'o-conn') closeOverlay(o.id); });
});

// Orqaga tugmasi: true = web tomoni o'zi hal qildi
function handleBack() {
  const o = topOverlay();
  if (o) { closeOverlay(o); return true; }
  if (hasStack()) { pop(); return true; }
  if (S.phase === 'joined' && S.locked) { toast(t('lesson.noExit')); return true; }
  return false;
}
window.handleAppBackPress = handleBack;
bus.on('native-back', () => { if (!handleBack()) native.fire('exitApp'); });
// Predictive back (Android 16): native sinxron qaror uchun web holatini oldindan biladi
let lastBackFlag = null;
function syncBackFlag() {
  const v = !!(topOverlay() || hasStack() || (S.phase === 'joined' && S.locked));
  if (v !== lastBackFlag) { lastBackFlag = v; native.fire('setBackHandled', { value: v }); }
}
bus.on('screen', syncBackFlag); bus.on('overlay', syncBackFlag); bus.on('overlay-closed', syncBackFlag); bus.on('applied', syncBackFlag);

// iOS pull-to-refresh: faqat xavfsiz ekranlarda
const PULL_OK = new Set(['s-home', 's-profile', 's-ended']);
bus.on('screen', (id) => {
  const on = PULL_OK.has(id);
  document.documentElement.classList.toggle('pull', on);
  native.fire('setPullToRefresh', { value: on });
});

// Native o'ram xavfsiz hudud qiymatlarini shu orqali beradi (px)
window.setNativeInsets = (tp, r, b, l) => {
  const st = document.documentElement.style;
  st.setProperty('--native-sat', tp + 'px'); st.setProperty('--native-sar', r + 'px');
  st.setProperty('--native-sab', b + 'px'); st.setProperty('--native-sal', l + 'px');
};

// Rejoin: qurilma kaliti, mijoz ma'lumoti va himoya holati
net.setRejoinProvider(async () => {
  const st = await prot.currentState();
  return { deviceKey: await prot.deviceKey(), client: prot.clientInfo(), protection: { active: st.active, reasons: st.reasons, checks: st.checks } };
});

// ---------- Ishga tushirish ----------
async function boot() {
  await initI18n();
  renderLang();
  applyTheme();
  // Eski versiya ma'lumotlarini ko'chirish
  if (!store.get('ef_name')) {
    let old = '';
    try { old = localStorage.getItem('edufocus_student_name') || ''; } catch { /* ignore */ }
    if (old && old !== 'Talaba') store.set('ef_name', old);
  }
  S.name = store.get('ef_name', '') || '';
  renderName();

  const qs = new URLSearchParams(location.search);
  const code = parseCode(qs.get('session') || '');
  const action = qs.get('action');
  const tour = qs.get('tour') === '1' || qs.get('reset') === '1';
  if (qs.has('session') || qs.has('action') || tour) history.replaceState(null, '', location.pathname);
  if (tour) { store.del('ef_onboarded'); store.del('ef_consent'); }

  await prot.init();
  fillProfile();
  updateHomeReady();

  const saved = net.loadSaved();
  if (saved && (!code || code === saved.sessionId) && !tour && consentOk()) {
    net.resume(saved);
  } else {
    S.pendingCode = code || '';
    const ready = !tour && consentOk() && store.get('ef_onboarded') && (!native.present || store.get('ef_setup_seen')) && S.name;
    if (ready && !code && action === 'scan') { goHome(); openScanner(); } else route();
  }
  window.__efBooted = true;
  (window.requestIdleCallback || ((f) => setTimeout(f, 400)))(() => {
    net.ensure();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const start = () => boot().catch((e) => { console.error(e); window.__efBootError = String(e && e.message); });
if (window.io) start();
else window.addEventListener('load', start);   // socket.io skripti defer — odatda tayyor bo'ladi
