// EduFocus talaba ilovasi — kirish nuqtasi: yuklash, onboarding, ism, bosh sahifa, profil, navigatsiya.
import { $, $$, store, toast, native } from './util.js';
import { S, bus, actions, reset, push, pop, hasStack, currentScreen, onEnter, openOverlay, closeOverlay, topOverlay, isOverlayOpen } from './state.js';
import * as net from './net.js';
import { askConfirm } from './lesson.js';   // lesson.js quiz/materials'dan oldin ro'yxatdan o'tishi kerak
import './quiz.js';
import './materials.js';
import './tools.js';
import { openScanner, parseCode } from './scanner.js';

// ---------- Mavzu ----------
const getTheme = () => store.get('ef_theme', 'auto');
function applyTheme() {
  const t = getTheme();
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#theme-ico').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  $$('#theme-seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === t));
}
actions['theme-set'] = (el) => { store.set('ef_theme', el.dataset.v); applyTheme(); };
actions.theme = () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  store.set('ef_theme', dark ? 'light' : 'dark');
  applyTheme();
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------- Ism ----------
function renderName() {
  const n = S.name || 'Talaba';
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
$('#name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#name-input').value.trim().replace(/\s+/g, ' ');
  if (v.length < 2) { $('#name-err').textContent = 'Iltimos, ismingizni kiriting'; return; }
  S.name = v;
  store.set('ef_name', v);
  renderName();
  document.activeElement && document.activeElement.blur();
  if (S.pendingCode) { const c = S.pendingCode; S.pendingCode = ''; goHome(); startJoin(c); }
  else if (hasStack()) pop();
  else goHome();
});

// ---------- Onboarding ----------
const slides = $('#slides');
const slideIndex = () => Math.round(slides.scrollLeft / (slides.clientWidth || 1));
slides.addEventListener('scroll', () => {
  const i = slideIndex();
  $$('#dots i').forEach((d, k) => d.classList.toggle('on', k === i));
  $('#onb-next').textContent = i >= 2 ? 'Boshlash' : 'Keyingisi';
}, { passive: true });
function finishOnboarding() {
  store.set('ef_onboarded', true);
  if (!S.name) showName(false); else { goHome(); if (S.pendingCode) { const c = S.pendingCode; S.pendingCode = ''; startJoin(c); } }
}
actions['onb-next'] = () => { const i = slideIndex(); if (i >= 2) finishOnboarding(); else slides.scrollTo({ left: (i + 1) * slides.clientWidth, behavior: 'smooth' }); };
actions['onb-skip'] = finishOnboarding;
actions['onb-camera'] = async () => {
  const btn = $('#onb-cam-btn');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    stream.getTracks().forEach((t) => t.stop());
    btn.querySelector('span').textContent = 'Ruxsat berildi ✓';
    btn.disabled = true;
  } catch { toast('Kamera ruxsati berilmadi. Keyin sozlamalardan yoqishingiz mumkin'); }
};

// ---------- Bosh sahifa va qo'shilish ----------
function goHome() { renderName(); reset('s-home'); }
const codeInput = $('#code-input');
const setJoinUi = (busy) => {
  const b = $('#code-btn');
  b.disabled = busy;
  b.textContent = busy ? 'Ulanmoqda…' : 'Kirish';
  codeInput.disabled = busy;
};
function startJoin(code) {
  if (!S.name) { S.pendingCode = code; showName(false); return; }
  codeInput.value = code;
  $('#code-err').textContent = '';
  net.join(code);
}
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
  $('#code-err').textContent = '';
  if (codeInput.value.length === 6) startJoin(codeInput.value);
});
$('#code-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (codeInput.value.length !== 6) { $('#code-err').textContent = '6 xonali dars kodini kiriting'; return; }
  startJoin(codeInput.value);
});
bus.on('joining', () => {
  setJoinUi(true);
  if (['s-splash', 's-onboard', 's-name'].includes(currentScreen())) goHome();
});
bus.on('join-fail', (msg) => { setJoinUi(false); $('#code-err').textContent = msg; if (currentScreen() === 's-scan') pop(); haptic(); });
bus.on('applied', () => { setJoinUi(false); codeInput.value = ''; });
bus.on('scanned', (code) => { pop(); startJoin(code); });
bus.on('gone', () => { toast('Dars sessiyasi topilmadi. Qayta qo\'shiling'); goHome(); });
bus.on('leave', () => { net.leave(); goHome(); });
function haptic() { try { navigator.vibrate && navigator.vibrate(60); } catch { /* ignore */ } }
actions.scan = () => openScanner();
actions.home = () => { closeOverlay('o-rate'); net.leave(); goHome(); };
actions['go-profile'] = () => push('s-profile');

// ---------- Profil ----------
onEnter('s-profile', () => {
  renderName(); applyTheme();
  $('#exit-row').hidden = !native.present;
});
actions['reset-ask'] = () => {
  if (S.phase === 'joined' && S.locked) { toast('Dars davomida ma\'lumotlarni o\'chirib bo\'lmaydi'); return; }
  askConfirm({ title: "Ma'lumotlar o'chirilsinmi?", text: 'Ism va barcha sozlamalar qurilmadan tozalanadi. Bu amalni qaytarib bo\'lmaydi.', ok: "O'chirish", danger: true }, () => {
    net.leave();
    store.clearApp();
    location.replace('/student.html');
  });
};
actions['exit-app'] = () => {
  if (S.phase === 'joined' && S.locked) { toast('🔒 Dars vaqtida ilovadan chiqish taqiqlangan'); return; }
  native.call('stopKioskMode');
  native.call('exitApp');
};

// ---------- Umumiy amallar va navigatsiya ----------
actions.back = () => { if (!pop() && !topOverlay()) bus.emit('noback'); };
actions['close-overlay'] = (el) => closeOverlay(el.dataset.id);

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el, e);
});
$$('.overlay').forEach((o) => {
  o.setAttribute('inert', '');
  o.addEventListener('click', (e) => { if (e.target === o && o.id !== 'o-conn') closeOverlay(o.id); });
});

// Android orqaga tugmasi (native o'ram chaqiradi). true = web tomoni o'zi hal qildi.
window.handleAppBackPress = () => {
  const o = topOverlay();
  if (o) { closeOverlay(o); return true; }
  if (hasStack()) { pop(); return true; }
  if (S.phase === 'joined' && S.locked) { toast('🔒 Dars vaqtida ilovadan chiqish taqiqlangan'); return true; }
  return false;
};

// Native o'ram xavfsiz hudud (safe-area) qiymatlarini shu orqali beradi (px).
window.setNativeInsets = (t, r, b, l) => {
  const st = document.documentElement.style;
  st.setProperty('--native-sat', t + 'px'); st.setProperty('--native-sar', r + 'px');
  st.setProperty('--native-sab', b + 'px'); st.setProperty('--native-sal', l + 'px');
};

// ---------- Ishga tushirish ----------
function boot() {
  applyTheme();
  // Eski versiya ma'lumotlarini ko'chirish
  if (!store.get('ef_name')) {
    let old = '';
    try { old = localStorage.getItem('edufocus_student_name') || ''; if (!old) old = (JSON.parse(localStorage.getItem('hemis_student_profile') || '{}') || {}).name || ''; } catch { /* ignore */ }
    if (old && old !== 'Talaba') store.set('ef_name', old);
  }
  if (!store.get('ef_onboarded') && localStorage.getItem('edufocus_onboarding_completed')) store.set('ef_onboarded', true);
  S.name = store.get('ef_name', '') || '';
  renderName();

  const qs = new URLSearchParams(location.search);
  const code = parseCode(qs.get('session') || '');
  const action = qs.get('action');
  const tour = qs.get('tour') === '1' || qs.get('reset') === '1';
  if (qs.has('session') || qs.has('action') || tour) history.replaceState(null, '', location.pathname);

  const saved = net.loadSaved();
  if (saved && (!code || code === saved.sessionId) && !tour) {
    net.resume(saved);
  } else if (tour || !store.get('ef_onboarded')) {
    if (tour) store.del('ef_onboarded');
    S.pendingCode = code || '';
    reset('s-onboard');
  } else if (!S.name) {
    S.pendingCode = code || '';
    showName(false);
  } else if (code) {
    goHome(); startJoin(code);
  } else if (action === 'scan') {
    goHome(); openScanner();
  } else {
    goHome();
  }
  window.__efBooted = true;
  (window.requestIdleCallback || ((f) => setTimeout(f, 400)))(() => net.ensure());
}

if (window.io) boot();
else window.addEventListener('load', boot);   // socket.io skripti defer — odatda tayyor bo'ladi
