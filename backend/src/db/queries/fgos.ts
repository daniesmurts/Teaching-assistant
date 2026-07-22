import type { PoolClient } from 'pg'
import { pool } from '../connection'

// Feature AA v1 — ФГОС 3++ registry (TODO.md "### AA"). Shared reference
// data, platform-admin-curated (routes/adminFgos.ts) — no institution
// scoping anywhere in this file.

export interface FgosStandardRow {
  id:             string
  direction_code: string
  level:          string
  title:          string
  generation:     string | null
  order_number:   string | null
  order_date:     string | null
  source_url:     string | null
  effective_date: string | null
  status:         'draft' | 'published'
  created_by:     string | null
  created_at:     Date
  updated_at:     Date
}

export interface FgosCompetencyRow {
  id:                    string
  fgos_standard_id:      string
  type:                  'УК' | 'ОПК'
  code:                  string
  formulation:           string
  is_verbatim_verified:  boolean
  sort_order:            number
}

export interface FgosStructureRequirementRow {
  id:               string
  fgos_standard_id: string
  block_label:      string
  min_credits:      string | null
  max_credits:      string | null
  notes:            string | null
}

export interface FgosProfstandardRefRow {
  id:               string
  fgos_standard_id: string
  code:             string
  name:             string
  source_url:       string | null
}

export interface FgosStandardWithChildren extends FgosStandardRow {
  competencies:            FgosCompetencyRow[]
  structure_requirements:  FgosStructureRequirementRow[]
  profstandard_refs:       FgosProfstandardRefRow[]
}

export async function listFgosStandards(): Promise<FgosStandardRow[]> {
  const { rows } = await pool.query<FgosStandardRow>(
    `SELECT * FROM fgos_standards ORDER BY created_at DESC`
  )
  return rows
}

export interface FgosStandardsPageParams {
  page?:   number
  limit?:  number
  search?: string
  level?:  string
}

/** Paginated/filtered listing for the admin UI — `listFgosStandards()` above
 *  stays the unpaginated full fetch used internally by bulk-import dedup
 *  (`routes/adminFgos.ts`'s `/discover`), which needs every existing
 *  (direction_code, level) pair, not a page of them. */
export async function listFgosStandardsPage(
  params: FgosStandardsPageParams
): Promise<{ rows: FgosStandardRow[]; total: number }> {
  const page  = Math.max(1, params.page ?? 1)
  const limit = Math.min(50, Math.max(1, params.limit ?? 20))
  const offset = (page - 1) * limit
  const search = params.search?.trim()
  const level  = params.level?.trim()

  const conditions: string[] = []
  const values: unknown[] = []
  if (search) { values.push(`%${search}%`); conditions.push(`(direction_code ILIKE $${values.length} OR title ILIKE $${values.length})`) }
  if (level)  { values.push(level); conditions.push(`level = $${values.length}`) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const limitIdx  = values.length + 1
  const offsetIdx = values.length + 2

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query<FgosStandardRow>(
      `SELECT * FROM fgos_standards ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...values, limit, offset]
    ),
    pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM fgos_standards ${where}`,
      values
    ),
  ])

  return { rows, total: countRows[0].total }
}

// РОП Студия v0 (TODO.md Feature Z, Phase 0) — looks up a direction's
// профстандарты for the market-evidence generator. `programs.level` is
// English ('bachelor'|'master'|'specialist'); fgos_standards.level is
// Russian — the caller maps between them (routes/programs.ts).
export async function getProfstandardRefsForDirection(
  directionCode: string,
  level: string
): Promise<FgosProfstandardRefRow[]> {
  const { rows } = await pool.query<FgosProfstandardRefRow>(
    `SELECT p.* FROM fgos_profstandard_refs p
       JOIN fgos_standards s ON s.id = p.fgos_standard_id
      WHERE s.direction_code = $1 AND s.level = $2
      ORDER BY p.code`,
    [directionCode, level]
  )
  return rows
}

export async function getFgosStandardById(id: string): Promise<FgosStandardWithChildren | null> {
  const { rows } = await pool.query<FgosStandardRow>(
    `SELECT * FROM fgos_standards WHERE id = $1`,
    [id]
  )
  const standard = rows[0]
  if (!standard) return null

  const [competencies, structureRequirements, profstandardRefs] = await Promise.all([
    pool.query<FgosCompetencyRow>(
      `SELECT * FROM fgos_competencies WHERE fgos_standard_id = $1 ORDER BY sort_order, code`, [id]
    ),
    pool.query<FgosStructureRequirementRow>(
      `SELECT * FROM fgos_structure_requirements WHERE fgos_standard_id = $1`, [id]
    ),
    pool.query<FgosProfstandardRefRow>(
      `SELECT * FROM fgos_profstandard_refs WHERE fgos_standard_id = $1`, [id]
    ),
  ])

  return {
    ...standard,
    competencies:           competencies.rows,
    structure_requirements: structureRequirements.rows,
    profstandard_refs:      profstandardRefs.rows,
  }
}

export interface FgosStandardInput {
  direction_code:  string
  level:           string
  title:           string
  generation?:     string | null
  order_number?:   string | null
  order_date?:     string | null
  source_url?:     string | null
  effective_date?: string | null
}

export interface FgosCompetencyInput {
  type:        'УК' | 'ОПК'
  code:        string
  formulation: string
  is_verbatim_verified: boolean
}

export interface FgosStructureRequirementInput {
  block_label:  string
  min_credits?: number | null
  max_credits?: number | null
  notes?:       string | null
}

export interface FgosProfstandardRefInput {
  code:        string
  name:        string
  source_url?: string | null
}

export interface FgosStandardPayload {
  standard:               FgosStandardInput
  competencies:            FgosCompetencyInput[]
  structureRequirements:   FgosStructureRequirementInput[]
  profstandardRefs:        FgosProfstandardRefInput[]
}

/** Creates a new registry entry as a draft — never `published`. The admin's
 *  review-screen confirmation is a separate step (`publishFgosStandard`). */
export async function createFgosStandardDraft(
  payload: FgosStandardPayload,
  createdBy: string
): Promise<FgosStandardRow> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const standard = await insertStandard(client, payload.standard, createdBy, 'draft')
    await insertChildren(client, standard.id, payload)
    await client.query('COMMIT')
    return standard
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** The confirm step: replaces the draft's child rows with the (possibly
 *  admin-edited) reviewed payload and flips status to 'published'. Refuses
 *  to publish a standard that doesn't exist. */
export async function publishFgosStandard(
  id: string,
  payload: FgosStandardPayload
): Promise<FgosStandardRow | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<{ id: string }>('SELECT id FROM fgos_standards WHERE id = $1 FOR UPDATE', [id])
    if (!existing.rows[0]) { await client.query('ROLLBACK'); return null }

    const { rows } = await client.query<FgosStandardRow>(
      `UPDATE fgos_standards
          SET direction_code = $2, level = $3, title = $4, generation = $5,
              order_number = $6, order_date = $7, source_url = $8, effective_date = $9,
              status = 'published', updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, payload.standard.direction_code, payload.standard.level, payload.standard.title,
       payload.standard.generation ?? null, payload.standard.order_number ?? null,
       payload.standard.order_date ?? null, payload.standard.source_url ?? null,
       payload.standard.effective_date ?? null]
    )

    await client.query('DELETE FROM fgos_competencies WHERE fgos_standard_id = $1', [id])
    await client.query('DELETE FROM fgos_structure_requirements WHERE fgos_standard_id = $1', [id])
    await client.query('DELETE FROM fgos_profstandard_refs WHERE fgos_standard_id = $1', [id])
    await insertChildren(client, id, payload)

    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function deleteFgosStandard(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM fgos_standards WHERE id = $1', [id])
  return (rowCount ?? 0) > 0
}

// ─── Internal helpers ───────────────────────────────────────────────────────

async function insertStandard(
  client: PoolClient,
  standard: FgosStandardInput,
  createdBy: string,
  status: 'draft' | 'published'
): Promise<FgosStandardRow> {
  const { rows } = await client.query<FgosStandardRow>(
    `INSERT INTO fgos_standards
       (direction_code, level, title, generation, order_number, order_date, source_url, effective_date, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [standard.direction_code, standard.level, standard.title, standard.generation ?? null,
     standard.order_number ?? null, standard.order_date ?? null, standard.source_url ?? null,
     standard.effective_date ?? null, status, createdBy]
  )
  return rows[0]
}

async function insertChildren(
  client: PoolClient,
  standardId: string,
  payload: FgosStandardPayload
): Promise<void> {
  for (const [i, c] of payload.competencies.entries()) {
    await client.query(
      `INSERT INTO fgos_competencies (fgos_standard_id, type, code, formulation, is_verbatim_verified, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [standardId, c.type, c.code, c.formulation, c.is_verbatim_verified, i]
    )
  }
  for (const r of payload.structureRequirements) {
    await client.query(
      `INSERT INTO fgos_structure_requirements (fgos_standard_id, block_label, min_credits, max_credits, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [standardId, r.block_label, r.min_credits ?? null, r.max_credits ?? null, r.notes ?? null]
    )
  }
  for (const p of payload.profstandardRefs) {
    await client.query(
      `INSERT INTO fgos_profstandard_refs (fgos_standard_id, code, name, source_url)
       VALUES ($1, $2, $3, $4)`,
      [standardId, p.code, p.name, p.source_url ?? null]
    )
  }
}
