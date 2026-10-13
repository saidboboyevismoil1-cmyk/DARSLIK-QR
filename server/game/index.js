// Jonli viktorina (Kahoot uslubi) va tezkor raund: REST (yaratish, tarix, CSV) + socket.io "/game" nomlar maydoni.
//   Ustoz:  POST /api/teacher/games  → PIN + QR;  socket: host:attach, host:start, host:next, host:skip, host:end, host:kick
//   Talaba: socket: join {pin, nick}, answer {qi, answer};  tizimga kirish shart emas, faqat taxallus (haqiqiy ism so'ralmaydi)
const jwt = require('jsonwebtoken');
const { rateLimitKeyed } = require('../security');
const E = require('./engine');

const MAX_ACTIVE_PER_TEACHER = 5;
const MAX_LIFETIME = 4 * 3600 * 1000, KEEP_ENDED = 10 * 60 * 1000;
const AUTO_REVEAL_MS = 4500;
const LOBBY_GRACE_MS = 15000;
const SWEEP_MS = Number(process.env.GAME_SWEEP_MS) || 60000;         // eskirgan/dars tugagan o'yinlarni tekshirish oralig'i (testlarda qisqartiriladi)

function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                  // jadval dasturlarida formula sifatida ishlamasin (taxallusni talaba yozadi)
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const TEAM_NAME_UZ = { lion: 'Sher', eagle: 'Burgut', wolf: "Bo'ri" };
const toCsv = (sum) => {
  const withTeam = !!sum.teams && Array.isArray(sum.leaderboard) && sum.leaderboard.some((p) => p.team !== undefined);
  const nameOf = (t) => { const x = (sum.teams.list || []).find((y) => y.id === t); return x ? TEAM_NAME_UZ[x.key] || x.key : ''; };
  const head = "O'rin,Taxallus,Ball,To'g'ri javoblar" + (withTeam ? ',Jamoa' : '');
  return '\ufeff' + [head, ...sum.leaderboard.map((p) => [p.rank, p.nick, p.score, p.correct, ...(withTeam ? [nameOf(p.team)] : [])].map(csvCell).join(','))].join('\n') + '\n';
};

function init({ app, io, config, legacy, sql, authMiddleware, helpers, QRCode, getTestpack, ai, getSession, canManageSession, groupNameOf, onAi, billing }) {
  const games = new Map();                                   // id → { g, timer, autoTimer, sids: Map(playerId → socketId), saved }
  const ticketOf = new Map();                                // `${gameId}|${studentId}` → ticket (dars o'yini taklifi)
  const byPin = new Map();
  const nsp = io.of('/game');

  const newPin = () => { for (let i = 0; i < 50; i++) { const p = String(Math.floor(100000 + Math.random() * 900000)); if (!byPin.has(p)) return p; } return null; };
  const entryByPin = (pin) => byPin.get(String(pin || '').replace(/\D/g, '').slice(0, 6));
  const canManage = (teacher, g) => !!teacher && (g.teacherId === teacher.id || teacher.role === 'admin');
  const baseUrl = (req) => config.publicBaseUrl || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;

  // ---------------------------------------------------------------- AI test qoralamasi
  const aiLimit = rateLimitKeyed({ windowMs: 3600000, max: config.ai.ratePerHour, name: 'ai', key: (req) => req.teacherId || req.ip });
  // AI xizmati pullik: har savolga narx (so'm) hamyondan yechiladi. Demo (mock) rejim va admin bepul.
  const paid = (req) => !!billing && !['mock', 'off'].includes(ai.provider) && !billing.isFree(req.teacher);
  app.get('/api/teacher/ai/status', authMiddleware, (req, res) => res.json({ available: ai.available, provider: ai.provider, mock: ai.provider === 'mock', paid: paid(req), pricePerQuestion: paid(req) ? config.billing.aiPricePerQuestion : 0, pricePerTest: paid(req) ? config.billing.aiPricePerTest : 0, tiers: paid(req) ? billing.aiTiers : [], balance: paid(req) ? billing.balanceOf(req.teacherId) : null }));
  app.post('/api/teacher/ai/quiz', authMiddleware, aiLimit, async (req, res) => {
    let held = 0;
    try {
      if (paid(req)) {                               // narx oldindan band qilinadi; xato bo'lsa qaytariladi
        const n = Math.min(30, Math.max(3, parseInt((req.body || {}).count, 10) || 10));
        const cost = billing.aiCost(n);
        billing.hold(req.teacherId, cost, `AI test (${n} savol)`);   // yetmasa 402 tashlaydi — held o'rnatilmaydi
        held = cost;
      }
      const out = await ai.generateQuiz(req.body || {});
      let balance = null;
      if (held) {                                    // kam savol chiqqan bo'lsa, farqi qaytariladi
        const used = billing.aiCost((out.questions || []).length);
        balance = billing.refund(req.teacherId, held - used, 'AI: qaytarilgan farq');
        held = 0;
      }
      if (onAi) onAi(req.teacherId, out.provider, (out.questions || []).length);
      res.json({ success: true, ...out, ...(balance !== null ? { balance } : {}) });
    } catch (e) {
      if (held) try { billing.refund(req.teacherId, held, 'AI: xato, qaytarildi'); } catch (x) { /* */ }
      if (e.code === 'no_funds') return res.status(402).json({ error: e.message, code: 'no_funds', balance: e.balance, needed: e.needed });
      res.status(e.status || 500).json({ error: e.status ? e.message : 'AI xatosi', code: e.code || 'ai_error' }); if (!e.status) console.error('AI xatosi:', e.message);
    }
  });

  // ---------------------------------------------------------------- dars guruhiga yuborish
  const lessonStudents = (g) => { const s = g.sessionId && getSession(g.sessionId); return s && s.status === 'active' ? s.students.filter((x) => x.isActive && x.socketId) : []; };
  const invitedCount = (g) => lessonStudents(g).length;
  const rnd = () => require('crypto').randomBytes(12).toString('base64url');
  /** Dars ilovasidagi talabaga o'yin taklifini yuboradi (har talabaga o'z bir martalik "bilet"i; ism dars ro'yxatidan olinadi). */
  function inviteStudent(e, student) {
    const g = e.g; if (!student || !student.socketId || g.status === 'ended') return;
    const key = `${g.id}|${student.id}`;
    let ticket = ticketOf.get(key);
    if (!ticket) { ticket = rnd(); ticketOf.set(key, ticket); g.invites.set(ticket, { studentId: student.id, name: student.name }); }
    io.to(student.socketId).emit('game-invite', { gameId: g.id, pin: g.pin, ticket, title: g.title, mode: g.mode, joinPath: `/play.html?pin=${g.pin}&ticket=${ticket}&embed=1` });
  }
  const inviteAll = (e) => lessonStudents(e.g).forEach((st) => inviteStudent(e, st));
  /** Talaba darsga (qayta) qo'shilganda: kutish zalidagi o'yin bo'lsa taklif yuboriladi. */
  function onLessonJoin(sessionId, student) { for (const e of games.values()) if (e.g.sessionId === sessionId && e.g.status !== 'ended') inviteStudent(e, student); }

  // ---------------------------------------------------------------- o'yin yaratish / tarix / CSV
  const info = (e, req) => {
    const g = e.g;
    const lesson = g.sessionId ? { sessionId: g.sessionId, groupName: g.groupName, invited: invitedCount(g) } : null;
    return { id: g.id, pin: g.pin, title: g.title, mode: g.mode, ...(g.team ? { teams: g.team.count } : {}), status: g.status, players: g.players.size, questions: g.questions.length, timePerQ: g.timePerQ, auto: g.auto, lesson, joinUrl: `${baseUrl(req)}/play.html?pin=${g.pin}` };
  };
  app.post('/api/teacher/games', authMiddleware, async (req, res) => {
    const b = req.body || {};
    const tp = getTestpack(String(b.testpackId || ''), req);
    if (!tp) return res.status(404).json({ error: 'Test topilmadi' });
    if ([...games.values()].filter((x) => x.g.teacherId === req.teacherId && x.g.status !== 'ended').length >= MAX_ACTIVE_PER_TEACHER) return res.status(409).json({ error: "Faol o'yinlar ko'p. Avval birini tugating", code: 'too_many' });
    const mode = ['blitz', 'boss', 'team'].includes(b.mode) ? b.mode : 'classic';
    let sess = null;
    if (b.sessionId) {                                         // darsga yuborish: dars faol va ustozniki bo'lishi shart
      sess = getSession(String(b.sessionId));
      if (!sess || sess.demo || sess.status !== 'active' || !canManageSession(req.teacher, sess)) return res.status(404).json({ error: 'Dars topilmadi yoki tugagan', code: 'no_lesson' });
    }
    const pin = newPin();
    if (!pin) return res.status(503).json({ error: 'PIN topilmadi, qayta urining' });
    const g = E.createGame({ id: helpers.uuid().slice(0, 8), pin, teacherId: req.teacherId, testpackId: tp.id, title: tp.title, questions: tp.questions,
      mode, teams: Number(b.teams) === 3 ? 3 : 2, timePerQ: mode === 'blitz' ? 10 : Number(b.timePerQ) || 20, auto: mode === 'blitz' || b.auto === true, sessionId: sess ? sess.id : '', groupName: sess ? groupNameOf(sess) : '' });
    if (!g.questions.length) return res.status(400).json({ error: "Testda savol yo'q" });
    const entry = { g, timer: null, autoTimer: null, sids: new Map(), saved: false, lobbyTimers: new Map() };
    games.set(g.id, entry); byPin.set(pin, entry);
    if (sess) inviteAll(entry);
    const o = info(entry, req);
    o.qr = await QRCode.toDataURL(o.joinUrl, { width: 640, margin: 2, color: { dark: '#0F172A', light: '#FFFFFF' } });
    res.json({ success: true, game: o });
  });
  app.get('/api/teacher/games', authMiddleware, (req, res) => {
    const active = [...games.values()].filter((e) => canManage(req.teacher, e.g) && e.g.status !== 'ended').map((e) => info(e, req));
    const past = sql.all('SELECT id, title, mode, pin, players, questions, accuracy, ended_at, group_name FROM game_results WHERE teacher_id = ? ORDER BY ended_at DESC LIMIT 20', [req.teacherId])
      .map((r) => ({ id: r.id, title: r.title, mode: r.mode, players: r.players, questions: r.questions, accuracy: r.accuracy, endedAt: r.ended_at, groupName: r.group_name || '' }));
    res.json({ active, past });
  });
  app.get('/api/teacher/games/:id', authMiddleware, async (req, res) => {
    const e = games.get(req.params.id);
    if (!e || !canManage(req.teacher, e.g)) return res.status(404).json({ error: "O'yin topilmadi" });
    const o = info(e, req);
    o.qr = await QRCode.toDataURL(o.joinUrl, { width: 640, margin: 2, color: { dark: '#0F172A', light: '#FFFFFF' } });
    res.json({ success: true, game: o });
  });
  app.get('/api/teacher/games/:id/results', authMiddleware, (req, res) => {
    const e = games.get(req.params.id);
    let sum = null;
    if (e && canManage(req.teacher, e.g)) sum = E.summary(e.g);
    else { const r = sql.get('SELECT * FROM game_results WHERE id = ? AND teacher_id = ?', [req.params.id, req.teacherId]); if (r) sum = { ...JSON.parse(r.data || '{}'), id: r.id, title: r.title, mode: r.mode, players: r.players, questions: r.questions, accuracy: r.accuracy, endedAt: r.ended_at }; }
    if (!sum) return res.status(404).json({ error: 'Natija topilmadi' });
    if (req.query.format === 'csv') {
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="edufocus-oyin-${req.params.id}.csv"` });
      return res.send(toCsv(sum));
    }
    res.json({ success: true, result: sum });
  });

  // ---------------------------------------------------------------- o'yin oqimi
  const room = (e) => `g-${e.g.id}`, hostRoom = (e) => `h-${e.g.id}`;
  const lobbyList = (g) => [...g.players.values()].map((p) => ({ id: p.id, nick: p.nick, avatar: p.avatar, connected: p.connected }));
  const pushLobby = (e) => nsp.to(hostRoom(e)).emit('lobby', { players: lobbyList(e.g), count: e.g.players.size, invited: e.g.sessionId ? invitedCount(e.g) : null });

  /** Jamoaviy jang: har talabaga o'z jamoasini bildiradi (o'yin boshida va qayta ulanganda). */
  const teamPayload = (g, p) => ({ team: p.team, teams: E.teamsView(g) });
  function emitTeams(e) { const { g } = e; if (!g.team) return; for (const [pid, sid] of e.sids) { const p = g.players.get(pid); if (p && p.team !== undefined) nsp.to(sid).emit('team', teamPayload(g, p)); } }

  function openQ(e, opened) {
    const { g } = e;
    const base = { ...opened.question, endsAt: opened.endsAt, serverNow: Date.now() };
    nsp.to(room(e)).emit('question', base);
    nsp.to(hostRoom(e)).emit('question', { ...base, answered: 0, players: g.players.size });
    clearTimeout(e.timer);
    e.timer = setTimeout(() => closeQ(e), Math.max(0, opened.endsAt - Date.now()) + 50);
  }
  function closeQ(e) {
    const { g } = e;
    clearTimeout(e.timer);
    const rv = E.closeQuestion(g);
    if (!rv) return;
    const { results, ...common } = rv;
    const rankOf = new Map(g.cur.board.map((b) => [b.id, b.rank]));
    for (const [pid, sid] of e.sids) {
      const r = results.get(pid); if (!r) continue;
      if (g.team) {                                            // jamoaviy jang: shaxsiy reyting yo'q, faqat o'z natijasi va jamoalar holati
        const { top, ...shared } = common; const p = g.players.get(pid) || {};
        nsp.to(sid).emit('reveal', { ...shared, you: { correct: r.correct, answered: r.answered, points: r.points, team: p.team } });
        continue;
      }
      if (g.boss) {                                            // boss jangi: taqqoslash yo'q — reyting va ballar talabaga yuborilmaydi
        const { top, ...shared } = common;
        nsp.to(sid).emit('reveal', { ...shared, you: { correct: r.correct, answered: r.answered, hits: (g.players.get(pid) || {}).correct || 0 } });
        continue;
      }
      nsp.to(sid).emit('reveal', { ...common, you: { ...r, rank: rankOf.get(pid) || 0 } });
    }
    nsp.to(hostRoom(e)).emit('reveal', common);
    if (g.auto) { clearTimeout(e.autoTimer); e.autoTimer = setTimeout(() => advance(e), AUTO_REVEAL_MS); }
  }
  function advance(e) {
    const r = E.next(e.g);
    if (r.error) return;
    if (r.final) finish(e, r.final); else openQ(e, r);
  }
  function finish(e, sum) {
    const { g } = e;
    clearTimeout(e.timer); clearTimeout(e.autoTimer);
    const rankOf = new Map(sum.leaderboard.map((b) => [b.id, b]));
    const board = sum.leaderboard.slice(0, 100).map(({ id, ...x }) => x);       // butun reyting hamma o'yinchiga bir vaqtda (Kahoot podiumi kabi)
    for (const [pid, sid] of e.sids) { const me = rankOf.get(pid); if (g.team) { const pl = g.players.get(pid) || {}; nsp.to(sid).emit('final', { teams: sum.teams, you: { team: pl.team, correct: me ? me.correct : 0 }, total: sum.players, questions: sum.questions, top: [] }); continue; } if (g.boss) { nsp.to(sid).emit('final', { boss: { maxHp: sum.boss.maxHp, hp: sum.boss.hp, defeated: sum.boss.defeated }, you: me ? { correct: me.correct } : null, total: sum.players, questions: sum.questions, top: [] }); continue; } nsp.to(sid).emit('final', { top: board.slice(0, 5), board, you: me ? { rank: me.rank, score: me.score, correct: me.correct, avatar: me.avatar } : null, total: sum.players, questions: sum.questions }); }
    nsp.to(hostRoom(e)).emit('final', sum);
    if (!e.saved && g.startedAt) {
      e.saved = true;
      try {
        sql.run('INSERT INTO game_results (id, teacher_id, testpack_id, title, mode, pin, players, questions, accuracy, started_at, ended_at, data, session_id, group_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [g.id, g.teacherId, g.testpackId, g.title, g.mode, g.pin, sum.players, sum.questions, sum.accuracy, g.startedAt, g.endedAt || Date.now(), JSON.stringify({ leaderboard: sum.leaderboard.slice(0, 100).map(({ id, ...x }) => x), perQuestion: sum.perQuestion, boss: sum.boss, teams: sum.teams }), g.sessionId, g.groupName]);
      } catch (err) { console.error("O'yin natijasi saqlanmadi:", err.message); }
    }
  }
  const dispose = (e) => { for (const st of e.g.invites.values()) ticketOf.delete(`${e.g.id}|${st.studentId}`); clearTimeout(e.timer); clearTimeout(e.autoTimer); e.lobbyTimers.forEach((t) => clearTimeout(t)); games.delete(e.g.id); byPin.delete(e.g.pin); };

  setInterval(() => {
    const now = Date.now();
    for (const e of [...games.values()]) {
      if (e.g.sessionId && e.g.status !== 'ended') { const ls = getSession(e.g.sessionId); if (!ls || ls.status !== 'active') { const r = E.end(e.g); finish(e, r.final); continue; } }   // dars tugadi → o'yin ham tugaydi
      if (e.g.status === 'ended' ? now - e.g.endedAt > KEEP_ENDED : now - e.g.createdAt > MAX_LIFETIME) { if (e.g.status !== 'ended') { const r = E.end(e.g); finish(e, r.final); } dispose(e); }
    }
  }, SWEEP_MS).unref();

  // ---------------------------------------------------------------- socket
  nsp.use((socket, next) => {
    socket.teacher = null;
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (token) { try { const d = jwt.verify(token, config.jwtSecret); socket.teacher = legacy.teachers.find((t) => t.id === d.id) || null; } catch { /* oddiy (talaba) soket */ } }
    next();
  });
  const joinHits = new Map();
  const tooMany = (ip) => { const now = Date.now(); let h = joinHits.get(ip); if (!h || h.reset < now) { h = { n: 0, reset: now + 60000 }; joinHits.set(ip, h); } return ++h.n > 30; };
  setInterval(() => { const now = Date.now(); for (const [k, v] of joinHits) if (v.reset < now) joinHits.delete(k); }, 60000).unref();

  nsp.on('connection', (socket) => {
    const ack = (cb, o) => { if (typeof cb === 'function') cb(o); };
    const ip = socket.handshake.address || 'x';

    // ----- talaba
    socket.on('join', (d, cb) => {
      d = d || {};
      if (tooMany(ip)) return ack(cb, { error: 'rate' });
      const e = entryByPin(d.pin);
      if (!e || e.g.status === 'ended') return ack(cb, { error: 'no_game' });
      const { g } = e;
      let p = d.token ? [...g.players.values()].find((x) => x.token === String(d.token)) : null;
      if (p) { clearTimeout(e.lobbyTimers.get(p.id)); e.lobbyTimers.delete(p.id); p.connected = true; }
      else if (g.sessionId && d.ticket) {                      // dars o'yini: darsdagi talaba taklif "bileti" bilan (ismi dars ro'yxatidan)
        const inv = g.invites.get(String(d.ticket));
        if (!inv) return ack(cb, { error: 'invite_only' });
        const r = E.joinLesson(g, inv, Date.now(), d.avatar);
        if (r.error) return ack(cb, { error: r.error });
        p = r.player; p.connected = true; clearTimeout(e.lobbyTimers.get(p.id)); e.lobbyTimers.delete(p.id);
      } else {
        if (g.status !== 'lobby' && g.mode !== 'blitz') return ack(cb, { error: 'started' });       // klassik o'yinda boshlangandan keyin qo'shilib bo'lmaydi
        const r = E.join(g, d.nick, Date.now(), d.avatar);
        if (r.error) return ack(cb, { error: r.error });
        p = r.player;
      }
      socket.player = { gameId: g.id, id: p.id };
      e.sids.set(p.id, socket.id);
      socket.join(room(e));
      ack(cb, { ok: true, playerId: p.id, token: p.token, nick: p.nick, avatar: p.avatar, title: g.title, status: g.status, mode: g.mode, lesson: !!g.sessionId });
      pushLobby(e);
      if (g.team && p.team !== undefined) socket.emit('team', teamPayload(g, p));
      if (g.status === 'question' && g.cur && !g.cur.closed) socket.emit('question', { ...E_public(g), endsAt: g.cur.endsAt, serverNow: Date.now(), answered: g.cur.answers.has(p.id) });
    });
    const E_public = (g) => { const q = g.questions[g.cur.index]; return { index: g.cur.index, total: g.questions.length, ...require('../quiz').publicQuestion(q), timeMs: g.timePerQ * 1000, ...(g.boss ? { boss: { hp: g.boss.hp, maxHp: g.boss.maxHp } } : {}), ...(g.team ? { teams: E.teamsView(g) } : {}) }; };

    socket.on('answer', (d, cb) => {
      const pl = socket.player; const e = pl && games.get(pl.gameId);
      if (!e) return ack(cb, { error: 'no_game' });
      const r = E.answer(e.g, pl.id, d && d.qi, d && d.answer);
      if (r.error) return ack(cb, { error: r.error });
      ack(cb, { ok: true });
      nsp.to(hostRoom(e)).emit('answers', { answered: r.answered, players: r.total });
      if (E.allAnswered(e.g)) closeQ(e);
    });

    socket.on('disconnect', () => {
      const pl = socket.player; const e = pl && games.get(pl.gameId); if (!e) return;
      const p = e.g.players.get(pl.id); if (!p) return;
      if (e.sids.get(pl.id) !== socket.id) return;           // allaqachon boshqa soket bilan qayta ulangan
      p.connected = false; e.sids.delete(pl.id);
      if (e.g.status === 'lobby') {                           // kutish zalida: 15 soniya ichida qaytmasa ro'yxatdan chiqariladi
        e.lobbyTimers.set(pl.id, setTimeout(() => { const q = e.g.players.get(pl.id); if (q && !q.connected && e.g.status === 'lobby') { E.remove(e.g, pl.id); pushLobby(e); } }, LOBBY_GRACE_MS));
      }
      pushLobby(e);
    });

    // ----- ustoz
    const hostEntry = (id) => { const e = games.get(String(id || '')); return e && canManage(socket.teacher, e.g) ? e : null; };
    socket.on('host:attach', (d, cb) => {
      const e = hostEntry(d && d.gameId);
      if (!e) return ack(cb, { error: 'forbidden' });
      socket.hostOf = e.g.id; socket.join(hostRoom(e));
      const g = e.g;
      const snap = { ok: true, pin: g.pin, status: g.status, title: g.title, mode: g.mode, lesson: g.sessionId ? { groupName: g.groupName, invited: invitedCount(g) } : null, players: lobbyList(g), total: g.questions.length, index: g.qIndex, ...(g.boss ? { boss: { hp: g.boss.hp, maxHp: g.boss.maxHp, defeated: g.boss.defeated } } : {}), ...(g.team ? { teams: E.teamsView(g) } : {}) };
      if (g.status === 'question' && g.cur) snap.question = { ...E_public(g), endsAt: g.cur.endsAt, serverNow: Date.now(), answered: g.cur.answers.size, players: g.players.size };
      if (g.status === 'ended') snap.final = E.summary(g);
      ack(cb, snap);
    });
    socket.on('host:start', (d, cb) => {
      const e = hostEntry(socket.hostOf); if (!e) return ack(cb, { error: 'forbidden' });
      if (!e.g.players.size) return ack(cb, { error: 'no_players' });
      const r = E.start(e.g); if (r.error) return ack(cb, { error: r.error });
      ack(cb, { ok: true }); emitTeams(e); openQ(e, r);
    });
    socket.on('host:skip', (d, cb) => { const e = hostEntry(socket.hostOf); if (!e) return ack(cb, { error: 'forbidden' }); closeQ(e); ack(cb, { ok: true }); });
    socket.on('host:next', (d, cb) => {
      const e = hostEntry(socket.hostOf); if (!e) return ack(cb, { error: 'forbidden' });
      clearTimeout(e.autoTimer);
      const r = E.next(e.g); if (r.error) return ack(cb, { error: r.error });
      ack(cb, { ok: true });
      if (r.final) finish(e, r.final); else openQ(e, r);
    });
    socket.on('host:end', (d, cb) => { const e = hostEntry(socket.hostOf); if (!e) return ack(cb, { error: 'forbidden' }); const r = E.end(e.g); finish(e, r.final); ack(cb, { ok: true }); });
    socket.on('host:kick', (d, cb) => {
      const e = hostEntry(socket.hostOf); if (!e) return ack(cb, { error: 'forbidden' });
      const pid = String((d && d.playerId) || ''); const sid = e.sids.get(pid);
      if (sid) { nsp.to(sid).emit('kicked'); const s = nsp.sockets.get(sid); if (s) { s.leave(room(e)); s.player = null; } }
      e.sids.delete(pid); E.remove(e.g, pid); pushLobby(e); ack(cb, { ok: true });
    });
  });

  return { games, onLessonJoin, close() { games.forEach((e) => dispose(e)); } };
}

module.exports = { init, csvCell, toCsv };
