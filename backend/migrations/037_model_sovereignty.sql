-- Migration 037 — model sovereignty (Phase 4 of the loop work).
--
-- institutions.preferred_provider — NULL = platform default. Validated by a
-- CHECK so we can add new providers without breaking old rows.
--
-- assignments.ai_provider — which provider actually graded this row.
-- NULL for rows graded before Phase 4 deploy. The audit story makes "which
-- model wrote this draft" answerable per-grade, which is essential when
-- comparing providers in the eval harness or after a model swap.

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS preferred_provider TEXT
  CHECK (preferred_provider IN ('deepseek', 'yandex', 'gigachat'));

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS ai_provider TEXT;

-- Hot read path: "this institution's recent grades, by provider, for the
-- eval-comparison panel". Partial index keeps it tight.
CREATE INDEX IF NOT EXISTS assignments_provider_idx
  ON assignments (ai_provider, status, approved_at DESC)
  WHERE status = 'approved' AND ai_provider IS NOT NULL;
