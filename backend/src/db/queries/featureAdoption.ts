import { pool } from '../connection'
import { ARTIFACT_UNION_SQL } from './artifactUsage'
import type { FeatureAdoptionRow, FeatureBreadthRow } from '../../../../shared/types'

// ─── Per-feature adoption & retention ────────────────────────────────────────
//
// The activation funnel (activation.ts) asks one question — did a teacher
// reach their first grade — and hardcodes three steps: предмет → проверка →
// презентация. That was the whole product once; it now ignores a dozen
// features, so nothing says whether тесты, задания or ФОС are discovered at
// all, and nothing distinguishes "tried once" from "came back".
//
// Same derived-from-data approach, same platform-admin exclusion: operator
// accounts are not cohort members, and on a platform this size a founder's
// own test decks would visibly move every number.

/**
 * Setup artefacts, excluded from the *breadth* count only.
 *
 * A course, a rubric, a criterion set or an uploaded file is an input a
 * teacher creates in order to use a feature, not a feature they adopted.
 * Counting them would put almost everyone who finished onboarding at
 * "3 features used" and hide the distribution that actually matters.
 * They still appear in the adoption table below, where "how many teachers
 * ever wrote a rubric" is a real question.
 */
const SETUP_KINDS = ['course', 'criterion', 'rubric', 'document']

const NON_ADMIN_USAGE_CTE = `
  usage AS (
    SELECT a.kind, a.teacher_id, a.created_at
      FROM (${ARTIFACT_UNION_SQL}) a
      JOIN teachers t ON t.id = a.teacher_id
     WHERE COALESCE(t.is_platform_admin, FALSE) = FALSE
  )
`

/**
 * One row per artefact kind: who ever touched it, who came back to it, and
 * how long after signup it gets discovered.
 *
 * `teachers_returned` counts distinct *calendar days*, not uses: two
 * generations in one exploratory sitting is one session, and counting them as
 * repeat use would make every feature look sticky.
 */
export async function getFeatureAdoption(activeDays = 30): Promise<FeatureAdoptionRow[]> {
  const { rows } = await pool.query<FeatureAdoptionRow>(
    `WITH ${NON_ADMIN_USAGE_CTE},
     per_teacher AS (
       SELECT u.kind,
              u.teacher_id,
              COUNT(*)                                  AS uses,
              COUNT(DISTINCT DATE(u.created_at))        AS active_days,
              MIN(u.created_at)                         AS first_at,
              MAX(u.created_at)                         AS last_at,
              MIN(t.created_at)                         AS signed_up_at
         FROM usage u
         JOIN teachers t ON t.id = u.teacher_id
        GROUP BY u.kind, u.teacher_id
     )
     SELECT kind,
            COUNT(*)::int                                                            AS teachers_ever,
            COUNT(*) FILTER (WHERE active_days >= 2)::int                            AS teachers_returned,
            COUNT(*) FILTER (WHERE last_at >= NOW() - ($1 || ' days')::INTERVAL)::int AS teachers_active,
            ROUND(AVG(uses)::numeric, 1)::float                                      AS avg_uses_per_teacher,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM first_at - signed_up_at) / 86400
            ))::numeric, 1)::float                                                   AS median_days_to_first
       FROM per_teacher
      GROUP BY kind
      ORDER BY teachers_ever DESC, kind`,
    [activeDays]
  )
  return rows
}

/**
 * How many *distinct* features each teacher uses, as a histogram — including
 * the 0 bucket, which is the whole point: teachers who registered and created
 * nothing are invisible in any query that starts from artefact tables.
 *
 * `still_active` against each bucket is the correlation worth watching: if
 * breadth predicts retention, the product decision is to route new teachers
 * to a second feature early; if it doesn't, depth in one feature is the bet.
 */
export async function getFeatureBreadth(activeDays = 14): Promise<FeatureBreadthRow[]> {
  const { rows } = await pool.query<FeatureBreadthRow>(
    `WITH ${NON_ADMIN_USAGE_CTE},
     per_teacher AS (
       SELECT t.id,
              t.last_seen_at,
              COUNT(DISTINCT u.kind) FILTER (WHERE NOT (u.kind = ANY($1::text[]))) AS features
         FROM teachers t
         LEFT JOIN usage u ON u.teacher_id = t.id
        WHERE COALESCE(t.is_platform_admin, FALSE) = FALSE
        GROUP BY t.id, t.last_seen_at
     )
     SELECT features::int                                                                  AS features_used,
            COUNT(*)::int                                                                  AS teachers,
            COUNT(*) FILTER (WHERE last_seen_at >= NOW() - ($2 || ' days')::INTERVAL)::int AS still_active
       FROM per_teacher
      GROUP BY features
      ORDER BY features`,
    [SETUP_KINDS, activeDays]
  )
  return rows
}
