-- Migration 103 — TODO.md Improvement #13: api_usage_log.cost_usd is not
-- platform AI cost. Every Yandex call (chat/embed/vision/images/search) was
-- either logged with a hardcoded costUsd:0 or never logged at all, so the
-- entire RAG substrate and every auto-image/web-grounding call (Feature AG
-- Phase 2/3a) costs money the ledger reports as zero — and both
-- spendCap.ts's per-teacher cap and globalSpendCap.ts's platform cap sum
-- cost_usd, so they're structurally blind to it.
--
-- Yandex bills in RUB, DeepSeek/Qwen bill in USD. cost_usd stays the
-- canonical converted figure every existing query already reads
-- (getDailyUsage, getTodayCost, both spend caps) — these three columns are
-- purely additive, so no other query needs to change.

ALTER TABLE api_usage_log
  ADD COLUMN IF NOT EXISTS cost_native  NUMERIC(14,6),  -- cost in the provider's native billing currency
  ADD COLUMN IF NOT EXISTS currency     TEXT,           -- 'USD' | 'RUB'
  ADD COLUMN IF NOT EXISTS fx_rate_used NUMERIC(10,4);  -- RUB per $1 at the moment of conversion; NULL for USD rows (no conversion happened)
