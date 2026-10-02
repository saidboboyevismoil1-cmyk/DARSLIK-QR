import { $, $$, esc, icon, store } from '../util.js';
import { t } from '../i18n.js';
import { get, post, api } from '../api.js';
import { sheet, confirmBox, toast, toastErr, spinner, emptyState } from '../ui.js';
import { go } from '../app.js';

const errList = (errs) => (errs && errs.length ? `<div class="card flat" style="border-color:var(--bad);margin-top:10px"><b class="err-text">${esc(t('groups.errorsT'))}</b><ul style="margin:8px 0 0;padding-left:20px">${errs.slice(0, 30).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>${errs.length > 30 ? `<p class="help">… +${errs.length - 30}</p>` : ''}</div>` : '');

/** CSV kiritish bloki: fayl tanlash yoki joylash. → { el html, get() } */
const csvBlock = () => `
  <label class="lbl" for="csv">${esc(t('groups.csv'))} <span class="muted">(${esc(t('common.optional'))})</span></label>
  <textarea id="csv" class="field" rows="5" placeholder="Aliyev Vali, 390211001&#10;Karimova Madina, 390211002"></textarea>
  <div class="row" style="margin-top:8px"><label class="btn soft sm" style="cursor:pointer">${icon('upload')}${esc(t('groups.pickFile'))}<input type="file" id="csvf" accept=".csv,.txt,text/csv,text/plain" hidden></label>
    <a class="btn ghost sm" href="/teacher/sample-roster.csv" download>${icon('download')}${esc(t('groups.sample'))}</a></div>
  <p class="help">${esc(t('groups.csvHelp'))}</p>`;
const bindCsv = (el) => { $('#csvf', el).onchange = async (e) => { const f = e.target.files[0]; if (f) $('#csv', el).value = (await f.text()).replace(/^﻿/, ''); }; };

export default async function groups({ view, setTop }) {
  setTop({ title: t('groups.title'), actions: `<button class="btn pri sm" id="new">${icon('plus')}${esc(t('groups.new'))}</button>` });
  $('#new').onclick = () => createSheet(load);
  async function load() {
    view.innerHTML = spinner();
    let list = [];
    try { list = (await get('/teacher/groups')).groups; } catch (e) { toastErr(e); }
    view.innerHTML = list.length ? `<div class="card list">${list.map((g) => `
      <div class="item tap" data-g="${esc(g.id)}" role="button" tabindex="0"><div class="ico">${icon('users')}</div>
        <div class="grow"><b class="ellipsis" style="display:block">${esc(g.name)}</b><span class="muted small">${esc(t('common.students', { n: g.students }))}${g.subject ? ' · ' + esc(g.subject) : ''}${g.students ? ' · ' + esc(t('groups.bound', { n: g.bound, total: g.students })) : ''}</span></div>${icon('next', 'muted')}</div>`).join('')}</div>`
      : `<div class="card">${emptyState({ ico: 'users', title: t('groups.emptyT'), text: t('groups.emptyD'), action: `<button class="btn pri" id="new2">${icon('plus')}${esc(t('groups.new'))}</button>` })}</div>`;
    $$('[data-g]', view).forEach((el) => { const o = () => go('/groups/' + el.dataset.g); el.onclick = o; el.onkeydown = (e) => { if (e.key === 'Enter') o(); }; });
    const n2 = $('#new2', view); if (n2) n2.onclick = () => createSheet(load);
  }
  await load();
}

function createSheet(done) {
  sheet({ html: `<h2>${esc(t('groups.new'))}</h2>
    <div class="stack" style="margin-top:14px">
      <div><label class="lbl" for="gn">${esc(t('groups.name'))}</label><input id="gn" class="field" placeholder="${esc(t('groups.namePh'))}" autofocus></div>
      <div><label class="lbl" for="gs">${esc(t('groups.subject'))} <span class="muted">(${esc(t('common.optional'))})</span></label><input id="gs" class="field"></div>
      <div>${csvBlock()}</div><div id="errs"></div>
      <button class="btn pri block" id="ok">${esc(t('common.save'))}</button></div>`,
    bind: (el, close) => {
      bindCsv(el);
      $('#ok', el).onclick = async (e) => {
        const name = $('#gn', el).value.trim(); if (!name) { $('#gn', el).focus(); return; }
        e.currentTarget.disabled = true;
        try {
          const r = await post('/teacher/groups', { name, subject: $('#gs', el).value.trim(), csv: $('#csv', el).value });
          if (r.errors && r.errors.length) { $('#errs', el).innerHTML = `<p class="ok">${esc(t('groups.added', { n: r.added }))}</p>` + errList(r.errors); $('#ok', el).textContent = t('common.done'); $('#ok', el).disabled = false; $('#ok', el).onclick = () => { close(); done(); }; }
          else { close(); toast(t('groups.created'), 'ok'); done(); }
        } catch (err) { $('#errs', el).innerHTML = err.data && err.data.errors ? errList(err.data.errors) : `<p class="err-text">${esc(err.message === 'error' ? t('common.error') : err.message)}</p>`; e.currentTarget.disabled = false; }
      };
    } });
}

export async function detail({ args, view, setTop }) {
  const id = args[0];
  setTop({ title: t('groups.title'), backTo: '/groups' });
  async function load() {
    view.innerHTML = spinner();
    let d; try { d = await get('/rosters/' + id); } catch (e) { return go('/groups', true); }
    const g = d.group, st = d.students;
    const groupRow = (await get('/teacher/groups')).groups.find((x) => x.id === id) || {};
    setTop({ title: g.name, backTo: '/groups' });
    view.innerHTML = `<div class="stack lg">
      <div class="card stack">
        <div class="muted">${esc(groupRow.subject || '')} ${esc(t('common.students', { n: st.length }))} · ${esc(t('groups.bound', { n: st.filter((s) => s.bound_at).length, total: st.length }))}</div>
        <button class="btn pri block" id="startHere">${icon('play')}${esc(t('groups.startHere'))}</button>
        <div class="row nowrap"><button class="btn block" id="upd">${icon('upload')}${esc(t('groups.updateList'))}</button><button class="btn block" id="ren">${icon('edit')}${esc(t('common.edit'))}</button></div>
      </div>
      <div class="card">${st.length ? st.map((s) => `<div class="stu"><div class="grow"><b>${esc(s.full_name)}</b><div class="muted small">${esc(s.hemis_id || '')}</div></div>
          ${s.bound_at ? `<span class="badge ok">${esc(t('groups.linked'))}</span><button class="btn sm ghost" data-rb="${esc(s.id)}" title="${esc(t('groups.resetBind'))}" aria-label="${esc(t('groups.resetBind'))}">${icon('x')}</button>` : `<span class="badge mute">${esc(t('groups.unbound'))}</span>`}</div>`).join('') : emptyState({ ico: 'users', title: t('groups.noStudents') })}</div>
      <button class="btn danger-text block" id="del">${icon('trash')}${esc(t('common.delete'))}</button></div>`;
    $('#startHere', view).onclick = () => { const cur = store.get('ef_t_start', {}); store.set('ef_t_start', { ...cur, groupId: id }); go('/start'); };
    $$('[data-rb]', view).forEach((b) => { b.onclick = async () => { try { await post(`/rosters/${id}/students/${b.dataset.rb}/reset-binding`); toast(t('groups.resetDone'), 'ok'); load(); } catch (e) { toastErr(e); } }; });
    $('#del', view).onclick = async () => { if (await confirmBox({ title: t('groups.deleteQ'), text: t('groups.deleteD'), ok: t('common.delete'), danger: true })) { try { await api('DELETE', '/rosters/' + id); go('/groups', true); } catch (e) { toastErr(e); } } };
    $('#ren', view).onclick = () => sheet({ html: `<h2>${esc(t('common.edit'))}</h2><div class="stack" style="margin-top:14px"><div><label class="lbl" for="gn">${esc(t('groups.name'))}</label><input id="gn" class="field" value="${esc(g.name)}"></div><div><label class="lbl" for="gs">${esc(t('groups.subject'))}</label><input id="gs" class="field" value="${esc(groupRow.subject || '')}"></div><button class="btn pri block" id="ok">${esc(t('common.save'))}</button></div>`,
      bind: (el, close) => { $('#ok', el).onclick = async () => { try { await api('PUT', '/teacher/groups/' + id, { name: $('#gn', el).value, subject: $('#gs', el).value }); close(); toast(t('set.saved'), 'ok'); load(); } catch (e) { toastErr(e); } }; } });
    $('#upd', view).onclick = () => {
      let mode = 'append';
      sheet({ html: `<h2>${esc(t('groups.updateList'))}</h2><div class="stack" style="margin-top:14px">${csvBlock()}
        <div class="chips"><button class="chip" data-m="append" aria-pressed="true">${esc(t('groups.append'))}</button><button class="chip" data-m="replace" aria-pressed="false">${esc(t('groups.replace'))}</button></div><div id="errs"></div>
        <button class="btn pri block" id="ok">${esc(t('common.save'))}</button></div>`,
        bind: (el, close) => {
          bindCsv(el);
          $$('[data-m]', el).forEach((c) => { c.onclick = () => { mode = c.dataset.m; $$('[data-m]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === c))); }; });
          $('#ok', el).onclick = async () => {
            try {
              if (mode === 'replace' && !(await confirmBox({ title: t('groups.replace'), text: t('groups.deleteD'), ok: t('common.save'), danger: true }))) return;
              const r = await post(`/teacher/groups/${id}/students`, { csv: $('#csv', el).value, mode });
              $('#errs', el).innerHTML = `<p>${esc(t('groups.added', { n: r.added }))}${r.skipped ? ' · ' + esc(t('groups.skipped', { n: r.skipped })) : ''}</p>` + errList(r.errors);
              if (!r.errors.length) { close(); toast(t('groups.added', { n: r.added }), 'ok'); load(); } else { $('#ok', el).textContent = t('common.done'); $('#ok', el).onclick = () => { close(); load(); }; }
            } catch (err) { $('#errs', el).innerHTML = err.data && err.data.errors ? errList(err.data.errors) : `<p class="err-text">${esc(err.message)}</p>`; }
          };
        } });
    };
  }
  await load();
}
