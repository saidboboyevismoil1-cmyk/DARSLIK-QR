const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { config, validate: validateConfig } = require('./server/config');
const lockModule = require('./server/lock');
const quizLib = require('./server/quiz');
const teacherModule = require('./server/teacher');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);

const configErrors = validateConfig(config);
if (configErrors.length) {
  console.error('❌ Konfiguratsiya xatosi:\n - ' + configErrors.join('\n - '));
  process.exit(1);
}
const PORT = config.port;
const JWT_SECRET = config.jwtSecret;
if (config.jwtSecretIsDefault) console.warn("⚠️  JWT_SECRET o'rnatilmagan — standart qiymat (faqat ishlab chiqish uchun). config/.env ni to'ldiring.");

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage for materials (PDF, Word, PPT, Excel, Images, etc.)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const sanitizedBase = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_\u0400-\u04FF-]/g, '_')
      .substring(0, 36);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E4);
    cb(null, `${uniqueSuffix}-${sanitizedBase}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
});

function getFileTypeInfo(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.pdf') {
    return { type: 'pdf', label: 'PDF Hujjat', color: '#EF4444', icon: 'pdf' };
  } else if (['.doc', '.docx'].includes(ext)) {
    return { type: 'word', label: 'Word Hujjat (DOCX)', color: '#2563EB', icon: 'word' };
  } else if (['.ppt', '.pptx'].includes(ext)) {
    return { type: 'ppt', label: 'Taqdimot (PPTX)', color: '#F97316', icon: 'ppt' };
  } else if (['.xls', '.xlsx'].includes(ext)) {
    return { type: 'excel', label: 'Excel Jadval (XLSX)', color: '#10B981', icon: 'excel' };
  } else if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(ext)) {
    return { type: 'image', label: 'Rasm / Diagramma', color: '#8B5CF6', icon: 'image' };
  } else if (['.zip', '.rar', '.7z', '.tar'].includes(ext)) {
    return { type: 'archive', label: 'Arxiv Fayl', color: '#64748B', icon: 'archive' };
  } else if (['.txt', '.md'].includes(ext)) {
    return { type: 'text', label: 'Matnli Hujjat', color: '#475569', icon: 'text' };
  }
  return { type: 'file', label: 'Fayl / Material', color: '#3B82F6', icon: 'file' };
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// ============================================
// DATA DIRECTORY & SESSIONS PERSISTENCE
// ============================================
const dataDir = config.dataDir;
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const sessionsFilePath = path.join(dataDir, 'sessions.json');

function loadSessionsFromFile() {
  try {
    if (fs.existsSync(sessionsFilePath)) {
      const raw = fs.readFileSync(sessionsFilePath, 'utf-8');
      const loaded = JSON.parse(raw);
      if (Array.isArray(loaded)) {
        console.log(`📁 ${loaded.length} ta o'tmish sessiya ma'lumotlari data/sessions.json faylidan yuklandi`);
        return loaded;
      }
    }
  } catch (err) {
    console.error('sessions.json o\'qishda xatolik:', err);
  }
  return [];
}

function saveSessionsToFile() {
  try {
    fs.writeFileSync(sessionsFilePath, JSON.stringify(db.sessions, null, 2), 'utf-8');
  } catch (err) {
    console.error('sessions.json yozishda xatolik:', err);
  }
}

// ============================================
// IN-MEMORY DATABASE (With File Persistence)
// ============================================
const defaultTeacherHash = bcrypt.hashSync('123456', 10);

const db = {
  teachers: !config.enableDemoTeacher ? [] : [
    {
      id: 'teacher-demo-01',
      name: 'Olim',
      surname: 'Qodirov',
      email: 'teacher@edufocus.uz',
      phone: '+998 90 123 45 67',
      school: 'Toshkent Axborot Texnologiyalari Universiteti (TATU)',
      subject: 'Informatika va Dasturlash',
      password: defaultTeacherHash,
      createdAt: new Date().toISOString()
    }
  ],
  sessions: loadSessionsFromFile(),      // Loaded from data/sessions.json
};

function getSessionTimeDetails(session) {
  const startMs = new Date(session.createdAt).getTime();
  const totalSeconds = (session.duration || 45) * 60;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
  return {
    createdAt: session.createdAt,
    duration: session.duration || 45,
    totalSeconds,
    elapsedSeconds,
    remainingSeconds
  };
}

// ============================================
// AUTH ROUTES
// ============================================

// Register
const limitWrap = (name) => (req, res, next) => (teacherAuth ? teacherAuth.limits[name](req, res, next) : next());
app.post('/api/register', limitWrap('register'), async (req, res) => {
  if (!config.registrationOpen) return res.status(403).json({ error: "Ro'yxatdan o'tish yopiq. Administratorga murojaat qiling" });
  try {
    const { name, surname, email, phone, school, subject, password } = req.body;
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) return res.status(400).json({ error: "Ism va to'g'ri email kiriting" });
    if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: "Parol kamida 6 belgi bo'lsin" });

    // Check if email already exists
    const existing = db.teachers.find(t => t.email === email);
    if (existing) {
      return res.status(400).json({ error: 'Bu email allaqachon ro\'yxatdan o\'tgan' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const teacher = {
      id: uuidv4(),
      name,
      surname,
      email,
      phone,
      school,
      subject,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };

    teacher.role = 'teacher';
    db.teachers.push(teacher);
    lock.persistTeacher(teacher);

    const tokens = teacherAuth.login(teacher, req);

    res.json({
      success: true,
      ...tokens,
      teacher: { id: teacher.id, name: teacher.name, surname: teacher.surname, email: teacher.email, school: teacher.school, subject: teacher.subject, role: teacher.role || 'teacher', facultyId: teacher.facultyId || null }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Login
app.post('/api/login', limitWrap('loginIp'), limitWrap('login'), async (req, res) => {
  try {
    const { email, password } = req.body;

    const teacher = db.teachers.find(t => t.email === email);
    if (!teacher) {
      return res.status(401).json({ error: 'Email yoki parol noto\'g\'ri' });
    }

    const isValid = await bcrypt.compare(password, teacher.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Email yoki parol noto\'g\'ri' });
    }

    teacherAuth.limits.login.reset(req);
    const tokens = teacherAuth.login(teacher, req);

    res.json({
      success: true,
      ...tokens,
      teacher: { id: teacher.id, name: teacher.name, surname: teacher.surname, email: teacher.email, school: teacher.school, subject: teacher.subject, role: teacher.role || 'teacher', facultyId: teacher.facultyId || null }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Auth middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token topilmadi' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const teacher = db.teachers.find(t => t.id === decoded.id);
    if (!teacher) return res.status(401).json({ error: 'Foydalanuvchi topilmadi. Qayta kiring' });
    req.teacherId = teacher.id;
    req.teacher = teacher;
    req.role = teacher.role || 'teacher';
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token yaroqsiz' });
  }
}

// Get teacher profile
app.get('/api/profile', authMiddleware, (req, res) => {
  const teacher = db.teachers.find(t => t.id === req.teacherId);
  if (!teacher) return res.status(404).json({ error: 'O\'qituvchi topilmadi' });

  res.json({
    id: teacher.id,
    name: teacher.name,
    surname: teacher.surname,
    email: teacher.email,
    phone: teacher.phone,
    school: teacher.school,
    subject: teacher.subject,
    role: teacher.role || 'teacher',
    facultyId: teacher.facultyId || null
  });
});

// ============================================
// SESSION ROUTES
// ============================================

// Create session
app.post('/api/sessions', authMiddleware, async (req, res) => {
  try {
    const { name, subject, duration } = req.body;
    // Generate unique 6-digit numeric session code
    let sessionId;
    do {
      sessionId = String(Math.floor(100000 + Math.random() * 900000));
    } while (db.sessions.some(s => s.id === sessionId));

    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${proto}://${req.get('host')}`;
    const sessionUrl = `${baseUrl}/student.html?session=${sessionId}`;

    // Generate QR code
    const qrDataUrl = await QRCode.toDataURL(sessionUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: '#FFFFFF',
        light: '#0F172A'
      }
    });

    const session = {
      id: sessionId,
      teacherId: req.teacherId,
      name: name || 'Yangi dars',
      subject: subject || '',
      qrCode: qrDataUrl,
      qrUrl: sessionUrl,
      status: 'active',      // active, paused, ended
      locked: true,           // true = students locked, false = students free
      createdAt: new Date().toISOString(),
      duration: duration || 45,
      students: [],           // { id, name, device, joinedAt, isActive, socketId, violationsCount, violations[] }
      activeQuiz: null,
      quizSubmissions: [],
      activeMaterial: null,
      materials: [],
      ratings: [],            // { studentId, studentName, score, comment, createdAt }
      averageRating: null
    };

    lock.svc.decorateNewSession(session, req.body, req.teacher);
    db.sessions.push(session);
    saveSessionsToFile();

    res.json({ success: true, session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sessiya yaratishda xatolik' });
  }
});

// Get active sessions for teacher
app.get('/api/sessions', authMiddleware, (req, res) => {
  const sessions = db.sessions
    .filter(s => s.teacherId === req.teacherId)
    .map(s => ({
      ...s,
      studentCount: s.students.length,
      activeStudents: s.students.filter(st => st.isActive).length
    }));

  res.json(sessions);
});

// Get single session
app.get('/api/sessions/:id', (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  const timeDetails = getSessionTimeDetails(session);

  res.json({
    id: session.id,
    name: session.name,
    subject: session.subject,
    status: session.status,
    locked: session.locked,
    protection: session.protection || 'optional',
    requiresApp: session.protection === 'required',
    rosterRequired: !!session.rosterGroupId,
    demo: !!session.demo,
    studentCount: session.students.length,
    activeMaterial: session.activeMaterial || null,
    materials: session.materials || (session.activeMaterial ? [session.activeMaterial] : []),
    ...timeDetails
  });
});

// Upload material file (PDF, Word, PPTX, Excel, Images, etc.)
app.post('/api/upload-material', authMiddleware, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Fayl tanlanmadi' });
    }

    const { originalname, size, filename } = req.file;
    const fileInfo = getFileTypeInfo(originalname);
    const fileUrl = `/uploads/${filename}`;
    const formattedSize = formatFileSize(size);

    res.json({
      success: true,
      file: {
        url: fileUrl,
        name: originalname,
        size: formattedSize,
        rawSize: size,
        type: fileInfo.type,
        label: fileInfo.label,
        color: fileInfo.color,
        icon: fileInfo.icon
      }
    });
  } catch (err) {
    console.error('Fayl yuklash xatosi:', err);
    res.status(500).json({ error: 'Fayl yuklashda xatolik yuz berdi' });
  }
});

// Get session materials list
app.get('/api/sessions/:id/materials', (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  res.json({
    materials: session.materials || (session.activeMaterial ? [session.activeMaterial] : []),
    activeMaterial: session.activeMaterial || null
  });
});

// Broadcast material via REST API
app.post('/api/sessions/:id/materials', authMiddleware, (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id && s.teacherId === req.teacherId);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  const material = req.body;
  if (!session.materials) session.materials = [];

  const newMaterial = {
    id: uuidv4().substring(0, 8),
    title: material.title || 'Dars Materiali',
    text: material.text || '',
    url: material.url || '',
    fileUrl: material.fileUrl || '',
    fileName: material.fileName || '',
    fileSize: material.fileSize || '',
    fileType: material.fileType || 'document',
    fileLabel: material.fileLabel || 'Hujjat',
    fileColor: material.fileColor || '#2563EB',
    sentAt: new Date().toISOString()
  };

  session.activeMaterial = newMaterial;
  session.materials.unshift(newMaterial);

  io.to(`session-${session.id}`).emit('new-material', newMaterial);

  res.json({ success: true, material: newMaterial });
});

// Regenerate QR code
app.post('/api/sessions/:id/regenerate-qr', authMiddleware, async (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id && s.teacherId === req.teacherId);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const sessionUrl = `${baseUrl}/student.html?session=${session.id}&t=${Date.now()}`;

  const qrDataUrl = await QRCode.toDataURL(sessionUrl, {
    width: 400,
    margin: 2,
    color: {
      dark: '#FFFFFF',
      light: '#0F172A'
    }
  });

  session.qrCode = qrDataUrl;
  session.qrUrl = sessionUrl;

  res.json({ success: true, qrCode: qrDataUrl });
});

// Helper to calculate session statistics
function calculateSessionStats(session) {
  const startTime = new Date(session.createdAt).getTime();
  const endTime = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
  const actualDurationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));

  const totalStudents = session.students ? session.students.length : 0;
  const totalViolations = session.students
    ? session.students.reduce((sum, st) => sum + (st.violationsCount || 0), 0)
    : 0;

  // Student ratings (1 to 5 stars)
  const ratings = session.ratings || [];
  const totalRatings = ratings.length;
  const ratingSum = ratings.reduce((sum, r) => sum + (Number(r.score) || 0), 0);
  const averageRating = totalRatings > 0 ? Number((ratingSum / totalRatings).toFixed(1)) : null;

  const ratingBreakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  ratings.forEach(r => {
    const sc = Math.round(Number(r.score));
    if (ratingBreakdown[sc] !== undefined) ratingBreakdown[sc]++;
  });

  // Calculate focus score per student (100 base, -15 per violation, minimum 0)
  const studentsWithScores = (session.students || []).map(st => {
    const violations = st.violationsCount || 0;
    const score = Math.max(0, 100 - (violations * 15));
    let rating = "A'lo";
    let badgeClass = 'badge-green';

    if (violations === 0) {
      rating = "A'lo";
      badgeClass = 'badge-green';
    } else if (violations <= 2) {
      rating = 'Yaxshi';
      badgeClass = 'badge-yellow';
    } else {
      rating = 'Diqqatsiz';
      badgeClass = 'badge-red';
    }

    const quizSubmission = (session.quizSubmissions || []).find(q => q.studentId === st.id);
    const studentRatingObj = ratings.find(r => r.studentId === st.id);

    return {
      id: st.id,
      name: st.name,
      device: st.device,
      joinedAt: st.joinedAt,
      violationsCount: violations,
      focusScore: score,
      rating,
      badgeClass,
      quizScore: quizSubmission ? `${quizSubmission.correctCount}/${quizSubmission.totalQuestions} (${quizSubmission.percentage}%)` : (st.quizScore || '—'),
      teacherRating: studentRatingObj ? studentRatingObj.score : (st.teacherRating || null),
      teacherFeedback: studentRatingObj ? (studentRatingObj.comment || '') : (st.teacherFeedback || '')
    };
  });

  // Average focus score for the class
  const avgFocus = totalStudents > 0
    ? Math.round(studentsWithScores.reduce((sum, st) => sum + st.focusScore, 0) / totalStudents)
    : 100;

  const perfectStudents = studentsWithScores.filter(st => st.violationsCount === 0);
  const flaggedStudents = studentsWithScores.filter(st => st.violationsCount > 0);

  // Quiz summary if any
  const quizSummary = session.activeQuiz ? {
    title: session.activeQuiz.title,
    totalQuestions: session.activeQuiz.questions.length,
    submissionsCount: (session.quizSubmissions || []).length,
    averageScore: (session.quizSubmissions && session.quizSubmissions.length > 0)
      ? Math.round(session.quizSubmissions.reduce((sum, sub) => sum + sub.percentage, 0) / session.quizSubmissions.length)
      : 0
  } : null;

  return {
    sessionId: session.id,
    sessionName: session.name,
    subject: session.subject || 'Umumiy',
    createdAt: session.createdAt,
    endedAt: session.endedAt || new Date().toISOString(),
    plannedDuration: session.duration || 45,
    actualDuration: actualDurationMinutes,
    totalStudents,
    totalViolations,
    averageFocusScore: avgFocus,
    perfectStudentsCount: perfectStudents.length,
    flaggedStudentsCount: flaggedStudents.length,
    quizSummary,
    ratings: {
      averageRating,
      totalRatings,
      breakdown: ratingBreakdown,
      list: ratings
    },
    students: studentsWithScores
  };
}

// End session
app.post('/api/sessions/:id/end', authMiddleware, (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id && s.teacherId === req.teacherId);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  session.status = 'ended';
  session.locked = false;
  session.endedAt = new Date().toISOString();

  // Compute final statistics
  session.statistics = calculateSessionStats(session);
  lock.svc.onSessionEnded(session);
  saveSessionsToFile();

  // Notify all students
  io.to(`session-${session.id}`).emit('session-ended', {
    message: 'Dars tugadi!',
    duration: session.statistics.actualDuration
  });

  res.json({
    success: true,
    statistics: session.statistics
  });
});

// Get session stats
app.get('/api/sessions/:id/stats', authMiddleware, (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id && s.teacherId === req.teacherId);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  if (!session.statistics) {
    session.statistics = calculateSessionStats(session);
  }

  res.json({ success: true, statistics: session.statistics });
});

// Unlock students
app.post('/api/sessions/:id/unlock', authMiddleware, (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id && s.teacherId === req.teacherId);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  session.locked = false;

  io.to(`session-${session.id}`).emit('session-unlocked', {
    message: 'Ustoz ruxsat berdi! Telefoningizdan foydalanishingiz mumkin.'
  });
  lock.svc.onGlobalUnlock(session, req.teacherId);

  res.json({ success: true });
});

// Lock students again
app.post('/api/sessions/:id/lock', authMiddleware, (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id && s.teacherId === req.teacherId);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  session.locked = true;
  lock.svc.onGlobalLock(session);
  const timeDetails = getSessionTimeDetails(session);

  io.to(`session-${session.id}`).emit('session-locked', {
    message: 'Ustoz telefonni blokladi.',
    ...timeDetails
  });

  res.json({ success: true });
});

// App & Tool Remote Control (Calculator, Chrome, Whitelist)
app.post('/api/sessions/:id/app-control', authMiddleware, (req, res) => {
  const session = db.sessions.find(s => s.id === req.params.id && s.teacherId === req.teacherId);
  if (!session) return res.status(404).json({ error: 'Sessiya topilmadi' });

  const { tool, action, url, appName } = req.body;
  // tool: 'calculator' | 'browser' | 'lock_all'
  // action: 'open' | 'close'

  session.allowedTool = (action === 'open') ? { tool, url: url || null, appName: appName || tool } : null;

  io.to(`session-${session.id}`).emit('app-control', {
    tool,
    action,
    url: url || null,
    appName: appName || tool,
    timestamp: new Date().toISOString()
  });

  res.json({ success: true, allowedTool: session.allowedTool });
});

// Get session history / stats
app.get('/api/stats', authMiddleware, (req, res) => {
  const teacherSessions = db.sessions.filter(s => s.teacherId === req.teacherId);

  const totalSessions = teacherSessions.length;
  const totalStudents = teacherSessions.reduce((acc, s) => acc + s.students.length, 0);
  const activeSessions = teacherSessions.filter(s => s.status === 'active').length;

  const enrichedSessions = teacherSessions.slice(-20).reverse().map(s => {
    return {
      id: s.id,
      name: s.name,
      subject: s.subject,
      status: s.status,
      duration: s.duration,
      createdAt: s.createdAt,
      endedAt: s.endedAt,
      studentCount: s.students ? s.students.length : 0,
      students: s.students || [],
      statistics: s.statistics || calculateSessionStats(s)
    };
  });

  res.json({
    totalSessions,
    totalStudents,
    activeSessions,
    recentSessions: enrichedSessions
  });
});

// ============================================
// GROUPS & TEST PACKS API (O'qituvchi Boshqaruvi)
// ============================================
const groupsFilePath = path.join(dataDir, 'groups.json');
const testpacksFilePath = path.join(dataDir, 'testpacks.json');

const initialGroups = [
  {
    id: 'grp-941-21',
    name: '941-21 Guruh',
    subject: 'Kiberxavfsizlik asoslari',
    studentCount: 24,
    room: '304-xona, B-bino',
    createdAt: new Date().toISOString()
  },
  {
    id: 'grp-912-22',
    name: '912-22 Guruh',
    subject: 'Dasturiy injiniring va arxitektura',
    studentCount: 28,
    room: '102-auditoriya',
    createdAt: new Date().toISOString()
  },
  {
    id: 'grp-710-23',
    name: '710-23 Guruh',
    subject: 'Sun\'iy intellekt va ma\'lumotlar tahlili',
    studentCount: 30,
    room: '405-lab',
    createdAt: new Date().toISOString()
  }
];

const initialTestpacks = [
  {
    id: 'tp-kiber-1',
    title: 'Kiberxavfsizlik asoslari — 1-Nazorat Testi',
    subject: 'Kiberxavfsizlik',
    timeLimit: 3,
    createdAt: new Date().toISOString(),
    questions: [
      {
        id: 1,
        text: 'Axborot xavfsizligining 3 ta asosiy ustuni (CIA triada) qaysilar?',
        options: [
          'Maxfiylik, Butunlik, Foydalanish imkoniyati',
          'Tezlik, Xotira, Protsessor',
          'Autentifikatsiya, Avtorizatsiya, Audit',
          'Shifrlash, Dekodlash, Saqlash'
        ],
        correct: 0
      },
      {
        id: 2,
        text: 'Fishing (Phishing) hujumining asosiy maqsadi nima?',
        options: [
          'Foydalanuvchini aldab shaxsiy login/parollarni qo\'lga kiritish',
          'Kompyuterning qattiq diskini format qilish',
          'Internet tezligini sekinlashtirish',
          'Operatsion tizimni yangilash'
        ],
        correct: 0
      },
      {
        id: 3,
        text: 'Ikki bosqichli autentifikatsiya (2FA) nima uchun ishlatiladi?',
        options: [
          'Hisob qaydnomasiga faqat parol emas, tasdiqlash kodi orqali qo\'shimcha xavfsizlik berish',
          'Internetga ulanishni tezlashtirish',
          'Telefon batareyasini tejash',
          'Fayllarni siqish va arxivlash'
        ],
        correct: 0
      },
      {
        id: 4,
        text: 'Quyidagilardan qaysi biri eng kuchli parol hisoblanadi?',
        options: [
          'K!ber_F0cus#2026',
          '12345678',
          'admin123',
          'qwerty2024'
        ],
        correct: 0
      },
      {
        id: 5,
        text: 'DDoS (Distributed Denial of Service) hujumi qanday oqibatga olib keladi?',
        options: [
          'Serverga ko\'p so\'rov yuborib uni ishlamay qolishiga olib kelish',
          'Ma\'lumotlar bazasini o\'chirish',
          'Parolni buzish',
          'Ekranni bloklash'
        ],
        correct: 0
      }
    ]
  },
  {
    id: 'tp-python-1',
    title: 'Python dasturlash — Boshlang\'ich test',
    subject: 'Dasturlash',
    timeLimit: 4,
    createdAt: new Date().toISOString(),
    questions: [
      {
        id: 1,
        text: 'Python tilida o\'zgarmas (immutable) ma\'lumot turi qaysi?',
        options: ['tuple', 'list', 'dict', 'set'],
        correct: 0
      },
      {
        id: 2,
        text: 'Ro\'yxat oxiriga yangi element qo\'shish uchun qaysi metod ishlatiladi?',
        options: ['append()', 'add()', 'push()', 'insert()'],
        correct: 0
      },
      {
        id: 3,
        text: 'Python-da funksiya qaysi kalit so\'z bilan e\'lon qilinadi?',
        options: ['def', 'function', 'fun', 'void'],
        correct: 0
      }
    ]
  }
];

function loadGroups() {
  try {
    if (fs.existsSync(groupsFilePath)) {
      return JSON.parse(fs.readFileSync(groupsFilePath, 'utf8'));
    }
  } catch (e) {}
  saveGroups(initialGroups);
  return initialGroups;
}

function saveGroups(data) {
  try {
    fs.writeFileSync(groupsFilePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

function loadTestpacks() {
  try {
    if (fs.existsSync(testpacksFilePath)) {
      return JSON.parse(fs.readFileSync(testpacksFilePath, 'utf8'));
    }
  } catch (e) {}
  saveTestpacks(initialTestpacks);
  return initialTestpacks;
}

function saveTestpacks(data) {
  try {
    fs.writeFileSync(testpacksFilePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

// Groups API — har bir guruh o'z egasiga tegishli (teacherId); admin hammasini boshqara oladi
const canTouch = (item, req) => !!item && (item.teacherId === req.teacherId || req.role === 'admin');
app.get('/api/groups', authMiddleware, (req, res) => {
  const all = req.role === 'admin' && req.query.scope === 'all';
  res.json({ success: true, groups: loadGroups().filter(g => all || g.teacherId === req.teacherId) });
});

app.post('/api/groups', authMiddleware, (req, res) => {
  const { name, subject, studentCount, room } = req.body;
  if (!name) return res.status(400).json({ error: 'Guruh nomi kiritilishi shart' });
  const groups = loadGroups();
  const newGroup = {
    id: 'grp-' + Date.now() + '-' + Math.round(Math.random() * 1e4),
    teacherId: req.teacherId,
    name: String(name).trim().slice(0, 80),
    subject: (subject || '').trim(),
    studentCount: parseInt(studentCount) || 0,
    room: (room || '').trim(),
    createdAt: new Date().toISOString()
  };
  groups.unshift(newGroup);
  saveGroups(groups);
  res.json({ success: true, group: newGroup });
});

app.put('/api/groups/:id', authMiddleware, (req, res) => {
  const groups = loadGroups();
  const idx = groups.findIndex(g => g.id === req.params.id);
  if (idx === -1 || !canTouch(groups[idx], req)) return res.status(404).json({ error: 'Guruh topilmadi' });
  const { id, teacherId, createdAt, ...patch } = req.body || {};
  groups[idx] = { ...groups[idx], ...patch, id: groups[idx].id, teacherId: groups[idx].teacherId };
  saveGroups(groups);
  res.json({ success: true, group: groups[idx] });
});

app.delete('/api/groups/:id', authMiddleware, (req, res) => {
  const groups = loadGroups();
  const g = groups.find(x => x.id === req.params.id);
  if (!g || !canTouch(g, req)) return res.status(404).json({ error: 'Guruh topilmadi' });
  saveGroups(groups.filter(x => x.id !== g.id));
  res.json({ success: true });
});

// Test Packs API — egalik filtri + savol turlari (single/multi/tf/short), qarang server/quiz.js
app.get('/api/testpacks', authMiddleware, (req, res) => {
  const all = req.role === 'admin' && req.query.scope === 'all';
  res.json({ success: true, testpacks: loadTestpacks().filter(tp => all || tp.teacherId === req.teacherId).map(tp => ({ ...tp, questions: quizLib.normalizeQuestions(tp.questions) })) });
});

app.post('/api/testpacks', authMiddleware, (req, res) => {
  const { title, subject, timeLimit, questions } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Test to\'plami nomi kiritilishi shart' });
  const errs = quizLib.validateQuestions(questions);
  if (errs.length) return res.status(400).json({ error: errs[0], errors: errs });
  const testpacks = loadTestpacks();
  const newPack = {
    id: 'tp-' + Date.now() + '-' + Math.round(Math.random() * 1e4),
    teacherId: req.teacherId,
    title: String(title).trim().slice(0, 120),
    subject: (subject || '').trim(),
    timeLimit: parseInt(timeLimit) || 3,
    questions: quizLib.normalizeQuestions(questions),
    createdAt: new Date().toISOString()
  };
  testpacks.unshift(newPack);
  saveTestpacks(testpacks);
  res.json({ success: true, testpack: newPack });
});

app.put('/api/testpacks/:id', authMiddleware, (req, res) => {
  const testpacks = loadTestpacks();
  const idx = testpacks.findIndex(tp => tp.id === req.params.id);
  if (idx === -1 || !canTouch(testpacks[idx], req)) return res.status(404).json({ error: 'Test to\'plami topilmadi' });
  const { id, teacherId, createdAt, ...patch } = req.body || {};
  if (patch.questions !== undefined) {
    const errs = quizLib.validateQuestions(patch.questions);
    if (errs.length) return res.status(400).json({ error: errs[0], errors: errs });
    patch.questions = quizLib.normalizeQuestions(patch.questions);
  }
  testpacks[idx] = { ...testpacks[idx], ...patch, id: testpacks[idx].id, teacherId: testpacks[idx].teacherId };
  saveTestpacks(testpacks);
  res.json({ success: true, testpack: testpacks[idx] });
});

app.post('/api/testpacks/:id/copy', authMiddleware, (req, res) => {
  const testpacks = loadTestpacks();
  const src = testpacks.find(tp => tp.id === req.params.id);
  if (!src || !canTouch(src, req)) return res.status(404).json({ error: 'Test to\'plami topilmadi' });
  const copy = { ...JSON.parse(JSON.stringify(src)), id: 'tp-' + Date.now() + '-' + Math.round(Math.random() * 1e4), teacherId: req.teacherId, title: String(req.body && req.body.title || (src.title + ' (nusxa)')).slice(0, 120), createdAt: new Date().toISOString() };
  testpacks.unshift(copy);
  saveTestpacks(testpacks);
  res.json({ success: true, testpack: copy });
});

app.delete('/api/testpacks/:id', authMiddleware, (req, res) => {
  const testpacks = loadTestpacks();
  const tp = testpacks.find(x => x.id === req.params.id);
  if (!tp || !canTouch(tp, req)) return res.status(404).json({ error: 'Test to\'plami topilmadi' });
  saveTestpacks(testpacks.filter(x => x.id !== tp.id));
  res.json({ success: true });
});

// Broadcast a saved testpack to active session
app.post('/api/testpacks/:id/broadcast', authMiddleware, (req, res) => {
  const { sessionId } = req.body;
  const testpacks = loadTestpacks();
  const pack = testpacks.find(tp => tp.id === req.params.id);
  if (!pack || !canTouch(pack, req)) return res.status(404).json({ error: 'Test to\'plami topilmadi' });

  const session = db.sessions.find(s => (sessionId ? s.id === sessionId : (s.teacherId === req.teacherId && s.status === 'active')));
  if (!session) {
    return res.status(400).json({ error: 'Faol dars sessiyasi topilmadi. Avval darsni boshlang!' });
  }
  if (!lock.svc.canManage(req.teacher, session)) return res.status(403).json({ error: 'Bu sessiya sizniki emas' });

  session.activeQuiz = {
    id: uuidv4().substring(0, 8),
    title: pack.title,
    questions: quizLib.normalizeQuestions(pack.questions),
    timeLimit: pack.timeLimit || 0,
    createdAt: new Date().toISOString()
  };
  session.quizSubmissions = [];
  lock.svc.onQuizSent(session, session.activeQuiz);

  const sanitizedQuestions = session.activeQuiz.questions.map(quizLib.publicQuestion);

  io.to(`session-${session.id}`).emit('new-quiz', {
    quizId: session.activeQuiz.id,
    title: session.activeQuiz.title,
    questions: sanitizedQuestions,
    timeLimit: session.activeQuiz.timeLimit
  });

  res.json({ success: true, sessionId: session.id, quiz: session.activeQuiz });
});

// (/api/unlock-all olib tashlandi: autentifikatsiyasiz edi. Ochish: POST /api/sessions/:id/unlock yoki /api/lock/sessions/:id/release)
// ============================================
// SOCKET.IO - REAL-TIME
// ============================================

// Ustoz soketlari JWT bilan autentifikatsiya qilinadi (talabalar tokensiz ulanadi)
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  socket.teacher = null;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.teacher = db.teachers.find(t => t.id === decoded.id) || null;
    } catch (e) { /* yaroqsiz token — oddiy (talaba) soket sifatida davom etadi */ }
  }
  next();
});
const canManageSession = (socket, session) => lock.svc.canManage(socket.teacher, session);
const isOwnStudent = (socket, sessionId, studentId) =>
  !!socket.studentData && socket.studentData.sessionId === sessionId && socket.studentData.studentId === studentId;

io.on('connection', (socket) => {
  console.log('🔌 Yangi ulanish:', socket.id);
  lock.svc.registerSocket(socket);

  // Student joins session
  socket.on('student-join', async (data) => {
    data = data || {};
    const { sessionId, device } = data;
    const session = typeof sessionId === 'string' ? db.sessions.find(s => s.id === sessionId) : null;

    if (!session || session.status !== 'active') {
      socket.emit('join-error', { message: 'Sessiya topilmadi yoki tugagan', code: 'not_found' });
      return;
    }

    // Himoya darajasi, ilova attestatsiyasi, guruh ro'yxati va "himoya majburiy" tekshiruvi
    const gate = await lock.svc.gateJoin(socket, session, data);
    if (!gate.ok) {
      socket.emit('join-error', { message: gate.message, code: gate.code });
      return;
    }
    if (session.status !== 'active') {
      socket.emit('join-error', { message: 'Sessiya topilmadi yoki tugagan', code: 'not_found' });
      return;
    }

    // Ro'yxatdagi talaba qayta kirsa (masalan, ilova qayta o'rnatilgan) — mavjud yozuv qayta ishlatiladi
    let student = lock.svc.findExisting(session, gate);
    const reused = !!student;
    if (reused) {
      student.socketId = socket.id;
      student.isActive = true;
    } else {
      student = {
        id: uuidv4().substring(0, 8),
        name: gate.name,
        device: String(device || 'Noma\'lum qurilma').slice(0, 80),
        joinedAt: new Date().toISOString(),
        isActive: true,
        socketId: socket.id,
        violationsCount: 0,
        violations: []
      };
      session.students.push(student);
    }
    lock.svc.onJoined(socket, session, student, gate, reused);
    saveSessionsToFile();
    socket.join(`session-${sessionId}`);
    socket.studentData = { sessionId, studentId: student.id };
    if (session.demo) lock.demo.onStudentJoined(socket, session, student);

    // Notify teacher
    io.to(`teacher-${sessionId}`).emit('student-joined', {
      student,
      totalStudents: session.students.length,
      activeStudents: session.students.filter(s => s.isActive).length
    });

    // Send session info to student (include active quiz or material if already sent)
    const timeDetails = getSessionTimeDetails(session);

    socket.emit('join-success', {
      studentId: student.id,
      sessionName: session.name,
      subject: session.subject,
      locked: lock.svc.effectiveLocked(session, student),
      protection: lock.svc.clientPolicy(session, student),
      ...timeDetails,
      activeQuiz: session.activeQuiz ? {
        quizId: session.activeQuiz.id,
        title: session.activeQuiz.title,
        questions: session.activeQuiz.questions.map(quizLib.publicQuestion),
        timeLimit: session.activeQuiz.timeLimit
      } : null,
      activeMaterial: session.activeMaterial || null,
      materials: session.materials || (session.activeMaterial ? [session.activeMaterial] : []),
      allowedTool: session.allowedTool || null
    });
  });

  // Student rejoins existing session (reconnect resilience)
  socket.on('student-rejoin', (data) => {
    const { sessionId, studentId } = data;
    const session = db.sessions.find(s => s.id === sessionId);
    if (!session || session.status !== 'active') {
      // Tugagan dars: talaba faqat baho yuborishi uchun shaxsi tasdiqlanadi
      const known = session && session.students.find(s => s.id === studentId);
      if (known && (!known.dkh || (typeof data.deviceKey === 'string' && lockModule.sha(data.deviceKey) === known.dkh))) {
        socket.studentData = { sessionId, studentId, ended: true };
      }
      socket.emit('rejoin-error', {
        message: 'Sessiya tugagan yoki topilmadi',
        reason: session ? 'ended' : 'not-found'
      });
      return;
    }

    const student = session.students.find(s => s.id === studentId);
    if (!student) {
      socket.emit('rejoin-error', { message: 'Talaba topilmadi', reason: 'unknown-student' });
      return;
    }
    const rejoinGate = lock.svc.gateRejoin(session, student, data);
    if (!rejoinGate.ok) {
      socket.emit('rejoin-error', { message: rejoinGate.message, reason: rejoinGate.code });
      return;
    }
    if (student) {
      student.socketId = socket.id;
      student.isActive = true;
      saveSessionsToFile();
      socket.join(`session-${sessionId}`);
      socket.studentData = { sessionId, studentId: student.id };
      lock.svc.onRejoined(socket, session, student, data);

      io.to(`teacher-${sessionId}`).emit('student-status-changed', {
        studentId: student.id,
        isActive: true,
        activeStudents: session.students.filter(s => s.isActive).length
      });

      const timeDetails = getSessionTimeDetails(session);
      socket.emit('rejoin-success', {
        studentId: student.id,
        sessionName: session.name,
        subject: session.subject,
        locked: lock.svc.effectiveLocked(session, student),
        protection: lock.svc.clientPolicy(session, student),
        ...timeDetails,
        activeQuiz: session.activeQuiz ? {
          quizId: session.activeQuiz.id,
          title: session.activeQuiz.title,
          questions: session.activeQuiz.questions.map(quizLib.publicQuestion),
          timeLimit: session.activeQuiz.timeLimit
        } : null,
        activeMaterial: session.activeMaterial || null,
        materials: session.materials || (session.activeMaterial ? [session.activeMaterial] : []),
        allowedTool: session.allowedTool || null
      });
    }
  });

  // Teacher sends a Quiz
  socket.on('teacher-send-quiz', (data) => {
    const { sessionId, quiz } = data;
    const session = db.sessions.find(s => s.id === sessionId);
    if (!session) return;
    if (!canManageSession(socket, session)) { socket.emit('auth-error', { message: "Ruxsat yo'q" }); return; }

    session.activeQuiz = {
      id: uuidv4().substring(0, 8),
      title: quiz.title || 'Tezkor Test',
      questions: quizLib.normalizeQuestions(quiz.questions),
      timeLimit: quiz.timeLimit || 0,
      createdAt: new Date().toISOString()
    };
    session.quizSubmissions = [];
    lock.svc.onQuizSent(session, session.activeQuiz);

    const sanitizedQuestions = session.activeQuiz.questions.map(quizLib.publicQuestion);

    io.to(`session-${sessionId}`).emit('new-quiz', {
      quizId: session.activeQuiz.id,
      title: session.activeQuiz.title,
      questions: sanitizedQuestions,
      timeLimit: session.activeQuiz.timeLimit
    });

    socket.emit('quiz-broadcast-success', {
      quizId: session.activeQuiz.id,
      title: session.activeQuiz.title,
      questionsCount: session.activeQuiz.questions.length
    });
  });

  // Student submits Quiz answers
  socket.on('student-submit-quiz', (data) => {
    const { sessionId, studentId, studentName, quizId, answers } = data;
    if (!isOwnStudent(socket, sessionId, studentId) || socket.studentData.ended) return;
    const session = db.sessions.find(s => s.id === sessionId);
    if (!session || !session.activeQuiz || session.activeQuiz.id !== quizId) return;

    // Check if already submitted
    const existing = session.quizSubmissions.find(sub => sub.studentId === studentId);
    if (existing) return;

    let correctCount = 0;
    const questions = session.activeQuiz.questions;
    const results = questions.map(q => {
      const g = quizLib.grade(q, answers && answers[q.id]);
      if (g.isCorrect) correctCount++;
      return { questionId: q.id, type: q.type || 'single', selected: g.selected, correct: g.correct, correctIndex: Array.isArray(g.correct) || typeof g.correct !== 'number' ? undefined : g.correct, isCorrect: g.isCorrect };
    });

    const totalQuestions = questions.length;
    const percentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    const submission = {
      studentId,
      studentName,
      correctCount,
      totalQuestions,
      percentage,
      submittedAt: new Date().toISOString()
    };

    session.quizSubmissions.push(submission);
    const submitter = session.students.find(s => s.id === studentId);
    if (submitter) lock.svc.onQuizSubmitted(session, submitter, quizId, correctCount, totalQuestions, percentage);

    const student = session.students.find(s => s.id === studentId);
    if (student) {
      student.quizScore = `${correctCount}/${totalQuestions} (${percentage}%)`;
      student.quizPercentage = percentage;
    }

    saveSessionsToFile();

    // Send result to the student
    socket.emit('quiz-result', {
      correctCount,
      totalQuestions,
      percentage,
      results
    });

    // Send update to teacher
    io.to(`teacher-${sessionId}`).emit('quiz-submission-update', {
      submission,
      totalSubmissions: session.quizSubmissions.length,
      totalStudents: session.students.length,
      submissions: session.quizSubmissions
    });
  });

  // Teacher sends Material / File / Link
  socket.on('teacher-send-material', (data) => {
    const { sessionId, material } = data;
    const session = db.sessions.find(s => s.id === sessionId);
    if (!session) return;
    if (!canManageSession(socket, session)) { socket.emit('auth-error', { message: "Ruxsat yo'q" }); return; }

    if (!session.materials) session.materials = [];

    const newMaterial = {
      id: uuidv4().substring(0, 8),
      title: material.title || 'Dars Materiali',
      text: material.text || '',
      url: material.url || '',
      fileUrl: material.fileUrl || '',
      fileName: material.fileName || '',
      fileSize: material.fileSize || '',
      fileType: material.fileType || 'document',
      fileLabel: material.fileLabel || 'Hujjat',
      fileColor: material.fileColor || '#2563EB',
      sentAt: new Date().toISOString()
    };

    session.activeMaterial = newMaterial;
    session.materials.unshift(newMaterial);

    io.to(`session-${sessionId}`).emit('new-material', newMaterial);
    socket.emit('material-broadcast-success', newMaterial);
  });

  // Teacher controls external apps / tools (Calculator, Chrome, Whitelist)
  socket.on('teacher-app-control', (data) => {
    const { sessionId, tool, action, url, appName } = data;
    const session = db.sessions.find(s => s.id === sessionId);
    if (!session) return;
    if (!canManageSession(socket, session)) { socket.emit('auth-error', { message: "Ruxsat yo'q" }); return; }

    session.allowedTool = (action === 'open') ? { tool, url: url || null, appName: appName || tool } : null;

    io.to(`session-${sessionId}`).emit('app-control', {
      tool,
      action,
      url: url || null,
      appName: appName || tool,
      timestamp: new Date().toISOString()
    });
  });

  // Teacher joins to monitor
  socket.on('teacher-monitor', (data) => {
    const { sessionId } = data;
    const monitored = db.sessions.find(s => s.id === sessionId);
    if (!monitored || !canManageSession(socket, monitored)) { socket.emit('auth-error', { message: "Ruxsat yo'q" }); return; }
    socket.join(`teacher-${sessionId}`);
    lock.svc.emitOverview(monitored);
    console.log(`👨‍🏫 O'qituvchi monitoring: ${sessionId}`);

    const session = db.sessions.find(s => s.id === sessionId);
    if (session) {
      const ratings = session.ratings || [];
      const totalRatings = ratings.length;
      const sum = ratings.reduce((acc, r) => acc + (Number(r.score) || 0), 0);
      const avg = totalRatings > 0 ? Number((sum / totalRatings).toFixed(1)) : null;
      socket.emit('session-rating-update', {
        sessionId,
        ratings,
        averageRating: avg,
        totalRatings
      });
    }
  });

  // Student rates Teacher & Lesson (1 to 5 stars + optional comment)
  socket.on('student-session-rating', (data) => {
    const { sessionId, studentId, studentName, score, comment } = data;
    if (!isOwnStudent(socket, sessionId, studentId)) return;
    const session = db.sessions.find(s => s.id === sessionId);
    if (!session) return;

    if (!session.ratings) session.ratings = [];

    const numScore = Math.max(1, Math.min(5, parseInt(score, 10) || 5));
    const cleanComment = (comment || '').trim().substring(0, 500);

    const existingIndex = session.ratings.findIndex(r => r.studentId === studentId);
    const ratingItem = {
      studentId: studentId || socket.id,
      studentName: studentName || (session.students.find(s => s.id === studentId)?.name) || "O'quvchi",
      score: numScore,
      comment: cleanComment,
      createdAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      session.ratings[existingIndex] = ratingItem;
    } else {
      session.ratings.push(ratingItem);
    }

    const student = session.students.find(s => s.id === studentId);
    if (student) {
      student.teacherRating = numScore;
      student.teacherFeedback = cleanComment;
    }

    const totalRatings = session.ratings.length;
    const sum = session.ratings.reduce((acc, r) => acc + (Number(r.score) || 0), 0);
    const averageRating = Number((sum / totalRatings).toFixed(1));
    session.averageRating = averageRating;

    // Recalculate stats and save
    session.statistics = calculateSessionStats(session);
    saveSessionsToFile();

    // Broadcast live rating update to teacher monitor room
    io.to(`teacher-${sessionId}`).emit('session-rating-update', {
      sessionId,
      ratings: session.ratings,
      averageRating,
      totalRatings,
      newRating: ratingItem
    });

    socket.emit('session-rating-confirmed', {
      success: true,
      score: numScore,
      message: 'Bahoyingiz muvaffaqiyatli saqlandi!'
    });
  });

  // Student left page (visibility change)
  socket.on('student-left-page', (data) => {
    const { sessionId, studentId } = data;
    if (!isOwnStudent(socket, sessionId, studentId)) return;
    const session = db.sessions.find(s => s.id === sessionId);
    if (session) {
      // If teacher has explicitly opened/allowed an external tool, don't count as violation
      if (session.allowedTool) {
        return;
      }

      const student = session.students.find(s => s.id === studentId);
      if (student) {
        student.isActive = false;
        student.violationsCount = (student.violationsCount || 0) + 1;
        if (!student.violations) student.violations = [];
        student.violations.push({
          time: new Date().toISOString(),
          type: 'left_page'
        });

        io.to(`teacher-${sessionId}`).emit('student-violation', {
          student,
          violationsCount: student.violationsCount,
          message: `⚠️ ${student.name} sahifadan chiqdi! (${student.violationsCount}-marta)`,
          time: new Date().toISOString()
        });
      }
    }
  });

  // Student returned to page
  socket.on('student-returned', (data) => {
    const { sessionId, studentId } = data;
    if (!isOwnStudent(socket, sessionId, studentId)) return;
    const session = db.sessions.find(s => s.id === sessionId);
    if (session) {
      const student = session.students.find(s => s.id === studentId);
      if (student) {
        student.isActive = true;
        io.to(`teacher-${sessionId}`).emit('student-returned', {
          student,
          message: `✅ ${student.name} qaytib keldi`,
          time: new Date().toISOString()
        });
      }
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    if (socket.studentData) {
      const { sessionId, studentId } = socket.studentData;
      const session = db.sessions.find(s => s.id === sessionId);
      if (session) {
        const student = session.students.find(s => s.id === studentId);
        if (student) {
          student.isActive = false;
          io.to(`teacher-${sessionId}`).emit('student-disconnected', {
            student,
            message: `🔴 ${student.name} ulanish uzildi`,
            totalStudents: session.students.length,
            activeStudents: session.students.filter(s => s.isActive).length
          });
        }
      }
    }
    console.log('🔌 Ulanish uzildi:', socket.id);
  });
});

// ============================================
// HTML ROUTES
// ============================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Maxfiylik siyosati va ma'lumot o'chirish sahifasi: egasi/muddat qiymatlari config'dan qo'yiladi (shablon: server/templates)
const renderTemplate = (name) => {
  const tpl = fs.readFileSync(path.join(__dirname, 'server', 'templates', name), 'utf8');
  const o = config.owner || {};
  const st = lock.svc.settings.effective();
  const vals = { OWNER_COMPANY: o.company || '—', OWNER_EMAIL: o.email || '—', OWNER_STIR: o.stir || '—', RETENTION_DAYS: st['retention.afterSemesterDays'], MAX_DAYS: st['retention.maxDays'], UPDATED: '2026-10-03' };
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => String(k in vals ? vals[k] : m).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])));
};
['/privacy-policy', '/privacy', '/privacy-policy.html'].forEach((p) => app.get(p, (req, res) => res.type('html').send(renderTemplate('privacy-policy.html'))));
['/delete-data', '/delete-data.html'].forEach((p) => app.get(p, (req, res) => res.type('html').send(renderTemplate('delete-data.html'))));

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

app.get('/download/apk', (req, res) => {
  const apkPath = path.join(__dirname, 'public', 'downloads', 'edufocus-student.apk');
  if (fs.existsSync(apkPath)) {
    res.download(apkPath, 'EduFocus-Talaba.apk');
  } else {
    res.status(404).send('APK fayli topilmadi. Qayta build qilinmoqda.');
  }
});

app.get('/download/ios', (req, res) => {
  const iosPath = path.join(__dirname, 'public', 'downloads', 'EduFocus-iOS-Simulator.zip');
  if (fs.existsSync(iosPath)) {
    res.download(iosPath, 'EduFocus-iOS-Simulator.zip');
  } else {
    res.status(404).send('iOS ilova fayli topilmadi.');
  }
});

// ============================================
// START SERVER
// ============================================

// ============================================
// DARS REJIMI MODULI (himoya, heartbeat, qoidalar, hisobotlar, admin)
// ============================================
const lock = lockModule.init({
  app, io, legacy: db, config, authMiddleware,
  helpers: { uuid: uuidv4, getSessionTimeDetails, saveSessions: saveSessionsToFile }
});

// ============================================
// O'QITUVCHI MODULI (refresh token, parol tiklash, hisobni o'chirish, push)
// ============================================
const teacherAuth = teacherModule.init({
  app, config, legacy: db, sql: lock.sql, authMiddleware, helpers: { uuid: uuidv4 }, users: lock.svc.users, rosters: lock.svc.rosters,
  // Hisob o'chirilganda: guruhlar, testlar, ro'yxatlar va darslar ham o'chadi
  onDeleteData: (teacherId) => {
    const groups = loadGroups(), packs = loadTestpacks();
    saveGroups(groups.filter(g => g.teacherId !== teacherId));
    saveTestpacks(packs.filter(t => t.teacherId !== teacherId));
    const rosterGroups = lock.svc.rosters.groupsFor(teacherId, false);
    rosterGroups.forEach(g => lock.svc.rosters.deleteGroup(g.id));
    const mine = db.sessions.filter(s => s.teacherId === teacherId && !s.demo);
    mine.forEach(s => { try { lock.svc.lockdata.purgeSession(s.id); } catch (e) { /* */ } });
    db.sessions = db.sessions.filter(s => !mine.includes(s));
    saveSessionsToFile();
    return { groups: groups.length - groups.filter(g => g.teacherId !== teacherId).length, testpacks: packs.length - packs.filter(t => t.teacherId !== teacherId).length, sessions: mine.length };
  },
});
lock.svc.setNotifier((sessionId, kind, data) => {
  const s = db.sessions.find(x => x.id === sessionId);
  if (s && s.teacherId && !s.demo) teacherAuth.push.notify(s.teacherId, kind, { ...data, sessionId, sessionName: s.name }).catch(() => {});
});
// Egasiz (eski) guruh va testlarni demo ustozga yoki birinchi adminga biriktiramiz
(() => {
  const owner = db.teachers.find(t => t.id === 'teacher-demo-01') || db.teachers.find(t => t.role === 'admin');
  if (!owner) return;
  const g = loadGroups(); let n = 0; g.forEach(x => { if (!x.teacherId) { x.teacherId = owner.id; n++; } }); if (n) saveGroups(g);
  const t = loadTestpacks(); let m = 0; t.forEach(x => { if (!x.teacherId) { x.teacherId = owner.id; m++; } }); if (m) saveTestpacks(t);
  if (n || m) console.log(`🔧 Egasiz ${n} guruh va ${m} test ${owner.email} ga biriktirildi`);
})();
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { saveSessionsToFile(); teacherAuth.close(); lock.close(); } finally { process.exit(0); } });
}

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║                                          ║
║   🎓 EduFocus Server ishga tushdi!       ║
║                                          ║
║   📍 http://localhost:${PORT}              ║
║                                          ║
╚══════════════════════════════════════════╝
  `);
});
