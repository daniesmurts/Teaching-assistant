-- Migration 115 — Профстандарт/ОТФ registry (TODO.md "### K", методист
-- feedback item 3): ПК competencies must be traceable to a specific ОТФ
-- (обобщённая трудовая функция) inside a specific профстандарт, at the
-- уровень квалификации matching the programme's own level — and the
-- wording must not simply copy the ОТФ verbatim.
--
-- profstandards/profstandard_otf mirror the fgos_standards/fgos_competencies
-- shape (migration 088) exactly: federal reference data, admin-curated,
-- draft until an admin confirms the review screen (rule #3). A профстандарт
-- is independent of any one ФГОС (many ФГОС can cite the same one), so it
-- gets its own table rather than living nested under fgos_standards —
-- migration 088's own header comment anticipated this ("Feature Z ...
-- doesn't exist yet. Plain columns for now; forward-compatible for a join
-- column later").
--
-- Expand only (rule #12): fgos_profstandard_refs keeps its existing
-- code/name/source_url columns untouched; the new profstandard_id column is
-- nullable and populated only once an admin links an existing ref to a
-- published profstandards row.

CREATE TABLE IF NOT EXISTS profstandards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL,          -- e.g. '40.059'
  name         TEXT NOT NULL,
  source_url   TEXT,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by   UUID REFERENCES teachers(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS profstandards_code_idx   ON profstandards (code);
CREATE INDEX IF NOT EXISTS        profstandards_status_idx ON profstandards (status);

CREATE TABLE IF NOT EXISTS profstandard_otf (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profstandard_id       UUID NOT NULL REFERENCES profstandards(id) ON DELETE CASCADE,
  otf_code              TEXT NOT NULL,   -- 'A' / 'B' / 'C' …
  name                  TEXT NOT NULL,   -- ОТФ formulation, verbatim from source
  qualification_level   TEXT,            -- уровень квалификации, e.g. '6'
  education_requirement TEXT,            -- «Требования к образованию» cell, free text
  is_verbatim_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order            INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS profstandard_otf_standard_idx ON profstandard_otf (profstandard_id);

ALTER TABLE fgos_profstandard_refs
  ADD COLUMN IF NOT EXISTS profstandard_id UUID REFERENCES profstandards(id) ON DELETE SET NULL;

ALTER TABLE program_competencies
  ADD COLUMN IF NOT EXISTS profstandard_otf_id UUID REFERENCES profstandard_otf(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS program_competency_indicators (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_competency_id UUID NOT NULL REFERENCES program_competencies(id) ON DELETE CASCADE,
  code                  TEXT NOT NULL,   -- 'ПК-1.1'
  title                 TEXT NOT NULL,
  sort_order            INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS program_competency_indicators_competency_idx
  ON program_competency_indicators (program_competency_id);
