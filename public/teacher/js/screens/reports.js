import { $, $$, esc, icon, fmtDate, isoWeek, shiftWeek } from '../util.js';
import { t, getLang } from '../i18n.js';
import { get, download } from '../api.js';
import { toastErr, spinner, emptyState } from '../ui.js';
import { go } from '../app.js';

function printTable(title, head, rows) {
  const w = window.open('', '_blank');
  if (!w) { window.print(); return; }
  const e = esc;
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${e(title)}</title><style>body{font:13px system-ui;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:5px 8px;text-align:left}</style><h2>${e(title)}</h2><table><tr>${head.map((h) => `<th>${e(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${e(c)}</td>`).join('')}</tr>`).join('')}</table>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 200);
}
const tabs = (cur) => `<div class="chips" role="tablist"><a class="chip" role="tab" href="#/reports" aria-pressed="${cur === 'l'}">${esc(t('rep.lessons'))}</a><a class="chip" role="tab" href="#/weekly" aria-pressed="${cur === 'w'}">${esc(t('rep.weekly'))}</a></div>`;

export default async function reports({ view, setTop }) {
  setTop({ title: t('rep.title') });
  view.innerHTML = spinner();
  let list = []; try { list = (await get('/teacher/sessions?status=ended&limit=60')).sessions; } catch (e) { toastErr(e); }
  view.innerHTML = `<div class="stack lg">${tabs('l')}${list.length ? `<div class="card list">${list.map((s) => `
    <div class="item tap" data-r="${esc(s.id)}" role="button" tabindex="0"><div class="ico">${icon('chart')}</div>
      <div class="grow"><b class="ellipsis" style="display:block">${esc(s.name)}</b><span class="muted small">${esc(fmtDate(Date.parse(s.createdAt), getLang()))} · ${esc(t('common.students', { n: s.students }))}</span></div>
      ${s.averageScore != null ? `<span class="badge">${esc(t('home.score', { n: s.averageScore }))}</span>` : ''}${icon('next', 'muted')}</div>`).join('')}</div>`
    : `<div class="card">${emptyState({ ico: 'chart', title: t('rep.emptyT'), text: t('rep.emptyD') })}</div>`}</div>`;
  $$('[data-r]', view).forEach((el) => { const o = () => go('/reports/' + el.dataset.r); el.onclick = o; el.onkeydown = (e) => { if (e.key === 'Enter') o(); }; });
}

export async function detail({ args, view, setTop }) {
  const id = args[0];
  setTop({ title: t('rep.title'), backTo: '/reports' });
  view.innerHTML = spinner();
  let rep, sess;
  try { [rep, sess] = await Promise.all([get(`/lock/sessions/${id}/report`), get(`/teacher/sessions/${id}`)]); } catch (e) { toastErr(e); return go('/reports', true); }
  const s = sess.session; setTop({ title: s.name, backTo: '/reports' });
  const rows = rep.students;
  view.innerHTML = `<div class="stack lg">
    <div class="tiles"><div class="tile" style="background:var(--primary-soft);color:var(--primary-text)"><b>${rows.length}</b><span>${esc(t('rep.students'))}</span></div>
      <div class="tile ok"><b>${rep.summary.averageTotal}</b><span>${esc(t('rep.avg'))}</span></div>
      <div class="tile ${rep.summary.bypassTotal ? 'bad' : 'ok'}"><b>${rep.summary.bypassTotal}</b><span>${esc(t('rep.bypass'))}</span></div></div>
    <div class="btn-grid no-print"><button class="btn" id="csv">${icon('download')}${esc(t('rep.csv'))}</button><button class="btn" id="hemis">${icon('download')}${esc(t('rep.hemis'))}</button><button class="btn" id="pdf">${icon('file')}${esc(t('rep.pdf'))}</button></div>
    <p class="help no-print">${esc(t('rep.hemisNote'))}</p>
    <div class="card list only-narrow">${rows.map((r) => `<div class="item"><div class="grow"><b>${esc(r.name)}</b><div class="muted small">${esc(t('rep.quiz'))} ${r.quizzes == null ? '—' : r.quizzes + '%'} · ${esc(t('rep.focus'))} ${r.focus}% · ${esc(t('rep.bypass'))} ${r.bypass}</div></div>${r.attendance ? '' : `<span class="badge bad">${esc(t('rep.no'))}</span>`}<span class="badge">${r.total}</span></div>`).join('')}</div>
    <div class="card tbl only-wide"><table><thead><tr><th>${esc(t('live.col.name'))}</th><th>${esc(t('rep.attendance'))}</th><th>${esc(t('rep.quiz'))}</th><th>${esc(t('rep.focus'))}</th><th>${esc(t('rep.total'))}</th><th>${esc(t('rep.bypass'))}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td><b>${esc(r.name)}</b>${r.hemisId ? `<div class="muted small">${esc(r.hemisId)}</div>` : ''}</td><td>${r.attendance ? `<span class="badge ok">${esc(t('rep.yes'))}</span>` : `<span class="badge bad">${esc(t('rep.no'))}</span>`}</td><td>${r.quizzes == null ? '—' : r.quizzes + '%'}</td><td>${r.focus}%</td><td><b>${r.total}</b></td><td>${r.bypass}</td></tr>`).join('')}</tbody></table></div></div>`;
  const dl = (fmt, name) => async () => { try { await download(`/lock/sessions/${id}/report?format=${fmt}`, name); } catch (e) { toastErr(e); } };
  $('#csv', view).onclick = dl('csv', `edufocus-${id}-hisobot.csv`);
  $('#hemis', view).onclick = dl('hemis', `edufocus-${id}-hemis.csv`);
  $('#pdf', view).onclick = () => printTable(`${s.name} — ${t('rep.title')}`, [t('live.col.name'), t('rep.attendance'), t('rep.quiz'), t('rep.focus'), t('rep.total'), t('rep.bypass')], rows.map((r) => [r.name, r.attendance ? t('rep.yes') : t('rep.no'), r.quizzes == null ? '—' : r.quizzes + '%', r.focus + '%', r.total, r.bypass]));
}

export async function weekly({ view, setTop }) {
  setTop({ title: t('rep.title') });
  let week = isoWeek();
  async function load() {
    view.innerHTML = spinner();
    let d; try { d = await get('/teacher/reports/weekly?week=' + week); } catch (e) { toastErr(e); return; }
    view.innerHTML = `<div class="stack lg">${tabs('w')}
      <div class="row nowrap" style="justify-content:space-between"><button class="iconbtn" id="pv" aria-label="${esc(t('common.back'))}">${icon('back')}</button><div class="center"><b>${esc(t('rep.week'))} ${esc(week)}</b><div class="muted small">${esc(d.weekFrom)} — ${esc(d.weekTo)}</div></div><button class="iconbtn" id="nx" aria-label="${esc(t('common.next'))}">${icon('next')}</button></div>
      ${d.lessons.length ? `
        <div class="btn-grid no-print"><button class="btn" id="csv">${icon('download')}${esc(t('rep.csv'))}</button><button class="btn" id="pdf">${icon('file')}${esc(t('rep.pdf'))}</button></div>
        <section class="stack"><h2>${esc(t('rep.byGroup'))}</h2>
          <div class="card list only-narrow">${d.groups.map((g) => `<div class="item"><div class="grow"><b>${esc(g.group || t('common.noGroup'))}</b><div class="muted small">${esc(t('rep.lessons'))} ${g.lessons} · ${esc(t('rep.students'))} ${g.students} · ${esc(t('rep.bypass'))} ${g.bypass}</div></div><span class="badge">${g.averageScore}</span></div>`).join('')}</div>
          <div class="card tbl only-wide"><table><thead><tr><th>${esc(t('rep.group'))}</th><th>${esc(t('rep.lessons'))}</th><th>${esc(t('rep.students'))}</th><th>${esc(t('rep.avg'))}</th><th>${esc(t('rep.bypass'))}</th><th>${esc(t('rep.absent'))}</th></tr></thead><tbody>${d.groups.map((g) => `<tr><td><b>${esc(g.group || t('common.noGroup'))}</b></td><td>${g.lessons}</td><td>${g.students}</td><td>${g.averageScore}</td><td>${g.bypass}</td><td>${g.absent}</td></tr>`).join('')}</tbody></table></div></section>
        <section class="stack"><h2>${esc(t('rep.byLesson'))}</h2><div class="card list">${d.lessons.map((l) => `<div class="item tap" data-r="${esc(l.id)}" role="button" tabindex="0"><div class="grow"><b>${esc(l.name)}</b><div class="muted small">${esc(fmtDate(Date.parse(l.createdAt), getLang()))} · ${esc(t('common.students', { n: l.students }))}</div></div><span class="badge">${l.averageScore ?? '—'}</span>${icon('next', 'muted')}</div>`).join('')}</div></section>`
      : `<div class="card">${emptyState({ ico: 'chart', title: t('rep.noWeek') })}</div>`}</div>`;
    $('#pv', view).onclick = () => { week = shiftWeek(week, -1); load(); };
    $('#nx', view).onclick = () => { week = shiftWeek(week, 1); load(); };
    $$('[data-r]', view).forEach((el) => { el.onclick = () => go('/reports/' + el.dataset.r); });
    const csv = $('#csv', view); if (csv) csv.onclick = async () => { try { await download('/teacher/reports/weekly?format=csv&week=' + week, `edufocus-haftalik-${week}.csv`); } catch (e) { toastErr(e); } };
    const pdf = $('#pdf', view); if (pdf) pdf.onclick = () => printTable(`${t('rep.weekly')} ${week}`, [t('rep.group'), t('rep.lesson'), t('rep.date'), t('rep.students'), t('rep.avg'), t('rep.bypass'), t('rep.absent')], d.lessons.map((l) => [l.groupName || '—', l.name, (l.createdAt || '').slice(0, 10), l.students, l.averageScore ?? '', l.bypass ?? '', l.absent ?? '']));
  }
  await load();
}
