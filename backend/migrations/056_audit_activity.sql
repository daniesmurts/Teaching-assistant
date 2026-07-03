-- 056 — full activity logging.
--
-- audit_log (migration 013) was only ever written by the admin / org-structure
-- routes. We now record *every* state-changing action a user takes (a global
-- mutation middleware calls recordAudit on each successful POST/PUT/PATCH/DELETE
-- from an authenticated user), and expose two review surfaces:
--   • institution admins — their own institution's activity (existing endpoint)
--   • platform admin      — cross-institution activity (new /api/admin/audit)
--
-- Two additions the security / 152-FZ trail needs and which are painful to
-- backfill later: the client IP and user-agent of the actor. And a global
-- created_at index for the (institution-agnostic) platform view, plus an
-- action index so filtered reviews stay fast as the table grows.

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS ip_address  TEXT,
  ADD COLUMN IF NOT EXISTS user_agent  TEXT;

-- Platform-admin view scans by time across all institutions.
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);

-- Filter-by-action reviews (both surfaces).
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action, created_at DESC);

-- Filter-by-actor reviews ("everything teacher X did").
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_teacher_id, created_at DESC);
