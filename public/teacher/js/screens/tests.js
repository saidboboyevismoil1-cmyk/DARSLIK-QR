import { $, $$, esc, icon } from '../util.js';
import { t } from '../i18n.js';
import { get, post, api } from '../api.js';
import { confirmBox, toast, toastErr, spinner, emptyState, sheet } from '../ui.js';
import { go } from '../app.js';

const TYPES = ['single', 'multi', 'tf', 'short'];
const blank = (type = 'single') => ({ type, text: '', options: type === 'single' || type === 'multi' ? ['', '', '', ''] : [], correct: type === 'multi' ? [] : 0, accept: [''] });

export default async function tests({ view, setTop }) {
  setTop({ title: t('tests.title'), actions: `<a class="btn pri sm" href="#/tests/new">${icon('plus')}${esc(t('tests.new'))}</a>` });
  async function load() {
    view.innerHTML = spinner();
    let list = []; try { list = (await get('/testpacks')).testpacks; } catch (e) { toastErr(e); }
    view.innerHTML = list.length ? `<div class="card list">${list.map((x) => `
      <div class="item"><div class="ico">${icon('test')}</div>
        <div class="grow tap" data-e="${esc(x.id)}" role="button" tabindex="0" style="cursor:pointer"><b class="ellipsis" style="display:block">${esc(x.title)}</b><span class="muted small">${esc(t('common.questions', { n: x.questions.length }))}${x.timeLimit ? ' · ' + esc(t('common.minutes', { n: x.timeLimit })) : ''}</span></div>
        <button class="btn sm soft" data-send="${esc(x.id)}" aria-label="${esc(t('tests.send'))}">${icon('send')}</button>
        <button class="iconbtn" data-cp="${esc(x.id)}" aria-label="${esc(t('common.copy'))}">${icon('copy')}</button>
        <button class="iconbtn" data-rm="${esc(x.id)}" aria-label="${esc(t('common.delete'))}">${icon('trash')}</button></div>`).join('')}</div>`
      : `<div class="card">${emptyState({ ico: 'test', title: t('tests.emptyT'), text: t('tests.emptyD'), action: `<a class="btn pri" href="#/tests/new">${icon('plus')}${esc(t('tests.new'))}</a>` })}</div>`;
    $$('[data-e]', view).forEach((el) => { const o = () => go('/tests/' + el.dataset.e); el.onclick = o; el.onkeydown = (e) => { if (e.key === 'Enter') o(); }; });
    $$('[data-cp]', view).forEach((b) => { b.onclick = async () => { try { await post(`/testpacks/${b.dataset.cp}/copy`); toast(t('tests.copied'), 'ok'); load(); } catch (e) { toastErr(e); } }; });
    $$('[data-rm]', view).forEach((b) => { b.onclick = async () => { if (await confirmBox({ title: t('tests.deleteQ'), ok: t('common.delete'), danger: true })) { try { await api('DELETE', '/testpacks/' + b.dataset.rm); load(); } catch (e) { toastErr(e); } } }; });
    $$('[data-send]', view).forEach((b) => { b.onclick = async () => {
      let act = null; try { act = ((await get('/teacher/sessions?status=active&limit=1')).sessions || [])[0]; } catch { /* */ }
      if (!act) return toast(t('tests.noLesson'), 'bad');
      try { await post(`/testpacks/${b.dataset.send}/broadcast`, { sessionId: act.id }); toast(t('live.testSent'), 'ok'); } catch (e) { toastErr(e); }
    }; });
  }
  await load();
}

export async function editor({ args, view, setTop }) {
  const id = args[0] === 'new' ? null : args[0];
  setTop({ title: id ? t('common.edit') : t('tests.new'), backTo: '/tests' });
  let m = { title: '', subject: '', timeLimit: 10, questions: [blank()] };
  if (id) {
    view.innerHTML = spinner();
    try { const tp = (await get('/testpacks')).testpacks.find((x) => x.id === id); if (!tp) return go('/tests', true); m = { title: tp.title, subject: tp.subject || '', timeLimit: tp.timeLimit, questions: tp.questions.map((q) => ({ type: q.type, text: q.text, options: q.options && q.options.length ? [...q.options] : (q.type === 'single' || q.type === 'multi' ? ['', ''] : []), correct: q.correct, accept: q.type === 'short' ? [...(q.accept || [''])] : [''] })) }; }
    catch (e) { return go('/tests', true); }
  }
  const tfLabel = (i) => t(i === 0 ? 'tests.true' : 'tests.false');
  function qCard(q, i) {
    const n = m.questions.length;
    let body = '';
    if (q.type === 'single' || q.type === 'multi') {
      body = q.options.map((o, oi) => `<div class="opt-row"><input type="${q.type === 'multi' ? 'checkbox' : 'radio'}" name="c${i}" data-c="${i}:${oi}" ${q.type === 'multi' ? (q.correct.includes(oi) ? 'checked' : '') : (q.correct === oi ? 'checked' : '')} aria-label="${esc(t('tests.option', { n: oi + 1 }))}">
        <input class="field" data-o="${i}:${oi}" value="${esc(o)}" placeholder="${esc(t('tests.option', { n: oi + 1 }))}"><button class="iconbtn" data-ro="${i}:${oi}" aria-label="${esc(t('common.delete'))}">${icon('x')}</button></div>`).join('')
        + (q.options.length < 8 ? `<button class="btn soft sm" data-ao="${i}">${icon('plus')}${esc(t('tests.addOpt'))}</button>` : '');
    } else if (q.type === 'tf') {
      body = `<div class="chips">${[0, 1].map((k) => `<button class="chip" data-tf="${i}:${k}" aria-pressed="${q.correct === k}">${esc(tfLabel(k))}</button>`).join('')}</div>`;
    } else {
      body = `<label class="lbl">${esc(t('tests.accept'))}</label><input class="field" data-acc="${i}" value="${esc(q.accept.join(', '))}"><p class="help">${esc(t('tests.acceptHelp'))}</p>`;
    }
    return `<div class="q-editor" data-q="${i}">
      <div class="row nowrap"><b class="grow">${i + 1}</b>
        <button class="iconbtn" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('tests.up'))}" style="transform:rotate(90deg)">${icon('back')}</button>
        <button class="iconbtn" data-dn="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="${esc(t('tests.down'))}" style="transform:rotate(-90deg)">${icon('back')}</button>
        <button class="iconbtn" data-rq="${i}" aria-label="${esc(t('tests.removeQ'))}">${icon('trash')}</button></div>
      <select class="field" data-type="${i}" aria-label="${esc(t('tests.type'))}">${TYPES.map((k) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${esc(t('tests.t.' + k))}</option>`).join('')}</select>
      <textarea class="field" rows="2" data-text="${i}" placeholder="${esc(t('tests.qText'))}">${esc(q.text)}</textarea>${body}</div>`;
  }
  function draw() {
    view.innerHTML = `<div class="stack lg">
      <div class="card stack">
        <div><label class="lbl" for="tt">${esc(t('tests.name'))}</label><input id="tt" class="field" value="${esc(m.title)}"></div>
        <div class="row nowrap"><div class="grow"><label class="lbl" for="ts">${esc(t('groups.subject'))}</label><input id="ts" class="field" value="${esc(m.subject)}"></div><div class="grow"><label class="lbl" for="tm">${esc(t('tests.time'))}</label><input id="tm" class="field" type="number" min="0" max="240" inputmode="numeric" value="${m.timeLimit}"></div></div>
      </div>
      ${m.questions.map(qCard).join('')}
      <button class="btn soft block" id="aq">${icon('plus')}${esc(t('tests.addQ'))}</button>
      <div id="err"></div>
      <button class="btn pri xl block" id="save">${icon('check')}${esc(t('common.save'))}</button></div>`;
    bind();
  }
  function bind() {
    $('#tt', view).oninput = (e) => { m.title = e.target.value; }; $('#ts', view).oninput = (e) => { m.subject = e.target.value; };
    $('#tm', view).oninput = (e) => { m.timeLimit = Number(e.target.value) || 0; };
    $$('[data-text]', view).forEach((el) => { el.oninput = () => { m.questions[+el.dataset.text].text = el.value; }; });
    $$('[data-o]', view).forEach((el) => { el.oninput = () => { const [i, o] = el.dataset.o.split(':').map(Number); m.questions[i].options[o] = el.value; }; });
    $$('[data-c]', view).forEach((el) => { el.onchange = () => { const [i, o] = el.dataset.c.split(':').map(Number); const q = m.questions[i]; if (q.type === 'multi') { q.correct = el.checked ? [...new Set([...q.correct, o])].sort() : q.correct.filter((x) => x !== o); } else q.correct = o; }; });
    $$('[data-tf]', view).forEach((el) => { el.onclick = () => { const [i, k] = el.dataset.tf.split(':').map(Number); m.questions[i].correct = k; draw(); }; });
    $$('[data-acc]', view).forEach((el) => { el.oninput = () => { m.questions[+el.dataset.acc].accept = el.value.split(',').map((x) => x.trim()).filter(Boolean); }; });
    $$('[data-type]', view).forEach((el) => { el.onchange = () => { const i = +el.dataset.type; const old = m.questions[i]; m.questions[i] = { ...blank(el.value), text: old.text }; draw(); }; });
    $$('[data-ao]', view).forEach((el) => { el.onclick = () => { m.questions[+el.dataset.ao].options.push(''); draw(); }; });
    $$('[data-ro]', view).forEach((el) => { el.onclick = () => { const [i, o] = el.dataset.ro.split(':').map(Number); const q = m.questions[i]; if (q.options.length <= 2) return; q.options.splice(o, 1); q.correct = q.type === 'multi' ? q.correct.filter((x) => x !== o).map((x) => (x > o ? x - 1 : x)) : (q.correct === o ? 0 : q.correct > o ? q.correct - 1 : q.correct); draw(); }; });
    $$('[data-up]', view).forEach((el) => { el.onclick = () => { const i = +el.dataset.up; [m.questions[i - 1], m.questions[i]] = [m.questions[i], m.questions[i - 1]]; draw(); }; });
    $$('[data-dn]', view).forEach((el) => { el.onclick = () => { const i = +el.dataset.dn; [m.questions[i + 1], m.questions[i]] = [m.questions[i], m.questions[i + 1]]; draw(); }; });
    $$('[data-rq]', view).forEach((el) => { el.onclick = () => { m.questions.splice(+el.dataset.rq, 1); draw(); }; });
    $('#aq', view).onclick = () => { m.questions.push(blank()); draw(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); };
    $('#save', view).onclick = async (e) => {
      if (!m.title.trim()) { $('#err', view).innerHTML = `<p class="err-text">${esc(t('tests.name'))}</p>`; $('#tt', view).focus(); return; }
      if (!m.questions.length) { $('#err', view).innerHTML = `<p class="err-text">${esc(t('tests.needQ'))}</p>`; return; }
      e.currentTarget.disabled = true;
      const body = { title: m.title, subject: m.subject, timeLimit: m.timeLimit, questions: m.questions.map((q) => {
        if (q.type !== 'single' && q.type !== 'multi') return { type: q.type, text: q.text, correct: q.correct, accept: q.accept };
        const keep = q.options.map((o, k) => (o.trim() ? k : -1)).filter((k) => k >= 0);      // bo'sh variantlar tashlanadi, to'g'ri javob indekslari moslanadi
        return { type: q.type, text: q.text, options: keep.map((k) => q.options[k]), correct: q.type === 'multi' ? q.correct.map((c) => keep.indexOf(c)).filter((x) => x >= 0) : Math.max(0, keep.indexOf(q.correct)) };
      }) };
      try { id ? await api('PUT', '/testpacks/' + id, body) : await post('/testpacks', body); toast(t('tests.saved'), 'ok'); go('/tests', true); }
      catch (err) { $('#err', view).innerHTML = `<p class="err-text">${esc(err.message === 'error' ? t('common.error') : err.message)}</p>`; e.currentTarget.disabled = false; }
    };
  }
  draw();
}
