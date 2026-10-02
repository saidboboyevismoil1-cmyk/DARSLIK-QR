-- Guruh (ro'yxat) uchun fan; o'qituvchining materiallar kutubxonasi.
ALTER TABLE roster_groups ADD COLUMN subject TEXT NOT NULL DEFAULT '';

CREATE TABLE teacher_materials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- file | link
  title TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',       -- havola yoki /uploads/...
  file_name TEXT NOT NULL DEFAULT '',
  file_size TEXT NOT NULL DEFAULT '',
  file_type TEXT NOT NULL DEFAULT '',
  file_label TEXT NOT NULL DEFAULT '',
  file_color TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_materials_user ON teacher_materials (user_id, created_at DESC);
