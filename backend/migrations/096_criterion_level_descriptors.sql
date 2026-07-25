-- Migration 096 — per-level descriptors on grading criteria.
--
-- A criterion carried only `name` + free-text `description`, so nothing told
-- the model what a 90 looks like versus a 70 *for that criterion*. It had to
-- infer the level boundaries from the criterion's name alone, which drives
-- both score noise and generic feedback ("слабая аргументация") — measured
-- per-criterion comments averaged 239 chars with only 34% carrying a verified
-- quote.
--
-- Shape: a JSONB object keyed by the Russian 5-point grade letter, values are
-- free text, every key optional —
--   {"5": "...", "4": "...", "3": "...", "2": "..."}
-- Keyed by letter rather than a score range because the bands are already
-- canonical (shared/grades.ts GRADE_BRACKETS) and a teacher thinks in «на
-- пятёрку / на тройку», not in [87,100]. Stored as JSONB, not a child table,
-- for the same reason as brs_schemes.grade_thresholds: a fixed-shape, ≤4-entry
-- map always read and written together with its parent row, never queried
-- independently or joined.
--
-- Nullable with no backfill: an existing criterion simply has no descriptors
-- and the prompt omits the block, exactly as before.

ALTER TABLE criteria
  ADD COLUMN IF NOT EXISTS level_descriptors JSONB;
