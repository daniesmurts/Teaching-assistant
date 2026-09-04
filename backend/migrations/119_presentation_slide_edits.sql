-- Migration 119 — per-slide editing + regeneration (TODO.md "### AO" Phase 1).
--
-- Until now a generated deck was immutable apart from swapping a slide's
-- image: a teacher who disliked one slide had to regenerate the whole deck
-- (new spend, and every slide they liked rerolled) or fix it in PowerPoint,
-- which forks the deck out of the platform for good.
--
-- Two additions:
--
-- 1. `source_text` / `strict_source` on presentations. Regenerating one slide
--    has to rebuild the same GenerateParams the deck was written under, and
--    the conspectus was the one input never persisted — a strict-conspectus
--    deck would otherwise be "regenerated" from the topic string, i.e. from
--    invented material, which is exactly what strict mode exists to prevent.
--    Decks generated before this migration have neither, and regenerate
--    treats them as ordinary RAG/topic-grounded decks (see
--    services/presentations.ts's paramsFromPresentation).
--
-- 2. `presentation_slide_events` — the first real quality signal this feature
--    has. The eval harness (presentationEvalHarness.ts) scores structural
--    proxies offline: notes length, bullets share, image coverage. None of
--    them answer "was this slide any good". Which slides teachers rewrite,
--    regenerate or delete does, and it falls out of the editing UI for free.
--
-- Expand/contract (CLAUDE.md invariant 12): both columns are additive and
-- nullable, and the events table is new — the previous release runs unchanged
-- against this schema.

ALTER TABLE presentations
  ADD COLUMN IF NOT EXISTS source_text   TEXT,
  ADD COLUMN IF NOT EXISTS strict_source BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS presentation_slide_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  presentation_id UUID NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  teacher_id      UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  -- edited | regenerated | deleted | inserted | reordered
  event           TEXT NOT NULL,
  -- Position at the time of the action. Indices shift under insert/delete/
  -- reorder, so this is a breadcrumb, not a key — slide_title/slide_type are
  -- what make an event legible after the deck has moved on. Slides carry no
  -- stable id today; giving them one would orphan every already-persisted
  -- deck's slides, and this signal is aggregate ("which slides get rewritten")
  -- rather than per-object, so it doesn't need one.
  slide_index     INTEGER NOT NULL,
  slide_type      TEXT,
  slide_title     TEXT,
  -- The teacher's free-text steer on a regenerate ("короче", "добавь пример
  -- с числами"). Null for every other event. Read as data, never replayed as
  -- an instruction anywhere but the prompt it was written for.
  instruction     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Which slides in this deck were touched" — the per-deck read the UI and any
-- later kept-verbatim analysis both make. Kept-verbatim is deliberately NOT a
-- stored event: it's the complement (a slide index with no event), so
-- recording it would mean writing a row for every slide of every deck to say
-- nothing happened.
CREATE INDEX IF NOT EXISTS presentation_slide_events_deck_idx
  ON presentation_slide_events (presentation_id, created_at DESC);

-- "How often is this feature's output rewritten, over time" — the aggregate
-- question the eval harness can't answer on its own.
CREATE INDEX IF NOT EXISTS presentation_slide_events_teacher_idx
  ON presentation_slide_events (teacher_id, created_at DESC);
