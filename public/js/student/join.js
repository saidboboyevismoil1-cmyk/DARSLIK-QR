// Darsga qo'shilish oqimi: ma'lumot → (guruh ro'yxati) → (himoya talabi / ilova kerak) → (himoyasiz kirish so'rovi) → qo'shilish.
import { $, esc, icon } from './util.js';
import { S, bus, actions, push, pop, currentScreen } from './state.js';
import { t } from './i18n.js';
import { native } from './native.js';
import * as net from './net.js';
import * as prot from './protection.js';
import { askConfirm } from './lesson.js';

let pendingInfo = null;          // qo'shilish kutilayotgan dars ma'lumoti
let busy = false;

const codeInput = () => $('#code-input');
export function setJoinUi(b) {
  busy = b;
  const btn = $('#code-btn');
  btn.disabled = b;
  btn.textContent = b ? t('home.joining') : t('home.join');
  codeInput().disabled = b;
}
const showErr = (msg) => { $('#code-err').textContent = msg || ''; };
const hideGate = () => { $('#join-gate').hidden = true; };

function errText(code, fallback) {
  const k = 'join.err.' + code;
  const v = t(k);
  return v === k ? fallback || t('join.err.generic') : v;
}

// ---------------------------------------------------------------- bosh oqim
export async function startJoin(code) {
  if (busy) return;
  hideGate(); showErr('');
  if (!S.name) { S.pendingCode = code; bus.emit('need-name'); return; }
  codeInput().value = code;
  setJoinUi(true);
  let info;
  try { info = await net.fetchInfo(code); }
  catch (e) { setJoinUi(false); showErr(errText(e.code, null)); return; }
  pendingInfo = info;
  await proceed(info, {});
}

/** Qo'shilish shartlarini tekshirib, kerak bo'lsa tegishli ekranga yo'naltiradi. */
async function proceed(info, extras) {
  try {
    if (info.rosterRequired && !extras.rosterStudentId) {
      const id = await rosterFlow(info);
      if (!id) { setJoinUi(false); return; }
      extras = { ...extras, rosterStudentId: id };
    }
    if (prot.requiredFor(info) && !extras.exemptionToken) {
      if (!native.present) { setJoinUi(false); push('s-needapp'); return; }
      await prot.refreshPermissions();
      const level = prot.P.level;
      if (!(prot.P.server.requiredLevels || []).includes(level)) { setJoinUi(false); showGate(); return; }
    }
    await joinNow(info, extras);
  } catch (e) {
    console.error(e);
    setJoinUi(false);
    showErr(t('join.err.generic'));
  }
}

async function joinNow(info, extras) {
  const prep = await prot.prepareJoin(info);
  if (!prep.ok) { setJoinUi(false); showErr(t('join.err.protection_failed')); showGate(); return; }
  const base = await prot.joinExtras(info);
  await net.join(info.id, { ...base, ...(extras.rosterStudentId ? { rosterStudentId: extras.rosterStudentId } : {}), ...(extras.exemptionToken ? { exemptionToken: extras.exemptionToken } : {}) });
}

// ---------------------------------------------------------------- himoya shlyuzi (bosh sahifadagi karta)
function showGate() {
  const miss = prot.missingForBest();
  $('#gate-missing').innerHTML = miss.length
    ? miss.map((id) => `<li>${icon('x', 'sm')}<span>${esc(t('perm.' + id + '.t'))}</span></li>`).join('')
    : `<li>${icon('alert', 'sm')}<span>${esc(t('gate.generic'))}</span></li>`;
  $('#join-gate').hidden = false;
  $('#join-gate').scrollIntoView({ block: 'center', behavior: 'smooth' });
}
actions['gate-setup'] = () => push('s-setup');
bus.on('permissions-changed', () => { if (!$('#join-gate').hidden && pendingInfo && !busy) { const lvl = prot.P.level; if ((prot.P.server.requiredLevels || []).includes(lvl)) { hideGate(); showErr(''); } } });

// ---------------------------------------------------------------- guruh ro'yxati
let rosterResolve = null;
let rosterData = null;

async function rosterFlow(info) {
  const key = await prot.deviceKey();
  let data;
  try { data = await fetch(`/api/sessions/${encodeURIComponent(info.id)}/roster?deviceKey=${encodeURIComponent(key)}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))); }
  catch { showErr(t('join.err.network')); return null; }
  if (data.boundTo) return data.boundTo;           // qurilma allaqachon bog'langan — qayta tanlanmaydi
  rosterData = { info, key, ...data };
  $('#roster-group').textContent = data.groupName || t('roster.title');
  $('#roster-search').value = '';
  $('#roster-err').textContent = '';
  renderRoster('');
  push('s-roster');
  return new Promise((res) => { rosterResolve = res; });
}

function renderRoster(q) {
  const list = $('#roster-list');
  const norm = (s) => s.toLowerCase().normalize('NFKC');
  const items = rosterData.students.filter((s) => !q || norm(s.name).includes(norm(q)));
  if (!items.length) { list.innerHTML = `<div class="glass empty"><h3>${esc(t('roster.none'))}</h3></div>`; return; }
  list.innerHTML = items.map((s) => `<button class="glass item" data-act="roster-pick" data-id="${esc(s.id)}" ${s.taken ? 'disabled' : ''}>
      <span class="avatar" style="width:40px;height:40px;border-radius:14px">${esc(s.name.trim().charAt(0).toUpperCase())}</span>
      <span class="it"><b>${esc(s.name)}</b></span>${s.taken ? `<span class="chip">${esc(t('roster.taken'))}</span>` : icon('next', 'sm muted')}</button>`).join('');
}
$('#roster-search').addEventListener('input', (e) => { if (rosterData) renderRoster(e.target.value.trim()); });

actions['roster-pick'] = (el) => {
  const s = rosterData.students.find((x) => x.id === el.dataset.id);
  if (!s) return;
  askConfirm({ title: t('roster.confirmT'), text: t('roster.confirmD', { name: s.name }), ok: t('roster.confirmOk') }, async () => {
    const r = await fetch(`/api/sessions/${encodeURIComponent(rosterData.info.id)}/roster/bind`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rosterStudentId: s.id, deviceKey: rosterData.key, platform: native.present ? native.platform : 'web' }) });
    if (r.ok) { const f = rosterResolve; rosterResolve = null; pop(); if (f) f(s.id); return; }
    const j = await r.json().catch(() => ({}));
    $('#roster-err').textContent = t('roster.err.' + (j.code || 'generic'));
    if (j.code === 'name_taken') { s.taken = true; renderRoster($('#roster-search').value.trim()); }
  });
};

// ---------------------------------------------------------------- himoyasiz kirish so'rovi
let exempt = null;   // { id, secret, timer }

actions['gate-exempt'] = () => {
  if (!pendingInfo) return;
  $('#exempt-name').value = S.name || '';
  $('#exempt-err').textContent = '';
  $('#exempt-form-box').hidden = false; $('#exempt-wait').hidden = true;
  document.querySelectorAll('input[name=exreason]').forEach((r) => { r.checked = false; });
  if (currentScreen() === 's-needapp') pop();
  push('s-exempt');
};

actions['exempt-send'] = async () => {
  const reason = (document.querySelector('input[name=exreason]:checked') || {}).value;
  const name = $('#exempt-name').value.trim();
  if (!reason) { $('#exempt-err').textContent = t('exempt.errReason'); return; }
  if (name.length < 2) { $('#exempt-err').textContent = t('name.err'); return; }
  const r = await fetch(`/api/sessions/${encodeURIComponent(pendingInfo.id)}/exemption-requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, reason, device: net.deviceName() }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { $('#exempt-err').textContent = t(j.error === 'too_many' ? 'exempt.errMany' : 'join.err.generic'); return; }
  exempt = { id: j.id, secret: j.secret, name };
  S.name = S.name || name;
  $('#exempt-form-box').hidden = true; $('#exempt-wait').hidden = false;
  $('#exempt-wait-title').textContent = t('exempt.waiting'); $('#exempt-wait-text').textContent = t('exempt.waitText');
  pollExemption();
};

function stopExempt() { if (exempt && exempt.timer) clearTimeout(exempt.timer); exempt = null; }
async function pollExemption() {
  if (!exempt) return;
  const cur = exempt;
  try {
    const r = await fetch(`/api/access-requests/${cur.id}?secret=${encodeURIComponent(cur.secret)}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j.status === 'approved' && j.token) {
        stopExempt();
        pop();
        setJoinUi(true);
        await joinNow(pendingInfo, { exemptionToken: j.token });
        return;
      }
      if (j.status === 'denied') {
        $('#exempt-wait-title').textContent = t('exempt.denied');
        $('#exempt-wait-text').textContent = t('exempt.deniedText');
        stopExempt();
        return;
      }
    }
  } catch { /* tarmoq vaqtincha yo'q */ }
  if (exempt === cur) cur.timer = setTimeout(pollExemption, 3000);
}
actions['exempt-cancel'] = () => { stopExempt(); pop(); };

// ---------------------------------------------------------------- natijalar
bus.on('join-fail', async ({ message, code }) => {
  setJoinUi(false);
  if (prot.P.lessonActive) await prot.stopLesson('join_failed');
  if (currentScreen() === 's-scan') pop();
  if (['protection_required', 'protection_inactive', 'app_required'].includes(code)) { showErr(errText(code, message)); if (code === 'app_required' && !native.present) push('s-needapp'); else showGate(); return; }
  if (code === 'roster_not_bound' || code === 'roster_required') { showErr(errText(code, message)); return; }
  showErr(errText(code, message));
  try { navigator.vibrate && navigator.vibrate(60); } catch { /* ignore */ }
});
bus.on('applied', () => { setJoinUi(false); codeInput().value = ''; hideGate(); pendingInfo = null; });
bus.on('joining', () => { setJoinUi(true); });
