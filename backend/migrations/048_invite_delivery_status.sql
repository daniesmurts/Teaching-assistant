-- Migration 048 — Surface invite-email delivery status in the admin panel.
--
-- Until now invite send was fire-and-forget: the admin saw «приглашён» the
-- moment the row was inserted, even when Unisender / SMTP rejected the
-- recipient (e.g. free-tier domain-whitelist 403s). Adding two columns lets
-- the invite list show «письмо не доставлено» so admins find out from the
-- panel instead of by SSH'ing into a VM.
--
-- Tri-state:
--   email_delivered = TRUE   → sent successfully
--   email_delivered = FALSE  → send attempted and failed (see email_error)
--   email_delivered = NULL   → status unknown (existing rows from before this
--                              migration; treat as "no signal", not as failure)

ALTER TABLE teacher_invites
  ADD COLUMN IF NOT EXISTS email_delivered BOOLEAN,
  ADD COLUMN IF NOT EXISTS email_error     TEXT;
