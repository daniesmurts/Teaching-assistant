-- Migration 042 — Academic programs / учебные планы (institution-admin feature).
--
-- A department head (institution_admin) defines an образовательная программа
-- (направление подготовки) as an ordered list of disciplines across semesters,
-- plus the ФГОС competencies (УК/ОПК/ПК) and goals the plan must deliver. The
-- platform then runs a program-level architecture analysis (sequencing &
-- prerequisites, competency progression, gaps & redundancy, relatedness/load).
--
-- Everything is scoped to the institution. A discipline may *optionally* link to
-- an existing course (courses.id) so the analysis can read its РПД content; the
-- link is nullable so a plan can be sketched before any РПД exists.
--
-- The last analysis is cached in program_analyses so the detail page opens
-- instantly; it is recomputed on demand.

CREATE TABLE IF NOT EXISTS programs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id     UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  created_by         UUID REFERENCES teachers(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,
  code               TEXT,                                   -- направление, e.g. '09.03.01'
  level              TEXT,                                   -- 'bachelor' | 'master' | 'specialist'
  duration_semesters INTEGER NOT NULL DEFAULT 8,
  description        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS programs_institution_idx ON programs (institution_id, created_at DESC);

-- ФГОС targets the plan must deliver. kind = 'competency' carries a УК/ОПК/ПК
-- code; kind = 'goal' is a free-form program goal (code null).
CREATE TABLE IF NOT EXISTS program_competencies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'competency',           -- 'goal' | 'competency'
  code        TEXT,                                         -- 'УК-1' / 'ОПК-2' / 'ПК-3' (null for goals)
  title       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS program_competencies_program_idx ON program_competencies (program_id, sort_order);

-- Disciplines in teaching order. semester is 1..duration_semesters; sort_order
-- orders disciplines within a semester. competency_codes lists which program
-- competencies the discipline claims to develop (optional, free-form codes).
CREATE TABLE IF NOT EXISTS program_disciplines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id        UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  course_id         UUID REFERENCES courses(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  semester          INTEGER NOT NULL DEFAULT 1,
  credits           NUMERIC(5,1),                           -- зачётные единицы (optional)
  competency_codes  TEXT[] NOT NULL DEFAULT '{}',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS program_disciplines_program_idx
  ON program_disciplines (program_id, semester, sort_order);

-- Cached analysis result (latest per program is what we read back).
CREATE TABLE IF NOT EXISTS program_analyses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  result      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS program_analyses_program_idx ON program_analyses (program_id, created_at DESC);
