-- Migration 012 — institution-shared rubrics.
-- Rubrics created from the institution admin panel are marked shared so they
-- appear in every member teacher's grading rubric picker (the "Общие рубрики
-- кафедры" promise). Personal rubrics stay private to their owner.

ALTER TABLE rubrics
  ADD COLUMN IF NOT EXISTS is_institution_shared BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS rubrics_institution_shared_idx
  ON rubrics (teacher_id) WHERE is_institution_shared;
