-- O'qituvchi paneli/ilovasi: refresh tokenlar, parolni tiklash, push tokenlar.
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  family TEXT NOT NULL,                 -- bir kirish seansi; qayta ishlatish aniqlansa butun oila bekor qilinadi
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  replaced_by TEXT,
  user_agent TEXT
);
CREATE INDEX idx_refresh_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_family ON refresh_tokens (family);

CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE push_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,               -- ios | android
  token TEXT NOT NULL,
  device_id TEXT,
  locale TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  UNIQUE (platform, token)
);
CREATE INDEX idx_push_user ON push_tokens (user_id);
