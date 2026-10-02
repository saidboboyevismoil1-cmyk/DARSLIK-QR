import { $, $$, esc, icon } from '../util.js';
import { t } from '../i18n.js';
import { get, post, api, session, socket } from '../api.js';
import { sheet, confirmBox, toast, toastErr, spinner, emptyState } from '../ui.js';

export default async function materials({ view, setTop }) {
  setTop({ title: t('mats.title'), backTo: '/more' });
  async function load() {
    view.innerHTML = spinner();
    let list = []; try { list = (await get('/teacher/materials')).materials; } catch (e) { toastErr(e); }
    view.innerHTML = `<div class="stack lg">
      <div class="row nowrap"><label class="btn pri block" style="cursor:pointer">${icon('upload')}${esc(t('mats.addFile'))}<input type="file" id="mf" hidden accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.txt"></label>
        <button class="btn block" id="ml">${icon('link')}${esc(t('mats.addLink'))}</button></div>
      <p class="help">${esc(t('mats.hint'))}</p>
      ${list.length ? `<div class="card list">${list.map((m) => `<div class="item"><div class="ico">${icon(m.kind === 'link' ? 'link' : 'file')}</div>
        <div class="grow"><b class="ellipsis" style="display:block">${esc(m.title)}</b><span class="muted small ellipsis" style="display:block">${esc(m.kind === 'link' ? m.url : [m.fileLabel, m.fileSize].filter(Boolean).join(' · '))}</span></div>
        <button class="btn sm soft" data-s="${esc(m.id)}">${icon('send')}${esc(t('mats.send'))}</button><button class="iconbtn" data-d="${esc(m.id)}" aria-label="${esc(t('common.delete'))}">${icon('trash')}</button></div>`).join('')}</div>`
        : `<div class="card">${emptyState({ ico: 'file', title: t('mats.emptyT'), text: t('mats.emptyD') })}</div>`}</div>`;
    $('#mf', view).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      toast(t('mats.uploading'));
      try {
        const fd = new FormData(); fd.append('file', f);
        const up = (await api('POST', '/upload-material', fd)).file;
        await post('/teacher/materials', { kind: 'file', title: f.name.replace(/\.[^.]+$/, ''), url: up.url, fileName: up.name, fileSize: up.size, fileType: up.type, fileLabel: up.label, fileColor: up.color });
        toast(t('mats.added'), 'ok'); load();
      } catch (err) { toastErr(err); }
    };
    $('#ml', view).onclick = () => sheet({ html: `<h2>${esc(t('mats.addLink'))}</h2><div class="stack" style="margin-top:14px"><div><label class="lbl" for="lt">${esc(t('mats.linkTitle'))}</label><input id="lt" class="field" autofocus></div><div><label class="lbl" for="lu">${esc(t('mats.linkUrl'))}</label><input id="lu" class="field" type="url" inputmode="url" autocapitalize="off" placeholder="https://"></div><div id="err"></div><button class="btn pri block" id="ok">${esc(t('common.save'))}</button></div>`,
      bind: (el, close) => { $('#ok', el).onclick = async () => { try { await post('/teacher/materials', { kind: 'link', title: $('#lt', el).value, url: $('#lu', el).value }); close(); toast(t('mats.added'), 'ok'); load(); } catch (err) { $('#err', el).innerHTML = `<p class="err-text">${esc(err.message === 'error' ? t('common.error') : err.message)}</p>`; } }; } });
    $$('[data-d]', view).forEach((b) => { b.onclick = async () => { if (await confirmBox({ title: t('mats.deleteQ'), ok: t('common.delete'), danger: true })) { try { await api('DELETE', '/teacher/materials/' + b.dataset.d); load(); } catch (e) { toastErr(e); } } }; });
    $$('[data-s]', view).forEach((b) => { b.onclick = async () => {
      let act = null; try { act = ((await get('/teacher/sessions?status=active&limit=1')).sessions || [])[0]; } catch { /* */ }
      if (!act) return toast(t('tests.noLesson'), 'bad');
      const m = list.find((x) => x.id === b.dataset.s);
      socket().emit('teacher-send-material', { sessionId: act.id, material: { title: m.title, text: '', url: m.kind === 'link' ? m.url : '', fileUrl: m.kind === 'file' ? m.url : '', fileName: m.fileName, fileSize: m.fileSize, fileType: m.fileType || 'document', fileLabel: m.fileLabel, fileColor: m.fileColor } });
      toast(t('live.matSent'), 'ok');
    }; });
  }
  await load();
}
