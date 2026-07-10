-- Activation & retention tracking. The activation *events* themselves need no
-- new tables — first course / first grade / first presentation are derived
-- from courses/assignments/presentations MIN(created_at) per teacher. What's
-- genuinely missing is (a) when a teacher was last active, (b) a record of
-- which lifecycle nudge emails were sent (idempotency for the hourly sweep),
-- and (c) an opt-out flag the sweep must respect.

-- Touched by authenticate.ts on any authenticated request, throttled to one
-- write per 15 min per teacher. Activity, not logins — JWTs live 7 days, so
-- login events would undercount returning users who never re-authenticate.
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Lifecycle-email opt-out (unsubscribe link in every nudge email points at a
-- tokenised endpoint that flips this). Security/billing mail ignores this flag.
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS nudge_emails_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- One row per nudge actually sent. The UNIQUE pair is the idempotency guard —
-- the hourly sweep can never double-send a nudge type to the same teacher.
CREATE TABLE IF NOT EXISTS activation_nudges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  nudge_type  TEXT NOT NULL,   -- 'activation_24h' | 'activation_72h'
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, nudge_type)
);
