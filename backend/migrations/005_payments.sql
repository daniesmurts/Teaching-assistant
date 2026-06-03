-- Migration 005 — T-Bank payments

CREATE TABLE IF NOT EXISTS payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       TEXT NOT NULL UNIQUE,            -- our OrderId sent to T-Bank
  teacher_id     UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  plan           TEXT NOT NULL,                   -- 'pro_monthly' | 'pro_annual'
  amount_kopecks INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'confirmed' | 'rejected'
  payment_id     TEXT,                            -- T-Bank PaymentId
  rebill_id      TEXT,                            -- for future recurring charges
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS payments_teacher_idx ON payments (teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status_idx  ON payments (status, created_at DESC);
