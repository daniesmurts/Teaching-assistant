import type { PoolClient } from 'pg'
import { pool } from '../connection'

// Профстандарт/ОТФ registry (migration 115, методист feedback item 3).
// Mirrors db/queries/fgos.ts's ФГОС registry shape exactly: federal
// reference data (a профстандарт is independent of any one ФГОС — many
// ФГОС can cite the same one, so it gets its own table rather than living
// nested under fgos_standards), platform-admin-curated
// (routes/adminProfstandards.ts) — no institution scoping anywhere here.

export interface ProfstandardRow {
  id:          string
  code:        string
  name:        string
  source_url:  string | null
  status:      'draft' | 'published'
  created_by:  string | null
  created_at:  Date
  updated_at:  Date
}

export interface ProfstandardOtfRow {
  id:                     string
  profstandard_id:        string
  otf_code:               string
  name:                   string
  qualification_level:    string | null
  education_requirement:  string | null
  is_verbatim_verified:   boolean
  sort_order:             number
}

export interface ProfstandardWithChildren extends ProfstandardRow {
  otf: ProfstandardOtfRow[]
}

export interface ProfstandardsPageParams {
  page?:   number
  limit?:  number
  search?: string
}

export async function listProfstandardsPage(
  params: ProfstandardsPageParams
): Promise<{ rows: ProfstandardRow[]; total: number }> {
  const page  = Math.max(1, params.page ?? 1)
  const limit = Math.min(50, Math.max(1, params.limit ?? 20))
  const offset = (page - 1) * limit
  const search = params.search?.trim()

  const conditions: string[] = []
  const values: unknown[] = []
  if (search) { values.push(`%${search}%`); conditions.push(`(code ILIKE $${values.length} OR name ILIKE $${values.length})`) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const limitIdx  = values.length + 1
  const offsetIdx = values.length + 2

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query<ProfstandardRow>(
      `SELECT * FROM profstandards ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...values, limit, offset]
    ),
    pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM profstandards ${where}`,
      values
    ),
  ])

  return { rows, total: countRows[0].total }
}

export async function getProfstandardById(id: string): Promise<ProfstandardWithChildren | null> {
  const { rows } = await pool.query<ProfstandardRow>(
    `SELECT * FROM profstandards WHERE id = $1`, [id]
  )
  const standard = rows[0]
  if (!standard) return null

  const { rows: otf } = await pool.query<ProfstandardOtfRow>(
    `SELECT * FROM profstandard_otf WHERE profstandard_id = $1 ORDER BY sort_order, otf_code`, [id]
  )
  return { ...standard, otf }
}

/** Published профстандарты (by code) with their ОТФ list — the Конструктор
 *  picker's data source. Codes come from fgos_profstandard_refs, which may
 *  name a профстандарт that hasn't been registered/published here yet
 *  (returns nothing for that code — the picker shows it as "нет данных",
 *  never silently substitutes a wrong one). */
export async function getPublishedOtfForCodes(codes: string[]): Promise<ProfstandardWithChildren[]> {
  if (codes.length === 0) return []
  const { rows: standards } = await pool.query<ProfstandardRow>(
    `SELECT * FROM profstandards WHERE code = ANY($1) AND status = 'published' ORDER BY code`,
    [codes]
  )
  if (standards.length === 0) return []

  const { rows: otf } = await pool.query<ProfstandardOtfRow>(
    `SELECT * FROM profstandard_otf WHERE profstandard_id = ANY($1) ORDER BY sort_order, otf_code`,
    [standards.map((s) => s.id)]
  )
  const otfByStandard = new Map<string, ProfstandardOtfRow[]>()
  for (const row of otf) {
    const list = otfByStandard.get(row.profstandard_id) ?? []
    list.push(row)
    otfByStandard.set(row.profstandard_id, list)
  }
  return standards.map((s) => ({ ...s, otf: otfByStandard.get(s.id) ?? [] }))
}

/** Resolves a set of program_competency_indicators' parent
 *  profstandard_otf_id values to their name/education_requirement, for
 *  services/pkFormulation.ts and programAnalysis.ts's report. */
export async function getOtfByIds(ids: string[]): Promise<ProfstandardOtfRow[]> {
  if (ids.length === 0) return []
  const { rows } = await pool.query<ProfstandardOtfRow>(
    `SELECT * FROM profstandard_otf WHERE id = ANY($1)`, [ids]
  )
  return rows
}

export interface ProfstandardInput {
  code:        string
  name:        string
  source_url?: string | null
}

export interface ProfstandardOtfInput {
  otf_code:               string
  name:                   string
  qualification_level?:   string | null
  education_requirement?: string | null
  is_verbatim_verified?:  boolean
}

export interface ProfstandardPayload {
  standard: ProfstandardInput
  otf:      ProfstandardOtfInput[]
}

/** Creates a new registry entry as a draft — never `published`. The admin's
 *  review-screen confirmation is a separate step (`publishProfstandard`). */
export async function createProfstandardDraft(
  payload: ProfstandardPayload,
  createdBy: string
): Promise<ProfstandardRow> {
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

/** The confirm step: replaces the draft's ОТФ rows with the (possibly
 *  admin-edited) reviewed payload and flips status to 'published'. Refuses
 *  to publish a standard that doesn't exist. */
export async function publishProfstandard(
  id: string,
  payload: ProfstandardPayload
): Promise<ProfstandardRow | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<{ id: string }>('SELECT id FROM profstandards WHERE id = $1 FOR UPDATE', [id])
    if (!existing.rows[0]) { await client.query('ROLLBACK'); return null }

    const { rows } = await client.query<ProfstandardRow>(
      `UPDATE profstandards
          SET code = $2, name = $3, source_url = $4, status = 'published', updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, payload.standard.code, payload.standard.name, payload.standard.source_url ?? null]
    )

    await client.query('DELETE FROM profstandard_otf WHERE profstandard_id = $1', [id])
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

export async function deleteProfstandard(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM profstandards WHERE id = $1', [id])
  return (rowCount ?? 0) > 0
}

// ─── Internal helpers ───────────────────────────────────────────────────────

async function insertStandard(
  client: PoolClient,
  standard: ProfstandardInput,
  createdBy: string,
  status: 'draft' | 'published'
): Promise<ProfstandardRow> {
  const { rows } = await client.query<ProfstandardRow>(
    `INSERT INTO profstandards (code, name, source_url, status, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [standard.code, standard.name, standard.source_url ?? null, status, createdBy]
  )
  return rows[0]
}

async function insertChildren(
  client: PoolClient,
  standardId: string,
  payload: ProfstandardPayload
): Promise<void> {
  for (const [i, o] of payload.otf.entries()) {
    await client.query(
      `INSERT INTO profstandard_otf
         (profstandard_id, otf_code, name, qualification_level, education_requirement, is_verbatim_verified, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [standardId, o.otf_code, o.name, o.qualification_level ?? null, o.education_requirement ?? null,
       o.is_verbatim_verified ?? false, i]
    )
  }
}
