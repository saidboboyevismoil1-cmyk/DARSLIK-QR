// Ustozlar/adminlar. Xotiradagi server.js `db.teachers` bilan sinxron saqlanadi (qayta ishga tushganda yo'qolmasin).
const create = (db) => ({
  upsert(t, role = 'teacher') {
    db.run(`INSERT INTO users (id, email, name, surname, phone, school, subject, password_hash, role, faculty_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, surname = excluded.surname, phone = excluded.phone,
              school = excluded.school, subject = excluded.subject, password_hash = excluded.password_hash`,
      [t.id, t.email, t.name || '', t.surname || '', t.phone || '', t.school || '', t.subject || '', t.password, t.role || role, t.facultyId || null, Date.parse(t.createdAt) || Date.now()]);
  },
  remove(id) { db.run('DELETE FROM users WHERE id = ?', [id]); },
  setPassword(id, hash) { return db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]).changes > 0; },
  all() { return db.all('SELECT * FROM users ORDER BY created_at'); },
  byId(id) { return db.get('SELECT * FROM users WHERE id = ?', [id]); },
  countAdmins() { return db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").n; },
  setRole(id, role) { return db.run('UPDATE users SET role = ? WHERE id = ?', [role, id]).changes > 0; },
  setFaculty(id, facultyId) { return db.run('UPDATE users SET faculty_id = ? WHERE id = ?', [facultyId || null, id]).changes > 0; },
  faculties() { return db.all('SELECT * FROM faculties ORDER BY name'); },
  addFaculty(id, name) { db.run('INSERT INTO faculties (id, name, created_at) VALUES (?, ?, ?)', [id, name, Date.now()]); },
  renameFaculty(id, name) { return db.run('UPDATE faculties SET name = ? WHERE id = ?', [name, id]).changes > 0; },
  deleteFaculty(id) {
    db.transaction(() => {
      db.run('UPDATE users SET faculty_id = NULL WHERE faculty_id = ?', [id]);
      db.run("DELETE FROM settings WHERE scope = 'faculty' AND scope_id = ?", [id]);
      db.run('DELETE FROM faculties WHERE id = ?', [id]);
    });
  },
});
module.exports = { create };
