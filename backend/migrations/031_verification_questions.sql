-- Migration 031 — verification questions on every regular grade.
--
-- Two or three short questions the AI suggests the teacher could ask the
-- student to verify the student understands their own writing. Same model as
-- the ВКР defence questions but per-grade (faster, cheaper, on every work).
-- Shape per item: { question, quote?, page? }. Frontend gates rendering on
-- Pro tier; storage is unconditional so an upgrade reveals past questions.

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS ai_verification_questions JSONB;
