// Sozlamalar: standart qiymatlar → global (admin) → fakultet. Barcha kalitlar shu yerda tavsiflangan va tekshiriladi.
const DEFAULTS = {
  // Himoya siyosati
  'protection.default': 'optional',                       // optional | required
  'protection.requiredLevels': ['ios-l1', 'ios-l2', 'android-full', 'android-lite'],
  // Heartbeat va uzilish
  'heartbeat.intervalSec': 10,
  'heartbeat.offlineAfterSec': 30,
  'release.offlineMinutes': 15,
  // Joriy nazorat balli: 100 = davomat + testlar + fokus
  'score.weights': { attendance: 30, quizzes: 50, focus: 20 },
  'score.unprotectedFocusZeroSec': 180,                   // jami himoyasiz > 3 daq → fokus = 0
  'score.unprotectedAbsentSec': 600,                      // jami himoyasiz > 10 daq → davomat ham 0
  'score.offlineCountsAsUnprotected': true,
  'ios.l2OfflineAs': 'assumed',                           // assumed | offline | unprotected
  // Saqlash muddati
  'retention.semesterEnd': null,                          // 'YYYY-MM-DD' yoki null
  'retention.afterSemesterDays': 90,
  'retention.maxDays': 270,                               // semestr tugash sanasi kiritilmasa ham tozalanadi
  // Boshqa
  'telemetry.enabled': true,
  'features.iosL1': false,
  'features.iosL2': false,
};

const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const VALIDATORS = {
  'protection.default': (v) => ['optional', 'required'].includes(v),
  'protection.requiredLevels': (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  'heartbeat.intervalSec': (v) => isNum(v, 5, 60),
  'heartbeat.offlineAfterSec': (v) => isNum(v, 15, 300),
  'release.offlineMinutes': (v) => isNum(v, 2, 120),
  'score.weights': (v) => v && ['attendance', 'quizzes', 'focus'].every((k) => isNum(v[k], 0, 100)) && Math.round(v.attendance + v.quizzes + v.focus) === 100,
  'score.unprotectedFocusZeroSec': (v) => isNum(v, 0, 7200),
  'score.unprotectedAbsentSec': (v) => isNum(v, 0, 7200),
  'score.offlineCountsAsUnprotected': (v) => typeof v === 'boolean',
  'ios.l2OfflineAs': (v) => ['assumed', 'offline', 'unprotected'].includes(v),
  'retention.semesterEnd': (v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v),
  'retention.afterSemesterDays': (v) => isNum(v, 1, 3650),
  'retention.maxDays': (v) => isNum(v, 7, 3650),
  'telemetry.enabled': (v) => typeof v === 'boolean',
  'features.iosL1': (v) => typeof v === 'boolean',
  'features.iosL2': (v) => typeof v === 'boolean',
};

// Faqat global darajada o'zgartiriladigan kalitlar (fakultet qayta yoza olmaydi)
const GLOBAL_ONLY = new Set(['retention.semesterEnd', 'retention.afterSemesterDays', 'retention.maxDays', 'telemetry.enabled', 'features.iosL1', 'features.iosL2', 'protection.requiredLevels']);

function create(db, { envFlags = {} } = {}) {
  function overrides(scope, scopeId) {
    const out = {};
    for (const r of db.all('SELECT key, value FROM settings WHERE scope = ? AND scope_id = ?', [scope, scopeId || ''])) {
      if (r.key in DEFAULTS) { try { out[r.key] = JSON.parse(r.value); } catch { /* buzilgan qiymat e'tiborsiz */ } }
    }
    return out;
  }

  /** Samarali sozlamalar: standart → global → fakultet. Env flag'lar feature'larni majburan yoqadi. */
  function effective(facultyId) {
    const s = { ...DEFAULTS, ...overrides('global', ''), ...(facultyId ? Object.fromEntries(Object.entries(overrides('faculty', facultyId)).filter(([k]) => !GLOBAL_ONLY.has(k))) : {}) };
    if (envFlags.iosL1) s['features.iosL1'] = true;
    if (envFlags.iosL2) s['features.iosL2'] = true;
    return s;
  }

  function validate(scope, key, value) {
    if (!(key in DEFAULTS)) return { ok: false, error: `Noma'lum sozlama: ${key}` };
    if (scope === 'faculty' && GLOBAL_ONLY.has(key)) return { ok: false, error: `${key} faqat global sozlama` };
    if (!VALIDATORS[key](value)) return { ok: false, error: `Noto'g'ri qiymat: ${key}` };
    return { ok: true };
  }

  function set(scope, scopeId, key, value, by) {
    const v = validate(scope, key, value);
    if (!v.ok) return v;
    db.run(`INSERT INTO settings (scope, scope_id, key, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (scope, scope_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [scope, scopeId || '', key, JSON.stringify(value), Date.now(), by || null]);
    return { ok: true };
  }

  function reset(scope, scopeId, key) {
    db.run('DELETE FROM settings WHERE scope = ? AND scope_id = ? AND key = ?', [scope, scopeId || '', key]);
  }

  return { effective, set, reset, validate, overrides, DEFAULTS, GLOBAL_ONLY };
}

module.exports = { create, DEFAULTS, GLOBAL_ONLY };
