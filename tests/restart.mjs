// Server qayta ishga tushganda talaba sessiyaga avtomatik qaytishini tekshiradi.
// Diqqat: serverni to'xtatib, o'zi qayta ishga tushiradi (PORT=3000).
import { chromium, devices } from 'playwright';
import { spawn, execSync } from 'node:child_process';
const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (m, u, b, t) => (await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json();
const startServer = async () => { const p = spawn('node', ['server.js'], { stdio: 'ignore', detached: true }); p.unref(); for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/student.html'); return; } catch { await sleep(250); } } throw new Error('server ishga tushmadi'); };

const T = (await api('POST', '/api/login', { email: 'teacher@edufocus.uz', password: '123456' })).token;
const code = (await api('POST', '/api/sessions', { name: 'Restart sinovi', duration: 30 }, T)).session.id;
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
await ctx.addInitScript(() => { try { if (!localStorage.getItem('ef_name')) { localStorage.setItem('ef_onboarded', 'true'); localStorage.setItem('ef_name', '"Vali"'); } } catch {} });
const page = await ctx.newPage();
await page.goto(BASE + '/student.html?session=' + code);
await page.waitForFunction(() => document.querySelector('.screen.active')?.id === 's-lesson');
console.log('  ✓ talaba darsda');
execSync("pkill -f 'node server.js' || true"); await sleep(1500);
await page.waitForSelector('#o-conn.open', { timeout: 8000 });
console.log("  ✓ server o'chdi → \"Aloqa uzildi\" ko'rsatildi");
await startServer();
await page.waitForFunction(() => !document.querySelector('#o-conn').classList.contains('open'), null, { timeout: 20000 });
await sleep(500);
const login2 = (await api('POST', '/api/login', { email: 'teacher@edufocus.uz', password: '123456' })).token;
const s = (await api('GET', '/api/sessions', null, login2)).find((x) => x.id === code);
const good = s && s.students.length === 1 && s.students[0].isActive;
console.log(good ? "  ✓ server qayta ishga tushdi, talaba avtomatik qaytdi (takrorlanmadi)" : '  ✗ FAIL: ' + JSON.stringify(s && s.students));
await browser.close();
process.exit(good ? 0 : 1);
