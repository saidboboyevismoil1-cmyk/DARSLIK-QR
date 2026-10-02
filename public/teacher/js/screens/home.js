import { esc, icon, fmtClock, fmtDate, store } from '../util.js';
import { t, getLang } from '../i18n.js';
import { get, session } from '../api.js';
import { emptyState, spinner, toastErr } from '../ui.js';
import { go } from '../app.js';

const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const lessonRow = (s) => `
  <div class="item tap" data-open="${esc(s.id)}" data-status="${esc(s.status)}" role="button" tabindex="0">
    <div class="ico">${icon(s.status === 'active' ? 'play' : 'check')}</div>
    <div class="grow"><b class="ellipsis" style="display:block">${esc(s.name)}</b><span class="muted small">${esc(fmtClock(Date.parse(s.createdAt)))} · ${esc(t('common.students', { n: s.students }))}</span></div>
    ${s.status === 'active' ? `<span class="badge ok">${esc(t('status.active'))}</span>` : (s.averageScore != null ? `<span class="badge">${esc(t('home.score', { n: s.averageScore }))}</span>` : '')}
    ${icon('next', 'muted')}
  </div>`;

export default async function home({ view, setTop }) {
  const me = session.teacher || {};
  setTop({ title: t('nav.home') });
  view.innerHTML = spinner();
  let d;
  try { d = await get('/teacher/home?since=' + dayStart()); } catch (e) { view.innerHTML = emptyState({ ico: 'alert', title: t('common.error'), action: `<button class="btn pri" id="rt">${esc(t('common.retry'))}</button>` }); view.querySelector('#rt').onclick = () => go('/', true); return; }
  const name = d.teacher.name || me.name || '';
  const startBtn = `<a href="#/start" class="btn pri xl block hero-btn" id="start">${icon('play')}${esc(t('home.start'))}</a>`;
  view.innerHTML = `
    <div class="stack lg">
      <div><h1>${esc(t('home.hello', { name }))}</h1></div>
      ${d.active ? `<div class="card tap" data-open="${esc(d.active.id)}" data-status="active" role="button" tabindex="0" style="border-color:var(--ok)">
          <div class="row nowrap"><span class="dot ok"></span><div class="grow"><b>${esc(t('home.running'))}</b><div class="muted small ellipsis">${esc(d.active.name)} · ${esc(t('common.students', { n: d.active.students }))}</div></div><span class="btn ok sm">${esc(t('home.open'))}</span></div></div>` : ''}
      ${startBtn}
      ${d.groups === 0 ? `<div class="card">${emptyState({ ico: 'users', title: t('home.noGroupsT'), text: t('home.noGroupsD'), action: `<a class="btn soft" href="#/groups">${icon('plus')}${esc(t('home.createGroup'))}</a>` })}</div>` : ''}
      <section class="stack"><h2>${esc(t('home.today'))}</h2>
        ${d.today.length ? `<div class="card list">${d.today.map(lessonRow).join('')}</div>` : `<div class="card">${emptyState({ ico: 'clock', title: t('home.todayEmptyT'), text: t('home.todayEmptyD') })}</div>`}
      </section>
      <section class="stack"><h2>${esc(t('home.recent'))}</h2>
        ${d.recent.length ? `<div class="card list">${d.recent.map((s) => lessonRow(s).replace(esc(fmtClock(Date.parse(s.createdAt))), esc(fmtDate(Date.parse(s.createdAt), getLang())))).join('')}</div>` : `<p class="muted">${esc(t('home.recentEmpty'))}</p>`}
      </section>
    </div>`;
  view.querySelectorAll('[data-open]').forEach((el) => {
    const open = () => go(el.dataset.status === 'active' ? `/live/${el.dataset.open}` : `/reports/${el.dataset.open}`);
    el.onclick = open; el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  });
  store.set('ef_t_lastHome', Date.now());
}
