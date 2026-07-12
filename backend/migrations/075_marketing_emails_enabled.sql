-- Opt-out flag for one-off feature-announcement broadcasts (sent manually via
-- an external mail tool, not through emailTransport.ts), distinct from
-- nudge_emails_enabled — a teacher may want onboarding tips but not feature
-- announcements, or vice versa. See services/marketingEmails.ts.
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS marketing_emails_enabled BOOLEAN NOT NULL DEFAULT TRUE;
