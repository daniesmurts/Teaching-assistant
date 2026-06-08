-- Migration 013 — institution audit log + email-domain auto-join.

-- Audit trail of institution-admin actions (invites, activations, shared rubrics).
-- actor_email is denormalized so the record survives the teacher being deleted.
CREATE TABLE IF NOT EXISTS audit_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   UUID REFERENCES institutions(id) ON DELETE CASCADE,
  actor_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  actor_email      TEXT,
  action           TEXT NOT NULL,
  target           TEXT,
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_institution_idx ON audit_log (institution_id, created_at DESC);

-- Optional email domain for auto-join: teachers registering with a matching
-- address (e.g. @mgu.ru) are placed into the institution automatically.
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS email_domain TEXT;

CREATE INDEX IF NOT EXISTS institutions_email_domain_idx
  ON institutions (lower(email_domain)) WHERE email_domain IS NOT NULL;
