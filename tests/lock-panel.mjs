// "Dars rejimi" paneli: sessiya tanlash, QR proyektor, istisnolar jadvali, ruxsat berish, guruh CSV, admin bo'limi.
import { chromium } from 'playwright';
import { io } from 'socket.io-client';
const BASE = process.argv[2] || 'http://localhost:3000';
const j = (p, o = {}, t) => fetch(BASE + '/api' + p, { ...o, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined }).then((r) => r.json());
const login = await j('/login', { method: 'POST', body: { email: 'teacher@edufocus.uz', password: '123456' } });
const T = login.token;
const sess = await j('/sessions', { method: 'POST', body: { name: 'Panel test', protection: 'optional' } }, T);
const sid = sess.session ? sess.session.id : sess.id;
// talaba qo'shilsin (himoyasiz web)
const s = io(BASE); await new Promise((r) => s.on('connect', r));
s.emit('student-join', { sessionId: sid, studentName: 'Test Talaba', device: 'x', deviceKey: 'k'.repeat(24), client: { type: 'web', platform: 'web', level: 'web' } });
await new Promise((r) => s.once('join-success', r));

const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } }); const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
await page.goto(BASE + '/login.html');
await page.evaluate((r) => { localStorage.setItem('edufocus_token', r.token); localStorage.setItem('edufocus_teacher', JSON.stringify(r.teacher)); }, login);
await page.goto(BASE + '/lock.html');
const ok = (c, m) => { if (!c) { console.log('✗', m); process.exitCode = 1; } else console.log('✓', m); };
await page.waitForSelector('#liveBody:not(.hidden)');
await page.selectOption('#sess', sid);
await page.waitForFunction(() => document.querySelector('#sum') && document.querySelector('#sum').textContent.includes('Jami'));
ok(/1\s*Jami/.test(await page.textContent('#sum')), 'jami 1 talaba');
await page.uncheck('#onlyEx');
ok((await page.textContent('#rows')).includes('Test Talaba'), 'talaba jadvalda');
await page.click('#btnProj'); ok(await page.isVisible('#projector'), 'QR proyektor ochildi'); await page.click('#projector');
await page.click('#btnRelock'); await page.waitForTimeout(400);
await page.click('#btnRelease'); await page.waitForTimeout(600);
ok((await page.textContent('#locked')).includes('Ruxsat berilgan'), "hammaga ruxsat → 'Ruxsat berilgan'");
await page.click('[data-tab=rosters]');
await page.fill('#gName', 'Test guruh'); await page.fill('#gCsv', 'Ali Valiyev,1001\nMadina Karimova,1002'); await page.click('#gSave');
await page.waitForFunction(() => document.querySelector('#gMsg').textContent.includes('2 ta'));
ok(true, 'guruh CSV saqlandi'); await page.waitForFunction(() => document.querySelector('#groups').textContent.includes('Madina'), null, { timeout: 5000 }).catch(() => {}); ok((await page.textContent('#groups')).includes('Madina Karimova'), 'guruh ro\'yxati ko\'rinadi');
await page.click('[data-tab=admin]'); await page.waitForSelector('#settings input');
ok((await page.$$('#settings input')).length > 8, 'admin sozlamalari');
await page.waitForFunction(() => document.querySelector('#wkOut').textContent.includes('Hafta') || document.querySelector('#wkOut').textContent.includes('darslar'));
ok(true, 'haftalik hisobot');
await page.screenshot({ path: 'tests/screenshots/lock-panel.png', fullPage: true });
ok(!errs.length, 'konsolda xato yo\'q' + (errs.length ? ': ' + errs.join(' | ') : ''));
// tozalash
await j('/sessions/' + sid + '/end', { method: 'POST', body: {} }, T);
s.close(); await b.close();
