// Jonli viktorina mantiqi (socket va vaqt-taymerlardan mustaqil — shuning uchun sinash oson).
// Holatlar: lobby → question → reveal → (question → reveal)… → ended
// Ball: to'g'ri javob uchun 500..1000 (qolgan vaqtga qarab) + ketma-ket to'g'ri javoblar uchun bonus (har biriga +100, ko'pi bilan +500).
const quizLib = require('../quiz');

const MAX_PLAYERS = 300;
const TEAM_DEFS = [{ id: 0, key: 'lion', emoji: '🦁', color: '#dc2626' }, { id: 1, key: 'eagle', emoji: '🦅', color: '#2563eb' }, { id: 2, key: 'wolf', emoji: '🐺', color: '#059669' }];
const BOSS_FACTOR = 0.6;                                   // boss: sinf umumiy savollarning ~60% iga to'g'ri javob bersa, boss yengiladi
const NICK_MIN = 2, NICK_MAX = 20;
// Personajlar (Kahoot kabi): talaba tanlaydi yoki tasodifiy beriladi. Faqat shu ro'yxatdagi kalit qabul qilinadi.
const AVATARS = [
  { key: 'fox', emoji: '🦊' }, { key: 'panda', emoji: '🐼' }, { key: 'lion', emoji: '🦁' }, { key: 'frog', emoji: '🐸' },
  { key: 'owl', emoji: '🦉' }, { key: 'koala', emoji: '🐨' }, { key: 'unicorn', emoji: '🦄' }, { key: 'tiger', emoji: '🐯' },
  { key: 'penguin', emoji: '🐧' }, { key: 'octopus', emoji: '🐙' }, { key: 'dino', emoji: '🦖' }, { key: 'robot', emoji: '🤖' },
  { key: 'alien', emoji: '👽' }, { key: 'cat', emoji: '🐱' }, { key: 'dog', emoji: '🐶' }, { key: 'whale', emoji: '🐳' },
];
const AVATAR_KEYS = AVATARS.map((a) => a.key);
/** Tanlangan personaj yaroqli bo'lsa va band bo'lmasa — o'shani, aks holda bo'sh personajlardan tasodifiy birini beradi. */
function pickAvatar(g, wanted) {
  const used = new Set([...g.players.values()].map((p) => p.avatar));
  if (AVATAR_KEYS.includes(wanted) && !used.has(wanted)) return wanted;
  const free = AVATAR_KEYS.filter((k) => !used.has(k));
  const pool = free.length ? free : AVATAR_KEYS;
  return pool[Math.floor((g.rand || Math.random)() * pool.length)];
}

/** Taxallusni tozalaydi: boshqaruv belgilari va <> olib tashlanadi, bo'shliqlar bittaga. Yaroqsiz bo'lsa null. */
function cleanNick(raw) {
  const s = String(raw == null ? '' : raw).normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NICK_MAX);
  return s.length >= NICK_MIN ? s : null;
}

function calcPoints(timeMs, elapsedMs, streakBefore) {
  const frac = Math.max(0, Math.min(1, 1 - elapsedMs / Math.max(1, timeMs)));
  return Math.round(1000 * (0.5 + 0.5 * frac)) + Math.min(5, streakBefore) * 100;
}

function createGame({ id, pin, teacherId, testpackId = '', title, questions, mode = 'classic', timePerQ = 20, auto = false, sessionId = '', groupName = '', teams = 2, rand = Math.random }) {
  let qs = quizLib.normalizeQuestions(questions);
  if (mode === 'blitz') {                                    // tezkor raund: tasodifiy 5 ta savol
    const idx = qs.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    qs = idx.slice(0, 5).sort((a, b) => a - b).map((i) => qs[i]);
  }
  const g = {
    id, pin, teacherId, testpackId, title: String(title || '').slice(0, 120), mode, auto: !!auto, sessionId: String(sessionId || ''), groupName: String(groupName || '').slice(0, 80),
    invites: new Map(),                                      // dars o'yini: ticket → { studentId, name }
    timePerQ: Math.min(120, Math.max(5, Math.round(timePerQ) || 20)),
    questions: qs, status: 'lobby', qIndex: -1, createdAt: Date.now(), startedAt: null, endedAt: null,
    players: new Map(), cur: null, perQ: [],
  };
  // Boss jangi: butun sinf birgalikda; har to'g'ri javob — 1 zarba. Jon o'yin boshida o'yinchilar soniga qarab belgilanadi.
  if (mode === 'boss') g.boss = { maxHp: 0, hp: 0, defeated: false, rounds: [] };
  // Jamoaviy jang: 2 yoki 3 jamoa. Jamoalar o'yin boshida tasodifiy teng bo'linadi; hisob — a'zolar soniga nisbatan (adolatli).
  if (mode === 'team') { g.team = { count: Number(teams) === 3 ? 3 : 2, list: [] }; g.rand = rand; }
  return g;
}

function join(g, rawNick, now = Date.now(), wantedAvatar) {
  if (g.status === 'ended') return { error: 'ended' };
  const nick = cleanNick(rawNick);
  if (!nick) return { error: 'nick_invalid' };
  if (g.players.size >= MAX_PLAYERS) return { error: 'full' };
  const low = nick.toLowerCase();
  for (const p of g.players.values()) if (p.nick.toLowerCase() === low) return { error: 'nick_taken' };
  const p = { id: 'p' + Math.random().toString(36).slice(2, 10), token: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2), nick, avatar: pickAvatar(g, wantedAvatar), score: 0, streak: 0, correct: 0, answered: 0, joinedAt: now, connected: true };
  g.players.set(p.id, p);
  return { player: p };
}

/** Dars o'yini: talaba dars ro'yxatidagi ismi bilan qo'shiladi (taxallus emas). Bir xil ism bo'lsa raqam qo'shiladi. Qayta chaqirilsa mavjud o'yinchi qaytariladi. */
function joinLesson(g, invite, now = Date.now(), wantedAvatar) {
  if (g.status === 'ended') return { error: 'ended' };
  for (const p of g.players.values()) if (p.studentId === invite.studentId) return { player: p, again: true };
  if (g.status !== 'lobby') return { error: 'started' };
  if (g.players.size >= MAX_PLAYERS) return { error: 'full' };
  const base = cleanNick(invite.name) || 'Talaba';
  let nick = base, n = 2;
  const taken = (x) => [...g.players.values()].some((p) => p.nick.toLowerCase() === x.toLowerCase());
  while (taken(nick)) nick = `${base.slice(0, NICK_MAX - 4)} ${n++}`;
  const p = { id: 'p' + Math.random().toString(36).slice(2, 10), token: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2), nick, avatar: pickAvatar(g, wantedAvatar), studentId: invite.studentId, score: 0, streak: 0, correct: 0, answered: 0, joinedAt: now, connected: true };
  g.players.set(p.id, p);
  return { player: p };
}

function start(g, now = Date.now()) {
  if (g.status !== 'lobby') return { error: 'bad_state' };
  if (!g.questions.length) return { error: 'no_questions' };
  g.startedAt = now;
  if (g.team) {
    if (g.players.size < g.team.count) return { error: 'few_players' };
    const ps = [...g.players.values()];
    for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(g.rand() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
    ps.forEach((p, i) => { p.team = i % g.team.count; });
    g.team.list = TEAM_DEFS.slice(0, g.team.count).map((d) => ({ ...d, size: ps.filter((p) => p.team === d.id).length, correct: 0, progress: 0, points: 0, score: 0 }));
  }
  if (g.boss) { g.boss.maxHp = Math.max(3, Math.ceil(BOSS_FACTOR * g.players.size * g.questions.length)); g.boss.hp = g.boss.maxHp; }
  return openQuestion(g, 0, now);
}

function openQuestion(g, i, now) {
  g.qIndex = i; g.status = 'question';
  const q = g.questions[i];
  g.cur = { index: i, startedAt: now, endsAt: now + g.timePerQ * 1000, answers: new Map(), closed: false };
  return { question: publicView(g, q, i), endsAt: g.cur.endsAt };
}

function publicView(g, q, i) {
  return { index: i, total: g.questions.length, ...quizLib.publicQuestion(q), timeMs: g.timePerQ * 1000, ...(g.boss ? { boss: { hp: g.boss.hp, maxHp: g.boss.maxHp } } : {}), ...(g.team ? { teams: teamsView(g) } : {}) };
}

const teamsView = (g) => g.team.list.map((t) => ({ id: t.id, key: t.key, emoji: t.emoji, color: t.color, size: t.size, progress: Math.round(t.progress * 100) / 100, score: t.score }));

/** Javobni qabul qiladi (birinchi javob hisoblanadi). → { ok } yoki { error } */
function answer(g, playerId, qi, ans, now = Date.now()) {
  const p = g.players.get(playerId);
  if (!p) return { error: 'no_player' };
  if (g.status !== 'question' || !g.cur || g.cur.closed) return { error: 'closed' };
  if (Number(qi) !== g.cur.index) return { error: 'wrong_question' };
  if (now > g.cur.endsAt + 400) return { error: 'late' };                // tarmoq kechikishi uchun 0.4 s yengillik
  if (g.cur.answers.has(playerId)) return { error: 'already' };
  g.cur.answers.set(playerId, { ans, at: now });
  return { ok: true, answered: g.cur.answers.size, total: g.players.size };
}

const allAnswered = (g) => g.cur && g.players.size > 0 && [...g.players.values()].every((p) => g.cur.answers.has(p.id));

/** Savolni yopadi, ballarni hisoblaydi. → reveal ma'lumoti */
function closeQuestion(g, now = Date.now()) {
  if (g.status !== 'question' || !g.cur || g.cur.closed) return null;
  g.cur.closed = true; g.status = 'reveal';
  const q = g.questions[g.cur.index];
  const timeMs = g.timePerQ * 1000;
  const results = new Map();
  const dist = {};
  let correctN = 0;
  for (const p of g.players.values()) {
    const a = g.cur.answers.get(p.id);
    let correct = false, points = 0;
    if (a) {
      const gr = quizLib.grade(q, a.ans);
      correct = gr.isCorrect;
      const key = q.type === 'short' ? (correct ? 'correct' : 'wrong') : Array.isArray(gr.selected) ? gr.selected.join(',') : String(gr.selected);
      dist[key] = (dist[key] || 0) + 1;
      p.answered++;
      if (correct) { points = calcPoints(timeMs, a.at - g.cur.startedAt, p.streak); p.streak++; p.correct++; p.score += points; correctN++; } else p.streak = 0;
    } else { p.streak = 0; dist.none = (dist.none || 0) + 1; }
    results.set(p.id, { correct, points, answered: !!a, score: p.score, streak: p.streak });
  }
  g.perQ.push({ text: q.text.slice(0, 200), correct: correctN, answered: g.cur.answers.size, players: g.players.size });
  g.cur.results = results;
  const board = leaderboard(g);
  g.cur.board = board;
  let teamsOut = null;
  if (g.team) {                                              // har jamoaning shu savoldagi natijasi (a'zolar soniga nisbatan)
    for (const t of g.team.list) {
      const members = [...g.players.values()].filter((p) => p.team === t.id);
      const ok = members.filter((p) => results.get(p.id).correct).length, pts = members.reduce((a, p) => a + results.get(p.id).points, 0);
      t.correct += ok; t.points += pts; t.progress += t.size ? ok / t.size : 0; t.score = t.size ? Math.round(t.points / t.size) : 0;
      t.last = { correct: ok, size: t.size, pct: t.size ? Math.round((ok / t.size) * 100) : 0 };
    }
    teamsOut = g.team.list.map((t) => ({ id: t.id, key: t.key, emoji: t.emoji, color: t.color, size: t.size, progress: Math.round(t.progress * 100) / 100, score: t.score, last: t.last }));
  }
  let boss = null;
  if (g.boss) {                                              // to'g'ri javoblar soni — bossga zarba
    g.boss.hp = Math.max(0, g.boss.hp - correctN);
    if (g.boss.hp === 0) g.boss.defeated = true;
    g.boss.rounds.push({ dmg: correctN, hp: g.boss.hp });
    boss = { hp: g.boss.hp, maxHp: g.boss.maxHp, dmg: correctN, defeated: g.boss.defeated };
  }
  const last = g.cur.index >= g.questions.length - 1 || !!(g.boss && g.boss.defeated);
  return { index: g.cur.index, total: g.questions.length, last, correct: quizLib.correctOf(q), type: q.type, options: q.options || [], text: q.text, explanation: q.explanation || '', dist, answered: g.cur.answers.size, players: g.players.size, correctCount: correctN, top: board.slice(0, 5), boss, teams: teamsOut, results };
}

function leaderboard(g) {
  return [...g.players.values()].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
    .map((p, i) => ({ rank: i + 1, id: p.id, nick: p.nick, avatar: p.avatar, score: p.score, correct: p.correct, streak: p.streak, ...(p.team !== undefined ? { team: p.team } : {}) }));
}

/** Keyingi savol yoki o'yin tugashi. */
function next(g, now = Date.now()) {
  if (g.status === 'question') return { error: 'bad_state' };
  if (g.status !== 'reveal') return { error: 'bad_state' };
  if (g.qIndex + 1 >= g.questions.length || (g.boss && g.boss.defeated)) return end(g, now);
  return openQuestion(g, g.qIndex + 1, now);
}

function end(g, now = Date.now()) {
  if (g.status === 'ended') return { final: summary(g) };
  g.status = 'ended'; g.endedAt = now; g.cur = null;
  return { final: summary(g) };
}

function summary(g) {
  const board = leaderboard(g);
  const tot = g.perQ.reduce((a, q) => a + q.players, 0);
  const ok = g.perQ.reduce((a, q) => a + q.correct, 0);
  return { id: g.id, title: g.title, mode: g.mode, players: g.players.size, questions: g.questions.length, accuracy: tot ? ok / tot : 0, startedAt: g.startedAt, endedAt: g.endedAt, boss: g.boss ? { maxHp: g.boss.maxHp, hp: g.boss.hp, defeated: g.boss.defeated, rounds: g.boss.rounds } : undefined, teams: g.team ? teamRanking(g) : undefined, leaderboard: board, perQuestion: g.perQ.map((q) => ({ text: q.text, pct: q.players ? Math.round((q.correct / q.players) * 100) : 0 })) };
}

/** Jamoalar reytingi: avval progress (to'g'ri javoblar ulushi yig'indisi), teng bo'lsa — o'rtacha ball. winner: yagona g'olib id yoki null (durang). */
function teamRanking(g) {
  const list = teamsView(g).sort((a, b) => b.progress - a.progress || b.score - a.score).map((t, i) => ({ ...t, rank: i + 1 }));
  const tie = list.length > 1 && list[0].progress === list[1].progress && list[0].score === list[1].score;
  return { list, winner: tie || !list.length ? null : list[0].id };
}

function remove(g, playerId) { return g.players.delete(playerId); }

module.exports = { AVATARS, AVATAR_KEYS, TEAM_DEFS, teamRanking, teamsView, createGame, join, joinLesson, start, answer, allAnswered, closeQuestion, next, end, leaderboard, summary, remove, cleanNick, calcPoints, MAX_PLAYERS };
