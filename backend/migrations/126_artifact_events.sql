-- Migration 126 — artefact outcome events (Layer 2 of admin analytics).
--
-- Layer 1 (db/queries/artifactUsage.ts) answers "what did teachers create",
-- derived from the artefact tables with no instrumentation at all. It cannot
-- answer "did anyone actually use it", and that gap is structural:
--
--   • Exports and downloads are GET requests, and middleware/auditLog.ts
--     deliberately skips reads ("they would bury the security-relevant
--     events"). So the strongest signal that a generated artefact reached a
--     lecture hall — the teacher downloading the .pptx — is recorded nowhere.
--   • api_usage_log only sees calls that cost tokens; an export costs none.
--
-- This table is that missing signal, generalising the shape
-- presentation_slide_events already proved out for decks. Additive only —
-- nothing reads it until the admin page does, so a rollback to the previous
-- image leaves an unused table behind rather than a broken one (rule 12).

CREATE TABLE IF NOT EXISTS artifact_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Artefact family. Shares the vocabulary of ARTIFACT_SOURCES.kind wherever
  -- the exported thing is an artefact ('presentation', 'fos_document', …), and
  -- extends past it for reports that are rendered from live data and never
  -- stored as a row ('rpd_monitor', 'umc_dashboard', 'institution_usage').
  kind           TEXT NOT NULL,

  -- 'exported' today. Left open for 'edited' / 'approved' / 'shared' without
  -- another migration — but note that edits and approvals are POST/PATCH and
  -- therefore already in audit_log; only add them here if a derived read from
  -- audit_log proves insufficient, rather than double-recording by default.
  event          TEXT NOT NULL,

  -- The specific object, when there is one. NULL for whole-institution
  -- reports, which are rendered from a query rather than read from a row.
  artifact_id    UUID,

  -- Who acted. ON DELETE SET NULL, not CASCADE: a departed teacher's account
  -- being removed must not silently rewrite the platform's usage history.
  teacher_id     UUID REFERENCES teachers(id)     ON DELETE SET NULL,
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,

  -- 'pptx' | 'pdf' | 'docx' | 'xlsx' | 'csv' | original upload type.
  format         TEXT,

  -- Free-form context (e.g. { "variant": "handout" }). Never user-controlled
  -- prose — the call sites write fixed keys.
  metadata       JSONB,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The dashboard read: exports per kind over a window.
CREATE INDEX IF NOT EXISTS artifact_events_kind_idx
  ON artifact_events (kind, created_at DESC);

-- "Which teachers export, and how often" — the retention cut.
CREATE INDEX IF NOT EXISTS artifact_events_teacher_idx
  ON artifact_events (teacher_id, created_at DESC);

-- "Was this particular deck ever exported" — per-object lookups.
CREATE INDEX IF NOT EXISTS artifact_events_artifact_idx
  ON artifact_events (artifact_id) WHERE artifact_id IS NOT NULL;
