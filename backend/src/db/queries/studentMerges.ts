import { pool } from '../connection'
import type { PoolClient } from 'pg'

/**
 * Rewrites one free-text student identity onto another, everywhere it appears.
 *
 * See migration 127 for why this is a rewrite and not an alias layer. The short
 * version: (student_name, student_group) is read directly in ~8 query sites
 * across five tables, and a resolver every one of them has to remember to call
 * fails silently in the one place that forgets.
 *
 * Five tables carry the pair, all teacher-owned:
 *   assignments        — the roster, the averages, the trajectory, the ledger
 *   long_reviews       — ВКР jobs (their grade also lands in assignments)
 *   topic_sets         — per-student research topics
 *   brs_manual_entries — посещение/активность points with no graded work
 *   assignment_invites — the student's own name on a published link, reached
 *                        through published_assignments.teacher_id
 *
 * Missing that last one would leave the submission-review page showing the old
 * spelling next to a grade filed under the new one.
 */

export interface StudentIdentity {
  name:  string
  group: string | null
}

export interface StudentMerge {
  id:         string
  from_name:  string
  from_group: string | null
  to_name:    string
  to_group:   string | null
  row_count:  number
  source:     'suggested' | 'manual'
  merged_at:  string
  undone_at:  string | null
}

interface MergeRow {
  id: string
  from_name: string; from_group: string | null
  to_name: string;   to_group: string | null
  row_count: number
  source: 'suggested' | 'manual'
  merged_at: Date
  undone_at: Date | null
}

const toMerge = (r: MergeRow): StudentMerge => ({
  id:         r.id,
  from_name:  r.from_name,
  from_group: r.from_group,
  to_name:    r.to_name,
  to_group:   r.to_group,
  row_count:  r.row_count,
  source:     r.source,
  merged_at:  r.merged_at.toISOString(),
  undone_at:  r.undone_at ? r.undone_at.toISOString() : null,
})

// Every table but assignment_invites is a flat teacher_id + identity match.
// `IS NOT DISTINCT FROM` on the group is what makes a NULL group match a NULL
// group — plain `=` would silently rewrite nothing for the (very common)
// student the teacher never assigned a group to.
const OWNED_TABLES = ['assignments', 'long_reviews', 'topic_sets', 'brs_manual_entries'] as const

async function rewriteOwnedTable(
  client: PoolClient, table: (typeof OWNED_TABLES)[number],
  teacherId: string, from: StudentIdentity, to: StudentIdentity,
): Promise<string[]> {
  // `table` is from the const tuple above, never from a request — the identity
  // values are all parameterised (rule 6).
  const { rows } = await client.query<{ id: string }>(
    `UPDATE ${table}
        SET student_name = $4, student_group = $5
      WHERE teacher_id = $1
        AND student_name = $2
        AND student_group IS NOT DISTINCT FROM $3
      RETURNING id`,
    [teacherId, from.name, from.group, to.name, to.group]
  )
  return rows.map((r) => r.id)
}

/**
 * assignment_invites has no student_group column at all — the group lives on
 * the parent published assignment's roster, not the invite. So the invite is
 * matched on name alone, and only for the teacher who owns the published
 * assignment.
 */
async function rewriteInvites(
  client: PoolClient, teacherId: string, from: StudentIdentity, to: StudentIdentity,
): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `UPDATE assignment_invites i
        SET student_name = $3
       FROM published_assignments pa
      WHERE pa.id = i.published_assignment_id
        AND pa.teacher_id = $1
        AND i.student_name = $2
      RETURNING i.id`,
    [teacherId, from.name, to.name]
  )
  return rows.map((r) => r.id)
}

export class StudentMergeError extends Error {}

/**
 * Rewrite `from` → `to` across all five tables in one transaction, recording
 * exactly which rows moved so the merge can be undone precisely.
 *
 * Returns null when the merge touched nothing — a stale roster in the browser
 * asking to merge an identity that no longer exists (already merged in another
 * tab, say) should be a no-op the UI can report, not a phantom audit row.
 */
export async function mergeStudentIdentity(
  teacherId: string,
  from: StudentIdentity,
  to: StudentIdentity,
  source: 'suggested' | 'manual' = 'manual',
): Promise<StudentMerge | null> {
  if (from.name === to.name && (from.group ?? null) === (to.group ?? null)) {
    throw new StudentMergeError('Нельзя объединить студента с самим собой.')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const rewritten: Record<string, string[]> = {}
    let rowCount = 0
    for (const table of OWNED_TABLES) {
      const ids = await rewriteOwnedTable(client, table, teacherId, from, to)
      if (ids.length) { rewritten[table] = ids; rowCount += ids.length }
    }
    const inviteIds = await rewriteInvites(client, teacherId, from, to)
    if (inviteIds.length) { rewritten.assignment_invites = inviteIds; rowCount += inviteIds.length }

    if (rowCount === 0) {
      await client.query('ROLLBACK')
      return null
    }

    const { rows } = await client.query<MergeRow>(
      `INSERT INTO student_merges
         (teacher_id, from_name, from_group, to_name, to_group, rewritten, row_count, source)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       RETURNING *`,
      [teacherId, from.name, from.group, to.name, to.group, JSON.stringify(rewritten), rowCount, source]
    )

    await client.query('COMMIT')
    return toMerge(rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Put the original spelling back on exactly the rows this merge rewrote.
 *
 * Id-scoped rather than value-scoped on purpose: a work graded under the target
 * name *after* the merge was never part of it and must not be dragged back to
 * a spelling it never had.
 */
export async function undoStudentMerge(teacherId: string, mergeId: string): Promise<StudentMerge | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: found } = await client.query<MergeRow & { rewritten: Record<string, string[]> }>(
      `SELECT * FROM student_merges
        WHERE id = $1 AND teacher_id = $2 AND undone_at IS NULL
          FOR UPDATE`,
      [mergeId, teacherId]
    )
    if (!found.length) { await client.query('ROLLBACK'); return null }
    const merge = found[0]

    for (const table of OWNED_TABLES) {
      const ids = merge.rewritten[table]
      if (!ids?.length) continue
      await client.query(
        `UPDATE ${table} SET student_name = $2, student_group = $3
          WHERE teacher_id = $4 AND id = ANY($1::uuid[])`,
        [ids, merge.from_name, merge.from_group, teacherId]
      )
    }
    const inviteIds = merge.rewritten.assignment_invites
    if (inviteIds?.length) {
      await client.query(
        `UPDATE assignment_invites i SET student_name = $2
           FROM published_assignments pa
          WHERE pa.id = i.published_assignment_id
            AND pa.teacher_id = $3
            AND i.id = ANY($1::uuid[])`,
        [inviteIds, merge.from_name, teacherId]
      )
    }

    const { rows } = await client.query<MergeRow>(
      `UPDATE student_merges SET undone_at = NOW() WHERE id = $1 RETURNING *`,
      [mergeId]
    )
    await client.query('COMMIT')
    return toMerge(rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Recent merges for this teacher — the undo list on the Students page. */
export async function listStudentMerges(teacherId: string, limit = 20): Promise<StudentMerge[]> {
  const { rows } = await pool.query<MergeRow>(
    `SELECT * FROM student_merges
      WHERE teacher_id = $1
      ORDER BY merged_at DESC
      LIMIT $2`,
    [teacherId, Math.min(100, Math.max(1, limit))]
  )
  return rows.map(toMerge)
}
