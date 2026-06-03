-- Migration 001 — initial schema (idempotent: safe to run on any environment).
-- On a fresh database this creates all base tables; where they already exist
-- (e.g. dev, where schema.sql was applied manually) every statement no-ops.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS teachers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  university    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT,
  level         TEXT,
  syllabus_text TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rubrics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id   UUID REFERENCES courses(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  criteria    JSONB NOT NULL,
  is_default  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assignments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id        UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id         UUID REFERENCES courses(id) ON DELETE SET NULL,
  rubric_id         UUID REFERENCES rubrics(id) ON DELETE SET NULL,
  student_name      TEXT,
  student_email     TEXT,
  submission_text   TEXT NOT NULL,
  ai_score          INTEGER,
  ai_grade          TEXT,
  ai_grade_label    TEXT,
  ai_feedback       TEXT,
  ai_criteria_scores JSONB,
  ai_strengths      TEXT[],
  ai_improvements   TEXT[],
  approved_score    INTEGER,
  approved_grade    TEXT,
  approved_feedback TEXT,
  approved_at       TIMESTAMPTZ,
  embedding         vector(1536),
  status            TEXT DEFAULT 'pending',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assignments_embedding_idx
  ON assignments USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE TABLE IF NOT EXISTS presentations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id       UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id        UUID REFERENCES courses(id) ON DELETE SET NULL,
  lecture_number   INTEGER,
  topic            TEXT NOT NULL,
  duration_minutes INTEGER,
  audience_level   TEXT,
  learning_goals   TEXT[],
  style            TEXT,
  slide_count_target INTEGER,
  generated_content TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
