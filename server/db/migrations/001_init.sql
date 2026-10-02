-- Vaqtlar: UNIX epoch, millisekund (INTEGER). JSON ustunlar: TEXT.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT, surname TEXT, phone TEXT, school TEXT, subject TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher',          -- teacher | admin
  faculty_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE faculties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- scope: global | faculty (scope_id = fakultet id)
CREATE TABLE settings (
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (scope, scope_id, key)
);

-- Guruh ro'yxatlari (CSV bilan yuklanadi)
CREATE TABLE roster_groups (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  faculty_id TEXT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE roster_students (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES roster_groups(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  hemis_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_roster_name ON roster_students (group_id, full_name);

-- Bir marta bog'lash: talaba ismi ↔ qurilma (qurilma kaliti faqat hash ko'rinishida)
CREATE TABLE device_bindings (
  roster_student_id TEXT PRIMARY KEY REFERENCES roster_students(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  platform TEXT,
  bound_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX ix_bind_device ON device_bindings (device_hash);

-- Himoya hodisalari jurnali
CREATE TABLE lock_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,                        -- info | warn | critical
  level TEXT,
  data TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX ix_events_session ON lock_events (session_id, ts);

-- Har talabaning dars bo'yicha jamlama ko'rsatkichlari
CREATE TABLE student_stats (
  session_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT,
  roster_student_id TEXT,
  level TEXT,
  joined_at INTEGER NOT NULL,
  protected_ms INTEGER NOT NULL DEFAULT 0,
  unprotected_ms INTEGER NOT NULL DEFAULT 0,
  offline_ms INTEGER NOT NULL DEFAULT 0,
  assumed_ms INTEGER NOT NULL DEFAULT 0,
  bypass_count INTEGER NOT NULL DEFAULT 0,
  focus_zero INTEGER NOT NULL DEFAULT 0,
  absent INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, student_id)
);

CREATE TABLE session_quizzes (
  session_id TEXT NOT NULL,
  quiz_id TEXT NOT NULL,
  title TEXT,
  questions INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, quiz_id)
);
CREATE TABLE quiz_results (
  session_id TEXT NOT NULL,
  quiz_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  correct INTEGER NOT NULL,
  total INTEGER NOT NULL,
  pct INTEGER NOT NULL,
  submitted_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, quiz_id, student_id)
);

-- Himoyasiz kirish va favqulodda chiqish so'rovlari
CREATE TABLE access_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,                            -- exemption | emergency_exit
  student_id TEXT,
  student_name TEXT,
  reason TEXT,
  device TEXT,
  status TEXT NOT NULL DEFAULT 'pending',        -- pending | approved | denied
  secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT,
  consumed_at INTEGER
);
CREATE INDEX ix_requests_session ON access_requests (session_id, status);

-- Anonim agregat statistika
CREATE TABLE telemetry_daily (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  dim1 TEXT NOT NULL DEFAULT '',
  dim2 TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric, dim1, dim2)
);

CREATE TABLE deletion_requests (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  session_code TEXT,
  name_norm TEXT,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'pending',        -- pending | done | rejected
  resolved_at INTEGER,
  resolved_by TEXT,
  note TEXT
);

-- Attestatsiya
CREATE TABLE attest_challenges (
  nonce TEXT PRIMARY KEY,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE ios_attest_keys (
  key_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
