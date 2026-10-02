// O'qituvchi paneli/ilovasi API'si: bosh sahifa, dars tarixi, QR, guruhlar (CSV), materiallar kutubxonasi, haftalik hisobot.
const express = require('express');
const { parseCsv } = require('../repos/rosters');

function weekRange(week) {
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
  const y = monday.getUTCFullYear();
  return { from: monday.getTime(), to: end.getTime(), fromDay: monday.toISOString().slice(0, 10), toDay: new Date(end.getTime() - 1).toISOString().slice(0, 10), y };
}

function createApi({ config, legacy, svc, sql, auth, helpers, QRCode }) {
  const r = express.Router();
  const mine = (req) => legacy.sessions.filter((s) => !s.demo && (s.teacherId === req.teacherId));
  const ownedSession = (req, res) => {
    const s = svc.sessionById(req.params.id);
    if (!s || s.demo) { res.status(404).json({ error: 'Dars topilmadi' }); return null; }
    if (!svc.canManage(req.teacher, s)) { res.status(403).json({ error: 'Bu dars sizniki emas' }); return null; }
    return s;
  };
  const groupName = (id) => { const g = id && svc.rosters.group(id); return g ? g.name : ''; };
  const summary = (s, withScore) => {
    const o = { id: s.id, name: s.name, subject: s.subject || '', status: s.status, createdAt: s.createdAt, endedAt: s.endedAt || null, duration: s.duration || 45,
      groupId: s.rosterGroupId || null, groupName: groupName(s.rosterGroupId), students: s.students.length, protection: s.protection || 'optional', locked: !!s.locked };
    if (withScore) {
      try { const rep = svc.buildReport(s); o.averageScore = rep.summary.averageTotal; o.bypass = rep.summary.bypassTotal; o.absent = rep.summary.absent; } catch { /* hisobot tayyor emas */ }
    }
    return o;
  };
  const ok = (res, extra = {}) => res.json({ success: true, ...extra });

  // ---------------------------------------------------------------- bosh sahifa
  r.get('/teacher/home', auth, (req, res) => {
    const since = Number(req.query.since) || (Date.now() - (Date.now() % 86400000));
    const all = mine(req).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const active = all.find((s) => s.status === 'active') || null;
    const today = all.filter((s) => Date.parse(s.createdAt) >= since).map((s) => summary(s, s.status === 'ended'));
    const recent = all.filter((s) => s.status === 'ended').slice(0, 5).map((s) => summary(s, true));
    res.json({ teacher: { id: req.teacher.id, name: req.teacher.name, surname: req.teacher.surname, role: req.role }, active: active ? summary(active) : null, today, recent, groups: svc.rosters.groupsFor(req.teacherId, false).length });
  });

  r.get('/teacher/sessions', auth, (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const status = ['active', 'ended'].includes(req.query.status) ? req.query.status : null;
    const list = mine(req).filter((s) => !status || s.status === status).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit);
    res.json({ sessions: list.map((s) => summary(s, s.status === 'ended')) });
  });

  r.get('/teacher/sessions/:id', auth, (req, res) => { const s = ownedSession(req, res); if (s) res.json({ session: { ...summary(s, s.status === 'ended'), createdAtMs: Date.parse(s.createdAt), endsAtMs: svc.endsAtMs ? svc.endsAtMs(s) : Date.parse(s.createdAt) + (s.duration || 45) * 60000, serverTime: Date.now() } }); });

  r.get('/teacher/sessions/:id/qr', auth, async (req, res) => {
    const s = ownedSession(req, res); if (!s) return;
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const base = config.publicBaseUrl || `${proto}://${req.get('host')}`;
    const url = `${base}/student.html?session=${s.id}`;
    const qr = await QRCode.toDataURL(url, { width: 640, margin: 2, color: { dark: '#0F172A', light: '#FFFFFF' } });
    res.json({ code: s.id, url, qr, name: s.name, status: s.status });
  });

  // ---------------------------------------------------------------- guruhlar
  const groupOut = (g) => ({ id: g.id, name: g.name, subject: g.subject || '', students: g.students, bound: g.bound, createdAt: g.created_at });
  r.get('/teacher/groups', auth, (req, res) => res.json({ groups: svc.rosters.groupsFor(req.teacherId, false).map(groupOut) }));

  r.post('/teacher/groups', auth, (req, res) => {
    const { name, subject, csv } = req.body || {};
    const gname = String(name || '').trim().slice(0, 80);
    if (!gname) return res.status(400).json({ error: 'Guruh nomini kiriting', code: 'name_required' });
    let students = [], errors = [];
    if (csv && String(csv).trim()) {
      const p = parseCsv(csv); students = p.students; errors = p.errors;
      if (!students.length) return res.status(400).json({ error: errors[0] || "Ro'yxat bo'sh", errors });
    }
    const id = svc.rosters.createEmptyGroup({ teacherId: req.teacherId, facultyId: req.teacher.facultyId, name: gname, subject: String(subject || '').trim().slice(0, 80) });
    const out = students.length ? svc.rosters.addStudents(id, students) : { added: 0, skipped: 0 };
    ok(res, { id, added: out.added, errors });
  });

  const ownedGroup = (req, res) => {
    const g = svc.rosters.group(req.params.id);
    if (!g || g.teacher_id !== req.teacherId) { res.status(404).json({ error: 'Guruh topilmadi' }); return null; }
    return g;
  };
  r.put('/teacher/groups/:id', auth, (req, res) => {
    const g = ownedGroup(req, res); if (!g) return;
    const name = String((req.body && req.body.name) || g.name).trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Guruh nomini kiriting' });
    svc.rosters.updateGroup(g.id, { name, subject: String((req.body && req.body.subject) ?? g.subject ?? '').trim().slice(0, 80) });
    ok(res);
  });

  /** CSV bilan talabalar qo'shish ('append') yoki butun ro'yxatni almashtirish ('replace'). Xatolar qator raqami bilan qaytariladi. */
  r.post('/teacher/groups/:id/students', auth, (req, res) => {
    const g = ownedGroup(req, res); if (!g) return;
    const p = parseCsv(req.body && req.body.csv);
    if (!p.students.length) return res.status(400).json({ error: p.errors[0] || "Ro'yxat bo'sh", errors: p.errors });
    if (req.body && req.body.mode === 'replace') svc.rosters.clearStudents(g.id);
    const out = svc.rosters.addStudents(g.id, p.students);
    ok(res, { added: out.added, skipped: out.skipped, errors: p.errors });
  });

  // ---------------------------------------------------------------- materiallar kutubxonasi
  const matOut = (m) => ({ id: m.id, kind: m.kind, title: m.title, url: m.url, fileName: m.file_name, fileSize: m.file_size, fileType: m.file_type, fileLabel: m.file_label, fileColor: m.file_color, createdAt: m.created_at });
  r.get('/teacher/materials', auth, (req, res) => res.json({ materials: sql.all('SELECT * FROM teacher_materials WHERE user_id = ? ORDER BY created_at DESC LIMIT 300', [req.teacherId]).map(matOut) }));
  r.post('/teacher/materials', auth, (req, res) => {
    const b = req.body || {};
    const kind = b.kind === 'link' ? 'link' : 'file';
    const title = String(b.title || b.fileName || '').trim().slice(0, 120);
    const url = String(b.url || '').trim().slice(0, 1000);
    if (!title) return res.status(400).json({ error: 'Nom kiriting' });
    if (kind === 'link' && !/^https?:\/\/\S+$/i.test(url)) return res.status(400).json({ error: "To'g'ri havola kiriting (https://…)" });
    if (kind === 'file' && !/^\/uploads\/[\w.\-Ѐ-ӿ]+$/.test(url)) return res.status(400).json({ error: 'Fayl topilmadi' });
    const id = helpers.uuid();
    sql.run('INSERT INTO teacher_materials (id, user_id, kind, title, url, file_name, file_size, file_type, file_label, file_color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, req.teacherId, kind, title, url, String(b.fileName || '').slice(0, 200), String(b.fileSize || '').slice(0, 20), String(b.fileType || '').slice(0, 20), String(b.fileLabel || '').slice(0, 60), String(b.fileColor || '').slice(0, 20), Date.now()]);
    ok(res, { id });
  });
  r.delete('/teacher/materials/:id', auth, (req, res) => {
    const n = sql.run('DELETE FROM teacher_materials WHERE id = ? AND user_id = ?', [req.params.id, req.teacherId]).changes;
    n ? ok(res) : res.status(404).json({ error: 'Material topilmadi' });
  });

  // ---------------------------------------------------------------- haftalik hisobot (o'qituvchining o'zi uchun): guruh va darslar kesimida
  r.get('/teacher/reports/weekly', auth, (req, res) => {
    const w = weekRange(req.query.week);
    const sessions = mine(req).filter((s) => s.status === 'ended' && Date.parse(s.endedAt || s.createdAt) >= w.from && Date.parse(s.endedAt || s.createdAt) < w.to)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const lessons = sessions.map((s) => summary(s, true));
    const byGroup = {};
    for (const l of lessons) {
      const k = l.groupId || '-';
      const g = (byGroup[k] ||= { groupId: l.groupId, group: l.groupName || '', lessons: 0, students: 0, scoreSum: 0, bypass: 0, absent: 0 });
      g.lessons++; g.students += l.students; g.scoreSum += (l.averageScore || 0) * l.students; g.bypass += l.bypass || 0; g.absent += l.absent || 0;
    }
    const groups = Object.values(byGroup).map((g) => ({ groupId: g.groupId, group: g.group, lessons: g.lessons, students: g.students, averageScore: g.students ? Math.round(g.scoreSum / g.students) : 0, bypass: g.bypass, absent: g.absent }));
    const out = { weekFrom: w.fromDay, weekTo: w.toDay, groups, lessons };
    if (req.query.format === 'csv') {
      const cell = (v) => (/[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
      const csv = '﻿' + ['Guruh,Dars,Sana,Talabalar,O\'rtacha ball,Chetlanish,Qatnashmagan', ...lessons.map((l) => [l.groupName || '-', l.name, (l.createdAt || '').slice(0, 10), l.students, l.averageScore ?? '', l.bypass ?? '', l.absent ?? ''].map(cell).join(','))].join('\r\n');
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="edufocus-haftalik-${w.fromDay}.csv"` });
      return res.send(csv);
    }
    res.json(out);
  });

  return r;
}
module.exports = { createApi };
