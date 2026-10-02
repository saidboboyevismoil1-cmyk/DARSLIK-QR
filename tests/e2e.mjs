// EduFocus talaba ilovasi — to'liq oqim (ustoz tomoni REST orqali simulyatsiya qilinadi)
// Ishga tushirish: node tests/e2e.mjs [iphone|android] [BASE_URL]
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = (process.argv[2] || 'iphone').toLowerCase();
const BASE = process.argv[3] || process.env.BASE_URL || 'http://localhost:3000';
const cfg = target === 'android'
  ? { engine: chromium, device: devices['Pixel 7'] }
  : { engine: webkit, device: devices['iPhone 15'] };
const outDir = path.join(here, 'screenshots', target);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

let n = 0, failed = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { failed++; console.error('  ✗ FAIL:', msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Ustoz (REST) ----------
const api = async (method, url, body, token) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const teacher = await api('POST', '/api/login', { email: 'teacher@edufocus.uz', password: '123456' });
const T = teacher.token;
ok(!!T, 'ustoz tizimga kirdi');
const created = await api('POST', '/api/sessions', { name: 'Algebra: kvadrat tenglamalar', subject: 'Matematika', duration: 40 }, T);
const code = created.session.id;
ok(/^\d{6}$/.test(code), `sessiya yaratildi: ${code}`);

// Test PDF (3 sahifa) — sodda, qo'lda yig'ilgan
function makePdf() {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>');
  const page = (c, f) => { add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${f} 0 R >> >> >>`); };
  const stream = (t) => `<< /Length ${t.length} >>\nstream\n${t}\nendstream`;
  page(4, 9); add(stream('BT /F1 40 Tf 100 700 Td (Slayd 1: Kirish) Tj ET'));
  page(6, 9); add(stream('BT /F1 40 Tf 100 700 Td (Slayd 2: Formula) Tj ET'));
  page(8, 9); add(stream('BT /F1 40 Tf 100 700 Td (Slayd 3: Xulosa) Tj ET'));
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

const browser = await cfg.engine.launch();
const ctx = await browser.newContext({ ...cfg.device, locale: 'uz-UZ', permissions: [] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });

const shot = async (name) => { n++; await sleep(450); await page.screenshot({ path: path.join(outDir, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const active = () => page.evaluate(() => document.querySelector('.screen.active')?.id);
const waitScreen = async (id, t = 8000) => { await page.waitForFunction((i) => document.querySelector('.screen.active')?.id === i, id, { timeout: t }); };

// ---------- 1. Onboarding ----------
const t0 = Date.now();
await page.goto(BASE + '/student.html');
await waitScreen('s-consent');
console.log(`[rozilik] ochilish: ${Date.now() - t0} ms`);
await shot('rozilik');
await page.click('[data-act=consent-accept]');
await waitScreen('s-onboard');
await shot('onboarding-1');
await page.click('#onb-next'); await sleep(600);
await page.click('#onb-next'); await sleep(600);
await shot('onboarding-3');
ok((await page.textContent('#onb-next')).includes('Boshlash'), 'oxirgi slaydda "Boshlash" ko\'rinadi');
await page.click('#onb-next');
await waitScreen('s-name');
await shot('ism');
await page.fill('#name-input', 'Jasur Karimov');
await page.click('#name-form button[type=submit]');
await waitScreen('s-home');
ok((await page.textContent('#home-name')) === 'Jasur Karimov', 'ism saqlandi');
await shot('bosh-sahifa');

// Noto'g'ri kod
await page.fill('#code-input', '000000');
await page.waitForFunction(() => document.querySelector('#code-err').textContent.length > 0);
ok((await page.textContent('#code-err')).includes('topilmadi'), "noto'g'ri kodda xato ko'rsatildi");
await shot('xato-kod');

// ---------- 2. Qo'shilish ----------
await page.fill('#code-input', '');
await page.fill('#code-input', code);
await waitScreen('s-lesson');
ok(true, 'qulflangan dars ekraniga o\'tdi');
await shot('dars-rejimi');
const students = async () => (await api('GET', '/api/sessions', null, T)).find((s) => s.id === code).students;
ok((await students()).length === 1, 'ustoz ro\'yxatida 1 ta talaba');

// ---------- 3. Test ----------
const pack = await api('POST', '/api/testpacks', { title: 'Tezkor test', subject: 'Matematika', timeLimit: 3, questions: [
  { id: 'q1', text: 'x² = 9 tenglamaning ildizlari?', options: ['3', '-3', '±3', 'Ildiz yo\'q'], correctIndex: 2 },
  { id: 'q2', text: '2 + 2 × 2 = ?', options: ['6', '8', '4', '2'], correctIndex: 0 },
  { id: 'q3', text: '<b>HTML</b> xavfsiz ko\'rsatiladimi?', options: ['Ha', 'Yo\'q'], correctIndex: 1 },
] }, T);
await api('POST', `/api/testpacks/${pack.testpack?.id || pack.id}/broadcast`, { sessionId: code }, T);
await waitScreen('s-quiz');
ok(!(await page.$('#quiz-body b')), 'savol matnidagi HTML escape qilindi');
await shot('test-savollar');
await page.click('#quiz-submit'); await sleep(300);
ok((await active()) === 's-quiz', 'javobsiz topshirib bo\'lmaydi');
const cards = await page.$$('#quiz-body .q-card');
const picks = [2, 0, 1];
for (let i = 0; i < cards.length; i++) await (await cards[i].$$('.opt'))[picks[i]].click();
await shot('test-javoblangan');
await page.click('#quiz-submit');
await page.waitForSelector('#quiz-result:not([hidden])');
ok((await page.textContent('#quiz-result')).includes('3 / 3'), 'natija 3 / 3');
await shot('test-natija');
await page.click('#quiz-result [data-act=back]');
await waitScreen('s-lesson');

// ---------- 4. Material ----------
const fd = new FormData(); fd.append('file', new Blob([makePdf()], { type: 'application/pdf' }), 'slaydlar.pdf');
const up = await (await fetch(BASE + '/api/upload-material', { method: 'POST', headers: { Authorization: 'Bearer ' + T }, body: fd })).json();
ok(up.success, 'PDF yuklandi');
await api('POST', `/api/sessions/${code}/materials`, { title: 'Kvadrat tenglama slaydlari', text: 'Slaydlarni diqqat bilan o\'qing', fileUrl: up.file.url, fileName: up.file.name, fileSize: up.file.size, fileType: 'pdf' }, T);
await waitScreen('s-viewer');
await page.waitForSelector('#v-canvas');
await page.waitForFunction(() => document.querySelector('#v-spin').hidden);
ok((await page.textContent('#v-page')).trim() === '1 / 3', 'PDF 3 sahifa, 1-sahifa ochiq');
await shot('pdf-slayd-1');
await page.click('[data-act=pdf-next]');
await page.waitForFunction(() => document.querySelector('#v-page').textContent.trim() === '2 / 3');
await shot('pdf-slayd-2');
await page.click('#s-viewer [data-act=back]');
await waitScreen('s-lesson');
await page.click('#lesson-tiles [data-act=open-mats]');
await waitScreen('s-mats');
ok((await page.$$('#mats-list .item')).length === 1, 'materiallar ro\'yxatida 1 ta fayl');
await shot('materiallar');
await page.click('#s-mats [data-act=back]');

// ---------- 5. Kalkulyator ----------
await api('POST', `/api/sessions/${code}/app-control`, { tool: 'calculator', action: 'open', appName: 'Kalkulyator' }, T);
await page.waitForSelector('#o-calc.open');
for (const k of ['1', '2', '×', '3', '=']) await page.click(`#calc-grid [data-k="${k}"]`);
ok((await page.textContent('#calc-out')) === '36', 'kalkulyator 12×3 = 36');
await shot('kalkulyator');
await api('POST', `/api/sessions/${code}/app-control`, { tool: 'calculator', action: 'close' }, T);
await page.waitForFunction(() => !document.querySelector('#o-calc').classList.contains('open'));

// ---------- 6. Qulfni ochish / qulflash ----------
await api('POST', `/api/sessions/${code}/unlock`, null, T);
await waitScreen('s-wait');
await shot('kutish-qulf-ochiq');
await api('POST', `/api/sessions/${code}/lock`, null, T);
await waitScreen('s-lesson');

// ---------- 7. Internet uzilishi ----------
await ctx.setOffline(true);
await page.waitForSelector('#o-conn.open', { timeout: 8000 });
ok(true, 'offline: "Aloqa uzildi" oynasi chiqdi');
await shot('aloqa-uzildi');
await ctx.setOffline(false);
await page.waitForFunction(() => !document.querySelector('#o-conn').classList.contains('open'), null, { timeout: 15000 });
ok(true, 'internet qaytgach avtomatik qayta ulandi');
ok((await students()).filter((s) => s.isActive).length === 1, 'ustozda talaba yana faol');

// ---------- 8. Sahifani qayta yuklash ----------
await page.reload();
await waitScreen('s-lesson');
await sleep(800);
const st = await students();
ok(st.length === 1, `qayta yuklangach talaba takrorlanmadi (${st.length} ta)`);
ok((await page.textContent('#lesson-name')).includes('Algebra'), 'sessiya qayta tiklandi');

// ---------- 9. Dars tugashi ----------
await api('POST', `/api/sessions/${code}/end`, null, T);
await waitScreen('s-ended');
await page.waitForSelector('#o-rate.open');
await shot('tugadi-baholash');
await page.click('#rate-stars .star:nth-child(4)');
await page.fill('#rate-comment', 'Juda foydali dars bo\'ldi');
await page.click('[data-act=rate-send]');
await page.waitForFunction(() => document.querySelector('#end-rate').textContent.includes('4'));
const ses = (await api('GET', '/api/sessions', null, T)).find((s) => s.id === code);
ok(ses.ratings?.[0]?.score === 4, 'baho ustozga yetib bordi');
ok(ses.students[0].quizScore?.startsWith('3/3'), 'test natijasi ustozda');
await shot('tugadi');
await page.click('#s-ended [data-act=home]');
await waitScreen('s-home');

// ---------- 10. Profil va qorong'i rejim ----------
await page.click('[data-act=go-profile]');
await waitScreen('s-profile');
await page.click('[data-act=theme-set][data-v=dark]');
await shot('profil-qorongi');
await page.click('#s-profile [data-act=back]');
await waitScreen('s-home');
await shot('bosh-qorongi');


// ---------- 11. Dars tugashi oflayn paytda (rejoin → "tugagan") ----------
const c2 = await api('POST', '/api/sessions', { name: 'Fizika', subject: 'Fizika', duration: 30 }, T);
const code2 = c2.session.id;
await page.fill('#code-input', code2);
await waitScreen('s-lesson');
await ctx.setOffline(true);
await page.waitForSelector('#o-conn.open', { timeout: 8000 });
await api('POST', `/api/sessions/${code2}/end`, null, T);
await ctx.setOffline(false);
await waitScreen('s-ended', 20000);
ok(true, 'oflayn paytda dars tugasa, qaytgach "Dars yakunlandi" ochiladi');
await page.click('[data-act=rate-close]').catch(() => {});
await page.click('#s-ended [data-act=home]');
await waitScreen('s-home');

// ---------- 12. Service worker: oflayn ochilish ----------
await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
await page.reload(); await sleep(1200);       // SW sahifani boshqarishi uchun
const swCtl = await page.evaluate(() => !!navigator.serviceWorker.controller);
ok(swCtl, 'service worker sahifani boshqaryapti');
const cached = await page.evaluate(async () => {
  const names = ['/student.html', '/css/student.css?v=5.0', '/js/student/app.js?v=5.0', '/js/student/net.js', '/socket.io/socket.io.js'];
  const res = await Promise.all(names.map((n) => caches.match(n, { ignoreSearch: n === '/student.html' })));
  return res.every(Boolean);
});
ok(cached, 'shell fayllari service worker keshida');
const lazy = await page.evaluate(async () => !!(await caches.match('/js/pdf.min.js')));
ok(lazy, 'pdf.js faqat ishlatilgandan keyin keshlandi (lazy)');
if (target === 'android') {   // Playwright WebKit SW + offline reload'ni qo'llamaydi
  await ctx.setOffline(true);
  await page.reload();
  await waitScreen('s-home');
  ok(true, "internet yo'q holatda ilova keshdan ochildi");
  await ctx.setOffline(false);
}

ok(errors.length === 0, 'konsolda xato yo\'q' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(failed ? `\n${failed} ta tekshiruv muvaffaqiyatsiz` : '\nBarcha tekshiruvlar o\'tdi');
process.exit(failed ? 1 : 0);
