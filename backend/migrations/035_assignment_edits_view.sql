-- Migration 035 — assignment_edits view.
--
-- Per-grade signal of how far the teacher edited the AI's draft. Three flavours
-- of edit-distance, all bounded:
--   score_delta            — abs(ai_score − approved_score), 0–100
--   feedback_changed       — 0/1, did the prose change at all
--   strengths_kept_pct     — 0–1, fraction of AI strengths kept verbatim
--   improvements_kept_pct  — same for improvements
--
-- Captured signal for now; downstream uses include:
--   - admin platform-wide quality dashboard
--   - eval harness as a quality dimension that doesn't need re-running models
--   - future prompt/preference tuning experiments
--
-- Plain VIEW (not materialised) — the underlying assignments table is the
-- bottleneck and the new partial index (migration 034) makes teacher-scoped
-- selects cheap. Promote to MATERIALIZED VIEW only if/when query volume
-- justifies it.

CREATE OR REPLACE VIEW assignment_edits AS
SELECT
  a.id,
  a.teacher_id,
  a.course_id,
  a.approved_at,
  ABS(a.ai_score - a.approved_score) AS score_delta,
  CASE
    WHEN a.approved_feedback IS NULL OR a.approved_feedback = a.ai_feedback THEN 0
    ELSE 1
  END AS feedback_changed,
  -- Bullets retention: NULL approved_strengths means the teacher accepted
  -- the AI defaults wholesale → 100% retention. An empty AI list is NULL
  -- (no signal); otherwise count text-matches.
  CASE
    WHEN COALESCE(jsonb_array_length(a.ai_strengths), 0) = 0 THEN NULL
    WHEN a.approved_strengths IS NULL THEN 1.0
    ELSE (
      SELECT COUNT(*)::float / GREATEST(jsonb_array_length(a.ai_strengths), 1)
        FROM jsonb_array_elements(a.ai_strengths) AS ai_b
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(a.approved_strengths) AS tch
          WHERE tch->>'text' = ai_b->>'text'
       )
    )
  END AS strengths_kept_pct,
  CASE
    WHEN COALESCE(jsonb_array_length(a.ai_improvements), 0) = 0 THEN NULL
    WHEN a.approved_improvements IS NULL THEN 1.0
    ELSE (
      SELECT COUNT(*)::float / GREATEST(jsonb_array_length(a.ai_improvements), 1)
        FROM jsonb_array_elements(a.ai_improvements) AS ai_b
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(a.approved_improvements) AS tch
          WHERE tch->>'text' = ai_b->>'text'
       )
    )
  END AS improvements_kept_pct
FROM assignments a
WHERE a.status = 'approved'
  AND a.ai_score IS NOT NULL
  AND a.approved_score IS NOT NULL;
