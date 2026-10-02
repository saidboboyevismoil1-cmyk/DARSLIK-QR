// Ochilish tezligi: sekin 4G + 4x sekin CPU. Sovuq (keshsiz) va issiq (service worker keshi bilan) yuklash.
import { chromium, devices } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:3000';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
// onboarding'ni o'tkazib yuborish uchun ism va flag oldindan qo'yiladi
await ctx.addInitScript(() => { try { localStorage.setItem('ef_onboarded', 'true'); localStorage.setItem('ef_name', '"Test"'); } catch {} });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const reqs = [];
page.on('response', async (r) => { try { const b = await r.body(); reqs.push([new URL(r.url()).pathname, b.length, r.fromServiceWorker()]); } catch {} });

async function measure(label) {
  reqs.length = 0;
  const t = Date.now();
  await page.goto(BASE + '/student.html');
  await page.waitForFunction(() => document.querySelector('.screen.active')?.id === 's-home');
  const ms = Date.now() - t;
  await page.waitForTimeout(600);
  const bytes = reqs.reduce((a, r) => a + r[1], 0);
  const heavy = reqs.filter((r) => /pdf|html5-qrcode/.test(r[0]));
  console.log(`${label}: bosh ekran ${ms} ms | ${reqs.length} so'rov | ${(bytes / 1024).toFixed(0)} KB | og'ir kutubxonalar yuklandi: ${heavy.length ? 'HA' : "yo'q"}`);
  return { ms, heavy: heavy.length };
}
const cold = await measure('sovuq (keshsiz)');
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(1500);
const warm = await measure("issiq (SW keshi)");
await browser.close();
const ok = cold.heavy === 0 && warm.heavy === 0 && warm.ms < 2000;
console.log(ok ? 'OK: 2 soniyadan tez, lazy-load ishlayapti' : 'DIQQAT: maqsadga erishilmadi');
process.exit(ok ? 0 : 1);
