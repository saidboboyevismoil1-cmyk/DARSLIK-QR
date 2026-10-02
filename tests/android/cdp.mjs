// Android emulyatoridagi WebView'ni Chrome DevTools Protocol orqali boshqarish (Playwright Android WebView'ni qo'llamaydi).
import { execFileSync } from 'node:child_process';

export const ADB = process.env.ADB || `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
export const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).replace(/\r/g, '');
export const sh = (cmd) => adb('shell', cmd).trim();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pid(pkg = 'com.edufocus.app') { try { return sh(`pidof ${pkg}`).split(/\s+/)[0]; } catch { return ''; } }

export async function connectPage(pkg = 'com.edufocus.app', port = 9222, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const p = pid(pkg);
    if (p) {
      try { adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${p}`); } catch { /* qayta uriniladi */ }
      try {
        const list = await (await fetch(`http://localhost:${port}/json`)).json();
        const page = list.find((x) => x.type === 'page');
        if (page) return await open(page.webSocketDebuggerUrl);
      } catch { /* hali tayyor emas */ }
    }
    await sleep(500);
  }
  throw new Error('WebView DevTools ga ulanib bo\'lmadi');
}

function open(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0; const waits = new Map(); const logs = [];
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && waits.has(d.id)) { const w = waits.get(d.id); waits.delete(d.id); d.error ? w.rej(new Error(d.error.message)) : w.res(d.result); }
      else if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
      else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
    };
    ws.onerror = (e) => reject(e);
    ws.onopen = () => {
      const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waits.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
      const api = {
        logs, send,
        async eval(expr, awaitPromise = true) {
          const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
          return r.result.value;
        },
        async waitFor(expr, timeout = 15000, label = expr) {
          const t0 = Date.now();
          while (Date.now() - t0 < timeout) { try { if (await api.eval(`!!(${expr})`)) return true; } catch { /* sahifa yangilanmoqda */ } await sleep(250); }
          throw new Error('Kutilgan holat bo\'lmadi: ' + label);
        },
        click: (sel) => api.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('topilmadi: ${sel.replace(/'/g, "\\'")}'); e.click(); return true; })()`),
        screen: () => api.eval(`document.querySelector('.screen.active')?.id`),
        waitScreen: (id, t = 15000) => api.waitFor(`document.querySelector('.screen.active')?.id === ${JSON.stringify(id)}`, t, 'ekran ' + id),
        text: (sel) => api.eval(`document.querySelector(${JSON.stringify(sel)})?.textContent`),
        close: () => ws.close(),
      };
      send('Runtime.enable').then(() => resolve(api), reject);
    };
  });
}

// ---------- UI (tizim oynalari) ----------
export function ui() {
  // --windows (API 34+): tizim oynalari (masalan "App is pinned") ham ko'rinadi
  try { adb('shell', 'uiautomator', 'dump', '--windows', '/sdcard/ui.xml'); } catch { adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml'); }
  return adb('exec-out', 'cat', '/sdcard/ui.xml');
}
/** Matn bo'yicha elementni topib bosadi (masalan tizim "Screen pinning" oynasidagi "Start"). */
export function tapText(re, xml = ui()) {
  const nodes = [...xml.matchAll(/<node [^>]*?text="([^"]*)"[^>]*?clickable="(true|false)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)];
  const hit = nodes.find((n) => re.test(n[1]) && n[1].length);
  if (!hit) return false;
  const [, , , x1, y1, x2, y2] = hit.map((v, i) => (i >= 3 ? Number(v) : v));
  sh(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
  return true;
}
export function topActivity() {
  const o = sh('dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | head -2');
  return o;
}
export const pinnedState = () => sh('dumpsys activity activities | grep -iE "mLockTaskModeState|lockTaskMode" | head -3');

/**
 * Tizimning "Ekranni mahkamlash" tasdiq oynasini qabul qiladi (Got it / Start).
 * API 34+: uiautomator --windows matnni topadi. Eski API'larda oyna uiautomator'da ko'rinmaydi —
 * ScreenPinningConfirmation oynasi mavjudligi tekshirilib, tugma koordinata bo'yicha bosiladi (≈79.6% × 95.5%).
 */
export async function acceptPinning(timeout = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (tapText(/^(Start|Got it|GOT IT|OK|Boshlash|Начать|Понятно)$/i)) return true; } catch { /* dump xatosi */ }
    try {
      if (sh('dumpsys window windows | grep -c ScreenPinningConfirmation').trim() !== '0') {
        const m = sh('wm size').match(/(\d+)x(\d+)/);
        if (m) { sh(`input tap ${Math.round(Number(m[1]) * 0.796)} ${Math.round(Number(m[2]) * 0.955)}`); await sleep(800); return true; }
      }
    } catch { /* oyna yo'q */ }
    await sleep(700);
  }
  return false;
}
