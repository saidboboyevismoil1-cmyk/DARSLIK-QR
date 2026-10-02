// Qurilma/ilova haqiqiyligini tekshirish: iOS App Attest, Android Play Integrity, test uchun mock.
//   ATTESTATION_MODE: off (tekshirmaydi) | log (tekshiradi, rad etmaydi) | enforce (tekshiruvdan o'tmasa rad) | mock (testlar)
// Oqim: mijoz GET /api/lock/attest/challenge → nonce → platforma attestatsiyasi → student-join ichida yuboradi.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const NONCE_TTL_MS = 5 * 60 * 1000;
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const APPLE_ROOT_PEM = fs.readFileSync(path.join(__dirname, 'apple-app-attest-root.pem'), 'utf8');

// ---------- Challenge (nonce) ----------
function issueChallenge(db, sessionId) {
  const nonce = crypto.randomBytes(24).toString('base64url');
  db.run('INSERT INTO attest_challenges (nonce, session_id, created_at, used) VALUES (?, ?, ?, 0)', [nonce, sessionId || null, Date.now()]);
  db.run('DELETE FROM attest_challenges WHERE created_at < ?', [Date.now() - 24 * 3600 * 1000]);
  return nonce;
}
/** Bir martalik: yaroqli bo'lsa belgilab, true qaytaradi. */
function consumeChallenge(db, nonce, sessionId) {
  const row = db.get('SELECT * FROM attest_challenges WHERE nonce = ?', [String(nonce || '')]);
  if (!row || row.used || Date.now() - row.created_at > NONCE_TTL_MS) return false;
  if (row.session_id && sessionId && row.session_id !== sessionId) return false;
  return db.run('UPDATE attest_challenges SET used = 1 WHERE nonce = ? AND used = 0', [nonce]).changes === 1;
}

// ---------- Minimal CBOR dekoder (App Attest obyekti uchun yetarli) ----------
function cborDecode(buf) {
  let o = 0;
  const read = () => {
    const ib = buf[o++]; const major = ib >> 5; let ai = ib & 31;
    const len = () => {
      if (ai < 24) return ai;
      if (ai === 24) return buf[o++];
      if (ai === 25) { const v = buf.readUInt16BE(o); o += 2; return v; }
      if (ai === 26) { const v = buf.readUInt32BE(o); o += 4; return v; }
      throw new Error('cbor: katta uzunlik qo\'llab-quvvatlanmaydi');
    };
    const n = len();
    switch (major) {
      case 0: return n;
      case 1: return -1 - n;
      case 2: { const v = buf.subarray(o, o + n); o += n; return Buffer.from(v); }
      case 3: { const v = buf.subarray(o, o + n).toString('utf8'); o += n; return v; }
      case 4: { const a = []; for (let i = 0; i < n; i++) a.push(read()); return a; }
      case 5: { const m = {}; for (let i = 0; i < n; i++) { const k = read(); m[k] = read(); } return m; }
      default: throw new Error('cbor: qo\'llab-quvvatlanmaydigan tur');
    }
  };
  return read();
}

// ---------- Apple App Attest ----------
const APPLE_NONCE_OID = Buffer.from('06092a864886f763640802', 'hex');   // 1.2.840.113635.100.8.2

function readLen(b, o) { const f = b[o]; if (f < 0x80) return [f, o + 1]; const n = f & 0x7f; let v = 0; for (let i = 0; i < n; i++) v = (v << 8) | b[o + 1 + i]; return [v, o + 1 + n]; }
/** Sertifikatdagi Apple nonce kengaytmasidan 32 baytlik qiymatni oladi. */
function extractAppleNonce(certDer) {
  const i = certDer.indexOf(APPLE_NONCE_OID);
  if (i < 0) return null;
  let o = i + APPLE_NONCE_OID.length;
  if (certDer[o] === 0x01) o += 3;                         // ixtiyoriy BOOLEAN (critical)
  if (certDer[o++] !== 0x04) return null;                  // OCTET STRING
  [, o] = readLen(certDer, o);
  if (certDer[o++] !== 0x30) return null;                  // SEQUENCE
  [, o] = readLen(certDer, o);
  if (certDer[o++] !== 0xa1) return null;                  // [1]
  [, o] = readLen(certDer, o);
  if (certDer[o++] !== 0x04) return null;                  // OCTET STRING
  const [n, p] = readLen(certDer, o);
  return certDer.subarray(p, p + n);
}

/**
 * @returns {ok, reason?, keyId?, publicKeyPem?}
 * Faqat attestatsiya obyektini tekshiradi (har so'rov imzosi — assertion — keyingi bosqich).
 */
function verifyAppAttest({ keyId, attestation, nonce }, cfg, { rootPem = APPLE_ROOT_PEM, now = Date.now() } = {}) {
  try {
    if (!cfg.appleTeamId) return { ok: false, reason: 'not_configured' };
    const obj = cborDecode(Buffer.from(attestation, 'base64'));
    if (obj.fmt !== 'apple-appattest' || !obj.attStmt || !Array.isArray(obj.attStmt.x5c) || !Buffer.isBuffer(obj.authData)) return { ok: false, reason: 'bad_format' };

    const certs = obj.attStmt.x5c.map((c) => new crypto.X509Certificate(c));
    const root = new crypto.X509Certificate(rootPem);
    if (certs.length < 2) return { ok: false, reason: 'bad_chain' };
    const [leaf, ...chain] = certs;
    // zanjir: leaf → intermediate(lar) → Apple root
    let child = leaf;
    for (const issuer of chain) {
      if (!child.verify(issuer.publicKey)) return { ok: false, reason: 'bad_chain' };
      child = issuer;
    }
    if (!child.verify(root.publicKey)) return { ok: false, reason: 'untrusted_root' };
    for (const c of [...certs, root]) {
      if (now < Date.parse(c.validFrom) || now > Date.parse(c.validTo)) return { ok: false, reason: 'cert_expired' };
    }

    const authData = obj.authData;
    const clientDataHash = sha256(Buffer.from(String(nonce), 'utf8'));
    const expectedNonce = sha256(Buffer.concat([authData, clientDataHash]));
    const certNonce = extractAppleNonce(leaf.raw);
    if (!certNonce || !crypto.timingSafeEqual(certNonce, expectedNonce)) return { ok: false, reason: 'nonce_mismatch' };

    // Kalit identifikatori = SHA256(X9.62 nuqta)
    const spki = leaf.publicKey.export({ type: 'spki', format: 'der' });
    const point = spki.subarray(spki.length - 65);
    const computedKeyId = sha256(point);
    if (Buffer.from(keyId, 'base64').compare(computedKeyId) !== 0) return { ok: false, reason: 'key_id_mismatch' };

    const rpIdHash = authData.subarray(0, 32);
    const appId = `${cfg.appleTeamId}.${cfg.appleBundleId}`;
    if (rpIdHash.compare(sha256(Buffer.from(appId))) !== 0) return { ok: false, reason: 'app_id_mismatch' };
    if (authData.readUInt32BE(33) !== 0) return { ok: false, reason: 'bad_counter' };
    const aaguid = authData.subarray(37, 53).toString('latin1');
    const wantAaguid = cfg.appleEnv === 'development' ? 'appattestdevelop' : 'appattest\0\0\0\0\0\0\0';
    if (aaguid !== wantAaguid) return { ok: false, reason: 'bad_environment' };
    const credLen = authData.readUInt16BE(53);
    if (authData.subarray(55, 55 + credLen).compare(computedKeyId) !== 0) return { ok: false, reason: 'credential_mismatch' };

    return { ok: true, keyId, publicKeyPem: leaf.publicKey.export({ type: 'spki', format: 'pem' }) };
  } catch (e) {
    return { ok: false, reason: 'invalid:' + String(e.message).slice(0, 60) };
  }
}

// ---------- Google Play Integrity ----------
let gToken = { value: '', exp: 0 };
async function googleAccessToken(sa, fetchFn) {
  if (gToken.value && Date.now() < gToken.exp - 60000) return gToken.value;
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/playintegrity', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3300 }, sa.private_key, { algorithm: 'RS256' });
  const r = await fetchFn('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertion}` });
  const j = await r.json();
  if (!j.access_token) throw new Error('google token olinmadi');
  gToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3300) * 1000 };
  return gToken.value;
}

/** Direct APK Play'dan tarqatilmaydi: u holda ilova imzosi (certificateSha256Digest) ruxsat etilgan ro'yxatda bo'lishi kerak. */
async function verifyPlayIntegrity({ token, nonce }, cfg, { fetchFn = fetch, now = Date.now() } = {}) {
  try {
    if (!cfg.googleServiceAccountPath) return { ok: false, reason: 'not_configured' };
    const sa = JSON.parse(fs.readFileSync(cfg.googleServiceAccountPath, 'utf8'));
    const access = await googleAccessToken(sa, fetchFn);
    const r = await fetchFn(`https://playintegrity.googleapis.com/v1/${cfg.googlePackage}:decodeIntegrityToken`, {
      method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ integrity_token: token }),
    });
    const p = (await r.json()).tokenPayloadExternal;
    if (!p) return { ok: false, reason: 'no_payload' };
    const rd = p.requestDetails || {};
    if (rd.requestPackageName !== cfg.googlePackage) return { ok: false, reason: 'package_mismatch' };
    if (rd.nonce !== nonce) return { ok: false, reason: 'nonce_mismatch' };
    if (Math.abs(now - Number(rd.timestampMillis)) > NONCE_TTL_MS) return { ok: false, reason: 'stale' };
    const dv = (p.deviceIntegrity || {}).deviceRecognitionVerdict || [];
    if (!dv.includes('MEETS_DEVICE_INTEGRITY')) return { ok: false, reason: 'device_integrity' };
    const app = p.appIntegrity || {};
    if (app.appRecognitionVerdict === 'PLAY_RECOGNIZED') return { ok: true };
    const digests = (app.certificateSha256Digest || []).map((d) => Buffer.from(d, 'base64url').toString('hex'));
    if (digests.some((d) => cfg.androidCertSha256.includes(d))) return { ok: true };
    return { ok: false, reason: 'app_not_recognized' };
  } catch (e) {
    return { ok: false, reason: 'error:' + String(e.message).slice(0, 60) };
  }
}

// ---------- Yuqori daraja ----------
/**
 * @returns {ok, verified, reason}  ok = qo'shilishga ruxsat; verified = attestatsiya haqiqatan tasdiqlandimi
 */
async function check({ db, cfg, deps = {} }, { platform, sessionId, nonce, token, keyId }) {
  const mode = cfg.mode;
  if (mode === 'off') return { ok: true, verified: false, reason: 'off' };
  let res;
  if (!token || !nonce) res = { ok: false, reason: 'missing' };
  else if (!consumeChallenge(db, nonce, sessionId)) res = { ok: false, reason: 'bad_nonce' };
  else if (mode === 'mock') res = token === `mock-ok:${nonce}` ? { ok: true } : { ok: false, reason: 'mock_rejected' };
  else if (platform === 'ios') {
    res = verifyAppAttest({ keyId, attestation: token, nonce }, cfg, deps.apple);
    if (res.ok) db.run('INSERT INTO ios_attest_keys (key_id, public_key, counter, created_at) VALUES (?, ?, 0, ?) ON CONFLICT (key_id) DO NOTHING', [res.keyId, res.publicKeyPem, Date.now()]);
  } else if (platform === 'android') res = await verifyPlayIntegrity({ token, nonce }, cfg, deps.google);
  else res = { ok: false, reason: 'unsupported_platform' };
  return { ok: mode === 'enforce' || mode === 'mock' ? res.ok : true, verified: !!res.ok, reason: res.ok ? '' : res.reason };
}

module.exports = { issueChallenge, consumeChallenge, check, cborDecode, verifyAppAttest, verifyPlayIntegrity, extractAppleNonce, APPLE_ROOT_PEM };
