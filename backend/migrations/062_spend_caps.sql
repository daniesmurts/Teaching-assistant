-- Migration 062 — per-teacher monthly spend cap (TODO #8).
--
-- Optional admin override on top of the plan-tier default cap in
-- planLimits.ts. NULL means "use the plan-tier default" — set explicitly
-- only when an admin needs to raise/lower the ceiling for one account
-- without changing its plan tier.

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS monthly_spend_cap_usd NUMERIC(10,4);
