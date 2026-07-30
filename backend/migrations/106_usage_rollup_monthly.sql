-- Migration 106 — TODO.md Feature AL, Phase 1: unit economics.
--
-- One row per (month, teacher_id) — the trend source for the capacity/
-- margin dashboard, computed by services/usageRollup.ts and treated as
-- immutable once a month has closed (a workflow convention, not a DB-level
-- lock — re-running the current, still-open month is expected and just
-- upserts). Deliberately teacher-month grain, not a single pre-aggregated
-- row per (month, tier): percentiles (p50/p95/max cost per tier — what
-- actually matters for freemium, not the mean) can only be computed from
-- per-teacher figures, and a year of these rows (~a few thousand for this
-- platform's scale) is drastically cheaper to scan than a year of raw
-- api_usage_log rows while still preserving that granularity.
--
-- effective_tier is computed via lib/planTier.ts's computeEffectiveTier at
-- ROLLUP TIME, not historically reconstructed — teachers.plan_tier has no
-- history table, so a teacher who upgraded/downgraded after the month in
-- question shows their CURRENT tier for that past month. Known limitation,
-- not fixable without retrofitting tier-change history; out of scope here.
--
-- amortized_revenue_* covers this teacher's OWN payments (pro_monthly/
-- pro_annual) apportioned to this month — see amortizedRevenueForMonthRub()
-- in services/usageRollup.ts. NULL when the teacher's plan comes from
-- institution seat inheritance (no personal payment) or is free tier.

CREATE TABLE IF NOT EXISTS usage_rollup_monthly (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month                 TEXT NOT NULL,   -- 'YYYY-MM'
  teacher_id            UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  institution_id        UUID REFERENCES institutions(id) ON DELETE SET NULL,   -- snapshotted at rollup time
  effective_tier        TEXT NOT NULL,
  call_count            INTEGER NOT NULL DEFAULT 0,
  total_tokens          BIGINT  NOT NULL DEFAULT 0,
  cost_usd              NUMERIC(14,6) NOT NULL DEFAULT 0,
  amortized_revenue_rub NUMERIC(14,2),
  amortized_revenue_usd NUMERIC(14,6),
  fx_rate_used          NUMERIC(10,4),   -- frozen at rollup time — see fxRate.ts; never re-derived at render time
  fx_rate_date          TEXT,
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (month, teacher_id)
);

CREATE INDEX IF NOT EXISTS usage_rollup_monthly_month_idx ON usage_rollup_monthly (month);
CREATE INDEX IF NOT EXISTS usage_rollup_monthly_institution_idx ON usage_rollup_monthly (institution_id, month);
