import { pool } from '../connection'

export interface CreateUsageLogParams {
  teacherId:      string
  institutionId?: string
  feature:        'grading' | 'presentation' | 'feedback_email' | 'embedding' | 'criteria_assist' | 'rpd_reminder' | 'document_extraction'
  model:          string
  inputTokens:    number
  outputTokens:   number
  costUsd:        number
  durationMs:     number
  success:        boolean
  errorCode?:     string
  // Native-currency cost (TODO.md Improvement #13) — cost_usd above stays
  // the canonical figure every existing query reads; these three are purely
  // additive. Omit for a provider that bills in USD (DeepSeek/Qwen): the
  // caller passes costNative equal to costUsd with currency:'USD' so every
  // row ends up with a currency, or omits all three and the row's currency
  // is NULL (legacy rows predating this migration behave the same way).
  costNative?:    number
  currency?:      'USD' | 'RUB'
  fxRateUsed?:    number   // ₽ per $1 at the moment of conversion; only meaningful for RUB rows
  // TODO.md Feature AL Phase 0 — two more dimensions for per-teacher/
  // per-institution coefficients and provider-account health.
  variant?:       string   // e.g. presentation depth 'standard' | 'deep' — NOT a new `feature` value, see migration 104
  account?:       string   // which DeepSeek account served the call ('primary', 'key-2', ...); undefined for single-account providers
}

/**
 * Fire-and-forget — never await this where it would block a user-facing response.
 * Logs every DeepSeek call with token counts and cost for admin reporting.
 */
export async function createUsageLog(params: CreateUsageLogParams): Promise<void> {
  await pool.query(
    `INSERT INTO api_usage_log
       (teacher_id, institution_id, feature, model,
        input_tokens, output_tokens, cost_usd, duration_ms, success, error_code,
        cost_native, currency, fx_rate_used, variant, account)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      params.teacherId,
      params.institutionId ?? null,
      params.feature,
      params.model,
      params.inputTokens,
      params.outputTokens,
      params.costUsd,
      params.durationMs,
      params.success,
      params.errorCode ?? null,
      params.costNative ?? null,
      params.currency ?? null,
      params.fxRateUsed ?? null,
      params.variant ?? null,
      params.account ?? null,
    ]
  )
}

// ─── Admin queries ────────────────────────────────────────────────────────────

export interface DailyUsageRow {
  date:              string
  total_tokens:      number
  input_tokens:      number
  output_tokens:     number
  cost_usd:          number
  grade_count:       number
  presentation_count: number
  error_count:       number
}

// grade_count comes from `assignments`, not a `feature = 'grading'` count over
// api_usage_log. 'grading' is a shared LLM-cost bucket reused by ~15 unrelated
// services (documentReview, mtoReview, placementReview, programDiff,
// programAnalysis, docChat, cohortSynthesis, evalHarness, longReview, ...),
// and even a single real grading action can log several rows under it (the
// feedback critic pass, calc verification, citation check, and — in
// "тщательная проверка" mode — every confidence-ensemble sample plus a
// reconciliation call all inherit the same context). Counting those rows as
// "Проверок" overstated real grading activity by anywhere from 2x to 10x+.
// `assignments` has exactly one row per submission actually graded
// (services/grading.ts's grade() persists it once, regardless of how many
// LLM calls that took), including completed long reviews — longReview.ts
// calls createAssignment() on completion, so no separate long_reviews count
// is needed here.
export async function getDailyUsage(days = 30): Promise<DailyUsageRow[]> {
  const { rows } = await pool.query<DailyUsageRow>(
    `WITH usage AS (
       SELECT
         DATE(created_at)                                          AS date,
         SUM(input_tokens + output_tokens)::int                    AS total_tokens,
         SUM(input_tokens)::int                                    AS input_tokens,
         SUM(output_tokens)::int                                   AS output_tokens,
         ROUND(SUM(cost_usd)::numeric, 6)                          AS cost_usd,
         COUNT(*) FILTER (WHERE feature = 'presentation')::int     AS presentation_count,
         COUNT(*) FILTER (WHERE NOT success)::int                  AS error_count
       FROM api_usage_log
       WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY DATE(created_at)
     ),
     grades AS (
       SELECT DATE(created_at) AS date, COUNT(*)::int AS grade_count
       FROM assignments
       WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY DATE(created_at)
     )
     SELECT
       COALESCE(usage.date, grades.date)     AS date,
       COALESCE(usage.total_tokens, 0)       AS total_tokens,
       COALESCE(usage.input_tokens, 0)       AS input_tokens,
       COALESCE(usage.output_tokens, 0)      AS output_tokens,
       COALESCE(usage.cost_usd, 0)           AS cost_usd,
       COALESCE(grades.grade_count, 0)       AS grade_count,
       COALESCE(usage.presentation_count, 0) AS presentation_count,
       COALESCE(usage.error_count, 0)        AS error_count
     FROM usage
     FULL OUTER JOIN grades ON grades.date = usage.date
     ORDER BY date DESC`,
    [days]
  )
  return rows
}

export interface UsageByTeacherRow {
  teacher_id:   string
  teacher_name: string | null
  email:        string
  total_tokens: number
  cost_usd:     number
  grade_count:  number
  last_active:  string | null
}

// grade_count: see the comment on getDailyUsage above — real grading actions
// from `assignments`, not a count of LLM calls tagged 'grading'.
export async function getUsageByTeacher(limit = 20): Promise<UsageByTeacherRow[]> {
  const { rows } = await pool.query<UsageByTeacherRow>(
    `SELECT
       t.id                                    AS teacher_id,
       t.name                                  AS teacher_name,
       t.email,
       SUM(u.input_tokens + u.output_tokens)::int AS total_tokens,
       ROUND(SUM(u.cost_usd)::numeric, 6)      AS cost_usd,
       COALESCE(g.grade_count, 0)              AS grade_count,
       MAX(u.created_at)::text                 AS last_active
     FROM api_usage_log u
     JOIN teachers t ON t.id = u.teacher_id
     LEFT JOIN (
       SELECT teacher_id, COUNT(*)::int AS grade_count
       FROM assignments
       GROUP BY teacher_id
     ) g ON g.teacher_id = t.id
     GROUP BY t.id, t.name, t.email, g.grade_count
     ORDER BY cost_usd DESC
     LIMIT $1`,
    [limit]
  )
  return rows
}

export interface UsageByFeatureRow {
  feature:            string
  total_tokens:       number
  cost_usd:           number
  call_count:         number
  avg_tokens_per_call: number
}

export async function getUsageByFeature(days = 30): Promise<UsageByFeatureRow[]> {
  const { rows } = await pool.query<UsageByFeatureRow>(
    `SELECT
       feature,
       SUM(input_tokens + output_tokens)::int          AS total_tokens,
       ROUND(SUM(cost_usd)::numeric, 6)                AS cost_usd,
       COUNT(*)::int                                   AS call_count,
       ROUND(AVG(input_tokens + output_tokens))::int   AS avg_tokens_per_call
     FROM api_usage_log
     WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
     GROUP BY feature
     ORDER BY cost_usd DESC`,
    [days]
  )
  return rows
}

export interface ErrorRow {
  feature:    string
  error_code: string | null
  count:      number
  last_seen:  string
}

export async function getRecentErrors(days = 7): Promise<ErrorRow[]> {
  const { rows } = await pool.query<ErrorRow>(
    `SELECT
       feature,
       error_code,
       COUNT(*)::int          AS count,
       MAX(created_at)::text  AS last_seen
     FROM api_usage_log
     WHERE NOT success
       AND created_at >= NOW() - ($1 || ' days')::INTERVAL
     GROUP BY feature, error_code
     ORDER BY count DESC`,
    [days]
  )
  return rows
}

export interface UsageByModelRow {
  provider:            string   // 'deepseek' | 'yandex' | 'qwen' | 'gigachat'
  model:               string   // e.g. 'deepseek-v4-flash', 'qwen3.7-max'
  total_tokens:        number
  cost_usd:            number
  call_count:          number
  error_count:         number
}

// `model` is logged as "<provider>:<model-id>" by every LLMProvider since the
// Phase 4 registry refactor — split it here rather than adding a separate
// provider column, since the compound string is already the source of truth
// ai_provider elsewhere reads from. Rows logged before that refactor have no
// prefix at all ('deepseek-chat', 'deepseek-reasoner', 'text-search-doc') —
// inferred by name so they fold into the right provider bucket instead of
// each showing up as its own fake "provider".
export async function getUsageByModel(days = 30): Promise<UsageByModelRow[]> {
  const { rows } = await pool.query<UsageByModelRow>(
    `SELECT
       CASE
         WHEN model LIKE '%:%'        THEN split_part(model, ':', 1)
         WHEN model LIKE 'deepseek%'  THEN 'deepseek'
         WHEN model LIKE 'yandex%' OR model = 'text-search-doc' THEN 'yandex'
         ELSE 'unknown'
       END                                               AS provider,
       CASE WHEN model LIKE '%:%' THEN split_part(model, ':', 2) ELSE model END AS model,
       SUM(input_tokens + output_tokens)::int           AS total_tokens,
       ROUND(SUM(cost_usd)::numeric, 6)                 AS cost_usd,
       COUNT(*)::int                                    AS call_count,
       COUNT(*) FILTER (WHERE NOT success)::int         AS error_count
     FROM api_usage_log
     WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
     GROUP BY 1, 2
     ORDER BY cost_usd DESC`,
    [days]
  )
  return rows
}

export async function getTodayCost(): Promise<number> {
  const { rows } = await pool.query<{ cost: string }>(
    `SELECT ROUND(COALESCE(SUM(cost_usd), 0)::numeric, 6)::text AS cost
     FROM api_usage_log
     WHERE created_at >= CURRENT_DATE`
  )
  return parseFloat(rows[0]?.cost ?? '0')
}
