// Saqlash muddati: muddati o'tgan sessiyalarda shaxsiy ma'lumot (ism, qurilma, izoh) anonimlashtiriladi.
//   1) semestr tugash sanasi + N kun o'tgach (standart 90) — shu sanagacha tugagan barcha darslar;
//   2) maxDays dan eski darslar (semestr sanasi kiritilmagan bo'lsa ham ma'lumot abadiy saqlanib qolmasligi uchun).
const DAY = 86400000;

function run({ legacy, svc, helpers }) {
  const st = svc.settings.effective();
  const now = Date.now();
  const semesterEnd = st['retention.semesterEnd'] ? Date.parse(st['retention.semesterEnd'] + 'T23:59:59Z') : null;
  const semesterCut = semesterEnd && now > semesterEnd + st['retention.afterSemesterDays'] * DAY ? semesterEnd : null;
  const maxCut = now - st['retention.maxDays'] * DAY;
  let sessions = 0, students = 0;
  for (const s of legacy.sessions) {
    if (s.demo || s.purgedAt || s.status !== 'ended') continue;
    const ended = Date.parse(s.endedAt || s.createdAt);
    if (!((semesterCut && ended <= semesterCut) || ended <= maxCut)) continue;
    for (const stu of s.students) if (stu.name !== "O'chirilgan talaba") { svc.anonymizeStudent(s, stu); students++; }
    svc.lockdata.purgeSession(s.id);
    s.purgedAt = new Date().toISOString();
    sessions++;
  }
  if (sessions) helpers.saveSessions();
  return { sessions, students };
}

function start(ctx) {
  const t = setInterval(() => { try { run(ctx); } catch (e) { console.error('retention xatosi:', e.message); } }, 6 * 3600 * 1000);
  if (t.unref) t.unref();
  try { run(ctx); } catch (e) { console.error('retention xatosi:', e.message); }
  return t;
}

module.exports = { run, start };
