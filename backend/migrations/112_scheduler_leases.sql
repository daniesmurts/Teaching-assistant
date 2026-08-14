-- Migration 112 — container-native scheduler singleton
-- (docs/on-prem-deployment.md §16 Track 1.4).
--
-- Replaces the `NODE_APP_INSTANCE !== '0'` gate that five schedulers used to
-- decide "am I the one process that runs the cron?". That variable is set by
-- **PM2**, so it is unset in a container and every replica falls through to
-- the '0' default — meaning every replica believes it is worker 0. With two
-- API containers that fires renewals and payment reconciliation twice per
-- cycle. It is a PM2-ism that must not survive into an artifact other people
-- run on infrastructure we don't control.
--
-- Model: a short LEASE per job name, claimed per tick, not leader election at
-- start-up. Every instance keeps its timers; each tick races to claim the
-- lease and only the winner does the work. Consequences:
--   • exactly one execution per interval, for any number of instances
--   • no failover problem — if the holder dies mid-tick the lease simply
--     expires and the next tick elsewhere picks the work up. Start-up leader
--     election would instead stall every background job until a restart.
--   • no long-held transactions (an advisory lock held across a multi-second
--     renewals sweep would pin a pool connection for the duration)
--
-- The lease is deliberately NOT released when the work finishes: holding it to
-- expiry is what enforces "don't run this again until the interval is up".
-- Lease TTL is therefore chosen per job as a fraction of its interval — long
-- enough to cover a slow run, short enough that the next tick can claim it.

CREATE TABLE IF NOT EXISTS scheduler_leases (
  job_name     TEXT PRIMARY KEY,
  -- Opaque per-process id (host:pid:rand) — diagnostic only, never used for
  -- correctness. Answers "which instance has been running the crons?" when a
  -- job appears to have stopped.
  holder       TEXT        NOT NULL,
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL
);

-- Claims are single-row upserts by primary key, so no extra index is needed.
-- The table holds one row per named job (a handful, forever) — it never grows.
