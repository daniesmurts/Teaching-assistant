-- Migration 063 — agentic calc verification (TODO Feature S).
--
-- Stores the raw per-step verdict trace from services/calcVerifier.ts —
-- not just the mismatches merged into ai_improvements as bullets, but every
-- extracted step (including 'correct' and 'unevaluable') so the full trace
-- is inspectable via the API/eval harness, not only what surfaced to the
-- teacher as a flagged finding.

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS ai_calc_verification JSONB;
