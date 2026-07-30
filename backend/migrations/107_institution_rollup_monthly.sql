-- Migration 107 — TODO.md Feature AL, Phase 1: institution-level unit
-- economics. One row per (month, institution_id), companion to migration
-- 106's per-teacher rollup.
--
-- Two things live here that don't belong on the per-teacher table:
--   * overhead_* — cost from shared/institution-wide work that carries a
--     teacher_id on its api_usage_log row but whose BENEFIT isn't that
--     teacher's (rpd_reminder today — see OVERHEAD_FEATURES in
--     services/usageRollup.ts; cohort synthesis and institution-pool RAG
--     retrieval are NOT yet separably tagged by feature and so still land
--     on the triggering teacher's row for now — a known, documented gap).
--   * seats_purchased / amortized_revenue_* — derived from
--     institution_contracts (migration 105), the platform's only record of
--     institution revenue. NULL when no contract term covers this month.
--
-- active_seats = COUNT(DISTINCT teacher_id) from usage_rollup_monthly for
-- this institution+month — the seat-utilization signal: purchased vs.
-- actually-used seats is a leading churn indicator and the input to a
-- net-revenue-retention story, per the Phase 1 design note in TODO.md.

CREATE TABLE IF NOT EXISTS institution_rollup_monthly (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month                  TEXT NOT NULL,   -- 'YYYY-MM'
  institution_id         UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  active_seats           INTEGER NOT NULL DEFAULT 0,
  seats_purchased        INTEGER,
  overhead_call_count    INTEGER NOT NULL DEFAULT 0,
  overhead_tokens        BIGINT  NOT NULL DEFAULT 0,
  overhead_cost_usd      NUMERIC(14,6) NOT NULL DEFAULT 0,
  amortized_revenue_rub  NUMERIC(14,2),
  amortized_revenue_usd  NUMERIC(14,6),
  fx_rate_used           NUMERIC(10,4),
  fx_rate_date           TEXT,
  computed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (month, institution_id)
);

CREATE INDEX IF NOT EXISTS institution_rollup_monthly_month_idx ON institution_rollup_monthly (month);
