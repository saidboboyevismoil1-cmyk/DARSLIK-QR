// Jonli viktorina / tezkor raund: ustoz ekrani (proyektorga chiqariladi). Talabalar /play.html orqali PIN yoki QR bilan qo'shiladi.
import { $, $$, esc, icon, fmtTime } from '../util.js';
import { t } from '../i18n.js';
import { get, post, download, session } from '../api.js';
import { sheet, toast, toastErr, spinner, emptyState, confirmBox } from '../ui.js';
import { go } from '../app.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
/** Boss jonining chizig'i (proyektorda ko'rinadi). */
const bossBar = (b) => (b ? `<div class="boss" role="img" aria-label="${esc(t('game.bossHp', { a: b.hp, b: b.maxHp }))}"><span class="bn" aria-hidden="true">👾 ${esc(t('game.bossName'))}</span><div class="bhp" aria-hidden="true"><i style="width:${b.maxHp ? Math.max(0, Math.round((b.hp / b.maxHp) * 100)) : 0}%"></i></div><span class="bv" aria-hidden="true">${b.hp}/${b.maxHp}</span></div>` : '');

/** Testlar ro'yxatidan: o'yin turini tanlash oynasi. */
/** Jamoaviy jang: 2 jamoa — arqon tortish, 3 jamoa — poyga. Emoji + nom + rang (faqat rangga tayanilmaydi). */
const teamName = (tm) => t('game.team.' + tm.key);
function teamTrack(teams, total) {
  if (!teams || !teams.length) return '';
  const tot = Math.max(1, total || 1);
  const last = teams[0].last ? `<div class="tlast">${teams.map((tm) => `<span>${esc(tm.emoji)} ${esc(teamName(tm))}: ${esc(t('game.teamPct', { p: tm.last.pct }))}</span>`).join('')}</div>` : '';
  if (teams.length === 2) {
    const x = Math.max(6, Math.min(94, 50 - ((teams[0].progress - teams[1].progress) / tot) * 50));
    return `<div class="card stack"><b>${esc(t('game.rope'))}</b><div class="rope" role="img" aria-label="${esc(teams.map((tm) => `${teamName(tm)} ${tm.progress}`).join(' — '))}"><span class="rt">${esc(teams[0].emoji)} <b>${esc(teamName(teams[0]))}</b> · ${teams[0].progress}</span><div class="rtrack"><i class="rknot" style="left:${x}%"></i></div><span class="rt"><b>${esc(teamName(teams[1]))}</b> ${esc(teams[1].emoji)} · ${teams[1].progress}</span></div>${last}</div>`;
  }
  return `<div class="card stack"><b>${esc(t('game.race'))}</b><div class="race" role="img" aria-label="${esc(t('game.race'))}">${teams.map((tm) => `<div class="lane"><span class="ln">${esc(tm.emoji)} ${esc(teamName(tm))}</span><div class="lbar"><i style="width:${Math.max(3, Math.min(100, Math.round((tm.progress / tot) * 100)))}%;background:${esc(tm.color)}"></i></div><span class="lv">${tm.progress}</span></div>`).join('')}</div>${last}</div>`;
}

export async function openGameSheet(pack) {
  if (!pack) return;
  if (!pack.questions || !pack.questions.length) return toast(t('game.noQuestions'), 'bad');
  let lesson = null; try { lesson = ((await get('/teacher/sessions?status=active&limit=1')).sessions || [])[0] || null; } catch { /* faol dars yo'q */ }
  const st = { mode: 'classic', time: 20, teams: 2, toLesson: !!lesson };
  sheet({
    html: `<h2>${esc(pack.title)}</h2>
      <div class="stack" style="margin-top:14px">
        <button class="card opt-card" data-mode="classic" aria-pressed="true"><b>${esc(t('game.classic'))}</b><span class="muted small">${esc(t('game.classicHelp'))}</span></button>
        <button class="card opt-card" data-mode="team" aria-pressed="false"><b>${esc(t('game.teamMode'))}</b><span class="muted small">${esc(t('game.teamHelp'))}</span></button>
        <div id="gteams" hidden><span class="lbl">${esc(t('game.teamsCount'))}</span><div class="chips">${[2, 3].map((n) => `<button class="chip" data-teams="${n}" aria-pressed="${n === 2}">${esc(t('game.teamsN', { n }))}</button>`).join('')}</div></div>
        <button class="card opt-card" data-mode="boss" aria-pressed="false"><b>${esc(t('game.boss'))}</b><span class="muted small">${esc(t('game.bossHelp'))}</span></button>
        <button class="card opt-card" data-mode="blitz" aria-pressed="false"><b>${esc(t('game.blitz'))}</b><span class="muted small">${esc(t('game.blitzHelp'))}</span></button>
        ${lesson ? `<label class="card switch-row" style="cursor:pointer"><span><b>${esc(t('game.toLesson'))}</b><br><span class="muted small">${esc(lesson.name)}${lesson.groupName ? ' · ' + esc(lesson.groupName) : ''} · ${esc(t('common.students', { n: lesson.students }))}<br>${esc(t('game.toLessonHelp'))}</span></span><input id="glesson" type="checkbox" class="switch" checked></label>` : `<p class="help">${esc(t('game.noLesson'))}</p>`}
        <div id="gtime"><span class="lbl">${esc(t('game.time'))}</span><div class="chips">${[10, 20, 30, 45].map((n) => `<button class="chip" data-time="${n}" aria-pressed="${n === st.time}">${esc(t('game.sec', { n }))}</button>`).join('')}</div></div>
        <p class="help">${esc(t('game.nickHint'))}</p>
        <button class="btn pri xl block" id="gcreate">${icon('trophy')}${esc(t('game.create'))}</button>
        <button class="btn ghost block" data-close>${esc(t('common.cancel'))}</button>
      </div>`,
    bind: (el, close) => {
      $$('[data-mode]', el).forEach((b) => { b.onclick = () => { st.mode = b.dataset.mode; $$('[data-mode]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('#gtime', el).hidden = st.mode === 'blitz'; $('#gteams', el).hidden = st.mode !== 'team'; }; });
      $$('[data-teams]', el).forEach((b) => { b.onclick = () => { st.teams = Number(b.dataset.teams); $$('[data-teams]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }; });
      $$('[data-time]', el).forEach((b) => { b.onclick = () => { st.time = Number(b.dataset.time); $$('[data-time]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }; });
      const gl = $('#glesson', el); if (gl) gl.onchange = () => { st.toLesson = gl.checked; };
      $('#gcreate', el).onclick = async (e) => {
        e.currentTarget.disabled = true;
        try { const r = await post('/teacher/games', { testpackId: pack.id, mode: st.mode, teams: st.mode === 'team' ? st.teams : undefined, timePerQ: st.time, sessionId: st.toLesson && lesson ? lesson.id : undefined }); close(); go('/game/' + r.game.id); }
        catch (err) { toast(err.code === 'too_many' ? t('game.tooMany') : (err.message && err.message !== 'error' ? err.message : t('common.error')), 'bad'); e.currentTarget.disabled = false; }
      };
    },
  });
}

export default async function game({ args, view, setTop, stale }) {
  const id = args[0];
  setTop({ title: t('game.play'), backTo: '/tests' });
  view.innerHTML = spinner();
  let info;
  try { info = (await get('/teacher/games/' + id)).game; }
  catch { view.innerHTML = `<div class="card">${emptyState({ ico: 'alert', title: t('game.notFound'), action: `<a class="btn pri" href="#/tests">${esc(t('game.back'))}</a>` })}</div>`; return null; }
  if (stale()) return null;
  setTop({ title: info.title, backTo: '/tests' });

  const S = { invited: info.lesson ? info.lesson.invited : null, status: 'lobby', players: [], q: null, answered: 0, rv: null, fin: null, skew: 0, offline: false };
  // eslint-disable-next-line no-undef
  const sock = io('/game', { auth: { token: session.token }, reconnection: true });
  let tick = null;

  const attach = () => sock.emit('host:attach', { gameId: id }, (r) => {
    if (!r || !r.ok) { view.innerHTML = `<div class="card">${emptyState({ ico: 'alert', title: t('game.notFound') })}</div>`; return; }
    S.offline = false; S.status = r.status; S.players = r.players || []; if (r.lesson) S.invited = r.lesson.invited;
    if (r.question) { S.q = r.question; S.skew = r.question.serverNow - Date.now(); S.answered = r.question.answered || 0; }
    if (r.final) S.fin = r.final;
    draw();
  });
  sock.on('connect', attach);
  sock.on('disconnect', () => { S.offline = true; draw(); });
  sock.on('lobby', (d) => { S.players = d.players; if (d.invited != null) S.invited = d.invited; if (S.status === 'lobby') draw(); else if (S.status === 'question') updProgress(); });
  sock.on('question', (q) => { S.status = 'question'; S.q = q; S.rv = null; S.answered = 0; S.skew = q.serverNow - Date.now(); draw(); });
  sock.on('answers', (d) => { S.answered = d.answered; updProgress(); });
  sock.on('reveal', (rv) => { S.status = 'reveal'; S.rv = rv; draw(); });
  sock.on('final', (f) => { S.status = 'ended'; S.fin = f; draw(); });

  const left = () => Math.max(0, (S.q.endsAt - (Date.now() + S.skew)) / 1000);
  function updProgress() {
    const a = $('#ans'), p = $('#plc');
    if (a) a.textContent = t('game.answered', { a: S.answered, n: S.players.filter((x) => x.connected).length || S.players.length });
    if (p) p.textContent = t('game.players', { n: S.players.length });
  }
  const optLabel = (q, i) => (q.type === 'tf' ? t(i === 0 ? 'tests.true' : 'tests.false') : q.options[i]);
  const emit = (ev, cb) => sock.emit(ev, {}, (r) => { if (r && r.error) toast(r.error === 'no_players' ? t('game.noPlayers') : r.error === 'few_players' ? t('game.fewPlayers', { n: info.mode === 'team' ? (info.teams || 2) : 2 }) : t('common.error'), 'bad'); if (cb) cb(r); });

  function lobby() {
    return `<div class="stack lg">
      ${info.lesson ? `<div class="card center game-pin">
        <div class="muted">${esc(t('game.lessonSent'))}${info.lesson.groupName ? ' · ' + esc(info.lesson.groupName) : ''}</div>
        <div class="big" id="jn">${esc(t('game.joinedOf', { a: S.players.length, n: Math.max(S.invited || 0, S.players.length) }))}</div>
      </div>` : ''}
      <div class="card center game-pin">
        <div class="muted">${esc(t('game.joinAt', { url: info.joinUrl.replace(/\?.*$/, '') }))}</div>
        <div class="pin" aria-label="${esc(t('game.pin'))}">${esc(info.pin)}</div>
        <img class="qr" src="${info.qr}" alt="QR" width="240" height="240">
        <div class="muted small">${esc(t('game.nickHint'))}</div>
      </div>
      <div class="card stack">
        <div class="row nowrap"><b class="grow" id="plc">${esc(t('game.players', { n: S.players.length }))}</b></div>
        ${S.players.length ? `<div class="chips plist">${S.players.map((p) => `<span class="chip pl ${p.connected ? '' : 'off'}"><span aria-hidden="true">${av(p.avatar)}</span> ${esc(p.nick)}<button class="x" data-kick="${esc(p.id)}" aria-label="${esc(t('game.kick'))}">${icon('x')}</button></span>`).join('')}</div>` : `<p class="muted">${esc(t('game.waiting'))}</p>`}
      </div>
      <button class="btn pri xl block" id="gstart" ${S.players.length ? '' : 'disabled'}>${icon('play')}${esc(t('game.start'))}</button>
    </div>`;
  }
  function question() {
    const q = S.q;
    const opts = q.type === 'short' ? `<div class="card center muted">${esc(t('tests.t.short'))}</div>`
      : `<div class="gopts">${(q.type === 'tf' ? [0, 1] : q.options.map((_, i) => i)).map((i) => `<div class="gopt c${i % 4}"><span class="ltr">${LETTERS[i]}</span><span>${esc(optLabel(q, i))}</span></div>`).join('')}</div>`;
    return `<div class="stack lg">
      ${bossBar(q.boss)}${q.teams && q.teams.length ? teamTrack(q.teams, q.total) : ''}
      <div class="row nowrap"><b class="grow">${esc(t('game.q', { i: q.index + 1, n: q.total }))}</b><span class="timer" id="gt">${fmtTime(left())}</span></div>
      <div class="tbar"><i id="gb" style="width:100%"></i></div>
      <div class="card"><h2 class="gq">${esc(q.text)}</h2></div>
      ${opts}
      <div class="row nowrap"><b class="grow" id="ans">${esc(t('game.answered', { a: S.answered, n: S.players.length }))}</b><span class="muted" id="plc">${esc(t('game.players', { n: S.players.length }))}</span></div>
      <button class="btn soft block" id="gskip">${icon('clock')}${esc(t('game.skip'))}</button>
      <button class="btn ghost block" id="gend">${esc(t('game.end'))}</button>
    </div>`;
  }
  const AV = { fox: '🦊', panda: '🐼', lion: '🦁', frog: '🐸', owl: '🦉', koala: '🐨', unicorn: '🦄', tiger: '🐯', penguin: '🐧', octopus: '🐙', dino: '🦖', robot: '🤖', alien: '👽', cat: '🐱', dog: '🐶', whale: '🐳' };
  const av = (k) => AV[k] || '🙂';
  const board = (rows) => `<ol class="lb">${rows.map((r) => `<li><span class="rk">${r.rank}</span><span aria-hidden="true">${av(r.avatar)}</span><b class="grow ellipsis">${esc(r.nick)}</b><span class="sc">${r.score}</span></li>`).join('')}</ol>`;
  function reveal() {
    const rv = S.rv, q = S.q;
    const corr = Array.isArray(rv.correct) ? rv.correct : [rv.correct];
    let body;
    if (rv.type === 'short') {
      body = `<div class="card"><span class="muted small">${esc(t('tests.accept'))}</span><div class="chips" style="margin-top:6px">${rv.correct.map((a) => `<span class="chip" aria-pressed="true">${esc(a)}</span>`).join('')}</div></div>`;
    } else {
      const idxs = rv.type === 'tf' ? [0, 1] : rv.options.map((_, i) => i);
      const max = Math.max(1, ...Object.values(rv.dist));
      const cnt = (i) => rv.dist[String(i)] || 0;
      body = `<div class="gopts">${idxs.map((i) => `<div class="gopt c${i % 4} ${corr.includes(i) ? 'right' : 'dim'}"><span class="ltr">${LETTERS[i]}</span><span class="grow">${esc(rv.type === 'tf' ? t(i === 0 ? 'tests.true' : 'tests.false') : rv.options[i])}</span><b>${cnt(i)}</b><i class="gbar" style="width:${Math.round((cnt(i) / max) * 100)}%"></i></div>`).join('')}</div>`;
    }
    return `<div class="stack lg">
      <div class="row nowrap"><b class="grow">${esc(t('game.q', { i: rv.index + 1, n: rv.total }))}</b><span class="badge">${esc(t('game.correctN', { a: rv.correctCount, n: rv.players }))}</span></div>
      <div class="card"><h2 class="gq">${esc(rv.text)}</h2></div>
      ${body}
      ${rv.explanation ? `<div class="card banner">${icon('book')}<span><b>${esc(t('game.explain'))}:</b> ${esc(rv.explanation)}</span></div>` : ''}
      ${rv.teams ? teamTrack(rv.teams, rv.total) : rv.boss ? `${bossBar(rv.boss)}<div class="card center"><b>${esc(t('game.bossHit', { n: rv.boss.dmg }))}</b><div class="muted">${esc(rv.boss.defeated ? t('game.bossWin') : t('game.bossLeft', { p: rv.boss.maxHp ? Math.round((rv.boss.hp / rv.boss.maxHp) * 100) : 0 }))}</div></div>` : `<div class="card"><b>${esc(t('game.leaderboard'))}</b>${board(rv.top)}</div>`}
      <button class="btn pri xl block" id="gnext">${esc(t(rv.last ? 'game.results' : 'game.next'))}${icon('next')}</button>
      <button class="btn ghost block" id="gend">${esc(t('game.end'))}</button>
    </div>`;
  }
  function final() {
    const f = S.fin;
    if (f.teams) {                                           // jamoaviy jang: jamoalar podiumi (shaxsiy reyting proyektorda ko'rsatilmaydi; CSV ustoz uchun)
      const lst = f.teams.list, win = f.teams.winner, w = lst.find((x) => x.id === win);
      return `<div class="stack lg">
        <div class="card center"><h2>${esc(w ? t('game.teamWinner', { n: teamName(w) }) : t('game.teamDraw'))}</h2><div class="muted">${esc(t('game.players', { n: f.players }))} · ${esc(t('game.accuracy', { p: Math.round((f.accuracy || 0) * 100) }))}</div></div>
        ${teamTrack(lst, f.questions)}
        <div class="card"><ol class="lb">${lst.map((tm) => `<li><span class="rk">${tm.rank}</span><b class="grow ellipsis">${esc(tm.emoji)} ${esc(teamName(tm))} <span class="muted small">(${esc(t('game.teamSize', { n: tm.size }))})</span></b><span class="sc">${tm.progress}</span></li>`).join('')}</ol></div>
        <div class="row"><button class="btn soft grow" id="gcsv">${icon('download')}${esc(t('game.csv'))}</button><a class="btn pri grow" href="#/tests">${esc(t('game.back'))}</a></div>
      </div>`;
    }
    if (f.boss) {                                            // boss jangi: kollektiv natija (shaxsiy reyting proyektorda ko'rsatilmaydi; CSV ustoz uchun)
      const hits = f.boss.maxHp - f.boss.hp;
      return `<div class="stack lg">
        ${bossBar(f.boss)}
        <div class="card center"><h2>${esc(f.boss.defeated ? t('game.bossWin') : t('game.bossLose'))}</h2><div class="muted">${esc(t('game.players', { n: f.players }))} · ${esc(t('game.accuracy', { p: Math.round((f.accuracy || 0) * 100) }))} · ${esc(t('game.bossStats', { a: hits, b: f.boss.maxHp }))}</div></div>
        <div class="row"><button class="btn soft grow" id="gcsv">${icon('download')}${esc(t('game.csv'))}</button><a class="btn pri grow" href="#/tests">${esc(t('game.back'))}</a></div>
      </div>`;
    }
    const top = f.leaderboard.slice(0, 3);
    const order = [top[1], top[0], top[2]].map((p, i) => p && { ...p, pos: [2, 1, 3][i] });
    return `<div class="stack lg">
      <div class="card center"><h2>${esc(t('game.podium'))}</h2><div class="muted">${esc(t('game.players', { n: f.players }))} · ${esc(t('game.accuracy', { p: Math.round((f.accuracy || 0) * 100) }))}</div></div>
      ${top.length ? `<div class="podium">${order.filter(Boolean).map((p) => `<div class="pod p${p.pos}"><span aria-hidden="true" style="font-size:40px;line-height:1">${av(p.avatar)}</span><b class="ellipsis">${esc(p.nick)}</b><span>${p.score}</span><i>${p.pos}</i></div>`).join('')}</div>` : ''}
      <div class="card"><b>${esc(t('game.leaderboard'))}</b>${board(f.leaderboard.slice(0, 50))}</div>
      <div class="row"><button class="btn soft grow" id="gcsv">${icon('download')}${esc(t('game.csv'))}</button><a class="btn pri grow" href="#/tests">${esc(t('game.back'))}</a></div>
    </div>`;
  }

  function draw() {
    clearInterval(tick);
    const bar = S.offline ? `<div class="netbar" style="display:block">${esc(t('game.lostConn'))}</div>` : '';
    view.innerHTML = bar + (S.status === 'lobby' ? lobby() : S.status === 'question' && S.q ? question() : S.status === 'reveal' && S.rv ? reveal() : S.status === 'ended' && S.fin ? final() : spinner());
    if (S.status === 'question' && S.q) {
      const total = S.q.timeMs / 1000;
      tick = setInterval(() => { const l = left(); const e1 = $('#gt'), e2 = $('#gb'); if (e1) e1.textContent = fmtTime(Math.ceil(l)); if (e2) e2.style.width = Math.min(100, (l / total) * 100) + '%'; if (e1) e1.classList.toggle('low', l <= 5); }, 200);
    }
    $$('[data-kick]', view).forEach((b) => { b.onclick = () => sock.emit('host:kick', { playerId: b.dataset.kick }); });
    const on = (sel, fn) => { const el = $(sel, view); if (el) el.onclick = fn; };
    on('#gstart', () => emit('host:start'));
    on('#gskip', () => emit('host:skip'));
    on('#gnext', () => emit('host:next'));
    on('#gend', async () => { if (await confirmBox({ title: t('game.end'), ok: t('game.end'), danger: true })) emit('host:end'); });
    on('#gcsv', () => download(`/teacher/games/${id}/results?format=csv`, `edufocus-oyin-${id}.csv`).catch(toastErr));
  }
  draw();
  if (sock.connected) attach();

  return {
    unmount() { clearInterval(tick); sock.close(); },
  };
}
