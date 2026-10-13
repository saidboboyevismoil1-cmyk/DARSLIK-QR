// Talaba o'yin sahifasi: PIN + taxallus bilan qo'shilish, savollarga javob, natijalar. Tizimga kirish kerak emas.
(function () {
  'use strict';
  var D = {
    uz: { title: "O'yinga qo'shilish", avatar: 'Personajingizni tanlang', all: 'Hamma natijalar', pin: 'PIN-kod', nick: 'Taxallusingiz', join: "Qo'shilish", nickHint: "Haqiqiy ismingizni yozish shart emas.", wait: "Ustoz o'yinni boshlashini kutyapmiz…", you: 'Siz', players: "O'yinchilar: {n}", q: '{i}/{n}-savol', sent: 'Javob yuborildi…', submit: 'Yuborish', typeAns: 'Javobingizni yozing', multiHint: "Bir nechta to'g'ri javobni belgilang", correct: "To'g'ri!", wrong: "Noto'g'ri", late: "Javob bermadingiz", rank: "O'rin", score: 'Ball', streak: 'Seriya', right: "To'g'ri javob", explain: 'Izoh', next: 'Keyingi savol tez orada…', final: "O'yin tugadi!", top: 'Eng yaxshilar', tf: ["To'g'ri", "Noto'g'ri"], again: 'Qayta qo’shilish', closeBtn: 'Yopish', errors: { invite_only: "Bu o'yin faqat dars talabalari uchun. Dars ilovasi orqali kiring", no_game: "Bunday o'yin topilmadi yoki tugagan", nick_taken: 'Bu taxallus band, boshqasini tanlang', nick_invalid: "Taxallus 2–20 belgi bo'lsin", started: "O'yin allaqachon boshlangan", full: "O'yin to'lgan", rate: "Juda ko'p urinish, biroz kuting", closed: 'Vaqt tugadi', late: 'Vaqt tugadi', already: 'Javob allaqachon yuborilgan', generic: 'Xatolik, qayta urinib ko‘ring' }, kicked: "Ustoz sizni o'yindan chiqardi", off: 'Aloqa uzildi, qayta ulanmoqda…', pts: '+{n} ball' },
    ru: { title: 'Вход в игру', avatar: 'Выберите персонажа', all: 'Все результаты', pin: 'PIN-код', nick: 'Ваш псевдоним', join: 'Войти', nickHint: 'Настоящее имя писать не нужно.', wait: 'Ждём, когда преподаватель начнёт игру…', you: 'Вы', players: 'Игроков: {n}', q: 'Вопрос {i}/{n}', sent: 'Ответ отправлен…', submit: 'Отправить', typeAns: 'Введите ответ', multiHint: 'Отметьте несколько верных ответов', correct: 'Верно!', wrong: 'Неверно', late: 'Вы не ответили', rank: 'Место', score: 'Очки', streak: 'Серия', right: 'Правильный ответ', explain: 'Пояснение', next: 'Скоро следующий вопрос…', final: 'Игра окончена!', top: 'Лучшие', tf: ['Верно', 'Неверно'], again: 'Войти снова', closeBtn: 'Закрыть', errors: { invite_only: 'Эта игра только для студентов занятия. Войдите через приложение занятия', no_game: 'Такой игры нет или она завершена', nick_taken: 'Псевдоним занят, выберите другой', nick_invalid: 'Псевдоним: 2–20 символов', started: 'Игра уже началась', full: 'Игра заполнена', rate: 'Слишком много попыток, подождите', closed: 'Время вышло', late: 'Время вышло', already: 'Ответ уже отправлен', generic: 'Ошибка, попробуйте ещё раз' }, kicked: 'Преподаватель удалил вас из игры', off: 'Связь потеряна, переподключаемся…', pts: '+{n} очков' },
    en: { title: 'Join the game', avatar: 'Pick your character', all: 'All results', pin: 'PIN code', nick: 'Your nickname', join: 'Join', nickHint: 'You do not need to use your real name.', wait: 'Waiting for the teacher to start…', you: 'You', players: 'Players: {n}', q: 'Question {i}/{n}', sent: 'Answer sent…', submit: 'Submit', typeAns: 'Type your answer', multiHint: 'Select all correct answers', correct: 'Correct!', wrong: 'Wrong', late: 'No answer', rank: 'Rank', score: 'Score', streak: 'Streak', right: 'Correct answer', explain: 'Explanation', next: 'Next question coming up…', final: 'Game over!', top: 'Top players', tf: ['True', 'False'], again: 'Join again', closeBtn: 'Close', errors: { invite_only: 'This game is only for students in the lesson. Join through the lesson app', no_game: 'No such game, or it has ended', nick_taken: 'That nickname is taken', nick_invalid: 'Nickname must be 2–20 characters', started: 'The game has already started', full: 'The game is full', rate: 'Too many attempts, please wait', closed: 'Time is up', late: 'Time is up', already: 'Answer already sent', generic: 'Something went wrong, try again' }, kicked: 'The teacher removed you from the game', off: 'Connection lost, reconnecting…', pts: '+{n} points' },
  };
  // Personajlar (serverdagi ro'yxat bilan bir xil kalitlar). Talaba tanlaydi, tanlamasa server tasodifiy beradi.
  var AV = { fox: '🦊', panda: '🐼', lion: '🦁', frog: '🐸', owl: '🦉', koala: '🐨', unicorn: '🦄', tiger: '🐯', penguin: '🐧', octopus: '🐙', dino: '🦖', robot: '🤖', alien: '👽', cat: '🐱', dog: '🐶', whale: '🐳' };
  var av = function (k) { return AV[k] || '🙂'; };
  var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  var app = document.getElementById('app'), sr = document.getElementById('sr');
  var lang = (function () { try { var s = localStorage.getItem('ef_p_lang'); if (D[s]) return s; } catch (e) {} var n = (navigator.language || 'uz').slice(0, 2); return D[n] ? n : 'uz'; })();
  var T = function () { return D[lang]; };
  // Boss jangi (kollektiv rejim): reyting va ballar yo'q — faqat sinfning umumiy zarbasi va bossning joni.
  var BT = {
    uz: { boss: 'Boss', lobby: "Boss jangi! Hammamiz birgalikda jang qilamiz.", hit: "Zarba berdingiz!", miss: "Bu safar zarba bo'lmadi", late: "Javob berilmadi", classHit: "Sinf zarbasi: {n}", left: "Boss joni: {p}% qoldi", myHits: "Sizning zarbalaringiz: {n}", win: "G'alaba! Boss yengildi!", lose: "Boss tirik qoldi. Yana urinib ko'ramiz!", hp: "Boss joni {a} dan {b}" },
    ru: { boss: 'Босс', lobby: 'Бой с боссом! Мы сражаемся все вместе.', hit: 'Вы нанесли удар!', miss: 'В этот раз без удара', late: 'Ответа не было', classHit: 'Удар класса: {n}', left: 'Осталось здоровья босса: {p}%', myHits: 'Ваши удары: {n}', win: 'Победа! Босс повержен!', lose: 'Босс выстоял. Попробуем ещё раз!', hp: 'Здоровье босса {a} из {b}' },
    en: { boss: 'Boss', lobby: "Boss battle! We fight together.", hit: 'You landed a hit!', miss: 'No hit this time', late: 'No answer', classHit: 'Class hit: {n}', left: 'Boss health left: {p}%', myHits: 'Your hits: {n}', win: 'Victory! The boss is defeated!', lose: "The boss survived. Let's try again!", hp: 'Boss health {a} of {b}' }
  };
  var BTx = function () { return BT[lang] || BT.uz; };
  // Jamoaviy jang: 2 jamoa — arqon tortish, 3 jamoa — poyga. Jamoalar emoji + nom + rang bilan ajratiladi (faqat rangga tayanilmaydi).
  var TT = {
    uz: { names: { lion: 'Sher', eagle: 'Burgut', wolf: "Bo'ri" }, lobby: "Jamoaviy jang! O'yin boshlanganda jamoangiz aytiladi.", yours: 'Sizning jamoangiz: {n}', pct: '{p}% to\'g\'ri', youWin: "Sizning jamoangiz g'alaba qozondi! 🎉", youLose: "Bu safar {n} jamoasi kuchliroq. Keyingi safar sizniki!", draw: "Durang! Jamoalar teng.", winner: "{n} jamoasi g'olib!", rope: 'Arqon tortish', race: 'Poyga', mine: "Sizning to'g'ri javoblaringiz: {n}", gain: '+{n} ball' },
    ru: { names: { lion: 'Лев', eagle: 'Орёл', wolf: 'Волк' }, lobby: 'Командный бой! Команду назовут в начале игры.', yours: 'Ваша команда: {n}', pct: '{p}% верно', youWin: 'Ваша команда победила! 🎉', youLose: 'В этот раз сильнее команда «{n}». В следующий раз повезёт!', draw: 'Ничья! Команды равны.', winner: 'Победила команда «{n}»!', rope: 'Перетягивание каната', race: 'Гонка', mine: 'Ваши верные ответы: {n}', gain: '+{n} баллов' },
    en: { names: { lion: 'Lions', eagle: 'Eagles', wolf: 'Wolves' }, lobby: 'Team battle! Your team is revealed when the game starts.', yours: 'Your team: {n}', pct: '{p}% correct', youWin: 'Your team won! 🎉', youLose: 'Team {n} was stronger this time. Next time is yours!', draw: "It's a tie! Teams are even.", winner: 'Team {n} wins!', rope: 'Tug of war', race: 'Race', mine: 'Your correct answers: {n}', gain: '+{n} points' }
  };
  var TTx = function () { return TT[lang] || TT.uz; };
  var teamName = function (tm) { return (TTx().names[tm.key] || tm.key); };
  function teamTag(tm) { return '<span class="ttag" style="--tc:' + esc(tm.color) + '"><span aria-hidden="true">' + esc(tm.emoji) + '</span> ' + esc(teamName(tm)) + '</span>'; }
  function myTeam() { return S.team && S.team.teams ? S.team.teams.filter(function (x) { return x.id === S.team.team; })[0] : null; }
  function teamBanner() { var m = myTeam(); return m ? '<div class="tbanner" style="--tc:' + esc(m.color) + '">' + esc(fmt(TTx().yours, { n: '' })) + teamTag(m) + '</div>' : ''; }
  /** teams: [{id,key,emoji,color,progress,last?}], total: savollar soni. 2 jamoa — arqon, 3 jamoa — poyga yo'laklari. */
  function teamTrack(teams, total) {
    if (!teams || !teams.length) return '';
    var tot = Math.max(1, total || 1);
    if (teams.length === 2) {
      var d = (teams[0].progress - teams[1].progress) / tot, x = Math.max(6, Math.min(94, 50 - d * 50));
      return '<div class="rope" role="img" aria-label="' + esc(TTx().rope + ': ' + teamName(teams[0]) + ' ' + teams[0].progress + ' — ' + teamName(teams[1]) + ' ' + teams[1].progress) + '"><span class="rt" style="--tc:' + esc(teams[0].color) + '">' + esc(teams[0].emoji) + '</span><div class="rtrack"><i class="rknot" style="left:' + x + '%"></i></div><span class="rt" style="--tc:' + esc(teams[1].color) + '">' + esc(teams[1].emoji) + '</span></div>' + teamLast(teams);
    }
    return '<div class="race" role="img" aria-label="' + esc(TTx().race) + '">' + teams.map(function (tm) { var w = Math.max(3, Math.min(100, Math.round(tm.progress / tot * 100))); return '<div class="lane"><span class="ln">' + esc(tm.emoji) + ' ' + esc(teamName(tm)) + '</span><div class="lbar"><i style="width:' + w + '%;background:' + esc(tm.color) + '"></i></div><span class="lv">' + tm.progress + '</span></div>'; }).join('') + '</div>' + teamLast(teams);
  }
  function teamLast(teams) { return teams[0].last ? '<div class="tlast">' + teams.map(function (tm) { return '<span style="--tc:' + esc(tm.color) + '">' + esc(tm.emoji) + ' ' + esc(fmt(TTx().pct, { p: tm.last.pct })) + '</span>'; }).join('') + '</div>' : ''; }
  function bossBar(b) {
    if (!b) return '';
    var pct = b.maxHp ? Math.max(0, Math.min(100, Math.round(b.hp / b.maxHp * 100))) : 0;
    return '<div class="boss" role="img" aria-label="' + esc(fmt(BTx().hp, { a: b.hp, b: b.maxHp })) + '"><span class="bn" aria-hidden="true">👾 ' + esc(BTx().boss) + '</span><div class="bhp" aria-hidden="true"><i style="width:' + pct + '%"></i></div><span class="bv" aria-hidden="true">' + b.hp + '/' + b.maxHp + '</span></div>';
  }

  var fmt = function (s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] !== undefined ? o[k] : m; }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var params = new URLSearchParams(location.search);
  var embed = params.get('embed') === '1', ticket = params.get('ticket') || '';
  var S = { avatar: (function () { try { var a = localStorage.getItem('ef_p_avatar'); return AV[a] ? a : ''; } catch (e) { return ''; } })(), phase: ticket ? 'connecting' : 'join', pin: (params.get('pin') || '').replace(/\D/g, '').slice(0, 6), nick: '', me: null, q: null, picked: [], sent: false, rv: null, fin: null, players: 0, skew: 0, offline: false, err: '', count: 0 };
  var tick = null;
  function parentMsg(ev) { if (embed && window.parent !== window) { try { window.parent.postMessage({ type: 'ef-game', event: ev }, location.origin); } catch (e) {} } }
  var storeKey = function () { return 'ef_p_' + S.pin; };
  var load = function () { try { return JSON.parse(sessionStorage.getItem(storeKey()) || 'null'); } catch (e) { return null; } };
  var save = function (o) { try { sessionStorage.setItem(storeKey(), JSON.stringify(o)); } catch (e) {} };

  var sock = io('/game', { reconnection: true });
  var speak = function (m) { sr.textContent = ''; setTimeout(function () { sr.textContent = m; }, 30); };

  function join(token) {
    sock.emit('join', { pin: S.pin, nick: S.nick, avatar: S.avatar, token: token, ticket: ticket }, function (r) {
      var btn = document.getElementById('go'); if (btn) btn.disabled = false;
      if (!r || r.error) {
        if (token && !ticket) { try { sessionStorage.removeItem(storeKey()); } catch (e) {} return draw(); }   // eski token yaroqsiz — qayta qo'shilish oynasi
        S.err = (T().errors[r && r.error]) || T().errors.generic;
        if (ticket) S.phase = 'fatal';                                    // dars o'yini: qo'lda qayta urinish yo'q
        return draw();
      }
      S.me = r; S.nick = r.nick; if (r.avatar) S.avatar = r.avatar; S.err = '';
      if (r.status === 'ended') S.phase = 'final'; else if (S.phase === 'join' || S.phase === 'connecting') S.phase = 'lobby';     // o'yin davomida qayta ulansa, joriy bosqich saqlanadi
      save({ token: r.token, nick: r.nick });
      draw();
    });
  }
  sock.on('connect', function () {
    var was = S.offline; S.offline = false;
    if (S.me) { var st = load(); if (st && st.token) join(st.token); } else if (ticket && S.pin) { var s3 = load(); join(s3 && s3.token); } else if (S.pin && load()) { var s2 = load(); S.nick = s2.nick; join(s2.token); }
    if (was) draw();
  });
  sock.on('disconnect', function () { S.offline = true; draw(); });
  sock.on('question', function (q) { S.q = q; S.rv = null; S.picked = []; S.sent = !!q.answered; S.skew = q.serverNow - Date.now(); S.phase = 'question'; S.players = S.players; draw(); speak(fmt(T().q, { i: q.index + 1, n: q.total }) + '. ' + q.text); });
  sock.on('reveal', function (rv) { S.rv = rv; S.phase = 'reveal'; draw(); speak(rv.you && rv.you.correct ? T().correct : (rv.you && rv.you.answered ? T().wrong : T().late)); });
  sock.on('final', function (f) { S.fin = f; S.phase = 'final'; draw(); speak(T().final); });
  sock.on('team', function (d) { S.team = d; draw(); });
  sock.on('kicked', function () { parentMsg('kicked'); try { sessionStorage.removeItem(storeKey()); } catch (e) {} S.me = null; S.phase = 'join'; S.err = T().kicked; draw(); });

  var left = function () { return Math.max(0, (S.q.endsAt - (Date.now() + S.skew)) / 1000); };
  function submit(answer) {
    if (S.sent || !S.q) return;
    S.sent = true; draw();
    sock.emit('answer', { qi: S.q.index, answer: answer }, function (r) { if (r && r.error && r.error !== 'already') { S.sent = r.error === 'closed' || r.error === 'late'; S.err = T().errors[r.error] || T().errors.generic; } draw(); });
  }
  function optLabel(q, i) { return q.type === 'tf' ? T().tf[i] : q.options[i]; }

  function langBox() { return '<div class="lang"><label class="sr" for="lg">Language</label><select id="lg">' + ['uz', 'ru', 'en'].map(function (k) { return '<option value="' + k + '"' + (k === lang ? ' selected' : '') + '>' + k.toUpperCase() + '</option>'; }).join('') + '</select></div>'; }
  function head() { if (embed) return S.offline ? '<div class="pad center" role="alert">' + esc(T().off) + '</div>' : ''; return '<div class="top"><span class="logo">EduFocus</span>' + (S.me ? '<span class="muted">' + esc(av(S.avatar) + ' ' + S.nick) + '</span>' : '') + langBox() + '</div>' + (S.offline ? '<div class="pad center" role="alert">' + esc(T().off) + '</div>' : ''); }

  function avatarPicker() {
    return '<div class="avs" role="group" aria-label="' + esc(T().avatar) + '"><div class="muted center">' + esc(T().avatar) + '</div><div class="avgrid">' + Object.keys(AV).map(function (k) {
      return '<button type="button" class="av' + (S.avatar === k ? ' on' : '') + '" data-av="' + k + '" aria-pressed="' + (S.avatar === k) + '" aria-label="' + k + '">' + AV[k] + '</button>';
    }).join('') + '</div></div>';
  }
  /** Kahoot podiumi: 1-o'rin o'rtada baland, 2-chapda, 3-o'ngda. */
  function podium(list) {
    var by = {}; list.slice(0, 3).forEach(function (p) { by[p.rank] = p; });
    return '<div class="podium" role="list">' + [2, 1, 3].filter(function (r) { return by[r]; }).map(function (r) {
      var p = by[r]; return '<div class="pod p' + r + (S.nick === p.nick ? ' me' : '') + '" role="listitem"><span class="pav" aria-hidden="true">' + esc(av(p.avatar)) + '</span><b class="pn">' + esc(p.nick) + '</b><span class="ps">' + p.score + '</span><i class="pb">' + r + '</i></div>';
    }).join('') + '</div>';
  }

  function view() {
    var t = T();
    if (S.phase === 'join') {
      return head() + '<form class="stack pad" id="jf" novalidate><h1 class="big center">' + esc(t.title) + '</h1>' +
        '<label class="sr" for="pin">' + esc(t.pin) + '</label><input class="pin-in" id="pin" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="' + esc(t.pin) + '" value="' + esc(S.pin) + '">' +
        '<label class="sr" for="nick">' + esc(t.nick) + '</label><input class="nick-in" id="nick" maxlength="20" autocomplete="off" placeholder="' + esc(t.nick) + '" value="' + esc(S.nick) + '">' +
        '<p class="muted center" style="margin:0">' + esc(t.nickHint) + '</p>' + avatarPicker() + '<div class="err" role="alert">' + esc(S.err) + '</div><button class="go" id="go" type="submit">' + esc(t.join) + '</button></form>';
    }
    if (S.phase === 'lobby') return head() + '<div class="pad center stack" style="margin:auto 0"><div class="big">' + esc(S.me.title) + '</div><div class="huge pulse" aria-hidden="true">' + esc(av(S.avatar)) + '</div><div><b>' + esc(S.nick) + '</b></div>' + (S.me.mode === 'boss' ? '<p><b>' + esc(BTx().lobby) + '</b></p>' : '') + (S.me.mode === 'team' ? '<p><b>' + esc(TTx().lobby) + '</b></p>' : '') + '<p class="muted">' + esc(t.wait) + '</p></div>';
    if (S.phase === 'question' && S.q) {
      var q = S.q, body = '';
      if (S.sent) body = '<div class="pad center stack" style="margin:auto 0"><div class="big pulse">' + esc(t.sent) + '</div></div>';
      else if (q.type === 'short') body = '<form id="sf" class="stack"><label class="sr" for="sa">' + esc(t.typeAns) + '</label><input class="nick-in" id="sa" maxlength="120" autocomplete="off" placeholder="' + esc(t.typeAns) + '"><button class="go" type="submit">' + esc(t.submit) + '</button></form>';
      else {
        var idx = q.type === 'tf' ? [0, 1] : q.options.map(function (_, i) { return i; });
        body = (q.type === 'multi' ? '<p class="muted center" style="margin:0">' + esc(t.multiHint) + '</p>' : '') + '<div class="opts">' + idx.map(function (i) { return '<button class="opt c' + (i % 4) + '" data-i="' + i + '" aria-pressed="' + (S.picked.indexOf(i) >= 0) + '"><span class="ltr" aria-hidden="true">' + LETTERS[i] + '</span><span>' + esc(optLabel(q, i)) + '</span></button>'; }).join('') + '</div>' +
          (q.type === 'multi' ? '<button class="go" id="msub" ' + (S.picked.length ? '' : 'disabled') + '>' + esc(t.submit) + '</button>' : '');
      }
      return head() + bossBar(q.boss) + (q.teams ? teamBanner() + teamTrack(q.teams, q.total) : '') + '<div class="top"><b>' + esc(fmt(t.q, { i: q.index + 1, n: q.total })) + '</b><span class="grow"></span><b id="tl">' + Math.ceil(left()) + '</b></div><div class="bar"><i id="tb"></i></div><div class="q">' + esc(q.text) + '</div>' + body + '<div class="err" role="alert">' + esc(S.err) + '</div>';
    }
    if (S.phase === 'reveal' && S.rv) {
      var rv = S.rv, y = rv.you || {}, cls = y.correct ? 'ok' : (y.answered ? 'bad' : 'none');
      if (rv.teams) {
        var tt = TTx(), mt = myTeam();
        var corrT = rv.type === 'short' ? rv.correct.join(' / ') : (Array.isArray(rv.correct) ? rv.correct : [rv.correct]).map(function (i) { return rv.type === 'tf' ? t.tf[i] : rv.options[i]; }).join(', ');
        return head() + teamBanner() + '<div class="res ' + cls + '"><div class="big">' + esc(y.correct ? t.correct : (y.answered ? t.wrong : t.late)) + '</div>' + (y.correct ? '<div class="pts">' + esc(fmt(tt.gain, { n: y.points })) + '</div>' : '') + '</div>' +
          teamTrack(rv.teams, rv.total) +
          (y.correct ? '' : '<div class="pad"><span class="muted">' + esc(t.right) + ':</span> <b>' + esc(corrT) + '</b></div>') +
          (rv.explanation ? '<div class="expl"><b>' + esc(t.explain) + ':</b> ' + esc(rv.explanation) + '</div>' : '') + '<p class="muted center">' + esc(t.next) + '</p>';
      }
      if (rv.boss) {
        var bs = rv.boss, bt2 = BTx(), pctLeft = bs.maxHp ? Math.round(bs.hp / bs.maxHp * 100) : 0;
        var corrB = rv.type === 'short' ? rv.correct.join(' / ') : (Array.isArray(rv.correct) ? rv.correct : [rv.correct]).map(function (i) { return rv.type === 'tf' ? t.tf[i] : rv.options[i]; }).join(', ');
        return head() + bossBar(bs) + '<div class="res ' + cls + '"><div class="big">' + esc(y.correct ? bt2.hit : (y.answered ? bt2.miss : bt2.late)) + '</div></div>' +
          '<div class="pad center stack"><b>' + esc(fmt(bt2.classHit, { n: bs.dmg })) + '</b><span class="muted">' + esc(bs.defeated ? bt2.win : fmt(bt2.left, { p: pctLeft })) + '</span><span class="muted">' + esc(fmt(bt2.myHits, { n: y.hits || 0 })) + '</span></div>' +
          (y.correct ? '' : '<div class="pad"><span class="muted">' + esc(t.right) + ':</span> <b>' + esc(corrB) + '</b></div>') +
          (rv.explanation ? '<div class="expl"><b>' + esc(t.explain) + ':</b> ' + esc(rv.explanation) + '</div>' : '') + '<p class="muted center">' + esc(t.next) + '</p>';
      }
      var corr = rv.type === 'short' ? rv.correct.join(' / ') : (Array.isArray(rv.correct) ? rv.correct : [rv.correct]).map(function (i) { return rv.type === 'tf' ? t.tf[i] : rv.options[i]; }).join(', ');
      return head() + '<div class="res ' + cls + '"><div class="big">' + esc(y.correct ? t.correct : (y.answered ? t.wrong : t.late)) + '</div>' + (y.correct ? '<div class="pts">' + esc(fmt(t.pts, { n: y.points })) + '</div>' : '') + '</div>' +
        '<div class="stat pad"><div><b>' + (y.rank || '-') + '</b><span class="muted">' + esc(t.rank) + '</span></div><div><b>' + (y.score || 0) + '</b><span class="muted">' + esc(t.score) + '</span></div><div><b>' + (y.streak || 0) + '</b><span class="muted">' + esc(t.streak) + '</span></div></div>' +
        (y.correct ? '' : '<div class="pad"><span class="muted">' + esc(t.right) + ':</span> <b>' + esc(corr) + '</b></div>') +
        (rv.explanation ? '<div class="expl"><b>' + esc(t.explain) + ':</b> ' + esc(rv.explanation) + '</div>' : '') + '<p class="muted center">' + esc(t.next) + '</p>';
    }
    if (S.phase === 'final' && S.fin) {
      var f = S.fin, me = f.you;
      if (f.teams) {
        var tt2 = TTx(), lst = f.teams.list, mine = f.you ? f.you.team : null, win = f.teams.winner;
        var winTeam = lst.filter(function (x) { return x.id === win; })[0];
        var msg = win === null ? tt2.draw : (win === mine ? tt2.youWin : fmt(tt2.youLose, { n: winTeam ? teamName(winTeam) : '' }));
        return head() + '<div class="res ' + (win === mine && win !== null ? 'ok' : 'none') + '"><div class="big">' + esc(win !== null && winTeam && win !== mine ? fmt(tt2.winner, { n: teamName(winTeam) }) : msg) + '</div></div>' +
          '<div class="pad stack">' + lst.map(function (tm) { return '<div class="lane' + (tm.id === mine ? ' me' : '') + '"><span class="ln">' + esc(tm.emoji) + ' ' + esc(teamName(tm)) + '</span><div class="lbar"><i style="width:' + Math.max(3, Math.round(tm.progress / Math.max(1, f.questions) * 100)) + '%;background:' + esc(tm.color) + '"></i></div><span class="lv">' + tm.progress + '</span></div>'; }).join('') + '</div>' +
          (win !== null && win !== mine ? '<p class="muted center">' + esc(msg) + '</p>' : '') + (f.you ? '<div class="pad center"><span class="muted">' + esc(fmt(tt2.mine, { n: f.you.correct })) + '</span></div>' : '') +
          (embed ? '<button class="go" id="close">' + esc(t.closeBtn) + '</button>' : '<button class="go" id="again">' + esc(t.again) + '</button>');
      }
      if (f.boss) {
        var bf = f.boss, bt3 = BTx(), pf = bf.maxHp ? Math.round(bf.hp / bf.maxHp * 100) : 0;
        return head() + bossBar(bf) + '<div class="res ' + (bf.defeated ? 'ok' : 'none') + '"><div class="big">' + esc(bf.defeated ? bt3.win : bt3.lose) + '</div></div>' +
          '<div class="pad center stack">' + (bf.defeated ? '' : '<b>' + esc(fmt(bt3.left, { p: pf })) + '</b>') + (me ? '<span class="muted">' + esc(fmt(bt3.myHits, { n: me.correct })) + '</span>' : '') + '</div>' +
          (embed ? '<button class="go" id="close">' + esc(t.closeBtn) + '</button>' : '<button class="go" id="again">' + esc(t.again) + '</button>');
      }
      return head() + '<div class="pad center stack"><div class="big">' + esc(t.final) + '</div>' + (me ? '<div class="huge">' + me.rank + '<span class="muted" style="font-size:22px"> / ' + f.total + '</span></div><div class="muted">' + esc(t.score) + ': <b>' + me.score + '</b></div>' : '') + '</div>' +
        (f.board && f.board.length ? podium(f.board) : '') +
        '<div class="pad"><b>' + esc(f.board ? t.all : t.top) + '</b><ol class="lb">' + (f.board || f.top).map(function (p) { return '<li class="' + (S.nick === p.nick ? 'me' : '') + '"><span>' + p.rank + '</span><span class="av-s" aria-hidden="true">' + esc(av(p.avatar)) + '</span><span class="grow">' + esc(p.nick) + '</span><span>' + p.score + '</span></li>'; }).join('') + '</ol></div>' +
        (embed ? '<button class="go" id="close">' + esc(t.closeBtn) + '</button>' : '<button class="go" id="again">' + esc(t.again) + '</button>');
    }
    if (S.phase === 'fatal') return head() + '<div class="pad center stack" style="margin:auto 0"><div class="err" role="alert">' + esc(S.err) + '</div><button class="go" id="close">' + esc(t.closeBtn) + '</button></div>';
    return head() + '<div class="pad center pulse">…</div>';
  }

  function draw() {
    clearInterval(tick);
    var active = document.activeElement && document.activeElement.id;
    app.innerHTML = view();
    var lg = document.getElementById('lg'); if (lg) lg.onchange = function () { lang = lg.value; try { localStorage.setItem('ef_p_lang', lang); } catch (e) {} document.documentElement.lang = lang; draw(); };
    var jf = document.getElementById('jf');
    if (jf) jf.onsubmit = function (e) {
      e.preventDefault(); S.pin = document.getElementById('pin').value.replace(/\D/g, '').slice(0, 6); S.nick = document.getElementById('nick').value.trim();
      if (S.pin.length !== 6) { S.err = T().errors.no_game; return draw(); }
      if (S.nick.length < 2) { S.err = T().errors.nick_invalid; return draw(); }
      document.getElementById('go').disabled = true; join();
    };
    if (jf && active === 'nick') { var n = document.getElementById('nick'); if (n) n.focus(); }
    Array.prototype.forEach.call(document.querySelectorAll('.opt'), function (b) {
      b.onclick = function () {
        var i = Number(b.dataset.i);
        if (S.q.type === 'multi') { var k = S.picked.indexOf(i); if (k >= 0) S.picked.splice(k, 1); else S.picked.push(i); draw(); } else submit(i);
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.av'), function (b) {
      b.onclick = function () {
        S.avatar = b.dataset.av; try { localStorage.setItem('ef_p_avatar', S.avatar); } catch (e) {}
        Array.prototype.forEach.call(document.querySelectorAll('.av'), function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
      };
    });
    var ms = document.getElementById('msub'); if (ms) ms.onclick = function () { submit(S.picked.slice().sort()); };
    var sf = document.getElementById('sf'); if (sf) { sf.onsubmit = function (e) { e.preventDefault(); var v = document.getElementById('sa').value.trim(); if (v) submit(v); }; var sa = document.getElementById('sa'); if (sa) sa.focus(); }
    var cl = document.getElementById('close'); if (cl) cl.onclick = function () { parentMsg('close'); };
    var ag = document.getElementById('again'); if (ag) ag.onclick = function () { try { sessionStorage.removeItem(storeKey()); } catch (e) {} S.me = null; S.phase = 'join'; S.q = null; S.rv = null; S.fin = null; S.pin = ''; S.err = ''; history.replaceState(null, '', location.pathname); draw(); };
    if (S.phase === 'question' && S.q) {
      var total = S.q.timeMs / 1000;
      tick = setInterval(function () { var l = left(), a = document.getElementById('tl'), b = document.getElementById('tb'); if (a) a.textContent = Math.ceil(l); if (b) b.style.width = Math.min(100, (l / total) * 100) + '%'; }, 200);
    }
  }
  document.documentElement.lang = lang;
  draw();
})();
