import { $, esc, icon, store } from './util.js';
import { t } from './i18n.js';

export function toast(msg, kind = '') {
  const box = $('#toasts'); if (!box) return;
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg; box.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
export const toastErr = (e) => toast((e && e.message && e.message !== 'error' && e.status && e.status < 500 ? e.message : t('common.error')), 'bad');

/** Pastki varaq / dialog. bind(el, close) hodisalarni bog'laydi; [data-close] bosilsa yopiladi. */
export function sheet({ html, bind, dialog = false, onClose }) {
  const host = $('#overlays');
  const scrim = document.createElement('div'); scrim.className = 'scrim' + (dialog ? ' dialog' : '');
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${dialog ? '' : '<div class="grab"></div>'}${html}</div>`;
  host.appendChild(scrim);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = (v) => { scrim.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(v); };
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); const b = e.target.closest('[data-close]'); if (b) close(); });
  const first = scrim.querySelector('[autofocus],input,textarea,select'); if (first && !('ontouchstart' in window)) first.focus();
  if (bind) bind(scrim.querySelector('.sheet'), close);
  return { el: scrim, close };
}

/** Tasdiq oynasi: xavfli amallar uchun. → true/false */
export function confirmBox({ title, text, ok, danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    sheet({ dialog: true, onClose: () => { if (!done) resolve(false); },
      html: `<h2>${esc(title)}</h2>${text ? `<p class="muted" style="margin-top:8px">${esc(text)}</p>` : ''}
        <div class="stack" style="margin-top:18px"><button class="btn ${danger ? 'bad' : 'pri'} block" data-ok>${esc(ok)}</button><button class="btn ghost block" data-close>${esc(t('common.cancel'))}</button></div>`,
      bind: (el, close) => { el.querySelector('[data-ok]').onclick = () => { done = true; close(); resolve(true); }; } });
  });
}

/** Matn kiritish oynasi (parol, daqiqa va h.k.). → string | null */
export function promptBox({ title, text, label, type = 'text', ok, danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    sheet({ dialog: true, onClose: () => { if (!done) resolve(null); },
      html: `<h2>${esc(title)}</h2>${text ? `<p class="muted" style="margin:8px 0 12px">${esc(text)}</p>` : ''}
        <label class="lbl" for="pb" style="margin-top:10px">${esc(label)}</label><input id="pb" class="field" type="${type}" ${type === 'number' ? 'inputmode="numeric"' : ''} autocomplete="current-password">
        <div class="stack" style="margin-top:16px"><button class="btn ${danger ? 'bad' : 'pri'} block" data-ok>${esc(ok)}</button><button class="btn ghost block" data-close>${esc(t('common.cancel'))}</button></div>`,
      bind: (el, close) => {
        const inp = el.querySelector('#pb');
        const go = () => { done = true; close(); resolve(inp.value); };
        el.querySelector('[data-ok]').onclick = go; inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      } });
  });
}

// ---------- Mavzu
export function applyTheme() {
  const th = store.get('ef_t_theme', 'auto');
  if (th === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', th);
}
export function setTheme(th) { store.set('ef_t_theme', th); applyTheme(); }
export const getTheme = () => store.get('ef_t_theme', 'auto');

export function emptyState({ ico, title, text, action }) {
  return `<div class="empty"><div class="big">${icon(ico)}</div><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action || ''}</div>`;
}
export const spinner = () => `<div class="center" style="padding:40px"><span class="spinner"></span></div>`;
