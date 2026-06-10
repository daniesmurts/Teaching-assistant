-- Migration 019 — let teachers edit the strengths / improvements bullet lists
-- on approval. Until now only `approved_feedback` (free text) was editable;
-- the AI's bullet lists were stored once and shown as-is. With revisions, the
-- previous-version improvements feed back into the next grading round — so
-- the teacher needs to be able to correct, remove, or add bullets before the
-- approval is committed.

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS approved_strengths    TEXT[],
  ADD COLUMN IF NOT EXISTS approved_improvements TEXT[];
