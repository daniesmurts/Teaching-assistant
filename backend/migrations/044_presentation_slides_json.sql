-- Migration: typed slide objects for the lecture generator.
--
-- The generator used to emit a text DSL ("СЛАЙД N: ..." + bullets + notes)
-- stored verbatim in `generated_content`. The frontend parsed it back. That
-- made every slide the same shape — bullets + notes — which is exactly the
-- monotony teachers complained about.
--
-- New rows store a typed `slides` array (title / bullets / concept / formula
-- / comparison / diagram / discussion / summary) plus optional picked image.
-- The frontend renders each type with its own layout (KaTeX for formulas,
-- 2-col tables for comparisons, image slot for diagrams).
--
-- Old rows are NOT backfilled. Renderer falls back to parsing
-- `generated_content` whenever `slides` is null.

ALTER TABLE presentations
  ADD COLUMN IF NOT EXISTS slides JSONB;
