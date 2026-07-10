-- Production incident log — populated by errorHandler.ts on unknown 500s and
-- DB_UNAVAILABLE. Gives per-client blast radius for a given error code
-- ("which institutions hit LONG_REVIEW_TIMEOUT this week") and is the table a
-- future support agent queries to match against docs/support/runbooks/*.
CREATE TABLE IF NOT EXISTS production_incidents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL,          -- AppError.code, or 'DB_UNAVAILABLE' / 'INTERNAL_ERROR'
  message      TEXT NOT NULL,
  path         TEXT,
  method       TEXT,
  teacher_id   UUID REFERENCES teachers(id) ON DELETE SET NULL,
  stack        TEXT,
  telegram_sent BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Runbook/agent lookup by code, most-recent-first browsing in an admin view
CREATE INDEX IF NOT EXISTS production_incidents_code_idx ON production_incidents (code, created_at DESC);
CREATE INDEX IF NOT EXISTS production_incidents_unresolved_idx ON production_incidents (created_at DESC) WHERE resolved_at IS NULL;
