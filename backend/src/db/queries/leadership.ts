import { pool } from '../connection'

// ─── Row shapes ───────────────────────────────────────────────────────────────

export interface LeadershipUnit {
  id:                     string
  name:                   string
  short_name:             string | null
  type_code:              string
  role:                   string         // 'head' | 'admin' (the one the caller holds on THIS unit)
  subtree_teacher_count:  number
}

export interface LeadershipTeacherRow {
  id:                  string
  name:                string | null
  email:               string
  primary_unit_name:   string | null
  grades_30d:          number
  last_active_at:      Date | null
}

export interface LeadershipActivity {
  unit_id:                 string
  unit_name:               string
  unit_short_name:         string | null
  unit_type_code:          string
  unit_path:               string
  teacher_count:           number
  total_grades_30d:        number
  grades_by_day:           { date: string; count: number }[]   // zero-filled, 30 entries
}

// ─── Discoverability — which units can this teacher pick? ─────────────────────

/**
 * Units the teacher directly holds head/admin on. Picker order is by type
 * (broader first) then name. Subtree headcount uses the materialised path —
 * the same prefix join the structure page uses, so a head on a division sees
 * the total teachers across all departments under it.
 *
 * Platform admin is handled by the caller (it short-circuits and returns all
 * institution roots) — this query answers the tree-membership question only.
 */
export async function listDirectLeadershipUnits(teacherId: string): Promise<LeadershipUnit[]> {
  const { rows } = await pool.query<LeadershipUnit>(
    `SELECT u.id, u.name, u.short_name, u.type_code, our.role,
            (SELECT COUNT(*)::int
               FROM teachers t
               JOIN org_units pu ON pu.id = t.primary_org_unit_id
              WHERE pu.path LIKE u.path || '%') AS subtree_teacher_count
       FROM org_unit_roles our
       JOIN org_units u ON u.id = our.org_unit_id
      WHERE our.teacher_id = $1
        AND our.role IN ('head', 'admin')
      ORDER BY u.type_code, u.name`,
    [teacherId]
  )
  return rows
}

/** All institution roots — for the platform owner to drill from. */
export async function listAllInstitutionRoots(): Promise<LeadershipUnit[]> {
  const { rows } = await pool.query<LeadershipUnit>(
    `SELECT u.id, u.name, u.short_name, u.type_code, 'admin' AS role,
            (SELECT COUNT(*)::int
               FROM teachers t
               JOIN org_units pu ON pu.id = t.primary_org_unit_id
              WHERE pu.path LIKE u.path || '%') AS subtree_teacher_count
       FROM org_units u
      WHERE u.type_code = 'institution' AND u.parent_id IS NULL
      ORDER BY u.name`
  )
  return rows
}

// ─── Overview — teacher list + 30-day activity for a chosen subtree ───────────

/**
 * Teacher list for the subtree at `unitPath`. `grades_30d` and `last_active_at`
 * derived from the `assignments` table — any grading attempt counts, regardless
 * of approval status. Ordered most-active first so the head sees who's pulling
 * weight at a glance.
 */
export async function listSubtreeTeachers(unitPath: string): Promise<LeadershipTeacherRow[]> {
  const { rows } = await pool.query<LeadershipTeacherRow>(
    `SELECT t.id, t.name, t.email, pu.name AS primary_unit_name,
            COALESCE((
              SELECT COUNT(*)::int FROM assignments a
               WHERE a.teacher_id = t.id AND a.created_at >= NOW() - INTERVAL '30 days'
            ), 0) AS grades_30d,
            (SELECT MAX(a.created_at) FROM assignments a WHERE a.teacher_id = t.id) AS last_active_at
       FROM teachers t
       JOIN org_units pu ON pu.id = t.primary_org_unit_id
      WHERE pu.path LIKE $1 || '%'
      ORDER BY grades_30d DESC, t.name NULLS LAST`,
    [unitPath]
  )
  return rows
}

/**
 * 30-day grade activity for the subtree, zero-filled. Single round trip via
 * a generate_series LEFT JOIN — UI plots a clean line without client-side
 * date gap-fill.
 */
export async function getSubtreeActivity(unitId: string): Promise<LeadershipActivity> {
  const unitQ = await pool.query<{ id: string; name: string; short_name: string | null; type_code: string; path: string }>(
    'SELECT id, name, short_name, type_code, path FROM org_units WHERE id = $1',
    [unitId]
  )
  const unit = unitQ.rows[0]
  if (!unit) throw new Error('Unit not found')

  const seriesQ = await pool.query<{ date: string; count: string }>(
    `WITH days AS (
       SELECT generate_series(
         (CURRENT_DATE - INTERVAL '29 days')::date,
         CURRENT_DATE::date,
         INTERVAL '1 day'
       )::date AS d
     )
     SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
            COALESCE(COUNT(a.id), 0)::text AS count
       FROM days
       LEFT JOIN assignments a
         ON a.created_at::date = days.d
        AND a.teacher_id IN (
          SELECT t.id FROM teachers t
           JOIN org_units pu ON pu.id = t.primary_org_unit_id
          WHERE pu.path LIKE $1 || '%'
        )
      GROUP BY days.d
      ORDER BY days.d`,
    [unit.path]
  )

  const countsQ = await pool.query<{ teacher_count: string; total_grades_30d: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM teachers t
          JOIN org_units pu ON pu.id = t.primary_org_unit_id
         WHERE pu.path LIKE $1 || '%') AS teacher_count,
       (SELECT COUNT(*)::text FROM assignments a
          JOIN teachers t ON t.id = a.teacher_id
          JOIN org_units pu ON pu.id = t.primary_org_unit_id
         WHERE pu.path LIKE $1 || '%'
           AND a.created_at >= NOW() - INTERVAL '30 days') AS total_grades_30d`,
    [unit.path]
  )

  return {
    unit_id:          unit.id,
    unit_name:        unit.name,
    unit_short_name:  unit.short_name,
    unit_type_code:   unit.type_code,
    unit_path:        unit.path,
    teacher_count:    parseInt(countsQ.rows[0].teacher_count, 10),
    total_grades_30d: parseInt(countsQ.rows[0].total_grades_30d, 10),
    grades_by_day:    seriesQ.rows.map((r) => ({ date: r.date, count: parseInt(r.count, 10) })),
  }
}

// ─── Programme-state for a leadership subtree ────────────────────────────────

export interface LeadershipProgramUnitState {
  unit_id:              string
  unit_name:            string
  unit_short_name:      string | null
  program_id:           string | null
  program_name:         string | null
  program_code:         string | null
  program_level:        string | null
  has_description_doc:  boolean
  has_plan_doc:         boolean
  discipline_count:     number
  competency_count:     number
  last_analysis_at:     string | null
}

/**
 * Every `program` org_unit in the subtree rooted at `unitPath`, with a LEFT
 * JOIN onto its linked programme (if any) so unlinked units still surface
 * with clear "not imported yet" state. Used by the leadership dashboard for
 * polygroup / institute / РОП heads whose real question is "which programmes
 * am I responsible for and what state are they in?" — the grading-oriented
 * teacher list doesn't answer that.
 */
export async function listProgramUnitStateForSubtree(unitPath: string): Promise<LeadershipProgramUnitState[]> {
  const { rows } = await pool.query<LeadershipProgramUnitState>(
    `SELECT u.id AS unit_id, u.name AS unit_name, u.short_name AS unit_short_name,
            p.id AS program_id, p.name AS program_name, p.code AS program_code,
            p.level AS program_level,
            (p.description_text IS NOT NULL AND length(trim(p.description_text)) > 0) AS has_description_doc,
            (p.plan_text        IS NOT NULL AND length(trim(p.plan_text)) > 0)        AS has_plan_doc,
            COALESCE((SELECT COUNT(*)::int FROM program_disciplines  WHERE program_id = p.id), 0) AS discipline_count,
            COALESCE((SELECT COUNT(*)::int FROM program_competencies WHERE program_id = p.id), 0) AS competency_count,
            (SELECT MAX(created_at) FROM program_analyses WHERE program_id = p.id)   AS last_analysis_at
       FROM org_units u
       LEFT JOIN programs p ON p.org_unit_id = u.id
      WHERE u.type_code IN ('program', 'program_direction')
        AND u.path LIKE $1 || '%'
      ORDER BY u.name`,
    [unitPath]
  )
  return rows
}

// ─── Per-teacher drill (Leadership V2) ────────────────────────────────────────

export interface LeadershipTeacherProfile {
  id:                    string
  email:                 string
  name:                  string | null
  primary_org_unit_id:   string | null
  primary_unit_name:     string | null
}

export interface LeadershipTeacherActivity {
  total_grades_30d:      number
  approved_grades_30d:   number
  approval_rate_30d:     number | null    // approved / total, null when total = 0
  avg_edit_distance_30d: number | null    // mean(|approved_score - ai_score|), null when no approvals
  grades_by_day:         { date: string; count: number }[]   // 30 entries, zero-filled
}

export interface LeadershipTeacherSubject {
  course_id:   string
  name:        string
  grades_30d:  number
}

export interface LeadershipTeacherRecentGrade {
  id:               string
  created_at:       Date
  status:           string
  ai_score:         number | null
  ai_grade:         string | null
  approved_score:   number | null
  approved_grade:   string | null
  course_id:        string | null
  course_name:      string | null
  student_name:     string | null
}

/** Identity + primary kafedra for a teacher — foundation for the drill page. */
export async function getTeacherLeadershipProfile(teacherId: string): Promise<LeadershipTeacherProfile | null> {
  const { rows } = await pool.query<LeadershipTeacherProfile>(
    `SELECT t.id, t.email, t.name, t.primary_org_unit_id,
            pu.name AS primary_unit_name
       FROM teachers t
       LEFT JOIN org_units pu ON pu.id = t.primary_org_unit_id
      WHERE t.id = $1
      LIMIT 1`,
    [teacherId]
  )
  return rows[0] ?? null
}

/** 30-day activity metrics for a single teacher — grades count, approval rate,
 *  average edit distance (how far the teacher's approved score sits from the
 *  AI's draft — a signal of RAG-flywheel quality), and a zero-filled daily
 *  series for the sparkline. Single round trip via three sub-queries and a
 *  generate_series LEFT JOIN. */
export async function getTeacherLeadershipActivity(teacherId: string): Promise<LeadershipTeacherActivity> {
  const [countsQ, seriesQ] = await Promise.all([
    pool.query<{
      total:                string
      approved:             string
      avg_edit_distance:    string | null
    }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE approved_at IS NOT NULL)::text AS approved,
         AVG(ABS(approved_score - ai_score))
           FILTER (WHERE approved_at IS NOT NULL AND approved_score IS NOT NULL AND ai_score IS NOT NULL)::text
             AS avg_edit_distance
        FROM assignments
       WHERE teacher_id = $1
         AND created_at >= NOW() - INTERVAL '30 days'`,
      [teacherId]
    ),
    pool.query<{ date: string; count: string }>(
      `WITH days AS (
         SELECT generate_series(
           (CURRENT_DATE - INTERVAL '29 days')::date,
           CURRENT_DATE::date,
           INTERVAL '1 day'
         )::date AS d
       )
       SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
              COALESCE(COUNT(a.id), 0)::text AS count
         FROM days
         LEFT JOIN assignments a
           ON a.created_at::date = days.d
          AND a.teacher_id = $1
        GROUP BY days.d
        ORDER BY days.d`,
      [teacherId]
    ),
  ])

  const total    = parseInt(countsQ.rows[0].total, 10)
  const approved = parseInt(countsQ.rows[0].approved, 10)
  const editRaw  = countsQ.rows[0].avg_edit_distance

  return {
    total_grades_30d:      total,
    approved_grades_30d:   approved,
    approval_rate_30d:     total > 0 ? approved / total : null,
    avg_edit_distance_30d: editRaw == null ? null : Number(parseFloat(editRaw).toFixed(2)),
    grades_by_day:         seriesQ.rows.map((r) => ({ date: r.date, count: parseInt(r.count, 10) })),
  }
}

/** Subjects the teacher has graded on in the last 30 days, most-active first. */
export async function listTeacherActiveSubjects(teacherId: string): Promise<LeadershipTeacherSubject[]> {
  const { rows } = await pool.query<LeadershipTeacherSubject>(
    `SELECT c.id AS course_id, c.name, COUNT(a.id)::int AS grades_30d
       FROM assignments a
       JOIN courses c ON c.id = a.course_id
      WHERE a.teacher_id = $1
        AND a.created_at >= NOW() - INTERVAL '30 days'
        AND a.course_id IS NOT NULL
      GROUP BY c.id, c.name
      ORDER BY grades_30d DESC, c.name`,
    [teacherId]
  )
  return rows
}

/** Recent assignments for the drill page. Not paginated — cap at 20. */
export async function listTeacherRecentGrades(teacherId: string, limit = 20): Promise<LeadershipTeacherRecentGrade[]> {
  const { rows } = await pool.query<LeadershipTeacherRecentGrade>(
    `SELECT a.id, a.created_at, a.status, a.ai_score, a.ai_grade,
            a.approved_score, a.approved_grade,
            a.course_id, c.name AS course_name,
            a.student_name
       FROM assignments a
       LEFT JOIN courses c ON c.id = a.course_id
      WHERE a.teacher_id = $1
      ORDER BY a.created_at DESC
      LIMIT $2`,
    [teacherId, limit]
  )
  return rows
}

// ─── is_leader signal for the auth payload ────────────────────────────────────

/** Cheap existence check — does this teacher hold any head/admin role anywhere?
 *  Platform admin is checked separately on the auth payload (orthogonal flag). */
export async function hasLeadershipRole(teacherId: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM org_unit_roles
        WHERE teacher_id = $1 AND role IN ('head', 'admin')
     ) AS ok`,
    [teacherId]
  )
  return rows[0]?.ok ?? false
}
