-- Migration 034 — indexes for the Learning Loop queries.
--
-- All four learning-loop metric queries filter on the same predicates:
--   teacher_id = $1 AND status = 'approved' AND approved_at >= NOW() - INTERVAL …
-- The existing assignments_teacher_created_idx (migration 016) keys on
-- `created_at`, not `approved_at`, so those queries fell back to a Seq Scan
-- on the approved subset. This partial composite index serves all four:
-- style_match, volume, bullets_retention_30d, and the weekly trend.

CREATE INDEX IF NOT EXISTS assignments_teacher_approved_idx
  ON assignments (teacher_id, approved_at DESC)
  WHERE status = 'approved' AND approved_at IS NOT NULL;
