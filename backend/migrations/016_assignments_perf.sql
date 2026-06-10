-- Migration 016 — performance indexes for hot assignment queries.
-- Without these, the /history endpoint does a Seq Scan + Sort at scale.

-- Primary index for the most common access pattern: "give me this teacher's
-- N most recent assignments". Powers /api/grading/history (the Журнал page)
-- and most teacher-scoped lookups. Composite leading column is teacher_id, so
-- it also serves plain WHERE teacher_id = $1 lookups.
CREATE INDEX IF NOT EXISTS assignments_teacher_created_idx
  ON assignments (teacher_id, created_at DESC);

-- Course-filtered history: /history?course_id=… . Partial index excludes the
-- many assignments with no course set, keeping the index small.
CREATE INDEX IF NOT EXISTS assignments_course_created_idx
  ON assignments (course_id, created_at DESC)
  WHERE course_id IS NOT NULL;

-- Status filter (Журнал tabs: pending / approved / sent) — most rows are
-- 'approved' once a teacher works through the queue, so 'pending' is the
-- selective case worth optimising.
CREATE INDEX IF NOT EXISTS assignments_pending_idx
  ON assignments (teacher_id, created_at DESC)
  WHERE status = 'pending';
