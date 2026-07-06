-- Migration 058 — public marketing-site contact/lead messages.
-- Separate from `feedback` (in-app, authenticated teacher feedback): these come
-- from anonymous visitors on /contact and /research, have a different shape
-- (name, email, organisation, topic) and are triaged as a sales/partnerships
-- inbox rather than a product-feedback one.

CREATE TABLE IF NOT EXISTS contact_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  organization TEXT,
  topic        TEXT NOT NULL DEFAULT 'support',  -- 'support' | 'demo' | 'research' | 'billing'
  message      TEXT NOT NULL,
  source_page  TEXT NOT NULL,                    -- 'contact' | 'research'
  status       TEXT NOT NULL DEFAULT 'new',       -- 'new' | 'read'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contact_messages_created_idx ON contact_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS contact_messages_status_idx ON contact_messages (status);
