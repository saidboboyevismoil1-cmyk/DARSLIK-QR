import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, makeApi, teacherLogin, connect, joinStudent, joinPayload, sleep, APP, OK_PROTECTION } from './helpers.mjs';

let srv, api, T, tok;
before(async () => {
  srv = await startServer();
  api = makeApi(srv.base);
  ({ token: tok } = await teacherLogin(api));
  T = tok;
});
after(async () => { await srv.stop(); });

const newSession = (body = {}) => api('POST', '/api/sessions', { name: 'Test dars', subject: 'Fan', duration: 45, ...body }, T).then((r) => r.session);

test('xavfsizlik: /api/unlock-all olib tashlangan, upload-material token talab qiladi', async () => {
  assert.equal((await api('GET', '/api/unlock-all'))._status, 404);
  const r = await fetch(srv.base + '/api/upload-material', { method: 'POST' });
  assert.equal(r.status, 401);
});

test('xavfsizlik: tokensiz soket ustoz hodisalarini ishlata olmaydi', async () => {
  const s = await newSession();
  const spy = connect(srv.base); await spy.opened;
  spy.emit('teacher-monitor', { sessionId: s.id });
  await spy.waitFor('auth-error');
  spy.emit('teacher-send-quiz', { sessionId: s.id, quiz: { title: 'X', questions: [] } });
  await spy.waitFor('auth-error', null, 2000);
  const teacher = connect(srv.base, { token: T }); await teacher.opened;
  teacher.emit('teacher-monitor', { sessionId: s.id });
  await sleep(300);
  assert.equal(teacher.has('auth-error'), false);
  spy.close(); teacher.close();
});

test('xavfsizlik: talaba boshqa talaba nomidan test topshira olmaydi', async () => {
  const s = await newSession();
  const a = await joinStudent(srv.base, api, s.id, 'Alisher', 'android-full');
  const b = await joinStudent(srv.base, api, s.id, 'Bobur', 'android-full');
  const teacher = connect(srv.base, { token: T }); await teacher.opened;
  teacher.emit('teacher-send-quiz', { sessionId: s.id, quiz: { title: 'Q', questions: [{ id: 'q1', text: '1+1', options: ['1', '2'], correctIndex: 1 }] } });
  const quiz = await a.c.waitFor('new-quiz');
  b.c.emit('student-submit-quiz', { sessionId: s.id, studentId: a.studentId, studentName: 'Alisher', quizId: quiz.quizId, answers: { q1: 1 } });
  await sleep(400);
  assert.equal(b.c.has('quiz-result'), false);
  assert.equal(a.c.has('quiz-result'), false);
  a.c.close(); b.c.close(); teacher.close();
});

test('gating: majburiy darsga brauzer va himoyasiz qurilma kira olmaydi', async () => {
  const s = await newSession({ protection: 'required' });
  assert.equal(s.protection, 'required');
  const pub = await api('GET', `/api/sessions/${s.id}`);
  assert.equal(pub.requiresApp, true);

  const web = connect(srv.base); await web.opened;
  web.emit('student-join', { sessionId: s.id, studentName: 'Brauzer', client: { type: 'web' } });
  assert.equal((await web.waitFor('join-error')).code, 'app_required');

  await assert.rejects(joinStudent(srv.base, api, s.id, 'iOS L0', 'ios-l0'), /protection_required/);
  // iOS L1 bayrog'i o'chiq bo'lsa, "ios-l1" da'vo qilgan qurilma ham L0 hisoblanadi
  await assert.rejects(joinStudent(srv.base, api, s.id, 'iOS L1', 'ios-l1'), /protection_required/);

  // himoya yoqilmagan
  const c = connect(srv.base); await c.opened;
  c.emit('student-join', await joinPayload(api, s.id, 'Faol emas', 'android-full', { protection: { active: false, reasons: ['not_pinned'], checks: {} } }));
  assert.equal((await c.waitFor('join-error')).code, 'protection_inactive');

  // attestatsiyasiz
  const d = connect(srv.base); await d.opened;
  const p = await joinPayload(api, s.id, 'Soxta', 'android-full'); p.attestation = { nonce: p.attestation.nonce, token: 'forged' };
  d.emit('student-join', p);
  assert.equal((await d.waitFor('join-error')).code, 'attestation_failed');
  // nonce qayta ishlatib bo'lmaydi
  const e = connect(srv.base); await e.opened;
  const ok = await joinPayload(api, s.id, 'Haqiqiy', 'android-lite');
  e.emit('student-join', ok); await e.waitFor('join-success');
  const f = connect(srv.base); await f.opened;
  f.emit('student-join', { ...ok, studentName: 'Replay' });
  assert.equal((await f.waitFor('join-error')).code, 'attestation_failed');
  [web, c, d, e, f].forEach((x) => x.close());
});

test("himoyasiz kirish: so'rov → ustoz tasdig'i → bir martalik kalit", async () => {
  const s = await newSession({ protection: 'required' });
  const teacher = connect(srv.base, { token: T }); await teacher.opened;
  teacher.emit('teacher-monitor', { sessionId: s.id });
  const bad = await api('POST', `/api/sessions/${s.id}/exemption-requests`, { name: 'Vali', reason: 'xxx' });
  assert.equal(bad._status, 400);
  const req = await api('POST', `/api/sessions/${s.id}/exemption-requests`, { name: 'Vali Valiyev', reason: 'old_phone', device: 'Eski telefon' });
  assert.ok(req.id && req.secret);
  const ev = await teacher.waitFor('access-request', (x) => x.id === req.id);
  assert.equal(ev.kind, 'exemption');
  let st = await api('GET', `/api/access-requests/${req.id}?secret=${req.secret}`);
  assert.equal(st.status, 'pending');
  assert.equal((await api('GET', `/api/access-requests/${req.id}?secret=wrong`))._status, 404);
  // boshqa ustoz tasdiqlay olmaydi
  const reg = await api('POST', '/api/register', { name: 'Boshqa', surname: 'Ustoz', email: `o${Date.now()}@x.uz`, password: 'secret12' });
  assert.equal((await api('POST', `/api/lock/requests/${req.id}/decision`, { approve: true }, reg.token))._status, 404);
  assert.equal((await api('POST', `/api/lock/requests/${req.id}/decision`, { approve: true }, T))._status, 200);
  st = await api('GET', `/api/access-requests/${req.id}?secret=${req.secret}`);
  assert.equal(st.status, 'approved');
  const c = connect(srv.base); await c.opened;
  c.emit('student-join', { sessionId: s.id, studentName: 'Vali Valiyev', client: { type: 'web' }, exemptionToken: st.token });
  const res = await c.waitFor('join-success');
  assert.ok(res.studentId);
  const c2 = connect(srv.base); await c2.opened;
  c2.emit('student-join', { sessionId: s.id, studentName: 'Vali Valiyev', client: { type: 'web' }, exemptionToken: st.token });
  assert.equal((await c2.waitFor('join-error')).code, 'app_required');
  [teacher, c, c2].forEach((x) => x.close());
});
