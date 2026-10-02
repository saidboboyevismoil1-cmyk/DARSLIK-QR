import { esc, icon, store } from '../util.js';
import { t } from '../i18n.js';
import { get, post } from '../api.js';
import { spinner, toast, toastErr, promptBox } from '../ui.js';
import { go } from '../app.js';

const DURS = [45, 60, 80, 90];

export default async function start({ view, setTop }) {
  setTop({ title: t('start.title'), backTo: '/' });
  view.innerHTML = spinner();
  let groups = [];
  try { groups = (await get('/teacher/groups')).groups; } catch (e) { toastErr(e); }
  const last = store.get('ef_t_start', { groupId: null, duration: 45, protection: false });
  const st = { groupId: groups.some((g) => g.id === last.groupId) ? last.groupId : (groups[0] ? groups[0].id : null), duration: last.duration || 45, protection: !!last.protection };
  // Oxirgi ishlatilgan guruh birinchi turadi
  groups.sort((a, b) => (a.id === st.groupId ? -1 : b.id === st.groupId ? 1 : 0));

  const draw = () => {
    view.innerHTML = `
      <div class="stack lg">
        <section class="stack"><h2>${esc(t('start.group'))}</h2>
          <div class="chips" role="group">
            ${groups.map((g) => `<button class="chip" data-g="${esc(g.id)}" aria-pressed="${st.groupId === g.id}">${esc(g.name)}</button>`).join('')}
            <button class="chip" data-g="" aria-pressed="${st.groupId === null}">${esc(t('common.noGroup'))}</button>
          </div>
          ${groups.length === 0 ? `<p class="help">${esc(t('home.noGroupsD'))} <a href="#/groups">${esc(t('home.createGroup'))}</a></p>` : ''}
        </section>
        <section class="stack"><h2>${esc(t('start.duration'))}</h2>
          <div class="chips" role="group">
            ${DURS.map((m) => `<button class="chip" data-d="${m}" aria-pressed="${st.duration === m}">${esc(t('common.minutes', { n: m }))}</button>`).join('')}
            <button class="chip" data-d="custom" aria-pressed="${!DURS.includes(st.duration)}">${esc(!DURS.includes(st.duration) ? t('common.minutes', { n: st.duration }) : t('start.custom'))}</button>
          </div>
        </section>
        <label class="card switch-row" style="align-items:flex-start"><span class="switch" style="margin-top:4px"><input type="checkbox" id="prot" ${st.protection ? 'checked' : ''}><i></i></span>
          <span><b>${esc(t('start.protect'))}</b><span class="help" style="display:block">${esc(t('start.protectD'))}</span></span></label>
        <button class="btn pri xl block hero-btn" id="go">${icon('play')}${esc(t('start.go'))}</button>
      </div>`;
    view.querySelectorAll('[data-g]').forEach((b) => { b.onclick = () => { st.groupId = b.dataset.g || null; draw(); }; });
    view.querySelectorAll('[data-d]').forEach((b) => {
      b.onclick = async () => {
        if (b.dataset.d === 'custom') { const v = Number(await promptBox({ title: t('start.minutesQ'), label: t('start.duration'), type: 'number', ok: t('common.done') })); if (v >= 5 && v <= 240) { st.duration = Math.round(v); draw(); } return; }
        st.duration = Number(b.dataset.d); draw();
      };
    });
    view.querySelector('#prot').onchange = (e) => { st.protection = e.target.checked; };
    view.querySelector('#go').onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      const g = groups.find((x) => x.id === st.groupId);
      try {
        const r = await post('/sessions', { name: g ? g.name : t('common.noGroup'), subject: g ? g.subject : '', duration: st.duration, protection: st.protection ? 'required' : 'optional', rosterGroupId: g && g.students > 0 ? g.id : undefined });
        store.set('ef_t_start', { groupId: st.groupId, duration: st.duration, protection: st.protection });
        go(`/live/${r.session.id}?qr=1`, true);
      } catch (err) { toast(t('start.failed'), 'bad'); btn.disabled = false; }
    };
  };
  draw();
}
