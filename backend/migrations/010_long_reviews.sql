-- Migration 010 — long-document review jobs (ВКР / диплом / большие работы).
-- These are processed asynchronously via section-aware map-reduce, so we need a
-- job row the frontend can poll. The teacher-facing grade still lands in the
-- assignments table (assignment_id) so history / approval / email reuse applies.

CREATE TABLE IF NOT EXISTS long_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id      UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id       UUID REFERENCES courses(id) ON DELETE SET NULL,
  rubric_id       UUID REFERENCES rubrics(id) ON DELETE SET NULL,
  student_name    TEXT,
  student_email   TEXT,
  student_group   TEXT,
  submission_text TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending|analyzing|synthesizing|ready|failed
  progress_done   INTEGER NOT NULL DEFAULT 0,
  progress_total  INTEGER NOT NULL DEFAULT 0,
  assignment_id   UUID REFERENCES assignments(id) ON DELETE SET NULL,
  result          JSONB,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS long_reviews_teacher_idx ON long_reviews (teacher_id, created_at DESC);
