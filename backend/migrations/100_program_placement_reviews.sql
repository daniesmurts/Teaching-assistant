-- Migration 100 — «Место дисциплины в структуре ОП» check (docs/topology-spec.md
-- decision 2026-07-29). A discipline's РПД §2 declares which disciplines
-- come before it (предшествующие) and which come after (последующие). Until
-- now this section was parsed by nobody: `syllabusReview`/`documentReview`
-- score the ЗУВ/competency sections but never touch §2.
--
-- This mirrors program_document_reviews (migration 051) exactly — one row
-- per run, latest per discipline_id read by the UI — but the `result` JSONB
-- holds a PlacementReviewResult (shared/types.ts) instead of a
-- DisciplineCoverageResult: the declared predecessor/successor list as
-- parsed from §2, plus findings that compare it against (a) the real plan
-- (program_disciplines.semester), (b) the programme's own направление/
-- профиль, and (c) other disciplines' own declared placement (asymmetry).
CREATE TABLE IF NOT EXISTS program_placement_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id     UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  discipline_id  UUID NOT NULL REFERENCES program_disciplines(id) ON DELETE CASCADE,
  document_id    UUID NOT NULL REFERENCES program_documents(id) ON DELETE CASCADE,
  result         JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS program_placement_reviews_program_idx
  ON program_placement_reviews (program_id, created_at DESC);
CREATE INDEX IF NOT EXISTS program_placement_reviews_discipline_idx
  ON program_placement_reviews (discipline_id, created_at DESC);

-- Matched, non-inverted declared edges are synced into the topology graph
-- (program_prerequisites, migration 099) as origin='declared' — a §2
-- statement is a higher-precision prerequisite source than the whole-plan
-- LLM inference ('extracted', capped at 8-20 edges), so it should densify
-- the graph rather than sit in a second, disconnected table. 'declared'
-- rows follow the same re-analysis rule as 'manual'/'confirmed': re-running
-- analyzeSequencing (origin='extracted') never touches them; only re-running
-- THIS discipline's placement review replaces its own 'declared' edges.
-- No CHECK constraint on origin (see 099) — this is purely a documentation
-- comment on the value space.
