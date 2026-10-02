// Ruxsatlarni sozlash ekrani, OEM yo'riqnomalari va "Darsga tayyormisiz?" tekshiruvi.
import { $, esc, icon, toast } from './util.js';
import { S, bus, actions, push, pop, openOverlay, closeOverlay, onEnter, currentScreen } from './state.js';
import { t, onLangChange } from './i18n.js';
import { native } from './native.js';
import * as prot from './protection.js';

const META = {
  accessibility: { ic: 'shield' }, dnd: { ic: 'bell' }, battery: { ic: 'bolt' }, autostart: { ic: 'bolt' },
  notifications: { ic: 'bell' }, camera: { ic: 'camera' }, screentime: { ic: 'clock' }, pinning: { ic: 'lock' }, usage: { ic: 'clock' },
};
const OEM = [['xiaomi', ['xiaomi', 'redmi', 'poco']], ['samsung', ['samsung']], ['huawei', ['huawei', 'honor']], ['oppo', ['oppo', 'realme', 'oneplus']], ['tecno', ['tecno', 'infinix', 'itel']]];
export function oemOf(brand) {
  const b = String(brand || '').toLowerCase();
  const hit = OEM.find(([, names]) => names.some((n) => b.includes(n)));
  return hit ? hit[0] : 'default';
}

export const levelLabel = (l) => t('level.' + l);

// ---------------------------------------------------------------- ro'yxat
function requiredIds() {
  const info = prot.P.info;
  if (!info) return new Set();
  const ids = new Set();
  const cand = (info.candidates || []).filter((l) => prot.isStrong(l));
  // eng kuchli (birinchi) darajaning talablari majburiy; qolganlari — "tavsiya"
  if (cand.length) ((info.requires && info.requires[cand[0]]) || []).forEach((id) => ids.add(id));
  return ids;
}

function rowHtml(p, required) {
  const st = prot.permStatus(p.id);
  const ok = st === 'granted';
  const unk = st === 'unknown';
  const cls = ok ? 'ok' : unk ? 'unk' : 'bad';
  const chip = ok ? icon('check', 'sm') : unk ? '?' : icon('x', 'sm');
  let btn = '';
  if (!ok) {
    if (p.guide) btn = `<button class="btn btn-glass sm" data-act="perm-guide" data-id="${esc(p.id)}">${esc(t('setup.guide'))}</button>`;
    else if (p.canRequest !== false) btn = `<button class="btn btn-primary sm" data-act="perm-fix" data-id="${esc(p.id)}">${esc(t('setup.enable'))}</button>`;
    else btn = `<button class="btn btn-glass sm" data-act="perm-settings" data-id="${esc(p.id)}">${esc(t('setup.openSettings'))}</button>`;
  }
  return `<div class="glass perm ${cls}" data-perm="${esc(p.id)}">
    <span class="perm-ic">${icon((META[p.id] || { ic: 'shield' }).ic)}</span>
    <div class="perm-tx"><b>${esc(t('perm.' + p.id + '.t'))}${required ? '' : ` <i class="opt-tag">${esc(t('setup.optional'))}</i>`}</b><span class="muted small">${esc(t('perm.' + p.id + '.d'))}</span></div>
    <span class="pstat ${cls}" aria-label="${ok ? 'ok' : 'no'}">${chip}</span>
    ${btn ? `<div class="perm-act">${btn}</div>` : ''}
  </div>`;
}

export function renderSetup() {
  const P = prot.P;
  const list = $('#perm-list');
  if (!native.present) {
    list.innerHTML = `<div class="glass empty"><div class="eic">${icon('download', 'lg')}</div><h3>${esc(t('setup.webTitle'))}</h3><p>${esc(t('setup.webText'))}</p></div>`;
    $('#setup-summary').textContent = t('setup.webSummary');
    $('#setup-progress').style.transform = 'scaleX(0)';
    $('#setup-level').textContent = levelLabel('web');
    $('#setup-continue').hidden = true; $('#setup-later').hidden = false;
    $('#setup-note').hidden = true;
    return;
  }
  const req = requiredIds();
  const rows = P.perms.filter((p) => p.status !== 'na');
  rows.sort((a, b) => (req.has(b.id) ? 1 : 0) - (req.has(a.id) ? 1 : 0));
  list.innerHTML = rows.map((p) => rowHtml(p, req.has(p.id))).join('');
  const reqRows = rows.filter((p) => req.has(p.id));
  const done = reqRows.filter((p) => prot.permStatus(p.id) === 'granted').length;
  const total = reqRows.length;
  $('#setup-summary').textContent = total ? t('setup.summary', { done, total }) : t('setup.allSet');
  $('#setup-progress').style.transform = `scaleX(${total ? done / total : 1})`;
  $('#setup-level').textContent = levelLabel(P.level);
  $('#setup-level').className = 'chip ' + (prot.isStrong(P.level) ? 'ok' : 'warn');
  const allOk = prot.missingForBest().length === 0;
  $('#setup-continue').hidden = false;
  $('#setup-continue').textContent = allOk ? t('setup.continue') : t('setup.continueAnyway');
  $('#setup-later').hidden = allOk;
  // platformaga xos eslatmalar
  const note = $('#setup-note');
  const lines = [];
  const info = P.info || {};
  if (info.platform === 'android' && info.flavor === 'direct' && prot.permStatus('accessibility') !== 'granted') lines.push(t('setup.note.restricted'));
  if (info.platform === 'ios') lines.push(t('setup.note.focus'));
  if (info.platform === 'ios' && !prot.isStrong(P.level)) lines.push(t('setup.note.ios0'));
  note.innerHTML = lines.map((l) => `<p>${esc(l)}</p>`).join('');
  note.hidden = !lines.length;
}
onEnter('s-setup', async () => { await prot.refreshPermissions(); renderSetup(); });
bus.on('permissions-changed', () => { if (currentScreen() === 's-setup') renderSetup(); updateHomeReady(); });
onLangChange(() => { if (currentScreen() === 's-setup') renderSetup(); });

actions['perm-fix'] = async (el) => {
  const id = el.dataset.id;
  el.disabled = true;
  const r = await prot.requestPermission(id);
  if (!r) toast(t('setup.noReply'));
  else if (prot.permStatus(id) !== 'granted' && r.status === 'denied') toast(t('setup.denied'));
};
actions['perm-settings'] = (el) => prot.openSettings(el.dataset.id);

// ---------------------------------------------------------------- yo'riqnoma
let guideId = '';
function stepsFor(id) {
  const brand = oemOf(prot.P.info && prot.P.info.brand);
  const tryKeys = [`guide.${id}.${brand}`, `guide.${id}.default`];
  for (const k of tryKeys) { const v = t(k); if (v !== k) return { steps: v.split('\n'), brand }; }
  return { steps: [], brand };
}

/** Sxema: telefon ekrani va ajratilgan qator (taxminiy — aniq nomlar telefon modeliga qarab farq qiladi). */
function schematic(n, total) {
  const rows = Array.from({ length: 5 }, (_, i) => {
    const y = 34 + i * 26, hot = i === (n % 5);
    return `<rect x="22" y="${y}" width="76" height="18" rx="6" class="${hot ? 'hot' : ''}"/>`;
  }).join('');
  return `<svg class="schem" viewBox="0 0 120 180" aria-hidden="true"><rect x="8" y="4" width="104" height="172" rx="16" class="frame"/><rect x="40" y="10" width="40" height="5" rx="2.5" class="frame2"/>${rows}</svg>`;
}

export function openGuide(id) {
  guideId = id;
  const { steps, brand } = stepsFor(id);
  $('#guide-title').textContent = t('perm.' + id + '.t');
  const nameBrand = brand === 'default' ? '' : `<span class="chip">${esc(t('guide.brand.' + brand))}</span>`;
  $('#guide-body').innerHTML = `${nameBrand}<ol class="steps">${steps.map((s, i) => `<li><span class="sn">${i + 1}</span><span>${esc(s)}</span></li>`).join('')}</ol>
    <div class="row" style="justify-content:center">${schematic(Math.min(steps.length - 1, 3), steps.length)}</div><p class="muted small" style="text-align:center">${esc(t('guide.schematic'))}</p>`;
  const canOpen = native.present && id !== 'pinning';
  $('#guide-open').hidden = !canOpen;
  // holatini tekshirib bo'lmaydigan ruxsatlar uchun foydalanuvchi "Sozladim" deydi
  const p = prot.P.perms.find((x) => x.id === id);
  $('#guide-done').hidden = !(p && p.status === 'unknown');
  openOverlay('o-guide');
}
actions['perm-guide'] = (el) => openGuide(el.dataset.id);
actions['guide-open'] = () => { prot.openSettings(guideId); };
actions['guide-done'] = () => { prot.confirmManual(guideId); closeOverlay('o-guide'); };

// ---------------------------------------------------------------- tayyorlik tekshiruvi
const ITEMS = ['server', 'permissions', 'protection', 'attestation'];
function readyRow(id, state, detail) {
  const cls = state === 'ok' ? 'ok' : state === 'fail' ? 'bad' : 'wait';
  const ic = state === 'ok' ? icon('check', 'sm') : state === 'fail' ? icon('x', 'sm') : '<span class="spinner tiny"></span>';
  return `<div class="glass perm ${cls}"><div class="perm-tx"><b>${esc(t('ready.item.' + id))}</b><span class="muted small">${esc(detail || '')}</span></div><span class="pstat ${cls}">${ic}</span></div>`;
}

function detailFor(it) {
  if (it.id === 'server') return it.ok ? t('ready.server.ok', { ms: it.detail }) : t('ready.server.fail');
  if (it.id === 'permissions') return it.ok ? t('ready.permissions.ok') : t('ready.permissions.fail', { list: String(it.detail || '').split(',').filter(Boolean).map((x) => t('perm.' + x + '.t')).join(', ') });
  if (it.id === 'protection') return it.ok ? t('ready.protection.ok') : t('ready.protection.fail.' + (it.detail || 'unknown'));
  if (it.id === 'attestation') return it.ok ? t('ready.attestation.ok') : t('ready.attestation.fail');
  return '';
}
let running = false;
export async function runReadiness() {
  if (running) return;
  running = true;
  const btn = $('#ready-run');
  btn.disabled = true;
  $('#ready-result').hidden = true;
  const list = $('#ready-list');
  list.innerHTML = ITEMS.filter((id) => native.present || id === 'server' || id === 'protection').map((id) => readyRow(id, 'wait', t('ready.checking'))).join('');
  let res;
  try { res = await prot.readiness({ dry: true }); } catch { res = { items: [{ id: 'server', ok: false }], ok: false, level: prot.P.level }; }
  list.innerHTML = res.items.map((it) => readyRow(it.id, it.ok ? 'ok' : 'fail', detailFor(it))).join('');
  const box = $('#ready-result');
  box.hidden = false;
  const strong = prot.isStrong(res.level);
  box.innerHTML = `<div class="result-ico" style="background:${res.ok ? 'linear-gradient(135deg,#10b981,#06b6d4)' : 'linear-gradient(135deg,#f59e0b,#ef4444)'}">${icon(res.ok ? 'shield-check' : 'alert')}</div>
    <h2 class="h2">${esc(res.ok ? t('ready.ok') : t('ready.notOk'))}</h2>
    <p class="muted">${esc(res.ok ? t('ready.okText', { level: levelLabel(res.level) }) : (!native.present ? t('ready.webText') : strong ? t('ready.fixText') : t('ready.weakText', { level: levelLabel(res.level) })))}</p>`;
  btn.disabled = false;
  btn.textContent = t('ready.again');
  running = false;
  updateHomeReady();
  bus.emit('readiness', res);
  return res;
}
actions['ready-run'] = () => runReadiness();
actions['open-ready'] = () => push('s-ready');
actions['open-setup'] = () => push('s-setup');
onEnter('s-ready', () => { $('#ready-list').innerHTML = ''; $('#ready-result').hidden = true; $('#ready-run').textContent = t('ready.run'); });

// ---------------------------------------------------------------- bosh sahifadagi karta
export function updateHomeReady() {
  const card = $('#home-ready');
  if (!card) return;
  const last = prot.lastReadiness();
  const fresh = last && Date.now() - last.at < 7 * 86400000;
  const state = !native.present ? 'web' : fresh && last.ok ? 'ok' : fresh ? 'warn' : 'new';
  card.dataset.state = state;
  const ic = $('#home-ready-ic');
  ic.className = 'rc-ic ' + (state === 'ok' ? 'ok' : state === 'warn' ? 'warn' : '');
  ic.innerHTML = icon(state === 'ok' ? 'shield-check' : 'shield');
  $('#home-ready-sub').textContent = state === 'ok' ? t('ready.homeOk', { level: levelLabel(last.level) }) : state === 'warn' ? t('ready.homeWarn') : state === 'web' ? t('ready.homeWeb') : t('ready.homeSub');
}
onLangChange(updateHomeReady);
