-- Migration 108 — TODO.md Feature AL Phase 4: in-process resource sampler.
--
-- Everything Phase 2/3's capacity model reads today is a single LIVE
-- snapshot (pg_stat_activity right now, pg_database_size right now) — fine
-- for "what's happening this second," useless for "what's the worst it's
-- been." This table is a history of the metrics only visible from inside
-- the app: process RSS/heap (RAM usage has no other visibility — the VM's
-- disk/RAM % isn't queryable from SQL, and Yandex Cloud Monitoring is blind
-- to DB pool exhaustion, pgvector row counts, and per-worker rate-limit
-- state, per TODO.md's own reasoning for not integrating it).
--
-- One row per sample tick (~60s, services/resourceSampler.ts, worker-0-only
-- in PM2 cluster mode — same gating precedent as services/renewals.ts).
-- Retention-pruned by the sampler itself (30 days) so this doesn't grow
-- unbounded — at 60s intervals that's ~43,200 rows/month, small enough not
-- to need a separate cleanup job.

CREATE TABLE IF NOT EXISTS resource_samples (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sampled_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rss_bytes             BIGINT  NOT NULL,   -- process.memoryUsage().rss
  heap_used_bytes       BIGINT  NOT NULL,   -- process.memoryUsage().heapUsed
  load_avg_1m           NUMERIC(8,2) NOT NULL,   -- os.loadavg()[0]
  free_mem_bytes        BIGINT  NOT NULL,   -- os.freemem() — whole-VM free RAM, not just this process
  db_size_bytes         BIGINT  NOT NULL,   -- pg_database_size(current_database())
  db_connections        INTEGER NOT NULL,   -- pg_stat_activity count
  embedded_assignments  INTEGER NOT NULL    -- pgvector reindex trigger gate — same count as db/queries/capacity.ts's live read
);

CREATE INDEX IF NOT EXISTS resource_samples_sampled_at_idx ON resource_samples (sampled_at DESC);
