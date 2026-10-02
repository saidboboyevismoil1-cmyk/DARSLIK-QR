import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, makeApi, teacherLogin, connect, joinStudent, joinPayload, sleep, randKey } from './helpers.mjs';

let srv, api, T;
before(async () => { srv = await startServer(); api = makeApi(srv.base); ({ token: T } = await teacherLogin(api)); });
after(async () => { await srv.stop(); });
const newSession = (body = {}, token = T) => api('POST', '/api/sessions', { name: 'Test dars', subject: 'Fan', duration: 45, ...body }, token).then((r) => r.session);
const hbPayload = (s, id, protection, extra = {}) => ({ sessionId: s.id, studentId: id, fg: true, protection, ...extra });
const GOOD = { active: true, reasons: [], checks: { pinned: true, accessibility: true, dnd: true, devOptions: false, foreground: true } };

test('heartbeat: bypass hodisalari, qoidalar (3/10 daqiqa), umumiy ko\'rinish', async () => {
  const set = (values) => api('PUT', '/api/admin/settings', { scope: 'global', values }, T);
  assert.equal((await set({ 'score.unprotectedFocusZeroSec': 1, 'score.unprotectedAbsentSec': 3 }))._status, 200);
  try {
    const s = await newSession({ protection: 'required' });
    const teacher = connect(srv.base, { token: T }); await teacher.opened;
    teacher.emit('lock-subscribe', { sessionId: s.id });
    const a = await joinStudent(srv.base, api, s.id, 'Alisher', 'android-full');
    const b = await joinStudent(srv.base, api, s.id, 'Bobur', 'android-full');

    a.c.emit('student-heartbeat', hbPayload(s, a.studentId, GOOD));
    const ack = await a.c.waitFor('heartbeat-ack');
    assert.equal(ack.locked, true);
    assert.ok(ack.remainingSeconds > 0);

    // boshqa talaba yoki soxta id — e'tiborsiz
    b.c.emit('student-heartbeat', hbPayload(s, a.studentId, { active: false, reasons: [], checks: { pinned: false } }));
    await sleep(300);
    assert.equal(b.c.has('heartbeat-ack'), false);

    await sleep(1100);
    const bad = { active: false, reasons: ['not_pinned'], checks: { ...GOOD.checks, pinned: false } };
    a.c.emit('student-heartbeat', hbPayload(s, a.studentId, bad));
    await teacher.waitFor('lock-event', (e) => e.type === 'pinning_removed' && e.studentId === a.studentId);
    await teacher.waitFor('lock-event', (e) => e.type === 'protection_lost');
    let ov = await api('GET', `/api/lock/sessions/${s.id}/overview`, undefined, T);
    assert.equal(ov.students.find((x) => x.name === 'Alisher').color, 'red');
    assert.equal(ov.students.find((x) => x.name === 'Bobur').status, 'protected');   // soxta heartbeat Bobur holatiga ta'sir qilmadi

    // himoyasiz vaqt chegaradan oshadi
    for (let i = 0; i < 4; i++) { await sleep(1150); a.c.emit('student-heartbeat', hbPayload(s, a.studentId, bad)); }
    await sleep(2300);
    await teacher.waitFor('lock-event', (e) => e.type === 'rule_focus_zero', 3000);
    await teacher.waitFor('lock-event', (e) => e.type === 'rule_absent', 3000);
    assert.equal((await a.c.waitFor('lock-rule', (r) => r.rule === 'absent', 2000)).rule, 'absent');

    let rep = await api('GET', `/api/lock/sessions/${s.id}/report`, undefined, T);
    const ra = rep.students.find((x) => x.name === 'Alisher');
    assert.equal(ra.attendance, 0); assert.equal(ra.focus, 0); assert.equal(ra.absent, true); assert.ok(ra.bypass >= 1);

    // tiklanish
    a.c.emit('student-heartbeat', hbPayload(s, a.studentId, GOOD));
    await teacher.waitFor('lock-event', (e) => e.type === 'protection_restored');
    const events = await api('GET', `/api/lock/sessions/${s.id}/events?studentId=${a.studentId}`, undefined, T);
    assert.ok(events.events.some((e) => e.type === 'pinning_removed'));
    [a.c, b.c, teacher].forEach((x) => x.close());
  } finally { await set({ 'score.unprotectedFocusZeroSec': null, 'score.unprotectedAbsentSec': null }); }
});

test('dars taymeri tugaganda server qulfni avtomatik ochadi', async () => {
  const s = await newSession({ duration: 0.1 });       // 6 soniya
  const a = await joinStudent(srv.base, api, s.id, 'Taymer', 'android-lite');
  assert.equal(a.res.locked, true);
  const ev = await a.c.waitFor('session-unlocked', null, 12000);
  assert.equal(ev.reason, 'timer');
  const late = await joinStudent(srv.base, api, s.id, 'Kech', 'android-lite');
  assert.equal(late.res.locked, false);
  a.c.close(); late.c.close();
  // uzaytirish qulfni qayta yoqadi
  const ext = await api('POST', `/api/lock/sessions/${s.id}/extend`, { minutes: 30 }, T);
  assert.equal(ext._status, 200);
  assert.equal((await api('POST', `/api/lock/sessions/${s.id}/extend`, { minutes: 999 }, T))._status, 400);
});

test("favqulodda chiqish: so'rov → bir bosishda tasdiq → faqat shu talaba ochiladi", async () => {
  const s = await newSession();
  const teacher = connect(srv.base, { token: T }); await teacher.opened;
  teacher.emit('teacher-monitor', { sessionId: s.id });
  const a = await joinStudent(srv.base, api, s.id, 'Asror', 'android-full');
  const b = await joinStudent(srv.base, api, s.id, 'Behruz', 'android-full');
  a.c.emit('student-emergency-exit-request', { reason: "Qo'ng'iroq" });
  const req = await teacher.waitFor('access-request');
  assert.equal(req.kind, 'emergency_exit');
  a.c.emit('student-emergency-exit-request', {});     // takroriy so'rov qabul qilinmaydi
  await sleep(300);
  assert.equal((await api('GET', `/api/lock/sessions/${s.id}/overview`, undefined, T)).requests.length, 1);
  assert.equal((await api('POST', `/api/lock/requests/${req.id}/decision`, { approve: true }, T))._status, 200);
  assert.equal((await a.c.waitFor('emergency-exit-decision')).approved, true);
  assert.equal((await a.c.waitFor('session-unlocked')).individual, true);
  await sleep(300);
  assert.equal(b.c.has('session-unlocked'), false);
  assert.equal((await api('POST', `/api/lock/requests/${req.id}/decision`, { approve: false }, T))._status, 409);

  // qayta ulanganda ham ochiq; ustoz qayta qulflaydi
  const re = connect(srv.base); await re.opened;
  re.emit('student-rejoin', { sessionId: s.id, studentId: a.studentId, deviceKey: a.payload.deviceKey });
  assert.equal((await re.waitFor('rejoin-success')).locked, false);
  const hijack = connect(srv.base); await hijack.opened;
  hijack.emit('student-rejoin', { sessionId: s.id, studentId: a.studentId, deviceKey: randKey() });
  assert.equal((await hijack.waitFor('rejoin-error')).reason, 'device_mismatch');
  await api('POST', `/api/lock/sessions/${s.id}/relock`, { studentIds: [a.studentId] }, T);
  assert.equal((await re.waitFor('session-locked')).message.length > 0, true);
  [a.c, b.c, teacher, re, hijack].forEach((x) => x.close());
});

test('tanlangan talabalarni ochish va hammasini ochish/qulflash', async () => {
  const s = await newSession();
  const a = await joinStudent(srv.base, api, s.id, 'Ali', 'android-lite');
  const b = await joinStudent(srv.base, api, s.id, 'Bek', 'android-lite');
  assert.equal((await api('POST', `/api/lock/sessions/${s.id}/release`, { studentIds: [a.studentId] }, T)).released, 1);
  await a.c.waitFor('session-unlocked');
  await sleep(250); assert.equal(b.c.has('session-unlocked'), false);
  assert.equal((await api('POST', `/api/lock/sessions/${s.id}/release`, {}, T)).released, 2);
  await b.c.waitFor('session-unlocked');
  assert.equal((await api('POST', `/api/lock/sessions/${s.id}/relock`, {}, T))._status, 200);
  await b.c.waitFor('session-locked');
  // begona ustoz boshqara olmaydi
  const other = await api('POST', '/api/register', { name: 'X', surname: 'Y', email: `x${Date.now()}@x.uz`, password: 'secret12' });
  assert.equal((await api('POST', `/api/lock/sessions/${s.id}/release`, {}, other.token))._status, 403);
  a.c.close(); b.c.close();
});

test("guruh ro'yxati: CSV, bir martalik bog'lash, HEMIS ID oshkor bo'lmaydi", async () => {
  const csv = '﻿F.I.Sh;HEMIS ID\nKarimov Jasur;111\nAliyeva Dilnoza;222\nKarimov Jasur;999\n';
  const g = await api('POST', '/api/rosters', { name: '101-guruh', csv }, T);
  assert.equal(g.students, 2); assert.equal(g.warnings.length, 1);
  assert.equal((await api('POST', '/api/rosters', { name: 'bo\'sh', csv: '' }, T))._status, 400);
  const s = await newSession({ rosterGroupId: g.id });
  const list = await api('GET', `/api/sessions/${s.id}/roster`);
  assert.equal(list.students.length, 2);
  assert.ok(!JSON.stringify(list).includes('111'));
  const jasur = list.students.find((x) => x.name === 'Karimov Jasur');

  // bog'lanmagan qurilma kira olmaydi
  const key = randKey();
  const c0 = connect(srv.base); await c0.opened;
  c0.emit('student-join', await joinPayload(api, s.id, 'Soxta', 'android-lite', { rosterStudentId: jasur.id, deviceKey: key }));
  assert.equal((await c0.waitFor('join-error')).code, 'roster_not_bound');

  const bind = await api('POST', `/api/sessions/${s.id}/roster/bind`, { rosterStudentId: jasur.id, deviceKey: key, platform: 'android' });
  assert.equal(bind._status, 200);
  // shu ism boshqa qurilmaga, shu qurilma boshqa ismga bog'lanmaydi
  assert.equal((await api('POST', `/api/sessions/${s.id}/roster/bind`, { rosterStudentId: jasur.id, deviceKey: randKey() }))._status, 409);
  const dil = list.students.find((x) => x.name !== 'Karimov Jasur');
  assert.equal((await api('POST', `/api/sessions/${s.id}/roster/bind`, { rosterStudentId: dil.id, deviceKey: key }))._status, 409);
  const after = await api('GET', `/api/sessions/${s.id}/roster?deviceKey=${key}`);
  assert.equal(after.boundTo, jasur.id);
  assert.equal(after.students.find((x) => x.id === jasur.id).taken, false);

  const j = await joinStudent(srv.base, api, s.id, 'Boshqa ism', 'android-lite', { rosterStudentId: jasur.id, deviceKey: key });
  const mine = (await api('GET', '/api/sessions', undefined, T)).find((x) => x.id === s.id);
  assert.equal(mine.students[0].name, 'Karimov Jasur');       // ism ro'yxatdan olinadi
  // qayta kirish yangi yozuv yaratmaydi
  const j2 = await joinStudent(srv.base, api, s.id, 'Yana', 'android-lite', { rosterStudentId: jasur.id, deviceKey: key });
  assert.equal(j2.studentId, j.studentId);
  assert.equal((await api('GET', '/api/sessions', undefined, T)).find((x) => x.id === s.id).students.length, 1);

  // ustoz bog'lanishni tiklaydi → yangi qurilma bog'lana oladi
  assert.equal((await api('POST', `/api/rosters/${g.id}/students/${jasur.id}/reset-binding`, {}, T)).reset, true);
  assert.equal((await api('POST', `/api/sessions/${s.id}/roster/bind`, { rosterStudentId: jasur.id, deviceKey: randKey() }))._status, 200);
  [c0, j.c, j2.c].forEach((x) => x.close());
});

test("hisobot: ball formulasi, admin sozlamasi, CSV va ruxsatlar", async () => {
  const s = await newSession();
  const teacher = connect(srv.base, { token: T }); await teacher.opened;
  const a = await joinStudent(srv.base, api, s.id, 'Hisob', 'android-full');
  teacher.emit('teacher-send-quiz', { sessionId: s.id, quiz: { title: 'T', questions: [{ id: 'q1', text: 'a', options: ['x', 'y'], correctIndex: 0 }, { id: 'q2', text: 'b', options: ['x', 'y'], correctIndex: 1 }] } });
  const q = await a.c.waitFor('new-quiz');
  a.c.emit('student-submit-quiz', { sessionId: s.id, studentId: a.studentId, studentName: 'Hisob', quizId: q.quizId, answers: { q1: 0, q2: 0 } });
  assert.equal((await a.c.waitFor('quiz-result')).percentage, 50);
  a.c.emit('student-heartbeat', hbPayload(s, a.studentId, GOOD));
  await sleep(2300);
  let rep = await api('GET', `/api/lock/sessions/${s.id}/report`, undefined, T);
  let r = rep.students[0];
  assert.equal(r.quizzes, 50); assert.equal(r.attendance, 100); assert.equal(r.focus, 100);
  assert.equal(r.total, 75);                                  // 100*0.3 + 50*0.5 + 100*0.2
  const csv = await api('GET', `/api/lock/sessions/${s.id}/report?format=csv`, undefined, T, true);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const text = await csv.text();
  assert.ok(text.includes('Jami ball') && text.includes('Hisob'));

  // formulani admin o'zgartiradi (yangi darslarga ta'sir qiladi)
  assert.equal((await api('PUT', '/api/admin/settings', { values: { 'score.weights': { attendance: 30, quizzes: 50, focus: 30 } } }, T))._status, 400);
  assert.equal((await api('PUT', '/api/admin/settings', { values: { 'score.weights': { attendance: 10, quizzes: 80, focus: 10 } } }, T))._status, 200);
  const s2 = await newSession();
  const a2 = await joinStudent(srv.base, api, s2.id, 'Hisob2', 'android-full');
  teacher.emit('teacher-send-quiz', { sessionId: s2.id, quiz: { title: 'T', questions: [{ id: 'q1', text: 'a', options: ['x', 'y'], correctIndex: 0 }, { id: 'q2', text: 'b', options: ['x', 'y'], correctIndex: 1 }] } });
  const q2 = await a2.c.waitFor('new-quiz');
  a2.c.emit('student-submit-quiz', { sessionId: s2.id, studentId: a2.studentId, studentName: 'Hisob2', quizId: q2.quizId, answers: { q1: 0, q2: 0 } });
  await a2.c.waitFor('quiz-result');
  a2.c.emit('student-heartbeat', hbPayload(s2, a2.studentId, GOOD));
  await sleep(2300);
  rep = await api('GET', `/api/lock/sessions/${s2.id}/report`, undefined, T);
  assert.equal(rep.students[0].total, 60);                    // 10 + 40 + 10
  await api('PUT', '/api/admin/settings', { values: { 'score.weights': null } }, T);

  // admin bo'lmagan ustoz sozlamalarga tega olmaydi
  const t2 = await api('POST', '/api/register', { name: 'Oddiy', surname: 'Ustoz', email: `t${Date.now()}@x.uz`, password: 'secret12' });
  assert.equal((await api('GET', '/api/admin/settings', undefined, t2.token))._status, 403);
  assert.equal((await api('GET', '/api/admin/telemetry', undefined, t2.token))._status, 403);
  [a.c, a2.c, teacher].forEach((x) => x.close());
});

test("ma'lumotni o'chirish: faqat qurilma kaliti egasi", async () => {
  const s = await newSession();
  const a = await joinStudent(srv.base, api, s.id, 'Maxfiy Talaba', 'android-lite');
  const wrong = await api('POST', '/api/student-data/delete', { deviceKey: randKey(), items: [{ sessionId: s.id, studentId: a.studentId }] });
  assert.equal(wrong.deleted, 0);
  assert.equal((await api('GET', '/api/sessions', undefined, T)).find((x) => x.id === s.id).students[0].name, 'Maxfiy Talaba');
  const ok = await api('POST', '/api/student-data/delete', { deviceKey: a.payload.deviceKey, items: [{ sessionId: s.id, studentId: a.studentId }] });
  assert.equal(ok.deleted, 1);
  assert.equal((await api('GET', '/api/sessions', undefined, T)).find((x) => x.id === s.id).students[0].name, "O'chirilgan talaba");
  // brauzer orqali so'rov
  const req = await api('POST', '/api/data-deletion-requests', { sessionCode: s.id, fullName: 'Kimdir Kimdirov', contact: 'a@b.uz' });
  assert.ok(req.id);
  assert.equal((await api('GET', '/api/admin/deletion-requests', undefined, T)).requests.some((x) => x.id === req.id), true);
  a.c.close();
});

test('DEMO dars: kod bilan kirish, tayyor test va material, ustoz ro\'yxatida ko\'rinmaydi', async () => {
  const info = await api('GET', '/api/sessions/123456');
  assert.equal(info.demo, true); assert.equal(info.status, 'active');
  const c = connect(srv.base); await c.opened;
  c.emit('student-join', { sessionId: '123456', studentName: 'Tekshiruvchi', client: { type: 'app', platform: 'ios', level: 'ios-l0' } });
  const res = await c.waitFor('join-success');
  assert.equal(res.activeQuiz.questions.length, 3);
  assert.equal(res.materials[0].fileUrl, '/demo/demo-slides.pdf');
  assert.equal(res.protection.demo, true);
  assert.equal((await fetch(srv.base + '/demo/demo-slides.pdf')).status, 200);
  assert.equal((await api('GET', '/api/sessions', undefined, T)).some((x) => x.id === '123456'), false);
  assert.equal((await api('POST', '/api/sessions/123456/end', {}, T))._status, 404);
  c.close();
});

test("fakultet standarti: admin fakultet bo'yicha 'himoya majburiy'ni belgilaydi", async () => {
  const f = await api('POST', '/api/admin/faculties', { name: 'Fizika fakulteti' }, T);
  assert.ok(f.id);
  const t = await api('POST', '/api/register', { name: 'Fiz', surname: 'Ustoz', email: `f${Date.now()}@x.uz`, password: 'secret12' });
  assert.equal((await api('PUT', `/api/admin/users/${t.teacher.id}`, { facultyId: f.id }, T))._status, 200);
  assert.equal((await api('PUT', '/api/admin/settings', { scope: 'faculty', facultyId: f.id, values: { 'protection.default': 'required' } }, T))._status, 200);
  assert.equal((await api('PUT', '/api/admin/settings', { scope: 'faculty', facultyId: f.id, values: { 'retention.maxDays': 30 } }, T))._status, 400);   // faqat global
  assert.equal((await newSession({}, t.token)).protection, 'required');
  assert.equal((await newSession({ protection: 'optional' }, t.token)).protection, 'optional');   // ustoz dars boshida o'zgartira oladi
  assert.equal((await newSession({})).protection, 'optional');                                     // boshqa fakultet — standart
});

test("qulf ochiq (erkin) vaqt jarima bermaydi; qayta qulflangach hisob davom etadi", async () => {
  const set = (values) => api('PUT', '/api/admin/settings', { scope: 'global', values }, T);
  await set({ 'score.unprotectedFocusZeroSec': 1, 'score.unprotectedAbsentSec': 3 });
  try {
    const s = await newSession({ protection: 'required' });
    const teacher = connect(srv.base, { token: T }); await teacher.opened;
    teacher.emit('lock-subscribe', { sessionId: s.id });
    const a = await joinStudent(srv.base, api, s.id, 'Erkin', 'android-full');
    await api('POST', `/api/lock/sessions/${s.id}/release`, {}, T);
    await a.c.waitFor('session-unlocked');
    const off = { active: false, reasons: ['not_pinned'], checks: { pinned: false } };
    for (let i = 0; i < 4; i++) { a.c.emit('student-heartbeat', hbPayload(s, a.studentId, off)); await sleep(1200); }
    await sleep(2300);
    assert.equal(teacher.has('lock-event', (e) => e.type === 'rule_focus_zero' || e.type === 'rule_absent'), false, "qulf ochiq vaqtda qoida ishlamasligi kerak");
    let rep = await api('GET', `/api/lock/sessions/${s.id}/report`, undefined, T);
    assert.equal(rep.students[0].focus, 100); assert.equal(rep.students[0].attendance, 100);
    // qayta qulflanadi, himoya hali o'chiq → endi hisoblanadi
    await api('POST', `/api/lock/sessions/${s.id}/relock`, {}, T);
    for (let i = 0; i < 4; i++) { a.c.emit('student-heartbeat', hbPayload(s, a.studentId, off)); await sleep(1200); }
    await teacher.waitFor('lock-event', (e) => e.type === 'rule_focus_zero', 4000);
    a.c.close(); teacher.close();
  } finally { await set({ 'score.unprotectedFocusZeroSec': null, 'score.unprotectedAbsentSec': null }); }
});

test('tezlik cheklovi: ochiq endpoint ketma-ket ko\'p chaqirilsa 429', async () => {
  let limited = 0;
  for (let i = 0; i < 110; i++) if ((await fetch(srv.base + '/api/lock/capabilities')).status === 429) limited++;
  assert.ok(limited > 0);
});
