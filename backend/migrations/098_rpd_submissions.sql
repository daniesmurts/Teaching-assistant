-- Migration 098 — РПД approval workflow (docs/RPD-WORKFLOW.md phase 4b).
--
-- Until now the platform had artifacts (program_documents,
-- program_document_reviews) but no STATE: nothing recorded whether a
-- discipline's РПД was a draft, submitted for review, returned, forwarded to
-- УМЦ, or approved. This is the missing state machine.
--
-- One active submission per discipline (UNIQUE) — re-submitting after a
-- return supersedes the previous document (migration 084's supersede model)
-- rather than creating a second submission row.
CREATE TABLE IF NOT EXISTS rpd_submissions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id         UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  discipline_id      UUID NOT NULL REFERENCES program_disciplines(id) ON DELETE CASCADE,
  document_id        UUID REFERENCES program_documents(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'draft',
  -- Which stage returned it: 'rop' | 'umc' | NULL (not currently returned).
  -- Derivable from which status the return happened FROM (submitted->returned
  -- is always 'rop', forwarded->returned is always 'umc'), but stored
  -- explicitly so the UI/queues don't have to reconstruct it from the event
  -- log on every read.
  returned_by_stage  TEXT,
  submitted_by       UUID REFERENCES teachers(id) ON DELETE SET NULL,
  submitted_at       TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (discipline_id)
);

CREATE INDEX IF NOT EXISTS rpd_submissions_program_status_idx ON rpd_submissions (program_id, status);
CREATE INDEX IF NOT EXISTS rpd_submissions_status_idx         ON rpd_submissions (status);

-- Append-only transition log — same "audit trail survives independently of
-- current state" posture as approved_revisions (rule #5). Answers "who
-- returned this and why" without trusting the mutable row above.
CREATE TABLE IF NOT EXISTS rpd_submission_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  UUID NOT NULL REFERENCES rpd_submissions(id) ON DELETE CASCADE,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  actor_id       UUID REFERENCES teachers(id) ON DELETE SET NULL,
  comment        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rpd_submission_events_submission_idx
  ON rpd_submission_events (submission_id, created_at);
