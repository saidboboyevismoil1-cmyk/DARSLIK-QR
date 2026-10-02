// Ustoz paneli soketi JWT bilan ishlaydi: o'z sessiyasini kuzata oladi, begonasini kuzata olmaydi.
import { chromium } from 'playwright';
import { io as ioc } from 'socket.io-client';
const BASE = process.argv[2] || 'http://localhost:3000';
const api = async (m, u, b, t) => (await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json();
const r = await api('POST', '/api/login', { email: 'teacher@edufocus.uz', password: '123456' });
const other = await api('POST', '/api/register', { name: 'B', surname: 'U', email: `o${Date.now()}@x.uz`, password: 'secret12' });
// panelga oddiy (admin bo'lmagan) ustoz kiradi; begona sessiya — admin'niki
const mine = (await api('POST', '/api/sessions', { name: 'Panel sinovi', duration: 30 }, other.token)).session;
const foreign = (await api('POST', '/api/sessions', { name: 'Begona', duration: 30 }, r.token)).session;
const b = await chromium.launch();
const page = await (await b.newContext()).newPage();
await page.goto(BASE + '/login.html');
await page.evaluate((r) => { localStorage.setItem('edufocus_token', r.token); localStorage.setItem('edufocus_teacher', JSON.stringify(r.teacher)); }, other);
await page.goto(BASE + '/dashboard-legacy.html');
await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected);
const out = await page.evaluate(async ({ mine, foreign }) => {
  const events = [];
  socket.on('auth-error', () => events.push('auth-error'));
  socket.on('student-joined', (d) => { window.__joined = d.student.name; });
  socket.emit('teacher-monitor', { sessionId: foreign });
  await new Promise((r) => setTimeout(r, 500));
  const foreignRejected = events.includes('auth-error');
  events.length = 0;
  socket.emit('teacher-monitor', { sessionId: mine });
  await new Promise((r) => setTimeout(r, 1500));
  return { foreignRejected, ownRejected: events.includes('auth-error'), events };
}, { mine: mine.id, foreign: foreign.id });
// talaba qo'shiladi → panel xabar oladi
const st = ioc(BASE, { transports: ['websocket'] });
await new Promise((res) => st.on('connect', res));
st.emit('student-join', { sessionId: mine.id, studentName: 'Panel Talaba' });
await new Promise((res) => st.on('join-success', res));
await new Promise((res) => setTimeout(res, 500));
const joined = await page.evaluate(() => window.__joined || null);
st.close(); await b.close();
console.log(JSON.stringify(out), 'joinedNow:', joined);
const ok = out.foreignRejected && !out.ownRejected && joined === 'Panel Talaba';
console.log(ok ? 'OK: panel soketi JWT bilan ishlaydi, begona sessiya rad etildi' : 'FAIL');
process.exit(ok ? 0 : 1);
