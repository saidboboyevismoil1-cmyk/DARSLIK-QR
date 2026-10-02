// Himoya darajalari, hodisa turlari va ularning og'irligi — yagona manba.
const LEVELS = {
  'ios-l1': { platform: 'ios', strong: true },      // AEAssessmentSession
  'ios-l2': { platform: 'ios', strong: true },      // FamilyControls + ManagedSettings
  'ios-l0': { platform: 'ios', strong: false },     // faqat kuzatish
  'android-full': { platform: 'android', strong: true },   // pinning + Accessibility + DND (direct APK)
  'android-lite': { platform: 'android', strong: true },   // pinning + DND (store flavor)
  'android-l0': { platform: 'android', strong: false },    // ilova bor, himoya yoqilmagan (faqat kuzatish)
  'web': { platform: 'web', strong: false },        // brauzer
};
const isStrong = (l) => !!(LEVELS[l] && LEVELS[l].strong);

// bypass:true — o'qituvchiga "qizil" signal va bypass hisoblagichiga qo'shiladi
const EVENTS = {
  joined: { sev: 'info' }, left: { sev: 'info' },
  protection_lost: { sev: 'warn' }, protection_restored: { sev: 'info' },
  heartbeat_lost: { sev: 'warn' }, heartbeat_restored: { sev: 'info' },
  permission_revoked: { sev: 'critical', bypass: true }, app_terminated: { sev: 'critical', bypass: true }, assessment_ended: { sev: 'critical', bypass: true },
  pinning_removed: { sev: 'critical', bypass: true }, accessibility_disabled: { sev: 'critical', bypass: true },
  dnd_disabled: { sev: 'warn', bypass: true }, developer_mode: { sev: 'warn', bypass: true }, a11y_shortcut: { sev: 'warn', bypass: true },
  level_changed: { sev: 'info' }, left_page: { sev: 'warn' },
  sos: { sev: 'info' }, emergency_requested: { sev: 'warn' }, exemption_requested: { sev: 'warn' },
  released: { sev: 'info' }, released_timer: { sev: 'info' }, released_offline: { sev: 'warn' }, relocked: { sev: 'info' },
  rule_focus_zero: { sev: 'warn' }, rule_absent: { sev: 'critical' },
};
const clientEventTypes = new Set(['permission_revoked', 'app_terminated', 'assessment_ended', 'pinning_removed', 'accessibility_disabled', 'dnd_disabled', 'developer_mode', 'a11y_shortcut', 'sos']);

const CHECK_KEYS = ['pinned', 'accessibility', 'dnd', 'devOptions', 'a11yShortcut', 'assessment', 'shield', 'authorized', 'foreground'];
const REASONS = ['background', 'not_pinned', 'no_accessibility', 'no_dnd', 'dev_options', 'a11y_shortcut', 'no_assessment', 'no_shield', 'no_authorization', 'permission_revoked', 'screen_off', 'unknown'];
const BRANDS = ['samsung', 'xiaomi', 'redmi', 'poco', 'tecno', 'infinix', 'huawei', 'honor', 'oppo', 'realme', 'vivo', 'oneplus', 'google', 'apple'];

/** Mijoz yuborgan "client" ni xavfsiz, tekshirilgan ko'rinishga keltiradi. */
function normalizeClient(c, settings) {
  c = c && typeof c === 'object' ? c : {};
  const type = c.type === 'app' ? 'app' : 'web';
  const platform = ['ios', 'android'].includes(c.platform) ? c.platform : 'web';
  let level = 'web';
  if (type === 'app') {
    const claimed = String(c.level || '');
    if (platform === 'ios') {
      if (claimed === 'ios-l1' && settings['features.iosL1']) level = 'ios-l1';
      else if (claimed === 'ios-l2' && settings['features.iosL2']) level = 'ios-l2';
      else level = 'ios-l0';
    } else if (platform === 'android') {
      level = ['android-full', 'android-lite', 'android-l0'].includes(claimed) ? claimed : 'android-l0';
    }
  }
  const brandRaw = String(c.brand || '').toLowerCase();
  const brand = BRANDS.find((b) => brandRaw.includes(b)) || (brandRaw ? 'other' : '');
  return {
    type, platform, level, brand,
    appVersion: String(c.appVersion || '').slice(0, 20),
    flavor: ['store', 'direct'].includes(c.flavor) ? c.flavor : '',
    osVersion: String(c.osVersion || '').slice(0, 20),
  };
}

/** Heartbeat'dagi protection bo'limini tozalaydi (faqat ruxsat etilgan kalitlar). */
function normalizeProtection(p) {
  p = p && typeof p === 'object' ? p : {};
  const checks = {};
  for (const k of CHECK_KEYS) if (typeof (p.checks || {})[k] === 'boolean') checks[k] = p.checks[k];
  const reasons = (Array.isArray(p.reasons) ? p.reasons : []).filter((r) => REASONS.includes(r)).slice(0, 8);
  return { active: p.active === true, reasons, checks };
}

/** Oldingi va yangi tekshiruvlar farqidan bypass hodisalarini chiqaradi. */
function diffChecks(prev, next, level) {
  if (!isStrong(level)) return [];
  const out = [];
  const lost = (k) => prev[k] === true && next[k] === false;
  const gained = (k) => prev[k] === false && next[k] === true;
  if (lost('pinned')) out.push('pinning_removed');
  if (lost('accessibility')) out.push('accessibility_disabled');
  if (lost('dnd')) out.push('dnd_disabled');
  if (gained('devOptions')) out.push('developer_mode');
  if (gained('a11yShortcut')) out.push('a11y_shortcut');
  if (lost('assessment')) out.push('assessment_ended');
  if (lost('authorized') || lost('shield')) out.push('permission_revoked');
  return out;
}

/** Heartbeat to'xtaganda holat: iOS L2'da shield ilova yopilgach ham turadi — shuning uchun "taxminan himoyada". */
function offlineClass(level, settings) {
  if (level === 'ios-l2') { const m = settings['ios.l2OfflineAs']; return m === 'assumed' ? 'assumed' : m === 'unprotected' ? 'unprotected' : 'offline'; }
  return 'offline';
}

module.exports = { LEVELS, EVENTS, CHECK_KEYS, REASONS, BRANDS, clientEventTypes, isStrong, normalizeClient, normalizeProtection, diffChecks, offlineClass };
