// Android emulyatorida (API 26 / 36) HAQIQIY ilova bilan to'liq oqim:
// rozilik → onboarding → ruxsatlar → tayyorlik → majburiy darsga kirish → pinning/DND/Accessibility bypass → SOS →
// ustoz ochishi → taymer → aloqa uzilishi (o'lik odam taymeri) → QR skaner → ma'lumotni o'chirish.
// Ishga tushirish:  node tests/android/emulator-flow.mjs [direct|store] [--slow]
// Talab: ishlayotgan emulyator (adb), tegishli debug APK o'rnatilgan, :3000 port bo'sh (test o'z serverini ishga tushiradi).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, makeApi, teacherLogin } from '../server/helpers.mjs';
import { adb, sh, sleep, connectPage, ui, tapText, topActivity } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const flavor = (process.argv[2] || 'direct').toLowerCase();
const SLOW = process.argv.includes('--slow');
const PKG = 'com.edufocus.app';
const sdk = sh('getprop ro.build.version.sdk');
const outDir = path.join(here, '..', 'screenshots', `android-${flavor}-api${sdk}`);
fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });

let n = 0, failed = 0;
const ok = (c, m) => { if (c) console.log('  ✓', m); else { failed++; console.error('  ✗ FAIL:', m); } };
const execBuf = (...a) => execFileSync(process.env.ADB || `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`, a, { maxBuffer: 64 * 1024 * 1024 });
const shot = async (name) => { n++; await sleep(500); fs.writeFileSync(path.join(outDir, `${String(n).padStart(2, '0')}-${name}.png`), execBuf('exec-out', 'screencap', '-p')); };

const isPinned = () => /mLockTaskModeState=(PINNED|LOCKED)/.test(sh('dumpsys activity activities | grep mLockTaskModeState')) || /LockTaskModeState: (PINNED|LOCKED)/.test(sh('dumpsys activity activities | grep -i LockTaskModeState'));
const zen = () => sh('settings get global zen_mode');
const inApp = () => topActivity().includes(PKG);
/** Shart bajarilguncha kutadi (tizim o'zgarishlari bir necha yuz ms kechikadi). */
async function until(fn, timeout = 8000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { if (fn()) return true; } catch { /* qayta */ } await sleep(400); } return false; }

/** Tizimning "Ekranni mahkamlash" oynasi paydo bo'lsa "Start/Boshlash" ni bosadi. */
async function acceptPinning(timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (tapText(/^(Start|Got it|OK|Boshlash|Начать|Понятно)$/i)) return true; } catch { /* dump xatosi */ }
    await sleep(700);
  }
  return false;
}

// ---------------------------------------------------------------- tayyorgarlik
try { execFileSync('pkill', ['-f', 'node server.js']); } catch { /* jarayon yo'q */ }
await sleep(800);
const srv = await startServer({ PORT: '3000', ATTESTATION_MODE: 'log' });
process.on('uncaughtException', async (e) => { try { sh('svc wifi enable'); sh('svc data enable'); } catch { /* ignore */ } console.error(e); console.error('--- server jurnali ---\n' + srv.log().slice(-2500)); try { await srv.stop(); } catch { /* ignore */ } process.exit(2); });
const api = makeApi(srv.base);
const { token: T } = await teacherLogin(api);
const events = async (id) => (await api('GET', `/api/lock/sessions/${id}/events?limit=300`, undefined, T)).events.map((e) => e.type);
const waitEvent = async (id, type, timeout = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if ((await events(id)).includes(type)) return true; await sleep(700); } return false; };

try { sh('svc wifi enable'); sh('svc data enable'); } catch { /* ignore */ }
adb('shell', 'am', 'force-stop', PKG);
sh(`pm clear ${PKG}`);
try { sh(`cmd notification disallow_dnd ${PKG}`); } catch { /* ignore */ }
for (const p of ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS']) { try { sh(`pm revoke ${PKG} ${p}`); } catch { /* yo'q bo'lishi mumkin */ } }
sh('settings put secure enabled_accessibility_services ""');
try { sh(`cmd notification disallow_dnd ${PKG}`); } catch { /* ignore */ }
try { sh('cmd notification set_dnd off'); } catch { /* ignore */ }
sh('settings put global zen_mode 0');
sh('settings put global development_settings_enabled 0');
sh('input keyevent KEYCODE_WAKEUP'); sh('wm dismiss-keyguard');

console.log(`[android ${flavor} · API ${sdk}] 1. rozilik → onboarding → ruxsatlar`);
adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
let p = await connectPage();
await p.waitScreen('s-consent');
ok((await p.eval('window.__efNativeHost?.platform || (typeof AndroidBridge === "object" ? "android" : "none")')) === 'android', 'haqiqiy native ko\'prik mavjud');
await shot('rozilik');
await p.click('[data-act=consent-accept]');
await p.waitScreen('s-onboard');
await p.click('[data-act=onb-skip]');
await p.waitScreen('s-setup');
await p.waitFor("document.querySelectorAll('[data-perm]').length >= 3");
let rows = await p.eval("JSON.stringify([...document.querySelectorAll('[data-perm]')].map(e=>[e.dataset.perm,e.className.includes('ok')]))");
const ids = JSON.parse(rows).map((r) => r[0]);
console.log('   ruxsat qatorlari:', rows);
ok(flavor === 'direct' ? ids.includes('accessibility') : !ids.includes('accessibility'), flavor === 'direct' ? "direct: Accessibility qatori bor" : "store: Accessibility qatori yo'q (Play siyosati)");
ok(ids.includes('dnd') && ids.includes('pinning'), 'DND va ekranni mahkamlash qatorlari bor');
ok(!JSON.parse(rows).find((r) => r[0] === 'dnd')[1], 'boshida DND yoqilmagan (✗)');
await shot('sozlash-boshida');
const chipBefore = await p.text('#setup-level');

// ruxsatlarni berish (adb orqali — foydalanuvchi sozlamalarda yoqishini taqlid qiladi)
if (flavor === 'direct') sh(`settings put secure enabled_accessibility_services ${PKG}/${PKG}.LockAccessibilityService`), sh('settings put secure accessibility_enabled 1');
sh(`cmd notification allow_dnd ${PKG}`);
sh(`pm grant ${PKG} android.permission.POST_NOTIFICATIONS`); sh(`pm grant ${PKG} android.permission.CAMERA`);
sh('input keyevent KEYCODE_HOME'); await sleep(800); adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);   // qaytganda holat yangilanadi
await p.waitFor("document.querySelector('[data-perm=dnd]')?.className.includes('ok')", 15000, 'DND ✓');
ok(true, "adb orqali ruxsat berilgach ilova holatni yangiladi (✓)");
const chipAfter = await p.text('#setup-level');
console.log(`   daraja: "${chipBefore}" → "${chipAfter}"`);
ok(chipBefore !== chipAfter, 'daraja chipi o\'zgardi');
await shot('sozlash-tayyor');
await p.click('#setup-continue');
await p.waitScreen('s-name');
await p.eval("document.querySelector('#name-input').value='Emulyator Talaba'; document.querySelector('#name-form').requestSubmit(); true");
await p.waitScreen('s-home');

console.log(`[android ${flavor} · API ${sdk}] 2. "Darsga tayyormisiz?" (haqiqiy himoya sinovi)`);
await p.click('#home-ready');
await p.waitScreen('s-ready');
await p.click('#ready-run');
const pinTap = acceptPinning(30000);               // sinov davomida tizim oynasi chiqadi
await p.waitFor("!document.querySelector('#ready-result').hidden", 60000, 'tayyorlik natijasi');
await pinTap;
const rtext = await p.text('#ready-result');
console.log('   natija:', rtext.replace(/\s+/g, ' ').slice(0, 90), '|', (await p.text('#ready-list')).replace(/\s+/g, ' ').slice(0, 260));
await shot('tayyorlik');
ok(/ready|Tayyor|готовы/i.test(rtext) && !/Not ready|Hali|Пока/.test(rtext), 'tayyorlik testi o\'tdi (haqiqiy pinning + DND)');
ok(!isPinned(), 'sinovdan keyin ekran mahkamlashi olib tashlandi');
await sleep(1200);
ok(zen() === '0', `sinovdan keyin DND avvalgi holatga qaytdi (zen_mode=${zen()})`);
await p.click('#s-ready [data-act=back]');
await p.waitScreen('s-home');

console.log(`[android ${flavor} · API ${sdk}] 3. majburiy darsga kirish va himoya`);
const s1 = (await api('POST', '/api/sessions', { name: 'Emulyator dars', duration: 30, protection: 'required' }, T)).session;
await p.eval(`(() => { const i = document.querySelector('#code-input'); i.value = ${JSON.stringify(s1.id)}; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
const pin1 = acceptPinning(40000);
await p.waitScreen('s-lesson', 60000);
await pin1;
await p.waitFor("document.querySelector('#prot-chip').className.includes('ok')", 20000, 'himoya chipi yashil');
ok(true, "majburiy darsga kirdi, himoya faol");
await shot('dars-himoya');
const st = (await api('GET', '/api/sessions', undefined, T)).find((s) => s.id === s1.id).students[0];
ok(st.level === (flavor === 'direct' ? 'android-full' : 'android-lite'), `server: daraja ${st.level}`);
ok(isPinned(), 'ekran haqiqatan mahkamlangan (dumpsys)');
ok(zen() !== '0', `DND yoqilgan (zen_mode=${zen()})`);

// Home bosilganda ilovadan chiqib bo'lmaydi
sh('input keyevent KEYCODE_HOME'); await sleep(1500);
ok(inApp(), 'HOME bosilganda ilova oldinda qoldi (mahkamlangan)');
sh('input keyevent KEYCODE_BACK'); await sleep(800);
ok(inApp(), 'BACK bosilganda ham chiqmadi');

// Bypass 1: mahkamlashni olib tashlash
sh('am task lock stop'); await sleep(500);
ok(await waitEvent(s1.id, 'pinning_removed', 20000), 'ustozga: pinning_removed hodisasi keldi');
await p.waitFor("!document.querySelector('#prot-banner').hidden", 15000, 'banner');
await shot('bypass-pinning');
ok(true, "ilovada 'Himoya o'chdi' banneri ko'rindi");
const re1 = acceptPinning(30000);                  // ilova avtomatik qayta so'raydi
await re1;
await p.waitFor("document.querySelector('#prot-banner').hidden", 40000, 'banner yo\'qoldi');
ok(isPinned(), 'ilova mahkamlashni qayta so\'radi va tiklandi');

// Bypass 2: DND ruxsati bekor qilindi (Android 15+: ilovaning DND qoidasi o'chadi)
sh(`cmd notification disallow_dnd ${PKG}`);
ok(await waitEvent(s1.id, 'dnd_disabled', 25000), 'ustozga: dnd_disabled hodisasi keldi');
await p.waitFor("!document.querySelector('#prot-banner').hidden", 15000, 'banner (dnd)');
await shot('bypass-dnd');
sh(`cmd notification allow_dnd ${PKG}`); await sleep(800);
await p.click('[data-act=fix-protection]');
await p.waitFor("document.querySelector('#prot-banner').hidden", 25000, 'banner yo\'qoldi (dnd)');
await sleep(800);
ok(zen() !== '0', "'Qayta yoqish' DND ni tikladi");

if (flavor === 'direct') {
  // Bypass 3: Accessibility o'chirildi, so'ng qayta yoqildi
  sh('settings put secure enabled_accessibility_services ""');
  ok(await waitEvent(s1.id, 'accessibility_disabled', 20000), 'ustozga: accessibility_disabled hodisasi keldi');
  sh(`settings put secure enabled_accessibility_services ${PKG}/${PKG}.LockAccessibilityService`);
  await p.waitFor("document.querySelector('#prot-banner').hidden", 20000, 'banner (a11y)');
  ok(true, 'Accessibility qayta yoqilgach banner yo\'qoldi');
}

// Bypass 4: dasturchi rejimi
sh('settings put global development_settings_enabled 1');
ok(await waitEvent(s1.id, 'developer_mode', 20000), 'ustozga: developer_mode hodisasi keldi');
sh('settings put global development_settings_enabled 0');

// Ustoz paneli rangi
const ov = await api('GET', `/api/lock/sessions/${s1.id}/overview`, undefined, T);
ok(['red', 'yellow', 'green'].includes(ov.students[0].color), `ustoz paneli rangi: ${ov.students[0].color}`);

console.log(`[android ${flavor} · API ${sdk}] 4. SOS (hech qachon bloklanmaydi)`);
await p.click('[data-act=open-sos]');
await sleep(500);
await p.click('[data-act=sos-call][data-n="112"]');
await sleep(2500);
const top = topActivity();
ok(!isPinned() && !top.includes(PKG + '/'), `SOS: mahkamlash olindi va telefon ochildi (${top.split(' ').find((x) => x.includes('/')) || top.slice(0, 60)})`);
await shot('sos-telefon');
ok(await waitEvent(s1.id, 'sos', 10000), 'ustozga jazosiz "sos" hodisasi keldi');
sh('input keyevent KEYCODE_BACK'); await sleep(500);
adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
const pin2 = acceptPinning(40000);
await pin2;
await sleep(1500);
ok(isPinned(), 'SOS dan qaytgach himoya avtomatik qayta yoqildi');

console.log(`[android ${flavor} · API ${sdk}] 5. ustoz ochadi / qulflaydi / dars tugaydi`);
await api('POST', `/api/lock/sessions/${s1.id}/release`, {}, T);
await p.waitScreen('s-wait', 20000);
ok(await until(() => !isPinned()), 'ustoz ochgach mahkamlash olindi');
await sleep(1000);
ok(zen() === '0', `DND avvalgi holatga qaytdi (zen_mode=${zen()})`);
await shot('ochildi');
await api('POST', `/api/lock/sessions/${s1.id}/relock`, {}, T);
const pin3 = acceptPinning(40000);
await p.waitScreen('s-lesson', 20000);
await pin3;
await p.waitFor("document.querySelector('#prot-chip').className.includes('ok')", 30000, 'qayta qulflandi');
ok(isPinned(), 'qayta qulflanganda himoya yana yoqildi');
await api('POST', `/api/sessions/${s1.id}/end`, {}, T);
await p.waitScreen('s-ended', 20000);
ok(await until(() => !isPinned() && zen() === '0', 10000), `dars tugagach himoya va DND tozalandi (pinned=${isPinned()}, zen=${zen()})`);
await p.eval("document.querySelector('[data-act=rate-close]')?.click(); true");
await p.click('#s-ended [data-act=home]');
await p.waitScreen('s-home');

console.log(`[android ${flavor} · API ${sdk}] 6. dars taymeri tugaganda native o'zi ochadi`);
const s2 = (await api('POST', '/api/sessions', { name: 'Taymer', duration: 0.6, protection: 'required' }, T)).session;   // 36 soniya
await p.eval(`(() => { const i = document.querySelector('#code-input'); i.value = ${JSON.stringify(s2.id)}; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
const pin4 = acceptPinning(40000);
await p.waitScreen('s-lesson', 60000);
await pin4;
await p.waitFor("document.querySelector('#prot-chip').className.includes('ok')", 20000);
await p.waitScreen('s-wait', 70000);
ok(await until(() => !isPinned()), 'taymer tugagach himoya olib tashlandi');
await api('POST', `/api/sessions/${s2.id}/end`, {}, T);
await p.waitScreen('s-ended', 20000);
await p.eval("document.querySelector('[data-act=rate-close]')?.click(); true");
await p.click('#s-ended [data-act=home]');
await p.waitScreen('s-home');

if (SLOW) {
  console.log(`[android ${flavor} · API ${sdk}] 7. aloqa uzilishi: o'lik odam taymeri (2 daqiqa)`);
  await api('PUT', '/api/admin/settings', { values: { 'release.offlineMinutes': 2 } }, T);
  const s3 = (await api('POST', '/api/sessions', { name: 'Offline', duration: 30, protection: 'required' }, T)).session;
  await p.eval(`(() => { const i = document.querySelector('#code-input'); i.value = ${JSON.stringify(s3.id)}; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
  const pin5 = acceptPinning(40000);
  await p.waitScreen('s-lesson', 60000); await pin5;
  await p.waitFor("document.querySelector('#prot-chip').className.includes('ok')", 20000);
  sh('svc wifi disable'); sh('svc data disable');
  const t0 = Date.now();
  await p.waitScreen('s-wait', 200000);
  const dt = Math.round((Date.now() - t0) / 1000);
  ok(dt >= 100 && dt <= 190, `aloqa uzilgach ~2 daqiqada native o'zi ochdi (${dt} s)`);
  ok(!isPinned(), 'qulf olib tashlandi');
  sh('svc wifi enable'); sh('svc data enable');
  ok(await waitEvent(s3.id, 'released_offline', 60000), 'aloqa qaytgach serverga "released_offline" yetdi');
  await api('PUT', '/api/admin/settings', { values: { 'release.offlineMinutes': null } }, T);
  await api('POST', `/api/sessions/${s3.id}/end`, {}, T);
  await p.waitScreen('s-ended', 30000);
  await p.eval("document.querySelector('[data-act=rate-close]')?.click(); true");
  await p.click('#s-ended [data-act=home]');
  await p.waitScreen('s-home');
}

console.log(`[android ${flavor} · API ${sdk}] 8. native QR skaner va ruxsat rad etilishi`);
await p.click('[data-act=scan]');
await sleep(3000);
const scanTop = topActivity();
ok(scanTop.includes('QrScannerActivity'), 'native QR skaner (CameraX) ochildi');
await shot('qr-skaner');
sh('input keyevent KEYCODE_BACK'); await sleep(1500);
ok(await p.eval("document.querySelector('.screen.active')?.id") === 's-home', 'skanerdan qaytgach bosh sahifa (qulamadi)');
sh(`pm revoke ${PKG} android.permission.CAMERA`); await sleep(1500);      // ruxsatni bekor qilish ilovani to'xtatadi
adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
p = await connectPage();
await p.waitScreen('s-home', 20000);
await p.click('[data-act=scan]');
await sleep(2500);
let denied = false;
for (let i = 0; i < 6 && !denied; i++) { try { denied = tapText(/Don.t allow|Deny|Не разрешать|Запретить|Ruxsat bermaslik/i); } catch { /* dump */ } await sleep(800); }
await sleep(1500);
const toastTxt = (await p.eval("document.querySelector('#toast')?.textContent || ''")) || '';
// Android bir necha marta rad etilgandan keyin so'rovni ko'rsatmay avtomatik rad etadi — ikkala holat to'g'ri
ok(denied || /camera|kamera|камер/i.test(toastTxt), `kamera ruxsati rad etildi (${denied ? "tizim so'rovi" : 'avtomatik rad, xabar: ' + toastTxt.slice(0, 50)})`);
ok(await p.eval("document.querySelector('.screen.active')?.id") === 's-home', 'kamera ruxsati rad etilganda ilova qulamadi, bosh sahifada qoldi');
await p.eval("document.querySelector('#toast')?.textContent");
console.log(`[android ${flavor} · API ${sdk}] 9. ma'lumotni o'chirish`);
await p.click('[data-act=go-profile]');
await p.waitScreen('s-profile');
await p.click('[data-act=reset-ask]');
await p.waitFor("document.querySelector('#o-confirm').classList.contains('open')");
await p.click('#cf-ok');
await sleep(2500);
const names = (await api('GET', '/api/sessions', undefined, T)).flatMap((s) => s.students.map((x) => x.name));
ok(!names.includes('Emulyator Talaba'), 'serverdagi yozuvlar anonimlashtirildi');
const errs = p.logs.filter((l) => !/favicon|Failed to load resource/.test(l));
ok(errs.length === 0, "veb qatlamda xato yo'q" + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
const crash = sh('logcat -d -b crash | grep -c "com.edufocus.app" || true');
ok(crash === '0' || crash === '', `native qulash (crash) yo'q (${crash || 0})`);

p.close();
await srv.stop();
console.log(failed ? `\n${failed} ta tekshiruv muvaffaqiyatsiz` : "\nBarcha tekshiruvlar o'tdi");
process.exit(failed ? 1 : 0);
