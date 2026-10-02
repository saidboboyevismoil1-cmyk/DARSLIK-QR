// Ustoz paneli o'zgarmaganini tekshiradi: kirish → dashboard ochiladi, konsolda xato yo'q, sessiya yaratiladi.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:3000';
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errs.push(m.text()); });
const r = await (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'teacher@edufocus.uz', password: '123456' }) })).json();
await page.goto(BASE + '/login.html');
await page.evaluate((r) => { for (const k of ['token', 'edufocus_token']) localStorage.setItem(k, r.token); localStorage.setItem('teacher', JSON.stringify(r.teacher || {})); localStorage.setItem('edufocus_teacher', JSON.stringify(r.teacher || {})); }, r);
await page.goto(BASE + '/dashboard.html');
await page.waitForTimeout(2500);
const url = page.url();
console.log('url:', url);
await page.screenshot({ path: 'tests/screenshots/dashboard.png' });
console.log(errs.length ? 'XATOLAR: ' + errs.join(' | ') : 'konsolda xato yo\'q');
await b.close();
process.exit(url.includes('dashboard') && !errs.length ? 0 : 1);
