// API mijozi: JWT + refresh token (rotatsiya), oflayn navbat (xavfsiz amallar uchun), socket.
import { store } from './util.js';

const K = { token: 'ef_t_token', refresh: 'ef_t_refresh', teacher: 'ef_t_teacher', remember: 'ef_t_remember', queue: 'ef_t_queue' };
let mem = { token: null, refresh: null, teacher: null };      // "Meni eslab qol" o'chiq bo'lsa — faqat xotirada (sessionStorage)
const stg = () => (store.get(K.remember, true) ? localStorage : sessionStorage);
const rd = (k) => { try { return stg().getItem(k); } catch { return null; } };
const wr = (k, v) => { try { v == null ? stg().removeItem(k) : stg().setItem(k, v); } catch { /* */ } };
const listeners = new Set();
export const onAuth = (fn) => listeners.add(fn);
const emitAuth = () => listeners.forEach((f) => { try { f(); } catch { /* */ } });

export const session = {
  get token() { return rd(K.token); },
  get refresh() { return rd(K.refresh); },
  get teacher() { try { return JSON.parse(rd(K.teacher) || 'null'); } catch { return null; } },
  set(data, remember) {
    if (remember !== undefined) { store.set(K.remember, !!remember); }
    wr(K.token, data.token); wr(K.refresh, data.refreshToken);
    if (data.teacher) wr(K.teacher, JSON.stringify(data.teacher));
    emitAuth();
  },
  setTeacher(t) { wr(K.teacher, JSON.stringify(t)); },
  clear() { [K.token, K.refresh, K.teacher].forEach((k) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* */ } }); emitAuth(); },
  get loggedIn() { return !!(this.token || this.refresh); },
};

function expMs(token) { try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch { return 0; } }

let refreshing = null;
/** Refresh token bilan yangi access token oladi (bir vaqtda faqat bitta so'rov). */
export function refreshNow() {
  if (refreshing) return refreshing;
  const rt = session.refresh;
  if (!rt) return Promise.resolve(false);
  refreshing = fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) })
    .then(async (r) => {
      if (r.status === 401) { session.clear(); return false; }       // refresh yaroqsiz → qayta kirish
      if (!r.ok) return false;                                         // server vaqtincha xato — seansni saqlaymiz
      session.set(await r.json()); return true;
    })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function ensureFresh() {
  const tk = session.token;
  if (!tk) return session.refresh ? refreshNow() : false;
  if (expMs(tk) - Date.now() < 60000) await refreshNow();           // muddati tugashiga 1 daqiqa qolsa — oldindan yangilaymiz
  return true;
}

export class ApiError extends Error { constructor(msg, status, data) { super(msg); this.status = status; this.data = data || {}; this.code = (data && data.code) || ''; } }

async function raw(method, path, body, retry = true) {
  await ensureFresh();
  const headers = {};
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (session.token) headers.Authorization = 'Bearer ' + session.token;
  const r = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : (body instanceof FormData ? body : JSON.stringify(body)) });
  if (r.status === 401 && retry && session.refresh && !path.startsWith('/auth/')) {
    if (await refreshNow()) return raw(method, path, body, false);
  }
  return r;
}

export async function api(method, path, body) {
  const r = await raw(method, path, body);
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) {
    if (r.status === 401 && !path.startsWith('/login') && !path.startsWith('/auth/')) { session.clear(); }
    throw new ApiError(data.error || 'error', r.status, data);
  }
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b === undefined ? {} : b);

/** Fayl (CSV, hisobot) yuklab olish — token bilan. */
export async function download(path, filename) {
  const r = await raw('GET', path);
  if (!r.ok) throw new ApiError('download', r.status);
  const blob = await r.blob(); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------------------------------------------------------------- oflayn navbat
// Faqat takrorlansa zarari yo'q amallar: ruxsat/qulf, so'rov qarori, darsni tugatish. Internet bo'lmasa saqlanadi va tiklanganda yuboriladi.
const queue = () => store.get(K.queue, []);
const setQueue = (q) => store.set(K.queue, q);
export const queued = () => queue().length;
const isNetErr = (e) => !(e instanceof ApiError);
export async function act(method, path, body) {
  if (!navigator.onLine) { setQueue([...queue(), { method, path, body, at: Date.now() }]); notifyQueue(); return { queued: true }; }
  try { return await api(method, path, body); }
  catch (e) {
    if (isNetErr(e)) { setQueue([...queue(), { method, path, body, at: Date.now() }]); notifyQueue(); return { queued: true }; }
    throw e;
  }
}
let queueCb = () => {};
export const onQueue = (fn) => { queueCb = fn; };
const notifyQueue = () => queueCb(queued());
let flushing = false;
export async function flushQueue() {
  if (flushing || !queue().length || !navigator.onLine) return 0;
  flushing = true; let n = 0;
  try {
    for (;;) {
      const q = queue(); if (!q.length) break;
      const it = q[0];
      try { await api(it.method, it.path, it.body); } catch (e) { if (isNetErr(e)) break; /* serverdan rad etildi (masalan, dars tugagan) — tashlab yuboramiz */ }
      setQueue(queue().slice(1)); n++;
    }
  } finally { flushing = false; notifyQueue(); }
  return n;
}
window.addEventListener('online', () => flushQueue().then((n) => { if (n) queueCb(queued(), n); }));

// ---------------------------------------------------------------- socket
let sock = null;
export function socket() {
  if (sock) return sock;
  // eslint-disable-next-line no-undef
  sock = io({ auth: (cb) => cb({ token: session.token }), reconnection: true });
  sock.on('connect_error', () => { refreshNow(); });                // token eskirgan bo'lishi mumkin
  return sock;
}
export function closeSocket() { if (sock) { sock.close(); sock = null; } }
