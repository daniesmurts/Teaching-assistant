-- Migration 089 — РОП Студия v0: market-evidence generation (TODO.md Feature Z, Phase 0).
--
-- One citation-grounded «обоснование актуальности» (market-relevance
-- justification) section per programme, generated from real vacancy data
-- (trudvsem.ru, services/labourMarket.ts) and the direction's профстандарты
-- (already in the ФГОС registry, migration 088). Every generation snapshots
-- the raw source data alongside the generated text, so a later reviewer can
-- check the prose against the numbers directly rather than trust it blind.
--
-- Cached-latest-wins shape, same as program_analyses — append-only history,
-- no draft/publish status: the text is always editable in place (РОП is
-- author of record), matching program_analyses' posture rather than AA's
-- heavier draft/publish workflow (this doesn't get "published" anywhere
-- inside the platform yet — it's copied into an external document by hand).

CREATE TABLE IF NOT EXISTS program_market_evidence (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id         UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  region_code        TEXT NOT NULL,
  region_name        TEXT NOT NULL,
  professions        TEXT[] NOT NULL,
  vacancy_snapshot   JSONB NOT NULL,   -- per-term: {term, total, sample: [{title,employer,salary,url,date}]}
  profstandard_refs  JSONB NOT NULL,   -- [{code,name}] snapshotted at generation time
  section_text       TEXT NOT NULL,
  created_by         UUID REFERENCES teachers(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS program_market_evidence_program_idx
  ON program_market_evidence (program_id, created_at DESC);
