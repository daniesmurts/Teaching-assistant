import type { PoolClient } from 'pg'
import { pool } from '../connection'

// Feature AE v1 — БРС engine (TODO.md "### AE"). Per-course teacher data
// (unlike fgos.ts's platform-wide reference data) — every query here is
// scoped by course_id/teacher_id, never shared across teachers.

export interface BrsGradeThresholdRow {
  min_points: number
  max_points: number
  grade_label: string
}

export interface BrsSchemeRow {
  id: string
  course_id: string
  teacher_id: string
  version: number
  title: string | null
  grade_thresholds: BrsGradeThresholdRow[]
  status: 'draft' | 'published'
  source_excerpt: string | null
  created_at: Date
  updated_at: Date
}

export interface BrsCheckpointRow {
  id: string
  brs_scheme_id: string
  name: string
  max_points: string   // NUMERIC comes back as string from pg
  checkpoint_type: 'graded' | 'manual'
  is_verbatim_verified: boolean
  sort_order: number
}

export interface BrsSchemeWithCheckpoints extends BrsSchemeRow {
  checkpoints: BrsCheckpointRow[]
}

export interface BrsCheckpointInput {
  name: string
  max_points: number
  checkpoint_type: 'graded' | 'manual'
  is_verbatim_verified: boolean
}

export interface BrsSchemePayload {
  title?: string | null
  source_excerpt?: string | null
  checkpoints: BrsCheckpointInput[]
  gradeThresholds: BrsGradeThresholdRow[]
}

async function attachCheckpoints(scheme: BrsSchemeRow): Promise<BrsSchemeWithCheckpoints> {
  const { rows } = await pool.query<BrsCheckpointRow>(
    `SELECT * FROM brs_checkpoints WHERE brs_scheme_id = $1 ORDER BY sort_order`,
    [scheme.id]
  )
  return { ...scheme, checkpoints: rows }
}

/** Current scheme for a course: the latest published version if one exists,
 *  else the latest draft (so a teacher mid-review can leave and come back). */
export async function getBrsSchemeForCourse(courseId: string, teacherId: string): Promise<BrsSchemeWithCheckpoints | null> {
  const { rows } = await pool.query<BrsSchemeRow>(
    `SELECT * FROM brs_schemes WHERE course_id = $1 AND teacher_id = $2
     ORDER BY (status = 'published') DESC, version DESC LIMIT 1`,
    [courseId, teacherId]
  )
  return rows[0] ? attachCheckpoints(rows[0]) : null
}

export async function getBrsSchemeById(id: string, teacherId: string): Promise<BrsSchemeWithCheckpoints | null> {
  const { rows } = await pool.query<BrsSchemeRow>(
    `SELECT * FROM brs_schemes WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
  return rows[0] ? attachCheckpoints(rows[0]) : null
}

/** Creates a new draft version for a course — version = previous max + 1.
 *  Never mutates an existing published scheme in place (rule #5 posture —
 *  see migration 093's header comment for why). */
export async function createBrsSchemeDraft(
  courseId: string,
  teacherId: string,
  payload: BrsSchemePayload
): Promise<BrsSchemeWithCheckpoints> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: maxRows } = await client.query<{ max_version: number | null }>(
      `SELECT MAX(version) AS max_version FROM brs_schemes WHERE course_id = $1`,
      [courseId]
    )
    const version = (maxRows[0]?.max_version ?? 0) + 1

    const { rows } = await client.query<BrsSchemeRow>(
      `INSERT INTO brs_schemes (course_id, teacher_id, version, title, grade_thresholds, status, source_excerpt)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6)
       RETURNING *`,
      [courseId, teacherId, version, payload.title ?? null, JSON.stringify(payload.gradeThresholds), payload.source_excerpt ?? null]
    )
    const scheme = rows[0]
    await insertCheckpoints(client, scheme.id, payload.checkpoints)
    await client.query('COMMIT')
    return attachCheckpoints(scheme)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** The confirm step: replaces the draft's checkpoints with the (possibly
 *  teacher-edited) reviewed payload and flips status to 'published'. Only
 *  operates on a row this teacher owns; refuses a scheme that doesn't exist. */
export async function publishBrsScheme(
  id: string,
  teacherId: string,
  payload: BrsSchemePayload
): Promise<BrsSchemeWithCheckpoints | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM brs_schemes WHERE id = $1 AND teacher_id = $2 FOR UPDATE`,
      [id, teacherId]
    )
    if (!existing.rows[0]) { await client.query('ROLLBACK'); return null }

    const { rows } = await client.query<BrsSchemeRow>(
      `UPDATE brs_schemes
          SET title = $3, grade_thresholds = $4, status = 'published', updated_at = NOW()
        WHERE id = $1 AND teacher_id = $2
        RETURNING *`,
      [id, teacherId, payload.title ?? null, JSON.stringify(payload.gradeThresholds)]
    )

    await client.query('DELETE FROM brs_checkpoints WHERE brs_scheme_id = $1', [id])
    await insertCheckpoints(client, id, payload.checkpoints)

    await client.query('COMMIT')
    return attachCheckpoints(rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function insertCheckpoints(client: PoolClient, schemeId: string, checkpoints: BrsCheckpointInput[]): Promise<void> {
  for (const [i, c] of checkpoints.entries()) {
    await client.query(
      `INSERT INTO brs_checkpoints (brs_scheme_id, name, max_points, checkpoint_type, is_verbatim_verified, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [schemeId, c.name, c.max_points, c.checkpoint_type, c.is_verbatim_verified, i]
    )
  }
}

export async function addBrsManualEntry(data: {
  checkpointId: string
  teacherId: string
  studentName: string
  studentGroup?: string | null
  points: number
  note?: string | null
}): Promise<void> {
  await pool.query(
    `INSERT INTO brs_manual_entries (brs_checkpoint_id, teacher_id, student_name, student_group, points, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [data.checkpointId, data.teacherId, data.studentName, data.studentGroup ?? null, data.points, data.note ?? null]
  )
}

// ─── Ledger ──────────────────────────────────────────────────────────────────
// Raw rows for a given scheme's checkpoints — computeStudentAccrual (pure,
// services/brsScheme.ts) turns these into per-student totals. Grouped here
// by (student_name, student_group) so the caller doesn't need a second pass.

export interface StudentScoredRow {
  student_name: string
  student_group: string | null
  brs_checkpoint_id: string
  approved_score: number
}

export interface StudentManualRow {
  student_name: string
  student_group: string | null
  brs_checkpoint_id: string
  points: number
}

export async function getScoredRowsForScheme(schemeId: string, teacherId: string): Promise<StudentScoredRow[]> {
  const { rows } = await pool.query<StudentScoredRow>(
    `SELECT a.student_name, a.student_group, a.brs_checkpoint_id, a.approved_score
       FROM assignments a
       JOIN brs_checkpoints cp ON cp.id = a.brs_checkpoint_id
      WHERE cp.brs_scheme_id = $1
        AND a.teacher_id = $2
        AND a.approved_score IS NOT NULL
        AND a.student_name IS NOT NULL AND a.student_name <> ''`,
    [schemeId, teacherId]
  )
  return rows
}

export async function getManualRowsForScheme(schemeId: string, teacherId: string): Promise<StudentManualRow[]> {
  const { rows } = await pool.query<StudentManualRow>(
    `SELECT m.student_name, m.student_group, m.brs_checkpoint_id, m.points
       FROM brs_manual_entries m
       JOIN brs_checkpoints cp ON cp.id = m.brs_checkpoint_id
      WHERE cp.brs_scheme_id = $1 AND m.teacher_id = $2`,
    [schemeId, teacherId]
  )
  return rows
}
