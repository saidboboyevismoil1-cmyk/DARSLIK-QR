// Umumiy yordamchilar: DOM, xavfsiz matn, saqlash, lazy-load, native ko'prik.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  clearApp() {
    try { Object.keys(localStorage).filter((k) => k.startsWith('ef_') || k.startsWith('edufocus_') || k.startsWith('hemis_')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  },
};

const scriptCache = {};
export function loadScript(src) {
  if (scriptCache[src]) return scriptCache[src];
  scriptCache[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { delete scriptCache[src]; reject(new Error('Yuklanmadi: ' + src)); };
    document.head.appendChild(s);
  });
  return scriptCache[src];
}

export const pad = (n) => String(n).padStart(2, '0');
export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(sec % 60)}` : `${pad(m)}:${pad(sec % 60)}`;
}

export const haptic = (pattern) => { try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* ignore */ } };

// Faqat http(s) va shu domen yo'llariga ruxsat.
export function safeUrl(u) {
  try {
    const url = new URL(u, location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

let toastTimer = null;
export function toast(msg, ms = 3500) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
