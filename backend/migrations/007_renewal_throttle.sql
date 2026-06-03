-- Migration 007 — throttle renewal attempts so PM2 restarts can't cause
-- repeat charges / email spam within a day.

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS renewal_last_attempt_at TIMESTAMPTZ;
