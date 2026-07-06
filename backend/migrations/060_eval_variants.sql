-- Migration 060 — variant dimension on eval_results.
--
-- The flywheel replay so far only varied K (RAG example count). Adding
-- contrastive retrieval and policy memos (migrations from the same
-- release) means we need to A/B those against the baseline too. `variant`
-- distinguishes which retrieval/prompt configuration produced a given
-- replay row; default 'baseline' keeps all existing rows meaningful.

ALTER TABLE eval_results ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT 'baseline';

ALTER TABLE eval_results DROP CONSTRAINT IF EXISTS eval_results_run_id_assignment_id_k_key;
ALTER TABLE eval_results ADD CONSTRAINT eval_results_run_id_assignment_id_k_variant_key
  UNIQUE (run_id, assignment_id, k, variant);
