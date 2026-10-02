// Ustoz ruxsat bergan vositalar: kalkulyator va dars manbasi (brauzer).
import { $, safeUrl, toast, haptic } from './util.js';
import { S, bus, actions, openOverlay, closeOverlay } from './state.js';
import { t } from './i18n.js';
import { native } from './native.js';

// ---------- Kalkulyator (eval ishlatilmaydi) ----------
const KEYS = ['C', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '⌫', '='];
const OPS = ['÷', '×', '−', '+'];
let acc = null, op = null, cur = '0', fresh = false, expr = '';

const fmt = (n) => (Number.isFinite(n) ? String(Math.round(n * 1e10) / 1e10) : t('tools.error'));
function compute(a, b, o) { return o === '+' ? a + b : o === '−' ? a - b : o === '×' ? a * b : b === 0 ? NaN : a / b; }
function press(k) {
  if (cur === t('tools.error') && k !== 'C') { acc = null; op = null; cur = '0'; expr = ''; }
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
async function showTool(launchNative) {
  const tool = S.tool;
  if (!tool) return;
  if (tool.tool === 'calculator') {
    if (launchNative && native.present && native.platform === 'android') {
      const r = await native.safe('openCalculator', {}, null, 5000);
      if (r && r.ok) return;
    }
    openOverlay('o-calc');
  } else if (tool.tool === 'browser') {
    const url = safeUrl(tool.url) || 'https://uz.wikipedia.org';
    if (launchNative && native.present) {   // Custom Tabs / SFSafariViewController
      const r = await native.safe('openExternal', { url }, null, 5000);
      if (r && r.ok) return;
    }
    $('#tool-title').textContent = tool.appName || t('tools.source');
    $('#tool-link').href = url;
    openOverlay('o-tool');
  }
}

bus.on('tool', (d) => {
  if (d.action === 'open') {
    showTool(true);
    toast(d.tool === 'calculator' ? t('tools.calcAllowed') : t('tools.siteAllowed', { name: d.appName || t('tools.source') }));
  } else {
    closeOverlay('o-calc');
    closeOverlay('o-tool');
    toast(t('tools.ended'));
  }
});
bus.on('applied', ({ fresh }) => { if (fresh && S.tool) showTool(false); });
actions['open-tool'] = () => showTool(true);
