// O'qituvchi paneli/ilovasi uchun server qismi: refresh tokenlar, parolni tiklash, profil, hisobni o'chirish, push tokenlar.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { rateLimitKeyed } = require('../security');
const { createMailer } = require('./mailer');
const { createPush } = require('./push');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rnd = () => crypto.randomBytes(32).toString('base64url');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function init({ app, config, legacy, sql, authMiddleware, helpers, users, rosters, onDeleteData }) {
  const mailer = createMailer(config);
  const push = createPush({ config, sql });
  const day = 86400000;
  const publicTeacher = (t) => ({ id: t.id, name: t.name, surname: t.surname, email: t.email, phone: t.phone, school: t.school, subject: t.subject, role: t.role || 'teacher', facultyId: t.facultyId || null });

  // Kirishga urinishlar: IP+email bo'yicha 8 ta / 10 daqiqa va umumiy IP bo'yicha 60 ta / 10 daqiqa
  const emailKey = (req) => `${req.ip}|${String((req.body && req.body.email) || '').toLowerCase().slice(0, 120)}`;
  const loginLimit = rateLimitKeyed({ windowMs: 600000, max: 8, name: 'login', key: emailKey });
  const loginIpLimit = rateLimitKeyed({ windowMs: 600000, max: 60, name: 'loginip', key: (req) => req.ip });
  const registerLimit = rateLimitKeyed({ windowMs: 3600000, max: 10, name: 'register', key: (req) => req.ip });
  const forgotLimit = rateLimitKeyed({ windowMs: 3600000, max: 5, name: 'forgot', key: emailKey });
  const refreshLimit = rateLimitKeyed({ windowMs: 60000, max: 30, name: 'refresh', key: (req) => req.ip });

  // ---------------------------------------------------------------- tokenlar
  function accessToken(t) { return jwt.sign({ id: t.id, email: t.email }, config.jwtSecret, { expiresIn: config.accessTokenTtl }); }
  function issueTokens(t, req, family) {
    const refresh = rnd(), id = helpers.uuid(), now = Date.now();
    sql.run('INSERT INTO refresh_tokens (id, user_id, family, token_hash, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, t.id, family || helpers.uuid(), sha(refresh), now, now + config.refreshTokenDays * day, String((req && req.headers && req.headers['user-agent']) || '').slice(0, 160)]);
    return { token: accessToken(t), refreshToken: refresh, refreshExpiresAt: now + config.refreshTokenDays * day, _id: id };
  }
  const strip = (o) => { const { _id, ...r } = o; return r; };
  /** Kirish/ro'yxatdan o'tishdan keyin chaqiriladi. */
  const login = (t, req) => strip(issueTokens(t, req));

  app.post('/api/auth/refresh', refreshLimit, (req, res) => {
    const raw = String((req.body && req.body.refreshToken) || '');
    const row = raw ? sql.get('SELECT * FROM refresh_tokens WHERE token_hash = ?', [sha(raw)]) : null;
    if (!row) return res.status(401).json({ error: 'Qayta kiring', code: 'refresh_invalid' });
    if (row.revoked_at) {                      // ishlatilgan token qayta keldi → o'g'irlangan bo'lishi mumkin: butun oilani bekor qilamiz
      sql.run('UPDATE refresh_tokens SET revoked_at = ? WHERE family = ? AND revoked_at IS NULL', [Date.now(), row.family]);
      return res.status(401).json({ error: 'Qayta kiring', code: 'refresh_reused' });
    }
    if (row.expires_at < Date.now()) return res.status(401).json({ error: 'Seans muddati tugagan. Qayta kiring', code: 'refresh_expired' });
    const t = legacy.teachers.find((x) => x.id === row.user_id);
    if (!t) return res.status(401).json({ error: 'Foydalanuvchi topilmadi', code: 'refresh_invalid' });
    const next = issueTokens(t, req, row.family);
    sql.run('UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ?', [Date.now(), next._id, row.id]);
    res.json({ success: true, ...strip(next), teacher: publicTeacher(t) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const raw = String((req.body && req.body.refreshToken) || '');
    const row = raw ? sql.get('SELECT * FROM refresh_tokens WHERE token_hash = ?', [sha(raw)]) : null;
    if (row) sql.run('UPDATE refresh_tokens SET revoked_at = ? WHERE family = ? AND revoked_at IS NULL', [Date.now(), row.family]);
    const pt = req.body && req.body.pushToken;
    if (pt) sql.run('DELETE FROM push_tokens WHERE token = ?', [String(pt)]);
    res.json({ success: true });
  });

  // ---------------------------------------------------------------- parolni tiklash
  app.post('/api/auth/forgot', forgotLimit, async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    // Har doim bir xil javob (email mavjudligini oshkor qilmaymiz)
    res.json({ success: true, message: "Agar bu email ro'yxatdan o'tgan bo'lsa, tiklash havolasi yuborildi" });
    const t = EMAIL_RE.test(email) && legacy.teachers.find((x) => String(x.email).toLowerCase() === email);
    if (!t) return;
    const token = rnd(), now = Date.now();
    sql.run('DELETE FROM password_resets WHERE user_id = ?', [t.id]);
    sql.run('INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [helpers.uuid(), t.id, sha(token), now, now + 30 * 60000]);
    const base = config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/teacher/#/reset?token=${token}`;
    try {
      await mailer.send({ to: t.email, subject: 'EduFocus: parolni tiklash / Сброс пароля / Password reset',
        text: `Parolni tiklash uchun havola (30 daqiqa amal qiladi):\n${link}\n\nСсылка для сброса пароля (30 минут):\n${link}\n\nPassword reset link (valid 30 minutes):\n${link}\n\nAgar bu siz bo'lmasangiz, xatni e'tiborsiz qoldiring.` });
    } catch (e) { console.error('email yuborilmadi:', e.message); }
  });

  app.post('/api/auth/reset', refreshLimit, async (req, res) => {
    const { token, password } = req.body || {};
    if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: "Parol kamida 8 belgi bo'lsin" });
    const row = token ? sql.get('SELECT * FROM password_resets WHERE token_hash = ?', [sha(token)]) : null;
    if (!row || row.used_at || row.expires_at < Date.now()) return res.status(400).json({ error: 'Havola yaroqsiz yoki muddati tugagan', code: 'reset_invalid' });
    const t = legacy.teachers.find((x) => x.id === row.user_id);
    if (!t) return res.status(400).json({ error: 'Havola yaroqsiz', code: 'reset_invalid' });
    t.password = await bcrypt.hash(password, 10);
    users.setPassword(t.id, t.password);
    sql.run('UPDATE password_resets SET used_at = ? WHERE id = ?', [Date.now(), row.id]);
    sql.run('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Date.now(), t.id]);   // barcha qurilmalardan chiqarish
    res.json({ success: true });
  });

  // ---------------------------------------------------------------- profil
  app.put('/api/profile', authMiddleware, (req, res) => {
    const b = req.body || {}, t = req.teacher;
    const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    if (b.name !== undefined) { if (!s(b.name, 60)) return res.status(400).json({ error: 'Ism kiriting' }); t.name = s(b.name, 60); }
    if (b.surname !== undefined) t.surname = s(b.surname, 60);
    if (b.phone !== undefined) t.phone = s(b.phone, 30);
    if (b.school !== undefined) t.school = s(b.school, 120);
    if (b.subject !== undefined) t.subject = s(b.subject, 80);
    users.upsert(t, t.role);
    res.json({ success: true, teacher: publicTeacher(t) });
  });

  app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (typeof newPassword !== 'string' || newPassword.length < 8) return res.status(400).json({ error: "Yangi parol kamida 8 belgi bo'lsin" });
    if (!(await bcrypt.compare(String(oldPassword || ''), req.teacher.password))) return res.status(403).json({ error: "Joriy parol noto'g'ri" });
    req.teacher.password = await bcrypt.hash(newPassword, 10);
    users.setPassword(req.teacher.id, req.teacher.password);
    sql.run('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Date.now(), req.teacher.id]);
    res.json({ success: true, ...login(req.teacher, req) });
  });

  // ---------------------------------------------------------------- hisobni o'chirish (App Store/Play talabi)
  app.delete('/api/account', authMiddleware, async (req, res) => {
    const t = req.teacher;
    if (!(await bcrypt.compare(String((req.body && req.body.password) || ''), t.password))) return res.status(403).json({ error: "Parol noto'g'ri" });
    if (t.role === 'admin' && users.countAdmins() <= 1) return res.status(409).json({ error: "Oxirgi administratorni o'chirib bo'lmaydi" });
    const stats = onDeleteData(t.id) || {};
    sql.run('DELETE FROM refresh_tokens WHERE user_id = ?', [t.id]);
    sql.run('DELETE FROM password_resets WHERE user_id = ?', [t.id]);
    sql.run('DELETE FROM push_tokens WHERE user_id = ?', [t.id]);
    users.remove(t.id);
    const i = legacy.teachers.findIndex((x) => x.id === t.id);
    if (i >= 0) legacy.teachers.splice(i, 1);
    res.json({ success: true, deleted: stats });
  });

  // ---------------------------------------------------------------- push tokenlar
  app.post('/api/push/register', authMiddleware, (req, res) => {
    const { platform, token, deviceId, locale } = req.body || {};
    if (!['ios', 'android'].includes(platform) || typeof token !== 'string' || token.length < 16 || token.length > 4096) return res.status(400).json({ error: "So'rov noto'g'ri" });
    const now = Date.now();
    sql.run(`INSERT INTO push_tokens (id, user_id, platform, token, device_id, locale, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (platform, token) DO UPDATE SET user_id = excluded.user_id, device_id = excluded.device_id, locale = excluded.locale, last_seen = excluded.last_seen`,
      [helpers.uuid(), req.teacher.id, platform, token, String(deviceId || '').slice(0, 80), ['uz', 'ru', 'en'].includes(locale) ? locale : 'uz', now, now]);
    res.json({ success: true });
  });
  app.delete('/api/push/register', authMiddleware, (req, res) => {
    sql.run('DELETE FROM push_tokens WHERE user_id = ? AND token = ?', [req.teacher.id, String((req.body && req.body.token) || '')]);
    res.json({ success: true });
  });
  if (config.push.mode === 'mock' && !config.isProd) {
    app.get('/api/_test/push', (req, res) => res.json({ sent: push.sent }));
    app.get('/api/_test/mail', (req, res) => res.json({ outbox: mailer.outbox }));
  }

  return { login, accessToken, push, mailer, limits: { login: loginLimit, loginIp: loginIpLimit, register: registerLimit }, close: () => push.close() };
}
module.exports = { init };
