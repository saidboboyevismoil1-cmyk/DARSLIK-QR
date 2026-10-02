import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const att = require('../../server/lock/attestation');
const { open } = require('../../server/db');
const levels = require('../../server/lock/levels');
const { parseCsv } = require('../../server/repos/rosters');
const { load, validate } = require('../../server/config');
const retention = require('../../server/lock/retention');
const { DEFAULTS } = require('../../server/repos/settings');

const sha = (b) => crypto.createHash('sha256').update(b).digest();

// ---------- Apple App Attest: sintetik (lekin Apple formatidagi) sertifikat zanjiri ----------
function cborEnc(v) {
  const head = (major, n) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
  if (typeof v === 'number') return head(0, v);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cborEnc)]);
  const e = Object.entries(v); return Buffer.concat([head(5, e.length), ...e.flatMap(([k, x]) => [cborEnc(k), cborEnc(x)])]);
}

function makeFixture({ teamId = 'TEAM123456', bundleId = 'com.edufocus.app', env = 'production', challenge = 'nonce-abc', nonceOverride, days = 3 } = {}) {
  const d = mkdtempSync(path.join(tmpdir(), 'aa-'));
  const sh = (...a) => execFileSync('openssl', a, { cwd: d, stdio: ['ignore', 'pipe', 'pipe'] });
  const ec = (n) => sh('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${n}.key`);
  ec('root'); ec('inter'); ec('leaf');
  writeFileSync(path.join(d, 'ca.cnf'), 'basicConstraints=critical,CA:TRUE\n');
  sh('req', '-new', '-x509', '-key', 'root.key', '-out', 'root.pem', '-days', String(days), '-subj', '/CN=Test App Attest Root', '-addext', 'basicConstraints=critical,CA:TRUE');
  sh('req', '-new', '-key', 'inter.key', '-out', 'inter.csr', '-subj', '/CN=Test Intermediate');
  sh('x509', '-req', '-in', 'inter.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'inter.pem', '-days', String(days), '-extfile', 'ca.cnf');
  sh('req', '-new', '-key', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=Test Leaf');
  const spki = sh('pkey', '-in', 'leaf.key', '-pubout', '-outform', 'DER');
  const point = spki.subarray(spki.length - 65);
  const keyId = sha(point);
  const aaguid = Buffer.from(env === 'development' ? 'appattestdevelop' : 'appattest\0\0\0\0\0\0\0', 'latin1');
  const credLen = Buffer.alloc(2); credLen.writeUInt16BE(32);
  const authData = Buffer.concat([sha(Buffer.from(`${teamId}.${bundleId}`)), Buffer.from([0x40]), Buffer.alloc(4), aaguid, credLen, keyId, Buffer.alloc(40, 7)]);
  const nonce = nonceOverride || sha(Buffer.concat([authData, sha(Buffer.from(challenge))]));
  writeFileSync(path.join(d, 'ext.cnf'), `1.2.840.113635.100.8.2=DER:3024A1220420${nonce.toString('hex')}\n`);
  sh('x509', '-req', '-in', 'leaf.csr', '-CA', 'inter.pem', '-CAkey', 'inter.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', String(days), '-extfile', 'ext.cnf');
  const der = (n) => sh('x509', '-in', `${n}.pem`, '-outform', 'DER');
  const attestation = cborEnc({ fmt: 'apple-appattest', attStmt: { x5c: [der('leaf'), der('inter')], receipt: Buffer.alloc(8) }, authData }).toString('base64');
  const rootPem = readFileSync(path.join(d, 'root.pem'), 'utf8');
  const otherRoot = (() => { sh('req', '-new', '-x509', '-key', 'inter.key', '-out', 'other.pem', '-days', '3', '-subj', '/CN=Other'); return readFileSync(path.join(d, 'other.pem'), 'utf8'); })();
  rmSync(d, { recursive: true, force: true });
  return { attestation, keyId: keyId.toString('base64'), rootPem, otherRoot, challenge };
}

const CFG = { appleTeamId: 'TEAM123456', appleBundleId: 'com.edufocus.app', appleEnv: 'production' };

test('App Attest: to\'g\'ri zanjir tasdiqlanadi, har bir buzilish aniq sababi bilan rad etiladi', () => {
  const f = makeFixture();
  const run = (over = {}, cfg = CFG, deps = {}) => att.verifyAppAttest({ keyId: f.keyId, attestation: f.attestation, nonce: f.challenge, ...over }, cfg, { rootPem: f.rootPem, ...deps });
  const good = run();
  assert.equal(good.ok, true, good.reason);
  assert.ok(good.publicKeyPem.includes('BEGIN PUBLIC KEY'));
  assert.equal(run({ nonce: 'boshqa' }).reason, 'nonce_mismatch');
  assert.equal(run({ keyId: Buffer.alloc(32, 1).toString('base64') }).reason, 'key_id_mismatch');
  assert.equal(run({}, { ...CFG, appleTeamId: 'OTHERTEAM1' }).reason, 'app_id_mismatch');
  assert.equal(run({}, { ...CFG, appleBundleId: 'com.evil.app' }).reason, 'app_id_mismatch');
  assert.equal(run({}, { ...CFG, appleEnv: 'development' }).reason, 'bad_environment');
  assert.equal(run({}, { ...CFG, appleTeamId: '' }).reason, 'not_configured');
  assert.equal(run({}, CFG, { rootPem: f.otherRoot }).reason, 'untrusted_root');
  assert.equal(run({}, CFG, { now: Date.now() + 30 * 86400000 }).reason, 'cert_expired');
  assert.match(run({ attestation: Buffer.from('garbage').toString('base64') }).reason, /^(invalid|bad_format)/);
  // authData buzilsa (rpIdHash o'zgaradi) — nonce ham mos kelmaydi
  const forged = makeFixture({ teamId: 'ATTACKER99' });
  assert.notEqual(att.verifyAppAttest({ keyId: forged.keyId, attestation: forged.attestation, nonce: forged.challenge }, CFG, { rootPem: forged.rootPem }).ok, true);
});

test('App Attest: development muhiti (appattestdevelop) alohida qabul qilinadi', () => {
  const f = makeFixture({ env: 'development' });
  const dev = att.verifyAppAttest({ keyId: f.keyId, attestation: f.attestation, nonce: f.challenge }, { ...CFG, appleEnv: 'development' }, { rootPem: f.rootPem });
  assert.equal(dev.ok, true, dev.reason);
});

test('Apple ildiz sertifikati haqiqiy va muddati yaroqli', () => {
  const root = new crypto.X509Certificate(att.APPLE_ROOT_PEM);
  assert.match(root.subject, /Apple App Attestation Root CA/);
  assert.ok(Date.now() < Date.parse(root.validTo));
});

// ---------- attestation.check: rejimlar va nonce ----------
test('attestatsiya rejimlari: off/log/enforce/mock va nonce bir martaligi', async () => {
  const db = open(':memory:'); db.migrate();
  const run = (mode, token, nonce) => att.check({ db, cfg: { mode } }, { platform: 'android', sessionId: 's1', nonce, token });
  assert.deepEqual(await run('off'), { ok: true, verified: false, reason: 'off' });
  let n = att.issueChallenge(db, 's1');
  assert.equal((await run('mock', `mock-ok:${n}`, n)).verified, true);
  assert.equal((await run('mock', `mock-ok:${n}`, n)).reason, 'bad_nonce');                // replay
  n = att.issueChallenge(db, 's1');
  const logOnly = await run('log', 'xxx', n);                                              // log: rad etmaydi, lekin tasdiqlanmagan
  assert.equal(logOnly.ok, true); assert.equal(logOnly.verified, false);
  n = att.issueChallenge(db, 's1');
  const strict = await att.check({ db, cfg: { mode: 'enforce', appleTeamId: '' } }, { platform: 'ios', sessionId: 's1', nonce: n, token: 'x', keyId: 'y' });
  assert.equal(strict.ok, false);
  n = att.issueChallenge(db, 'boshqa-sessiya');
  assert.equal((await run('mock', `mock-ok:${n}`, n)).reason, 'bad_nonce');               // boshqa sessiya uchun berilgan nonce
  assert.equal((await run('enforce')).ok, false);                                          // token yo'q
  db.close();
});

// ---------- Play Integrity (Google serveri soxta fetch bilan) ----------
test('Play Integrity: qurilma yaxlitligi, nonce, paket, ilova imzosi tekshiriladi', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const dir = mkdtempSync(path.join(tmpdir(), 'pi-'));
  const saPath = path.join(dir, 'sa.json');
  writeFileSync(saPath, JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
  const cert = crypto.randomBytes(32);
  const cfg = { googleServiceAccountPath: saPath, googlePackage: 'com.edufocus.app', androidCertSha256: [cert.toString('hex')] };
  const payload = (over = {}) => ({ tokenPayloadExternal: { requestDetails: { requestPackageName: 'com.edufocus.app', nonce: 'N1', timestampMillis: String(Date.now()) },
    deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] }, appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED' }, ...over } });
  const fakeFetch = (p) => async (url) => ({ json: async () => (String(url).includes('oauth2') ? { access_token: 'tok', expires_in: 3600 } : p) });
  const v = (p, nonce = 'N1') => att.verifyPlayIntegrity({ token: 't', nonce }, cfg, { fetchFn: fakeFetch(p) });
  assert.equal((await v(payload())).ok, true);
  assert.equal((await v(payload(), 'BOSHQA')).reason, 'nonce_mismatch');
  assert.equal((await v(payload({ deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] } }))).reason, 'device_integrity');
  const p = payload(); p.tokenPayloadExternal.requestDetails.requestPackageName = 'com.evil'; assert.equal((await v(p)).reason, 'package_mismatch');
  const old = payload(); old.tokenPayloadExternal.requestDetails.timestampMillis = String(Date.now() - 3600000); assert.equal((await v(old)).reason, 'stale');
  // direct APK: Play tanimaydi, lekin imzo sertifikati ruxsat etilgan ro'yxatda
  assert.equal((await v(payload({ appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', certificateSha256Digest: [cert.toString('base64url')] } }))).ok, true);
  assert.equal((await v(payload({ appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', certificateSha256Digest: [crypto.randomBytes(32).toString('base64url')] } }))).reason, 'app_not_recognized');
  assert.equal((await att.verifyPlayIntegrity({ token: 't', nonce: 'N1' }, { ...cfg, googleServiceAccountPath: '' })).reason, 'not_configured');
  rmSync(dir, { recursive: true, force: true });
});

// ---------- Boshqa sof mantiq ----------
test('darajalar: bayroq o\'chiq bo\'lsa iOS L1/L2 → L0, bypass farqlari, iOS L2 offline "taxminan himoyada"', () => {
  const off = { ...DEFAULTS }, on = { ...DEFAULTS, 'features.iosL1': true, 'features.iosL2': true };
  const c = (level, s) => levels.normalizeClient({ type: 'app', platform: 'ios', level }, s).level;
  assert.equal(c('ios-l1', off), 'ios-l0'); assert.equal(c('ios-l2', off), 'ios-l0');
  assert.equal(c('ios-l1', on), 'ios-l1'); assert.equal(c('ios-l2', on), 'ios-l2');
  assert.equal(levels.normalizeClient({ type: 'web', platform: 'android', level: 'android-full' }, on).level, 'web');   // web o'zini himoyalangan deb ko'rsata olmaydi
  assert.deepEqual(levels.diffChecks({ pinned: true, accessibility: true, dnd: true, devOptions: false }, { pinned: false, accessibility: false, dnd: false, devOptions: true }, 'android-full').sort(), ['accessibility_disabled', 'developer_mode', 'dnd_disabled', 'pinning_removed']);
  assert.deepEqual(levels.diffChecks({ pinned: true }, { pinned: false }, 'web'), []);
  assert.equal(levels.offlineClass('ios-l2', DEFAULTS), 'assumed');
  assert.equal(levels.offlineClass('android-full', DEFAULTS), 'offline');
  assert.deepEqual(levels.normalizeProtection({ active: 'yes', reasons: ['background', 'hack'], checks: { pinned: true, evil: true } }), { active: false, reasons: ['background'], checks: { pinned: true } });
});

test('CSV: BOM, ; ajratgich, takror va qisqa ismlar', () => {
  const r = parseCsv('﻿F.I.Sh;HEMIS ID\nKarimov Jasur;12\n"Aliyev, Vali"\nKarimov Jasur;3\nAb;4\n');
  assert.deepEqual(r.students.map((s) => s.fullName), ['Karimov Jasur', 'Aliyev, Vali']);
  assert.equal(r.students[0].hemisId, '12'); assert.equal(r.errors.length, 2);
  assert.deepEqual(parseCsv('Ali Valiyev\r\nSardor Qodirov').students.length, 2);
});

test("konfiguratsiya: production'da xavfli sozlamalar bilan ishga tushish taqiqlanadi", () => {
  const d = mkdtempSync(path.join(tmpdir(), 'cfg-'));
  const f = path.join(d, '.env');
  const mk = (txt, env = {}) => { writeFileSync(f, txt); const saved = {}; for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; } const c = load(f); for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } return c; };
  assert.ok(validate(mk('NODE_ENV=production\n')).length >= 1);
  assert.ok(validate(mk('NODE_ENV=production\nJWT_SECRET=CHANGE_ME\n')).length >= 1);
  assert.ok(validate(mk('NODE_ENV=production\nJWT_SECRET=short\n')).length >= 1);
  assert.ok(validate(mk('NODE_ENV=production\nJWT_SECRET=' + 'x'.repeat(40) + '\nENABLE_DEMO_TEACHER=true\n')).length >= 1);
  assert.deepEqual(validate(mk('NODE_ENV=production\nJWT_SECRET=' + 'x'.repeat(40) + '\n')), []);
  assert.deepEqual(validate(mk('NODE_ENV=development\n')), []);
  const c = mk('NODE_ENV=development\nOWNER_EMAIL=CHANGE_ME\nRETENTION_DAYS_AFTER_SEMESTER=45 # izoh\nIOS_L1_ENABLED=true\n');
  assert.equal(c.owner.email, ''); assert.equal(c.retentionDaysAfterSemester, 45); assert.equal(c.flags.iosL1, true);
  rmSync(d, { recursive: true, force: true });
});

test('saqlash muddati: semestr + N kun va maxDays dan eski darslar anonimlanadi, demo va yangilar tegilmaydi', () => {
  const DAY = 86400000, now = Date.now();
  const ended = (daysAgo) => ({ id: 's' + daysAgo, status: 'ended', endedAt: new Date(now - daysAgo * DAY).toISOString(), students: [{ name: 'Ali' }, { name: 'Vali' }] });
  const sessions = [ended(10), ended(120), ended(300), { id: 'demo', demo: true, status: 'active', students: [{ name: 'X' }] }];
  const mkSvc = (st) => { const purged = []; return { purged, settings: { effective: () => ({ ...DEFAULTS, ...st }) }, anonymizeStudent: (s, stu) => { stu.name = "O'chirilgan talaba"; }, lockdata: { purgeSession: (id) => purged.push(id) } }; };
  // semestr sanasi yo'q: faqat maxDays (270) dan eskilari
  let svc = mkSvc({});
  let r = retention.run({ legacy: { sessions }, svc, helpers: { saveSessions() {} } });
  assert.equal(r.sessions, 1); assert.equal(sessions[2].students[0].name, "O'chirilgan talaba"); assert.equal(sessions[0].students[0].name, 'Ali');
  // semestr 100 kun oldin tugagan va +90 kun o'tgan: undan oldin tugagan darslar (120 va 300 kun oldingi) tozalanadi, 10 kun oldingisi qoladi
  sessions.forEach((s) => { delete s.purgedAt; });
  sessions[2].students.forEach((x) => { x.name = 'Qayta'; });
  svc = mkSvc({ 'retention.semesterEnd': new Date(now - 100 * DAY).toISOString().slice(0, 10), 'retention.afterSemesterDays': 90 });
  r = retention.run({ legacy: { sessions }, svc, helpers: { saveSessions() {} } });
  assert.equal(r.sessions, 2);
  assert.equal(sessions[1].students[0].name, "O'chirilgan talaba"); assert.equal(sessions[2].students[0].name, "O'chirilgan talaba");
  assert.equal(sessions[0].students[0].name, 'Ali');
  assert.equal(sessions[3].students[0].name, 'X');
  // semestr tugagan, lekin 90 kun hali o'tmagan: tegilmaydi
  sessions.forEach((s) => { delete s.purgedAt; if (s.students[0]) s.students[0].name = 'Ali'; });
  svc = mkSvc({ 'retention.semesterEnd': new Date(now - 30 * DAY).toISOString().slice(0, 10), 'retention.afterSemesterDays': 90, 'retention.maxDays': 3650 });
  assert.equal(retention.run({ legacy: { sessions }, svc, helpers: { saveSessions() {} } }).sessions, 0);
});
