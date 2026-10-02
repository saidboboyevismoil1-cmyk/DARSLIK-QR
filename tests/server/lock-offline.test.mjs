import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, makeApi, teacherLogin, connect, joinStudent, sleep } from './helpers.mjs';

// Sekin test (~20 s): heartbeat uzilishi eng kam chegarasi 15 s
let srv, api, T;
before(async () => { srv = await startServer({ IOS_L2_ENABLED: 'true' }); api = makeApi(srv.base); ({ token: T } = await teacherLogin(api)); });
after(async () => { await srv.stop(); });
const GOOD = { active: true, reasons: [], checks: { pinned: true, accessibility: true, dnd: true, foreground: true } };
const hb = (s, id) => ({ sessionId: s.id, studentId: id, fg: true, protection: GOOD });

test("heartbeat to'xtasa: Android — aloqasiz, iOS L2 — taxminan himoyada (bypass emas)", async () => {
  assert.equal((await api('PUT', '/api/admin/settings', { values: { 'heartbeat.offlineAfterSec': 15 } }, T))._status, 200);
  assert.equal((await api('GET', '/api/lock/capabilities')).features.iosL2, true);
  const s = (await api('POST', '/api/sessions', { name: 'Oflayn', duration: 45, protection: 'required' }, T)).session;
  const teacher = connect(srv.base, { token: T }); await teacher.opened;
  teacher.emit('lock-subscribe', { sessionId: s.id });
  const and = await joinStudent(srv.base, api, s.id, 'Android Talaba', 'android-full');
  const ios = await joinStudent(srv.base, api, s.id, 'iPhone Talaba', 'ios-l2');
  assert.equal(ios.res.protection.level, 'ios-l2');
  assert.equal(ios.res.protection.features.iosL2, true);
  for (const x of [and, ios]) x.c.emit('student-heartbeat', hb(s, x.studentId));
  await Promise.all([and.c.waitFor('heartbeat-ack'), ios.c.waitFor('heartbeat-ack')]);

  const lostA = await teacher.waitFor('lock-event', (e) => e.type === 'heartbeat_lost' && e.studentId === and.studentId, 22000);
  const lostI = await teacher.waitFor('lock-event', (e) => e.type === 'heartbeat_lost' && e.studentId === ios.studentId, 5000);
  assert.equal(lostI.data.assumed, true);
  assert.ok(!lostA.data || !lostA.data.assumed);   // Android: oddiy aloqa uzilishi
  let ov = await api('GET', `/api/lock/sessions/${s.id}/overview`, undefined, T);
  assert.equal(ov.students.find((x) => x.name === 'Android Talaba').status, 'offline');
  assert.equal(ov.students.find((x) => x.name === 'iPhone Talaba').status, 'assumed');
  assert.equal(ov.students.find((x) => x.name === 'iPhone Talaba').color, 'green');     // taxminiy himoya: qizil signal emas

  await sleep(2600);                                       // aloqasiz holat hisobga olinishi uchun
  and.c.emit('student-heartbeat', hb(s, and.studentId));
  const back = await teacher.waitFor('lock-event', (e) => e.type === 'heartbeat_restored' && e.studentId === and.studentId);
  assert.ok(back.data.offlineMs >= 15000);               // oxirgi heartbeat'dan beri
  // aloqasiz vaqt android'da himoyasiz hisoblanadi, iOS L2'da himoyalangan deb olinadi
  const rep = await api('GET', `/api/lock/sessions/${s.id}/report`, undefined, T);
  const ra = rep.students.find((x) => x.name === 'Android Talaba'), ri = rep.students.find((x) => x.name === 'iPhone Talaba');
  assert.ok(ra.offlineMin > 0); assert.equal(ri.offlineMin, 0);
  assert.ok(ri.protectedMin > ra.protectedMin);
  await api('PUT', '/api/admin/settings', { values: { 'heartbeat.offlineAfterSec': null } }, T);
  [and.c, ios.c, teacher].forEach((x) => x.close());
});
