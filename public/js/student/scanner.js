// QR skaner. html5-qrcode faqat skaner ochilganda yuklanadi (lazy-load).
import { $, loadScript, haptic, toast } from './util.js';
import { t } from './i18n.js';
import { native } from './native.js';
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

/** Native skaner (AVFoundation / CameraX + ML Kit) mavjud bo'lsa shuni ishlatadi; aks holda veb skaner (html5-qrcode). */
export async function openScanner() {
  if (native.present) {
    const r = await native.safe('scanQR', {}, undefined, 120000);
    if (r && r.text) {
      const code = parseCode(r.text);
      if (code) { haptic([100, 50, 100]); bus.emit('scanned', code); return; }
      toast(t('scan.notEduFocus'));
      return;
    }
    if (r && r.cancelled) return;
    if (r && r.error === 'permission_denied') { toast(t('scan.denied')); return; }
    if (r !== undefined) { if (r && r.error) toast(t('scan.fail')); if (r) return; }
    // native skaner yo'q (undefined) — veb skanerga o'tamiz
  }
  push('s-scan');
}

async function start() {
  const my = ++run;
  handled = false;
  torchOn = false;
  $('#torch-btn').hidden = true;
  hint(t('scan.starting'));
  try {
    await loadScript('/js/html5-qrcode.min.js');
  } catch {
    hint(t('scan.loadFail'), true);
    return;
  }
  if (my !== run) return;
  try {
    const H = window.Html5Qrcode;
    qr = new H('qr-reader', { formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
    await qr.start({ facingMode: facing }, { fps: 12 }, onScan, () => {});
    if (my !== run) { stop(); return; }
    hint(t('scan.hint'));
    try { if (qr.getRunningTrackCameraCapabilities().torchFeature().isSupported()) $('#torch-btn').hidden = false; } catch { /* chiroq yo'q */ }
  } catch (e) {
    if (my !== run) return;
    const denied = /NotAllowed|Permission|denied/i.test(String(e && (e.name || e)));
    hint(denied ? t('scan.denied') : t('scan.fail'), true);
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
  if (!code) { hint(t('scan.notEduFocus'), true); return; }
  handled = true;
  haptic([100, 50, 100]);
  bus.emit('scanned', code);
}

onEnter('s-scan', start);
onLeave('s-scan', stop);

actions.flip = async () => { facing = facing === 'environment' ? 'user' : 'environment'; await stop(); start(); };
actions.torch = async () => {
  try {
    const torch = qr.getRunningTrackCameraCapabilities().torchFeature();
    torchOn = !torchOn;
    await torch.apply(torchOn);
    $('#torch-btn').style.background = torchOn ? 'rgba(250,204,21,.85)' : '';
  } catch { toast(t('scan.noTorch')); }
};
