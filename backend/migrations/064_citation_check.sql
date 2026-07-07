-- Migration 064 — citation existence checking (TODO Feature T).
--
-- Stores the raw per-reference verdict trace from services/citationChecker.ts
-- — every extracted bibliography entry (found / similar_found / not_found),
-- not just the not_found entries merged into ai_improvements as bullets —
-- so the full trace is inspectable via the API, not only what surfaced to
-- the teacher as a flagged finding.

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS ai_citation_check JSONB;
