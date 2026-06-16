import { pool } from '../db/connection'
import { getKafedraContribution30d } from '../db/queries/ragRetrievals'

/**
 * Numbers behind the "ИИ учится у вас" view. Everything here is a single
 * read-only query against `assignments` / `rag_retrievals`, so the endpoint
 * can return all of it in one round-trip.
 *
 * Hero metric — «Похожесть на ваш стиль»:
 *   100 − mean(|ai_score − approved_score|) over the last 30 days of approved
 *   grades. Higher = AI's draft scores match what the teacher actually approved.
 *   The same number for the previous 30-day window gives the trend arrow.
 *
 * Supporting metrics:
 *   - approved_total / approved_this_month (volume)
 *   - times_used_as_example_30d (RAG flywheel inflow — proves the teacher's
 *     past judgment is being reused)
 *   - bullets_retention_30d (% of AI's strengths+improvements bullets the
 *     teacher kept verbatim — voice convergence)
 *
 * Chart: 6-month weekly mean |ai_score − approved_score| series.
 */

export interface LearningLoopSummary {
  style_match: {
    current_pct:  number | null   // 0–100, null when not enough data
    previous_pct: number | null
    delta:        number | null   // current - previous, signed
    sample_n_30d: number
  }
  approved: {
    lifetime:   number
    this_month: number
    delta_vs_last_month: number
  }
  used_as_example_30d: number
  bullets_retention_30d: {
    pct:        number | null     // 0–100
    sample_n:   number
  }
  kafedra_contribution_30d: number   // 0 when teacher has no institution
  trend_weekly: Array<{ week: string; mean_delta: number; n: number }>
}

export async function getLearningLoopSummary(teacherId: string): Promise<LearningLoopSummary> {
  const [style, volume, retention, exampleUses, kafedraContribution, trend] = await Promise.all([
    queryStyleMatch(teacherId),
    queryVolume(teacherId),
    queryBulletsRetention(teacherId),
    queryUsedAsExample(teacherId),
    getKafedraContribution30d(teacherId),
    queryWeeklyTrend(teacherId),
  ])

  return {
    style_match:               style,
    approved:                  volume,
    used_as_example_30d:       exampleUses,
    bullets_retention_30d:     retention,
    kafedra_contribution_30d:  kafedraContribution,
    trend_weekly:              trend,
  }
}

// ─── Hero metric: style match (current vs previous 30 days) ──────────────────

async function queryStyleMatch(teacherId: string): Promise<LearningLoopSummary['style_match']> {
  const { rows } = await pool.query<{
    mean_delta_current: string | null
    n_current:          string
    mean_delta_prev:    string | null
    n_prev:             string
  }>(
    `SELECT
       AVG(CASE WHEN approved_at >= NOW() - INTERVAL '30 days'  THEN ABS(ai_score - approved_score)::float END) AS mean_delta_current,
       COUNT(*) FILTER (WHERE approved_at >= NOW() - INTERVAL '30 days')                                       AS n_current,
       AVG(CASE WHEN approved_at <  NOW() - INTERVAL '30 days'
                 AND approved_at >= NOW() - INTERVAL '60 days'  THEN ABS(ai_score - approved_score)::float END) AS mean_delta_prev,
       COUNT(*) FILTER (WHERE approved_at <  NOW() - INTERVAL '30 days'
                          AND approved_at >= NOW() - INTERVAL '60 days')                                       AS n_prev
     FROM assignments
     WHERE teacher_id = $1
       AND status = 'approved'
       AND ai_score IS NOT NULL
       AND approved_score IS NOT NULL`,
    [teacherId]
  )
  const r = rows[0]
  const current  = pctFromDelta(r.mean_delta_current)
  const previous = pctFromDelta(r.mean_delta_prev)
  return {
    current_pct:  current,
    previous_pct: previous,
    delta:        current != null && previous != null ? round1(current - previous) : null,
    sample_n_30d: Number(r.n_current),
  }
}

function pctFromDelta(meanDelta: string | null): number | null {
  if (meanDelta == null) return null
  const md = Number(meanDelta)
  if (!Number.isFinite(md)) return null
  // Score range is 0–100, so |delta| is also bounded by 100. Style match =
  // 100 − meanDelta, clamped (defensive against malformed rows).
  return round1(Math.max(0, Math.min(100, 100 - md)))
}

// ─── Volume ──────────────────────────────────────────────────────────────────

async function queryVolume(teacherId: string): Promise<LearningLoopSummary['approved']> {
  const { rows } = await pool.query<{
    lifetime: string; this_month: string; last_month: string
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'approved')                                                AS lifetime,
       COUNT(*) FILTER (WHERE status = 'approved' AND approved_at >= date_trunc('month', NOW())) AS this_month,
       COUNT(*) FILTER (WHERE status = 'approved'
                          AND approved_at >= date_trunc('month', NOW() - INTERVAL '1 month')
                          AND approved_at <  date_trunc('month', NOW()))                          AS last_month
     FROM assignments
     WHERE teacher_id = $1`,
    [teacherId]
  )
  const r = rows[0]
  const thisMonth = Number(r.this_month)
  const lastMonth = Number(r.last_month)
  return {
    lifetime:            Number(r.lifetime),
    this_month:          thisMonth,
    delta_vs_last_month: thisMonth - lastMonth,
  }
}

// ─── Used as RAG example (last 30 days) ──────────────────────────────────────

async function queryUsedAsExample(teacherId: string): Promise<number> {
  const { rows } = await pool.query<{ n_uses: string }>(
    `SELECT COUNT(DISTINCT rr.grading_assignment_id) AS n_uses
       FROM rag_retrievals rr
       JOIN assignments retrieved ON retrieved.id = rr.retrieved_assignment_id
      WHERE retrieved.teacher_id = $1
        AND rr.retrieved_at >= NOW() - INTERVAL '30 days'`,
    [teacherId]
  )
  return Number(rows[0].n_uses)
}

// ─── Bullets retention (last 30 days) ────────────────────────────────────────
//
// Fraction of AI-generated strengths + improvements bullets the teacher kept
// verbatim. Compared by text equality across the JSONB arrays. Only rows where
// the teacher edited at least one list contribute (approved_strengths/
// approved_improvements is NULL when the teacher kept the AI defaults — that
// counts as 100% retention).

async function queryBulletsRetention(teacherId: string): Promise<LearningLoopSummary['bullets_retention_30d']> {
  const { rows } = await pool.query<{
    pct: string | null
    n:   string
  }>(
    `WITH src AS (
       SELECT
         ai_strengths, ai_improvements,
         approved_strengths, approved_improvements
       FROM assignments
       WHERE teacher_id = $1
         AND status = 'approved'
         AND approved_at >= NOW() - INTERVAL '30 days'
     ),
     scored AS (
       SELECT
         -- total AI bullets across both lists
         COALESCE(jsonb_array_length(ai_strengths), 0)
           + COALESCE(jsonb_array_length(ai_improvements), 0)             AS total_ai,
         -- kept = AI bullet text matches a teacher-approved bullet text
         (
           SELECT COUNT(*) FROM jsonb_array_elements(COALESCE(ai_strengths, '[]'::jsonb)) AS ai_b
            WHERE EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(approved_strengths, ai_strengths, '[]'::jsonb)) AS tch
               WHERE tch->>'text' = ai_b->>'text'
            )
         )
         +
         (
           SELECT COUNT(*) FROM jsonb_array_elements(COALESCE(ai_improvements, '[]'::jsonb)) AS ai_b
            WHERE EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(approved_improvements, ai_improvements, '[]'::jsonb)) AS tch
               WHERE tch->>'text' = ai_b->>'text'
            )
         )                                                                AS total_kept
       FROM src
     )
     SELECT
       AVG(CASE WHEN total_ai > 0 THEN (total_kept::float / total_ai) * 100 END) AS pct,
       COUNT(*) FILTER (WHERE total_ai > 0)                                      AS n
     FROM scored`,
    [teacherId]
  )
  const r = rows[0]
  return {
    pct:      r.pct == null ? null : round1(Number(r.pct)),
    sample_n: Number(r.n),
  }
}

// ─── Weekly trend for the chart ──────────────────────────────────────────────

async function queryWeeklyTrend(teacherId: string): Promise<LearningLoopSummary['trend_weekly']> {
  const { rows } = await pool.query<{ week: Date; mean_delta: string; n: string }>(
    `SELECT
       date_trunc('week', approved_at)::date AS week,
       AVG(ABS(ai_score - approved_score)::float) AS mean_delta,
       COUNT(*) AS n
     FROM assignments
     WHERE teacher_id = $1
       AND status = 'approved'
       AND ai_score IS NOT NULL
       AND approved_score IS NOT NULL
       AND approved_at >= NOW() - INTERVAL '6 months'
     GROUP BY 1
     ORDER BY 1`,
    [teacherId]
  )
  return rows.map((r) => ({
    week:       r.week.toISOString().slice(0, 10),
    mean_delta: round1(Number(r.mean_delta)),
    n:          Number(r.n),
  }))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
