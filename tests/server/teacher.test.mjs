import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, makeApi, teacherLogin, connect, joinStudent, sleep } from './helpers.mjs';

let srv, api, T;
before(async () => { srv = await startServer({ PUSH_MODE: 'mock', RATE_REGISTER_PER_HOUR: '200' }); api = makeApi(srv.base); ({ token: T } = await teacherLogin(api)); });
after(async () => { await srv.stop(); });
const register = (email, password = 'secret123') => api('POST', '/api/register', { name: 'Test', surname: 'Ustoz', email, phone: '', school: 'X', subject: 'Y', password });

test('login va ro\'yxatdan o\'tish refresh token qaytaradi; refresh rotatsiya qiladi, qayta ishlatish butun oilani bekor qiladi', async () => {
  const r = await register('rot@example.uz');
  assert.ok(r.token && r.refreshToken);
  const n1 = await api('POST', '/api/auth/refresh', { refreshToken: r.refreshToken });
  assert.equal(n1._status, 200); assert.ok(n1.token && n1.refreshToken && n1.refreshToken !== r.refreshToken);
  // eski token qayta ishlatilsa — rad etiladi va yangisi ham bekor bo'ladi
  const reuse = await api('POST', '/api/auth/refresh', { refreshToken: r.refreshToken });
  assert.equal(reuse._status, 401); assert.equal(reuse.code, 'refresh_reused');
  assert.equal((await api('POST', '/api/auth/refresh', { refreshToken: n1.refreshToken }))._status, 401);
  assert.equal((await api('POST', '/api/auth/refresh', { refreshToken: 'x' }))._status, 401);
  // yangi access token ishlaydi
  assert.equal((await api('GET', '/api/profile', undefined, n1.token))._status, 200);
});

test('logout refresh tokenni bekor qiladi', async () => {
  const r = await register('out@example.uz');
  assert.equal((await api('POST', '/api/auth/logout', { refreshToken: r.refreshToken }))._status, 200);
  assert.equal((await api('POST', '/api/auth/refresh', { refreshToken: r.refreshToken }))._status, 401);
});

test('kirishga urinishlar cheklanadi (IP+email), muvaffaqiyatli kirish hisobni tozalaydi', async () => {
  await register('rate@example.uz', 'goodpass1');
  for (let i = 0; i < 8; i++) assert.equal((await api('POST', '/api/login', { email: 'rate@example.uz', password: 'wrong' }))._status, 401);
  const blocked = await api('POST', '/api/login', { email: 'rate@example.uz', password: 'goodpass1' });
  assert.equal(blocked._status, 429);
  // boshqa email ta'sirlanmaydi
  assert.equal((await api('POST', '/api/login', { email: 'teacher@edufocus.uz', password: '123456' }))._status, 200);
});

test('parolni tiklash: bir xil javob, bir martalik havola, eski seanslar bekor', async () => {
  const r = await register('forgot@example.uz', 'oldpass123');
  const unknown = await api('POST', '/api/auth/forgot', { email: 'yoq@example.uz' });
  const known = await api('POST', '/api/auth/forgot', { email: 'forgot@example.uz' });
  assert.equal(unknown.message, known.message);
  await sleep(300);
  const { outbox } = await api('GET', '/api/_test/mail');
  const mail = outbox.filter((m) => m.to === 'forgot@example.uz').pop();
  assert.ok(mail, 'xat yuborilishi kerak (SMTP yo\'q — outbox)');
  assert.equal(outbox.some((m) => m.to === 'yoq@example.uz'), false);
  const token = /token=([\w-]+)/.exec(mail.text)[1];
  assert.equal((await api('POST', '/api/auth/reset', { token, password: 'short' }))._status, 400);
  assert.equal((await api('POST', '/api/auth/reset', { token, password: 'newpass456' }))._status, 200);
  assert.equal((await api('POST', '/api/auth/reset', { token, password: 'another789' }))._status, 400);   // ikkinchi marta ishlamaydi
  assert.equal((await api('POST', '/api/login', { email: 'forgot@example.uz', password: 'oldpass123' }))._status, 401);
  assert.equal((await api('POST', '/api/login', { email: 'forgot@example.uz', password: 'newpass456' }))._status, 200);
  assert.equal((await api('POST', '/api/auth/refresh', { refreshToken: r.refreshToken }))._status, 401);
});

test('guruhlar va testlar egasiga tegishli: boshqa ustoz ko\'ra ham, o\'zgartira ham, ishlata ham olmaydi', async () => {
  const other = await register('other@example.uz');
  const g = await api('POST', '/api/groups', { name: 'Mening guruhim' }, T);
  const tp = await api('POST', '/api/testpacks', { title: 'Mening testim', questions: [{ text: 'Savol?', options: ['a', 'b'], correct: 1 }] }, T);
  assert.ok(g.group.teacherId && tp.testpack.teacherId);
  assert.equal((await api('GET', '/api/groups', undefined, other.token)).groups.some((x) => x.id === g.group.id), false);
  assert.equal((await api('GET', '/api/testpacks', undefined, other.token)).testpacks.some((x) => x.id === tp.testpack.id), false);
  assert.equal((await api('PUT', `/api/groups/${g.group.id}`, { name: 'Hujum' }, other.token))._status, 404);
  assert.equal((await api('DELETE', `/api/groups/${g.group.id}`, undefined, other.token))._status, 404);
  assert.equal((await api('PUT', `/api/testpacks/${tp.testpack.id}`, { title: 'Hujum' }, other.token))._status, 404);
  assert.equal((await api('POST', `/api/testpacks/${tp.testpack.id}/copy`, {}, other.token))._status, 404);
  assert.equal((await api('POST', `/api/testpacks/${tp.testpack.id}/broadcast`, {}, other.token))._status, 404);
  // egasi ko'radi; nusxa o'ziniki
  assert.equal((await api('GET', '/api/groups', undefined, T)).groups.some((x) => x.id === g.group.id), true);
  const cp = await api('POST', `/api/testpacks/${tp.testpack.id}/copy`, {}, T);
  assert.notEqual(cp.testpack.id, tp.testpack.id); assert.match(cp.testpack.title, /nusxa/);
  // boshqa ustozning sessiyasiga test yuborib bo'lmaydi
  const s = (await api('POST', '/api/sessions', { name: 'D', duration: 30 }, T)).session;
  const mine = await api('POST', '/api/testpacks', { title: 'T2', questions: [{ text: 'Q', options: ['x', 'y'], correct: 0 }] }, other.token);
  assert.equal((await api('POST', `/api/testpacks/${mine.testpack.id}/broadcast`, { sessionId: s.id }, other.token))._status, 403);
});

test('test turlari: bir nechta to\'g\'ri, to\'g\'ri/noto\'g\'ri, qisqa javob, eski format (correct) — to\'g\'ri baholanadi', async () => {
  const bad = await api('POST', '/api/testpacks', { title: 'Xato', questions: [{ type: 'multi', text: 'Q', options: ['a', 'b'], correct: [] }] }, T);
  assert.equal(bad._status, 400);
  const tp = await api('POST', '/api/testpacks', { title: 'Aralash', timeLimit: 5, questions: [
    { type: 'single', text: 'Bitta', options: ['a', 'b', 'c'], correct: 2 },
    { type: 'multi', text: "Bir nechta", options: ['a', 'b', 'c', 'd'], correct: [0, 3] },
    { type: 'tf', text: "To'g'rimi?", correct: 0 },
    { type: 'short', text: 'Poytaxt?', accept: ['Toshkent', 'Tashkent'] },
    { text: 'Eski format', options: ['p', 'q'], correct: 1 },
  ] }, T);
  assert.equal(tp._status, 200);
  const s = (await api('POST', '/api/sessions', { name: 'Test', duration: 30 }, T)).session;
  const st = await joinStudent(srv.base, api, s.id, 'Talaba', 'android-lite');
  const quizP = st.c.waitFor('new-quiz');
  assert.equal((await api('POST', `/api/testpacks/${tp.testpack.id}/broadcast`, { sessionId: s.id }, T))._status, 200);
  const quiz = await quizP;
  assert.deepEqual(quiz.questions.map((q) => q.type), ['single', 'multi', 'tf', 'short', 'single']);
  assert.ok(quiz.questions.every((q) => q.correct === undefined && q.accept === undefined), "to'g'ri javob talabaga yuborilmasligi kerak");
  const ids = quiz.questions.map((q) => q.id);
  st.c.emit('student-submit-quiz', { sessionId: s.id, studentId: st.studentId, studentName: 'Talaba', quizId: quiz.quizId,
    answers: { [ids[0]]: '2', [ids[1]]: '3,0', [ids[2]]: '0', [ids[3]]: '  toshkent ', [ids[4]]: '0' } });
  const res = await st.c.waitFor('quiz-result');
  assert.equal(res.correctCount, 4); assert.equal(res.totalQuestions, 5); assert.equal(res.percentage, 80);
  assert.deepEqual(res.results.map((r) => r.isCorrect), [true, true, true, true, false]);
  assert.deepEqual(res.results[1].correct, [0, 3]);
});

test('push: himoyasiz kirish so\'rovi va favqulodda chiqish ustozga bildirishnoma yuboradi (mock)', async () => {
  const t = await register('push@example.uz');
  const reg = await api('POST', '/api/push/register', { platform: 'ios', token: 'apns-token-' + 'x'.repeat(30), locale: 'ru' }, t.token);
  assert.equal(reg._status, 200);
  assert.equal((await api('POST', '/api/push/register', { platform: 'web', token: 'x' }, t.token))._status, 400);
  const s = (await api('POST', '/api/sessions', { name: 'Majburiy', duration: 30, protection: 'required' }, t.token)).session;
  const r = await api('POST', `/api/sessions/${s.id}/exemption-requests`, { name: 'Aziz', reason: 'old_phone', device: 'Redmi' });
  assert.equal(r._status, 200);
  await sleep(300);
  const { sent } = await api('GET', '/api/_test/push');
  const n = sent.find((x) => x.kind === 'exemption' && x.userId === t.teacher.id);
  assert.ok(n, 'bildirishnoma yuborilishi kerak');
  assert.equal(n.custom.actionable, '1'); assert.equal(n.custom.requestId, r.id); assert.match(n.body, /Aziz/);
  assert.match(n.title, /Запрос/);            // ustozning tili (ru)
  // boshqa ustozga yuborilmaydi
  assert.equal(sent.some((x) => x.userId !== t.teacher.id && x.kind === 'exemption'), false);
  // push tokenini o'chirish
  await api('DELETE', '/api/push/register', { token: 'apns-token-' + 'x'.repeat(30) }, t.token);
});

test('hisobni o\'chirish: parol talab qilinadi, ma\'lumotlar o\'chadi', async () => {
  const t = await register('del@example.uz', 'delpass123');
  await api('POST', '/api/groups', { name: 'G' }, t.token);
  await api('POST', '/api/testpacks', { title: 'T', questions: [{ text: 'Q', options: ['a', 'b'], correct: 0 }] }, t.token);
  await api('POST', '/api/sessions', { name: 'D', duration: 30 }, t.token);
  assert.equal((await api('DELETE', '/api/account', { password: 'wrong' }, t.token))._status, 403);
  const d = await api('DELETE', '/api/account', { password: 'delpass123' }, t.token);
  assert.equal(d._status, 200); assert.deepEqual([d.deleted.groups, d.deleted.testpacks, d.deleted.sessions], [1, 1, 1]);
  assert.equal((await api('POST', '/api/login', { email: 'del@example.uz', password: 'delpass123' }))._status, 401);
  assert.equal((await api('GET', '/api/profile', undefined, t.token))._status, 401);
  // demo (yagona) admin o'chirilmaydi
  assert.equal((await api('DELETE', '/api/account', { password: '123456' }, T))._status, 409);
});

test('profil yangilash va parolni almashtirish', async () => {
  const t = await register('prof@example.uz', 'profpass1');
  const u = await api('PUT', '/api/profile', { name: 'Yangi', school: 'Maktab 5' }, t.token);
  assert.equal(u.teacher.name, 'Yangi');
  assert.equal((await api('POST', '/api/auth/change-password', { oldPassword: 'x', newPassword: 'newpass123' }, t.token))._status, 403);
  const c = await api('POST', '/api/auth/change-password', { oldPassword: 'profpass1', newPassword: 'newpass123' }, t.token);
  assert.equal(c._status, 200); assert.ok(c.refreshToken);
  assert.equal((await api('POST', '/api/auth/refresh', { refreshToken: t.refreshToken }))._status, 401);   // eski seanslar bekor
  assert.equal((await api('POST', '/api/login', { email: 'prof@example.uz', password: 'newpass123' }))._status, 200);
});

test('guruhlar (CSV): xatolar qator raqami bilan, qo\'shish/almashtirish, egalik; bosh sahifa va QR', async () => {
  const a = await register('grp@example.uz'); const b = await register('grp2@example.uz');
  const bad = await api('POST', '/api/teacher/groups', { name: 'X', csv: 'ab\nc' }, a.token);
  assert.equal(bad._status, 400); assert.ok(bad.errors.length >= 1 && /qator/.test(bad.errors[0]));
  const g = await api('POST', '/api/teacher/groups', { name: '101-guruh', subject: 'Fizika', csv: 'FISH,HEMIS ID\nAliyev Vali,111\nKarimova Madina,222\nab,3\nAliyev Vali,444' }, a.token);
  assert.equal(g._status, 200); assert.equal(g.added, 2); assert.equal(g.errors.length, 2);
  const list = await api('GET', '/api/teacher/groups', undefined, a.token);
  assert.equal(list.groups[0].students, 2); assert.equal(list.groups[0].subject, 'Fizika');
  assert.equal((await api('GET', '/api/teacher/groups', undefined, b.token)).groups.length, 0);
  // qo'shish: takroriy o'tkazib yuboriladi; almashtirish: eskilari o'chadi
  const add = await api('POST', `/api/teacher/groups/${g.id}/students`, { csv: 'Aliyev Vali\nToshmatov Jasur,333', mode: 'append' }, a.token);
  assert.equal(add.added, 1); assert.equal(add.skipped, 1);
  const rep = await api('POST', `/api/teacher/groups/${g.id}/students`, { csv: 'Yangi Talaba', mode: 'replace' }, a.token);
  assert.equal(rep.added, 1);
  assert.equal((await api('GET', `/api/rosters/${g.id}`, undefined, a.token)).students.length, 1);
  assert.equal((await api('POST', `/api/teacher/groups/${g.id}/students`, { csv: 'Hujum Qilish' }, b.token))._status, 404);
  assert.equal((await api('PUT', `/api/teacher/groups/${g.id}`, { name: 'Hujum' }, b.token))._status, 404);
  assert.equal((await api('PUT', `/api/teacher/groups/${g.id}`, { name: '102-guruh' }, a.token))._status, 200);
  // dars: guruh bilan boshlash, bosh sahifa, QR (faqat egasi)
  const s = (await api('POST', '/api/sessions', { name: '102-guruh', duration: 45, rosterGroupId: g.id }, a.token)).session;
  const home = await api('GET', '/api/teacher/home', undefined, a.token);
  assert.equal(home.active.id, s.id); assert.equal(home.active.groupName, '102-guruh'); assert.equal(home.groups, 1);
  const qr = await api('GET', `/api/teacher/sessions/${s.id}/qr`, undefined, a.token);
  assert.match(qr.qr, /^data:image\/png/); assert.match(qr.url, new RegExp(`session=${s.id}$`)); assert.equal(qr.code, s.id);
  assert.equal((await api('GET', `/api/teacher/sessions/${s.id}/qr`, undefined, b.token))._status, 403);
  assert.equal((await api('GET', '/api/teacher/home', undefined, b.token)).active, null);
  // hisobot: HEMIS formati va haftalik
  await api('POST', `/api/sessions/${s.id}/end`, {}, a.token);
  const hemis = await api('GET', `/api/lock/sessions/${s.id}/report?format=hemis`, undefined, a.token, true);
  const hb = Buffer.from(await hemis.arrayBuffer());
  assert.deepEqual([...hb.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);       // UTF-8 BOM (Excel uchun)
  assert.match(hb.toString('utf8'), /HEMIS ID;F\.I\.Sh;Davomat/);
  const wk = await api('GET', '/api/teacher/reports/weekly', undefined, a.token);
  assert.equal(wk.lessons.length, 1); assert.equal(wk.groups[0].group, '102-guruh');
  const wcsv = await api('GET', '/api/teacher/reports/weekly?format=csv', undefined, a.token, true);
  assert.match(await wcsv.text(), /102-guruh/);
  assert.equal((await api('GET', '/api/teacher/reports/weekly', undefined, b.token)).lessons.length, 0);
});

test('materiallar kutubxonasi: havola/fayl, tekshiruv, egalik; eski panel tokenini almashtirish', async () => {
  const a = await register('mat@example.uz'); const b = await register('mat2@example.uz');
  assert.equal((await api('POST', '/api/teacher/materials', { kind: 'link', title: 'X', url: 'javascript:alert(1)' }, a.token))._status, 400);
  assert.equal((await api('POST', '/api/teacher/materials', { kind: 'file', title: 'X', url: '/uploads/../server.js' }, a.token))._status, 400);
  const m = await api('POST', '/api/teacher/materials', { kind: 'link', title: 'Slaydlar', url: 'https://example.uz/s' }, a.token);
  assert.equal(m._status, 200);
  assert.equal((await api('GET', '/api/teacher/materials', undefined, a.token)).materials.length, 1);
  assert.equal((await api('GET', '/api/teacher/materials', undefined, b.token)).materials.length, 0);
  assert.equal((await api('DELETE', `/api/teacher/materials/${m.id}`, undefined, b.token))._status, 404);
  assert.equal((await api('DELETE', `/api/teacher/materials/${m.id}`, undefined, a.token))._status, 200);
  const ex = await api('POST', '/api/auth/exchange', {}, a.token);
  assert.ok(ex.refreshToken && ex.teacher.email === 'mat@example.uz');
  assert.equal((await api('POST', '/api/auth/refresh', { refreshToken: ex.refreshToken }))._status, 200);
  assert.equal((await api('POST', '/api/auth/exchange', {}, 'bad'))._status, 401);
});
