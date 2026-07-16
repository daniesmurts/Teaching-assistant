-- Migration 080 — ФОС generator (TODO.md Feature X, v1).
--
-- One row per GENERATION RUN (not one-per-course, unlike
-- syllabus_studio_drafts) — a teacher regenerates a ФОС each semester and
-- should keep history, matching the long_reviews precedent. sections/coverage
-- are null until the pg-boss job completes; sections is partially populated
-- as each sub-generator (quizzes/tasks/tickets/criteria) finishes, so a
-- crash mid-run leaves earlier sections visible/editable rather than losing
-- everything.

CREATE TABLE IF NOT EXISTS fos_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id       UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id      UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending|processing|ready|failed
  progress_done   INT NOT NULL DEFAULT 0,
  progress_total  INT NOT NULL DEFAULT 0,
  sections        JSONB,
  coverage        JSONB,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fos_documents_course_idx  ON fos_documents (course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fos_documents_teacher_idx ON fos_documents (teacher_id, created_at DESC);
