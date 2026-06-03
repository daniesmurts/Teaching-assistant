import { pool } from '../connection'

export interface CreateUsageLogParams {
  teacherId:      string
  institutionId?: string
  feature:        'grading' | 'presentation' | 'feedback_email' | 'embedding'
  model:          string
  inputTokens:    number
  outputTokens:   number
  costUsd:        number
  durationMs:     number
  success:        boolean
  errorCode?:     string
}

/**
 * Fire-and-forget — never await this where it would block a user-facing response.
 * Logs every DeepSeek call with token counts and cost for admin reporting.
 */
export async function createUsageLog(params: CreateUsageLogParams): Promise<void> {
  await pool.query(
    `INSERT INTO api_usage_log
       (teacher_id, institution_id, feature, model,
        input_tokens, output_tokens, cost_usd, duration_ms, success, error_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
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

export async function getDailyUsage(days = 30): Promise<DailyUsageRow[]> {
  const { rows } = await pool.query<DailyUsageRow>(
    `SELECT
       DATE(created_at)                             AS date,
       SUM(input_tokens + output_tokens)::int       AS total_tokens,
       SUM(input_tokens)::int                       AS input_tokens,
       SUM(output_tokens)::int                      AS output_tokens,
       ROUND(SUM(cost_usd)::numeric, 6)             AS cost_usd,
       COUNT(*) FILTER (WHERE feature = 'grading')::int          AS grade_count,
       COUNT(*) FILTER (WHERE feature = 'presentation')::int     AS presentation_count,
       COUNT(*) FILTER (WHERE NOT success)::int                  AS error_count
     FROM api_usage_log
     WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
     GROUP BY DATE(created_at)
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

export async function getUsageByTeacher(limit = 20): Promise<UsageByTeacherRow[]> {
  const { rows } = await pool.query<UsageByTeacherRow>(
    `SELECT
       t.id                                    AS teacher_id,
       t.name                                  AS teacher_name,
       t.email,
       SUM(u.input_tokens + u.output_tokens)::int AS total_tokens,
       ROUND(SUM(u.cost_usd)::numeric, 6)      AS cost_usd,
       COUNT(*) FILTER (WHERE u.feature = 'grading')::int AS grade_count,
       MAX(u.created_at)::text                 AS last_active
     FROM api_usage_log u
     JOIN teachers t ON t.id = u.teacher_id
     GROUP BY t.id, t.name, t.email
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

export async function getTodayCost(): Promise<number> {
  const { rows } = await pool.query<{ cost: string }>(
    `SELECT ROUND(COALESCE(SUM(cost_usd), 0)::numeric, 6)::text AS cost
     FROM api_usage_log
     WHERE created_at >= CURRENT_DATE`
  )
  return parseFloat(rows[0]?.cost ?? '0')
}
