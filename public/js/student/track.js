// Anonim onboarding statistikasi (faqat hisoblagichlar: qadam + natija + platforma + qurilma brendi; shaxsiy ma'lumotsiz).
import { native } from './native.js';
import { P } from './protection.js';

const sent = new Set();
export function track(step, outcome) {
  const key = step + ':' + outcome;
  if (sent.has(key)) return;
  sent.add(key);
  const info = P.info || {};
  const body = JSON.stringify({ step, outcome, platform: native.present ? info.platform || native.platform : 'web', brand: info.brand || '' });
  try { fetch('/api/telemetry/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {}); } catch { /* ignore */ }
}
