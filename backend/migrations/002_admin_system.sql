-- Migration 002 — admin system, plan tiers, usage logging

-- ─── Institutions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS institutions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  plan_tier    TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'pro' | 'institution'
  max_teachers INTEGER,                        -- NULL = unlimited
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Extend teachers ─────────────────────────────────────────────────────────
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS role                TEXT        NOT NULL DEFAULT 'teacher',
  ADD COLUMN IF NOT EXISTS institution_id      UUID        REFERENCES institutions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_tier           TEXT        NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS plan_started_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_expires_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_id     TEXT,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- role values: 'teacher' | 'institution_admin' | 'platform_admin'
-- plan_tier values: 'free' | 'pro' | 'institution'

-- ─── Global template flag on rubrics ─────────────────────────────────────────
ALTER TABLE rubrics
  ADD COLUMN IF NOT EXISTS is_global_template BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS template_subject   TEXT;

-- template_subject: 'business' | 'economics' | 'law' | 'medicine' | 'engineering' | 'humanities' | 'general'

-- ─── API usage log ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_usage_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id     UUID REFERENCES teachers(id) ON DELETE SET NULL,
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  feature        TEXT    NOT NULL,   -- 'grading' | 'presentation' | 'feedback_email' | 'embedding'
  model          TEXT    NOT NULL,   -- 'deepseek-chat'
  input_tokens   INTEGER NOT NULL,
  output_tokens  INTEGER NOT NULL,
  cost_usd       NUMERIC(10,6),
  duration_ms    INTEGER,
  success        BOOLEAN NOT NULL DEFAULT TRUE,
  error_code     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_usage_log_teacher_idx    ON api_usage_log (teacher_id,     created_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_log_institution_idx ON api_usage_log (institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_log_feature_idx    ON api_usage_log (feature,         created_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_log_created_idx    ON api_usage_log (created_at DESC);

-- ─── Pre-aggregated monthly usage counters ───────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_counters (
  teacher_id               UUID PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
  grades_this_month        INTEGER NOT NULL DEFAULT 0,
  presentations_this_month INTEGER NOT NULL DEFAULT 0,
  month_year               TEXT    NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM'),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION increment_usage(
  p_teacher_id UUID,
  p_feature    TEXT   -- 'grade' | 'presentation'
) RETURNS VOID AS $$
DECLARE
  current_month TEXT := TO_CHAR(NOW(), 'YYYY-MM');
BEGIN
  INSERT INTO usage_counters (teacher_id, month_year,
    grades_this_month, presentations_this_month)
  VALUES (p_teacher_id, current_month,
    CASE WHEN p_feature = 'grade' THEN 1 ELSE 0 END,
    CASE WHEN p_feature = 'presentation' THEN 1 ELSE 0 END)
  ON CONFLICT (teacher_id) DO UPDATE SET
    grades_this_month = CASE
      WHEN usage_counters.month_year != current_month THEN
        CASE WHEN p_feature = 'grade' THEN 1 ELSE 0 END
      ELSE
        usage_counters.grades_this_month +
        CASE WHEN p_feature = 'grade' THEN 1 ELSE 0 END
    END,
    presentations_this_month = CASE
      WHEN usage_counters.month_year != current_month THEN
        CASE WHEN p_feature = 'presentation' THEN 1 ELSE 0 END
      ELSE
        usage_counters.presentations_this_month +
        CASE WHEN p_feature = 'presentation' THEN 1 ELSE 0 END
    END,
    month_year = current_month,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ─── Teacher invites (institution admin flow) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS teacher_invites (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  invited_by     UUID NOT NULL REFERENCES teachers(id)    ON DELETE CASCADE,
  email          TEXT NOT NULL,
  token          TEXT NOT NULL UNIQUE,
  accepted       BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Password reset tokens (Phase 11) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
