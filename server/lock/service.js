// "Dars rejimi" xizmati: himoya darajasi, qo'shilish gating'i, heartbeat, holat mashinasi,
// qoidalar (ball), ochish (release), so'rovlar, hisobot.
// Eski server.js (db.sessions/db.teachers, socket hodisalari) bilan faqat kichik "hook"lar orqali bog'lanadi.
const crypto = require('crypto');
const settingsRepo = require('../repos/settings');
const usersRepo = require('../repos/users');
const rostersRepo = require('../repos/rosters');
const lockdataRepo = require('../repos/lockdata');
const requestsRepo = require('../repos/requests');
const telemetryRepo = require('../repos/telemetry');
const levels = require('./levels');
const rules = require('./rules');
const attestation = require('./attestation');

const TICK_MS = 2000;
const FLUSH_EVERY = 8;            // tick'lar: ~16 s
const OVERVIEW_MS = 5000;
const MAX_DT = 6000;              // bitta tick'da hisoblanadigan eng katta vaqt (server pauzasi xato yig'masligi uchun)
const MIN_BEAT_GAP_MS = 1000;

function createService({ io, legacy, sql, config, helpers }) {
  const uuid = helpers.uuid;
  const settings = settingsRepo.create(sql, { envFlags: config.flags });
  const users = usersRepo.create(sql);
  const rosters = rostersRepo.create(sql, uuid);
  const lockdata = lockdataRepo.create(sql);
  const requests = requestsRepo.create(sql, uuid);
  const telemetry = telemetryRepo.create(sql, () => settings.effective()['telemetry.enabled']);

  const live = new Map();                                  // `${sessionId}:${studentId}` → Live
  const key = (sid, stid) => `${sid}:${stid}`;
  const sessionById = (id) => legacy.sessions.find((s) => s.id === id);
  const teacherOf = (session) => legacy.teachers.find((t) => t.id === session.teacherId);
  const facultyOf = (session) => { const t = teacherOf(session); return t ? t.facultyId || null : null; };
  const settingsFor = (session) => session.lockSettings || settings.effective(facultyOf(session));
  const endsAtMs = (session) => Date.parse(session.createdAt) + (session.duration || 45) * 60000;
  const teacherRoom = (sid) => `teacher-${sid}`;
  const hasListeners = (sid) => { const r = io.sockets.adapter.rooms.get(teacherRoom(sid)); return !!(r && r.size); };
  const effectiveLocked = (session, student) => session.locked === true && !(student && student.released);

  // ---------------------------------------------------------------- hodisalar
  function logEvent(session, student, type, data) {
    const def = levels.EVENTS[type] || { sev: 'info' };
    const L = student && live.get(key(session.id, student.id));
    const ev = { sessionId: session.id, studentId: student ? student.id : '', type, severity: def.sev, level: (L && L.level) || (student && student.level) || null, data: data || null, ts: Date.now() };
    if (session.demo) { ev.id = 0; } else ev.id = lockdata.addEvent(ev);
    if (def.bypass && L) { L.bypassCount++; L.lastBypassAt = ev.ts; telemetry.inc('bypass', type, ev.level || ''); }
    io.to(teacherRoom(session.id)).emit('lock-event', { ...ev, studentName: student ? student.name : '' });
    return ev;
  }

  // ---------------------------------------------------------------- sessiya yaratish hook'i
  function decorateNewSession(session, body, teacher) {
    const eff = settings.effective(teacher.facultyId || null);
    session.protection = ['optional', 'required'].includes(body && body.protection) ? body.protection : eff['protection.default'];
    session.rosterGroupId = null;
    if (body && body.rosterGroupId) {
      const g = rosters.group(String(body.rosterGroupId));
      if (g && (g.teacher_id === teacher.id || teacher.role === 'admin')) session.rosterGroupId = g.id;
    }
    session.lockSettings = eff;           // dars davomida qoidalar o'zgarmasligi uchun snapshot
    session.demo = false;
    telemetry.inc('lessons', session.protection);
  }

  // ---------------------------------------------------------------- qo'shilish gating'i
  const fail = (code, message) => ({ ok: false, code, message });

  async function gateJoin(socket, session, data) {
    data = data || {};
    const st = settingsFor(session);
    const client = levels.normalizeClient(data.client, st);
    let name = String(data.studentName || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 80);
    const deviceKey = typeof data.deviceKey === 'string' && data.deviceKey.length >= 16 && data.deviceKey.length <= 128 ? data.deviceKey : '';

    let rosterStudent = null;
    if (session.rosterGroupId) {
      const rs = rosters.student(String(data.rosterStudentId || ''));
      if (!rs || rs.group_id !== session.rosterGroupId) return fail('roster_required', "Ro'yxatdan ismingizni tanlang");
      if (!deviceKey || !rosters.hasBindingWith(rs.id, deviceKey)) return fail('roster_not_bound', "Bu ism qurilmangizga bog'lanmagan");
      rosterStudent = rs; name = rs.full_name;
    } else if (!name) return fail('name_required', 'Ismingizni kiriting');

    const exempt = data.exemptionToken ? requests.consumeExemption(data.exemptionToken, session.id) : null;
    const required = session.protection === 'required' && !session.demo && !exempt;
    if (required) {
      if (client.type !== 'app') return fail('app_required', 'Bu dars uchun EduFocus ilovasi kerak');
      if (!st['protection.requiredLevels'].includes(client.level)) return fail('protection_required', 'Bu qurilmada dars himoyasi qo\'llab-quvvatlanmaydi. Himoyasiz kirish so\'rovini yuboring');
    }

    let att = { ok: true, verified: false, reason: '' };
    if (client.type === 'app' && !session.demo) {
      const a = data.attestation || {};
      att = await attestation.check({ db: sql, cfg: config.attestation }, { platform: client.platform, sessionId: session.id, nonce: a.nonce, token: a.token, keyId: a.keyId });
      if (!att.ok) return fail('attestation_failed', 'Ilovaning haqiqiyligini tasdiqlab bo\'lmadi');
    }

    const protection = levels.normalizeProtection(data.protection);
    if (required && !protection.active) return fail('protection_inactive', 'Dars himoyasi yoqilmagan. Sozlamalarni tekshiring');

    return { ok: true, client, name, rosterStudent, deviceKey, exempt: !!exempt, attested: att.verified, attReason: att.reason, protection };
  }

  /** Mavjud talabani qayta ishlatish (ro'yxatdagi ism bilan qayta kirish: ilova qayta o'rnatilgan va h.k.). */
  function findExisting(session, gate) {
    if (!gate.rosterStudent) return null;
    return session.students.find((s) => s.rosterStudentId === gate.rosterStudent.id) || null;
  }

  function newLive(session, student, client, protection) {
    const L = {
      sessionId: session.id, studentId: student.id, level: client.level, client, socketId: null,
      active: protection.active, reasons: protection.reasons, checks: protection.checks, fg: true,
      lastBeat: Date.now(), lastHb: 0, lastTick: Date.now(), status: protection.active ? 'protected' : 'unprotected', statusSince: Date.now(),
      ms: { protected: 0, unprotected: 0, offline: 0, assumed: 0, free: 0 }, bypassCount: 0, lastBypassAt: 0,
      flags: { focusZero: false, absent: false }, seq: 0,
    };
    live.set(key(session.id, student.id), L);
    return L;
  }

  function restoreLive(session, student, client, protection) {
    const L = newLive(session, student, client, protection);
    const row = lockdata.stats(session.id).find((r) => r.student_id === student.id);
    if (row) {
      L.ms = { protected: row.protected_ms, unprotected: row.unprotected_ms, offline: row.offline_ms, assumed: row.assumed_ms, free: row.free_ms || 0 };
      L.bypassCount = row.bypass_count; L.flags = { focusZero: !!row.focus_zero, absent: !!row.absent };
    }
    return L;
  }

  function onJoined(socket, session, student, gate, reused) {
    student.level = gate.client.level;
    student.clientInfo = { platform: gate.client.platform, appVersion: gate.client.appVersion, flavor: gate.client.flavor, brand: gate.client.brand };
    student.attested = gate.attested;
    student.exempt = gate.exempt;
    if (gate.rosterStudent) student.rosterStudentId = gate.rosterStudent.id;
    if (gate.deviceKey) student.dkh = rostersRepo.sha(gate.deviceKey);
    if (gate.rosterStudent) rosters.touch(gate.rosterStudent.id);

    const k = key(session.id, student.id);
    let L = live.get(k);
    if (!L) L = reused ? restoreLive(session, student, gate.client, gate.protection) : newLive(session, student, gate.client, gate.protection);
    L.socketId = socket.id; L.level = gate.client.level; L.client = gate.client; L.lastBeat = Date.now();
    applyProtection(L, gate.protection);
    if (!session.demo) {
      if (!reused) { telemetry.inc('students_by_level', L.level); if (L.client.brand) telemetry.inc('students_by_brand', L.client.brand); }
      flushOne(session, student, L);
    }
    refreshStatus(session, student, L, Date.now(), settingsFor(session));
    logEvent(session, student, reused ? 'heartbeat_restored' : 'joined', { level: L.level, attested: gate.attested, attReason: gate.attReason || undefined, exempt: gate.exempt || undefined });
    emitOverview(session);
  }

  /** Rejoin: qurilma kaliti tekshiriladi (boshqa qurilma talabaning o'rnini egallamasligi uchun). */
  function gateRejoin(session, student, data) {
    data = data || {};
    if (student.dkh) {
      const dk = typeof data.deviceKey === 'string' ? data.deviceKey : '';
      if (!dk || rostersRepo.sha(dk) !== student.dkh) return fail('device_mismatch', 'Qurilma mos kelmadi');
    }
    return { ok: true };
  }

  function onRejoined(socket, session, student, data) {
    data = data || {};
    const st = settingsFor(session);
    const client = levels.normalizeClient(data.client || { type: student.clientInfo && student.clientInfo.platform !== 'web' ? 'app' : 'web', ...(student.clientInfo || {}), level: student.level }, st);
    const protection = levels.normalizeProtection(data.protection);
    const k = key(session.id, student.id);
    let L = live.get(k) || restoreLive(session, student, client, protection);
    accrue(L, Date.now());
    L.socketId = socket.id; L.lastBeat = Date.now();
    if (L.level !== client.level) { logEvent(session, student, 'level_changed', { from: L.level, to: client.level }); L.level = client.level; student.level = client.level; }
    applyProtection(L, protection);
    if (data.offlineReleased) logEvent(session, student, 'released_offline', { minutes: st['release.offlineMinutes'] });
    refreshStatus(session, student, L, Date.now(), st);
    emitOverview(session);
  }

  // ---------------------------------------------------------------- holat mashinasi
  function accrue(L, now) {
    const dt = Math.max(0, Math.min(now - L.lastTick, MAX_DT));
    L.ms[L.status] += dt;
    L.lastTick = now;
  }

  function classify(L, now, st, free) {
    if (free) return 'free';                            // qulf ochiq: talaba erkin — jarima ham, "himoya" ham hisoblanmaydi
    if (now - L.lastBeat >= st['heartbeat.offlineAfterSec'] * 1000) {
      const c = levels.offlineClass(L.level, st);
      return c;                                         // offline | assumed | unprotected
    }
    return L.active ? 'protected' : 'unprotected';
  }

  function applyProtection(L, p) {
    L.active = p.active; L.reasons = p.reasons; L.checks = { ...L.checks, ...p.checks };
  }

  function refreshStatus(session, student, L, now, st) {
    const next = classify(L, now, st, !effectiveLocked(session, student));
    if (next !== L.status) {
      const prev = L.status, since = L.statusSince;
      L.status = next; L.statusSince = now;
      const away = (x) => x === 'offline' || x === 'assumed';
      const base = prev === 'free' ? 'protected' : prev;       // erkin davrdan qaytganda "himoyali" holatdan boshlaymiz
      if (next === 'free') { /* qulf ochildi: jarima to'xtaydi; ochish hodisasi alohida jurnalga yoziladi */ }
      else if (away(next) && !away(base)) { L.awayFrom = L.lastBeat; logEvent(session, student, 'heartbeat_lost', { assumed: next === 'assumed' || undefined }); }
      else if (!away(next) && away(base)) logEvent(session, student, 'heartbeat_restored', { offlineMs: now - (L.awayFrom || since) });   // oxirgi heartbeat'dan beri
      else if (next === 'unprotected' && base === 'protected') logEvent(session, student, levels.isStrong(L.level) ? 'protection_lost' : 'left_page', { reasons: L.reasons });
      else if (next === 'protected' && base === 'unprotected') logEvent(session, student, 'protection_restored', { durationMs: now - since });
    }
    const f = rules.evaluateFlags(L.ms, st);
    if (f.focusZero && !L.flags.focusZero) { L.flags.focusZero = true; logEvent(session, student, 'rule_focus_zero', { unprotectedSec: f.unprotectedSec }); notifyStudent(L, 'lock-rule', { rule: 'focus_zero', unprotectedSec: f.unprotectedSec }); }
    if (f.absent && !L.flags.absent) { L.flags.absent = true; logEvent(session, student, 'rule_absent', { unprotectedSec: f.unprotectedSec }); notifyStudent(L, 'lock-rule', { rule: 'absent', unprotectedSec: f.unprotectedSec }); }
  }

  const notifyStudent = (L, evt, data) => { if (L && L.socketId) io.to(L.socketId).emit(evt, data); };

  function onHeartbeat(socket, data) {
    const sd = socket.studentData;
    data = data || {};
    if (!sd || data.sessionId !== sd.sessionId || data.studentId !== sd.studentId) return;
    const session = sessionById(sd.sessionId);
    if (!session || session.status !== 'active') return;
    const student = session.students.find((s) => s.id === sd.studentId);
    const L = live.get(key(sd.sessionId, sd.studentId));
    if (!student || !L) return;
    const now = Date.now();
    if (now - L.lastHb < MIN_BEAT_GAP_MS) return;       // haddan tashqari tez yuborishdan himoya
    L.lastHb = now;
    const st = settingsFor(session);

    accrue(L, now);
    const p = levels.normalizeProtection(data.protection);
    // bypass'lar: oldingi va yangi tekshiruvlar farqidan
    for (const type of levels.diffChecks(L.checks, p.checks, L.level)) logEvent(session, student, type, { reasons: p.reasons });
    if (typeof data.level === 'string') {
      const lvl = levels.normalizeClient({ type: 'app', platform: L.client.platform, level: data.level, flavor: L.client.flavor }, st).level;
      if (lvl !== L.level && L.client.type === 'app') { logEvent(session, student, 'level_changed', { from: L.level, to: lvl }); L.level = lvl; student.level = lvl; }
    }
    L.lastBeat = now; L.seq = Number(data.seq) || L.seq + 1; L.fg = data.fg !== false;
    applyProtection(L, p);
    refreshStatus(session, student, L, now, st);

    const td = helpers.getSessionTimeDetails(session);
    socket.emit('heartbeat-ack', { serverTime: now, remainingSeconds: td.remainingSeconds, totalSeconds: td.totalSeconds, locked: effectiveLocked(session, student), seq: L.seq });
  }

  function onClientEvent(socket, data) {
    const sd = socket.studentData; data = data || {};
    if (!sd || data.sessionId !== sd.sessionId || data.studentId !== sd.studentId) return;
    if (!levels.clientEventTypes.has(data.type)) return;
    const session = sessionById(sd.sessionId);
    if (!session || session.status !== 'active') return;
    const student = session.students.find((s) => s.id === sd.studentId);
    const L = live.get(key(sd.sessionId, sd.studentId));
    if (!student || !L) return;
    const now = Date.now();
    if (data.type === 'sos') { if (now - (L.lastSos || 0) < 10000) return; L.lastSos = now; }
    accrue(L, now);
    logEvent(session, student, data.type, null);
    if (data.type !== 'sos') { L.active = false; L.reasons = ['permission_revoked']; }
    refreshStatus(session, student, L, now, settingsFor(session));
    emitOverview(session);
  }

  // ---------------------------------------------------------------- tick
  let tickN = 0;
  function tick() {
    const now = Date.now();
    tickN++;
    for (const [k, L] of [...live.entries()]) {
      const session = sessionById(L.sessionId);
      if (!session || session.status !== 'active') { live.delete(k); continue; }
      const student = session.students.find((s) => s.id === L.studentId);
      if (!student) { live.delete(k); continue; }
      accrue(L, now);
      refreshStatus(session, student, L, now, settingsFor(session));
    }
    // dars taymeri: server vaqti bo'yicha avtomatik ochish
    for (const session of legacy.sessions) {
      if (session.status === 'active' && session.locked && !session.timerReleased && now >= endsAtMs(session)) {
        session.timerReleased = true;
        releaseStudents(session, null, 'timer', 'system');
      }
    }
    if (tickN % FLUSH_EVERY === 0) flushAll();
    if (tickN % Math.round(OVERVIEW_MS / TICK_MS) === 0) {
      for (const session of legacy.sessions) if (session.status === 'active' && hasListeners(session.id)) emitOverview(session);
    }
  }

  // ---------------------------------------------------------------- saqlash
  function statsRow(session, student, L) {
    return { sessionId: session.id, studentId: student.id, name: student.name, rosterStudentId: student.rosterStudentId, level: L.level, joinedAt: Date.parse(student.joinedAt) || Date.now(), ms: L.ms, bypassCount: L.bypassCount, focusZero: L.flags.focusZero, absent: L.flags.absent };
  }
  function flushOne(session, student, L) { if (!session.demo) lockdata.upsertStats(statsRow(session, student, L)); }
  function flushAll() {
    sql.transaction(() => {
      for (const L of live.values()) {
        const session = sessionById(L.sessionId); if (!session || session.demo) continue;
        const student = session.students.find((s) => s.id === L.studentId); if (student) lockdata.upsertStats(statsRow(session, student, L));
      }
    });
  }

  // ---------------------------------------------------------------- ochish / qulflash
  function releaseStudents(session, ids, reason, by) {
    const targets = ids ? session.students.filter((s) => ids.includes(s.id)) : session.students;
    const type = reason === 'timer' ? 'released_timer' : 'released';
    if (!ids) {
      session.locked = false;
      io.to(`session-${session.id}`).emit('session-unlocked', { message: reason === 'timer' ? 'Dars vaqti tugadi. Telefondan foydalanishingiz mumkin.' : 'Ustoz ruxsat berdi! Telefoningizdan foydalanishingiz mumkin.', reason });
    } else {
      for (const s of targets) {
        s.released = true;
        const L = live.get(key(session.id, s.id));
        if (L && L.socketId) io.to(L.socketId).emit('session-unlocked', { message: 'Ustoz sizga ruxsat berdi.', reason, individual: true });
      }
    }
    for (const s of targets) logEvent(session, s, type, { reason, by: by || null });
    helpers.saveSessions();
    return targets.length;
  }

  function relockStudents(session, ids, by) {
    if (!ids) {
      session.locked = true; session.timerReleased = false;
      session.students.forEach((s) => { s.released = false; });
      io.to(`session-${session.id}`).emit('session-locked', { message: 'Ustoz telefonni blokladi.', ...helpers.getSessionTimeDetails(session) });
    } else {
      for (const s of session.students.filter((x) => ids.includes(x.id))) {
        s.released = false;
        const L = live.get(key(session.id, s.id));
        if (L && L.socketId && session.locked) io.to(L.socketId).emit('session-locked', { message: 'Ustoz telefonni blokladi.', ...helpers.getSessionTimeDetails(session) });
      }
    }
    for (const s of ids ? session.students.filter((x) => ids.includes(x.id)) : session.students) logEvent(session, s, 'relocked', { by: by || null });
    helpers.saveSessions();
  }

  // Eski /unlock va /lock endpoint'lari uchun hook'lar
  const onGlobalUnlock = (session, by) => { for (const s of session.students) logEvent(session, s, 'released', { reason: 'teacher', by: by || null }); };
  const onGlobalLock = (session) => { session.timerReleased = false; session.students.forEach((s) => { s.released = false; }); };

  function extend(session, minutes) {
    session.duration = (session.duration || 45) + minutes;
    session.timerReleased = false;
    helpers.saveSessions();
    return helpers.getSessionTimeDetails(session);
  }

  // ---------------------------------------------------------------- so'rovlar
  function requestExemption(session, { name, reason, device }) {
    name = String(name || '').trim().slice(0, 80);
    if (!name) return { error: 'name_required' };
    if (!['old_phone', 'tech_issue', 'no_phone'].includes(reason)) return { error: 'bad_reason' };
    if (requests.pendingCount(session.id, 'exemption', name) >= 2) return { error: 'too_many' };
    const r = requests.create({ sessionId: session.id, kind: 'exemption', studentName: name, reason, device: String(device || '').slice(0, 60) });
    io.to(teacherRoom(session.id)).emit('access-request', { id: r.id, kind: 'exemption', studentName: name, reason, device, sessionId: session.id, ts: Date.now() });
    telemetry.inc('exemption_requests', reason);
    return r;
  }

  function requestEmergency(socket, data) {
    const sd = socket.studentData; data = data || {};
    if (!sd) return;
    const session = sessionById(sd.sessionId);
    if (!session || session.status !== 'active') return;
    const student = session.students.find((s) => s.id === sd.studentId);
    if (!student || !effectiveLocked(session, student)) return;
    if (requests.pendingCount(session.id, 'emergency_exit', student.id) >= 1) return;
    const reason = String(data.reason || '').slice(0, 120);
    const r = requests.create({ sessionId: session.id, kind: 'emergency_exit', studentId: student.id, studentName: student.name, reason });
    logEvent(session, student, 'emergency_requested', { reason });
    io.to(teacherRoom(session.id)).emit('access-request', { id: r.id, kind: 'emergency_exit', studentId: student.id, studentName: student.name, reason, sessionId: session.id, ts: Date.now() });
    socket.emit('emergency-exit-pending', { id: r.id });
    emitOverview(session);
  }

  function decideRequest(session, requestId, approve, by) {
    const row = requests.get(requestId);
    if (!row || row.session_id !== session.id) return { error: 'not_found' };
    if (!requests.decide(requestId, approve, by)) return { error: 'already_decided' };
    io.to(teacherRoom(session.id)).emit('access-request-decided', { id: requestId, approved: approve });
    if (row.kind === 'emergency_exit') {
      const student = session.students.find((s) => s.id === row.student_id);
      const L = student && live.get(key(session.id, student.id));
      if (L) notifyStudent(L, 'emergency-exit-decision', { id: requestId, approved: approve });
      if (approve && student) releaseStudents(session, [student.id], 'emergency', by);
    } else {
      io.to(`exempt-${requestId}`).emit('exemption-decision', { id: requestId, approved: approve });
    }
    emitOverview(session);
    return { ok: true, kind: row.kind };
  }

  // ---------------------------------------------------------------- umumiy ko'rinish (o'qituvchi)
  const COLOR_RANK = { red: 0, yellow: 1, green: 2 };
  function studentColor(session, student, L, st, pending) {
    const now = Date.now();
    if (!L) return 'yellow';
    if (L.flags.absent || (L.lastBypassAt && now - L.lastBypassAt < 3 * 60000)) return 'red';
    if (levels.isStrong(L.level) && L.status === 'unprotected') return 'red';
    if (L.flags.focusZero) return 'red';
    if (pending || L.status === 'offline' || L.status === 'unprotected' || student.exempt) return 'yellow';
    return 'green';
  }

  function overview(session) {
    const st = settingsFor(session);
    const pend = requests.pending(session.id);
    const pendingByStudent = new Set(pend.filter((p) => p.student_id).map((p) => p.student_id));
    const rows = session.students.map((s) => {
      const L = live.get(key(session.id, s.id));
      const color = studentColor(session, s, L, st, pendingByStudent.has(s.id));
      const ms = L ? L.ms : { protected: 0, unprotected: 0, offline: 0, assumed: 0 };
      return { id: s.id, name: s.name, level: s.level || 'web', status: L ? L.status : 'offline', color, reasons: L ? L.reasons : [], released: !!s.released, exempt: !!s.exempt, attested: !!s.attested, bypass: L ? L.bypassCount : 0, protectedSec: Math.round((ms.protected + ms.assumed) / 1000), unprotectedSec: Math.round(rules.unprotectedMs(ms, st) / 1000), focusZero: !!(L && L.flags.focusZero), absent: !!(L && L.flags.absent) };
    });
    rows.sort((a, b) => COLOR_RANK[a.color] - COLOR_RANK[b.color] || a.name.localeCompare(b.name));
    const summary = { total: rows.length, green: 0, yellow: 0, red: 0, byLevel: {} };
    for (const r of rows) { summary[r.color]++; summary.byLevel[r.level] = (summary.byLevel[r.level] || 0) + 1; }
    return { sessionId: session.id, locked: session.locked, protection: session.protection, summary, students: rows, requests: pend, serverTime: Date.now() };
  }
  function emitOverview(session) { if (hasListeners(session.id)) io.to(teacherRoom(session.id)).emit('lock-overview', overview(session)); }

  // ---------------------------------------------------------------- testlar
  function onQuizSent(session, quiz) {
    if (session.demo) return;
    lockdata.addQuiz({ sessionId: session.id, quizId: quiz.id, title: quiz.title, questions: (quiz.questions || []).length, sentAt: Date.now() });
  }
  function onQuizSubmitted(session, student, quizId, correct, total, pct) {
    if (session.demo) return;
    lockdata.addQuizResult({ sessionId: session.id, quizId, studentId: student.id, correct, total, pct });
  }

  // ---------------------------------------------------------------- hisobot
  function buildReport(session) {
    const st = settingsFor(session);
    flushAll();
    const stats = new Map(lockdata.stats(session.id).map((r) => [r.student_id, r]));
    const quizzes = lockdata.quizzes(session.id);
    const results = lockdata.quizResults(session.id);
    const rosterIds = session.students.map((s) => s.rosterStudentId).filter(Boolean);
    const hemis = new Map(rosterIds.map((id) => { const r = rosters.student(id); return [id, r && r.hemis_id]; }));
    const rows = session.students.map((s) => {
      const r = stats.get(s.id);
      const L = live.get(key(session.id, s.id));
      const ms = L ? L.ms : r ? { protected: r.protected_ms, unprotected: r.unprotected_ms, offline: r.offline_ms, assumed: r.assumed_ms } : { protected: 0, unprotected: 0, offline: 0, assumed: 0 };
      const flags = L ? L.flags : r ? { focusZero: !!r.focus_zero, absent: !!r.absent } : {};
      const quizPcts = quizzes.map((q) => { const x = results.find((y) => y.quiz_id === q.quiz_id && y.student_id === s.id); return x ? x.pct : 0; });
      const sc = rules.computeScore({ ms, quizPcts, joined: true, flags }, st);
      return {
        studentId: s.id, name: s.name, hemisId: (s.rosterStudentId && hemis.get(s.rosterStudentId)) || null, level: s.level || 'web', exempt: !!s.exempt, attested: !!s.attested,
        protectedMin: Math.round((ms.protected + ms.assumed) / 600) / 100, unprotectedMin: Math.round(ms.unprotected / 600) / 100, offlineMin: Math.round(ms.offline / 600) / 100,
        bypass: L ? L.bypassCount : r ? r.bypass_count : 0, ...sc,
      };
    });
    const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.total, 0) / rows.length) : 0;
    const byLevel = {};
    rows.forEach((r) => { byLevel[r.level] = (byLevel[r.level] || 0) + 1; });
    return {
      session: { id: session.id, name: session.name, subject: session.subject, createdAt: session.createdAt, endedAt: session.endedAt || null, duration: session.duration, protection: session.protection },
      weights: st['score.weights'], thresholds: { focusZeroSec: st['score.unprotectedFocusZeroSec'], absentSec: st['score.unprotectedAbsentSec'] },
      quizzes: quizzes.map((q) => ({ id: q.quiz_id, title: q.title })), students: rows, summary: { averageTotal: avg, byLevel, bypassTotal: rows.reduce((a, r) => a + r.bypass, 0), absent: rows.filter((r) => r.absent).length },
    };
  }

  const csvCell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function reportCsv(report) {
    const head = ['F.I.Sh', 'HEMIS ID', 'Himoya darajasi', 'Davomat', 'Testlar', 'Fokus', 'Jami ball', 'Himoyada (daq)', 'Himoyasiz (daq)', 'Aloqasiz (daq)', 'Bypass hodisalari', 'Qatnashmagan'];
    const lines = [head.join(',')];
    for (const r of report.students) lines.push([r.name, r.hemisId, r.level, r.attendance, r.quizzes === null ? '' : r.quizzes, r.focus, r.total, r.protectedMin, r.unprotectedMin, r.offlineMin, r.bypass, r.absent ? 'ha' : 'yo\'q'].map(csvCell).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------- dars tugashi
  function onSessionEnded(session) {
    const now = Date.now();
    for (const [k, L] of [...live.entries()]) {
      if (L.sessionId !== session.id) continue;
      accrue(L, now);
      const tot = L.ms.protected + L.ms.assumed + L.ms.unprotected + L.ms.offline;
      if (!session.demo) { telemetry.inc('protected_ms', L.level, '', L.ms.protected + L.ms.assumed); telemetry.inc('lesson_ms', L.level, '', tot); }
    }
    if (!session.demo) {
      flushAll();
      session.lockSummary = (() => { const r = buildReport(session); return { averageTotal: r.summary.averageTotal, bypassTotal: r.summary.bypassTotal, absent: r.summary.absent, byLevel: r.summary.byLevel }; })();
      telemetry.inc('lessons_finished', session.protection);
    }
    io.to(teacherRoom(session.id)).emit('lock-final', { sessionId: session.id, summary: session.lockSummary || null });
    for (const k of [...live.keys()]) if (k.startsWith(session.id + ':')) live.delete(k);
  }

  // ---------------------------------------------------------------- mijoz siyosati (join-success ichida)
  function clientPolicy(session, student) {
    const st = settingsFor(session);
    const td = helpers.getSessionTimeDetails(session);
    return {
      protection: session.protection, level: student.level || 'web', demo: !!session.demo,
      heartbeatIntervalSec: st['heartbeat.intervalSec'], offlineAfterSec: st['heartbeat.offlineAfterSec'], releaseOfflineMinutes: st['release.offlineMinutes'],
      remainingSeconds: td.remainingSeconds, serverTime: Date.now(),
      features: { iosL1: !!st['features.iosL1'], iosL2: !!st['features.iosL2'] },
    };
  }

  // ---------------------------------------------------------------- ma'lumotni o'chirish (talaba huquqi)
  function anonymizeStudent(session, student) {
    lockdata.deleteStudent(session.id, student.id);
    requests.deleteStudent(session.id, student.id);
    if (student.rosterStudentId) rosters.resetBinding(student.rosterStudentId);
    student.name = "O'chirilgan talaba";
    student.device = '';
    student.dkh = undefined;
    student.rosterStudentId = undefined;
    student.violations = [];
    student.teacherFeedback = '';
    if (Array.isArray(session.ratings)) session.ratings.filter((r) => r.studentId === student.id).forEach((r) => { r.studentName = "O'chirilgan talaba"; r.comment = ''; });
    session.quizSubmissions && session.quizSubmissions.filter((q) => q.studentId === student.id).forEach((q) => { q.studentName = "O'chirilgan talaba"; });
    live.delete(key(session.id, student.id));
    return true;
  }

  // ---------------------------------------------------------------- socket
  function registerSocket(socket) {
    socket.on('student-heartbeat', (d) => onHeartbeat(socket, d));
    socket.on('student-protection-event', (d) => onClientEvent(socket, d));
    socket.on('student-emergency-exit-request', (d) => requestEmergency(socket, d));
    socket.on('lock-subscribe', (d) => {
      const session = sessionById(d && d.sessionId);
      if (!session || !canManage(socket.teacher, session)) { socket.emit('auth-error', { message: 'Ruxsat yo\'q' }); return; }
      socket.join(teacherRoom(session.id));
      socket.emit('lock-overview', overview(session));
    });
    socket.on('exemption-watch', (d) => { if (d && typeof d.id === 'string') { const r = requests.get(d.id); if (r && requests.secretMatches(r, d.secret)) socket.join(`exempt-${d.id}`); } });
  }

  const canManage = (teacher, session) => !!teacher && (teacher.role === 'admin' || session.teacherId === teacher.id);

  // ---------------------------------------------------------------- hayot sikli
  const timers = [];
  function start() {
    timers.push(setInterval(tick, TICK_MS));
    timers.forEach((t) => t.unref && t.unref());
  }
  function stop() { timers.forEach(clearInterval); timers.length = 0; flushAll(); }

  return {
    settings, users, rosters, lockdata, requests, telemetry, live,
    decorateNewSession, gateJoin, findExisting, onJoined, gateRejoin, onRejoined, effectiveLocked, clientPolicy,
    onHeartbeat, onClientEvent, registerSocket, requestExemption, requestEmergency, decideRequest,
    releaseStudents, relockStudents, onGlobalUnlock, onGlobalLock, extend, overview, emitOverview,
    onQuizSent, onQuizSubmitted, buildReport, reportCsv, onSessionEnded, anonymizeStudent, canManage,
    settingsFor, sessionById, facultyOf, endsAtMs, tick, flushAll, start, stop, logEvent,
  };
}

module.exports = { createService };
