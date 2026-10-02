// Himoyasiz kirish ("exemption") va favqulodda chiqish so'rovlari.
const crypto = require('crypto');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const EXEMPTION_TTL_MS = 30 * 60 * 1000;

const create = (db, uuid) => ({
  EXEMPTION_TTL_MS,
  create({ sessionId, kind, studentId, studentName, reason, device }) {
    const id = uuid().slice(0, 12);
    const secret = crypto.randomBytes(18).toString('base64url');
    db.run(`INSERT INTO access_requests (id, session_id, kind, student_id, student_name, reason, device, status, secret_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, [id, sessionId, kind, studentId || null, studentName || null, reason || null, device || null, sha(secret), Date.now()]);
    return { id, secret };
  },
  get(id) { return db.get('SELECT * FROM access_requests WHERE id = ?', [id]); },
  pending(sessionId) { return db.all("SELECT id, kind, student_id, student_name, reason, device, created_at FROM access_requests WHERE session_id = ? AND status = 'pending' ORDER BY created_at", [sessionId]); },
  pendingCount(sessionId, kind, studentKey) {
    return db.get("SELECT COUNT(*) AS n FROM access_requests WHERE session_id = ? AND kind = ? AND status = 'pending' AND COALESCE(student_id, student_name) = ?", [sessionId, kind, studentKey]).n;
  },
  secretMatches(row, secret) { return !!row && !!secret && row.secret_hash === sha(secret); },
  decide(id, approve, by) {
    return db.run("UPDATE access_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'", [approve ? 'approved' : 'denied', Date.now(), by || null, id]).changes > 0;
  },
  /** Tasdiqlangan "himoyasiz kirish" kalitini bir marta ishlatish. */
  consumeExemption(token, sessionId) {
    const [id, secret] = String(token || '').split('.');
    const row = id && db.get('SELECT * FROM access_requests WHERE id = ?', [id]);
    if (!row || row.kind !== 'exemption' || row.session_id !== sessionId || row.status !== 'approved' || row.consumed_at) return null;
    if (!this.secretMatches(row, secret) || Date.now() - row.decided_at > EXEMPTION_TTL_MS) return null;
    db.run('UPDATE access_requests SET consumed_at = ? WHERE id = ?', [Date.now(), id]);
    return row;
  },
  deleteStudent(sessionId, studentId) { return db.run('DELETE FROM access_requests WHERE session_id = ? AND student_id = ?', [sessionId, studentId]).changes; },
});
module.exports = { create, sha };
