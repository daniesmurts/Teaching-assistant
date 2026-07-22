-- Feature AA v1 — ФГОС 3++ registry (TODO.md "### AA").
--
-- A ФГОС ВО is federal law, one per (направление, level), identical for
-- every institution on the platform — this is shared reference data curated
-- by a platform admin (routes/adminFgos.ts, requireAdmin), never
-- institution-scoped data. `status` is the "never auto-published" gate: a
-- row created by extraction stays 'draft' until the admin confirms the
-- review screen; only 'published' rows are meant for downstream consumers
-- (Feature Z's профстандарт selection, K's conformance check, X-v2's
-- паспорт ФОС).
--
-- No FK from fgos_profstandard_refs to a профстандарт table — Feature Z
-- (which would own `profstandard_nodes`) doesn't exist yet. Plain columns
-- for now; forward-compatible for a join column later.

CREATE TABLE IF NOT EXISTS fgos_standards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_code  TEXT NOT NULL,            -- e.g. '09.03.04'
  level           TEXT NOT NULL,            -- бакалавриат | магистратура | специалитет | аспирантура
  title           TEXT NOT NULL,
  generation      TEXT,                     -- e.g. '3++'
  order_number    TEXT,                     -- приказ №
  order_date      DATE,                     -- приказ date
  source_url      TEXT,
  effective_date  DATE,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by      UUID REFERENCES teachers(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fgos_standards_direction_idx ON fgos_standards (direction_code, level);
CREATE INDEX IF NOT EXISTS fgos_standards_status_idx    ON fgos_standards (status);

CREATE TABLE IF NOT EXISTS fgos_competencies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fgos_standard_id      UUID NOT NULL REFERENCES fgos_standards(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL CHECK (type IN ('УК', 'ОПК')),
  code                  TEXT NOT NULL,      -- e.g. 'УК-1'
  formulation           TEXT NOT NULL,      -- verbatim from the source document
  is_verbatim_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order            INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS fgos_competencies_standard_idx ON fgos_competencies (fgos_standard_id);

CREATE TABLE IF NOT EXISTS fgos_structure_requirements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fgos_standard_id  UUID NOT NULL REFERENCES fgos_standards(id) ON DELETE CASCADE,
  block_label       TEXT NOT NULL,          -- e.g. 'Блок 1. Дисциплины (модули)'
  min_credits       NUMERIC,
  max_credits       NUMERIC,
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS fgos_structure_requirements_standard_idx ON fgos_structure_requirements (fgos_standard_id);

CREATE TABLE IF NOT EXISTS fgos_profstandard_refs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fgos_standard_id  UUID NOT NULL REFERENCES fgos_standards(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,          -- e.g. '06.001'
  name              TEXT NOT NULL,
  source_url        TEXT
);

CREATE INDEX IF NOT EXISTS fgos_profstandard_refs_standard_idx ON fgos_profstandard_refs (fgos_standard_id);
