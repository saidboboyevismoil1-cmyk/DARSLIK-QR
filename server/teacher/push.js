// Push yuborish: APNs (HTTP/2, .p8 kalit) va FCM (HTTP v1, service account). Kalit bo'lmasa — o'chiq.
// PUSH_MODE=mock — testlar: yuborilganlar `sent` massivida. Matnlar ustozning tilida (uz/ru/en).
const fs = require('fs');
const http2 = require('http2');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TEXT = {
  bypass: { uz: (d) => ['Qoidabuzarlik', `${d.studentName || 'Talaba'} ilovadan chiqdi`], ru: (d) => ['Нарушение', `${d.studentName || 'Студент'} вышел из приложения`], en: (d) => ['Violation', `${d.studentName || 'A student'} left the app`] },
  exemption: { uz: (d) => ['Himoyasiz kirish so\'rovi', `${d.studentName || 'Talaba'}: ruxsat so'ramoqda`], ru: (d) => ['Запрос на вход без защиты', `${d.studentName || 'Студент'} просит разрешение`], en: (d) => ['Unprotected join request', `${d.studentName || 'A student'} asks for permission`] },
  emergency_exit: { uz: (d) => ['Favqulodda chiqish', `${d.studentName || 'Talaba'} chiqishni so'ramoqda`], ru: (d) => ['Экстренный выход', `${d.studentName || 'Студент'} просит выйти`], en: (d) => ['Emergency exit', `${d.studentName || 'A student'} asks to leave`] },
};
const textFor = (kind, data, locale) => {
  const t = TEXT[kind] || TEXT.bypass; const l = ['uz', 'ru', 'en'].includes(locale) ? locale : 'uz';
  return t[l](data || {});
};

function createPush({ config, sql, log = console.log }) {
  const mode = config.push.mode;
  const sent = [];
  let apnsSession = null, apnsJwt = null, apnsJwtAt = 0, fcmAuth = null;

  const apnsReady = () => !!(config.push.apnsKeyId && config.push.apnsKeyPath && config.attestation.appleTeamId && fs.existsSync(config.push.apnsKeyPath));
  const fcmReady = () => !!(config.push.firebaseServiceAccountPath && fs.existsSync(config.push.firebaseServiceAccountPath));

  function apnsToken() {
    if (apnsJwt && Date.now() - apnsJwtAt < 40 * 60000) return apnsJwt;
    apnsJwt = jwt.sign({ iss: config.attestation.appleTeamId, iat: Math.floor(Date.now() / 1000) }, fs.readFileSync(config.push.apnsKeyPath, 'utf8'), { algorithm: 'ES256', header: { alg: 'ES256', kid: config.push.apnsKeyId } });
    apnsJwtAt = Date.now(); return apnsJwt;
  }
  function apnsSend(token, payload) {
    return new Promise((resolve) => {
      const host = config.push.apnsProduction ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
      if (!apnsSession || apnsSession.closed || apnsSession.destroyed) { apnsSession = http2.connect(host); apnsSession.on('error', () => { apnsSession = null; }); }
      const req = apnsSession.request({ ':method': 'POST', ':path': `/3/device/${token}`, authorization: `bearer ${apnsToken()}`, 'apns-topic': config.push.apnsTopic, 'apns-push-type': 'alert', 'apns-priority': '10' });
      let status = 0, body = '';
      req.on('response', (h) => { status = h[':status']; });
      req.on('data', (c) => { body += c; });
      req.on('end', () => resolve({ ok: status === 200, status, body }));
      req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message }));
      req.setTimeout(10000, () => { req.close(); resolve({ ok: false, status: 0, body: 'timeout' }); });
      req.end(JSON.stringify(payload));
    });
  }
  async function fcmAccessToken() {
    if (fcmAuth && fcmAuth.exp > Date.now() + 60000) return fcmAuth;
    const sa = JSON.parse(fs.readFileSync(config.push.firebaseServiceAccountPath, 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }, sa.private_key, { algorithm: 'RS256' });
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    const j = await r.json();
    fcmAuth = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000, project: sa.project_id };
    return fcmAuth;
  }
  async function fcmSend(token, data) {
    try {
      const a = await fcmAccessToken();
      // Faqat data: Android ilovasi o'zi bildirishnoma + "Tasdiqlash/Rad etish" tugmalarini chizadi
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project}/messages:send`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH' } } }) });
      return { ok: r.ok, status: r.status, body: r.ok ? '' : await r.text() };
    } catch (e) { return { ok: false, status: 0, body: e.message }; }
  }

  /** kind: bypass | exemption | emergency_exit. data: {studentName, sessionId, requestId, sessionName} */
  async function notify(userId, kind, data) {
    if (mode === 'off') return { sent: 0 };
    const tokens = sql.all('SELECT * FROM push_tokens WHERE user_id = ?', [userId]);
    let n = 0;
    for (const t of tokens) {
      const [title, body] = textFor(kind, data, t.locale);
      const custom = { kind, sessionId: String(data.sessionId || ''), requestId: String(data.requestId || ''), actionable: kind === 'exemption' || kind === 'emergency_exit' ? '1' : '0' };
      if (mode === 'mock') { sent.push({ userId, platform: t.platform, token: t.token, kind, title, body, custom }); n++; continue; }
      let res = null;
      if (t.platform === 'ios' && apnsReady()) res = await apnsSend(t.token, { aps: { alert: { title, body }, sound: 'default', category: custom.actionable === '1' ? 'EF_REQUEST' : 'EF_INFO', 'thread-id': custom.sessionId }, ...custom });
      else if (t.platform === 'android' && fcmReady()) res = await fcmSend(t.token, { title, body, ...custom });
      if (res) {
        if (res.ok) n++;
        else if (res.status === 410 || /Unregistered|BadDeviceToken|NOT_FOUND|UNREGISTERED/.test(res.body || '')) sql.run('DELETE FROM push_tokens WHERE id = ?', [t.id]);
        else log('push xatosi:', t.platform, res.status, String(res.body).slice(0, 120));
      }
    }
    return { sent: n };
  }
  return { notify, sent, mode, ready: () => ({ apns: apnsReady(), fcm: fcmReady() }), close() { try { apnsSession && apnsSession.close(); } catch { /* */ } } };
}
module.exports = { createPush, textFor };
