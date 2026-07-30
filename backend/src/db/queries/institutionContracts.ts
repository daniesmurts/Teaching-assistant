import { pool } from '../connection'

// Manual record of negotiated institution contracts (TODO.md Feature AL
// Phase 0) — institution revenue doesn't exist anywhere else in the
// database (payments.ts is teacher-scoped only). See migration 105.

export interface InstitutionContract {
  id:                string
  institution_id:    string
  annual_value_rub:  number   // NUMERIC — parsed to a real number by connection.ts's global type parser (OID 1700), not left as a string
  seats_purchased:   number
  term_start:        string   // 'YYYY-MM-DD' — explicitly cast to text in every query below; a raw DATE column comes back
  term_end:          string   // as a JS Date at UTC midnight, one well-known step from a local-timezone display bug
  notes:             string | null
  created_by:        string | null
  created_at:        string
  updated_at:        string
}

export interface CreateInstitutionContractParams {
  institutionId:  string
  annualValueRub: number
  seatsPurchased: number
  termStart:      string   // ISO date
  termEnd:        string   // ISO date
  notes?:         string | null
  createdBy:      string
}

// Every query below selects term_start/term_end via to_char(...) instead of
// `SELECT *`/`RETURNING *` — a raw DATE column comes back from pg as a JS
// Date at UTC midnight, one `.toLocaleDateString()` away from silently
// showing the wrong day depending on the caller's local timezone. Casting
// to 'YYYY-MM-DD' text here means InstitutionContract.term_start is an
// honest string, not an aspirational one.
const CONTRACT_COLUMNS = `
  id, institution_id, annual_value_rub, seats_purchased,
  to_char(term_start, 'YYYY-MM-DD') AS term_start,
  to_char(term_end,   'YYYY-MM-DD') AS term_end,
  notes, created_by, created_at, updated_at
`

export async function listInstitutionContracts(institutionId: string): Promise<InstitutionContract[]> {
  const { rows } = await pool.query<InstitutionContract>(
    `SELECT ${CONTRACT_COLUMNS} FROM institution_contracts
      WHERE institution_id = $1
      ORDER BY term_start DESC`,
    [institutionId]
  )
  return rows
}

/** The contract whose term covers `asOfDate` (defaults to today), if any — the one that matters for a live margin view. */
export async function getCurrentInstitutionContract(institutionId: string, asOfDate?: string): Promise<InstitutionContract | null> {
  const { rows } = await pool.query<InstitutionContract>(
    `SELECT ${CONTRACT_COLUMNS} FROM institution_contracts
      WHERE institution_id = $1
        AND term_start <= COALESCE($2::date, CURRENT_DATE)
        AND term_end   >= COALESCE($2::date, CURRENT_DATE)
      ORDER BY term_start DESC
      LIMIT 1`,
    [institutionId, asOfDate ?? null]
  )
  return rows[0] ?? null
}

export async function createInstitutionContract(params: CreateInstitutionContractParams): Promise<InstitutionContract> {
  const { rows } = await pool.query<InstitutionContract>(
    `INSERT INTO institution_contracts
       (institution_id, annual_value_rub, seats_purchased, term_start, term_end, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${CONTRACT_COLUMNS}`,
    [
      params.institutionId, params.annualValueRub, params.seatsPurchased,
      params.termStart, params.termEnd, params.notes ?? null, params.createdBy,
    ]
  )
  return rows[0]
}

export async function updateInstitutionContract(
  id: string,
  data: {
    annualValueRub?: number
    seatsPurchased?: number
    termStart?:      string
    termEnd?:        string
    notes?:          string | null
  }
): Promise<InstitutionContract | null> {
  const { rows } = await pool.query<InstitutionContract>(
    `UPDATE institution_contracts
        SET annual_value_rub = COALESCE($2, annual_value_rub),
            seats_purchased  = COALESCE($3, seats_purchased),
            term_start       = COALESCE($4, term_start),
            term_end         = COALESCE($5, term_end),
            notes            = CASE WHEN $6::boolean THEN $7 ELSE notes END,
            updated_at       = NOW()
      WHERE id = $1
      RETURNING ${CONTRACT_COLUMNS}`,
    [
      id, data.annualValueRub ?? null, data.seatsPurchased ?? null,
      data.termStart ?? null, data.termEnd ?? null,
      data.notes !== undefined, data.notes ?? null,
    ]
  )
  return rows[0] ?? null
}

export async function deleteInstitutionContract(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM institution_contracts WHERE id = $1`, [id])
  return (rowCount ?? 0) > 0
}
