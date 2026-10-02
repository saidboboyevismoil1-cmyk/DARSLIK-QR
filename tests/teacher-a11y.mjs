// Kontrast va asosiy a11y tekshiruvi (axe-core): ustoz paneli ekranlari, light va dark. WCAG AA: matn kontrasti >= 4.5:1.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, makeApi } from './server/helpers.mjs';
const require = createRequire(import.meta.url);
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const srv = await startServer({ PUSH_MODE: 'mock', RATE_REGISTER_PER_HOUR: '200' }); const api = makeApi(srv.base);
const reg = await api('POST', '/api/register', { name: 'A11y', surname: 'Test', email: 'a11y@example.uz', phone: '', school: '', subject: '', password: 'secret123' });
await api('POST', '/api/groups', { name: 'G' }, reg.token);
const g = await api('POST', '/api/teacher/groups', { name: '101', csv: 'Ali Valiyev,1\nMadina Karimova,2' }, reg.token);
await api('POST', '/api/testpacks', { title: 'T', questions: [{ type: 'single', text: 'Q', options: ['a', 'b'], correct: 0 }] }, reg.token);
await api('POST', '/api/teacher/materials', { kind: 'link', title: 'Slides', url: 'https://example.uz' }, reg.token);
const sess = (await api('POST', '/api/sessions', { name: '101', duration: 30, rosterGroupId: g.id }, reg.token)).session;
const browser = await chromium.launch();
let bad = 0;
for (const [vname, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, locale: 'uz-UZ', serviceWorkers: 'block' });
    await ctx.addInitScript((r) => { localStorage.setItem('ef_t_token', r.token); localStorage.setItem('ef_t_refresh', r.refreshToken); localStorage.setItem('ef_t_teacher', JSON.stringify(r.teacher)); localStorage.setItem('ef_t_tour_' + r.teacher.id, 'true'); }, reg);
    const page = await ctx.newPage();
    for (const route of ['/', '/start', '/groups', '/tests', `/tests/new`, '/reports', '/weekly', '/more', '/settings', '/materials', `/live/${sess.id}`]) {
      await page.goto(`${srv.base}/teacher/#${route}`); await page.waitForTimeout(700);
      await page.addScriptTag({ content: axeSrc });
      const res = await page.evaluate(() => axe.run(document, { runOnly: ['color-contrast', 'button-name', 'label', 'link-name', 'select-name'] }));
      const v = res.violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ') + ' ' + ((n.any[0] && n.any[0].message) || '').slice(0, 90)).join(' | ')}`);
      if (v.length) { bad++; console.log(`✗ ${vname}/${scheme} ${route}\n   ${v.join('\n   ')}`); } else console.log(`✓ ${vname}/${scheme} ${route}`);
    }
    await ctx.close();
  }
}
await browser.close(); await srv.stop();
process.exit(bad ? 1 : 0);
