-- Migration 036 — institutional flywheel (Phase 3 of the loop work).
--
-- Two opt-in flags wire together: an institution master toggle, and a
-- per-course toggle on the teacher's own course. Both must be ON for that
-- course's approved grades to surface in another teacher's RAG retrieval.
--
-- Cross-teacher pooling is matched on course `code` (preferred, exact) or
-- case-insensitive course `name` (fallback). Course matching is intentionally
-- conservative — a later admin override could explicitly link mismatched names.

-- 1. Institution-level master toggle. OFF by default so deploy is no-op.
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS shared_rag_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Per-course opt-in by the course owner.
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS share_rag_with_institution BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index for the institution-pool retrieval CTE. We frequently query
-- "all approved assignments in institution X with shared courses matching
-- (code OR name)" — this index speeds the courses join.
CREATE INDEX IF NOT EXISTS courses_share_rag_idx
  ON courses (LOWER(code), LOWER(name))
  WHERE share_rag_with_institution = TRUE;

-- 3. View for the audit / transparency surfaces. Joins rag_retrievals
-- (migration 033) with teachers so we can count "how many times did a grade
-- by teacher A help with a grade by teacher B in the same institution".
CREATE OR REPLACE VIEW rag_institution_uses AS
SELECT
  rr.id                       AS retrieval_id,
  rr.retrieved_assignment_id,
  rr.grading_assignment_id,
  rr.retrieved_at,
  retrieved.teacher_id        AS retrieved_teacher_id,
  grading.teacher_id          AS grading_teacher_id,
  retrieved_t.institution_id  AS institution_id
FROM rag_retrievals rr
JOIN assignments retrieved   ON retrieved.id = rr.retrieved_assignment_id
JOIN assignments grading     ON grading.id   = rr.grading_assignment_id
JOIN teachers   retrieved_t  ON retrieved_t.id = retrieved.teacher_id
JOIN teachers   grading_t    ON grading_t.id   = grading.teacher_id
WHERE retrieved.teacher_id <> grading.teacher_id
  AND retrieved_t.institution_id = grading_t.institution_id
  AND retrieved_t.institution_id IS NOT NULL;
