// Ustoz ruxsat bergan vositalar: kalkulyator va dars manbasi (brauzer).
import { $, safeUrl, native, toast, haptic } from './util.js';
import { S, bus, actions, openOverlay, closeOverlay } from './state.js';

// ---------- Kalkulyator (eval ishlatilmaydi) ----------
const KEYS = ['C', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '⌫', '='];
const OPS = ['÷', '×', '−', '+'];
let acc = null, op = null, cur = '0', fresh = false, expr = '';

const fmt = (n) => (Number.isFinite(n) ? String(Math.round(n * 1e10) / 1e10) : 'Xato');
function compute(a, b, o) { return o === '+' ? a + b : o === '−' ? a - b : o === '×' ? a * b : b === 0 ? NaN : a / b; }
function press(k) {
  if (cur === 'Xato' && k !== 'C') { acc = null; op = null; cur = '0'; expr = ''; }
  if (/^\d$/.test(k)) { cur = fresh || cur === '0' ? k : cur + k; fresh = false; }
  else if (k === '.') { if (fresh) { cur = '0.'; fresh = false; } else if (!cur.includes('.')) cur += '.'; }
  else if (k === 'C') { acc = null; op = null; cur = '0'; expr = ''; fresh = false; }
  else if (k === '⌫') { cur = cur.length > 1 && !fresh ? cur.slice(0, -1) : '0'; }
  else if (k === '±') { if (cur !== '0') cur = cur.startsWith('-') ? cur.slice(1) : '-' + cur; }
  else if (k === '%') { cur = fmt(parseFloat(cur) / 100); }
  else if (OPS.includes(k)) {
    const v = parseFloat(cur);
    acc = op && !fresh ? compute(acc, v, op) : v;
    op = k; fresh = true; cur = fmt(acc); expr = `${cur} ${k}`;
  } else if (k === '=') {
    if (op) {
      const b = parseFloat(cur);
      const r = compute(acc, b, op);
      expr = `${fmt(acc)} ${op} ${cur} =`;
      cur = fmt(r); acc = null; op = null; fresh = true;
    }
  }
  $('#calc-out').textContent = cur;
  $('#calc-expr').textContent = expr;
  haptic(6);
}
$('#calc-grid').innerHTML = KEYS.map((k) => `<button type="button" data-k="${k}" class="${OPS.includes(k) || k === '%' ? 'op' : ''} ${k === '=' ? 'eq' : ''}" aria-label="${k}">${k}</button>`).join('');
$('#calc-grid').addEventListener('click', (e) => { const b = e.target.closest('button[data-k]'); if (b) press(b.dataset.k); });

// ---------- Vositani ochish ----------
function showTool(launchNative) {
  const t = S.tool;
  if (!t) return;
  if (t.tool === 'calculator') {
    if (launchNative && native.android && native.call('openCalculator')) return;
    openOverlay('o-calc');
  } else if (t.tool === 'browser') {
    const url = safeUrl(t.url) || 'https://uz.wikipedia.org';
    if (launchNative && native.android && native.call('openBrowser', url)) return;
    $('#tool-title').textContent = t.appName || 'Dars manbasi';
    $('#tool-link').href = url;
    openOverlay('o-tool');
  }
}

bus.on('tool', (d) => {
  if (d.action === 'open') {
    showTool(true);
    toast(d.tool === 'calculator' ? '🧮 Ustoz kalkulyatorga ruxsat berdi' : `🌐 Ustoz «${d.appName || 'dars manbasi'}»ga ruxsat berdi`);
  } else {
    closeOverlay('o-calc');
    closeOverlay('o-tool');
    toast('🔒 Ustoz vositalardan foydalanishni yakunladi');
  }
});
bus.on('applied', ({ fresh }) => { if (fresh && S.tool) showTool(false); });
actions['open-tool'] = () => showTool(true);
