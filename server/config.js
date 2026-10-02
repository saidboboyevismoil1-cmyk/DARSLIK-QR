// Konfiguratsiya: config/.env fayli + process.env (process.env ustun turadi).
// CHANGE_ME qiymatlari "o'rnatilmagan" deb hisoblanadi.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    // oxiridagi " # izoh" ni olib tashlash (qiymat qo'shtirnoqsiz bo'lsa)
    if (!/^["']/.test(val)) val = val.replace(/\s+#.*$/, '');
    out[key] = val.replace(/^["']|["']$/g, '');
  }
  return out;
}

function load(envFile) {
  let file = {};
  try { file = parseEnv(fs.readFileSync(envFile, 'utf8')); } catch { /* fayl yo'q — muammo emas */ }
  const raw = (k, d = '') => (process.env[k] !== undefined ? process.env[k] : file[k] !== undefined ? file[k] : d);
  const isPlaceholder = (v) => !v || /^CHANGE_ME/i.test(v);
  const str = (k, d = '') => { const v = raw(k, d); return isPlaceholder(v) ? '' : v; };
  const bool = (k, d = false) => { const v = String(raw(k, d ? 'true' : 'false')).toLowerCase(); return v === 'true' || v === '1' || v === 'yes'; };
  const int = (k, d) => { const n = parseInt(raw(k, String(d)), 10); return Number.isFinite(n) ? n : d; };

  const env = raw('NODE_ENV', 'development');
  const isProd = env === 'production';
  const dataDir = path.resolve(ROOT, str('DATA_DIR') || 'data');

  const cfg = {
    root: ROOT,
    env,
    isProd,
    port: int('PORT', 3000),
    dataDir,
    dbPath: path.join(dataDir, 'edufocus.sqlite'),
    publicBaseUrl: str('PUBLIC_BASE_URL'),
    jwtSecret: str('JWT_SECRET') || 'edufocus_secret_key_2024', // faqat dev uchun; production'da validate() to'xtatadi
    jwtSecretIsDefault: !str('JWT_SECRET'),
    enableDemoTeacher: bool('ENABLE_DEMO_TEACHER', !isProd),
    registrationOpen: bool('REGISTRATION_OPEN', true),
    adminBootstrap: { email: str('ADMIN_BOOTSTRAP_EMAIL'), password: str('ADMIN_BOOTSTRAP_PASSWORD') },
    owner: { company: str('OWNER_COMPANY_NAME'), email: str('OWNER_EMAIL'), stir: str('OWNER_STIR') },
    retentionDaysAfterSemester: int('RETENTION_DAYS_AFTER_SEMESTER', 90),
    flags: { iosL1: bool('IOS_L1_ENABLED'), iosL2: bool('IOS_L2_ENABLED') },
    attestation: {
      mode: ['off', 'log', 'enforce', 'mock'].includes(raw('ATTESTATION_MODE', 'log')) ? raw('ATTESTATION_MODE', 'log') : 'log',
      appleTeamId: str('APPLE_TEAM_ID'),
      appleBundleId: str('APPLE_BUNDLE_ID', 'com.edufocus.app') || 'com.edufocus.app',
      appleEnv: raw('APPLE_APP_ATTEST_ENV', 'production') === 'development' ? 'development' : 'production',
      googlePackage: str('GOOGLE_PLAY_PACKAGE', 'com.edufocus.app') || 'com.edufocus.app',
      googleServiceAccountPath: str('GOOGLE_SERVICE_ACCOUNT_PATH'),
      androidCertSha256: str('ANDROID_ALLOWED_CERT_SHA256').split(',').map((s) => s.trim().replace(/:/g, '').toLowerCase()).filter(Boolean),
    },
    push: {
      apnsKeyId: str('APNS_KEY_ID'), apnsKeyPath: str('APNS_KEY_PATH'),
      firebaseServiceAccountPath: str('FIREBASE_SERVICE_ACCOUNT_PATH'),
      mode: ['off', 'mock', 'real'].includes(raw('PUSH_MODE', 'real')) ? raw('PUSH_MODE', 'real') : 'real',   // real: kalit bor provayderlarga yuboradi; mock: testlar
      apnsTopic: str('APNS_TOPIC', 'com.edufocus.teacher') || 'com.edufocus.teacher', apnsProduction: raw('APNS_ENV', 'production') !== 'development',
      vapidPublic: str('VAPID_PUBLIC_KEY'), vapidPrivate: str('VAPID_PRIVATE_KEY'), vapidSubject: str('VAPID_SUBJECT'),
    },
    accessTokenTtl: str('ACCESS_TOKEN_TTL', '12h') || '12h',
    refreshTokenDays: int('REFRESH_TOKEN_DAYS', 30),
    smtp: { host: str('SMTP_HOST'), port: int('SMTP_PORT', 587), user: str('SMTP_USER'), password: str('SMTP_PASSWORD'), from: str('SMTP_FROM') },
    demo: { enabled: bool('DEMO_ENABLED', true), code: str('DEMO_SESSION_CODE', '123456') || '123456' },
  };
  return cfg;
}

/** Production'da xavfli sozlamalar bilan ishga tushishni taqiqlaydi. */
function validate(cfg) {
  const errors = [];
  if (cfg.isProd) {
    if (cfg.jwtSecretIsDefault) errors.push("JWT_SECRET o'rnatilmagan (production'da majburiy: openssl rand -hex 32)");
    else if (cfg.jwtSecret.length < 24) errors.push('JWT_SECRET juda qisqa (kamida 24 belgi)');
    if (cfg.enableDemoTeacher) errors.push("ENABLE_DEMO_TEACHER=true production'da taqiqlangan");
  }
  return errors;
}

const config = load(process.env.EDUFOCUS_ENV_FILE || path.join(ROOT, 'config', '.env'));
module.exports = { config, load, parseEnv, validate };
