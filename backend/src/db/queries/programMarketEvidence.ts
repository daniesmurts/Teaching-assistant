import { pool } from '../connection'
import type { VacancySnapshot, RegionSnapshot } from '../../services/labourMarket'
import type { ProfstandardRef, StrategyExcerpt } from '../../services/marketEvidenceGenerator'

// РОП Студия v0 (TODO.md Feature Z, Phase 0). Cached-latest-wins shape,
// same as program_analyses (migration 042) — append-only history, no
// draft/publish status. See migration 089 for the full rationale.
// Multi-region support (migration 090): region_codes/region_names are
// arrays, vacancy_snapshot nests per-region breakdowns.

export interface StrategyExcerptRow {
  text:       string
  page_start: number | null
  page_end:   number | null
}

export interface ProgramMarketEvidenceRow {
  id:                string
  program_id:        string
  region_codes:      string[]
  region_names:      string[]
  professions:       string[]
  vacancy_snapshot:  RegionSnapshot[]
  profstandard_refs: ProfstandardRef[]
  strategy_excerpts: StrategyExcerptRow[]
  section_text:      string
  created_by:        string | null
  created_at:        Date
  updated_at:        Date
}

export async function getLatestMarketEvidence(programId: string): Promise<ProgramMarketEvidenceRow | null> {
  const { rows } = await pool.query<ProgramMarketEvidenceRow>(
    `SELECT * FROM program_market_evidence WHERE program_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [programId]
  )
  return rows[0] ?? null
}

export async function createMarketEvidence(params: {
  programId:        string
  snapshot:         VacancySnapshot
  professions:      string[]
  profstandardRefs: ProfstandardRef[]
  strategyExcerpts: StrategyExcerpt[]
  sectionText:      string
  createdBy:        string
}): Promise<ProgramMarketEvidenceRow> {
  const strategyRows: StrategyExcerptRow[] = params.strategyExcerpts.map((e) => ({
    text: e.text, page_start: e.pageStart, page_end: e.pageEnd,
  }))
  const { rows } = await pool.query<ProgramMarketEvidenceRow>(
    `INSERT INTO program_market_evidence
       (program_id, region_codes, region_names, professions, vacancy_snapshot, profstandard_refs, strategy_excerpts, section_text, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      params.programId,
      params.snapshot.regions.map((r) => r.region_code),
      params.snapshot.regions.map((r) => r.region_name),
      params.professions, JSON.stringify(params.snapshot.regions),
      JSON.stringify(params.profstandardRefs), JSON.stringify(strategyRows),
      params.sectionText, params.createdBy,
    ]
  )
  return rows[0]
}

/** Edits to the generated text only (РОП is author of record) — every other field stays a fixed snapshot of what generated it. */
export async function updateMarketEvidenceText(
  id: string,
  programId: string,
  sectionText: string
): Promise<ProgramMarketEvidenceRow | null> {
  const { rows } = await pool.query<ProgramMarketEvidenceRow>(
    `UPDATE program_market_evidence SET section_text = $3, updated_at = NOW()
      WHERE id = $1 AND program_id = $2
      RETURNING *`,
    [id, programId, sectionText]
  )
  return rows[0] ?? null
}
