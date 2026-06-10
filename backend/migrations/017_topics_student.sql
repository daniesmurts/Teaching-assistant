-- Migration 017 — attach generated topic sets to a specific student (optional).
-- Lets the teacher come back to old generations later and find the ones they
-- made for «Иванова» without scanning the whole list. Indexed for that lookup.

ALTER TABLE topic_sets
  ADD COLUMN IF NOT EXISTS student_name  TEXT,
  ADD COLUMN IF NOT EXISTS student_group TEXT;

-- Partial index — only useful when student_name is populated, keeps the index small.
CREATE INDEX IF NOT EXISTS topic_sets_student_idx
  ON topic_sets (teacher_id, student_name, created_at DESC)
  WHERE student_name IS NOT NULL;
