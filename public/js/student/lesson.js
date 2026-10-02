// Dars ekranlari: kutish, dars rejimi (himoya), tugash; taymer, himoya holati, heartbeat,
// SOS va favqulodda chiqish, baholash, ulanish holati va tasdiqlash oynasi.
import { $, esc, icon, fmtTime, haptic, toast } from './util.js';
import { S, bus, actions, setBase, reset, push, openOverlay, closeOverlay, isOverlayOpen, currentScreen } from './state.js';
import { t, tn, onLangChange } from './i18n.js';
import * as net from './net.js';
import * as prot from './protection.js';

const RING = 578;
let tickTimer = null;
let wakeLock = null;
let hbOn = false;
const seenMats = new Set();

// ---------- Tasdiqlash oynasi ----------
let confirmCb = null;
export function askConfirm({ title, text, ok, danger = false }, cb) {
  $('#cf-title').textContent = title;
  $('#cf-text').textContent = text;
  const btn = $('#cf-ok');
  btn.textContent = ok || t('common.yes');
  btn.className = 'btn block ' + (danger ? 'btn-danger' : 'btn-primary');
  confirmCb = cb;
  openOverlay('o-confirm');
}
actions['confirm-ok'] = () => { closeOverlay('o-confirm'); const f = confirmCb; confirmCb = null; if (f) f(); };

// ---------- Plitkalar ----------
function tilesHtml() {
  const quizPending = S.quiz && !(S.sess && S.sess.quizDone && S.sess.quizDone[S.quiz.quizId]);
  const unseen = S.materials.filter((m) => !seenMats.has(m.id)).length;
  let html = `<button class="glass tile" data-act="open-quiz"><span class="ti q">${icon('quiz', 'lg')}</span>${esc(t('tiles.quiz'))}${quizPending ? '<span class="badge">1</span>' : ''}</button>`;
  html += `<button class="glass tile" data-act="open-mats"><span class="ti m">${icon('file', 'lg')}</span>${esc(t('tiles.mats'))}${unseen ? `<span class="badge">${unseen}</span>` : ''}</button>`;
  if (S.tool) {
    const ic = S.tool.tool === 'calculator' ? 'calc' : 'globe';
    html += `<button class="glass tile" data-act="open-tool" style="grid-column:1/-1;min-height:84px"><span class="ti t">${icon(ic, 'lg')}</span>${esc(S.tool.appName || t('tiles.tool'))}</button>`;
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
  $('#lesson-name').textContent = s.sessionName || t('lesson.default');
  $('#lesson-subject').textContent = s.subject || '';
  $('#wait-title').textContent = s.sessionName || t('lesson.default');
  renderTiles();
  updateStats();
  if (S.locked) acquireWake();
  const target = S.locked ? 's-lesson' : 's-wait';
  const cur = currentScreen();
  if (['s-splash', 's-home', 's-name', 's-scan', 's-onboard', 's-needapp', 's-exempt', 's-roster', 's-consent', 's-setup', 's-ready'].includes(cur)) reset(target);
  else setBase(target);
  startTick();
  syncProtection();
  renderProtection();
}
bus.on('applied', renderBase);
bus.on('quiz', renderTiles);
bus.on('material', renderTiles);
bus.on('quiz-result', renderTiles);
bus.on('tool', renderTiles);

// ---------- Himoya sinxronizatsiyasi ----------
let syncing = false;
async function syncProtection() {
  if (syncing) return;
  syncing = true;
  try {
    if (S.phase !== 'joined') return;
    if (S.locked) {
      const level = prot.P.level;
      if (prot.isStrong(level) && !prot.P.lessonActive) {
        const rem = Math.max(0, Math.round((S.endsAt - Date.now()) / 1000));
        const r = await prot.startLesson({ level, endsInSec: rem });
        if (!r.ok) { lastStartFail = r.reason || 'unknown'; renderProtection(); }
        else lastStartFail = '';
      } else if (prot.P.lessonActive) {
        prot.updateLesson();            // qo'shilishdan oldin yoqilgan himoyaga dars siyosatini qo'llash
      }
    } else {
      lastStartFail = '';
      await prot.stopLesson(S.unlockReason || 'teacher');
    }
    ensureHeartbeat();
    renderProtection();
  } finally { syncing = false; }
}
let lastStartFail = '';
function ensureHeartbeat() { if (!hbOn && S.phase === 'joined') { hbOn = true; prot.startHeartbeat(); } }

// ---------- Himoya holati (chip va banner) ----------
let lastState = null;
function renderProtection(st = lastState) {
  const level = prot.P.level;
  const strong = prot.isStrong(level);
  const chip = $('#prot-chip');
  const txt = $('#prot-chip-text');
  const banner = $('#prot-banner');
  if (!S.locked || S.phase !== 'joined') { banner.hidden = true; return; }
  if (!strong) {
    chip.className = 'chip';
    txt.textContent = t('prot.observe');
    banner.hidden = true;
    return;
  }
  const active = lastStartFail ? false : st ? st.active : prot.P.lessonActive;
  chip.className = 'chip ' + (active ? 'ok' : 'bad');
  txt.textContent = active ? t('prot.active') : t('prot.inactive');
  const reasons = lastStartFail ? [lastStartFail] : st && !st.active ? st.reasons : [];
  banner.hidden = active || !reasons.length && !lastStartFail;
  if (!banner.hidden) {
    $('#prot-banner-text').textContent = reasons.map((r) => { const k = 'prot.reason.' + r; const v = t(k); return v === k ? t('prot.reason.unknown') : v; }).join(' · ');
  }
}
bus.on('protection-state', (st) => { lastState = st; renderProtection(st); });
onLangChange(() => { renderProtection(); renderTiles(); });

actions['fix-protection'] = async () => {
  lastStartFail = '';
  prot.P.lessonActive = false;
  const rem = Math.max(0, Math.round((S.endsAt - Date.now()) / 1000));
  const r = await prot.startLesson({ level: prot.P.level, endsInSec: rem });
  if (!r.ok) {
    lastStartFail = r.reason || 'unknown';
    renderProtection();
    if (['accessibility', 'dnd', 'permission'].includes(r.reason)) push('s-setup');
    return;
  }
  prot.beat();
  renderProtection();
};

// Native: aloqa uzilib 15 daqiqa o'tdi yoki taymer tugadi — qulf o'zi ochildi
bus.on('auto-release', (d) => {
  prot.P.lessonActive = false;
  if (d && d.reason === 'offline') { net.markAutoReleased(); S.unlockReason = 'offline'; toast(t('unlock.offline'), 6000); }
  else if (d && d.reason === 'timer') { S.locked = false; if (S.sess) S.sess.locked = false; S.unlockReason = 'timer'; bus.emit('applied', { fresh: false }); toast(t('unlock.timer'), 6000); }
});
bus.on('unlocked', (d) => {
  const reason = (d && d.reason) || 'teacher';
  haptic([200, 100, 200]);
  toast(t('unlock.' + reason) === 'unlock.' + reason ? t('unlock.teacher') : t('unlock.' + reason), 5000);
});
bus.on('lock-rule', (d) => {
  haptic([100, 60, 100]);
  toast(d.rule === 'absent' ? t('rule.absent') : t('rule.focusZero'), 8000);
});

// ---------- Taymer ----------
function startTick() { if (!tickTimer) tickTimer = setInterval(tick, 1000); tick(); }
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
    toast(t('rate.soon'));
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

async function acquireWake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* ruxsat yo'q */ }
}
function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch { /* ignore */ } wakeLock = null; }

// ---------- Fokus nazorati (eski ustoz paneli uchun mos hodisalar) ----------
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
bus.on('ended', async () => {
  stopTick(); releaseWake();
  prot.stopHeartbeat(); hbOn = false;
  await prot.stopLesson('ended');
  haptic([200, 100, 200]);
  const m = S.summary || {};
  const disc = Math.max(0, 100 - (m.violations || 0) * 15);
  $('#end-sub').textContent = m.sessionName ? t('ended.subNamed', { name: m.sessionName }) : t('ended.sub');
  $('#end-dur').textContent = tn('time.min', m.minutes || 0);
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
let stars = 5;
function paintStars() {
  document.querySelectorAll('#rate-stars .star').forEach((b, i) => b.classList.toggle('on', i < stars));
  $('#rate-label').textContent = `${stars} / 5 · ${t('rate.l' + stars)}`;
}
export function openRate() {
  if (isOverlayOpen('o-rate')) return;
  if (!$('#rate-stars').children.length) {
    $('#rate-stars').innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="star" data-act="star" data-n="${n}" aria-label="${n}">${icon('star')}</button>`).join('');
  }
  stars = 5; paintStars();
  openOverlay('o-rate');
}
actions.star = (el) => { stars = Number(el.dataset.n); paintStars(); haptic(10); };
actions.rate = () => openRate();
actions['rate-close'] = () => closeOverlay('o-rate');
actions['rate-send'] = () => {
  const ok = net.sendRating(stars, $('#rate-comment').value.trim());
  if (!ok) { toast(t('rate.offline')); return; }
  closeOverlay('o-rate');
  toast(t('rate.thanks'));
};

// ---------- Ulanish holati ----------
let connTimer = null;
function updateConn() {
  const online = navigator.onLine;
  $('#net-banner').classList.toggle('show', !online && !(S.phase === 'joined'));
  const joined = S.phase === 'joined';
  const bad = joined && (!S.socketUp || !S.synced || !online);
  const chip = $('#lesson-conn');
  chip.innerHTML = bad ? `<span class="dot" style="background:var(--warn)"></span>${esc(t('conn.reconnecting'))}` : `<span class="dot"></span>${esc(t('conn.online'))}`;
  $('#wait-state').textContent = bad ? t('conn.reconnectingDots') : t('wait.joined');
  clearTimeout(connTimer);
  if (bad) {
    $('#conn-title').textContent = online ? t('conn.title') : t('conn.noInternet');
    $('#conn-text').textContent = online ? t('conn.text') : t('conn.noInternetText');
    connTimer = setTimeout(() => openOverlay('o-conn'), 900);
  } else {
    closeOverlay('o-conn');
  }
}
bus.on('conn', updateConn);
actions.reconnect = () => { net.reconnectNow(); toast(t('conn.reconnectingDots')); };

// ---------- SOS va favqulodda chiqish ----------
actions['open-sos'] = () => openOverlay('o-sos');
actions['sos-call'] = async (el) => {
  closeOverlay('o-sos');
  await prot.sos(el.dataset.n || '');
};

let emgPending = false;
actions['open-emergency'] = () => { if (emgPending) { toast(t('emg.pendingToast')); return; } openOverlay('o-emergency'); };
actions['emg-send'] = () => {
  const reason = (document.querySelector('input[name=emgreason]:checked') || {}).value || 'other';
  if (!net.requestEmergencyExit(t('emg.' + reason))) { toast(t('rate.offline')); return; }
  closeOverlay('o-emergency');
};
bus.on('emergency-pending', () => {
  emgPending = true;
  const b = $('#emergency-btn'); b.disabled = true; b.querySelector('span').textContent = t('emg.pending');
  toast(t('emg.sent'));
});
bus.on('emergency-decision', (d) => {
  emgPending = false;
  const b = $('#emergency-btn'); b.disabled = false; b.querySelector('span').textContent = t('emg.btn');
  toast(d.approved ? t('emg.approved') : t('emg.denied'), 5000);
});
onLangChange(() => { if (!emgPending) $('#emergency-btn').querySelector('span').textContent = t('emg.btn'); });

// ---------- Dars tark etilganda / sessiya yo'qolganda tozalash ----------
function cleanup() { stopTick(); releaseWake(); prot.stopHeartbeat(); hbOn = false; lastState = null; lastStartFail = ''; prot.stopLesson('left'); }
bus.on('leave', cleanup);
bus.on('gone', cleanup);

// ---------- Tugmalar ----------
actions['open-quiz'] = () => push('s-quiz');
actions['open-mats'] = () => { push('s-mats'); markMaterialsSeen(); };
actions.leave = () => askConfirm({ title: t('leave.title'), text: t('leave.text'), ok: t('leave.ok'), danger: true }, () => bus.emit('leave'));
