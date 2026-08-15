-- Migration 113 — control-plane skeleton (docs/on-prem-deployment.md §16
-- Track 1.6, §5 for the full design).
--
-- Every deployment of ИСПУМ — our own cloud, and eventually on-prem
-- customers — pushes the same signed telemetry envelope to these tables.
-- The admin dashboard (Track 1.7) reads ONLY from here, never production
-- data directly, so a deployment behind a university firewall and our own
-- cloud tenant look identical to the dashboard code. Phase 1 (this
-- migration): our own cloud pushes to itself over localhost — one
-- deployment, zero on-prem risk, proves the whole mechanism end to end.
--
-- deployment_id identifies WHO sent an envelope; envelopes are rejected at
-- the ingest route unless they verify against that deployment's own
-- public_key, so one deployment's key can never forge another's telemetry
-- (matters starting the moment a real on-prem deployment exists, so the
-- key is per-row from day one rather than retrofitted later).

CREATE TABLE IF NOT EXISTS deployments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,               -- human label, e.g. "ИСПУМ Cloud"
  mode                  TEXT NOT NULL DEFAULT 'saas', -- 'saas' | 'dedicated' | 'onprem' (Track 2.1's DEPLOYMENT_MODE, mirrored here)
  -- What's NORMAL for this deployment's connectivity — distinct from
  -- whether it's currently live/stale (that's derived from
  -- last_heartbeat_at at render time, not stored). An air-gapped
  -- deployment going quiet for a month is expected; a 'connected' one
  -- going quiet for a day is an alert. See §5.5.
  expected_connectivity TEXT NOT NULL DEFAULT 'connected', -- 'connected' | 'offline_export'
  -- Ed25519 public key (SPKI PEM), verified against every envelope this
  -- deployment sends. NULL only for the 'ispum-cloud' seed row before its
  -- keypair is generated and wired in via env — the ingest route refuses
  -- any envelope for a deployment with no key on file, so this can't be
  -- silently skipped once traffic is expected.
  public_key            TEXT,
  license_id            TEXT,                        -- Track 2.7, not built yet
  contact_name          TEXT,
  contact_email         TEXT,
  first_seen_at         TIMESTAMPTZ,                  -- set on first accepted envelope, not row creation
  last_heartbeat_at     TIMESTAMPTZ,
  current_version       TEXT,                         -- app_version from the most recent envelope
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only raw envelopes — the audit trail, and it lets every derived
-- table below be recomputed if their own shape changes later. JSONB, not
-- flattened: the envelope's own shape (§5.2) will grow (new model fields,
-- new health metrics) faster than this table's schema should need to.
CREATE TABLE IF NOT EXISTS deployment_heartbeats (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  envelope      JSONB NOT NULL   -- only ever inserted after signature verification passes
);

CREATE INDEX IF NOT EXISTS deployment_heartbeats_deployment_idx
  ON deployment_heartbeats (deployment_id, received_at DESC);

-- Flattened usage rollups — literally institution_rollup_monthly (migration
-- 107) plus deployment_id. institution_id here is the REMOTE deployment's
-- own id for that institution, opaque to us — never joined against our
-- local institutions table. Cloud reports one row per its own institution
-- (same grain the source table already has); an on-prem deployment reports
-- one row, for itself.
CREATE TABLE IF NOT EXISTS deployment_usage_monthly (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id          UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  month                  TEXT NOT NULL,               -- 'YYYY-MM'
  institution_id         UUID NOT NULL,               -- opaque — the sender's own id, not ours
  active_seats           INTEGER NOT NULL DEFAULT 0,
  seats_purchased        INTEGER,
  overhead_call_count    INTEGER NOT NULL DEFAULT 0,
  overhead_tokens        BIGINT  NOT NULL DEFAULT 0,
  overhead_cost_usd      NUMERIC(14,6) NOT NULL DEFAULT 0,
  amortized_revenue_rub  NUMERIC(14,2),
  amortized_revenue_usd  NUMERIC(14,6),
  received_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A deployment resending a corrected rollup for a month it already sent
  -- must overwrite, not duplicate — see upsertDeploymentUsageMonthly.
  UNIQUE (deployment_id, month, institution_id)
);

CREATE INDEX IF NOT EXISTS deployment_usage_monthly_deployment_idx
  ON deployment_usage_monthly (deployment_id, month);

-- Flattened incident counts by deployment AND app version — the version
-- axis is what lets us spot "this only happens on the 2026-08 build" across
-- the fleet (§5.4's AdminErrors rationale). Aggregated counts over a
-- reporting window, not raw incident rows — production_incidents.message
-- is never forwarded (§5.2's "error_code + message class only" rule); this
-- ships only production_incidents.code, since the source table has no
-- separate message-classification field yet to bucket by (a known
-- simplification, not a design decision — revisit if incident triage ever
-- needs finer granularity than code alone).
CREATE TABLE IF NOT EXISTS deployment_incidents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  app_version   TEXT NOT NULL,
  code          TEXT NOT NULL,
  count         INTEGER NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  window_end    TIMESTAMPTZ NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deployment_incidents_deployment_idx
  ON deployment_incidents (deployment_id, window_end DESC);

-- Seed the first deployment — our own cloud. Fixed, well-known id so the
-- agent (services/controlPlane/agent.ts) can reference it without a lookup.
-- public_key starts NULL; wired in once the keypair is generated
-- (backend/scripts/generateControlPlaneKeypair.ts) and CONTROL_PLANE_*
-- env vars are set — the ingest route refuses envelopes for a deployment
-- with no key on file, so an unconfigured agent fails loudly, not silently.
INSERT INTO deployments (id, name, mode, expected_connectivity)
VALUES ('00000000-0000-0000-0000-000000000001', 'ИСПУМ Cloud', 'saas', 'connected')
ON CONFLICT (id) DO NOTHING;
