// "Dars rejimi" modulining kirish nuqtasi. server.js shu yerdan faqat init() ni chaqiradi.
const bcrypt = require('bcryptjs');
const { open } = require('../db');
const { createService } = require('./service');
const { createRouter } = require('./http');
const demo = require('./demo');
const retention = require('./retention');

function init({ app, io, legacy, config, authMiddleware, helpers }) {
  const sql = open(config.dbPath);
  const applied = sql.migrate();
  if (applied.length) console.log(`🗄️  DB migratsiyalari: ${applied.join(', ')}`);

  const svc = createService({ io, legacy, sql, config, helpers: { ...helpers, sql } });

  // Ustozlarni tiklash (qayta ishga tushganda yo'qolmasin)
  for (const u of svc.users.all()) {
    if (legacy.teachers.some((t) => t.id === u.id || t.email === u.email)) continue;
    legacy.teachers.push({ id: u.id, name: u.name, surname: u.surname, email: u.email, phone: u.phone, school: u.school, subject: u.subject, password: u.password_hash, role: u.role, facultyId: u.faculty_id, createdAt: new Date(u.created_at).toISOString() });
  }
  // Lokal ishlab chiqish: demo ustoz admin hisoblanadi (production'da demo ustoz umuman yo'q)
  legacy.teachers.forEach((t) => { if (t.id === 'teacher-demo-01') t.role = 'admin'; });
  // Birinchi admin
  const { email, password } = config.adminBootstrap;
  if (email && password && svc.users.countAdmins() === 0 && !legacy.teachers.some((t) => t.email === email)) {
    const t = { id: helpers.uuid(), name: 'Admin', surname: '', email, phone: '', school: '', subject: '', password: bcrypt.hashSync(password, 10), role: 'admin', facultyId: null, createdAt: new Date().toISOString() };
    legacy.teachers.push(t); svc.users.upsert(t, 'admin');
    console.log(`👤 Birinchi admin yaratildi: ${email}`);
  }

  const ctx = { legacy, config, helpers, svc, io };
  app.use('/api', createRouter({ svc, config, auth: authMiddleware, legacy, helpers: { ...helpers, sql } }));
  demo.ensure(ctx); demo.startRefresh(ctx);
  retention.start(ctx);
  svc.start();

  return {
    svc, sql,
    persistTeacher: (t) => svc.users.upsert(t, t.role || 'teacher'),
    demo: { isDemo: (s) => !!(s && s.demo), onStudentJoined: (socket, session, student) => demo.onStudentJoined({ io, socket, session, student, helpers }), ensure: () => demo.ensure(ctx) },
    close: () => { svc.stop(); sql.close(); },
  };
}

module.exports = { init, sha: require('../repos/rosters').sha };
