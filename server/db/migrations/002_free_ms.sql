-- Qulf ochiq (talaba erkin) vaqt: himoyali ham, himoyasiz ham hisoblanmaydi
ALTER TABLE student_stats ADD COLUMN free_ms INTEGER NOT NULL DEFAULT 0;
