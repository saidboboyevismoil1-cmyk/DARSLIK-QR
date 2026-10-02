// Himoya qatlami (veb tomoni): daraja tanlash, ruxsatlar, tayyorlik tekshiruvi, qo'shilish ma'lumoti,
// dars davomidagi himoya va heartbeat. Native bo'lmasa (brauzer) — 'web' darajasi: sahifa ko'rinib turishi.
import { store } from './util.js';
import { S, bus } from './state.js';
import { native } from './native.js';
import * as net from './net.js';

export const STRONG = new Set(['ios-l1', 'ios-l2', 'android-full', 'android-lite']);
export const isStrong = (l) => STRONG.has(l);

export const P = {
  ready: false,
  info: null,            // native ma'lumoti (yoki null)
  server: { requiredLevels: [...STRONG], features: { iosL1: false, iosL2: false }, heartbeatIntervalSec: 10, offlineAfterSec: 30, releaseOfflineMinutes: 15, attestationMode: 'log' },
  perms: [],             // [{id, status, canRequest, guide}]
  confirmed: new Set(JSON.parse(localStorage.getItem('ef_perm_confirmed') || '[]')),   // "Men sozladim" (holatini tekshirib bo'lmaydigan ruxsatlar)
  level: 'web',
  lessonActive: false,
};

// ---------------------------------------------------------------- boshlash
function makeKey() {
  const a = new Uint8Array(24);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return 'dk-' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
let deviceKeyCache = '';
export async function deviceKey() {
  if (deviceKeyCache) return deviceKeyCache;
  if (native.present) {
    const r = await native.safe('deviceKey', {}, null);
    if (r && r.key && r.key.length >= 16) return (deviceKeyCache = r.key);
  }
  let k = store.get('ef_device_key');
  if (!k) { k = makeKey(); store.set('ef_device_key', k); }
  return (deviceKeyCache = k);
}

export async function init() {
  const [info, server] = await Promise.all([
    native.present ? native.safe('info', {}, null) : Promise.resolve(null),
    fetch('/api/lock/capabilities', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
  ]);
  P.info = info;
  if (server) P.server = { ...P.server, ...server };
  await refreshPermissions();
  P.level = chooseLevel();
  P.ready = true;
  native.on('protectionChanged', (st) => bus.emit('protection-changed', st));
  native.on('permissionChanged', async () => { await refreshPermissions(); bus.emit('permissions-changed'); });
  native.on('autoRelease', (d) => bus.emit('auto-release', d || {}));
  native.on('backPressed', () => bus.emit('native-back'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPermissions().then(() => bus.emit('permissions-changed')); });
}

export async function refreshPermissions() {
  if (!native.present) { P.perms = []; return P.perms; }
  const list = await native.safe('permissions', {}, []);
  P.perms = Array.isArray(list) ? list : [];
  P.level = chooseLevel();
  return P.perms;
}

// ---------------------------------------------------------------- daraja tanlash
const statusOf = (id) => {
  const p = P.perms.find((x) => x.id === id);
  if (!p) return 'na';
  if (p.status === 'unknown' && P.confirmed.has(id)) return 'granted';
  return p.status;
};
export const permStatus = statusOf;

/** Ruxsatlar bo'yicha erishish mumkin bo'lgan eng kuchli daraja. */
export function chooseLevel() {
  if (!native.present || !P.info) return 'web';
  const cand = (P.info.candidates || []).filter((l) => (l !== 'ios-l1' || (P.server.features.iosL1 && P.info.features && P.info.features.iosL1)) && (l !== 'ios-l2' || (P.server.features.iosL2 && P.info.features && P.info.features.iosL2)));
  for (const l of cand) {
    const need = (P.info.requires && P.info.requires[l]) || [];
    if (need.every((id) => statusOf(id) === 'granted')) return l;
  }
  return P.info.platform === 'ios' ? 'ios-l0' : 'android-l0';
}

/** Eng yaxshi daraja uchun hali yetishmayotgan ruxsatlar (foydalanuvchiga ko'rsatiladi). */
export function missingForBest() {
  if (!native.present || !P.info) return [];
  const cand = (P.info.candidates || []).filter((l) => isStrong(l) && (l !== 'ios-l1' || (P.server.features.iosL1 && P.info.features && P.info.features.iosL1)) && (l !== 'ios-l2' || (P.server.features.iosL2 && P.info.features && P.info.features.iosL2)));
  if (!cand.length) return [];
  let best = null;
  for (const l of cand) {
    const miss = ((P.info.requires && P.info.requires[l]) || []).filter((id) => statusOf(id) !== 'granted');
    if (!miss.length) return [];
    if (!best || miss.length < best.length) best = miss;
  }
  return best || [];
}

export async function requestPermission(id) {
  const r = await native.safe('requestPermission', { id }, null, 120000);
  await refreshPermissions();
  bus.emit('permissions-changed');
  return r;
}
export const openSettings = (id) => native.safe('openSettings', { id }, null);
export function confirmManual(id) {
  P.confirmed.add(id);
  store.set('ef_perm_confirmed', [...P.confirmed]);
  P.level = chooseLevel();
  bus.emit('permissions-changed');
}

export function requiredFor(sessionInfo) {
  return !!(sessionInfo && (sessionInfo.requiresApp || sessionInfo.protection === 'required') && !sessionInfo.demo);
}

// ---------------------------------------------------------------- tayyorlik tekshiruvi
/** @returns {Promise<{level, items:[{id, ok, detail?}], ok}>} ok = majburiy darsga kirish mumkin */
export async function readiness({ dry = true } = {}) {
  const items = [];
  // 1) server
  const t0 = Date.now();
  const serverOk = await fetch('/api/lock/capabilities', { cache: 'no-store' }).then((r) => r.ok).catch(() => false);
  items.push({ id: 'server', ok: serverOk, detail: serverOk ? `${Date.now() - t0} ms` : '' });
  await refreshPermissions();
  const level = chooseLevel();
  const miss = missingForBest();
  // 2) ruxsatlar
  if (native.present) items.push({ id: 'permissions', ok: miss.length === 0, detail: miss.join(',') });
  // 3) himoya sinovi (qisqa)
  if (native.present && isStrong(level) && dry) {
    const r = await native.safe('protection.dryRun', { level }, null, 60000);
    items.push({ id: 'protection', ok: !!(r && r.ok), detail: (r && r.reason) || '' });
  } else if (!native.present) {
    items.push({ id: 'protection', ok: false, detail: 'browser' });
  }
  // 4) attestatsiya
  if (native.present && P.server.attestationMode !== 'off') {
    const ch = await fetch('/api/lock/attest/challenge', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    const a = ch && (await native.safe('attest', { nonce: ch.nonce }, null, 30000));
    // 'enforce' rejimida token majburiy; 'log' rejimida server rad etmaydi — natija ma'lumot uchun
    items.push({ id: 'attestation', ok: !!(a && a.token) || P.server.attestationMode !== 'enforce', detail: (a && a.error) || '' });
  }
  const required = P.server.requiredLevels || [];
  const ok = serverOk && native.present && required.includes(level) && items.every((i) => i.ok);
  const res = { level, items, ok, at: Date.now() };
  store.set('ef_ready', { level, ok, at: res.at });
  return res;
}
export const lastReadiness = () => store.get('ef_ready', null);

// ---------------------------------------------------------------- qo'shilish ma'lumoti
async function attestation(sessionId) {
  const ch = await fetch(`/api/lock/attest/challenge?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  if (!ch || !ch.nonce) return null;
  if (!native.present) return { nonce: ch.nonce, token: '' };
  const a = await native.safe('attest', { nonce: ch.nonce }, null, 30000);
  return { nonce: ch.nonce, token: (a && a.token) || '', keyId: (a && a.keyId) || undefined };
}

export function clientInfo(level = P.level) {
  const i = P.info || {};
  return { type: native.present ? 'app' : 'web', platform: native.present ? i.platform || native.platform : 'web', level, flavor: i.flavor || '', appVersion: i.appVersion || '', brand: i.brand || '', osVersion: i.osVersion || '' };
}

/** Joriy himoya holati (heartbeat va qo'shilish uchun). */
export async function currentState() {
  const level = P.level;
  if (native.present && isStrong(level) && P.lessonActive) {
    const st = await native.safe('protection.state', {}, null, 4000);
    if (st) return { active: !!st.active, reasons: st.reasons || [], checks: st.checks || {}, fg: st.fg !== false, level: st.level || level };
    return { active: false, reasons: ['unknown'], checks: {}, fg: !document.hidden, level };
  }
  const fg = !document.hidden;
  return { active: fg, reasons: fg ? [] : ['background'], checks: { foreground: fg }, fg, level };
}

/** Himoya majburiy darsga qo'shilishdan oldin himoyani yoqish. */
export async function prepareJoin(sessionInfo) {
  const level = P.level;
  if (requiredFor(sessionInfo) && native.present && isStrong(level)) {
    const r = await startLesson({ level, preJoin: true });
    if (!r.ok) return { ok: false, reason: r.reason || 'protection_failed' };
  }
  return { ok: true };
}

export async function joinExtras(sessionInfo) {
  const level = P.level;
  const [key, att, st] = await Promise.all([deviceKey(), sessionInfo.demo ? Promise.resolve(null) : attestation(sessionInfo.id), currentState()]);
  const base = { client: clientInfo(level), protection: { active: st.active, reasons: st.reasons, checks: st.checks }, deviceKey: key };
  if (att) base.attestation = att;
  return base;
}

// ---------------------------------------------------------------- dars davomidagi himoya
export async function startLesson({ level = P.level, endsInSec, preJoin = false } = {}) {
  if (!native.present || !isStrong(level)) { P.lessonActive = false; return { ok: true, local: true }; }
  if (P.lessonActive) return { ok: true };
  try {
    const r = await native.invoke('protection.start', { level, endsInSec: endsInSec || 0, offlineReleaseSec: ((S.policy && S.policy.releaseOfflineMinutes) || P.server.releaseOfflineMinutes || 15) * 60, preJoin }, 90000);
    P.lessonActive = !!(r && r.ok);
    return r || { ok: false, reason: 'no_reply' };
  } catch (e) { return { ok: false, reason: e.code || 'error' }; }
}

/** Himoya qo'shilishdan oldin yoqilgan bo'lsa, dars siyosati (taymer, aloqa uzilish muddati) ma'lum bo'lgach yangilanadi. */
export function updateLesson() {
  if (!native.present || !P.lessonActive) return;
  const rem = Math.max(0, Math.round((S.endsAt - Date.now()) / 1000));
  native.fire('protection.update', { endsInSec: rem, offlineReleaseSec: ((S.policy && S.policy.releaseOfflineMinutes) || P.server.releaseOfflineMinutes || 15) * 60 });
}

export async function stopLesson(reason = 'teacher') {
  if (!P.lessonActive) return;
  P.lessonActive = false;
  await native.safe('protection.stop', { reason }, null, 15000);
}

export async function serverContact(remainingSeconds) {
  if (native.present && P.lessonActive) native.fire('serverContact', { remainingSeconds: remainingSeconds ?? null });
}

export async function sos(number) {
  net.send('student-protection-event', { sessionId: S.sess && S.sess.sessionId, studentId: S.sess && S.sess.studentId, type: 'sos' });
  if (native.present) return native.safe('sos', { number: number || '112' }, null, 15000);
  location.href = `tel:${number || '112'}`;
  return null;
}

// ---------------------------------------------------------------- heartbeat
let hbTimer = null;
let hbBusy = false;
let seqN = 0;
export async function beat() {
  if (hbBusy || S.phase !== 'joined' || !S.sess) return;
  hbBusy = true;
  try {
    const st = await currentState();
    net.send('student-heartbeat', { sessionId: S.sess.sessionId, studentId: S.sess.studentId, seq: ++seqN, fg: st.fg, level: st.level, protection: { active: st.active, reasons: st.reasons, checks: st.checks } });
    bus.emit('protection-state', st);
  } finally { hbBusy = false; }
}
export function startHeartbeat() {
  stopHeartbeat();
  const sec = Math.max(5, Number(S.policy && S.policy.heartbeatIntervalSec) || P.server.heartbeatIntervalSec || 10);
  hbTimer = setInterval(beat, sec * 1000);
  beat();
}
export function stopHeartbeat() { clearInterval(hbTimer); hbTimer = null; }

bus.on('protection-changed', () => beat());
document.addEventListener('visibilitychange', () => { if (S.phase === 'joined') beat(); });
bus.on('heartbeat-ack', (ack) => {
  if (ack && typeof ack.remainingSeconds === 'number') {
    S.endsAt = Date.now() + ack.remainingSeconds * 1000;           // taymer server bilan sinxronlanadi
    serverContact(ack.remainingSeconds);
  }
});
