-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Teachers
CREATE TABLE IF NOT EXISTS teachers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  university    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Courses
CREATE TABLE IF NOT EXISTS courses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT,
  level         TEXT,              -- 'undergraduate_1', 'undergraduate_2', 'postgraduate', 'professional'
  syllabus_text TEXT,              -- extracted plain text of uploaded syllabus
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Reusable grading criteria (individual atoms — teachers mix-and-match at grading time)
CREATE TABLE IF NOT EXISTS criteria (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id            UUID REFERENCES teachers(id) ON DELETE CASCADE,  -- NULL for global templates
  course_id             UUID REFERENCES courses(id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  description           TEXT,
  subject               TEXT,             -- 'business' | 'economics' | 'law' | 'medicine' | 'engineering' | 'humanities' | 'general'
  is_global_template    BOOLEAN NOT NULL DEFAULT FALSE,
  is_institution_shared BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Graded assignments (core data + RAG training signal)
CREATE TABLE IF NOT EXISTS assignments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id        UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id         UUID REFERENCES courses(id) ON DELETE SET NULL,
  student_name      TEXT,
  student_email     TEXT,
  submission_text   TEXT NOT NULL,

  -- AI output (before teacher review)
  ai_score          INTEGER,
  ai_grade          TEXT,
  ai_grade_label    TEXT,
  ai_feedback       TEXT,
  ai_criteria_scores JSONB,        -- [{name, score, feedback, quote?, page?}]
  ai_strengths      JSONB,         -- [{text, quote?, page?}]
  ai_improvements   JSONB,         -- [{text, quote?, page?}]

  -- Criteria + weights actually used for this grading event
  criteria_snapshot JSONB,         -- [{criterion_id, name, weight, description, score?, feedback?}]

  -- Approved output (after teacher review — this is the training signal)
  approved_score    INTEGER,
  approved_grade    TEXT,
  approved_feedback TEXT,
  approved_at       TIMESTAMPTZ,

  -- RAG vector — generated from submission_text after approval
  embedding         vector(1536),

  status            TEXT DEFAULT 'pending',  -- 'pending', 'approved', 'sent'
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Index for vector similarity search
CREATE INDEX IF NOT EXISTS assignments_embedding_idx
  ON assignments USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Lecture presentations
CREATE TABLE IF NOT EXISTS presentations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id       UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id        UUID REFERENCES courses(id) ON DELETE SET NULL,
  lecture_number   INTEGER,
  topic            TEXT NOT NULL,
  duration_minutes INTEGER,
  audience_level   TEXT,
  learning_goals   TEXT[],
  style            TEXT,           -- 'theory_heavy', 'case_study', 'discussion_based'
  slide_count_target INTEGER,
  generated_content TEXT,          -- the full formatted slide-by-slide output
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
