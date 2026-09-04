-- Migration 118 — presentation outline approval gate (TODO.md "### AO" Phase 0).
--
-- Generation is outline (cheap, one call, seconds) + expansion (~20 calls,
-- minutes) since AG Phase 1, but the teacher never sees the outline: they
-- wait behind a spinner and then get a finished deck they can't restructure
-- without regenerating the whole thing. This lets the job stop after the
-- outline, hand the plan back, and expand only once the teacher confirms it
-- — structural fixes land before we pay for ~20 expansions, not after.
--
-- Expand/contract (CLAUDE.md invariant 12): all four columns are additive
-- and nullable, and `status` is plain TEXT with no CHECK constraint, so the
-- new 'outline_ready' value needs no schema change. The previous release
-- keeps working against this schema — it simply never writes these columns
-- and never produces that status. The one rollback wrinkle worth naming: a
-- job left sitting in 'outline_ready' when the code is rolled back has
-- nothing to advance it, so it expires via the sweep below (or the teacher
-- regenerates); no presentation row was created and no usage was billed at
-- that point, so nothing is lost but the outline itself.

ALTER TABLE presentation_jobs
  -- Resolved GenerateParams, stored server-side so the confirm request
  -- carries only the edited outline. The client must not be able to swap the
  -- conspectus/course/plan-gated depth between the two halves of one
  -- generation, and re-posting 20k chars of conspectus to confirm a plan
  -- would be absurd besides.
  ADD COLUMN IF NOT EXISTS params           JSONB,
  -- The proposed plan (PresentationOutlineSlide[]), overwritten by the
  -- teacher's edited version when they confirm.
  ADD COLUMN IF NOT EXISTS outline          JSONB,
  -- Web-search grounding captured during the outline pass and replayed into
  -- expansion, so the approval gate doesn't cost a second search call.
  ADD COLUMN IF NOT EXISTS web_grounding    JSONB,
  -- When the plan was handed back — the TTL clock for the sweep, distinct
  -- from created_at (which is when generation started).
  ADD COLUMN IF NOT EXISTS outline_ready_at TIMESTAMPTZ;

-- Drives the sweep that expires unconfirmed outlines (presentationJobWorker.ts's
-- sweepStaleOutlines). Partial — only outline_ready rows are ever scanned.
CREATE INDEX IF NOT EXISTS presentation_jobs_outline_ready_idx
  ON presentation_jobs (outline_ready_at)
  WHERE status = 'outline_ready';
