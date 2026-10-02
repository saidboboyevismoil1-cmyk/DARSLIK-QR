// Himoya hodisalari, talaba ko'rsatkichlari va test natijalari.
const create = (db) => ({
  addEvent({ sessionId, studentId, type, severity, level, data, ts }) {
    return db.run('INSERT INTO lock_events (session_id, student_id, type, severity, level, data, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [sessionId, studentId, type, severity, level || null, data ? JSON.stringify(data) : null, ts || Date.now()]).lastId;
  },
  events(sessionId, { limit = 200, sinceId = 0, studentId = null } = {}) {
    const rows = studentId
      ? db.all('SELECT * FROM lock_events WHERE session_id = ? AND student_id = ? AND id > ? ORDER BY id DESC LIMIT ?', [sessionId, studentId, sinceId, limit])
      : db.all('SELECT * FROM lock_events WHERE session_id = ? AND id > ? ORDER BY id DESC LIMIT ?', [sessionId, sinceId, limit]);
    return rows.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null })).reverse();
  },
  upsertStats(s) {
    db.run(`INSERT INTO student_stats (session_id, student_id, student_name, roster_student_id, level, joined_at, protected_ms, unprotected_ms, offline_ms, assumed_ms, free_ms, bypass_count, focus_zero, absent, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (session_id, student_id) DO UPDATE SET level = excluded.level, protected_ms = excluded.protected_ms, unprotected_ms = excluded.unprotected_ms,
              offline_ms = excluded.offline_ms, assumed_ms = excluded.assumed_ms, free_ms = excluded.free_ms, bypass_count = excluded.bypass_count, focus_zero = excluded.focus_zero,
              absent = excluded.absent, updated_at = excluded.updated_at`,
      [s.sessionId, s.studentId, s.name || null, s.rosterStudentId || null, s.level || null, s.joinedAt, Math.round(s.ms.protected), Math.round(s.ms.unprotected),
        Math.round(s.ms.offline), Math.round(s.ms.assumed), Math.round(s.ms.free || 0), s.bypassCount || 0, s.focusZero ? 1 : 0, s.absent ? 1 : 0, Date.now()]);
  },
  stats(sessionId) { return db.all('SELECT * FROM student_stats WHERE session_id = ?', [sessionId]); },
  addQuiz({ sessionId, quizId, title, questions, sentAt }) {
    db.run('INSERT INTO session_quizzes (session_id, quiz_id, title, questions, sent_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', [sessionId, quizId, title || '', questions || 0, sentAt || Date.now()]);
  },
  quizzes(sessionId) { return db.all('SELECT * FROM session_quizzes WHERE session_id = ? ORDER BY sent_at', [sessionId]); },
  addQuizResult({ sessionId, quizId, studentId, correct, total, pct }) {
    db.run('INSERT INTO quiz_results (session_id, quiz_id, student_id, correct, total, pct, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [sessionId, quizId, studentId, correct, total, pct, Date.now()]);
  },
  quizResults(sessionId) { return db.all('SELECT * FROM quiz_results WHERE session_id = ?', [sessionId]); },
  deleteStudent(sessionId, studentId) {
    let n = 0;
    for (const t of ['lock_events', 'student_stats', 'quiz_results']) n += db.run(`DELETE FROM ${t} WHERE session_id = ? AND student_id = ?`, [sessionId, studentId]).changes;
    return n;
  },
  purgeSession(sessionId) {
    for (const t of ['lock_events', 'student_stats', 'quiz_results', 'session_quizzes', 'access_requests']) db.run(`DELETE FROM ${t} WHERE session_id = ?`, [sessionId]);
  },
});
module.exports = { create };
