// Dars ekranlari: kutish, dars rejimi (qulf), tugash, taymer, fokus nazorati,
// baholash, ulanish holati va tasdiqlash oynasi.
import { $, esc, icon, fmtTime, haptic, native, toast } from './util.js';
import { S, bus, actions, setBase, reset, push, openOverlay, closeOverlay, isOverlayOpen, currentScreen } from './state.js';
import * as net from './net.js';

const RING = 578;
let tickTimer = null;
let kioskOn = false;
let wakeLock = null;
const seenMats = new Set();

// ---------- Tasdiqlash oynasi ----------
let confirmCb = null;
export function askConfirm({ title, text, ok = 'Ha', danger = false }, cb) {
  $('#cf-title').textContent = title;
  $('#cf-text').textContent = text;
  const btn = $('#cf-ok');
  btn.textContent = ok;
  btn.className = 'btn block ' + (danger ? 'btn-danger' : 'btn-primary');
  confirmCb = cb;
  openOverlay('o-confirm');
}
actions['confirm-ok'] = () => { closeOverlay('o-confirm'); const f = confirmCb; confirmCb = null; if (f) f(); };

// ---------- Plitkalar ----------
function tilesHtml() {
  const quizPending = S.quiz && !(S.sess && S.sess.quizDone && S.sess.quizDone[S.quiz.quizId]);
  const unseen = S.materials.filter((m) => !seenMats.has(m.id)).length;
  let html = `<button class="glass tile" data-act="open-quiz"><span class="ti q">${icon('quiz', 'lg')}</span>Test${quizPending ? '<span class="badge">1</span>' : ''}</button>`;
  html += `<button class="glass tile" data-act="open-mats"><span class="ti m">${icon('file', 'lg')}</span>Materiallar${unseen ? `<span class="badge">${unseen}</span>` : ''}</button>`;
  if (S.tool) {
    const ic = S.tool.tool === 'calculator' ? 'calc' : 'globe';
    html += `<button class="glass tile" data-act="open-tool" style="grid-column:1/-1;min-height:84px"><span class="ti t">${icon(ic, 'lg')}</span>${esc(S.tool.appName || 'Ruxsat etilgan vosita')}</button>`;
  }
  return html;
}
export function markMaterialsSeen() { S.materials.forEach((m) => seenMats.add(m.id)); renderTiles(); }
export function renderTiles() {
  const h = tilesHtml();
  $('#wait-tiles').innerHTML = h;
  $('#lesson-tiles').innerHTML = h;
}

// ---------- Asosiy ekranni tanlash ----------
function renderBase() {
  if (S.phase !== 'joined' || !S.sess) return;
  const s = S.sess;
  $('#lesson-name').textContent = s.sessionName || 'Dars';
  $('#lesson-subject').textContent = s.subject || '';
  $('#wait-title').textContent = s.sessionName || 'Dars';
  renderTiles();
  updateStats();
  setKiosk(S.locked);
  if (S.locked) { acquireWake(); }
  const target = S.locked ? 's-lesson' : 's-wait';
  const cur = currentScreen();
  if (cur === 's-splash' || cur === 's-home' || cur === 's-name' || cur === 's-scan' || cur === 's-onboard') reset(target);
  else setBase(target);
  startTick();
}
bus.on('applied', renderBase);
bus.on('quiz', renderTiles);
bus.on('material', renderTiles);
bus.on('quiz-result', renderTiles);
bus.on('tool', renderTiles);

// ---------- Taymer ----------
function startTick() { if (!tickTimer) { tickTimer = setInterval(tick, 1000); } tick(); }
function stopTick() { clearInterval(tickTimer); tickTimer = null; }
function tick() {
  if (S.phase !== 'joined') return;
  const rem = Math.max(0, Math.round((S.endsAt - Date.now()) / 1000));
  const txt = fmtTime(rem);
  $('#lesson-timer').textContent = txt;
  $('#wait-timer').textContent = txt;
  const frac = S.totalSec ? Math.min(1, rem / S.totalSec) : 0;
  $('#ring-p').style.strokeDashoffset = String(RING * (1 - frac));
  const s = S.sess;
  if (s && rem > 0 && rem <= 180 && !s.ratePrompted && !s.rated) {
    s.ratePrompted = true; net.persist();
    toast('⭐ Dars tugashiga 3 daqiqa qoldi. Ustozni baholang');
    openRate();
  }
}

function updateStats() {
  const v = (S.sess && S.sess.violations) || 0;
  $('#viol-count').textContent = String(v);
  const score = Math.max(0, 100 - v * 15);
  const el = $('#focus-score');
  el.textContent = score + '%';
  el.style.color = score < 50 ? 'var(--bad)' : score < 85 ? 'var(--warn)' : '';
}

// ---------- Kiosk / wake lock ----------
function setKiosk(on) {
  if (on === kioskOn) return;
  kioskOn = on;
  native.call(on ? 'startKioskMode' : 'stopKioskMode');
  if (!on) releaseWake();
}
async function acquireWake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* ruxsat yo'q */ }
}
function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch { /* ignore */ } wakeLock = null; }

// ---------- Fokus nazorati ----------
document.addEventListener('visibilitychange', () => {
  if (S.phase !== 'joined' || !S.locked || !S.sess || S.tool) return;
  const payload = { sessionId: S.sess.sessionId, studentId: S.sess.studentId };
  if (document.hidden) {
    S.sess.violations = (S.sess.violations || 0) + 1;
    net.persist();
    net.send('student-left-page', payload);
    updateStats();
  } else {
    net.send('student-returned', payload);
    acquireWake();
  }
});

// ---------- Tugash ----------
bus.on('ended', () => {
  setKiosk(false);
  stopTick();
  haptic([200, 100, 200]);
  const m = S.summary || {};
  const disc = Math.max(0, 100 - (m.violations || 0) * 15);
  $('#end-sub').textContent = m.sessionName ? `«${m.sessionName}» darsi tugadi. Qatnashganingiz uchun rahmat!` : 'Qatnashganingiz uchun rahmat!';
  $('#end-dur').textContent = `${m.minutes || 0} daq`;
  $('#end-disc').textContent = disc + '%';
  $('#end-quiz').textContent = m.quiz ? `${m.quiz.correctCount}/${m.quiz.totalQuestions}` : '—';
  renderRated();
  reset('s-ended');
  closeOverlay('o-conn');
  if (!(S.sess && S.sess.rated)) setTimeout(() => { if (S.phase === 'ended') openRate(); }, 800);
});
function renderRated() {
  const r = (S.sess && S.sess.rated) || 0;
  $('#end-rate').textContent = r ? `${r} / 5` : '—';
  $('#end-rate-btn').hidden = !!r;
}
bus.on('rated', () => { renderRated(); });

// ---------- Baholash ----------
const LABELS = ['', 'Juda yomon', 'Yomon', "O'rtacha", 'Yaxshi', "A'lo darajada!"];
let stars = 5;
function paintStars() {
  document.querySelectorAll('#rate-stars .star').forEach((b, i) => b.classList.toggle('on', i < stars));
  $('#rate-label').textContent = `${stars} / 5 · ${LABELS[stars]}`;
}
export function openRate() {
  if (isOverlayOpen('o-rate')) return;
  if (!$('#rate-stars').children.length) {
    $('#rate-stars').innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="star" data-act="star" data-n="${n}" aria-label="${n} yulduz">${icon('star')}</button>`).join('');
  }
  stars = 5; paintStars();
  openOverlay('o-rate');
}
actions.star = (el) => { stars = Number(el.dataset.n); paintStars(); haptic(10); };
actions.rate = () => openRate();
actions['rate-close'] = () => closeOverlay('o-rate');
actions['rate-send'] = () => {
  const ok = net.sendRating(stars, $('#rate-comment').value.trim());
  if (!ok) { toast("Internet yo'q. Baho yuborilmadi — aloqa qaytgach qayta urinib ko'ring"); return; }
  closeOverlay('o-rate');
  toast('⭐ Rahmat! Bahoyingiz ustozga yetkazildi');
};

// ---------- Ulanish holati ----------
let connTimer = null;
function updateConn() {
  const online = navigator.onLine;
  $('#net-banner').classList.toggle('show', !online && !(S.phase === 'joined'));
  const joined = S.phase === 'joined';
  const bad = joined && (!S.socketUp || !S.synced || !online);
  const chip = $('#lesson-conn');
  chip.innerHTML = bad ? `<span class="dot" style="background:var(--warn)"></span>Qayta ulanmoqda` : '<span class="dot"></span>Onlayn';
  $('#wait-state').textContent = bad ? 'Qayta ulanmoqda…' : 'Darsga ulandingiz';
  clearTimeout(connTimer);
  if (bad) {
    $('#conn-title').textContent = online ? 'Aloqa uzildi' : "Internet yo'q";
    $('#conn-text').textContent = online ? 'Serverga qayta ulanilmoqda. Dars holatingiz saqlanadi.' : 'Internet qaytganda darsga avtomatik qaytasiz.';
    connTimer = setTimeout(() => openOverlay('o-conn'), 900);
  } else {
    closeOverlay('o-conn');
  }
}
bus.on('conn', updateConn);
actions.reconnect = () => { net.reconnectNow(); toast('Qayta ulanilmoqda…'); };

// ---------- Tugmalar ----------
actions['open-quiz'] = () => push('s-quiz');
actions['open-mats'] = () => { push('s-mats'); markMaterialsSeen(); };
actions.leave = () => askConfirm({ title: 'Darsdan chiqasizmi?', text: "Ustoz sizni ro'yxatdan chiqqan deb ko'radi.", ok: 'Chiqish', danger: true }, () => bus.emit('leave'));
