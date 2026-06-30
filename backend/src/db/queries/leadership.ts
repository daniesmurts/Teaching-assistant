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
