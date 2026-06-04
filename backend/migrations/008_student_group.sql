-- Migration 008 — student groups (denormalized, free-text per submission)

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS student_group TEXT;

-- Speeds up the per-student timeline and the students aggregation
CREATE INDEX IF NOT EXISTS assignments_student_idx
  ON assignments (teacher_id, student_name);
