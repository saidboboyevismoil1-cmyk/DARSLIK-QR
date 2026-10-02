// Socket.io + sessiya hayot sikli: qo'shilish, avtomatik qayta ulanish (student-rejoin),
// test javobini navbatga qo'yish, dars tugashi, himoya hodisalari (ack, qoidalar, favqulodda chiqish).
import { S, bus } from './state.js';
import { store } from './util.js';
import { native } from './native.js';

const SESS_KEY = 'ef_session';
const HIST_KEY = 'ef_history';
const MAX_AGE = 12 * 3600 * 1000;
let socket = null;
let rejoinTimer = null;
let joinTimer = null;
let rejoinProvider = null;

/** Rejoin paytida qurilma kaliti, mijoz ma'lumoti va himoya holatini beradigan funksiya (app.js o'rnatadi). */
export const setRejoinProvider = (fn) => { rejoinProvider = fn; };

export function deviceName() {
  const ua = navigator.userAgent;
  let d = 'Qurilma';
  if (/iPhone/.test(ua)) d = 'iPhone';
  else if (/iPad/.test(ua)) d = 'iPad';
  else if (/Android/.test(ua)) { const m = ua.match(/;\s*([^;)]+?)\s*(?:Build|\))/); d = m ? m[1].trim() : 'Android'; }
  else if (/Windows/.test(ua)) d = 'Windows PC';
  else if (/Mac/.test(ua)) d = 'Mac';
  else if (/Linux/.test(ua)) d = 'Linux';
  return native.present ? `${d} (app)` : d;
}

export function persist() {
  if (S.sess) { S.sess.savedAt = Date.now(); store.set(SESS_KEY, S.sess); } else store.del(SESS_KEY);
}
export function loadSaved() {
  const s = store.get(SESS_KEY);
  if (s && s.sessionId && s.studentId && Date.now() - (s.savedAt || 0) < MAX_AGE) return s;
  store.del(SESS_KEY);
  return null;
}

/** Ma'lumotni o'chirish uchun: qaysi darslarda qaysi talaba yozuvi bilan qatnashgan. */
export const history = () => store.get(HIST_KEY, []);
function addHistory(sessionId, studentId) {
  const h = history().filter((x) => !(x.sessionId === sessionId && x.studentId === studentId));
  h.push({ sessionId, studentId, at: Date.now() });
  store.set(HIST_KEY, h.slice(-100));
}

function setTiming(data) {
  const total = data.totalSeconds || (data.duration ? data.duration * 60 : 45 * 60);
  const remaining = data.remainingSeconds != null ? data.remainingSeconds : total;
  S.totalSec = total;
  S.endsAt = Date.now() + remaining * 1000;
  if (S.sess) { S.sess.totalSec = total; S.sess.endsAt = S.endsAt; }
}

function freshBase() {
  return { sessionId: S.code, name: S.name, joinedAt: Date.now(), violations: 0, quizDone: {}, quizStart: {}, draft: {}, pending: null, rated: 0, ratePrompted: false, autoReleased: false };
}

function apply(data, base, fresh) {
  S.sess = Object.assign({}, base, { studentId: data.studentId, sessionName: data.sessionName, subject: data.subject });
  S.locked = data.locked === true;
  S.sess.locked = S.locked;
  S.policy = data.protection || null;
  S.quiz = data.activeQuiz || null;
  S.materials = Array.isArray(data.materials) ? data.materials : [];
  S.tool = data.allowedTool || null;
  S.phase = 'joined';
  S.synced = true;
  setTiming(data);
  persist();
  addHistory(S.sess.sessionId, data.studentId);
  bus.emit('applied', { fresh });
  bus.emit('conn');
  flushPending();
}

/** Saqlangan sessiyani tiklash (ilova qayta ochilganda). */
export function resume(saved) {
  S.sess = saved;
  S.code = saved.sessionId;
  S.name = saved.name || S.name;
  S.phase = 'joined';
  S.synced = false;
  S.locked = saved.locked !== false;
  S.totalSec = saved.totalSec || 45 * 60;
  S.endsAt = saved.endsAt || Date.now() + S.totalSec * 1000;
  ensure();
  bus.emit('applied', { fresh: false });
  bus.emit('conn');
  if (socket && socket.connected) rejoin();
}

async function rejoin() {
  if (!socket || !S.sess) return;
  clearTimeout(rejoinTimer);
  let extra = {};
  try { extra = rejoinProvider ? await rejoinProvider() : {}; } catch { /* provayder xatosi rejoin'ni to'xtatmasin */ }
  const payload = { sessionId: S.sess.sessionId, studentId: S.sess.studentId, ...extra };
  if (S.sess.autoReleased) payload.offlineReleased = true;
  socket.emit('student-rejoin', payload);
  // Server noma'lum talaba uchun javob qaytarmasligi mumkin (eski versiya) — kutish vaqti tugasa holatni tekshiramiz
  rejoinTimer = setTimeout(onRejoinFail, 6000);
}

async function onRejoinFail(reason) {
  clearTimeout(rejoinTimer);
  if (!S.sess || S.phase !== 'joined') return;
  if (reason === 'device_mismatch') { gone(); return; }
  try {
    const r = await fetch(`/api/sessions/${S.sess.sessionId}`, { cache: 'no-store' });
    if (r.status === 404) return gone();
    const d = await r.json();
    if (d.status !== 'active') return endSession();
    // Dars faol, lekin talaba topilmadi — o'sha ism bilan qayta qo'shilamiz
    const base = Object.assign({}, S.sess);
    S.code = base.sessionId;
    const extra = rejoinProvider ? await rejoinProvider() : {};
    socket.once('join-success', (data) => apply(data, base, false));
    socket.emit('student-join', { sessionId: base.sessionId, studentName: base.name, device: deviceName(), ...extra });
  } catch { /* tarmoq yo'q — keyingi connect'da qayta uriniladi */ }
}

function gone() {
  S.sess = null; S.phase = 'idle'; S.synced = false; S.quiz = null; S.materials = []; S.tool = null; S.policy = null;
  persist();
  bus.emit('gone');
}

export function ensure() {
  if (socket) { if (!socket.connected && !socket.active) socket.connect(); return socket; }
  if (typeof window.io !== 'function') return null;
  socket = window.io({ reconnectionDelay: 500, reconnectionDelayMax: 4000, timeout: 10000 });

  socket.on('connect', () => {
    S.socketUp = true; S.synced = false; bus.emit('conn');
    if (S.phase === 'joined' && S.sess) rejoin();
  });
  socket.on('disconnect', () => { S.socketUp = false; S.synced = false; bus.emit('conn'); });
  socket.on('connect_error', () => bus.emit('conn'));

  socket.on('join-success', (data) => {
    if (S.phase !== 'joining') return;
    clearTimeout(joinTimer);
    apply(data, freshBase(), true);
  });
  socket.on('join-error', (data) => { clearTimeout(joinTimer); fail((data && data.message) || "Qo'shilib bo'lmadi", data && data.code); });

  socket.on('rejoin-success', (data) => {
    clearTimeout(rejoinTimer);
    if (S.sess) S.sess.autoReleased = false;
    apply(data, S.sess, false);
  });
  socket.on('rejoin-error', (d) => onRejoinFail(d && d.reason));

  socket.on('session-unlocked', (d) => {
    S.locked = false; if (S.sess) S.sess.locked = false; S.unlockReason = (d && d.reason) || 'teacher'; persist();
    bus.emit('applied', { fresh: false });
    bus.emit('unlocked', d || {});
  });
  socket.on('session-locked', (data) => {
    S.locked = true; if (S.sess) { S.sess.locked = true; S.sess.autoReleased = false; } if (data) setTiming(data); persist();
    bus.emit('applied', { fresh: false });
  });
  socket.on('session-ended', () => endSession());

  socket.on('heartbeat-ack', (ack) => {
    if (ack && ack.locked === false && S.locked) { S.locked = false; if (S.sess) S.sess.locked = false; bus.emit('applied', { fresh: false }); }
    bus.emit('heartbeat-ack', ack);
  });
  socket.on('lock-rule', (d) => bus.emit('lock-rule', d || {}));
  socket.on('emergency-exit-pending', (d) => bus.emit('emergency-pending', d || {}));
  socket.on('emergency-exit-decision', (d) => bus.emit('emergency-decision', d || {}));

  socket.on('new-quiz', (quiz) => { S.quiz = quiz; bus.emit('quiz', quiz); });
  socket.on('quiz-result', (data) => {
    if (!S.sess) return;
    const id = (S.sess.pending && S.sess.pending.quizId) || (S.quiz && S.quiz.quizId);
    S.sess.quizDone[id] = data;
    S.sess.pending = null;
    persist();
    bus.emit('quiz-result', { id, data });
  });
  socket.on('new-material', (m) => {
    if (!S.materials.some((x) => x.id === m.id)) S.materials.unshift(m);
    bus.emit('material', m);
  });
  socket.on('app-control', (data) => {
    S.tool = data.action === 'open' ? { tool: data.tool, url: data.url, appName: data.appName } : null;
    bus.emit('tool', data);
  });
  socket.on('session-rating-confirmed', (data) => {
    if (S.sess) { S.sess.rated = data.score; persist(); }
    bus.emit('rated', data.score);
  });
  return socket;
}

export const connected = () => !!(socket && socket.connected);
export function send(evt, data) { if (socket && socket.connected) { socket.emit(evt, data); return true; } return false; }
export function reconnectNow() { ensure(); if (socket && !socket.connected) socket.connect(); }

function fail(message, code) { S.phase = 'idle'; bus.emit('join-fail', { message, code: code || '' }); }

/** Dars ma'lumoti (qo'shilishdan oldin: himoya talabi, ro'yxat, demo). Xato: { code: 'not_found' | 'ended' | 'network' }. */
export async function fetchInfo(code) {
  let r;
  try { r = await fetch(`/api/sessions/${encodeURIComponent(code)}`, { cache: 'no-store' }); } catch { throw Object.assign(new Error('network'), { code: 'network' }); }
  if (r.status === 404) throw Object.assign(new Error('not_found'), { code: 'not_found' });
  if (r.status === 429) throw Object.assign(new Error('rate'), { code: 'rate' });
  const info = await r.json();
  if (info.status !== 'active') throw Object.assign(new Error('ended'), { code: 'ended' });
  return info;
}

/** @param extras  { client, protection, attestation, deviceKey, rosterStudentId, exemptionToken } */
export async function join(code, extras = {}) {
  S.code = code;
  S.phase = 'joining';
  bus.emit('joining');
  if (!ensure()) return fail('socket', 'socket');
  socket.emit('student-join', { sessionId: code, studentName: S.name, device: deviceName(), ...extras });
  clearTimeout(joinTimer);
  joinTimer = setTimeout(() => { if (S.phase === 'joining') fail('timeout', 'timeout'); }, 15000);
}

export function endSession() {
  if (S.phase === 'ended') return;
  const s = S.sess;
  let quiz = null;
  if (s && s.quizDone) {
    const ids = Object.keys(s.quizDone);
    if (ids.length) quiz = s.quizDone[ids[ids.length - 1]];
  }
  S.summary = {
    sessionName: s ? s.sessionName : '',
    minutes: s ? Math.max(1, Math.round((Date.now() - s.joinedAt) / 60000)) : 0,
    violations: s ? s.violations || 0 : 0,
    quiz,
  };
  S.phase = 'ended';
  S.locked = false;
  S.synced = true;
  clearTimeout(rejoinTimer);
  store.del(SESS_KEY);
  bus.emit('ended');
}

export function leave() {
  clearTimeout(rejoinTimer); clearTimeout(joinTimer);
  S.sess = null; S.phase = 'idle'; S.synced = false; S.quiz = null; S.materials = []; S.tool = null; S.summary = null; S.policy = null;
  persist();
  if (socket) socket.disconnect();
  bus.emit('conn');
}

/** Mijoz o'zini qulfdan chiqardi (15 daqiqa aloqa yo'q / taymer): qayta ulanganda serverga aytiladi. */
export function markAutoReleased() {
  if (!S.sess) return;
  S.sess.autoReleased = true; S.locked = false; S.sess.locked = false; persist();
  bus.emit('applied', { fresh: false });
}

// ---- Test javobini yuborish (offline bo'lsa navbatda turadi) ----
export function submitQuiz(quizId, answers) {
  if (!S.sess) return;
  S.sess.pending = { quizId, answers };
  persist();
  flushPending();
}
export function flushPending() {
  const p = S.sess && S.sess.pending;
  if (!p || !socket || !socket.connected || !S.synced) return;
  socket.emit('student-submit-quiz', { sessionId: S.sess.sessionId, studentId: S.sess.studentId, studentName: S.sess.name, quizId: p.quizId, answers: p.answers });
}

export function sendRating(score, comment) {
  const s = S.sess;
  if (!s) return false;
  return send('student-session-rating', { sessionId: s.sessionId, studentId: s.studentId, studentName: s.name, score, comment });
}

export function requestEmergencyExit(reason) {
  return send('student-emergency-exit-request', { reason });
}

window.addEventListener('online', () => { bus.emit('conn'); reconnectNow(); });
window.addEventListener('offline', () => bus.emit('conn'));
