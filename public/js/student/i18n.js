// Ko'p tillilik: uz (asosiy), ru, en. Kalit topilmasa uz'ga, so'ng kalitning o'ziga qaytadi.
//   t('key', {n: 3})            — matn, {n} o'rniga qiymat
//   tn('key', n)                — son bo'yicha shakl: key.one / key.few / key.many / key.other
//   data-i18n="key"             — textContent
//   data-i18n-html="key"        — innerHTML (faqat ishonchli lug'at matnlari)
//   data-i18n-ph / -aria / -title — placeholder / aria-label / title
import { store } from './util.js';

export const LANGS = [{ code: 'uz', label: "O'zbekcha" }, { code: 'ru', label: 'Русский' }, { code: 'en', label: 'English' }];
let current = 'uz';
let dict = {};
let base = {};
const listeners = [];

export function detectLang() {
  const saved = store.get('ef_lang');
  if (LANGS.some((l) => l.code === saved)) return saved;
  const nav = String((navigator.languages && navigator.languages[0]) || navigator.language || 'uz').toLowerCase();
  if (nav.startsWith('ru')) return 'ru';
  if (nav.startsWith('en')) return 'en';
  return 'uz';
}

async function load(code) {
  const mod = await import(`./i18n/${code}.js`);
  return mod.default;
}

export async function initI18n() {
  base = await load('uz');
  current = detectLang();
  dict = current === 'uz' ? base : await load(current);
  document.documentElement.lang = current;
  applyDom();
}

export async function setLang(code) {
  if (!LANGS.some((l) => l.code === code)) return;
  current = code;
  store.set('ef_lang', code);
  dict = code === 'uz' ? base : await load(code);
  document.documentElement.lang = code;
  applyDom();
  listeners.forEach((f) => { try { f(code); } catch (e) { console.error(e); } });
}

export const lang = () => current;
export const onLangChange = (f) => listeners.push(f);

function fill(s, p) { return p ? s.replace(/\{(\w+)\}/g, (m, k) => (p[k] === undefined ? m : p[k])) : s; }

export function t(key, params) {
  const s = dict[key] !== undefined ? dict[key] : base[key] !== undefined ? base[key] : key;
  return fill(s, params);
}

/** Son bo'yicha shakl. Ruscha: 1 / 2–4 / 5+ ; boshqa tillarda: 1 / boshqa. */
export function tn(key, n) {
  let form = n === 1 ? 'one' : 'other';
  if (current === 'ru') {
    const m10 = n % 10, m100 = n % 100;
    form = m10 === 1 && m100 !== 11 ? 'one' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'few' : 'many';
  }
  const k = `${key}.${form}`;
  return t(dict[k] !== undefined || base[k] !== undefined ? k : `${key}.other`, { n });
}

export function applyDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.setAttribute('placeholder', t(el.dataset.i18nPh)); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.setAttribute('title', t(el.dataset.i18nTitle)); });
}
