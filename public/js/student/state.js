// Umumiy holat, hodisa shinasi va ekran navigatsiyasi.
import { $, $$ } from './util.js';

// ---- Holat ----
export const S = {
  name: '',
  code: '',            // qo'shilmoqchi bo'lgan kod
  pendingCode: '',     // ism kiritilgach qo'shiladigan kod
  phase: 'idle',       // idle | joining | joined | ended
  socketUp: false,
  synced: false,       // rejoin/join tasdiqlanganmi
  locked: true,
  endsAt: 0,
  totalSec: 0,
  quiz: null,
  materials: [],
  tool: null,
  sess: null,          // saqlanadigan sessiya yozuvi (qarang net.js)
  summary: null,       // dars tugagandagi ma'lumot
};

// ---- Hodisa shinasi ----
const handlers = {};
export const bus = {
  on(evt, fn) { (handlers[evt] ||= []).push(fn); },
  emit(evt, data) { (handlers[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(evt, e); } }); },
};

// ---- Amallar reestri (data-act) ----
export const actions = {};

// ---- Navigatsiya ----
let base = 's-splash';
let stack = [];
let current = null;
const enterHooks = {};
const leaveHooks = {};
export const onEnter = (id, fn) => { enterHooks[id] = fn; };
export const onLeave = (id, fn) => { leaveHooks[id] = fn; };
export const currentScreen = () => current;
export const hasStack = () => stack.length > 0;

function render(id) {
  if (current === id) return;
  const prev = current;
  current = id;
  $$('.screen').forEach((el) => {
    const on = el.id === id;
    el.classList.toggle('active', on);
    if (on) el.removeAttribute('inert'); else el.setAttribute('inert', '');
  });
  if (prev && leaveHooks[prev]) leaveHooks[prev]();
  if (enterHooks[id]) enterHooks[id]();
  bus.emit('screen', id);
}

export function reset(id) { stack = []; base = id; render(id); }
export function setBase(id) { base = id; if (!stack.length) render(id); }
export function push(id) { if (current === id) return; stack.push(id); render(id); }
export function pop() {
  if (!stack.length) return false;
  stack.pop();
  render(stack[stack.length - 1] || base);
  return true;
}
export function popTo(id) { while (stack.length && current !== id) pop(); }

// ---- Overlaylar ----
export function openOverlay(id) { const el = $('#' + id); if (!el) return; el.classList.add('open'); el.removeAttribute('inert'); bus.emit('overlay', id); }
export function closeOverlay(id) { const el = $('#' + id); if (el) { el.classList.remove('open'); el.setAttribute('inert', ''); } }
export const isOverlayOpen = (id) => !!$('#' + id)?.classList.contains('open');
export function topOverlay() {
  const open = $$('.overlay.open').filter((o) => o.id !== 'o-conn');
  return open.length ? open[open.length - 1].id : null;
}
