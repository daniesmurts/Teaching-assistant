-- Migration 006 — recurring subscriptions

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS rebill_id          TEXT,          -- T-Bank rebill token (saved card)
  ADD COLUMN IF NOT EXISTS auto_renew         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS subscription_plan  TEXT,          -- 'pro_monthly' | 'pro_annual'
  ADD COLUMN IF NOT EXISTS renewal_failed_at  TIMESTAMPTZ;   -- set when a renewal charge first fails (grace window)

-- Fast lookup for the daily renewal job
CREATE INDEX IF NOT EXISTS teachers_renewal_idx
  ON teachers (plan_expires_at)
  WHERE auto_renew = TRUE AND rebill_id IS NOT NULL;
