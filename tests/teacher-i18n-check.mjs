// Ustoz paneli tarjimalari: kodda ishlatilgan har bir kalit jadvalda bor, jadvalda hamma til to'ldirilgan, ishlatilmaydigan kalit yo'q.
import fs from 'node:fs';
import path from 'node:path';
import { KEYS, TABLE } from '../public/teacher/js/i18n.js';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../public/teacher/js/', import.meta.url));
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); } })(root);
const src = files.filter((f) => !f.endsWith('i18n.js')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const used = new Set([...src.matchAll(/\bt\(\s*'([\w.]+)'/g)].map((m) => m[1]));
// dinamik kalitlar: prefiks bo'yicha
const dynamic = [/^tests\.t\./, /^st\./, /^rs\./, /^tour\.\d\./, /^level\./, /^set\.theme/, /^nav\./];
for (const m of src.matchAll(/t\(\s*'([\w.]+)'\s*\+/g)) used.add(m[1] + '*');
for (const m of src.matchAll(/t\(\s*`([\w.]+)\$\{/g)) used.add(m[1] + '*');
let bad = 0;
for (const k of used) { if (k.endsWith('*')) continue; if (!TABLE[k] && !dynamic.some((r) => r.test(k))) { console.log('✗ jadvalda yo\'q:', k); bad++; } }
for (const k of KEYS) { const r = TABLE[k]; if (r.length !== 3 || r.some((x) => !String(x).trim())) { console.log('✗ til to\'liq emas:', k); bad++; }
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(); if (new Set(r.map(ph)).size > 1) { console.log('✗ {o\'rin} belgilari mos emas:', k, r.map(ph)); bad++; } }
const usedAll = [...used].filter((k) => !k.endsWith('*'));
const unused = KEYS.filter((k) => !usedAll.includes(k) && !dynamic.some((r) => r.test(k)) && !src.includes(`'${k}'`) && !src.includes(`"${k}"`));
if (unused.length) console.log('ℹ ishlatilmagan kalitlar:', unused.join(', '));
console.log(`kalitlar: ${KEYS.length}, kodda ishlatilgan: ${usedAll.length}`);
console.log(bad ? `${bad} ta xato` : 'Tarjimalar to\'liq va izchil');
process.exit(bad ? 1 : 0);
