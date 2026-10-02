// Native qatlam tutuni (eski WebView'li emulyatorlar, masalan API 26, uchun): veb interfeys kerak emas.
// AndroidBridge.invoke ni to'g'ridan-to'g'ri chaqiradi: info, permissions, protection.*, sos, scanQR; qulash (crash) tekshiruvi.
// Ishga tushirish: node tests/android/native-smoke.mjs [direct|store]
import { execFileSync } from 'node:child_process';
import { adb, sh, sleep, connectPage, tapText, topActivity, acceptPinning } from './cdp.mjs';
import { startServer } from '../server/helpers.mjs';

const flavor = (process.argv[2] || 'direct').toLowerCase();
const PKG = 'com.edufocus.app';
const sdk = sh('getprop ro.build.version.sdk');
let failed = 0;
const ok = (c, m) => { if (c) console.log('  ✓', m); else { failed++; console.error('  ✗ FAIL:', m); } };
const isPinned = () => /mLockTaskModeState=(PINNED|LOCKED)/.test(sh('dumpsys activity activities | grep mLockTaskModeState'));
const zen = () => sh('settings get global zen_mode');
/** DND ruxsati: API 28+ — `cmd notification`; eskirgan API (23–27) — tizim sozlamalari ekrani (haqiqiy foydalanuvchidek). */
async function allowDnd() {
  if (Number(sdk) >= 28) { sh(`cmd notification allow_dnd ${PKG}`); return; }
  adb('shell', 'am', 'start', '-a', 'android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS');
  await sleep(2500);
  tapText(/^EduFocus$/); await sleep(1500);
  tapText(/^(ALLOW|Allow)$/); await sleep(1200);
  sh('input keyevent KEYCODE_HOME'); await sleep(600);
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`); await sleep(1500);
}
function disallowDnd() { if (Number(sdk) >= 28) { try { sh(`cmd notification disallow_dnd ${PKG}`); } catch { /* ignore */ } return; } sh('settings delete secure enabled_notification_policy_access_packages'); }

try { execFileSync('pkill', ['-f', 'node server.js']); } catch { /* jarayon yo'q */ }
await sleep(800);
const srv = await startServer({ PORT: '3000', ATTESTATION_MODE: 'log' });
process.on('uncaughtException', async (e) => { console.error(e); try { await srv.stop(); } catch { /* ignore */ } process.exit(2); });
adb('shell', 'am', 'force-stop', PKG);
sh(`pm clear ${PKG}`);
disallowDnd();
sh('settings put global zen_mode 0');
sh('input keyevent KEYCODE_WAKEUP'); sh('wm dismiss-keyguard');
adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
let p;
/** WebView'ga ulanadi va veb o'rniga o'z javob qabul qiluvchimizni o'rnatadi (modul skriptlari eski WebView'da ishlamasligi mumkin). */
const RESOLVER = `if (!window.__res) { window.__res = {}; window.__efNative = { resolve: function (id, j) { window.__res[id] = JSON.parse(j); }, emit: function (e, j) { (window.__ev = window.__ev || []).push([e, j]); } }; } true`;
async function attach() {
  if (p) { try { p.close(); } catch { /* yopiq */ } }
  p = await connectPage(PKG, 9222, 30000);
  await sleep(2500);
  await p.eval(RESOLVER, false);
}
await attach();
let seq = 100;
async function call(method, args = {}, timeout = 30000) {
  const id = ++seq;
  await p.eval(RESOLVER, false);       // sahifa qayta yuklangan bo'lsa resolver qayta o'rnatiladi
  await p.eval(`AndroidBridge.invoke(${id}, ${JSON.stringify(method)}, ${JSON.stringify(JSON.stringify(args))}); true`, false);
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await p.eval(`JSON.stringify((window.__res || {})[${id}] || null)`, false);
    if (r && r !== 'null') return JSON.parse(r);
    await sleep(300);
  }
  throw new Error('javob kelmadi: ' + method);
}
console.log(`[native smoke · ${flavor} · API ${sdk}]`);
const info = (await call('info')).data;
ok(info.platform === 'android' && info.flavor === flavor, `info: ${info.platform} ${info.flavor} v${info.appVersion} Android ${info.osVersion} (${info.brand})`);
ok(flavor === 'direct' ? info.candidates[0] === 'android-full' : info.candidates[0] === 'android-lite', `daraja nomzodlari: ${info.candidates.join(', ')}`);
const perms = (await call('permissions')).data;
ok(perms.some((x) => x.id === 'dnd') && perms.some((x) => x.id === 'pinning'), `ruxsatlar: ${perms.map((x) => x.id + ':' + x.status).join(' ')}`);
const key = (await call('deviceKey')).data.key;
ok(/^dk-[0-9a-f]{48}$/.test(key) && (await call('deviceKey')).data.key === key, 'qurilma kaliti (Keystore) barqaror');

// Ruxsatlarsiz himoya yoqilmaydi
const noDnd = (await call('protection.start', { level: 'android-lite', endsInSec: 60, offlineReleaseSec: 120 })).data;
ok(noDnd.ok === false && noDnd.reason === 'dnd', "DND ruxsatisiz himoya yoqilmadi (reason=dnd)");

for (let i = 0; i < 3; i++) {                        // tizim oynalari ba'zan sekin: granted bo'lguncha qayta uriniladi
  await allowDnd();
  await attach();
  const st = (await call('permissions')).data.find((x) => x.id === 'dnd');
  console.log(`   DND ruxsati (urinish ${i + 1}): ${st.status}`);
  if (st.status === 'granted') break;
}
if (flavor === 'direct') { sh(`settings put secure enabled_accessibility_services ${PKG}/${PKG}.LockAccessibilityService`); sh('settings put secure accessibility_enabled 1'); }
await sleep(1500);
const lvl = flavor === 'direct' ? 'android-full' : 'android-lite';
const zenBefore = zen();                     // himoyadan oldingi DND holati (avvalgi holatga qaytishi kerak)
const startP = call('protection.start', { level: lvl, endsInSec: 90, offlineReleaseSec: 120 }, 60000);
const tapped = await acceptPinning();
const st = (await startP).data;
ok(st.ok === true, `himoya yoqildi (${lvl}); tizim oynasi bosildi: ${tapped}${st.ok ? '' : ' reason=' + st.reason}`);
ok(isPinned(), 'ekran mahkamlangan');
ok(zen() !== '0', `DND yoqilgan (zen_mode=${zen()})`);
const state = (await call('protection.state')).data;
ok(state.active === true && state.checks.pinned === true, `holat: active=${state.active} reasons=${JSON.stringify(state.reasons)}`);
sh('input keyevent KEYCODE_HOME'); await sleep(1500);
ok(topActivity().includes(PKG), 'HOME bosilganda ilova oldinda qoldi');

// Bypass: mahkamlashni olib tashlash → holat o'zgaradi
sh('am task lock stop'); await sleep(2500);
const st2 = (await call('protection.state')).data;
ok(st2.checks.pinned === false || st2.active === false || isPinned(), `pinning olib tashlandi: holat ${JSON.stringify(st2.reasons)} (yoki ilova qayta mahkamladi)`);
await acceptPinning(15000);

// SOS
const sos = (await call('sos', { number: '112' })).data;
await sleep(2500);
ok(sos.ok === true && !topActivity().includes(PKG + '/'), `SOS: telefon ochildi (${(topActivity().match(/[\w.]+\/[\w.]+/) || [''])[0]})`);
adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
await acceptPinning(20000);
await sleep(1500);
ok(isPinned(), 'SOS dan qaytgach himoya qayta yoqildi');

// To'xtatish
await call('protection.stop', { reason: 'test' });
await sleep(1500);
ok(!isPinned() && zen() === zenBefore, `to'xtatgach pinning olib tashlandi va DND avvalgi holatga qaytdi (zen ${zenBefore}→${zen()})`);

// Dars taymeri
const t = (await Promise.all([call('protection.start', { level: lvl, endsInSec: 20, offlineReleaseSec: 120 }, 60000), acceptPinning()]))[0].data;
ok(t.ok === true, 'qisqa taymerli himoya yoqildi');
const t0 = Date.now(); let released = false;
while (Date.now() - t0 < 40000) { if (!isPinned()) { released = true; break; } await sleep(1000); }
ok(released, `taymer tugagach himoya o'zi olib tashlandi (${Math.round((Date.now() - t0) / 1000)} s)`);
const evs = await p.eval('JSON.stringify(window.__ev || [])', false);
ok(/autoRelease/.test(evs) && /timer/.test(evs), 'web tomoniga autoRelease{timer} hodisasi yuborildi');

// QR skaner (kamera ruxsati bilan)
sh(`pm grant ${PKG} android.permission.CAMERA`);
const scan = call('scanQR', {}, 15000).catch(() => null);
await sleep(3500);
ok(topActivity().includes('QrScannerActivity'), 'native QR skaner ochildi');
sh('input keyevent KEYCODE_BACK');
const sr = await scan;
ok(sr && sr.data && sr.data.cancelled === true, 'skaner yopilganda {cancelled:true} qaytdi');

const crash = sh('logcat -d -b crash | grep -c "' + PKG + '" || true');
ok(crash === '0' || crash === '', `native qulash (crash) yo'q (${crash || 0})`);
p.close();
await srv.stop();
console.log(failed ? `\n${failed} ta tekshiruv muvaffaqiyatsiz` : "\nBarcha tekshiruvlar o'tdi");
process.exit(failed ? 1 : 0);
