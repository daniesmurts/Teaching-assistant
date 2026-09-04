-- Migration 121 — тематический план as structured data (TODO.md "### AO" Phase 3).
--
-- A teacher generating a lecture types the topic as free text and the lecture
-- number by hand, every time — while the course's own РПД already lists both,
-- in order. `services/presentations.ts`'s getPreviousTopics only ever had the
-- *strings* of previously generated decks to go on, which is why "не повторять
-- материал" was the best it could do.
--
-- This is the thing to pick from instead: the lecture plan extracted once from
-- the course's syllabus (courses.syllabus_text, or the latest ready
-- syllabus/material document — documents.getLatestKnowledgeText), then owned
-- by the teacher, who can correct it.
--
-- `presentations.lecture_topic_id` is the other half and the point of the
-- whole exercise: a deck that knows which тема of the РПД it covers is УМК
-- evidence (see AM, X), not a loose file. SET NULL rather than CASCADE — a
-- re-extracted plan must never delete lectures the teacher has already built.
--
-- Expand/contract (CLAUDE.md invariant 12): new table plus one additive
-- nullable column; the previous release runs unchanged against this schema.

CREATE TABLE IF NOT EXISTS course_lecture_topics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id  UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  -- 1-based order in the plan. Doubles as the suggested lecture number, which
  -- is exactly what a тематический план's numbering means in practice.
  position    INTEGER NOT NULL,
  title       TEXT NOT NULL,
  -- The РПД's own wording for what the тема covers, when it gives one — fed
  -- to generation as the lecture's brief so the deck follows the programme
  -- rather than the model's idea of the topic.
  description TEXT,
  -- 'syllabus' — extracted from the programme text; 'manual' — typed or
  -- corrected by the teacher. Kept so a re-extraction can be told to leave
  -- hand-written rows alone later; today it is provenance, not behaviour.
  source      TEXT NOT NULL DEFAULT 'syllabus',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS course_lecture_topics_order_idx
  ON course_lecture_topics (course_id, position);

ALTER TABLE presentations
  ADD COLUMN IF NOT EXISTS lecture_topic_id UUID REFERENCES course_lecture_topics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS presentations_lecture_topic_idx
  ON presentations (lecture_topic_id)
  WHERE lecture_topic_id IS NOT NULL;
