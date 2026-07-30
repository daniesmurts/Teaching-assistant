import { pool } from '../connection'

// TODO.md Feature AL Phase 1 — the two rollup tables (migrations 106/107)
// and the raw queries that feed them. Orchestration (effective-tier
// computation, amortization, FX freezing) lives in services/usageRollup.ts;
// this file is pure data access.

export interface TeacherMonthAggregate {
  teacher_id:             string
  institution_id:         string | null
  plan_tier:               string
  plan_expires_at:         string | null
  institution_plan_tier:   string | null
  call_count:              number
  total_tokens:            number
  cost_usd:                number
}

/**
 * Per-teacher usage aggregated for one calendar month, excluding overhead
 * features (see services/usageRollup.ts's OVERHEAD_FEATURES) and platform
 * admins (their own testing/exploration usage would otherwise pollute every
 * coefficient — TODO.md's "exclude platform-admin/test accounts" decision).
 * No `success` filter — a TRUNCATED failure still carries a real cost and
 * must count; every other failure mode already costs 0.
 */
export async function aggregateTeacherUsageForMonth(
  month: string, overheadFeatures: string[],
): Promise<TeacherMonthAggregate[]> {
  const { rows } = await pool.query<TeacherMonthAggregate>(
    `SELECT
       t.id                                             AS teacher_id,
       t.institution_id,
       t.plan_tier,
       t.plan_expires_at::text                           AS plan_expires_at,
       i.plan_tier                                       AS institution_plan_tier,
       COUNT(u.id)::int                                  AS call_count,
       COALESCE(SUM(u.input_tokens + u.output_tokens), 0)::int    AS total_tokens,
       COALESCE(SUM(u.cost_usd), 0)::numeric             AS cost_usd
     FROM api_usage_log u
     JOIN teachers t ON t.id = u.teacher_id
     LEFT JOIN institutions i ON i.id = t.institution_id
     WHERE to_char(u.created_at, 'YYYY-MM') = $1
       AND NOT (u.feature = ANY($2::text[]))
       AND t.is_platform_admin = FALSE
     GROUP BY t.id, t.institution_id, t.plan_tier, t.plan_expires_at, i.plan_tier`,
    [month, overheadFeatures]
  )
  return rows
}

export interface OverheadMonthAggregate {
  institution_id: string
  call_count:     number
  total_tokens:   number
  cost_usd:       number
}

/**
 * Overhead-classified usage (feature IN overheadFeatures), aggregated per
 * institution — a row carries a teacher_id but the benefit isn't that
 * teacher's (e.g. rpd_reminder, triggered by whoever runs Мониторинг РПД).
 * A row whose teacher has no institution has nowhere to attribute overhead
 * to and is dropped — an edge case that shouldn't occur in practice since
 * every overhead feature today is institution-scoped work.
 */
export async function aggregateOverheadUsageForMonth(
  month: string, overheadFeatures: string[],
): Promise<OverheadMonthAggregate[]> {
  const { rows } = await pool.query<OverheadMonthAggregate>(
    `SELECT
       t.institution_id                                  AS institution_id,
       COUNT(u.id)::int                                  AS call_count,
       COALESCE(SUM(u.input_tokens + u.output_tokens), 0)::int    AS total_tokens,
       COALESCE(SUM(u.cost_usd), 0)::numeric             AS cost_usd
     FROM api_usage_log u
     JOIN teachers t ON t.id = u.teacher_id
     WHERE to_char(u.created_at, 'YYYY-MM') = $1
       AND u.feature = ANY($2::text[])
       AND t.institution_id IS NOT NULL
       AND t.is_platform_admin = FALSE
     GROUP BY t.institution_id`,
    [month, overheadFeatures]
  )
  return rows
}

export interface PaymentForAmortization {
  teacher_id:   string
  plan:         string
  amount_kopecks: number
  confirmed_at: string
}

/**
 * Every confirmed payment that could possibly contribute amortized revenue
 * to `month` — a 13-month-wide net (12 months back covers the longest
 * possible pro_annual amortization window, +1 for the target month itself).
 * The actual per-month apportionment is pure JS (amortizedRevenueForMonthRub
 * in services/usageRollup.ts) rather than SQL date arithmetic, so it's unit
 * testable without a database.
 */
export async function fetchPaymentsForAmortization(month: string): Promise<PaymentForAmortization[]> {
  const { rows } = await pool.query<PaymentForAmortization>(
    `SELECT teacher_id, plan, amount_kopecks, confirmed_at::text AS confirmed_at
     FROM payments
     WHERE status = 'confirmed' AND confirmed_at IS NOT NULL
       AND confirmed_at >= to_date($1 || '-01', 'YYYY-MM-DD') - INTERVAL '12 months'
       AND confirmed_at <  to_date($1 || '-01', 'YYYY-MM-DD') + INTERVAL '1 month'`,
    [month]
  )
  return rows
}

export interface UpsertUsageRollupRowParams {
  month:                 string
  teacherId:             string
  institutionId:         string | null
  effectiveTier:         string
  callCount:             number
  totalTokens:           number
  costUsd:               number
  amortizedRevenueRub?:  number | null
  amortizedRevenueUsd?:  number | null
  fxRateUsed?:           number | null
  fxRateDate?:           string | null
}

export async function upsertUsageRollupRow(p: UpsertUsageRollupRowParams): Promise<void> {
  await pool.query(
    `INSERT INTO usage_rollup_monthly
       (month, teacher_id, institution_id, effective_tier, call_count, total_tokens, cost_usd,
        amortized_revenue_rub, amortized_revenue_usd, fx_rate_used, fx_rate_date, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
     ON CONFLICT (month, teacher_id) DO UPDATE SET
       institution_id         = EXCLUDED.institution_id,
       effective_tier         = EXCLUDED.effective_tier,
       call_count             = EXCLUDED.call_count,
       total_tokens           = EXCLUDED.total_tokens,
       cost_usd               = EXCLUDED.cost_usd,
       amortized_revenue_rub  = EXCLUDED.amortized_revenue_rub,
       amortized_revenue_usd  = EXCLUDED.amortized_revenue_usd,
       fx_rate_used           = EXCLUDED.fx_rate_used,
       fx_rate_date           = EXCLUDED.fx_rate_date,
       computed_at            = NOW()`,
    [
      p.month, p.teacherId, p.institutionId, p.effectiveTier, p.callCount, p.totalTokens, p.costUsd,
      p.amortizedRevenueRub ?? null, p.amortizedRevenueUsd ?? null, p.fxRateUsed ?? null, p.fxRateDate ?? null,
    ]
  )
}

export interface UpsertInstitutionRollupRowParams {
  month:                 string
  institutionId:         string
  activeSeats:           number
  seatsPurchased:        number | null
  overheadCallCount:     number
  overheadTokens:        number
  overheadCostUsd:       number
  amortizedRevenueRub?:  number | null
  amortizedRevenueUsd?:  number | null
  fxRateUsed?:           number | null
  fxRateDate?:           string | null
}

export async function upsertInstitutionRollupRow(p: UpsertInstitutionRollupRowParams): Promise<void> {
  await pool.query(
    `INSERT INTO institution_rollup_monthly
       (month, institution_id, active_seats, seats_purchased,
        overhead_call_count, overhead_tokens, overhead_cost_usd,
        amortized_revenue_rub, amortized_revenue_usd, fx_rate_used, fx_rate_date, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
     ON CONFLICT (month, institution_id) DO UPDATE SET
       active_seats           = EXCLUDED.active_seats,
       seats_purchased        = EXCLUDED.seats_purchased,
       overhead_call_count    = EXCLUDED.overhead_call_count,
       overhead_tokens        = EXCLUDED.overhead_tokens,
       overhead_cost_usd      = EXCLUDED.overhead_cost_usd,
       amortized_revenue_rub  = EXCLUDED.amortized_revenue_rub,
       amortized_revenue_usd  = EXCLUDED.amortized_revenue_usd,
       fx_rate_used           = EXCLUDED.fx_rate_used,
       fx_rate_date           = EXCLUDED.fx_rate_date,
       computed_at            = NOW()`,
    [
      p.month, p.institutionId, p.activeSeats, p.seatsPurchased,
      p.overheadCallCount, p.overheadTokens, p.overheadCostUsd,
      p.amortizedRevenueRub ?? null, p.amortizedRevenueUsd ?? null, p.fxRateUsed ?? null, p.fxRateDate ?? null,
    ]
  )
}

// ─── Read side — for the eventual AdminCapacity page (Phase 2) and the
// unitEconomics.ts CLI report (Phase 1). ───────────────────────────────────

export interface UsageRollupRow {
  month:                  string
  teacher_id:             string
  institution_id:         string | null
  effective_tier:         string
  call_count:             number
  total_tokens:           number
  cost_usd:               number
  amortized_revenue_rub:  number | null
  amortized_revenue_usd:  number | null
}

export async function getUsageRollupForMonth(month: string): Promise<UsageRollupRow[]> {
  const { rows } = await pool.query<UsageRollupRow>(
    `SELECT month, teacher_id, institution_id, effective_tier, call_count, total_tokens::int AS total_tokens,
            cost_usd, amortized_revenue_rub, amortized_revenue_usd
       FROM usage_rollup_monthly
      WHERE month = $1`,
    [month]
  )
  return rows
}

export interface InstitutionRollupRow {
  month:                  string
  institution_id:         string
  active_seats:           number
  seats_purchased:        number | null
  overhead_call_count:    number
  overhead_tokens:        number
  overhead_cost_usd:      number
  amortized_revenue_rub:  number | null
  amortized_revenue_usd:  number | null
}

export async function getInstitutionRollupForMonth(month: string): Promise<InstitutionRollupRow[]> {
  const { rows } = await pool.query<InstitutionRollupRow>(
    `SELECT month, institution_id, active_seats, seats_purchased,
            overhead_call_count, overhead_tokens::int AS overhead_tokens, overhead_cost_usd,
            amortized_revenue_rub, amortized_revenue_usd
       FROM institution_rollup_monthly
      WHERE month = $1`,
    [month]
  )
  return rows
}

/** Distinct months that have at least one computed rollup row — powers the "tracking since <month>" label (≥3 points before trend charts render, per TODO.md). */
export async function listRolledUpMonths(): Promise<string[]> {
  const { rows } = await pool.query<{ month: string }>(
    `SELECT DISTINCT month FROM usage_rollup_monthly ORDER BY month ASC`
  )
  return rows.map((r) => r.month)
}
