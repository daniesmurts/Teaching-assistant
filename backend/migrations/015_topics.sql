-- Migration 015 — AI topic generator (research / practicals topic suggestions).

CREATE TABLE IF NOT EXISTS topic_sets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id     UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id      UUID REFERENCES courses(id) ON DELETE SET NULL,
  level          TEXT NOT NULL,                -- bachelor|specialist|master|postgraduate
  work_type      TEXT NOT NULL,                -- coursework|thesis|internship|pre_diploma|article
  field          TEXT,                         -- направление / специальность
  interests      TEXT,                         -- научные/практические интересы студента
  practice_site  TEXT,                         -- место практики / исследования
  topics         JSONB NOT NULL,               -- TopicItem[]
  used_search    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS topic_sets_teacher_idx ON topic_sets (teacher_id, created_at DESC);
