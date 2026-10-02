// O'qituvchi web paneli: asosiy oqim (desktop va telefon o'lchamida) + foydalanish qulayligi o'lchovi + skrinshotlar.
// kirish → guruh (CSV) → test (4 tur) → material → darsni boshlash → talaba qo'shilishi → so'rovni tasdiqlash → test yuborish → hammani ochish → tugatish → hisobot → haftalik
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, makeApi, joinStudent, sleep } from './server/helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const shotsRoot = path.join(here, '..', 'docs', 'screens', 'teacher');
fs.mkdirSync(shotsRoot, { recursive: true });
const only = process.argv[2];   // 'phone' | 'desktop'
const VIEWS = { phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } };

const srv = await startServer({ PUSH_MODE: 'mock', RATE_REGISTER_PER_HOUR: '200' });
const api = makeApi(srv.base);
const browser = await chromium.launch();
let failed = 0;
const ok = (c, m) => { if (c) console.log('  ✓', m); else { failed++; console.error('  ✗ FAIL:', m); } };
const report = {};

for (const [name, vp] of Object.entries(VIEWS)) {
  if (only && only !== name) continue;
  console.log(`\n=== ${name} ===`);
  const email = `ustoz-${name}@example.uz`;
  const reg = await api('POST', '/api/register', { name: 'Dilnoza', surname: 'Karimova', email, phone: '', school: 'TATU', subject: 'Fizika', password: 'secret123' });
  const ctx = await browser.newContext({ ...vp, locale: 'uz-UZ', serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (process.env.DBG && m.text().startsWith('LIVE')) console.log(m.text()); if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.addInitScript(() => { window.__clicks = 0; document.addEventListener('click', (e) => { if (e.isTrusted) window.__clicks++; }, true); });
  const BASE = srv.base + '/teacher/';
  const shot = async (nm, theme) => { await sleep(250); await page.screenshot({ path: path.join(shotsRoot, `${name}-${theme}-${nm}.png`), fullPage: name === 'desktop' ? false : false }); };
  const withThemes = async (nm) => { await page.emulateMedia({ colorScheme: 'light' }); await shot(nm, 'light'); await page.emulateMedia({ colorScheme: 'dark' }); await sleep(150); await shot(nm, 'dark'); await page.emulateMedia({ colorScheme: 'light' }); };
  const tab = (id) => page.locator(`${name === 'phone' ? '.tabbar' : '.side'} a[data-tab=${id}]`).click();
  const hash = () => new URL(page.url()).hash;

  // ---- kirish
  await page.goto(BASE);
  await page.waitForSelector('#em');
  await withThemes('login');
  await page.fill('#em', email); await page.fill('#pw', 'secret123');
  await page.click('button[type=submit]');
  await page.waitForSelector('.tour');
  ok(true, 'kirish va qo\'llanma ko\'rinadi');
  await page.screenshot({ path: path.join(shotsRoot, `${name}-light-tour.png`) });
  await page.click('#sk');
  await page.waitForSelector('#start');
  await withThemes('home-empty');

  // ---- guruh (CSV, xatolar bilan)
  await tab('groups'); await page.waitForSelector('#new');
  await withThemes('groups-empty');
  await page.click('#new');
  await page.fill('#gn', '101-guruh'); await page.fill('#gs', 'Fizika');
  await page.fill('#csv', 'FISH,HEMIS ID\nAliyev Vali,390211001\nKarimova Madina,390211002\nab,1\nAliyev Vali,390211009');
  await page.click('#ok');
  await page.waitForSelector('.err-text');
  const errTxt = await page.textContent('#errs');
  ok(/3-qator|4-qator|2-qator/.test(errTxt) || /qator|row|строк/i.test(errTxt), 'CSV xatolari qator raqami bilan ko\'rsatildi: ' + errTxt.replace(/\s+/g, ' ').slice(0, 90));
  await page.screenshot({ path: path.join(shotsRoot, `${name}-light-group-errors.png`) });
  await page.click('#ok');
  await page.waitForSelector('[data-g]');
  ok((await page.textContent('[data-g]')).includes('101-guruh'), 'guruh ro\'yxatda');
  await withThemes('groups');
  await page.click('[data-g]'); await page.waitForSelector('#startHere');
  ok((await page.textContent('.stu')).includes('Aliyev'), 'guruh tafsilotida talabalar');
  await withThemes('group-detail');

  // ---- test (4 tur)
  await tab('tests'); await page.waitForSelector('.empty');
  await withThemes('tests-empty');
  await page.goto(BASE + '#/tests/new');
  await page.fill('#tt', 'Aralash test');
  await page.fill('[data-text="0"]', 'Yer shakli?');
  await page.fill('[data-o="0:0"]', 'Yassi'); await page.fill('[data-o="0:1"]', 'Sharsimon');
  await page.check('[data-c="0:1"]');
  await page.click('#aq'); await page.selectOption('[data-type="1"]', 'multi');
  await page.fill('[data-text="1"]', 'Tub sonlar?'); await page.fill('[data-o="1:0"]', '2'); await page.fill('[data-o="1:1"]', '3'); await page.fill('[data-o="1:2"]', '4');
  await page.check('[data-c="1:0"]'); await page.check('[data-c="1:1"]');
  await page.click('#aq'); await page.selectOption('[data-type="2"]', 'tf'); await page.fill('[data-text="2"]', 'Yer aylanadi'); 
  await page.click('#aq'); await page.selectOption('[data-type="3"]', 'short'); await page.fill('[data-text="3"]', 'Poytaxt?'); await page.fill('[data-acc="3"]', 'Toshkent, Tashkent');
  await page.screenshot({ path: path.join(shotsRoot, `${name}-light-test-editor.png`), fullPage: true });
  await page.click('#save'); await page.waitForSelector('[data-e]');
  const tp = (await api('GET', '/api/testpacks', undefined, reg.token)).testpacks[0];
  ok(tp && tp.questions.map((q) => q.type).join() === 'single,multi,tf,short' && JSON.stringify(tp.questions[1].correct) === '[0,1]' && tp.questions[0].options.length === 2, 'test 4 tur bilan saqlandi (bo\'sh variantlar olib tashlandi)');
  await withThemes('tests');

  // ---- material (havola)
  await page.goto(BASE + '#/materials'); await page.waitForSelector('#ml');
  await page.click('#ml'); await page.fill('#lt', 'Dars slaydlari'); await page.fill('#lu', 'https://example.uz/slides');
  await page.click('#ok'); await page.waitForSelector('[data-s]');
  await withThemes('materials');

  // ---- darsni boshlash: o'lchov
  await tab('home'); await page.waitForSelector('#start');
  await page.evaluate(() => { window.__clicks = 0; });
  const t0 = Date.now();
  await page.click('#start');                        // 1
  await page.waitForSelector('#go');
  await withThemes('start');
  await page.evaluate(() => { window.__clicks = 1; });
  await page.click('#go');                           // 2 (guruh oldindan tanlangan)
  await page.waitForSelector('.qrfull img');
  const startMs = Date.now() - t0;
  const startClicks = await page.evaluate(() => window.__clicks);
  report[name] = { startClicks, startMs };
  ok(startClicks <= 3, `darsni boshlash ${startClicks} bosish (maqsad ≤ 3)`);
  ok(startMs <= 15000, `darsni boshlash ${startMs} ms (maqsad ≤ 15000)`);
  await page.screenshot({ path: path.join(shotsRoot, `${name}-light-qr.png`) });
  const code = /\/live\/(\d+)/.exec(hash())[1];
  ok(/^\d{6}$/.test(code), 'dars kodi 6 xonali: ' + code);
  await page.click('#cl'); await sleep(200);

  // ---- talabalar qo'shiladi (roster bilan)
  const roster = await api('GET', `/api/sessions/${code}/roster`);
  const rs = roster.students;
  const dk = (i) => `dk-${name}-student-${i}-0123456789abcdef`;
  const joined = [];
  for (let i = 0; i < 2; i++) {
    await api('POST', `/api/sessions/${code}/roster/bind`, { rosterStudentId: rs[i].id, deviceKey: dk(i), platform: 'android' });
    joined.push(await joinStudent(srv.base, api, code, rs[i].name, 'android-lite', { deviceKey: dk(i), rosterStudentId: rs[i].id }));
  }
  await page.waitForFunction(() => /2/.test(document.querySelector('.tiles')?.textContent || ''), null, { timeout: 8000 });
  ok(true, 'talabalar jonli ko\'rinishda');
  await withThemes('live');

  // ---- so'rov: tasdiqlash (1 bosish)
  const rq = await api('POST', `/api/sessions/${code}/exemption-requests`, { name: 'Mehmon Talaba', reason: 'old_phone', device: 'Redmi' });
  await page.waitForSelector('[data-dec]');
  await page.screenshot({ path: path.join(shotsRoot, `${name}-light-live-request.png`) });
  await page.evaluate(() => { window.__clicks = 0; });
  await page.click('[data-dec][data-a="1"]');
  const clicksApprove = await page.evaluate(() => window.__clicks);
  await page.waitForFunction(() => !document.querySelector('[data-dec]'), null, { timeout: 5000 });
  const st = await api('GET', `/api/access-requests/${rq.id}?secret=${rq.secret}`);
  ok(clicksApprove === 1 && (st.status === 'approved' || st.approved === true || /approv/.test(JSON.stringify(st))), `so'rovni tasdiqlash ${clicksApprove} bosish; holat: ${st.status}`);
  report[name].approveClicks = clicksApprove;

  // ---- test yuborish (3 bosish: tugma → test → (toast))
  const quizP = joined[0].c.waitFor('new-quiz');
  await page.evaluate(() => { window.__clicks = 0; });
  await page.click('#sendTest'); await page.waitForSelector('[data-t]'); await page.click('[data-t]');
  const quiz = await quizP;
  report[name].sendTestClicks = await page.evaluate(() => window.__clicks);
  ok(quiz.questions.length === 4 && quiz.questions.every((q) => q.correct === undefined), `test yuborildi (${report[name].sendTestClicks} bosish), to'g'ri javob yashirin`);
  const ids = quiz.questions.map((q) => q.id);
  joined[0].c.emit('student-submit-quiz', { sessionId: code, studentId: joined[0].studentId, studentName: rs[0].name, quizId: quiz.quizId, answers: { [ids[0]]: '1', [ids[1]]: '0,1', [ids[2]]: '0', [ids[3]]: 'toshkent' } });
  const qres = await joined[0].c.waitFor('quiz-result');
  ok(qres.correctCount === 4, `test natijasi 4/4 (to'g'ri baholash): ${qres.correctCount}/${qres.totalQuestions}`);
  await page.waitForFunction(() => /1\/2/.test(document.body.textContent), null, { timeout: 6000 }).catch(async () => { console.log('BODY:', (await page.textContent('#view')).replace(/\s+/g, ' ').slice(0, 600)); throw new Error('progress yo\'q'); });
  ok(true, 'test topshirish progressi: 1/2');

  // ---- hammani ochish (tasdiq bilan: tugma + tasdiq = 2 bosish)
  await page.evaluate(() => { window.__clicks = 0; });
  await page.click('#openAll'); await page.waitForSelector('[data-ok]'); await page.click('[data-ok]');
  report[name].openAllClicks = await page.evaluate(() => window.__clicks);
  await sleep(500);
  const ov = await api('GET', `/api/lock/sessions/${code}/overview`, undefined, reg.token);
  ok(ov.locked === false, `hammani ochish (${report[name].openAllClicks} bosish, tasdiq bilan)`);

  // ---- darsni tugatish (tugma + tasdiq) → hisobot
  await page.evaluate(() => { window.__clicks = 0; });
  await page.click('#end'); await page.waitForSelector('[data-ok]'); await page.click('[data-ok]');
  report[name].endClicks = await page.evaluate(() => window.__clicks);
  await page.waitForFunction(() => location.hash.startsWith('#/reports/'), null, { timeout: 8000 });
  await page.waitForSelector('#csv');
  ok(true, `dars tugadi, hisobot ochildi (${report[name].endClicks} bosish)`);
  ok((await page.textContent('.tbl')).includes(rs[0].name), 'hisobotda talaba bor');
  await withThemes('report');
  const dl1 = page.waitForEvent('download'); await page.click('#csv'); const d1 = await dl1;
  const csv = fs.readFileSync(await d1.path(), 'utf8');
  ok(csv.includes(rs[0].name), 'CSV yuklab olindi va talaba ismi bor');
  const dl2 = page.waitForEvent('download'); await page.click('#hemis'); const d2 = await dl2;
  const hemis = fs.readFileSync(await d2.path(), 'utf8');
  ok(hemis.includes('390211001') && hemis.startsWith('﻿HEMIS ID'), 'HEMIS fayli: HEMIS ID bor');
  for (const j of joined) j.c.close();

  // ---- haftalik
  await page.goto(BASE + '#/weekly'); await page.waitForSelector('#pv');
  await page.waitForFunction(() => /101-guruh/.test(document.body.textContent), null, { timeout: 5000 });
  ok(true, 'haftalik hisobotda guruh bor');
  await withThemes('weekly');

  // ---- sozlamalar, til, mavzu
  await page.goto(BASE + '#/settings'); await page.waitForSelector('#savep');
  await withThemes('settings');
  await page.click('[data-l="ru"]'); await page.waitForFunction(() => /Настройки/.test(document.body.textContent));
  ok(true, 'til ruscha bo\'ldi');
  await page.click('[data-l="uz"]');
  await page.goto(BASE + '#/more'); await page.waitForSelector('#tour'); await withThemes('more');

  // ---- admin yo'q ustozga
  await page.goto(BASE + '#/admin'); await sleep(600);
  ok(!hash().startsWith('#/admin'), 'oddiy ustoz adminga kira olmaydi');
  ok(errors.length === 0, 'konsolda xato yo\'q' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

fs.writeFileSync(path.join(here, '..', 'docs', 'screens', 'teacher', 'usability.json'), JSON.stringify(report, null, 2));
console.log('\nQulaylik o\'lchovi:', JSON.stringify(report));
await browser.close(); await srv.stop();
if (failed) { console.error(`\n${failed} ta tekshiruv muvaffaqiyatsiz`); process.exit(1); }
console.log('\nBarcha tekshiruvlar o\'tdi');
