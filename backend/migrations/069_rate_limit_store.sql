-- Migration 069 — shared Postgres-backed rate-limit store.
--
-- express-rate-limit's default MemoryStore is per-process. PM2 runs the API
-- in cluster mode (2 workers, ecosystem.config.js), so every limiter counter
-- was actually 2 independent counters round-robined across — a login
-- brute-force guard configured for "10 attempts/15min" allowed ~20 in
-- practice, and every counter reset on deploy/restart. This table backs a
-- custom Store (services/rateLimitStore.ts) shared by all workers.

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  limiter_name  TEXT        NOT NULL,
  key           TEXT        NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  hits          INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (limiter_name, key, window_start)
);

-- Sweeps rely on window_start range scans (per-limiter cleanup + resetKey).
CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_window ON rate_limit_hits (window_start);
