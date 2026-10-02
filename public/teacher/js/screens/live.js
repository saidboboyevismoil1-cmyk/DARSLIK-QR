import { $, $$, esc, icon, fmtTime, store } from '../util.js';
import { t } from '../i18n.js';
import { get, post, act, socket } from '../api.js';
import { sheet, confirmBox, toast, toastErr, spinner, emptyState } from '../ui.js';
import { go } from '../app.js';

const REASONS = ['background', 'not_pinned', 'no_accessibility', 'no_dnd', 'permission_revoked', 'no_assessment', 'no_shield', 'no_authorization', 'screen_off'];
const LEVELS = { 'ios-l1': 'iOS', 'ios-l2': 'iOS', 'ios-l0': 'iOS', 'android-full': 'Android', 'android-lite': 'Android', 'android-l0': 'Android', web: 'level.web' };
const reasonText = (r) => (REASONS.includes(r) ? t('rs.' + r) : r);

export default async function live({ args, query, view, setTop, stale }) {
  const id = args[0];
  setTop({ title: t('live.title'), backTo: '/' });
  view.innerHTML = spinner();
  let info;
  try { info = (await get(`/teacher/sessions/${id}`)).session; } catch (e) { view.innerHTML = emptyState({ ico: 'alert', title: t('common.error'), action: `<a class="btn pri" href="#/">${esc(t('common.back'))}</a>` }); return; }
  if (stale()) return null;
  if (info.status === 'ended') return go(`/reports/${id}`, true);
  setTop({ title: info.name, backTo: '/' });

  const S = { ov: null, filter: 'bad', full: false, sel: new Set(), quiz: null, endsAt: info.endsAtMs + (Date.now() - info.serverTime) * 0 };
  const skew = info.serverTime - Date.now();           // server soati bilan farq
  const left = () => Math.max(0, Math.round((S.endsAt - (Date.now() + skew)) / 1000));
  const sock = socket();
  const sub = () => { sock.emit('lock-subscribe', { sessionId: id }); sock.emit('teacher-monitor', { sessionId: id }); };
  const onOv = (o) => { if (o.sessionId === id) { S.ov = o; draw(); } };
  const onQuiz = (d) => { S.quiz = { n: d.totalSubmissions, total: d.totalStudents }; draw(); };
  const onReq = () => { sock.emit('lock-subscribe', { sessionId: id }); };
  sock.on('lock-overview', onOv); sock.on('quiz-submission-update', onQuiz); sock.on('access-request', onReq); sock.on('connect', sub);
  if (sock.connected) sub();
  const tick = setInterval(() => { const el = $('#timer'); if (el) { el.textContent = fmtTime(left()); } }, 1000);

  function draw() {
    const ov = S.ov;
    if (!ov) { view.innerHTML = spinner(); return; }
    const sm = ov.summary, reqN = ov.requests.length;
    const yellowN = sm.yellow, redN = sm.red;
    const list = ov.students.filter((x) => S.full || x.color === (S.filter === 'ok' ? 'green' : S.filter === 'warn' ? 'yellow' : 'red'));
    const lvl = (l) => { const v = LEVELS[l] || l; return v.startsWith('level.') ? t(v) : v; };
    const row = (x) => `
      <div class="stu">
        ${S.full ? `<input type="checkbox" data-sel="${esc(x.id)}" ${S.sel.has(x.id) ? 'checked' : ''} aria-label="${esc(x.name)}">` : `<span class="dot ${x.color === 'green' ? 'ok' : x.color === 'yellow' ? 'warn' : 'bad'}"></span>`}
        <div class="grow"><b class="ellipsis" style="display:block">${esc(x.name)}</b>
          <span class="muted small">${esc(lvl(x.level))} · ${esc(t('st.' + (x.released ? 'free' : x.status)))}${x.reasons && x.reasons.length ? ' · ' + x.reasons.map((r) => esc(reasonText(r))).join(', ') : ''}${x.bypass ? ' · ' + esc(t('rep.bypass')) + ': ' + x.bypass : ''}</span></div>
        ${x.released ? `<button class="btn sm" data-lock="${esc(x.id)}">${icon('lock')}${esc(t('live.lockOne'))}</button>` : `<button class="btn sm" data-rel="${esc(x.id)}">${icon('unlock')}${esc(t('live.openOne'))}</button>`}
      </div>`;
    view.innerHTML = `
      <div class="stack lg">
        <div class="card"><div class="livebar">
          <div class="grow"><div class="muted small">${esc(t('live.code'))}</div><b style="font-size:26px;letter-spacing:.1em;font-variant-numeric:tabular-nums">${esc(id)}</b></div>
          <div class="center"><div class="muted small">${esc(t('live.left'))}</div><div class="timer" id="timer">${fmtTime(left())}</div></div>
          <button class="btn soft" id="qr">${icon('qr')}<span>${esc(t('live.qr'))}</span></button>
        </div></div>

        <div class="tiles" role="group">
          <button class="tile ok" data-f="ok" aria-pressed="${S.filter === 'ok' && !S.full}"><b>${sm.green}</b><span>${esc(t('live.okT'))}</span></button>
          <button class="tile warn" data-f="warn" aria-pressed="${S.filter === 'warn' && !S.full}"><b>${yellowN}</b><span>${esc(t('live.reqT'))}</span></button>
          <button class="tile bad" data-f="bad" aria-pressed="${S.filter === 'bad' && !S.full}"><b>${redN}</b><span>${esc(t('live.badT'))}</span></button>
        </div>

        ${S.quiz ? `<div class="card flat"><b>${esc(t('live.testProg', { n: S.quiz.n, total: S.quiz.total }))}</b></div>` : ''}

        <section class="stack"><h2>${esc(t('live.requests'))}${reqN ? ` <span class="badge warn">${reqN}</span>` : ''}</h2>
          ${reqN ? `<div class="card list">${ov.requests.map((r) => `
            <div class="item" style="flex-wrap:wrap">
              <div class="grow" style="min-width:140px"><b>${esc(r.student_name)}</b><div class="muted small">${esc(r.kind === 'emergency_exit' ? t('live.reqEmergency') : t('live.reqExemption'))}${r.reason ? ': ' + esc(r.reason) : ''}</div></div>
              <button class="btn ok" data-dec="${esc(r.id)}" data-a="1">${icon('check')}${esc(t('live.approve'))}</button>
              <button class="btn" data-dec="${esc(r.id)}" data-a="0">${icon('x')}${esc(t('live.reject'))}</button>
            </div>`).join('')}</div>` : `<p class="muted">${esc(t('live.noRequests'))}</p>`}
        </section>

        <section class="stack">
          <div class="row"><h2 class="grow">${esc(S.full ? t('live.fullList') : t('live.onlyEx'))}</h2><button class="btn sm ghost" id="full">${esc(S.full ? t('live.onlyEx') : t('live.fullList'))}</button></div>
          <div class="card">
            ${ov.students.length === 0 ? emptyState({ ico: 'qr', title: t('live.join'), text: t('live.waiting') })
              : list.length ? list.map(row).join('') : `<p class="center muted" style="padding:14px">${esc(t('live.allGood'))} ✅</p>`}
            ${S.full && S.sel.size ? `<button class="btn pri block" id="relSel" style="margin-top:12px">${icon('unlock')}${esc(t('live.openSel'))} (${S.sel.size})</button>` : (S.full ? `<p class="help">${esc(t('live.selectHint'))}</p>` : '')}
          </div>
        </section>

        <section class="stack">
          <div class="row nowrap"><button class="btn block" id="openAll">${icon('unlock')}${esc(t('live.openAll'))}</button><button class="btn block" id="lockAll">${icon('lock')}${esc(t('live.lockAll'))}</button></div>
          <div class="row nowrap"><button class="btn block" id="sendTest">${icon('test')}${esc(t('live.sendTest'))}</button><button class="btn block" id="sendMat">${icon('send')}${esc(t('live.sendMat'))}</button></div>
          <div class="row nowrap"><button class="btn block" id="extend">${icon('clock')}${esc(t('live.extend'))}</button><button class="btn bad block" id="end">${icon('stop')}${esc(t('live.end'))}</button></div>
        </section>
      </div>`;
    bind();
  }

  const guard = async (fn) => { try { const r = await fn(); if (r && r.queued) toast(t('common.queued')); return r; } catch (e) { toastErr(e); } };
  function bind() {
    $$('[data-f]', view).forEach((b) => { b.onclick = () => { S.filter = b.dataset.f; S.full = false; draw(); }; });
    $('#full', view).onclick = () => { S.full = !S.full; S.sel.clear(); draw(); };
    $$('[data-sel]', view).forEach((c) => { c.onchange = () => { c.checked ? S.sel.add(c.dataset.sel) : S.sel.delete(c.dataset.sel); draw(); }; });
    $$('[data-dec]', view).forEach((b) => { b.onclick = () => guard(() => act('POST', `/lock/requests/${b.dataset.dec}/decision`, { approve: b.dataset.a === '1' })); });
    $$('[data-rel]', view).forEach((b) => { b.onclick = () => guard(() => act('POST', `/lock/sessions/${id}/release`, { studentIds: [b.dataset.rel] })); });
    $$('[data-lock]', view).forEach((b) => { b.onclick = () => guard(() => act('POST', `/lock/sessions/${id}/relock`, { studentIds: [b.dataset.lock] })); });
    const sel = $('#relSel', view); if (sel) sel.onclick = async () => { await guard(() => act('POST', `/lock/sessions/${id}/release`, { studentIds: [...S.sel] })); S.sel.clear(); draw(); };
    $('#openAll', view).onclick = async () => { if (await confirmBox({ title: t('live.openAllQ'), text: t('live.openAllD'), ok: t('live.openAll') })) { const r = await guard(() => act('POST', `/lock/sessions/${id}/release`, {})); if (r && !r.queued) toast(t('live.opened'), 'ok'); } };
    $('#lockAll', view).onclick = async () => { const r = await guard(() => act('POST', `/lock/sessions/${id}/relock`, {})); if (r && !r.queued) toast(t('live.relocked'), 'ok'); };
    $('#qr', view).onclick = showQr;
    $('#extend', view).onclick = extendSheet;
    $('#sendTest', view).onclick = testSheet;
    $('#sendMat', view).onclick = matSheet;
    $('#end', view).onclick = async () => {
      if (!(await confirmBox({ title: t('live.endQ'), text: t('live.endD'), ok: t('live.end'), danger: true }))) return;
      const r = await guard(() => act('POST', `/sessions/${id}/end`, {}));
      if (r) go(r.queued ? '/' : `/reports/${id}`, true);
    };
  }

  async function showQr() {
    const o = document.createElement('div'); o.className = 'qrfull'; o.innerHTML = `<div class="spinner"></div>`; $('#overlays').appendChild(o);
    try {
      const q = await get(`/teacher/sessions/${id}/qr`);
      const link = `${location.origin}/teacher/#/live/${id}?qr=1`;
      o.innerHTML = `<div style="font-size:22px;font-weight:700">${esc(t('live.joinD'))}</div><img src="${q.qr}" alt="QR"><div class="code">${esc(q.code)}</div>
        <div class="row" style="justify-content:center"><button class="btn" id="cp">${icon('copy')}${esc(t('live.copyLink'))}</button><button class="btn pri" id="cl">${esc(t('common.close'))}</button></div>
        <div class="muted small">${esc(t('live.projectorD'))}<br><b>${esc(link)}</b></div>`;
      o.querySelector('#cl').onclick = () => o.remove();
      o.querySelector('#cp').onclick = async () => { try { await navigator.clipboard.writeText(link); toast(t('live.copied'), 'ok'); } catch { prompt('', link); } };
      document.addEventListener('keydown', function esc1(e) { if (e.key === 'Escape') { o.remove(); document.removeEventListener('keydown', esc1); } });
    } catch (e) { o.remove(); toastErr(e); }
  }

  function extendSheet() {
    const mins = [5, 10, 15, 30];
    sheet({ html: `<h2>${esc(t('live.extend'))}</h2><div class="chips" style="margin:14px 0">${mins.map((m) => `<button class="chip" data-m="${m}">+${esc(t('common.minutes', { n: m }))}</button>`).join('')}</div>`,
      bind: (el, close) => el.querySelectorAll('[data-m]').forEach((b) => { b.onclick = async () => { close(); const r = await guard(() => act('POST', `/lock/sessions/${id}/extend`, { minutes: Number(b.dataset.m) })); if (r && !r.queued) { S.endsAt += Number(b.dataset.m) * 60000; toast(t('live.extended'), 'ok'); } }; }) });
  }

  async function testSheet() {
    let tests = []; try { tests = (await get('/testpacks')).testpacks; } catch (e) { return toastErr(e); }
    sheet({ html: `<h2>${esc(t('live.pickTest'))}</h2><div class="list" style="margin-top:10px">${tests.length ? tests.map((x) => `<div class="item tap" data-t="${esc(x.id)}" role="button" tabindex="0"><div class="ico">${icon('test')}</div><div class="grow"><b>${esc(x.title)}</b><div class="muted small">${esc(t('common.questions', { n: x.questions.length }))}</div></div>${icon('send', 'muted')}</div>`).join('') : `<p class="muted">${esc(t('live.noTests'))}</p><a class="btn pri block" href="#/tests/new" data-close>${esc(t('tests.new'))}</a>`}</div>`,
      bind: (el, close) => el.querySelectorAll('[data-t]').forEach((b) => { b.onclick = async () => { close(); S.quiz = { n: 0, total: S.ov ? S.ov.students.length : 0 }; try { await post(`/testpacks/${b.dataset.t}/broadcast`, { sessionId: id }); toast(t('live.testSent'), 'ok'); draw(); } catch (e) { S.quiz = null; toastErr(e); } }; }) });
  }

  async function matSheet() {
    let mats = []; try { mats = (await get('/teacher/materials')).materials; } catch (e) { return toastErr(e); }
    sheet({ html: `<h2>${esc(t('live.pickMat'))}</h2><div class="list" style="margin-top:10px">${mats.length ? mats.map((m) => `<div class="item tap" data-m="${esc(m.id)}" role="button" tabindex="0"><div class="ico">${icon(m.kind === 'link' ? 'link' : 'file')}</div><div class="grow"><b class="ellipsis" style="display:block">${esc(m.title)}</b><div class="muted small">${esc(m.kind === 'link' ? m.url : (m.fileLabel || m.fileName))}</div></div>${icon('send', 'muted')}</div>`).join('') : `<p class="muted">${esc(t('live.noMats'))}</p><a class="btn pri block" href="#/materials" data-close>${esc(t('mats.title'))}</a>`}</div>`,
      bind: (el, close) => el.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { const m = mats.find((x) => x.id === b.dataset.m); close(); sock.emit('teacher-send-material', { sessionId: id, material: { title: m.title, text: '', url: m.kind === 'link' ? m.url : '', fileUrl: m.kind === 'file' ? m.url : '', fileName: m.fileName, fileSize: m.fileSize, fileType: m.fileType || 'document', fileLabel: m.fileLabel, fileColor: m.fileColor } }); toast(t('live.matSent'), 'ok'); }; }) });
  }

  if (query.qr === '1') setTimeout(showQr, 150);
  return { unmount() { clearInterval(tick); sock.off('lock-overview', onOv); sock.off('quiz-submission-update', onQuiz); sock.off('access-request', onReq); sock.off('connect', sub); } };
}
