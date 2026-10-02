// Birinchi kirishda 5 ekranlik interaktiv qo'llanma; "?" tugmasi orqali qayta ochiladi.
import { esc, icon, $ } from './util.js';
import { t } from './i18n.js';

const mocks = [
  () => `<div class="card flat" style="width:100%"><div class="item"><div class="ico">${icon('users')}</div><b class="grow">101-guruh</b><span class="badge ok">${icon('check')} CSV</span></div></div><div class="btn soft pulse">${icon('plus')}${esc(t('groups.new'))}</div>`,
  () => `<div class="btn pri xl block pulse" style="pointer-events:none">${icon('play')}${esc(t('home.start'))}</div><div class="chips"><span class="chip on">101</span><span class="chip">${esc(t('common.minutes', { n: 45 }))}</span></div>`,
  () => `<div style="background:#fff;border-radius:14px;padding:10px;display:grid;place-items:center">${icon('qr').replace('class="i ', 'style="width:96px;height:96px;color:#0f172a" class="i ')}</div><b style="font-size:26px;letter-spacing:.12em">482 915</b>`,
  () => `<div class="tiles" style="width:100%"><div class="tile ok"><b>24</b><span>${esc(t('tour.mock.green'))}</span></div><div class="tile warn pulse"><b>2</b><span>${esc(t('tour.mock.yellow'))}</span></div><div class="tile bad"><b>1</b><span>${esc(t('tour.mock.red'))}</span></div></div>`,
  () => `<div class="card flat" style="width:100%"><div class="item"><b class="grow">${esc(t('rep.avg'))}</b><span class="badge">82</span></div><div class="row"><span class="badge mute">CSV</span><span class="badge mute">PDF</span><span class="badge mute">HEMIS</span></div></div>`,
];

export function open() {
  let i = 0;
  const host = document.createElement('div'); host.className = 'tour'; host.setAttribute('role', 'dialog'); host.setAttribute('aria-modal', 'true');
  $('#overlays').appendChild(host);
  const close = () => host.remove();
  const draw = () => {
    const last = i === 4;
    host.innerHTML = `<div class="card">
      <div class="illus">${mocks[i]()}</div>
      <div class="steps" aria-hidden="true">${[0, 1, 2, 3, 4].map((k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <div><h2>${esc(t(`tour.${i + 1}.t`))}</h2><p class="muted" style="margin-top:6px">${esc(t(`tour.${i + 1}.d`))}</p></div>
      <div class="stack"><button class="btn pri block" id="nx" autofocus>${esc(last ? t('tour.start') : t('common.next'))}</button>${last ? '' : `<button class="btn ghost block" id="sk">${esc(t('tour.skip'))}</button>`}</div></div>`;
    host.querySelector('#nx').onclick = () => { if (last) close(); else { i++; draw(); } };
    const sk = host.querySelector('#sk'); if (sk) sk.onclick = close;
  };
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  draw();
}
