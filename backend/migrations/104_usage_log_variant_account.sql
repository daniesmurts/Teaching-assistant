-- Migration 104 — TODO.md Feature AL, Phase 0. Two more dimensions
-- api_usage_log needs before per-teacher/per-institution coefficients and
-- provider-account health are derivable:
--
--   * variant — e.g. presentation depth ('standard' | 'deep'). Deliberately
--     a column, not a new `feature` enum value: getDailyUsage and friends
--     filter on `feature = 'presentation'`, and a 'presentation_deep' value
--     would silently split that aggregate in two everywhere it's read.
--   * account — which DeepSeek account (of up to 5, see llm/deepseek.ts's
--     multi-account fallback) actually served the call. Without this we can
--     count 429/402 failures but not tell which account is unhealthy, how
--     often fallback fires, or whether the primary is silently carrying
--     100% of traffic while the other 4 configured accounts sit untested.

ALTER TABLE api_usage_log
  ADD COLUMN IF NOT EXISTS variant TEXT,   -- e.g. 'standard' | 'deep' for presentation generation
  ADD COLUMN IF NOT EXISTS account TEXT;   -- DeepSeek account label ('primary', 'key-2', ...); NULL for single-account providers

CREATE INDEX IF NOT EXISTS api_usage_log_account_idx ON api_usage_log (account, created_at DESC) WHERE account IS NOT NULL;
