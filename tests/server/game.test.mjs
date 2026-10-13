// AI test yaratish (mock) va jonli viktorina: mantiq (birlik) + haqiqiy server bilan to'liq oqim.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { io as ioc } from 'socket.io-client';
import { startServer, makeApi, teacherLogin, sleep, joinStudent, connect } from './helpers.mjs';

const require = createRequire(import.meta.url);
const E = require('../../server/game/engine.js');
const { createAi, normalizeRequest, buildPrompt, anthropicGenerate } = require('../../server/ai/index.js');
const quizLib = require('../../server/quiz.js');
const { csvCell } = require('../../server/game/index.js');

const TEXT = "Quyosh sistemasi sakkizta sayyoradan iborat. Yer Quyoshdan uchinchi o'rinda joylashgan sayyoradir. Mars sayyorasi qizil rangda ko'rinadi. Yupiter eng katta sayyora hisoblanadi. Saturn halqalari bilan mashhur sayyoradir.";

describe('AI (mock)', () => {
  const ai = createAi({ provider: 'mock' });
  test('matndan so\'ralgan sondagi yaroqli savollar tuzadi, izohlar bilan', async () => {
    const r = await ai.generateQuiz({ topic: TEXT, count: 5, types: ['single', 'tf', 'short'], explanations: true, lang: 'uz' });
    assert.equal(r.mock, true);
    assert.equal(r.questions.length, 5);
    assert.deepEqual(quizLib.validateQuestions(r.questions), []);
    assert.ok(r.questions.every((q) => q.explanation), 'har savolda izoh bo\'lishi kerak');
    assert.ok(new Set(r.questions.map((q) => q.type)).size >= 2, 'turlar aralash');
  });
  test('izohlar o\'chirilsa izoh bo\'lmaydi; bir xil kirish → bir xil natija', async () => {
    const a = await ai.generateQuiz({ topic: TEXT, count: 4, explanations: false });
    const b = await ai.generateQuiz({ topic: TEXT, count: 4, explanations: false });
    assert.ok(a.questions.every((q) => !q.explanation));
    assert.deepEqual(a.questions, b.questions);
  });
  test('qisqa mavzu (matn emas) ham ishlaydi; uchala til', async () => {
    for (const lang of ['uz', 'ru', 'en']) {
      const r = await ai.generateQuiz({ topic: 'Fotosintez', count: 3, lang });
      assert.equal(r.questions.length, 3); assert.deepEqual(quizLib.validateQuestions(r.questions), []);
    }
  });
  test('kirish tekshiruvi: bo\'sh mavzu rad etiladi, son chegaralanadi, begona qiymatlar tashlanadi', () => {
    assert.throws(() => normalizeRequest({ topic: ' ' }), (e) => e.status === 400);
    const n = normalizeRequest({ topic: 'abc', count: 999, difficulty: 'x', lang: 'de', types: ['hack', 'tf'] });
    assert.equal(n.count, 30); assert.equal(n.difficulty, 'medium'); assert.equal(n.lang, 'uz'); assert.deepEqual(n.types, ['tf']);
  });
  test('o\'chirilgan rejimda 503', async () => {
    await assert.rejects(createAi({ provider: 'off' }).generateQuiz({ topic: 'abc' }), (e) => e.status === 503);
  });
  test('Claude provayderi: javobni o\'qiydi, yaroqsizini tashlaydi, xatoda 502 (soxta fetch bilan)', async () => {
    const good = [{ type: 'single', text: '2+2?', options: ['3', '4', '5', '6'], correct: 1, explanation: 'Yig\'indi' }, { type: 'single', text: '', options: ['a', 'b'], correct: 0 }];
    const fakeOk = async () => ({ ok: true, json: async () => ({ content: [{ text: 'Mana:\n' + JSON.stringify(good) }] }) });
    const ai2 = createAi({ provider: 'anthropic', anthropicKey: 'k', model: 'm' });
    const r = await ai2.generateQuiz({ topic: 'Matematika', count: 5 }, { fetch: fakeOk });
    assert.equal(r.questions.length, 1); assert.equal(r.dropped, 1); assert.equal(r.mock, false);
    await assert.rejects(ai2.generateQuiz({ topic: 'Matematika' }, { fetch: async () => ({ ok: false }) }), (e) => e.status === 502);
    await assert.rejects(ai2.generateQuiz({ topic: 'Matematika' }, { fetch: async () => ({ ok: true, json: async () => ({ content: [{ text: 'json yo\'q' }] }) }) }), (e) => e.status === 502);
    assert.ok(buildPrompt(normalizeRequest({ topic: 'X mavzu' })).includes('X mavzu'));
  });
});

describe('Viktorina mantiqi', () => {
  test('personaj: tanlangan band bo\'lmasa beriladi, band bo\'lsa boshqasi, noto\'g\'ri kalit tasodifiy', () => {
    const g = E.createGame({ id: 'a', pin: '111111', teacherId: 't', title: 'x', questions: [{ type: 'tf', text: 'Q', correct: 0 }] });
    const a = E.join(g, 'Ali', Date.now(), 'panda').player, b = E.join(g, 'Vali', Date.now(), 'panda').player, c = E.join(g, 'Gul', Date.now(), '<script>').player;
    assert.equal(a.avatar, 'panda'); assert.notEqual(b.avatar, 'panda');
    assert.ok(E.AVATAR_KEYS.includes(b.avatar) && E.AVATAR_KEYS.includes(c.avatar));
    assert.equal(new Set([a, b, c].map((p) => p.avatar)).size, 3);
  });

  const QS = [
    { type: 'single', text: 'Q1', options: ['a', 'b', 'c'], correct: 1, explanation: 'b chunki' },
    { type: 'tf', text: 'Q2', correct: 0 },
    { type: 'short', text: 'Q3', accept: ['Toshkent'] },
  ];
  const mk = (extra = {}) => E.createGame({ id: 'g1', pin: '123456', teacherId: 't1', title: 'T', questions: QS, ...extra });

  test('taxallus tozalanadi va takrorlanmaydi', () => {
    const g = mk();
    assert.equal(E.cleanNick('  Ali\u0000   <b>Vali</b> '), 'Ali bVali/b');
    assert.equal(E.cleanNick('a'), null);
    assert.ok(E.join(g, 'Ali').player);
    assert.equal(E.join(g, 'ALI').error, 'nick_taken');
    assert.equal(E.join(g, '').error, 'nick_invalid');
  });
  test('ball: tezroq javob ko\'proq; ketma-ket to\'g\'ri javob bonus beradi; xato javob seriyani uzadi', () => {
    assert.equal(E.calcPoints(20000, 0, 0), 1000);
    assert.equal(E.calcPoints(20000, 20000, 0), 500);
    assert.ok(E.calcPoints(20000, 2000, 0) > E.calcPoints(20000, 15000, 0));
    assert.equal(E.calcPoints(20000, 0, 3), 1300); assert.equal(E.calcPoints(20000, 0, 9), 1500);
    const g = mk(); const a = E.join(g, 'Ali').player, b = E.join(g, 'Vali').player;
    const t0 = 1000000; E.start(g, t0);
    assert.equal(E.answer(g, a.id, 0, 1, t0 + 1000).ok, true);
    assert.equal(E.answer(g, a.id, 0, 2, t0 + 1500).error, 'already');
    assert.equal(E.answer(g, b.id, 0, 0, t0 + 2000).ok, true);        // noto'g'ri
    const rv = E.closeQuestion(g, t0 + 21000);
    assert.equal(rv.correct, 1); assert.equal(rv.correctCount, 1); assert.equal(rv.explanation, 'b chunki');
    assert.ok(rv.results.get(a.id).points > 900); assert.equal(rv.results.get(b.id).points, 0);
    assert.equal(rv.top[0].nick, 'Ali');
  });
  test('kech, noto\'g\'ri savol raqami va yopilgandan keyingi javoblar rad etiladi; to\'g\'ri javob oldindan sizmaydi', () => {
    const g = mk(); const a = E.join(g, 'Ali').player; const t0 = 5e6;
    const o = E.start(g, t0);
    assert.equal(o.question.correct, undefined); assert.equal(o.question.explanation, undefined); assert.equal(o.question.accept, undefined);
    assert.equal(E.answer(g, a.id, 5, 0, t0 + 10).error, 'wrong_question');
    assert.equal(E.answer(g, a.id, 0, 1, t0 + 21000).error, 'late');
    E.closeQuestion(g, t0 + 21000);
    assert.equal(E.answer(g, a.id, 0, 1, t0 + 100).error, 'closed');
  });
  test('qisqa javob katta-kichik harfga qaramaydi; hammasi javob bersa allAnswered; oxirida final', () => {
    const g = mk(); const a = E.join(g, 'Ali').player; let t = 1e6;
    E.start(g, t); E.answer(g, a.id, 0, 1, t + 100); assert.equal(E.allAnswered(g), true); E.closeQuestion(g, t + 200);
    E.next(g, t + 300); E.answer(g, a.id, 1, 0, t + 400); E.closeQuestion(g, t + 500);
    E.next(g, t + 600); E.answer(g, a.id, 2, '  toshkent ', t + 700);
    const rv = E.closeQuestion(g, t + 800);
    assert.equal(rv.last, true); assert.equal(rv.results.get(a.id).correct, true);
    const fin = E.next(g, t + 900).final;
    assert.equal(g.status, 'ended'); assert.equal(fin.leaderboard[0].correct, 3); assert.equal(fin.accuracy, 1);
  });
  test('tezkor raund: eng ko\'pi 5 ta tasodifiy savol, 10 s', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ type: 'tf', text: 'S' + i, correct: 0 }));
    const g = E.createGame({ id: 'b', pin: '1', teacherId: 't', title: 'B', questions: many, mode: 'blitz', timePerQ: 10, auto: true });
    assert.equal(g.questions.length, 5); assert.equal(g.timePerQ, 10);
  });
  test('boshlanmagan o\'yinni boshlab bo\'lmaydi (o\'yinchisiz/savolsiz holatlar)', () => {
    const g = E.createGame({ id: 'x', pin: '2', teacherId: 't', title: 'E', questions: [] });
    assert.equal(E.start(g).error, 'no_questions');
    assert.equal(E.next(mk()).error, 'bad_state');
  });
  test('CSV: formula belgilari zararsizlantiriladi', () => {
    assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
    assert.equal(csvCell('+998'), "'+998"); assert.equal(csvCell('Ali'), 'Ali'); assert.equal(csvCell('a,b'), '"a,b"');
  });
});

describe('Server: AI va o\'yin (to\'liq oqim)', () => {
  let srv, api, T, packId;
  before(async () => {
    srv = await startServer({ AI_PROVIDER: 'mock', AI_RATE_PER_HOUR: '4' });
    api = makeApi(srv.base); ({ token: T } = await teacherLogin(api));
    const r = await api('POST', '/api/testpacks', { title: 'Sayyoralar', subject: 'Astronomiya', timeLimit: 3, questions: [
      { type: 'single', text: 'Eng katta sayyora?', options: ['Mars', 'Yupiter', 'Yer'], correct: 1, explanation: 'Yupiter gaz gigant' },
      { type: 'tf', text: 'Yer Quyoshdan uchinchi', correct: 0 },
      { type: 'short', text: 'Qizil sayyora?', accept: ['Mars'] },
    ] }, T);
    packId = r.testpack.id;
  });
  after(async () => { await srv.stop(); });

  const connectGame = (auth) => { const s = ioc(srv.base + '/game', { auth, transports: ['websocket'], reconnection: false }); const ev = []; s.onAny((e, d) => ev.push({ e, d })); return { s, ev, wait: async (name, pred, ms = 5000) => { const t0 = Date.now(); for (;;) { const h = ev.find((x) => x.e === name && !x.used && (!pred || pred(x.d))); if (h) { h.used = true; return h.d; } if (Date.now() - t0 > ms) throw new Error('kelmadi: ' + name); await sleep(20); } }, call: (e, d) => new Promise((r) => s.emit(e, d, r)) }; };

  test('AI: autentifikatsiya shart, qoralama qaytaradi, saqlanmaydi; soatlik limit', async () => {
    assert.equal((await api('POST', '/api/teacher/ai/quiz', { topic: 'abc' }))._status, 401);
    const before = (await api('GET', '/api/testpacks', undefined, T)).testpacks.length;
    const r = await api('POST', '/api/teacher/ai/quiz', { topic: TEXT, count: 6, types: ['single', 'tf'] }, T);
    assert.equal(r._status, 200); assert.equal(r.questions.length, 6); assert.equal(r.mock, true);
    assert.equal((await api('GET', '/api/testpacks', undefined, T)).testpacks.length, before, 'AI testni o\'zi saqlamasligi kerak');
    assert.equal((await api('POST', '/api/teacher/ai/quiz', { topic: '' }, T))._status, 400);
    for (let i = 0; i < 2; i++) await api('POST', '/api/teacher/ai/quiz', { topic: TEXT }, T);
    assert.equal((await api('POST', '/api/teacher/ai/quiz', { topic: TEXT }, T))._status, 429);
  });
  test('izoh (explanation) testni saqlash/qaytarishda yo\'qolmaydi', async () => {
    const tp = (await api('GET', '/api/testpacks', undefined, T)).testpacks.find((x) => x.id === packId);
    assert.equal(tp.questions[0].explanation, 'Yupiter gaz gigant');
  });
  test('o\'yin yaratish: begona testga ruxsat yo\'q, PIN va QR qaytadi', async () => {
    assert.equal((await api('POST', '/api/teacher/games', { testpackId: packId }))._status, 401);
    assert.equal((await api('POST', '/api/teacher/games', { testpackId: 'yoq' }, T))._status, 404);
    const o = await api('POST', '/api/teacher/games', { testpackId: packId }, T);
    assert.equal(o._status, 200); assert.match(o.game.pin, /^\d{6}$/); assert.ok(o.game.qr.startsWith('data:image/png')); assert.ok(o.game.joinUrl.includes('/play.html?pin='));
  });
  test('to\'liq o\'yin: 3 talaba, hamma savol, reveal, final, tarix va CSV', async () => {
    const o = (await api('POST', '/api/teacher/games', { testpackId: packId, timePerQ: 20 }, T)).game;
    const host = connectGame({ token: T });
    await new Promise((r) => host.s.on('connect', r));
    assert.equal((await host.call('host:attach', { gameId: o.id })).ok, true);
    const mkP = async (nick) => { const p = connectGame({}); await new Promise((r) => p.s.on('connect', r)); const j = await p.call('join', { pin: o.pin, nick }); assert.equal(j.ok, true, nick + ' ' + JSON.stringify(j)); return { ...p, j }; };
    const ali = await mkP('Ali'), vali = await mkP('Vali'), gul = await mkP('Gul');
    assert.equal((await ali.call('join', { pin: o.pin, nick: 'ali' })).error, 'nick_taken');
    assert.equal((await ali.call('join', { pin: '000000', nick: 'Yangi' })).error, 'no_game');
    const lobby = await host.wait('lobby', (d) => d.count === 3);
    assert.deepEqual(lobby.players.map((p) => p.nick).sort(), ['Ali', 'Gul', 'Vali']);
    // ruxsatsiz boshqaruv
    assert.equal((await ali.call('host:start')).error, 'forbidden');
    assert.equal((await host.call('host:start')).ok, true);
    // 1-savol: Ali va Vali to'g'ri, Gul noto'g'ri
    for (const [p, a] of [[ali, 1], [vali, 1], [gul, 0]]) { const q = await p.wait('question'); assert.equal(q.correct, undefined); assert.equal(q.explanation, undefined); assert.equal((await p.call('answer', { qi: 0, answer: a })).ok, true); }
    const rv = await host.wait('reveal'); // hamma javob berdi → darrov yopiladi
    assert.equal(rv.correct, 1); assert.equal(rv.explanation, 'Yupiter gaz gigant'); assert.equal(rv.correctCount, 2); assert.equal(rv.top.length, 3);
    const youGul = await gul.wait('reveal'); assert.equal(youGul.you.correct, false); assert.equal(youGul.you.points, 0);
    const youAli = await ali.wait('reveal'); assert.equal(youAli.you.correct, true); assert.ok(youAli.you.points >= 500);
    // 2-savol
    assert.equal((await host.call('host:next')).ok, true);
    for (const p of [ali, vali, gul]) { await p.wait('question', (q) => q.index === 1); await p.call('answer', { qi: 1, answer: 0 }); }
    await host.wait('reveal', (d) => d.index === 1);
    // 3-savol — Gul javob bermaydi, ustoz o'tkazib yuboradi
    assert.equal((await host.call('host:next')).ok, true);
    await ali.wait('question', (q) => q.index === 2); await ali.call('answer', { qi: 2, answer: ' mars ' });
    await vali.wait('question', (q) => q.index === 2); await vali.call('answer', { qi: 2, answer: 'Venera' });
    assert.equal((await host.call('host:skip')).ok, true);
    const last = await host.wait('reveal', (d) => d.index === 2); assert.equal(last.last, true);
    assert.equal((await host.call('host:next')).ok, true);
    const fin = await host.wait('final');
    assert.equal(fin.players, 3); assert.equal(fin.leaderboard[0].nick, 'Ali');
    const meAli = await ali.wait('final'); assert.equal(meAli.you.rank, 1);
    // personajlar: har o'yinchida noyob; reyting hamma o'yinchiga to'liq va bir vaqtda keladi
    assert.equal(meAli.board.length, 3); assert.ok(meAli.board.every((r) => E.AVATAR_KEYS.includes(r.avatar)));
    assert.equal(new Set(meAli.board.map((r) => r.avatar)).size, 3);
    assert.equal(meAli.you.avatar, meAli.board[0].avatar);
    assert.equal((await vali.wait('final')).board.length, 3);
    // tarix va CSV
    await sleep(100);
    const list = await api('GET', '/api/teacher/games', undefined, T);
    assert.ok(list.past.some((x) => x.id === o.id && x.players === 3));
    const csv = await api('GET', `/api/teacher/games/${o.id}/results?format=csv`, undefined, T, true);
    const text = await csv.text(); assert.ok(text.includes('Ali')); assert.ok(csv.headers.get('content-type').includes('text/csv'));
    // boshqa ustoz natijani ko'ra olmaydi
    const other = await api('POST', '/api/register', { name: 'B', surname: 'C', email: 'other-game@example.uz', phone: '', school: 'X', subject: 'Y', password: 'secret123' });
    assert.equal((await api('GET', `/api/teacher/games/${o.id}/results`, undefined, other.token))._status, 404);
    // tugagan o'yinga qo'shilib bo'lmaydi
    const late = connectGame({}); await new Promise((r) => late.s.on('connect', r));
    assert.equal((await late.call('join', { pin: o.pin, nick: 'Kech' })).error, 'no_game');
    [host, ali, vali, gul, late].forEach((x) => x.s.close());
  });
  test('klassik o\'yin boshlangach yangi o\'yinchi qo\'shilmaydi; tezkor raund avtomatik tugaydi va kech qo\'shilish mumkin', async () => {
    const o = (await api('POST', '/api/teacher/games', { testpackId: packId, mode: 'blitz' }, T)).game;
    assert.equal(o.mode, 'blitz'); assert.equal(o.timePerQ, 10);
    const host = connectGame({ token: T }); await new Promise((r) => host.s.on('connect', r)); await host.call('host:attach', { gameId: o.id });
    const p = connectGame({}); await new Promise((r) => p.s.on('connect', r)); assert.equal((await p.call('join', { pin: o.pin, nick: 'Tez' })).ok, true);
    await host.call('host:start');
    const late = connectGame({}); await new Promise((r) => late.s.on('connect', r)); assert.equal((await late.call('join', { pin: o.pin, nick: 'Kech' })).ok, true, 'blitz da kech qo\'shilish mumkin');
    const q = await p.wait('question'); assert.equal(q.total, 3);
    host.s.close(); p.s.close(); late.s.close();
  });
  test('klassik: boshlangandan keyin qo\'shilish rad etiladi; reconnect token bilan qaytish mumkin', async () => {
    const o = (await api('POST', '/api/teacher/games', { testpackId: packId }, T)).game;
    const host = connectGame({ token: T }); await new Promise((r) => host.s.on('connect', r)); await host.call('host:attach', { gameId: o.id });
    const p = connectGame({}); await new Promise((r) => p.s.on('connect', r)); const j = await p.call('join', { pin: o.pin, nick: 'Barqaror' });
    await host.call('host:start'); await p.wait('question');
    const late = connectGame({}); await new Promise((r) => late.s.on('connect', r));
    assert.equal((await late.call('join', { pin: o.pin, nick: 'Yangi' })).error, 'started');
    p.s.close(); await sleep(100);
    const back = connectGame({}); await new Promise((r) => back.s.on('connect', r));
    const j2 = await back.call('join', { pin: o.pin, nick: 'x', token: j.token });
    assert.equal(j2.ok, true); assert.equal(j2.playerId, j.playerId);
    const q = await back.wait('question'); assert.equal(q.index, 0);
    // o'yinni tugatish
    assert.equal((await host.call('host:end')).ok, true);
    [host, late, back].forEach((x) => x.s.close());
  });
});

describe('Dars guruhiga yuborilgan o\'yin', () => {
  let srv, api, T, packId, S;
  before(async () => {
    srv = await startServer({ AI_PROVIDER: 'mock', GAME_SWEEP_MS: '300' });
    api = makeApi(srv.base); ({ token: T } = await teacherLogin(api));
    packId = (await api('POST', '/api/testpacks', { title: 'Dars testi', questions: [
      { type: 'single', text: 'Q1', options: ['a', 'b'], correct: 1, explanation: 'b' }, { type: 'tf', text: 'Q2', correct: 0 }] }, T)).testpack.id;
    S = (await api('POST', '/api/sessions', { name: 'Fizika 1-guruh', subject: 'Fizika', duration: 45 }, T)).session;
  });
  after(async () => { await srv.stop(); });
  const gconn = (auth) => { const s = ioc(srv.base + '/game', { auth, transports: ['websocket'], reconnection: false }); const ev = []; s.onAny((e, d) => ev.push({ e, d })); return { s, ev, call: (e, d) => new Promise((r) => s.emit(e, d, r)), wait: async (n, ms = 5000) => { const t0 = Date.now(); for (;;) { const h = ev.find((x) => x.e === n && !x.u); if (h) { h.u = true; return h.d; } if (Date.now() - t0 > ms) throw new Error('kelmadi: ' + n); await sleep(20); } } }; };
  const opened = (c) => new Promise((r) => c.s.on('connect', r));

  test('faqat o\'z faol darsiga yuborish mumkin: begona/yo\'q dars rad etiladi', async () => {
    assert.equal((await api('POST', '/api/teacher/games', { testpackId: packId, sessionId: 'yoq' }, T))._status, 404);
    const other = await api('POST', '/api/register', { name: 'B', surname: 'C', email: 'dars-other@example.uz', phone: '', school: 'X', subject: 'Y', password: 'secret123' });
    assert.equal((await api('POST', '/api/teacher/games', { testpackId: packId, sessionId: S.id }, other.token))._status, 404);
  });

  test('talabalar o\'yin taklifini oladi, PIN yozmasdan qo\'shiladi, ism dars ro\'yxatidan; begona PIN bilan kira olmaydi', async () => {
    const a = await joinStudent(srv.base, api, S.id, 'Aliyev Vali');
    const created = await api('POST', '/api/teacher/games', { testpackId: packId, sessionId: S.id }, T);
    assert.equal(created._status, 200); assert.equal(created.game.lesson.sessionId, S.id); assert.equal(created.game.lesson.invited, 1);
    const inv = await a.c.waitFor('game-invite');
    assert.equal(inv.gameId, created.game.id); assert.ok(inv.ticket && inv.joinPath.startsWith('/play.html?pin='));
    assert.equal(inv.joinPath.includes('embed=1'), true);
    // kech qo'shilgan talaba ham taklif oladi
    const b = await joinStudent(srv.base, api, S.id, 'Aliyev Vali');          // bir xil ism
    const inv2 = await b.c.waitFor('game-invite'); assert.notEqual(inv2.ticket, inv.ticket);
    // begona: PIN bor, bilet yo'q
    const stranger = gconn({}); await opened(stranger);
    assert.equal((await stranger.call('join', { pin: created.game.pin, ticket: 'soxta' })).error, 'invite_only', 'soxta bilet rad etiladi');
    const guest = await stranger.call('join', { pin: created.game.pin, nick: 'Mehmon' });          // PIN bilan taxallus orqali kirish ham mumkin
    assert.equal(guest.ok, true); assert.equal(guest.nick, 'Mehmon');
    // haqiqiy biletlar bilan
    const host = gconn({ token: T }); await opened(host); assert.equal((await host.call('host:attach', { gameId: created.game.id })).lesson.groupName.length > 0, true);
    assert.equal((await host.call('host:kick', { playerId: guest.playerId })).ok, true);          // mehmonni chiqaramiz — keyingi hisob faqat 2 talabaga
    const p1 = gconn({}); await opened(p1); const j1 = await p1.call('join', { pin: created.game.pin, ticket: inv.ticket });
    const p2 = gconn({}); await opened(p2); const j2 = await p2.call('join', { pin: created.game.pin, ticket: inv2.ticket });
    assert.equal(j1.ok, true); assert.equal(j1.lesson, true); assert.equal(j1.nick, 'Aliyev Vali'); assert.equal(j2.nick, 'Aliyev Vali 2', 'bir xil ism ajratiladi');
    // bilet qayta ishlatilsa — o'sha o'yinchi (ikkinchi o'yinchi yaratilmaydi)
    const again = gconn({}); await opened(again); const j1b = await again.call('join', { pin: created.game.pin, ticket: inv.ticket });
    assert.equal(j1b.playerId, j1.playerId);
    const lobby = await host.wait('lobby'); assert.equal(lobby.invited, 2);
    // o'ynaymiz
    assert.equal((await host.call('host:start')).ok, true);
    await p1.wait('question'); await p2.wait('question');
    await p1.call('answer', { qi: 0, answer: 1 }); await p2.call('answer', { qi: 0, answer: 0 });
    const rv = await host.wait('reveal'); assert.equal(rv.correctCount, 1);
    await host.call('host:end'); const fin = await host.wait('final');
    assert.equal(fin.players, 2);
    await sleep(100);
    const list = await api('GET', '/api/teacher/games', undefined, T);
    assert.ok(list.past.some((x) => x.id === created.game.id && x.groupName === 'Fizika 1-guruh'), 'tarixda dars/guruh nomi bor');
    [a.c, b.c, host, p1, p2, again, stranger].forEach((x) => (x.close ? x.close() : x.s.close()));
  });

  test('dars tugasa, unga yuborilgan o\'yin ham tugaydi; tugagan darsga yuborib bo\'lmaydi', async () => {
    const s2 = (await api('POST', '/api/sessions', { name: 'Qisqa dars', duration: 30 }, T)).session;
    const a = await joinStudent(srv.base, api, s2.id, 'Karimov Ali');
    const g = (await api('POST', '/api/teacher/games', { testpackId: packId, sessionId: s2.id }, T)).game;
    const inv = await a.c.waitFor('game-invite');
    const host = gconn({ token: T }); await opened(host); await host.call('host:attach', { gameId: g.id });
    const p = gconn({}); await opened(p); await p.call('join', { pin: g.pin, ticket: inv.ticket });
    await host.call('host:start'); await p.wait('question');
    assert.equal((await api('POST', `/api/sessions/${s2.id}/end`, {}, T))._status, 200);
    assert.equal((await api('POST', '/api/teacher/games', { testpackId: packId, sessionId: s2.id }, T))._status, 404, 'tugagan darsga yuborib bo\'lmaydi');
    const fin = await host.wait('final', 4000);                          // tozalovchi o'yinni o'zi tugatadi
    assert.equal(fin.players, 1);
    const fp = await p.wait('final'); assert.equal(fp.you.rank, 1);
    await sleep(100);
    assert.ok((await api('GET', '/api/teacher/games', undefined, T)).past.some((x) => x.id === g.id), 'natija saqlandi');
    [a.c, host, p].forEach((x) => (x.close ? x.close() : x.s.close()));
  });
});
