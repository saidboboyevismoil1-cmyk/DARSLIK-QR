// Dars rejimi: talaba ilovasining native bilan oqimi (Playwright, native ko'prik mock bilan).
// Mock — haqiqiy native o'rnini bosuvchi JS: ruxsatlar, ekran mahkamlash, SOS, avto-ochilish.
// Ishga tushirish: node tests/e2e-lock.mjs [android|ios]
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, makeApi, teacherLogin, sleep } from './server/helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = (process.argv[2] || 'android').toLowerCase();
const store = process.env.STORE_SHOTS === '1';   // do'kon skrinshotlari: iPhone 6.9" (1320x2868) / Android 1080x2400
const outDir = store ? path.join(here, '..', 'docs', 'store', 'screenshots', target) : path.join(here, 'screenshots', 'lock-' + target);
fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
const cfg = target === 'ios' ? { engine: webkit, device: store ? { ...devices['iPhone 15'], viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 } : devices['iPhone 15'] } : { engine: chromium, device: store ? { ...devices['Pixel 7'], viewport: { width: 360, height: 800 }, deviceScaleFactor: 3 } : devices['Pixel 7'] };

let n = 0, failed = 0;
const ok = (c, m) => { if (c) console.log('  ✓', m); else { failed++; console.error('  ✗ FAIL:', m); } };

// ---------- Native mock (sahifaga kiritiladi) ----------
const mockScript = ({ platform, brand, key }) => `
(() => {
  const M = window.__mock = { platform: ${JSON.stringify(platform)}, calls: [], started: false, pinned: false, qrText: '', settings: [],
    perms: ${JSON.stringify(platform === 'ios' ? { screentime: 'denied', notifications: 'granted', camera: 'granted' } : { accessibility: 'denied', dnd: 'denied', battery: 'unknown', notifications: 'granted', camera: 'granted', pinning: 'unknown' })} };
  const emit = (evt, d) => window.__efNative && window.__efNative.emit(evt, JSON.stringify(d));
  M.emit = emit;
  const android = M.platform === 'android';
  const state = () => {
    const checks = android ? { pinned: M.pinned, accessibility: M.perms.accessibility === 'granted', dnd: M.perms.dnd === 'granted', foreground: true } : { shield: M.started, authorized: M.perms.screentime === 'granted', foreground: true };
    const reasons = [];
    if (android) { if (!checks.pinned) reasons.push('not_pinned'); if (!checks.accessibility) reasons.push('no_accessibility'); if (!checks.dnd) reasons.push('no_dnd'); }
    else if (!checks.shield) reasons.push('no_shield');
    return { active: M.started && reasons.length === 0, reasons, checks, fg: true, level: M.level };
  };
  const handlers = {
    info: () => ({ platform: M.platform, flavor: android ? 'direct' : '', appVersion: '5.0.0', osVersion: android ? '14' : '26.5', brand: ${JSON.stringify(brand)}, model: 'Mock',
      candidates: android ? ['android-full', 'android-lite', 'android-l0'] : ['ios-l1', 'ios-l2', 'ios-l0'],
      requires: android ? { 'android-full': ['accessibility', 'dnd'], 'android-lite': ['dnd'], 'android-l0': [] } : { 'ios-l1': [], 'ios-l2': ['screentime'], 'ios-l0': [] },
      features: { iosL1: true, iosL2: true } }),
    permissions: () => Object.entries(M.perms).map(([id, status]) => ({ id, status, canRequest: !['battery', 'pinning'].includes(id), guide: ['battery', 'pinning'].includes(id) })),
    requestPermission: ({ id }) => { M.perms[id] = 'granted'; setTimeout(() => emit('permissionChanged', { id }), 20); return { status: 'granted' }; },
    openSettings: ({ id }) => { M.settings.push(id); return { ok: true }; },
    deviceKey: () => ({ key: ${JSON.stringify(key)} }),
    'protection.dryRun': () => ({ ok: true }),
    'protection.start': ({ level }) => { M.level = level; M.started = true; M.pinned = true; M.calls.push('start:' + level); return { ok: true, level }; },
    'protection.update': () => { M.calls.push('update'); return { ok: true }; },
    'protection.state': () => state(),
    'protection.stop': ({ reason }) => { M.started = false; M.pinned = false; M.calls.push('stop:' + reason); return { ok: true }; },
    serverContact: () => { M.contacts = (M.contacts || 0) + 1; return { ok: true }; },
    attest: ({ nonce }) => ({ token: 'mock-ok:' + nonce, keyId: 'mock' }),
    sos: ({ number }) => { M.calls.push('sos:' + number); return { ok: true }; },
    scanQR: () => (M.qrText ? { text: M.qrText } : { cancelled: true }),
    openExternal: () => ({ ok: true }), openCalculator: () => ({ ok: true }),
    setBackHandled: () => ({ ok: true }), setSystemBarsDark: () => ({ ok: true }), setPullToRefresh: () => ({ ok: true }), exitApp: () => ({ ok: true }),
  };
  window.__efNativeHost = { platform: M.platform, invoke(id, method, args) {
    setTimeout(() => { let r; try { const h = handlers[method]; r = h ? { ok: true, data: h(JSON.parse(args || '{}')) } : { ok: false, error: 'unsupported' }; } catch (e) { r = { ok: false, error: String(e.message) }; }
      window.__efNative.resolve(id, JSON.stringify(r)); }, 8);
  } };
})();`;

const srv = await startServer({ IOS_L2_ENABLED: 'true', ATTESTATION_MODE: 'mock' });
const BASE = srv.base;
const api = makeApi(BASE);
const { token: T } = await teacherLogin(api);
const browser = await cfg.engine.launch();
const brand = target === 'ios' ? 'apple' : 'xiaomi';

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ ...cfg.device, locale: opts.locale || 'uz-UZ', serviceWorkers: 'block' });
  if (opts.native !== false) await ctx.addInitScript(mockScript({ platform: target, brand, key: opts.key || 'dk-mockdevice-' + Math.random().toString(36).slice(2) + '0123456789' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.errors = errors;
  return { ctx, page };
}
const shot = async (page, name) => { n++; await sleep(350); await page.screenshot({ path: path.join(outDir, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const waitScreen = (page, id, t = 8000) => page.waitForFunction((i) => document.querySelector('.screen.active')?.id === i, id, { timeout: t });
const text = (page, sel) => page.textContent(sel);
const mock = (page, fn, arg) => page.evaluate(fn, arg);
const prep = async (page) => { await page.goto(BASE + '/student.html'); await waitScreen(page, 's-consent'); };

// ============================================================ 1. Rozilik, til, onboarding, sozlash
console.log(`[${target}] 1. rozilik → til → onboarding → sozlash`);
const { page: p1, ctx: c1 } = await newPage();
await prep(p1);
ok((await text(p1, '#s-consent h1')).includes('Ilova qanday ishlaydi'), "rozilik ekrani o'zbek tilida");
await p1.click('[data-act=set-lang][data-v=ru] >> nth=0');
await p1.waitForFunction(() => document.querySelector('#s-consent h1').textContent.includes('Как работает'));
ok(true, "til ruscha'ga almashdi");
await shot(p1, 'rozilik-ru');
await p1.click('[data-act=set-lang][data-v=en] >> nth=0');
await p1.waitForFunction(() => document.querySelector('#s-consent h1').textContent.includes('How the app works'));
await p1.click('[data-act=set-lang][data-v=uz] >> nth=0');
await p1.waitForFunction(() => document.querySelector('#s-consent h1').textContent.includes('Ilova qanday'));
await p1.click('[data-act=consent-decline]');
await waitScreen(p1, 's-declined');
await shot(p1, 'rad-etdi');
await p1.click('[data-act=consent-review]');
await waitScreen(p1, 's-consent');
await p1.click('[data-act=consent-accept]');
await waitScreen(p1, 's-onboard');
await p1.click('[data-act=onb-skip]');
await waitScreen(p1, 's-setup');                              // native bor: sozlash ekrani
await p1.waitForSelector('[data-perm]');
const rows = await p1.$$eval('[data-perm]', (els) => els.map((e) => [e.dataset.perm, e.className.includes('ok')]));
ok(rows.length >= 3, `ruxsat qatorlari ko'rsatildi: ${rows.map((r) => r[0] + (r[1] ? '✓' : '✗')).join(' ')}`);
await shot(p1, 'sozlash-boshida');
const level0 = await text(p1, '#setup-level');
if (target === 'android') {
  ok(level0.includes('Faqat kuzatuv'), `ruxsatsiz daraja: "${level0}"`);
  await p1.click('[data-act=perm-fix][data-id=accessibility]');
  await p1.waitForFunction(() => document.querySelector('[data-perm=accessibility]').className.includes('ok'));
  await p1.click('[data-act=perm-fix][data-id=dnd]');
  await p1.waitForFunction(() => document.querySelector('[data-perm=dnd]').className.includes('ok'));
  ok((await text(p1, '#setup-level')).includes("To'liq himoya"), "Accessibility va DND yoqilgach daraja: To'liq himoya");
  // OEM yo'riqnomasi (Xiaomi)
  await p1.click('[data-act=perm-guide][data-id=battery]');
  await p1.waitForSelector('#o-guide.open');
  ok((await text(p1, '#guide-body')).includes('Xiaomi'), "batareya yo'riqnomasi Xiaomi uchun");
  await shot(p1, 'oem-yoriqnoma');
  await p1.click('#guide-done');
  await p1.waitForFunction(() => document.querySelector('[data-perm=battery]').className.includes('ok'));
} else {
  ok(level0.includes('Faqat kuzatuv'), `iOS: Screen Time'siz daraja: "${level0}"`);
  await p1.click('[data-act=perm-fix][data-id=screentime]');
  await p1.waitForFunction(() => document.querySelector('[data-perm=screentime]').className.includes('ok'));
  ok((await text(p1, '#setup-level')).includes('Ekran vaqti'), 'Screen Time yoqilgach daraja: ios-l2');
}
await shot(p1, 'sozlash-tayyor');
await p1.click('#setup-continue');
await waitScreen(p1, 's-name');
await p1.fill('#name-input', 'Jasur Karimov');
await p1.click('#name-form button[type=submit]');
await waitScreen(p1, 's-home');

// ============================================================ 2. "Darsga tayyormisiz?"
console.log(`[${target}] 2. tayyorlik testi`);
await p1.click('#home-ready');
await waitScreen(p1, 's-ready');
await p1.click('#ready-run');
await p1.waitForSelector('#ready-result:not([hidden])', { timeout: 15000 });
ok((await text(p1, '#ready-result')).includes('Tayyorsiz'), 'tayyorlik testi: Tayyorsiz!');
await shot(p1, 'tayyorlik');
await p1.click('#s-ready [data-act=back]');
await waitScreen(p1, 's-home');
ok((await text(p1, '#home-ready-sub')).startsWith('Tayyor'), "bosh sahifa kartasi: Tayyor");

// ============================================================ 3. Majburiy dars: qo'shilish va himoya
console.log(`[${target}] 3. majburiy darsga kirish, himoya holati, bypass, SOS, favqulodda chiqish`);
const s1 = (await api('POST', '/api/sessions', { name: 'Himoyali dars', subject: 'Fizika', duration: 40, protection: 'required' }, T)).session;
await p1.fill('#code-input', s1.id);
await waitScreen(p1, 's-lesson', 15000);
await p1.waitForFunction(() => document.querySelector('#prot-chip').className.includes('ok'));
ok(true, "majburiy darsga kirdi, himoya chip'i yashil");
const info = (await api('GET', '/api/sessions', undefined, T)).find((s) => s.id === s1.id);
const stud = info.students[0];
const wantLevel = target === 'android' ? 'android-full' : 'ios-l2';
ok(stud.level === wantLevel && stud.attested === true, `server: daraja ${stud.level}, attestatsiya ${stud.attested}`);
ok((await mock(p1, () => window.__mock.calls)).includes('start:' + wantLevel), 'native himoya ishga tushirildi');
await shot(p1, 'dars-himoya-faol');

// heartbeat va overview
await sleep(1500);
let ov = await api('GET', `/api/lock/sessions/${s1.id}/overview`, undefined, T);
ok(ov.students[0].status === 'protected' && ov.students[0].color === 'green', "ustoz paneli: talaba yashil (himoyada)");

// bypass: ekran mahkamlash olib tashlandi
await mock(p1, () => { const M = window.__mock; if (M.platform === 'android') M.pinned = false; else M.started = false; M.emit('protectionChanged', {}); });
await p1.waitForSelector('#prot-banner:not([hidden])', { timeout: 8000 });
ok(true, "himoya buzilganda banner ko'rinadi");
await shot(p1, 'himoya-buzildi');
await sleep(1500);
ov = await api('GET', `/api/lock/sessions/${s1.id}/overview`, undefined, T);
ok(ov.students[0].color === 'red', 'ustoz paneli: talaba qizil');
const evs = (await api('GET', `/api/lock/sessions/${s1.id}/events`, undefined, T)).events.map((e) => e.type);
ok(evs.includes(target === 'android' ? 'pinning_removed' : 'protection_lost'), `hodisa jurnali: ${evs.join(', ')}`);
await p1.click('[data-act=fix-protection]');
await p1.waitForFunction(() => document.querySelector('#prot-banner').hidden, null, { timeout: 8000 });
ok(true, 'qayta yoqilgach banner yo\'qoldi');

// SOS
await p1.click('[data-act=open-sos]');
await p1.waitForSelector('#o-sos.open');
await shot(p1, 'sos');
await p1.click('[data-act=sos-call][data-n="112"]');
await p1.waitForFunction(() => window.__mock.calls.includes('sos:112'));
await sleep(500);
const sosEv = (await api('GET', `/api/lock/sessions/${s1.id}/events`, undefined, T)).events.map((e) => e.type);
ok(sosEv.includes('sos'), 'SOS qo\'ng\'irog\'i native\'ga yetdi va ustozga jazosiz hodisa bo\'ldi');

// Favqulodda chiqish
await p1.click('[data-act=open-emergency]');
await p1.waitForSelector('#o-emergency.open');
await shot(p1, 'favqulodda-chiqish');
await p1.click('[data-act=emg-send]');
await p1.waitForFunction(() => document.querySelector('#emergency-btn').disabled);
const pend = (await api('GET', `/api/lock/sessions/${s1.id}/overview`, undefined, T)).requests;
ok(pend.length === 1 && pend[0].kind === 'emergency_exit', "ustozga favqulodda chiqish so'rovi keldi");
await api('POST', `/api/lock/requests/${pend[0].id}/decision`, { approve: true }, T);
await waitScreen(p1, 's-wait');
await p1.waitForFunction(() => window.__mock.calls.some((c) => c.startsWith('stop:')), null, { timeout: 5000 });
ok(true, "tasdiqlangach himoya to'xtatildi, ekran ochildi");
await shot(p1, 'ochildi-favqulodda');

// qayta qulflash + native avto-ochilish (aloqa 15 daqiqa uzildi)
await api('POST', `/api/lock/sessions/${s1.id}/relock`, {}, T);
await waitScreen(p1, 's-lesson');
await mock(p1, () => window.__mock.emit('autoRelease', { reason: 'offline' }));
await waitScreen(p1, 's-wait');
const saved = await p1.evaluate(() => JSON.parse(localStorage.getItem('ef_session')));
ok(saved.autoReleased === true, "native avto-ochilishdan keyin 'autoReleased' belgilandi (rejoin'da serverga aytiladi)");

// Dars tugaydi
await api('POST', `/api/sessions/${s1.id}/end`, {}, T);
await waitScreen(p1, 's-ended');
await p1.click('[data-act=rate-close]').catch(() => {});
await shot(p1, 'tugadi');
await p1.click('#s-ended [data-act=home]');
await waitScreen(p1, 's-home');

// ============================================================ 4. Guruh ro'yxati
console.log(`[${target}] 4. guruh ro'yxati (CSV), bir martalik bog'lash`);
const g = await api('POST', '/api/rosters', { name: '201-guruh', csv: 'F.I.Sh;HEMIS ID\nKarimov Jasur;1\nAliyeva Dilnoza;2\nToshmatov Bobur;3' }, T);
const s2 = (await api('POST', '/api/sessions', { name: 'Ro\'yxatli dars', duration: 40, rosterGroupId: g.id }, T)).session;
await p1.fill('#code-input', s2.id);
await waitScreen(p1, 's-roster');
ok((await p1.$$('#roster-list .item')).length === 3, "ro'yxatda 3 ta talaba");
await p1.fill('#roster-search', 'dilnoza');
ok((await p1.$$('#roster-list .item')).length === 1, 'qidiruv ishlaydi');
await shot(p1, 'royxat');
await p1.click('#roster-list .item');
await p1.waitForSelector('#o-confirm.open');
await p1.click('#cf-ok');
await waitScreen(p1, 's-lesson', 15000);
const ses2 = (await api('GET', '/api/sessions', undefined, T)).find((s) => s.id === s2.id);
ok(ses2.students[0].name === 'Aliyeva Dilnoza', "ism ro'yxatdan olindi");
await api('POST', `/api/sessions/${s2.id}/end`, {}, T);
await waitScreen(p1, 's-ended'); await p1.click('[data-act=rate-close]').catch(() => {}); await p1.click('#s-ended [data-act=home]'); await waitScreen(p1, 's-home');
// ikkinchi darsda — qayta tanlamaydi
const s3 = (await api('POST', '/api/sessions', { name: 'Ikkinchi dars', duration: 40, rosterGroupId: g.id }, T)).session;
await p1.fill('#code-input', s3.id);
await waitScreen(p1, 's-lesson', 15000);
ok(true, "keyingi darsda ism qayta tanlanmadi (qurilmaga bog'langan)");
await api('POST', `/api/sessions/${s3.id}/end`, {}, T);
await waitScreen(p1, 's-ended'); await p1.click('[data-act=rate-close]').catch(() => {}); await p1.click('#s-ended [data-act=home]'); await waitScreen(p1, 's-home');

// ============================================================ 5. Himoya majburiy, lekin ruxsatlar yo'q (shlyuz)
console.log(`[${target}] 5. shlyuz: ruxsatlar yetishmasa tugma bloklanadi`);
await mock(p1, () => { const M = window.__mock; for (const k of Object.keys(M.perms)) if (['accessibility', 'dnd', 'screentime'].includes(k)) M.perms[k] = 'denied'; });
await p1.evaluate(() => window.__efNative.emit('permissionChanged', '{}'));
await sleep(300);
const s4 = (await api('POST', '/api/sessions', { name: 'Majburiy', duration: 40, protection: 'required' }, T)).session;
await p1.fill('#code-input', s4.id);
await p1.waitForSelector('#join-gate:not([hidden])');
ok(true, "ruxsatlar yetishmasa 'Bu dars himoya talab qiladi' kartasi ko'rinadi, qo'shilmaydi");
await shot(p1, 'shlyuz');
ok((await api('GET', '/api/sessions', undefined, T)).find((s) => s.id === s4.id).students.length === 0, "serverga qo'shilish so'rovi yuborilmadi");

// ============================================================ 6. Ma'lumotni o'chirish
console.log(`[${target}] 6. ma'lumotni o'chirish`);
await p1.click('[data-act=go-profile]');
await waitScreen(p1, 's-profile');
await shot(p1, 'profil');
await p1.click('[data-act=set-lang][data-v=en] >> nth=-1');
await p1.waitForFunction(() => document.querySelector('#s-profile .bar-title').textContent === 'Profile');
ok(true, 'profilda til inglizchaga almashdi');
await p1.click('[data-act=reset-ask]');
await p1.waitForSelector('#o-confirm.open');
await p1.click('#cf-ok');
await p1.waitForFunction(() => !localStorage.getItem('ef_name'), null, { timeout: 8000 });
const allSessions = await api('GET', '/api/sessions', undefined, T);
const names = allSessions.flatMap((s) => s.students.map((x) => x.name));
ok(!names.includes('Aliyeva Dilnoza') && !names.includes('Jasur Karimov'), "serverdagi yozuvlar anonimlashtirildi");
ok(p1.errors.length === 0, "konsolda xato yo'q" + (p1.errors.length ? ': ' + p1.errors.join(' | ') : ''));
await c1.close();

// ============================================================ 7. Brauzer: ilova kerak + himoyasiz kirish so'rovi
console.log(`[${target}] 7. brauzer (native yo'q): ilova kerak, himoyasiz kirish so'rovi`);
const { page: p2, ctx: c2 } = await newPage({ native: false });
await p2.goto(BASE + '/student.html'); await waitScreen(p2, 's-consent');
await p2.click('[data-act=consent-accept]'); await waitScreen(p2, 's-onboard');
await p2.click('[data-act=onb-skip]'); await waitScreen(p2, 's-name');
await p2.fill('#name-input', 'Brauzer Talaba'); await p2.click('#name-form button[type=submit]'); await waitScreen(p2, 's-home');
const s5 = (await api('POST', '/api/sessions', { name: 'Faqat ilova', duration: 40, protection: 'required' }, T)).session;
await p2.fill('#code-input', s5.id);
await waitScreen(p2, 's-needapp');
ok((await p2.getAttribute('#dl-android', 'href')) === '/download/apk', "'Ilovani yuklab oling' sahifasi, yuklash havolalari bor");
await shot(p2, 'ilova-kerak');
await p2.click('#s-needapp [data-act=gate-exempt]');
await waitScreen(p2, 's-exempt');
await p2.click('label.opt:has(input[value=old_phone])');
await p2.click('[data-act=exempt-send]');
await p2.waitForSelector('#exempt-wait:not([hidden])');
await shot(p2, 'sorov-kutilmoqda');
const rq = (await api('GET', `/api/lock/sessions/${s5.id}/overview`, undefined, T)).requests;
ok(rq.length === 1 && rq[0].kind === 'exemption' && rq[0].reason === 'old_phone', "ustozga himoyasiz kirish so'rovi keldi");
await api('POST', `/api/lock/requests/${rq[0].id}/decision`, { approve: true }, T);
await waitScreen(p2, 's-lesson', 15000);
ok(true, "ustoz tasdiqlagach talaba darsga kirdi (brauzer, himoyasiz)");
const st5 = (await api('GET', '/api/sessions', undefined, T)).find((s) => s.id === s5.id).students[0];
ok(st5.exempt === true && st5.level === 'web', 'serverda: exempt=true, daraja web');
ok(p2.errors.length === 0, "brauzer: konsolda xato yo'q" + (p2.errors.length ? ': ' + p2.errors.join(' | ') : ''));
await c2.close();

await browser.close();
await srv.stop();
console.log(failed ? `\n${failed} ta tekshiruv muvaffaqiyatsiz` : "\nBarcha tekshiruvlar o'tdi");
process.exit(failed ? 1 : 0);
