// Socket.io + sessiya hayot sikli: qo'shilish, avtomatik qayta ulanish (student-rejoin),
// test javobini navbatga qo'yish, dars tugashi.
import { S, bus } from './state.js';
import { store, native } from './util.js';

const SESS_KEY = 'ef_session';
const MAX_AGE = 12 * 3600 * 1000;
let socket = null;
let rejoinTimer = null;
let joinTimer = null;

export function deviceName() {
  const ua = navigator.userAgent;
  let d = 'Qurilma';
  if (/iPhone/.test(ua)) d = 'iPhone';
  else if (/iPad/.test(ua)) d = 'iPad';
  else if (/Android/.test(ua)) { const m = ua.match(/;\s*([^;)]+?)\s*(?:Build|\))/); d = m ? m[1].trim() : 'Android'; }
  else if (/Windows/.test(ua)) d = 'Windows PC';
  else if (/Mac/.test(ua)) d = 'Mac';
  else if (/Linux/.test(ua)) d = 'Linux';
  return native.present ? `${d} (ilova)` : d;
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

function setTiming(data) {
  const total = data.totalSeconds || (data.duration ? data.duration * 60 : 45 * 60);
  const remaining = data.remainingSeconds != null ? data.remainingSeconds : total;
  S.totalSec = total;
  S.endsAt = Date.now() + remaining * 1000;
  if (S.sess) { S.sess.totalSec = total; S.sess.endsAt = S.endsAt; }
}

function freshBase() {
  return { sessionId: S.code, name: S.name, joinedAt: Date.now(), violations: 0, quizDone: {}, quizStart: {}, draft: {}, pending: null, rated: 0, ratePrompted: false };
}

function apply(data, base, fresh) {
  S.sess = Object.assign({}, base, { studentId: data.studentId, sessionName: data.sessionName, subject: data.subject });
  S.locked = data.locked === true;
  S.sess.locked = S.locked;
  S.quiz = data.activeQuiz || null;
  S.materials = Array.isArray(data.materials) ? data.materials : [];
  S.tool = data.allowedTool || null;
  S.phase = 'joined';
  S.synced = true;
  setTiming(data);
  persist();
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

function rejoin() {
  if (!socket || !S.sess) return;
  clearTimeout(rejoinTimer);
  socket.emit('student-rejoin', { sessionId: S.sess.sessionId, studentId: S.sess.studentId });
  // Server noma'lum talaba uchun javob qaytarmaydi — kutish vaqti tugasa holatni tekshiramiz
  rejoinTimer = setTimeout(onRejoinFail, 6000);
}

async function onRejoinFail() {
  clearTimeout(rejoinTimer);
  if (!S.sess || S.phase !== 'joined') return;
  try {
    const r = await fetch(`/api/sessions/${S.sess.sessionId}`, { cache: 'no-store' });
    if (r.status === 404) return gone();
    const d = await r.json();
    if (d.status !== 'active') return endSession();
    // Dars faol, lekin talaba topilmadi — o'sha ism bilan qayta qo'shilamiz
    const base = Object.assign({}, S.sess);
    S.code = base.sessionId;
    socket.once('join-success', (data) => apply(data, base, false));
    socket.emit('student-join', { sessionId: base.sessionId, studentName: base.name, device: deviceName() });
  } catch { /* tarmoq yo'q — keyingi connect'da qayta uriniladi */ }
}

function gone() {
  S.sess = null; S.phase = 'idle'; S.synced = false; S.quiz = null; S.materials = []; S.tool = null;
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
  socket.on('join-error', (data) => { clearTimeout(joinTimer); fail((data && data.message) || "Qo'shilib bo'lmadi"); });

  socket.on('rejoin-success', (data) => {
    clearTimeout(rejoinTimer);
    apply(data, S.sess, false);
  });
  socket.on('rejoin-error', () => onRejoinFail());

  socket.on('session-unlocked', () => {
    S.locked = false; if (S.sess) S.sess.locked = false; persist(); bus.emit('applied', { fresh: false });
  });
  socket.on('session-locked', (data) => {
    S.locked = true; if (S.sess) S.sess.locked = true; if (data) setTiming(data); persist(); bus.emit('applied', { fresh: false });
  });
  socket.on('session-ended', () => endSession());

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

function fail(msg) { S.phase = 'idle'; bus.emit('join-fail', msg); }

export async function join(code) {
  S.code = code;
  S.phase = 'joining';
  bus.emit('joining');
  if (!ensure()) return fail('Ulanish moduli yuklanmadi. Sahifani yangilang.');
  try {
    const r = await fetch(`/api/sessions/${encodeURIComponent(code)}`, { cache: 'no-store' });
    if (r.status === 404) return fail('Sessiya topilmadi. Kodni tekshiring.');
    const info = await r.json();
    if (info.status !== 'active') return fail('Bu dars allaqachon tugagan.');
  } catch {
    return fail("Serverga ulanib bo'lmadi. Internetni tekshiring.");
  }
  socket.emit('student-join', { sessionId: code, studentName: S.name, device: deviceName() });
  clearTimeout(joinTimer);
  joinTimer = setTimeout(() => { if (S.phase === 'joining') fail("Ulanish vaqti tugadi. Qayta urinib ko'ring."); }, 12000);
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
  S.sess = null; S.phase = 'idle'; S.synced = false; S.quiz = null; S.materials = []; S.tool = null; S.summary = null;
  persist();
  if (socket) socket.disconnect();
  bus.emit('conn');
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

window.addEventListener('online', () => { bus.emit('conn'); reconnectNow(); });
window.addEventListener('offline', () => bus.emit('conn'));
