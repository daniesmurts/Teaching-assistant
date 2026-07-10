import { pool } from '../connection'

// ─── Activation funnel (derived — no event instrumentation) ──────────────────
//
// The onboarding steps (OnboardingChecklist.tsx) are themselves derived from
// data, so the funnel is too: signup → first course → first grade (the "aha"
// moment) → first presentation, each read as MIN(created_at) per teacher.
// Works retroactively over the whole historical user base.
//
// Platform admins are excluded everywhere — their accounts are operators, not
// activation cohort members.

const FIRSTS_CTE = `
  WITH firsts AS (
    SELECT t.id, t.email, t.name, t.created_at, t.last_seen_at,
           (SELECT MIN(c.created_at) FROM courses      c WHERE c.teacher_id = t.id) AS first_course_at,
           (SELECT MIN(a.created_at) FROM assignments  a WHERE a.teacher_id = t.id) AS first_grade_at,
           (SELECT MIN(p.created_at) FROM presentations p WHERE p.teacher_id = t.id) AS first_presentation_at
      FROM teachers t
     WHERE COALESCE(t.is_platform_admin, FALSE) = FALSE
  )
`

export interface FunnelSummary {
  total_teachers:         number
  created_course:         number
  reached_first_grade:    number
  created_presentation:   number
  graded_within_24h:      number
  graded_within_72h:      number
  graded_within_7d:       number
  median_hours_to_grade:  number | null
}

/** Whole-history funnel: how many reach each step, and how fast the aha moment comes. */
export async function getFunnelSummary(): Promise<FunnelSummary> {
  const { rows } = await pool.query(
    `${FIRSTS_CTE}
     SELECT COUNT(*)::int                                                        AS total_teachers,
            COUNT(first_course_at)::int                                          AS created_course,
            COUNT(first_grade_at)::int                                           AS reached_first_grade,
            COUNT(first_presentation_at)::int                                    AS created_presentation,
            COUNT(*) FILTER (WHERE first_grade_at <= created_at + INTERVAL '24 hours')::int AS graded_within_24h,
            COUNT(*) FILTER (WHERE first_grade_at <= created_at + INTERVAL '72 hours')::int AS graded_within_72h,
            COUNT(*) FILTER (WHERE first_grade_at <= created_at + INTERVAL '7 days')::int   AS graded_within_7d,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM first_grade_at - created_at) / 3600
            ) FILTER (WHERE first_grade_at IS NOT NULL))::numeric, 1)::float     AS median_hours_to_grade
       FROM firsts`
  )
  return rows[0]
}

export interface FunnelCohort {
  week:                  string   // ISO date of the cohort week's Monday
  signups:               number
  created_course:        number
  reached_first_grade:   number
  median_hours_to_grade: number | null
}

/** Weekly signup cohorts, newest first. */
export async function getFunnelByWeek(weeks: number): Promise<FunnelCohort[]> {
  const { rows } = await pool.query(
    `${FIRSTS_CTE}
     SELECT TO_CHAR(DATE_TRUNC('week', created_at), 'YYYY-MM-DD')                AS week,
            COUNT(*)::int                                                        AS signups,
            COUNT(first_course_at)::int                                          AS created_course,
            COUNT(first_grade_at)::int                                           AS reached_first_grade,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM first_grade_at - created_at) / 3600
            ) FILTER (WHERE first_grade_at IS NOT NULL))::numeric, 1)::float     AS median_hours_to_grade
       FROM firsts
      WHERE created_at >= DATE_TRUNC('week', NOW()) - make_interval(weeks => $1)
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY DATE_TRUNC('week', created_at) DESC`,
    [weeks]
  )
  return rows
}

export interface StalledTeacher {
  id:              string
  email:           string
  name:            string | null
  created_at:      string
  last_seen_at:    string | null
  first_course_at: string | null
  first_grade_at:  string | null
}

/**
 * Bounced users: registered, but no first grade and not seen for 48+ hours.
 * last_seen_at IS NULL covers accounts created before migration 073 (or who
 * never came back after registering) — they count as stalled once the account
 * is older than 48h. Newest signups first; capped — this is a triage list,
 * not an export.
 */
export async function getStalledTeachers(limit = 100): Promise<StalledTeacher[]> {
  const { rows } = await pool.query(
    `${FIRSTS_CTE}
     SELECT id, email, name,
            created_at, last_seen_at, first_course_at, first_grade_at
       FROM firsts
      WHERE first_grade_at IS NULL
        AND created_at < NOW() - INTERVAL '48 hours'
        AND COALESCE(last_seen_at, created_at) < NOW() - INTERVAL '48 hours'
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  )
  return rows
}

// ─── Nudge sweep support ──────────────────────────────────────────────────────

export interface NudgeCandidate {
  id:    string
  email: string
  name:  string | null
}

/**
 * Teachers eligible for a nudge: registered within [minAgeHours, maxAgeHours)
 * ago, never graded anything (the aha-moment gate — a teacher who graded needs
 * no activation nudge, whatever the checklist says), opted in, and not already
 * sent this nudge type. The age ceiling stops the sweep from spamming the
 * whole historical backlog of dormant accounts the day this ships.
 */
export async function findNudgeCandidates(
  nudgeType: string,
  minAgeHours: number,
  maxAgeHours: number
): Promise<NudgeCandidate[]> {
  const { rows } = await pool.query(
    `SELECT t.id, t.email, t.name
       FROM teachers t
      WHERE COALESCE(t.is_platform_admin, FALSE) = FALSE
        AND t.is_active
        AND t.nudge_emails_enabled
        AND t.created_at <  NOW() - make_interval(hours => $2)
        AND t.created_at >= NOW() - make_interval(hours => $3)
        AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.teacher_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM activation_nudges n
                         WHERE n.teacher_id = t.id AND n.nudge_type = $1)`,
    [nudgeType, minAgeHours, maxAgeHours]
  )
  return rows
}

/**
 * Claim-before-send idempotency: insert the nudge row first; if another
 * worker/run already claimed it, the ON CONFLICT makes this a no-op and we
 * skip the send. Caller deletes the claim if the actual send fails, so the
 * next sweep retries.
 */
export async function claimNudge(teacherId: string, nudgeType: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO activation_nudges (teacher_id, nudge_type)
     VALUES ($1, $2)
     ON CONFLICT (teacher_id, nudge_type) DO NOTHING`,
    [teacherId, nudgeType]
  )
  return (rowCount ?? 0) > 0
}

export async function releaseNudgeClaim(teacherId: string, nudgeType: string): Promise<void> {
  await pool.query(
    `DELETE FROM activation_nudges WHERE teacher_id = $1 AND nudge_type = $2`,
    [teacherId, nudgeType]
  )
}

export async function setNudgeEmailsEnabled(teacherId: string, enabled: boolean): Promise<void> {
  await pool.query(
    `UPDATE teachers SET nudge_emails_enabled = $2 WHERE id = $1`,
    [teacherId, enabled]
  )
}
