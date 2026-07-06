-- Migration 061 — cohort-level synthesis for published assignments.
--
-- Aggregates approved feedback across all submissions of one published
-- assignment (Research.md §5.1) into class-wide insight: common gaps, grade
-- distribution, standout strengths, suggested lecture topics. One row per
-- published assignment; regenerated on demand (teacher-triggered, not
-- automatic — LLM cost per regeneration scales with cohort size).

CREATE TABLE IF NOT EXISTS cohort_syntheses (
  published_assignment_id UUID PRIMARY KEY REFERENCES published_assignments(id) ON DELETE CASCADE,
  generated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  based_on_count           INTEGER NOT NULL,
  result                   JSONB NOT NULL,
  model_used               TEXT
);
