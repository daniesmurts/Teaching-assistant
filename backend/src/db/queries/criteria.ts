import { pool } from '../connection'
import type { Criterion, CriterionSubject, CriterionLevelDescriptors } from '../../../../shared/types'

interface CriterionRow {
  id: string
  teacher_id: string | null
  course_id: string | null
  name: string
  description: string | null
  level_descriptors: CriterionLevelDescriptors | null
  subject: string | null
  is_global_template: boolean
  is_institution_shared: boolean
  shared_unit_id: string | null
  created_at: Date
}

function toCriterion(row: CriterionRow): Criterion {
  return {
    id:                    row.id,
    teacher_id:            row.teacher_id,
    course_id:             row.course_id,
    name:                  row.name,
    description:           row.description,
    level_descriptors:     row.level_descriptors ?? null,
    subject:               (row.subject ?? null) as CriterionSubject | null,
    is_global_template:    row.is_global_template,
    is_institution_shared: row.is_institution_shared,
    shared_unit_id:        row.shared_unit_id,
    created_at:            row.created_at.toISOString(),
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/** Personal criteria for one teacher. Optionally narrow to a course. */
export async function findCriteriaByTeacher(
  teacherId: string,
  courseId?: string
): Promise<Criterion[]> {
  if (courseId) {
    const { rows } = await pool.query<CriterionRow>(
      `SELECT * FROM criteria
        WHERE teacher_id = $1 AND is_global_template = FALSE
          AND (course_id = $2 OR course_id IS NULL)
        ORDER BY created_at DESC`,
      [teacherId, courseId]
    )
    return rows.map(toCriterion)
  }
  const { rows } = await pool.query<CriterionRow>(
    `SELECT * FROM criteria
      WHERE teacher_id = $1 AND is_global_template = FALSE
      ORDER BY created_at DESC`,
    [teacherId]
  )
  return rows.map(toCriterion)
}

/** Global templates curated by platform admin. */
export async function findGlobalTemplates(): Promise<Criterion[]> {
  const { rows } = await pool.query<CriterionRow>(
    `SELECT * FROM criteria
      WHERE is_global_template = TRUE
      ORDER BY subject, name`
  )
  return rows.map(toCriterion)
}

/** Institution-admin oversight view: every criterion shared anywhere in the
 *  institution's org tree, regardless of which unit it's scoped to. */
export async function findCriteriaByInstitution(
  institutionId: string
): Promise<Array<Criterion & { author_name: string | null }>> {
  const { rows } = await pool.query<CriterionRow & { author_name: string | null }>(
    `SELECT c.*, t.name AS author_name
       FROM criteria c
       JOIN teachers t ON t.id = c.teacher_id
      WHERE t.institution_id = $1
        AND c.shared_unit_id IS NOT NULL
        AND c.is_global_template = FALSE
      ORDER BY c.created_at DESC`,
    [institutionId]
  )
  return rows.map((r) => ({ ...toCriterion(r), author_name: r.author_name }))
}

/**
 * Criteria shared with `teacherId` via the org tree: any criterion whose
 * shared_unit_id is an ancestor-or-self of the teacher's own primary org
 * unit. Mirrors findRubricsSharedWithTeacher.
 */
export async function findCriteriaSharedWithTeacher(
  teacherId: string
): Promise<Array<Criterion & { author_name: string | null }>> {
  const { rows } = await pool.query<CriterionRow & { author_name: string | null }>(
    `SELECT c.*, author.name AS author_name
       FROM criteria c
       JOIN teachers author ON author.id = c.teacher_id
       JOIN org_units shared ON shared.id = c.shared_unit_id
       JOIN teachers me ON me.id = $1
       JOIN org_units mine ON mine.id = me.primary_org_unit_id
      WHERE c.is_global_template = FALSE
        AND c.teacher_id <> $1
        AND mine.path LIKE shared.path || '%'
      ORDER BY c.created_at DESC`,
    [teacherId]
  )
  return rows.map((r) => ({ ...toCriterion(r), author_name: r.author_name }))
}

/** Resolve a single criterion the teacher is allowed to read (own + global +
 *  shared via the org tree with the teacher's own primary unit). */
export async function findCriterionById(
  id: string,
  teacherId: string
): Promise<Criterion | null> {
  const { rows } = await pool.query<CriterionRow>(
    `SELECT c.*
       FROM criteria c
       LEFT JOIN teachers me ON me.id = $2
       LEFT JOIN org_units mine ON mine.id = me.primary_org_unit_id
       LEFT JOIN org_units shared ON shared.id = c.shared_unit_id
      WHERE c.id = $1
        AND (
          c.teacher_id = $2
          OR c.is_global_template = TRUE
          OR (shared.path IS NOT NULL AND mine.path IS NOT NULL
              AND mine.path LIKE shared.path || '%')
        )
      LIMIT 1`,
    [id, teacherId]
  )
  return rows[0] ? toCriterion(rows[0]) : null
}

/**
 * Load multiple criteria by id, scoped to what the teacher is allowed to use
 * (their own + global templates + shared via the org tree). Used when
 * building the snapshot at grading time.
 */
export async function findCriteriaByIds(
  ids: string[],
  teacherId: string,
  _institutionId: string | null
): Promise<Criterion[]> {
  if (ids.length === 0) return []
  const { rows } = await pool.query<CriterionRow>(
    `SELECT DISTINCT c.*
       FROM criteria c
       LEFT JOIN teachers me ON me.id = $2
       LEFT JOIN org_units mine ON mine.id = me.primary_org_unit_id
       LEFT JOIN org_units shared ON shared.id = c.shared_unit_id
      WHERE c.id = ANY($1::uuid[])
        AND (
          c.teacher_id = $2
          OR c.is_global_template = TRUE
          OR (shared.path IS NOT NULL AND mine.path IS NOT NULL
              AND mine.path LIKE shared.path || '%')
        )`,
    [ids, teacherId]
  )
  return rows.map(toCriterion)
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function createCriterion(
  teacherId: string,
  data: {
    name:        string
    description?: string
    level_descriptors?: CriterionLevelDescriptors | null
    course_id?:  string
    subject?:    CriterionSubject
    is_institution_shared?: boolean
  }
): Promise<Criterion> {
  const { rows } = await pool.query<CriterionRow>(
    `INSERT INTO criteria (teacher_id, course_id, name, description, subject, is_institution_shared, level_descriptors)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      teacherId,
      data.course_id ?? null,
      data.name,
      data.description ?? null,
      data.subject ?? null,
      data.is_institution_shared ?? false,
      data.level_descriptors ? JSON.stringify(data.level_descriptors) : null,
    ]
  )
  return toCriterion(rows[0])
}

export async function updateCriterion(
  id: string,
  teacherId: string,
  data: {
    name?:        string
    description?: string | null
    level_descriptors?: CriterionLevelDescriptors | null
    course_id?:   string | null
    subject?:     CriterionSubject | null
  }
): Promise<Criterion | null> {
  const { rows } = await pool.query<CriterionRow>(
    `UPDATE criteria
        SET name        = COALESCE($3, name),
            description = CASE WHEN $4::boolean THEN $5 ELSE description END,
            course_id   = CASE WHEN $6::boolean THEN $7::uuid ELSE course_id END,
            subject     = CASE WHEN $8::boolean THEN $9 ELSE subject END,
            level_descriptors = CASE WHEN $10::boolean THEN $11::jsonb ELSE level_descriptors END
      WHERE id = $1 AND teacher_id = $2
      RETURNING *`,
    [
      id, teacherId,
      data.name ?? null,
      data.description !== undefined, data.description ?? null,
      data.course_id   !== undefined, data.course_id   ?? null,
      data.subject     !== undefined, data.subject     ?? null,
      data.level_descriptors !== undefined,
      data.level_descriptors ? JSON.stringify(data.level_descriptors) : null,
    ]
  )
  return rows[0] ? toCriterion(rows[0]) : null
}

export async function deleteCriterion(
  id: string,
  teacherId: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM criteria WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
  return (rowCount ?? 0) > 0
}

/**
 * Share a criterion with an org unit (department, faculty, or institution
 * root). Owner-only. is_institution_shared is kept as a synced legacy mirror
 * — TRUE exactly when the target unit is the institution root.
 */
export async function shareCriterion(
  id: string,
  teacherId: string,
  unitId: string
): Promise<Criterion | null> {
  const { rows } = await pool.query<CriterionRow>(
    `UPDATE criteria c
        SET shared_unit_id = u.id,
            is_institution_shared = (u.type_code = 'institution' AND u.parent_id IS NULL)
       FROM org_units u
      WHERE c.id = $1 AND c.teacher_id = $2 AND u.id = $3
      RETURNING c.*`,
    [id, teacherId, unitId]
  )
  return rows[0] ? toCriterion(rows[0]) : null
}

export async function unshareCriterion(
  id: string,
  teacherId: string
): Promise<Criterion | null> {
  const { rows } = await pool.query<CriterionRow>(
    `UPDATE criteria
        SET shared_unit_id = NULL, is_institution_shared = FALSE
      WHERE id = $1 AND teacher_id = $2
      RETURNING *`,
    [id, teacherId]
  )
  return rows[0] ? toCriterion(rows[0]) : null
}

// ─── Admin / institution ──────────────────────────────────────────────────────

export async function createGlobalTemplate(
  data: { name: string; description?: string; subject?: CriterionSubject }
): Promise<Criterion> {
  const { rows } = await pool.query<CriterionRow>(
    `INSERT INTO criteria (teacher_id, name, description, subject, is_global_template)
     VALUES (NULL, $1, $2, $3, TRUE)
     RETURNING *`,
    [data.name, data.description ?? null, data.subject ?? 'general']
  )
  return toCriterion(rows[0])
}

export async function deleteGlobalTemplate(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM criteria WHERE id = $1 AND is_global_template = TRUE`,
    [id]
  )
  return (rowCount ?? 0) > 0
}
