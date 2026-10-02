// Guruh ro'yxatlari (CSV) va qurilmaga bir martalik bog'lash.
const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const normName = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim();

/** CSV matnini [{fullName, hemisId}] ga aylantiradi. ',' ';' va tab ajratgichlari, BOM, qo'shtirnoqlar qo'llab-quvvatlanadi. */
function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = [';', '\t', ','].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',');
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') inQ = false; else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  if (!rows.length) return { students: [], errors: ["Fayl bo'sh"] };

  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[.\s_-]/g, ''));
  const nameIdx = head.findIndex((h) => ['fish', 'fio', 'fullname', 'name', 'talaba', 'ism', 'фио', 'фиш'].includes(h));
  const hemisIdx = head.findIndex((h) => h.includes('hemis') || h === 'id' || h === 'talabaid');
  const hasHeader = nameIdx >= 0;
  const ni = hasHeader ? nameIdx : 0;
  const hi = hasHeader ? hemisIdx : (rows[0].length > 1 ? 1 : -1);

  const students = [], errors = [], seen = new Set();
  rows.slice(hasHeader ? 1 : 0).forEach((r, i) => {
    const fullName = normName(r[ni]);
    if (fullName.length < 3) { errors.push(`${i + 1}-qator: F.I.Sh bo'sh yoki juda qisqa`); return; }
    const key = fullName.toLowerCase();
    if (seen.has(key)) { errors.push(`${i + 1}-qator: takroriy ism «${fullName}»`); return; }
    seen.add(key);
    students.push({ fullName, hemisId: hi >= 0 ? (String(r[hi] || '').trim() || null) : null });
  });
  if (students.length > 500) return { students: [], errors: ["Bitta guruhda 500 tadan ko'p talaba bo'lishi mumkin emas"] };
  return { students, errors };
}

const create = (db, uuid) => ({
  createGroup({ teacherId, facultyId, name, students }) {
    const id = uuid();
    db.transaction(() => {
      db.run('INSERT INTO roster_groups (id, teacher_id, faculty_id, name, created_at) VALUES (?, ?, ?, ?, ?)', [id, teacherId, facultyId || null, name, Date.now()]);
      for (const s of students) db.run('INSERT INTO roster_students (id, group_id, full_name, hemis_id, created_at) VALUES (?, ?, ?, ?, ?)', [uuid(), id, s.fullName, s.hemisId, Date.now()]);
    });
    return id;
  },
  groupsFor(teacherId, isAdmin) {
    const sql = `SELECT g.*, (SELECT COUNT(*) FROM roster_students s WHERE s.group_id = g.id) AS students,
                 (SELECT COUNT(*) FROM device_bindings b JOIN roster_students s ON s.id = b.roster_student_id WHERE s.group_id = g.id) AS bound
                 FROM roster_groups g ${isAdmin ? '' : 'WHERE g.teacher_id = ?'} ORDER BY g.created_at DESC`;
    return db.all(sql, isAdmin ? [] : [teacherId]);
  },
  group(id) { return db.get('SELECT * FROM roster_groups WHERE id = ?', [id]); },
  deleteGroup(id) { db.run('DELETE FROM roster_groups WHERE id = ?', [id]); },
  students(groupId) {
    return db.all(`SELECT s.id, s.full_name, s.hemis_id, b.bound_at, b.platform FROM roster_students s
                   LEFT JOIN device_bindings b ON b.roster_student_id = s.id WHERE s.group_id = ? ORDER BY s.full_name`, [groupId]);
  },
  student(id) { return db.get('SELECT * FROM roster_students WHERE id = ?', [id]); },
  /** Talabaning ushbu qurilmaga bog'langan yozuvi (guruh ichida). */
  boundTo(groupId, deviceKey) {
    return db.get(`SELECT s.id, s.full_name FROM roster_students s JOIN device_bindings b ON b.roster_student_id = s.id
                   WHERE s.group_id = ? AND b.device_hash = ?`, [groupId, sha(deviceKey)]);
  },
  isBound(studentId) { return !!db.get('SELECT 1 AS x FROM device_bindings WHERE roster_student_id = ?', [studentId]); },
  bind(studentId, deviceKey, platform) {
    const h = sha(deviceKey), now = Date.now();
    const res = db.run(`INSERT INTO device_bindings (roster_student_id, device_hash, platform, bound_at, last_seen) VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT (roster_student_id) DO NOTHING`, [studentId, h, platform || null, now, now]);
    return res.changes > 0;   // false = boshqa qurilma allaqachon bog'lagan
  },
  touch(studentId) { db.run('UPDATE device_bindings SET last_seen = ? WHERE roster_student_id = ?', [Date.now(), studentId]); },
  hasBindingWith(studentId, deviceKey) {
    return !!db.get('SELECT 1 AS x FROM device_bindings WHERE roster_student_id = ? AND device_hash = ?', [studentId, sha(deviceKey)]);
  },
  resetBinding(studentId) { return db.run('DELETE FROM device_bindings WHERE roster_student_id = ?', [studentId]).changes > 0; },
  removeBindingsByDevice(deviceKey) { return db.run('DELETE FROM device_bindings WHERE device_hash = ?', [sha(deviceKey)]).changes; },
});

module.exports = { create, parseCsv, sha, normName };
