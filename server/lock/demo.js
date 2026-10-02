// Doimiy DEMO dars (do'kon tekshiruvchisi uchun): kod bilan kirish, tayyor test va material, ustozsiz ssenariy.
const DEMO_TEACHER_ID = 'demo-teacher';
const REFRESH_MS = 30 * 60 * 1000;

const DEMO_QUIZ = {
  id: 'demo-quiz',
  title: 'Demo test: kvadrat tenglama',
  timeLimit: 0,
  questions: [
    { id: 'dq1', text: 'x² = 16 tenglamaning ildizlari qaysi?', options: ['4', '-4', '±4', "Ildiz yo'q"], correctIndex: 2 },
    { id: 'dq2', text: "D = 0 bo'lsa, tenglama nechta ildizga ega?", options: ['0 ta', '1 ta', '2 ta', "Cheksiz"], correctIndex: 1 },
    { id: 'dq3', text: "2x + 6 = 0 tenglamada x nimaga teng?", options: ['3', '-3', '6', '-6'], correctIndex: 1 },
  ],
};
const DEMO_MATERIAL = {
  id: 'demo-material', title: 'Demo: dars slaydlari', text: 'Bu demo material. Slaydlarni suring yoki ikki marta bosib kattalashtiring.',
  url: '', fileUrl: '/demo/demo-slides.pdf', fileName: 'demo-slides.pdf', fileSize: '1.5 KB', fileType: 'pdf', fileLabel: 'PDF hujjat', fileColor: '#EF4444', sentAt: new Date().toISOString(),
};

function ensure({ legacy, config, helpers }) {
  const code = config.demo.code;
  if (!config.demo.enabled) {
    const i = legacy.sessions.findIndex((s) => s.id === code && s.demo);
    if (i >= 0) legacy.sessions.splice(i, 1);
    return null;
  }
  let s = legacy.sessions.find((x) => x.id === code);
  if (s && !s.demo) return null;                        // kod haqiqiy sessiya bilan band — tegmaymiz
  if (!s) { s = { id: code, students: [], ratings: [], materials: [], quizSubmissions: [] }; legacy.sessions.push(s); }
  Object.assign(s, {
    demo: true, teacherId: DEMO_TEACHER_ID, name: 'DEMO dars', subject: 'Namuna', status: 'active', locked: true, timerReleased: false,
    createdAt: new Date().toISOString(), duration: 45, protection: 'optional', rosterGroupId: null, lockSettings: null,
    activeQuiz: JSON.parse(JSON.stringify(DEMO_QUIZ)), quizSubmissions: [], activeMaterial: { ...DEMO_MATERIAL }, materials: [{ ...DEMO_MATERIAL }],
    qrCode: '', qrUrl: `${config.publicBaseUrl || ''}/student.html?session=${code}`, allowedTool: null,
  });
  s.students = s.students.filter((st) => st.isActive);   // yangilashda faol talabalar qoladi
  helpers.saveSessions();
  return s;
}

/** Demo'ga qo'shilgan talabaga ustoz ishtirokisiz ssenariy: 40 s → qulf ochiladi, 90 s → yana qulflanadi. */
function onStudentJoined({ io, socket, session, student, helpers }) {
  const timers = [];
  const alive = () => socket.connected && session.status === 'active' && session.students.includes(student);
  timers.push(setTimeout(() => { if (!alive()) return; student.released = true; io.to(socket.id).emit('session-unlocked', { message: "Demo: ustoz ruxsat berdi.", reason: 'demo' }); }, 40000));
  timers.push(setTimeout(() => { if (!alive()) return; student.released = false; io.to(socket.id).emit('session-locked', { message: 'Demo: ustoz yana qulfladi.', ...helpers.getSessionTimeDetails(session) }); }, 90000));
  timers.forEach((t) => t.unref && t.unref());
  socket.once('disconnect', () => timers.forEach(clearTimeout));
}

function startRefresh(ctx) {
  const t = setInterval(() => {
    const s = ctx.legacy.sessions.find((x) => x.id === ctx.config.demo.code && x.demo);
    if (!s) return;
    s.createdAt = new Date().toISOString(); s.timerReleased = false;       // taymer hech qachon tugamasin
    s.students = s.students.filter((st) => st.isActive || Date.now() - Date.parse(st.joinedAt) < 3600000);
    ctx.helpers.saveSessions();
  }, REFRESH_MS);
  if (t.unref) t.unref();
  return t;
}

module.exports = { ensure, onStudentJoined, startRefresh, DEMO_TEACHER_ID };
