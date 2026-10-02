import { $, $$, esc, icon, store } from './util.js';
import { t, setLang, detectLang, getLang } from './i18n.js';
import { session, onAuth, onQueue, queued, flushQueue, refreshNow, closeSocket } from './api.js';
import { applyTheme, toast } from './ui.js';

setLang(detectLang());
applyTheme();

const ROUTES = [
  { re: /^\/login$/, mod: 'auth', fn: 'login', bare: true },
  { re: /^\/register$/, mod: 'auth', fn: 'register', bare: true },
  { re: /^\/forgot$/, mod: 'auth', fn: 'forgot', bare: true },
  { re: /^\/reset$/, mod: 'auth', fn: 'reset', bare: true },
  { re: /^\/$/, mod: 'home', tab: 'home' },
  { re: /^\/start$/, mod: 'start', tab: 'home' },
  { re: /^\/live\/(\w+)$/, mod: 'live', tab: 'home' },
  { re: /^\/groups$/, mod: 'groups', tab: 'groups' },
  { re: /^\/groups\/([\w-]+)$/, mod: 'groups', fn: 'detail', tab: 'groups' },
  { re: /^\/tests$/, mod: 'tests', tab: 'tests' },
  { re: /^\/tests\/(new|[\w-]+)$/, mod: 'tests', fn: 'editor', tab: 'tests' },
  { re: /^\/reports$/, mod: 'reports', tab: 'reports' },
  { re: /^\/reports\/(\w+)$/, mod: 'reports', fn: 'detail', tab: 'reports' },
  { re: /^\/weekly$/, mod: 'reports', fn: 'weekly', tab: 'reports' },
  { re: /^\/more$/, mod: 'more', tab: 'more' },
  { re: /^\/materials$/, mod: 'materials', tab: 'more' },
  { re: /^\/settings$/, mod: 'more', fn: 'settings', tab: 'more' },
  { re: /^\/admin$/, mod: 'admin', tab: 'more', admin: true },
];
const TABS = [['home', 'nav.home', 'home', '/'], ['groups', 'nav.groups', 'users', '/groups'], ['tests', 'nav.tests', 'test', '/tests'], ['reports', 'nav.reports', 'chart', '/reports'], ['more', 'nav.more', 'more', '/more']];

const app = $('#app');
let current = null, navToken = 0;

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export const go = (path, replace = false) => { const h = '#' + path; if (replace) location.replace(h); else location.hash = h; };
export const back = (fallback = '/') => { if (history.length > 1 && document.referrer !== '') history.back(); else go(fallback); };

function shell(tab, isAdmin) {
  const nav = TABS.map(([id, key, ico, href]) => `<a href="#${href}" ${tab === id ? 'aria-current="page"' : ''} data-tab="${id}">${icon(ico)}<span>${esc(t(key))}</span></a>`).join('');
  const adminLink = isAdmin ? `<a href="#/admin" ${tab === 'admin' ? 'aria-current="page"' : ''}>${icon('admin')}<span>${esc(t('nav.admin'))}</span></a>` : '';
  app.innerHTML = `
    <aside class="side"><div class="brand">EduFocus</div>${nav}${adminLink}<div class="sp"></div><a href="#" data-tour>${icon('help')}<span>${esc(t('nav.help'))}</span></a></aside>
    <div class="col"><div class="netbar" id="netbar" hidden></div><header class="topbar" id="topbar"></header><main id="view" tabindex="-1"></main></div>
    <nav class="tabbar" aria-label="Menu">${nav}</nav>`;
  app.querySelector('[data-tour]').onclick = (e) => { e.preventDefault(); import('./tour.js').then((m) => m.open()); };
}

export function setTop({ title, backTo, actions = '' }) {
  const bar = $('#topbar'); if (!bar) return;
  bar.innerHTML = `${backTo ? `<button class="iconbtn back" data-back aria-label="${esc(t('common.back'))}">${icon('back')}</button>` : ''}<h1 class="ellipsis">${esc(title)}</h1>${actions}`;
  const b = bar.querySelector('[data-back]'); if (b) b.onclick = () => (typeof backTo === 'string' ? go(backTo) : history.back());
  document.title = `${title} — EduFocus`;
}

let busyHash = null;
async function route() {
  const h0 = location.hash;
  if (busyHash === h0) return;                 // bir xil manzil uchun takroriy hodisa (ikki marta render qilinmasin)
  busyHash = h0;
  try { await route1(); } finally { if (busyHash === h0) busyHash = null; }
}
async function route1() {
  const my = ++navToken;
  const { path, query } = parseHash();
  const r = ROUTES.find((x) => x.re.test(path));
  if (current && current.unmount) { try { current.unmount(); } catch { /* */ } }
  current = null;
  const bareAuth = r && r.bare;
  if (!r) return go('/', true);
  if (!bareAuth && !session.loggedIn) return go('/login', true);
  if (bareAuth && r.fn === 'login' && session.loggedIn) return go('/', true);
  const teacher = session.teacher;
  if (r.admin && (!teacher || teacher.role !== 'admin')) return go('/', true);
  const mod = await import(`./screens/${r.mod}.js`);
  if (my !== navToken) return;
  const args = (r.re.exec(path) || []).slice(1);
  if (bareAuth) { app.innerHTML = '<main id="view" style="max-width:none;padding:0"></main>'; }
  else if (!$('#topbar') || app.dataset.tab !== r.tab || app.dataset.lang !== getLang() || app.dataset.role !== (teacher && teacher.role)) { shell(r.tab, teacher && teacher.role === 'admin'); app.dataset.tab = r.tab; app.dataset.lang = getLang(); app.dataset.role = teacher ? teacher.role : ''; }
  else $$('.tabbar a, .side a[data-tab]').forEach((a) => { if (a.dataset.tab === r.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (bareAuth) delete app.dataset.tab;
  const view = $('#view'); view.innerHTML = '';
  const screen = await (mod[r.fn || 'default'])({ args, query, go, setTop, view, stale: () => my !== navToken });
  if (my !== navToken) { if (screen && screen.unmount) screen.unmount(); return; }
  current = screen || null;
  window.scrollTo(0, 0);
  if (!bareAuth) maybeTour();
}
window.addEventListener('hashchange', route);

function maybeTour() {
  const tc = session.teacher; if (!tc) return;
  const key = 'ef_t_tour_' + tc.id;
  if (!store.get(key, false)) { store.set(key, true); import('./tour.js').then((m) => m.open()); }
}

// ---------- Tarmoq holati / navbat
function netBar() {
  const bar = $('#netbar'); if (!bar) return;
  const q = queued();
  if (!navigator.onLine) { bar.hidden = false; bar.textContent = t('common.offline') + (q ? ` (${q})` : ''); }
  else if (q) { bar.hidden = false; bar.textContent = t('common.queued') + ` (${q})`; }
  else bar.hidden = true;
}
window.addEventListener('online', () => { netBar(); flushQueue(); });
window.addEventListener('offline', netBar);
onQueue((n, sent) => { netBar(); if (sent) toast(t('common.sent'), 'ok'); });
setInterval(() => { if (navigator.onLine && queued()) flushQueue(); netBar(); }, 15000);

onAuth(() => { if (!session.loggedIn) { closeSocket(); if (!/^#\/(login|register|forgot|reset)/.test(location.hash)) go('/login', true); } });

export function rerender() { app.dataset.lang = ''; route(); }
(async () => {
  if (session.refresh && !session.token) await refreshNow();
  if (!location.hash) location.hash = session.loggedIn ? '#/' : '#/login';
  route();
})();
