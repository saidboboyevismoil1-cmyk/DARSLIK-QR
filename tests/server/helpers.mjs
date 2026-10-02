// Server testlari uchun yordamchilar: izolyatsiya qilingan server jarayoni, REST va socket.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { io as ioc } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

export async function startServer(env = {}) {
  const port = await freePort();
  const dataDir = env.DATA_DIR || mkdtempSync(path.join(tmpdir(), 'edufocus-test-'));
  let log = '';
  let child;
  const base = `http://localhost:${port}`;
  const launch = async () => {
    child = spawn('node', ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, EDUFOCUS_ENV_FILE: path.join(dataDir, 'none.env'), NODE_ENV: 'development',
        JWT_SECRET: 'test-secret-test-secret-test-secret', ENABLE_DEMO_TEACHER: 'true', ATTESTATION_MODE: 'mock', DEMO_ENABLED: 'true', ...env, DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) throw new Error("server to'xtadi:\n" + log);
      try { await fetch(base + '/api/lock/capabilities'); return; } catch { await sleep(150); }
    }
    throw new Error('server ishga tushmadi:\n' + log);
  };
  const kill = async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise((r) => { child.once('exit', r); setTimeout(r, 3000); }); } };
  await launch();
  return {
    base, port, dataDir, log: () => log,
    async restart() { await kill(); await launch(); },     // bir xil ma'lumotlar papkasi bilan qayta ishga tushirish
    async stop() { await kill(); rmSync(dataDir, { recursive: true, force: true }); },
  };
}

export function makeApi(base) {
  const api = async (method, url, body, token, raw = false) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (raw) return r;
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = { _text: text }; }
    return Object.assign(json, { _status: r.status });
  };
  return api;
}

export async function teacherLogin(api, email = 'teacher@edufocus.uz', password = '123456') {
  const r = await api('POST', '/api/login', { email, password });
  return { token: r.token, teacher: r.teacher };
}

/** Socket + hodisalarni yig'adigan yordamchi. */
export function connect(base, auth) {
  const socket = ioc(base, { auth, transports: ['websocket'], reconnection: false });
  const seen = [];
  const waiters = [];
  socket.onAny((event, ...args) => {
    seen.push({ event, data: args[0], t: Date.now() });
    for (const w of [...waiters]) if (w.event === event && (!w.pred || w.pred(args[0]))) { waiters.splice(waiters.indexOf(w), 1); w.resolve(args[0]); }
  });
  const waitFor = (event, pred, timeout = 5000) => {
    const hit = seen.find((s) => s.event === event && (!pred || pred(s.data)) && !s.consumed);
    if (hit) { hit.consumed = true; return Promise.resolve(hit.data); }
    return new Promise((resolve, reject) => {
      const w = { event, pred, resolve: (d) => { clearTimeout(tm); resolve(d); } };
      const tm = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`Kutilgan hodisa kelmadi: ${event} (${timeout} ms)`)); }, timeout);
      waiters.push(w);
    });
  };
  const opened = new Promise((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
  return { socket, seen, waitFor, opened, emit: (...a) => socket.emit(...a), close: () => socket.close(), has: (event, pred) => seen.some((s) => s.event === event && (!pred || pred(s.data))) };
}

export const APP = (level, extra = {}) => ({ type: 'app', platform: level.startsWith('ios') ? 'ios' : 'android', level, appVersion: '4.0.0', flavor: 'direct', brand: 'samsung', ...extra });
export const OK_PROTECTION = { active: true, reasons: [], checks: { pinned: true, accessibility: true, dnd: true, foreground: true } };
export const randKey = () => 'dk-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

/** Mock attestatsiya bilan qo'shilish ma'lumoti. */
export async function joinPayload(api, sessionId, name, level, extra = {}) {
  const { nonce } = await api('GET', `/api/lock/attest/challenge?sessionId=${sessionId}`);
  return { sessionId, studentName: name, device: 'Test', client: APP(level), protection: OK_PROTECTION, attestation: { nonce, token: `mock-ok:${nonce}` }, deviceKey: randKey(), ...extra };
}

export async function joinStudent(base, api, sessionId, name, level = 'android-full', extra = {}) {
  const c = connect(base);
  await c.opened;
  const payload = await joinPayload(api, sessionId, name, level, extra);
  c.emit('student-join', payload);
  const res = await Promise.race([c.waitFor('join-success'), c.waitFor('join-error').then((e) => { throw Object.assign(new Error(e.code || e.message), { data: e }); })]);
  return { c, res, studentId: res.studentId, payload };
}
