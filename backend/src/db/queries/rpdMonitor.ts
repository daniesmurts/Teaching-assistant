import { pool } from '../connection'

// ─── РПД Monitor (migration 086) ──────────────────────────────────────────────
// Snapshots of the АСУ «Заполнение РПД и ФОС» export + the institution-owned
// кафедра→институт grouping. Counts only; percentages are recomputed in the
// service layer (АСУ's own % columns contain anomalies).

export interface RpdSnapshotRecord {
  id:               string
  institution_id:   string
  uploaded_by:      string | null
  captured_at:      string
  period_label:     string | null
  source_filename:  string | null
  created_at:       string
}

export interface RpdSnapshotRowRecord {
  id:          string
  snapshot_id: string
  dept_code:   string
  edu_form:    string
  edu_level:   string
  plan_count:  number
  rpd_done:    number
  rpd_review:  number
  rpd_debt:    number
  fos_done:    number
  fos_review:  number
  fos_debt:    number
}

export interface RpdDeptGroupRecord {
  id:             string
  institution_id: string
  name:           string
  sort_order:     number
  dept_codes:     string[]
}

export interface RpdRowInput {
  deptCode:  string
  eduForm:   string
  eduLevel:  string
  planCount: number
  rpdDone:   number
  rpdReview: number
  rpdDebt:   number
  fosDone:   number
  fosReview: number
  fosDebt:   number
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

export async function createSnapshot(data: {
  institutionId:  string
  uploadedBy:     string
  capturedAt:     Date
  periodLabel:    string | null
  sourceFilename: string | null
  rows:           RpdRowInput[]
}): Promise<RpdSnapshotRecord> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [snapshot] } = await client.query<RpdSnapshotRecord>(
      `INSERT INTO rpd_snapshots (institution_id, uploaded_by, captured_at, period_label, source_filename)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.institutionId, data.uploadedBy, data.capturedAt, data.periodLabel, data.sourceFilename]
    )
    // Batched insert via UNNEST — ~220 rows per snapshot, one round-trip.
    if (data.rows.length > 0) {
      await client.query(
        `INSERT INTO rpd_snapshot_rows
           (snapshot_id, dept_code, edu_form, edu_level, plan_count,
            rpd_done, rpd_review, rpd_debt, fos_done, fos_review, fos_debt)
         SELECT $1, * FROM UNNEST(
           $2::text[], $3::text[], $4::text[], $5::int[],
           $6::int[], $7::int[], $8::int[],
           $9::int[], $10::int[], $11::int[]
         )`,
        [
          snapshot.id,
          data.rows.map((r) => r.deptCode),
          data.rows.map((r) => r.eduForm),
          data.rows.map((r) => r.eduLevel),
          data.rows.map((r) => r.planCount),
          data.rows.map((r) => r.rpdDone),
          data.rows.map((r) => r.rpdReview),
          data.rows.map((r) => r.rpdDebt),
          data.rows.map((r) => r.fosDone),
          data.rows.map((r) => r.fosReview),
          data.rows.map((r) => r.fosDebt),
        ]
      )
    }
    await client.query('COMMIT')
    return snapshot
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function listSnapshots(institutionId: string): Promise<Array<RpdSnapshotRecord & { row_count: number }>> {
  const { rows } = await pool.query<RpdSnapshotRecord & { row_count: number }>(
    `SELECT s.*, (SELECT COUNT(*)::int FROM rpd_snapshot_rows r WHERE r.snapshot_id = s.id) AS row_count
       FROM rpd_snapshots s
      WHERE s.institution_id = $1
      ORDER BY s.captured_at DESC`,
    [institutionId]
  )
  return rows
}

export async function getSnapshot(id: string, institutionId: string): Promise<RpdSnapshotRecord | null> {
  const { rows } = await pool.query<RpdSnapshotRecord>(
    `SELECT * FROM rpd_snapshots WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  )
  return rows[0] ?? null
}

export async function getLatestSnapshot(institutionId: string): Promise<RpdSnapshotRecord | null> {
  const { rows } = await pool.query<RpdSnapshotRecord>(
    `SELECT * FROM rpd_snapshots WHERE institution_id = $1 ORDER BY captured_at DESC LIMIT 1`,
    [institutionId]
  )
  return rows[0] ?? null
}

/** The snapshot immediately preceding `capturedAt` — the delta baseline. */
export async function getPreviousSnapshot(
  institutionId: string,
  capturedAt: string | Date
): Promise<RpdSnapshotRecord | null> {
  const { rows } = await pool.query<RpdSnapshotRecord>(
    `SELECT * FROM rpd_snapshots
      WHERE institution_id = $1 AND captured_at < $2
      ORDER BY captured_at DESC LIMIT 1`,
    [institutionId, capturedAt]
  )
  return rows[0] ?? null
}

export async function updateSnapshotCapturedAt(
  id: string,
  institutionId: string,
  capturedAt: Date
): Promise<RpdSnapshotRecord | null> {
  const { rows } = await pool.query<RpdSnapshotRecord>(
    `UPDATE rpd_snapshots SET captured_at = $3
      WHERE id = $1 AND institution_id = $2 RETURNING *`,
    [id, institutionId, capturedAt]
  )
  return rows[0] ?? null
}

export async function deleteSnapshot(id: string, institutionId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM rpd_snapshots WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  )
  return (rowCount ?? 0) > 0
}

export async function getSnapshotRows(snapshotId: string): Promise<RpdSnapshotRowRecord[]> {
  const { rows } = await pool.query<RpdSnapshotRowRecord>(
    `SELECT * FROM rpd_snapshot_rows WHERE snapshot_id = $1
      ORDER BY dept_code, edu_form, edu_level`,
    [snapshotId]
  )
  return rows
}

/** Totals per snapshot across the whole institution — powers the time series. */
export async function getSnapshotTotalsSeries(institutionId: string): Promise<Array<{
  snapshot_id: string
  captured_at: string
  plan_count:  number
  rpd_done:    number
  rpd_review:  number
  rpd_debt:    number
  fos_done:    number
}>> {
  const { rows } = await pool.query(
    `SELECT s.id AS snapshot_id, s.captured_at,
            COALESCE(SUM(r.plan_count), 0)::int AS plan_count,
            COALESCE(SUM(r.rpd_done),   0)::int AS rpd_done,
            COALESCE(SUM(r.rpd_review), 0)::int AS rpd_review,
            COALESCE(SUM(r.rpd_debt),   0)::int AS rpd_debt,
            COALESCE(SUM(r.fos_done),   0)::int AS fos_done
       FROM rpd_snapshots s
       LEFT JOIN rpd_snapshot_rows r ON r.snapshot_id = s.id
      WHERE s.institution_id = $1
      GROUP BY s.id, s.captured_at
      ORDER BY s.captured_at ASC`,
    [institutionId]
  )
  return rows
}

// ─── Dept groups (кафедра → институт mapping) ─────────────────────────────────

export async function listDeptGroups(institutionId: string): Promise<RpdDeptGroupRecord[]> {
  const { rows } = await pool.query<RpdDeptGroupRecord>(
    `SELECT g.id, g.institution_id, g.name, g.sort_order,
            COALESCE(ARRAY_AGG(m.dept_code ORDER BY m.dept_code)
                     FILTER (WHERE m.dept_code IS NOT NULL), '{}') AS dept_codes
       FROM rpd_dept_groups g
       LEFT JOIN rpd_dept_group_members m ON m.group_id = g.id
      WHERE g.institution_id = $1
      GROUP BY g.id
      ORDER BY g.sort_order, g.name`,
    [institutionId]
  )
  return rows
}

export async function getDeptGroup(id: string, institutionId: string): Promise<RpdDeptGroupRecord | null> {
  const { rows } = await pool.query<RpdDeptGroupRecord>(
    `SELECT g.id, g.institution_id, g.name, g.sort_order,
            COALESCE(ARRAY_AGG(m.dept_code ORDER BY m.dept_code)
                     FILTER (WHERE m.dept_code IS NOT NULL), '{}') AS dept_codes
       FROM rpd_dept_groups g
       LEFT JOIN rpd_dept_group_members m ON m.group_id = g.id
      WHERE g.id = $1 AND g.institution_id = $2
      GROUP BY g.id`,
    [id, institutionId]
  )
  return rows[0] ?? null
}

export async function createDeptGroup(
  institutionId: string,
  name: string,
  sortOrder = 0
): Promise<RpdDeptGroupRecord> {
  const { rows: [g] } = await pool.query(
    `INSERT INTO rpd_dept_groups (institution_id, name, sort_order)
     VALUES ($1, $2, $3)
     ON CONFLICT (institution_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
     RETURNING id, institution_id, name, sort_order`,
    [institutionId, name, sortOrder]
  )
  return { ...g, dept_codes: [] }
}

export async function renameDeptGroup(
  id: string,
  institutionId: string,
  name: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE rpd_dept_groups SET name = $3 WHERE id = $1 AND institution_id = $2`,
    [id, institutionId, name]
  )
  return (rowCount ?? 0) > 0
}

export async function deleteDeptGroup(id: string, institutionId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM rpd_dept_groups WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  )
  return (rowCount ?? 0) > 0
}

/** Re-assign кафедры to a group. A dept_code belongs to at most one group. */
export async function assignDeptsToGroup(
  groupId: string,
  institutionId: string,
  deptCodes: string[]
): Promise<void> {
  if (deptCodes.length === 0) return
  await pool.query(
    `INSERT INTO rpd_dept_group_members (group_id, institution_id, dept_code)
     SELECT $1, $2, UNNEST($3::text[])
     ON CONFLICT (institution_id, dept_code)
     DO UPDATE SET group_id = EXCLUDED.group_id`,
    [groupId, institutionId, deptCodes]
  )
}

export async function unassignDepts(institutionId: string, deptCodes: string[]): Promise<void> {
  if (deptCodes.length === 0) return
  await pool.query(
    `DELETE FROM rpd_dept_group_members
      WHERE institution_id = $1 AND dept_code = ANY($2::text[])`,
    [institutionId, deptCodes]
  )
}

/** dept_code → group name lookup for an institution. */
export async function getDeptGroupMap(institutionId: string): Promise<Map<string, { groupId: string; groupName: string }>> {
  const { rows } = await pool.query<{ dept_code: string; group_id: string; name: string }>(
    `SELECT m.dept_code, m.group_id, g.name
       FROM rpd_dept_group_members m
       JOIN rpd_dept_groups g ON g.id = m.group_id
      WHERE m.institution_id = $1`,
    [institutionId]
  )
  return new Map(rows.map((r) => [r.dept_code, { groupId: r.group_id, groupName: r.name }]))
}
