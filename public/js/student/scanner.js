// QR skaner. html5-qrcode faqat skaner ochilganda yuklanadi (lazy-load).
import { $, loadScript, haptic, toast } from './util.js';
import { bus, actions, push, onEnter, onLeave } from './state.js';

let qr = null;
let facing = 'environment';
let run = 0;
let handled = false;
let torchOn = false;

const hint = (msg, bad = false) => { const h = $('#scan-hint'); h.textContent = msg; h.classList.toggle('bad', bad); };

export function parseCode(text) {
  if (!text) return null;
  text = String(text).trim();
  try {
    const u = new URL(text);
    const s = u.searchParams.get('session');
    if (s && /^\d{6}$/.test(s.trim())) return s.trim();
  } catch { /* URL emas */ }
  const m = text.match(/(?:session|code)[=:/](\d{6})\b/i);
  if (m) return m[1];
  return /^\d{6}$/.test(text) ? text : null;
}

export const openScanner = () => push('s-scan');

async function start() {
  const my = ++run;
  handled = false;
  torchOn = false;
  $('#torch-btn').hidden = true;
  hint('Kamera ishga tushmoqda…');
  try {
    await loadScript('/js/html5-qrcode.min.js');
  } catch {
    hint("Skaner yuklanmadi. Internetni tekshiring yoki kodni qo'lda kiriting.", true);
    return;
  }
  if (my !== run) return;
  try {
    const H = window.Html5Qrcode;
    qr = new H('qr-reader', { formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
    await qr.start({ facingMode: facing }, { fps: 12 }, onScan, () => {});
    if (my !== run) { stop(); return; }
    hint('Kamerani ustozning QR kodiga qarating');
    try { if (qr.getRunningTrackCameraCapabilities().torchFeature().isSupported()) $('#torch-btn').hidden = false; } catch { /* chiroq yo'q */ }
  } catch (e) {
    if (my !== run) return;
    const denied = /NotAllowed|Permission|denied/i.test(String(e && (e.name || e)));
    hint(denied ? "Kameraga ruxsat berilmagan. Sozlamalardan ruxsat bering yoki kodni qo'lda kiriting." : "Kamerani ochib bo'lmadi. Kodni qo'lda kiriting.", true);
  }
}

async function stop() {
  run++;
  const q = qr;
  qr = null;
  if (!q) return;
  try { if (q.isScanning) await q.stop(); } catch { /* ignore */ }
  try { q.clear(); } catch { /* ignore */ }
}

function onScan(text) {
  if (handled) return;
  const code = parseCode(text);
  if (!code) { hint("Bu EduFocus dars QR kodi emas. Qayta urinib ko'ring.", true); return; }
  handled = true;
  haptic([100, 50, 100]);
  bus.emit('scanned', code);
}

onEnter('s-scan', start);
onLeave('s-scan', stop);

actions.flip = async () => { facing = facing === 'environment' ? 'user' : 'environment'; await stop(); start(); };
actions.torch = async () => {
  try {
    const t = qr.getRunningTrackCameraCapabilities().torchFeature();
    torchOn = !torchOn;
    await t.apply(torchOn);
    $('#torch-btn').style.background = torchOn ? 'rgba(250,204,21,.85)' : '';
  } catch { toast("Bu qurilmada chiroqni yoqib bo'lmadi"); }
};
