// Tarjima nazorati: manba kodidagi barcha kalitlar uz/ru/en lug'atlarida bor va bo'sh emas;
// lug'atlarda ishlatilmayotgan ortiqcha kalit yo'q; {param} lar uchala tilda mos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const dir = path.join(root, 'public/js/student');
const html = read('public/student.html');
const js = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'i18n.js').map((f) => read('public/js/student/' + f)).join('\n');

const used = new Set();
for (const m of html.matchAll(/data-i18n(?:-html|-ph|-aria|-title)?="([^"]+)"/g)) used.add(m[1]);
const dynamicPrefixes = [];  // (avtomatik aniqlash endi DYN ro'yxati bilan almashtirilgan)
for (const m of js.matchAll(/\b(?:t|tn)\(\s*(['"`])([^'"`]+)\1/g)) used.add(m[2]);
// dinamik kalitlar: t('prefix.' + x) / t(`prefix.${x}`)
for (const m of js.matchAll(/\bt\(\s*(['"`])([\w.]+\.)\1\s*\+/g)) dynamicPrefixes.push(m[2]);
for (const m of js.matchAll(/\bt\(\s*`([\w.]+\.)\$\{/g)) dynamicPrefixes.push(m[1]);

// Dinamik kalitlar (t('prefix.' + x)) — kutilgan to'liq ro'yxat
const DYN = {
  'emg.': ['call', 'health', 'other'],
  'kind.': ['pdf', 'word', 'ppt', 'excel', 'image', 'text', 'file'],
  'unlock.': ['teacher', 'timer', 'emergency', 'demo', 'offline'],
  'level.': ['ios-l1', 'ios-l2', 'ios-l0', 'android-full', 'android-lite', 'android-l0', 'web'],
  'ready.item.': ['server', 'permissions', 'protection', 'attestation'],
  'ready.protection.fail.': ['unknown', 'browser', 'user_declined', 'pinning_failed', 'accessibility', 'dnd', 'permission', 'timeout', 'error', 'no_reply', 'protection_failed'],
  'roster.err.': ['name_taken', 'device_bound', 'generic'],
  'guide.brand.': ['xiaomi', 'samsung', 'huawei', 'oppo', 'tecno'],
  'rate.l': ['1', '2', '3', '4', '5'],
  'perm.': ['accessibility', 'dnd', 'battery', 'autostart', 'notifications', 'camera', 'screentime', 'pinning', 'usage'].flatMap((x) => [x + '.t', x + '.d']),
  'prot.reason.': ['background', 'not_pinned', 'no_accessibility', 'no_dnd', 'dev_options', 'a11y_shortcut', 'no_assessment', 'no_shield', 'no_authorization', 'permission_revoked', 'screen_off', 'unknown', 'accessibility', 'dnd', 'permission', 'user_declined', 'pinning_failed', 'timeout', 'error', 'no_reply'],
  'join.err.': ['not_found', 'ended', 'network', 'rate', 'app_required', 'protection_required', 'protection_inactive', 'attestation_failed', 'roster_required', 'roster_not_bound', 'name_required', 'timeout', 'socket', 'device_mismatch', 'generic', 'gone', 'protection_failed'],
};
for (const [pre, list] of Object.entries(DYN)) for (const x of list) used.add(pre + x);
used.add('exempt.errMany');   // join.js: shartli kalit (ternary)
for (const k of [...used]) if (k.endsWith('.') || k === 'key' || k === 'rate.l') used.delete(k);
// qadamlar yo'riqnomasi: guide.<ruxsat>.<brend|default>
const GUIDES = { battery: ['default', 'xiaomi', 'samsung', 'huawei', 'oppo', 'tecno'], autostart: ['default', 'xiaomi', 'huawei', 'oppo', 'tecno'], accessibility: ['default'], pinning: ['default', 'samsung', 'xiaomi'], dnd: ['default'], notifications: ['default'], screentime: ['default'] };
for (const [id, brands] of Object.entries(GUIDES)) for (const b of brands) used.add(`guide.${id}.${b}`);

const langs = {};
for (const l of ['uz', 'ru', 'en']) langs[l] = (await import(path.join(dir, 'i18n', l + '.js'))).default;
const plural = (k, d) => k.endsWith('.one') || k.endsWith('.few') || k.endsWith('.many') || k.endsWith('.other') ? k.replace(/\.(one|few|many|other)$/, '') : null;

let bad = 0;
const fail = (m) => { bad++; console.error('  ✗', m); };
for (const l of Object.keys(langs)) {
  for (const k of used) {
    const has = k in langs[l] || ['one', 'other', 'few', 'many'].some((f) => `${k}.${f}` in langs[l]);
    if (!has) fail(`[${l}] kalit yo'q: ${k}`);
  }
  for (const [k, v] of Object.entries(langs[l])) if (typeof v !== 'string' || !v.trim()) fail(`[${l}] bo'sh qiymat: ${k}`);
}
for (const k of Object.keys(langs.uz)) {
  for (const l of ['ru', 'en']) if (!(k in langs[l])) fail(`[${l}] uz'da bor, bunda yo'q: ${k}`);
  const base = plural(k) || k;
  const isUsed = used.has(k) || used.has(base);
  if (!isUsed) fail(`ishlatilmaydi: ${k}`);
  const params = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const l of ['ru', 'en']) if (langs[l][k] !== undefined && params(langs[l][k]) !== params(langs.uz[k]) && !k.endsWith('.few') && !k.endsWith('.many')) fail(`[${l}] {param} mos emas: ${k}`);
}
console.log(`kalitlar: ${used.size} ta ishlatiladi; lug'atlar: uz ${Object.keys(langs.uz).length}, ru ${Object.keys(langs.ru).length}, en ${Object.keys(langs.en).length}`);
console.log(bad ? `${bad} ta muammo` : 'Tarjimalar to\'liq va izchil');
process.exit(bad ? 1 : 0);
