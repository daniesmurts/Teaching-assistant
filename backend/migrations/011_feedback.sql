-- Migration 011 — in-app user feedback.
-- Stored so nothing is lost even if the notification email fails; also forwarded
-- to the owner's inbox (ADMIN_NOTIFY_EMAIL) like signup/purchase notifications.

CREATE TABLE IF NOT EXISTS feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID REFERENCES teachers(id) ON DELETE SET NULL,
  category    TEXT NOT NULL DEFAULT 'other',  -- 'bug' | 'idea' | 'question' | 'other'
  message     TEXT NOT NULL,
  page        TEXT,                           -- where the user was when submitting
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback (created_at DESC);
