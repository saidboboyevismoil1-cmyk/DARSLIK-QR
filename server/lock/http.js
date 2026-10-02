// "Dars rejimi" REST API. Ochiq (tezlik cheklovi bilan), ustoz va admin endpoint'lari.
const express = require('express');
const { rateLimit } = require('../security');
const attestation = require('./attestation');
const { parseCsv, sha } = require('../repos/rosters');
const { BRANDS } = require('./levels');

function isoWeekRange(week) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(week || ''));
  let monday;
  if (m) {
    const jan4 = new Date(Date.UTC(+m[1], 0, 4));
    const w1 = new Date(jan4); w1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
    monday = new Date(w1); monday.setUTCDate(w1.getUTCDate() + (+m[2] - 1) * 7);
  } else {
    const n = new Date(); monday = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  }
  const end = new Date(monday); end.setUTCDate(monday.getUTCDate() + 7);
  return { from: monday.getTime(), to: end.getTime(), fromDay: monday.toISOString().slice(0, 10), toDay: new Date(end.getTime() - 1).toISOString().slice(0, 10) };
}

function createRouter({ svc, config, auth, legacy, helpers }) {
  const r = express.Router();
  const publicLimit = rateLimit({ windowMs: 60000, max: 90, name: 'public' });
  const strictLimit = rateLimit({ windowMs: 60000, max: 12, name: 'strict' });
  const requireAdmin = (req, res, next) => (req.role === 'admin' ? next() : res.status(403).json({ error: 'Faqat admin uchun' }));
  const ownedSession = (req, res) => {
    const s = svc.sessionById(req.params.id);
    if (!s) { res.status(404).json({ error: 'Sessiya topilmadi' }); return null; }
    if (!svc.canManage(req.teacher, s)) { res.status(403).json({ error: 'Bu sessiya sizniki emas' }); return null; }
    return s;
  };
  const ok = (res, extra = {}) => res.json({ success: true, ...extra });

  // ================= Ochiq (talaba ilovasi) =================
  r.get('/lock/capabilities', publicLimit, (req, res) => {
    const st = svc.settings.effective();
    res.json({ features: { iosL1: !!st['features.iosL1'], iosL2: !!st['features.iosL2'] }, attestationMode: config.attestation.mode, heartbeatIntervalSec: st['heartbeat.intervalSec'], offlineAfterSec: st['heartbeat.offlineAfterSec'], releaseOfflineMinutes: st['release.offlineMinutes'], serverTime: Date.now() });
  });

  r.get('/lock/attest/challenge', publicLimit, (req, res) => res.json({ nonce: attestation.issueChallenge(helpers.sql, String(req.query.sessionId || '')) }));

  r.get('/sessions/:id/roster', publicLimit, (req, res) => {
    const s = svc.sessionById(req.params.id);
    if (!s || !s.rosterGroupId) return res.status(404).json({ error: "Bu dars uchun guruh ro'yxati yo'q" });
    const deviceKey = typeof req.query.deviceKey === 'string' ? req.query.deviceKey : '';
    const bound = deviceKey ? svc.rosters.boundTo(s.rosterGroupId, deviceKey) : null;
    // HEMIS ID va boshqa shaxsiy ma'lumot chiqarilmaydi: faqat ism va band/bo'shligi
    const students = svc.rosters.students(s.rosterGroupId).map((x) => ({ id: x.id, name: x.full_name, taken: !!x.bound_at && !(bound && bound.id === x.id) }));
    res.json({ groupName: (svc.rosters.group(s.rosterGroupId) || {}).name, students, boundTo: bound ? bound.id : null });
  });

  r.post('/sessions/:id/roster/bind', strictLimit, (req, res) => {
    const s = svc.sessionById(req.params.id);
    const { rosterStudentId, deviceKey, platform } = req.body || {};
    if (!s || !s.rosterGroupId || s.status !== 'active') return res.status(404).json({ error: 'Sessiya topilmadi' });
    if (typeof deviceKey !== 'string' || deviceKey.length < 16 || deviceKey.length > 128) return res.status(400).json({ error: 'Qurilma kaliti noto\'g\'ri' });
    const rs = svc.rosters.student(String(rosterStudentId || ''));
    if (!rs || rs.group_id !== s.rosterGroupId) return res.status(404).json({ error: "Ro'yxatda bunday talaba yo'q" });
    if (svc.rosters.hasBindingWith(rs.id, deviceKey)) return ok(res, { name: rs.full_name, already: true });
    // bir qurilma — bir talaba (shu guruhda)
    const other = svc.rosters.boundTo(s.rosterGroupId, deviceKey);
    if (other) return res.status(409).json({ error: 'Bu qurilma boshqa talabaga bog\'langan', code: 'device_bound' });
    if (!svc.rosters.bind(rs.id, deviceKey, ['ios', 'android', 'web'].includes(platform) ? platform : null)) return res.status(409).json({ error: 'Bu ism boshqa qurilmaga bog\'langan. Ustozga murojaat qiling', code: 'name_taken' });
    ok(res, { name: rs.full_name });
  });

  r.post('/sessions/:id/exemption-requests', strictLimit, (req, res) => {
    const s = svc.sessionById(req.params.id);
    if (!s || s.status !== 'active') return res.status(404).json({ error: 'Sessiya topilmadi' });
    const out = svc.requestExemption(s, req.body || {});
    if (out.error) return res.status(400).json({ error: out.error });
    ok(res, { id: out.id, secret: out.secret });
  });

  r.get('/access-requests/:id', publicLimit, (req, res) => {
    const row = svc.requests.get(req.params.id);
    if (!row || !svc.requests.secretMatches(row, String(req.query.secret || ''))) return res.status(404).json({ error: 'Topilmadi' });
    const approved = row.status === 'approved' && !row.consumed_at;
    res.json({ status: row.status, token: approved ? `${row.id}.${req.query.secret}` : undefined });
  });

  r.post('/telemetry/onboarding', publicLimit, (req, res) => {
    const { step, outcome, brand, platform } = req.body || {};
    const steps = ['consent', 'accessibility', 'usage', 'dnd', 'battery', 'pinning', 'screentime', 'notifications', 'camera', 'ready'];
    if (!steps.includes(step) || !['reached', 'granted', 'denied', 'skipped'].includes(outcome)) return res.status(400).json({ error: 'Noto\'g\'ri' });
    svc.telemetry.inc('onboarding', `${platform === 'ios' ? 'ios' : 'android'}:${step}`, outcome);
    const b = String(brand || '').toLowerCase();
    if (outcome === 'denied') svc.telemetry.inc('device_issue', BRANDS.find((x) => b.includes(x)) || 'other', step);
    ok(res);
  });

  // Talaba o'z ma'lumotini o'chiradi (qurilma kaliti bilan tasdiqlanadi)
  r.post('/student-data/delete', strictLimit, (req, res) => {
    const { deviceKey, items } = req.body || {};
    if (typeof deviceKey !== 'string' || deviceKey.length < 16) return res.status(400).json({ error: 'Qurilma kaliti kerak' });
    const dkh = sha(deviceKey);
    let deleted = 0;
    for (const it of (Array.isArray(items) ? items : []).slice(0, 200)) {
      const s = svc.sessionById(String(it.sessionId || '')); if (!s) continue;
      const st = s.students.find((x) => x.id === it.studentId && x.dkh === dkh);
      if (st && svc.anonymizeStudent(s, st)) deleted++;
    }
    const bindings = svc.rosters.removeBindingsByDevice(deviceKey);
    if (deleted) helpers.saveSessions();
    ok(res, { deleted, bindingsRemoved: bindings });
  });

  r.post('/data-deletion-requests', strictLimit, (req, res) => {
    const { sessionCode, fullName, contact } = req.body || {};
    const name = String(fullName || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (name.length < 3) return res.status(400).json({ error: 'F.I.Sh kiriting' });
    const id = helpers.uuid().slice(0, 10);
    helpers.sql.run('INSERT INTO deletion_requests (id, created_at, session_code, name_norm, contact) VALUES (?, ?, ?, ?, ?)', [id, Date.now(), String(sessionCode || '').slice(0, 12), name.toLowerCase(), String(contact || '').slice(0, 120)]);
    ok(res, { id });
  });

  // ================= Ustoz =================
  r.post('/lock/sessions/:id/release', auth, (req, res) => {
    const s = ownedSession(req, res); if (!s) return;
    const ids = Array.isArray(req.body && req.body.studentIds) && req.body.studentIds.length ? req.body.studentIds.map(String) : null;
    ok(res, { released: svc.releaseStudents(s, ids, 'teacher', req.teacherId) });
  });
  r.post('/lock/sessions/:id/relock', auth, (req, res) => {
    const s = ownedSession(req, res); if (!s) return;
    const ids = Array.isArray(req.body && req.body.studentIds) && req.body.studentIds.length ? req.body.studentIds.map(String) : null;
    svc.relockStudents(s, ids, req.teacherId); ok(res);
  });
  r.post('/lock/sessions/:id/extend', auth, (req, res) => {
    const s = ownedSession(req, res); if (!s) return;
    const m = Number(req.body && req.body.minutes);
    if (!Number.isFinite(m) || m < 1 || m > 180) return res.status(400).json({ error: "1–180 daqiqa kiriting" });
    ok(res, svc.extend(s, Math.round(m)));
  });
  r.get('/lock/sessions/:id/overview', auth, (req, res) => { const s = ownedSession(req, res); if (s) res.json(svc.overview(s)); });
  r.get('/lock/sessions/:id/events', auth, (req, res) => {
    const s = ownedSession(req, res); if (!s) return;
    res.json({ events: svc.lockdata.events(s.id, { limit: Math.min(500, Number(req.query.limit) || 200), sinceId: Number(req.query.sinceId) || 0, studentId: req.query.studentId ? String(req.query.studentId) : null }) });
  });
  r.get('/lock/sessions/:id/report', auth, (req, res) => {
    const s = ownedSession(req, res); if (!s) return;
    const rep = svc.buildReport(s);
    if (req.query.format === 'csv') {
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="edufocus-${s.id}-hisobot.csv"` });
      return res.send(svc.reportCsv(rep));
    }
    res.json(rep);
  });
  r.post('/lock/requests/:rid/decision', auth, (req, res) => {
    const row = svc.requests.get(req.params.rid);
    const s = row && svc.sessionById(row.session_id);
    if (!s || !svc.canManage(req.teacher, s)) return res.status(404).json({ error: 'So\'rov topilmadi' });
    const out = svc.decideRequest(s, row.id, !!(req.body && req.body.approve), req.teacherId);
    if (out.error) return res.status(409).json({ error: out.error });
    ok(res);
  });
  r.post('/lock/telemetry/teacher-active', auth, (req, res) => {
    const sec = Math.max(0, Math.min(120, Number(req.body && req.body.seconds) || 0));
    if (sec) { svc.telemetry.inc('teacher_active_sec', '', '', sec); }
    ok(res);
  });

  // --- Guruh ro'yxatlari
  r.get('/rosters', auth, (req, res) => res.json({ groups: svc.rosters.groupsFor(req.teacherId, req.role === 'admin') }));
  r.post('/rosters', auth, (req, res) => {
    const { name, csv } = req.body || {};
    const gname = String(name || '').trim().slice(0, 80);
    if (!gname) return res.status(400).json({ error: 'Guruh nomini kiriting' });
    const parsed = parseCsv(csv);
    if (!parsed.students.length) return res.status(400).json({ error: parsed.errors[0] || "Ro'yxat bo'sh", errors: parsed.errors });
    const id = svc.rosters.createGroup({ teacherId: req.teacherId, facultyId: req.teacher.facultyId || null, name: gname, students: parsed.students });
    ok(res, { id, students: parsed.students.length, warnings: parsed.errors });
  });
  const ownedGroup = (req, res) => {
    const g = svc.rosters.group(req.params.id);
    if (!g || (g.teacher_id !== req.teacherId && req.role !== 'admin')) { res.status(404).json({ error: "Guruh topilmadi" }); return null; }
    return g;
  };
  r.get('/rosters/:id', auth, (req, res) => { const g = ownedGroup(req, res); if (g) res.json({ group: g, students: svc.rosters.students(g.id) }); });
  r.delete('/rosters/:id', auth, (req, res) => { const g = ownedGroup(req, res); if (g) { svc.rosters.deleteGroup(g.id); ok(res); } });
  r.post('/rosters/:id/students/:sid/reset-binding', auth, (req, res) => {
    const g = ownedGroup(req, res); if (!g) return;
    const st = svc.rosters.student(req.params.sid);
    if (!st || st.group_id !== g.id) return res.status(404).json({ error: 'Talaba topilmadi' });
    ok(res, { reset: svc.rosters.resetBinding(st.id) });
  });

  // ================= Admin =================
  r.get('/admin/settings', auth, requireAdmin, (req, res) => {
    const facultyId = req.query.facultyId ? String(req.query.facultyId) : null;
    res.json({ effective: svc.settings.effective(facultyId), global: svc.settings.overrides('global', ''), faculty: facultyId ? svc.settings.overrides('faculty', facultyId) : {}, defaults: svc.settings.DEFAULTS, globalOnly: [...svc.settings.GLOBAL_ONLY] });
  });
  r.put('/admin/settings', auth, requireAdmin, (req, res) => {
    const { scope = 'global', facultyId = '', values } = req.body || {};
    if (!['global', 'faculty'].includes(scope) || (scope === 'faculty' && !facultyId) || !values || typeof values !== 'object') return res.status(400).json({ error: "So'rov noto'g'ri" });
    const entries = Object.entries(values);
    const errors = entries.map(([k, v]) => (v === null && k !== 'retention.semesterEnd' ? { ok: true } : svc.settings.validate(scope, k, v))).filter((x) => !x.ok).map((x) => x.error);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    helpers.sql.transaction(() => {
      for (const [k, v] of entries) {
        if (v === null && k !== 'retention.semesterEnd') svc.settings.reset(scope, facultyId, k);   // null = standartga qaytarish
        else svc.settings.set(scope, facultyId, k, v, req.teacherId);
      }
    });
    ok(res);
  });

  r.get('/admin/faculties', auth, requireAdmin, (req, res) => res.json({ faculties: svc.users.faculties() }));
  r.post('/admin/faculties', auth, requireAdmin, (req, res) => {
    const name = String(req.body && req.body.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Nom kiriting' });
    const id = helpers.uuid().slice(0, 10);
    try { svc.users.addFaculty(id, name); } catch { return res.status(409).json({ error: 'Bunday fakultet bor' }); }
    ok(res, { id });
  });
  r.put('/admin/faculties/:id', auth, requireAdmin, (req, res) => { const n = String(req.body && req.body.name || '').trim().slice(0, 80); if (!n) return res.status(400).json({ error: 'Nom kiriting' }); svc.users.renameFaculty(req.params.id, n) ? ok(res) : res.status(404).json({ error: 'Topilmadi' }); });
  r.delete('/admin/faculties/:id', auth, requireAdmin, (req, res) => {
    svc.users.deleteFaculty(req.params.id);
    legacy.teachers.forEach((t) => { if (t.facultyId === req.params.id) t.facultyId = null; });
    ok(res);
  });
  r.get('/admin/users', auth, requireAdmin, (req, res) => res.json({ users: legacy.teachers.map((t) => ({ id: t.id, name: t.name, surname: t.surname, email: t.email, role: t.role || 'teacher', facultyId: t.facultyId || null })) }));
  r.put('/admin/users/:id', auth, requireAdmin, (req, res) => {
    const t = legacy.teachers.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Topilmadi' });
    const { role, facultyId } = req.body || {};
    if (role !== undefined) {
      if (!['teacher', 'admin'].includes(role)) return res.status(400).json({ error: 'Rol noto\'g\'ri' });
      if (t.id === req.teacherId && role !== 'admin') return res.status(400).json({ error: 'O\'z admin huquqingizni olib tashlab bo\'lmaydi' });
      t.role = role; svc.users.setRole(t.id, role);
    }
    if (facultyId !== undefined) { t.facultyId = facultyId || null; svc.users.setFaculty(t.id, t.facultyId); }
    ok(res);
  });

  r.get('/admin/telemetry', auth, requireAdmin, (req, res) => {
    const to = String(req.query.to || new Date().toISOString().slice(0, 10));
    const from = String(req.query.from || new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10));
    const rows = svc.telemetry.range(from, to);
    const sum = (metric, fn) => rows.filter((x) => x.metric === metric).reduce((a, x) => fn(a, x), {});
    const add = (k, v) => (a) => { a[k] = (a[k] || 0) + v; return a; };
    const lessons = sum('lessons', (a, x) => add(x.dim1, x.value)(a));
    const studentsByLevel = sum('students_by_level', (a, x) => add(x.dim1, x.value)(a));
    const bypassByType = sum('bypass', (a, x) => add(x.dim1, x.value)(a));
    const bypassByWeek = sum('bypass', (a, x) => { const d = new Date(x.day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return add(d.toISOString().slice(0, 10), x.value)(a); });
    const pMs = sum('protected_ms', (a, x) => add(x.dim1, x.value)(a)), lMs = sum('lesson_ms', (a, x) => add(x.dim1, x.value)(a));
    const protectedShare = Object.fromEntries(Object.keys(lMs).map((k) => [k, lMs[k] ? Math.round(1000 * (pMs[k] || 0) / lMs[k]) / 10 : 0]));
    const onboarding = {};
    rows.filter((x) => x.metric === 'onboarding').forEach((x) => { (onboarding[x.dim1] ||= {})[x.dim2] = (onboarding[x.dim1][x.dim2] || 0) + x.value; });
    const deviceIssues = {};
    rows.filter((x) => x.metric === 'device_issue').forEach((x) => { (deviceIssues[x.dim1] ||= {})[x.dim2] = (deviceIssues[x.dim1][x.dim2] || 0) + x.value; });
    const lessonsTotal = Object.values(lessons).reduce((a, b) => a + b, 0);
    const teacherSec = rows.filter((x) => x.metric === 'teacher_active_sec').reduce((a, x) => a + x.value, 0);
    res.json({ from, to, lessons: { total: lessonsTotal, byProtection: lessons }, studentsByLevel, bypass: { byType: bypassByType, byWeek: bypassByWeek }, protectedSharePct: protectedShare, onboarding, deviceIssues, teacherActiveMinPerLesson: lessonsTotal ? Math.round((teacherSec / 60 / lessonsTotal) * 10) / 10 : null });
  });

  r.get('/admin/reports/weekly', auth, requireAdmin, (req, res) => {
    const w = isoWeekRange(req.query.week);
    const facultyId = req.query.facultyId ? String(req.query.facultyId) : null;
    const sessions = legacy.sessions.filter((s) => !s.demo && s.status === 'ended' && Date.parse(s.endedAt || s.createdAt) >= w.from && Date.parse(s.endedAt || s.createdAt) < w.to && (!facultyId || svc.facultyOf(s) === facultyId));
    const byTeacher = {};
    for (const s of sessions) {
      const rep = svc.buildReport(s);
      const t = legacy.teachers.find((x) => x.id === s.teacherId) || {};
      const row = (byTeacher[s.teacherId] ||= { teacherId: s.teacherId, teacher: `${t.name || ''} ${t.surname || ''}`.trim(), facultyId: t.facultyId || null, lessons: 0, students: 0, totalScore: 0, bypass: 0, absent: 0 });
      row.lessons++; row.students += rep.students.length; row.totalScore += rep.students.reduce((a, x) => a + x.total, 0); row.bypass += rep.summary.bypassTotal; row.absent += rep.summary.absent;
    }
    const faculties = new Map(svc.users.faculties().map((f) => [f.id, f.name]));
    const rows = Object.values(byTeacher).map((x) => ({ ...x, faculty: faculties.get(x.facultyId) || '', averageScore: x.students ? Math.round(x.totalScore / x.students) : 0 }));
    const out = { weekFrom: w.fromDay, weekTo: w.toDay, lessons: sessions.length, rows };
    if (req.query.format === 'csv') {
      const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
      const csv = '﻿' + ['Fakultet,O\'qituvchi,Darslar,Talabalar,O\'rtacha ball,Bypass,Qatnashmagan', ...rows.map((x) => [x.faculty, x.teacher, x.lessons, x.students, x.averageScore, x.bypass, x.absent].map(cell).join(','))].join('\r\n') + '\r\n';
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="edufocus-haftalik-${w.fromDay}.csv"` });
      return res.send(csv);
    }
    res.json(out);
  });

  r.get('/admin/deletion-requests', auth, requireAdmin, (req, res) => res.json({ requests: helpers.sql.all('SELECT * FROM deletion_requests ORDER BY created_at DESC LIMIT 200') }));
  r.post('/admin/deletion-requests/:id/resolve', auth, requireAdmin, (req, res) => {
    const row = helpers.sql.get('SELECT * FROM deletion_requests WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Topilmadi' });
    let anonymized = 0;
    if (req.body && req.body.execute) {
      for (const s of legacy.sessions) {
        if (row.session_code && s.id !== row.session_code) continue;
        for (const st of s.students) if (String(st.name || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase() === row.name_norm && svc.anonymizeStudent(s, st)) anonymized++;
      }
      if (anonymized) helpers.saveSessions();
    }
    helpers.sql.run('UPDATE deletion_requests SET status = ?, resolved_at = ?, resolved_by = ?, note = ? WHERE id = ?', [anonymized || !(req.body && req.body.execute) ? 'done' : 'rejected', Date.now(), req.teacherId, String((req.body && req.body.note) || '').slice(0, 200), row.id]);
    ok(res, { anonymized });
  });

  return r;
}

module.exports = { createRouter, isoWeekRange };
