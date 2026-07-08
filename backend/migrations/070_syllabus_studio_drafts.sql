-- Migration 070 — persist РПД-студия (Feature T5) drafts.
--
-- Previously computed live and never saved (see syllabusAuthor.ts's old
-- header comment) — a page refresh lost the generated content and any
-- edits. One row per course, upserted in place (same "latest state, not
-- history" shape as course_policy_memos) since this is a draft the teacher
-- iterates on, not an audit trail.

CREATE TABLE IF NOT EXISTS syllabus_studio_drafts (
  course_id       UUID PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id      UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  discipline_name TEXT NOT NULL,
  sections        JSONB NOT NULL,
  competencies    JSONB NOT NULL DEFAULT '[]',
  goals           JSONB NOT NULL DEFAULT '[]',
  review          JSONB,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS syllabus_studio_drafts_teacher_idx ON syllabus_studio_drafts (teacher_id);
