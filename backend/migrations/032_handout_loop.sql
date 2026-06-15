-- Migration 032 — close the handout → revision loop.
--
-- ai_handout: snapshot of the last handout the teacher composed for this
-- assignment. Latest compose overrides. When the student submits a revision
-- linked to this assignment, the handout's improvements + questions become
-- the contract the AI checks against (instead of the full approved_improvements
-- list). Shape:
--   { improvements: string[], questions: string[], subject, body,
--     tone: 'encouraging'|'neutral'|'direct', created_at }
--
-- ai_question_responses: per-question status from the revision-grading call.
-- Mirrors ai_revision_check's shape but for the questions the handout asked.
-- Shape: [{ question, status: 'answered'|'partial'|'unanswered', note }]

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS ai_handout            JSONB,
  ADD COLUMN IF NOT EXISTS ai_question_responses JSONB;
