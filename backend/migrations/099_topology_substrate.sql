-- Migration 099 — Topology graph substrate (docs/topology-spec.md, Increment 0).
--
-- programAnalysis.ts already infers prerequisite edges and competency
-- formation-stage links via LLM calls, then discards them — they only ever
-- get embedded in the program_analyses JSONB report blob. This migration
-- gives them a real, id-based, queryable home so a future graph/dashboard
-- can read structured edges instead of re-parsing a cached report.
--
-- Edges carry `origin` so re-running the analysis has a defined effect:
-- 'extracted' rows are replaced wholesale by the next analysis run;
-- 'manual'/'confirmed' rows (no UI writes these yet — added for Increment 4's
-- sandbox, which reuses this schema without another migration) are never
-- touched by re-analysis.
--
-- Competency identity resolves onto the platform's canonical ФГОС registry
-- (fgos_competencies, migration 088) where possible — see the ALTER at the
-- bottom. Only УК/ОПК can resolve (fgos_competencies.type CHECK excludes
-- ПК by design: ПК are programme-owned, not federal, per ФГОС 3++
-- methodology), so the column is nullable and will stay null for ПК rows.

-- One row per lecture/practical/lab/СРС topic — first-class content below
-- the whole-section blob syllabusReview.ts works at today. provenance
-- records whether the source document was in `approved` (rpd_submissions)
-- state or just the `latest` upload — the graph should never claim more
-- confidence than the document backing it has.
CREATE TABLE IF NOT EXISTS program_content_units (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id  UUID NOT NULL REFERENCES program_disciplines(id) ON DELETE CASCADE,
  section        TEXT NOT NULL,   -- ContentSection: lectures|practicals|labs|independent|control
  title          TEXT NOT NULL,
  topics         JSONB,
  source_doc_id  UUID REFERENCES program_documents(id) ON DELETE SET NULL,
  provenance     TEXT NOT NULL DEFAULT 'latest',   -- 'approved' | 'latest'
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS program_content_units_discipline_idx
  ON program_content_units (discipline_id, section, sort_order);

-- The persisted `prerequisite` edge (discipline id based, not name based —
-- programAnalysis.ts's analyzeSequencing matches by discipline name today
-- and silently drops unmatched names; this table is what it now writes to
-- once a name resolves to a real program_disciplines.id).
CREATE TABLE IF NOT EXISTS program_prerequisites (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id                  UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  discipline_id               UUID NOT NULL REFERENCES program_disciplines(id) ON DELETE CASCADE,
  prerequisite_discipline_id  UUID NOT NULL REFERENCES program_disciplines(id) ON DELETE CASCADE,
  reason                      TEXT NOT NULL DEFAULT '',
  inverted                    BOOLEAN NOT NULL DEFAULT FALSE,
  origin                      TEXT NOT NULL DEFAULT 'extracted',   -- extracted|manual|confirmed
  analysis_id                 UUID REFERENCES program_analyses(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS program_prerequisites_pair_uq
  ON program_prerequisites (discipline_id, prerequisite_discipline_id);
CREATE INDEX IF NOT EXISTS program_prerequisites_program_idx
  ON program_prerequisites (program_id);

-- The `contributes-to` edge. content_unit_id is nullable and unpopulated
-- until Increment 2 (discipline-level links only for now) — added now so
-- Increment 2 needs no further migration.
CREATE TABLE IF NOT EXISTS program_competency_links (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id        UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  discipline_id     UUID NOT NULL REFERENCES program_disciplines(id) ON DELETE CASCADE,
  content_unit_id   UUID REFERENCES program_content_units(id) ON DELETE CASCADE,
  competency_id     UUID NOT NULL REFERENCES program_competencies(id) ON DELETE CASCADE,
  stage             TEXT NOT NULL,   -- introduce|develop|master
  origin            TEXT NOT NULL DEFAULT 'extracted',
  analysis_id       UUID REFERENCES program_analyses(id) ON DELETE SET NULL,
  evidence_quote    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Discipline-level dedup only while content_unit_id is always NULL (Postgres
-- treats NULLs as distinct, so a plain UNIQUE(discipline_id, competency_id,
-- stage) would not dedup — the partial index scopes it correctly).
CREATE UNIQUE INDEX IF NOT EXISTS program_competency_links_discipline_uq
  ON program_competency_links (discipline_id, competency_id, stage)
  WHERE content_unit_id IS NULL;
CREATE INDEX IF NOT EXISTS program_competency_links_program_idx
  ON program_competency_links (program_id);

-- The dual-evidence `verifies` edge (docs/topology-spec.md §2). Schema only
-- in Increment 0: assessment_item_id has no FK yet (program_assessment_items
-- doesn't exist until Increment 3a — add the FK via ALTER then) and
-- student_evidence stays unpopulated until the (deferred) R5. Kept here,
-- empty, so R5 stays an addition, not a rewrite.
CREATE TABLE IF NOT EXISTS program_verification_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competency_id       UUID NOT NULL REFERENCES program_competencies(id) ON DELETE CASCADE,
  evidence_kind       TEXT NOT NULL,   -- fos_document | student_evidence
  assessment_item_id  UUID,
  subject_count       INTEGER,
  mastery_rate        NUMERIC(5,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS program_verification_links_competency_idx
  ON program_verification_links (competency_id);

ALTER TABLE program_competencies
  ADD COLUMN IF NOT EXISTS fgos_competency_id UUID REFERENCES fgos_competencies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS program_competencies_fgos_idx
  ON program_competencies (fgos_competency_id) WHERE fgos_competency_id IS NOT NULL;
