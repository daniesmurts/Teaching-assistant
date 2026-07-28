import { pool } from '../connection'
import type {
  ContentSection, PrerequisiteOrigin, CompetencyLinkStage, ProgramPrerequisite, ProgramCompetencyLink,
  ProgramContentUnit,
} from '../../../../shared/types'

// Topology graph substrate (docs/topology-spec.md, Increment 0; migration
// 099). Persists what programAnalysis.ts's LLM passes already infer —
// prerequisite edges and competency formation-stage links — as id-based,
// queryable rows instead of a discard-after-render JSONB blob.
//
// Every `replace*` function here implements the same re-analysis rule:
// 'extracted' rows are wholly replaced by the newest analysis run;
// 'manual'/'confirmed' rows (no UI writes these yet — the columns exist for
// Increment 4's sandbox) are never touched. The pattern is: delete this
// programme's 'extracted' rows, then re-insert the new set with an
// ON CONFLICT guard scoped to `origin = 'extracted'` — so if a manual/
// confirmed edge already occupies that unique slot, the newly-extracted
// duplicate is silently absorbed rather than overwriting it.

interface PrerequisiteRow {
  id: string
  program_id: string
  discipline_id: string
  prerequisite_discipline_id: string
  reason: string
  inverted: boolean
  origin: string
  analysis_id: string | null
  created_at: Date
  updated_at: Date
}

function toPrerequisite(r: PrerequisiteRow): ProgramPrerequisite {
  return {
    id:                          r.id,
    program_id:                  r.program_id,
    discipline_id:               r.discipline_id,
    prerequisite_discipline_id:  r.prerequisite_discipline_id,
    reason:                      r.reason,
    inverted:                    r.inverted,
    origin:                      r.origin as PrerequisiteOrigin,
    analysis_id:                 r.analysis_id,
    created_at:                  r.created_at.toISOString(),
    updated_at:                  r.updated_at.toISOString(),
  }
}

export interface ReplacePrerequisiteInput {
  disciplineId:              string
  prerequisiteDisciplineId:  string
  reason:                    string
  inverted:                  boolean
}

/** Replaces this programme's `extracted` prerequisite edges with a fresh
 *  set from the latest analysis run. `manual`/`confirmed` edges are never
 *  deleted or overwritten — see the module header for the mechanism. */
export async function replacePrerequisites(
  programId: string, edges: ReplacePrerequisiteInput[], analysisId: string | null
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM program_prerequisites WHERE program_id = $1 AND origin = 'extracted'`,
      [programId]
    )
    for (const e of edges) {
      await client.query(
        `INSERT INTO program_prerequisites
           (program_id, discipline_id, prerequisite_discipline_id, reason, inverted, origin, analysis_id)
         VALUES ($1,$2,$3,$4,$5,'extracted',$6)
         ON CONFLICT (discipline_id, prerequisite_discipline_id) DO UPDATE
           SET reason = EXCLUDED.reason, inverted = EXCLUDED.inverted,
               analysis_id = EXCLUDED.analysis_id, updated_at = NOW()
           WHERE program_prerequisites.origin = 'extracted'`,
        [programId, e.disciplineId, e.prerequisiteDisciplineId, e.reason, e.inverted, analysisId]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function listPrerequisites(programId: string): Promise<ProgramPrerequisite[]> {
  const { rows } = await pool.query<PrerequisiteRow>(
    `SELECT * FROM program_prerequisites WHERE program_id = $1 ORDER BY created_at`,
    [programId]
  )
  return rows.map(toPrerequisite)
}

interface CompetencyLinkRow {
  id: string
  program_id: string
  discipline_id: string
  content_unit_id: string | null
  competency_id: string
  stage: string
  origin: string
  analysis_id: string | null
  evidence_quote: string | null
  created_at: Date
  updated_at: Date
}

function toCompetencyLink(r: CompetencyLinkRow): ProgramCompetencyLink {
  return {
    id:               r.id,
    program_id:       r.program_id,
    discipline_id:    r.discipline_id,
    content_unit_id:  r.content_unit_id,
    competency_id:    r.competency_id,
    stage:            r.stage as CompetencyLinkStage,
    origin:           r.origin as PrerequisiteOrigin,
    analysis_id:      r.analysis_id,
    evidence_quote:   r.evidence_quote,
    created_at:       r.created_at.toISOString(),
    updated_at:       r.updated_at.toISOString(),
  }
}

export interface ReplaceCompetencyLinkInput {
  disciplineId:    string
  competencyId:    string
  stage:           CompetencyLinkStage
  evidenceQuote?:  string | null
}

/** Replaces this programme's discipline-level (content_unit_id IS NULL)
 *  `extracted` competency links. Content-unit-level links are Increment 2's
 *  concern and untouched by this function. Same manual/confirmed-preserving
 *  rule as replacePrerequisites. */
export async function replaceCompetencyLinks(
  programId: string, links: ReplaceCompetencyLinkInput[], analysisId: string | null
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM program_competency_links
        WHERE program_id = $1 AND origin = 'extracted' AND content_unit_id IS NULL`,
      [programId]
    )
    for (const l of links) {
      await client.query(
        `INSERT INTO program_competency_links
           (program_id, discipline_id, competency_id, stage, origin, analysis_id, evidence_quote)
         VALUES ($1,$2,$3,$4,'extracted',$5,$6)
         ON CONFLICT (discipline_id, competency_id, stage) WHERE content_unit_id IS NULL
         DO UPDATE
           SET analysis_id = EXCLUDED.analysis_id, evidence_quote = EXCLUDED.evidence_quote, updated_at = NOW()
           WHERE program_competency_links.origin = 'extracted'`,
        [programId, l.disciplineId, l.competencyId, l.stage, analysisId, l.evidenceQuote ?? null]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function listCompetencyLinks(programId: string): Promise<ProgramCompetencyLink[]> {
  const { rows } = await pool.query<CompetencyLinkRow>(
    `SELECT * FROM program_competency_links WHERE program_id = $1 ORDER BY created_at`,
    [programId]
  )
  return rows.map(toCompetencyLink)
}

/** Read-side aggregate for the «Топология» tab (Increment 1) — mirrors
 *  getProgramDetail's shape (db/queries/programs.ts). Deliberately excludes
 *  discipline/competency names — the caller already has those from the
 *  existing getProgramDetail fetch; duplicating them here would just be a
 *  second source of truth to keep in sync. */
export async function getProgramTopology(programId: string): Promise<{
  prerequisites:    ProgramPrerequisite[]
  competencyLinks:  ProgramCompetencyLink[]
}> {
  const [prerequisites, competencyLinks] = await Promise.all([
    listPrerequisites(programId),
    listCompetencyLinks(programId),
  ])
  return { prerequisites, competencyLinks }
}

interface ContentUnitRow {
  id: string
  discipline_id: string
  section: string
  title: string
  topics: string[] | null
  source_doc_id: string | null
  provenance: string
  sort_order: number
  created_at: Date
}

function toContentUnit(r: ContentUnitRow): ProgramContentUnit {
  return {
    id:             r.id,
    discipline_id:  r.discipline_id,
    section:        r.section as ContentSection,
    title:          r.title,
    topics:         r.topics ?? [],
    source_doc_id:  r.source_doc_id,
    provenance:     r.provenance as 'approved' | 'latest',
    sort_order:     r.sort_order,
    created_at:     r.created_at.toISOString(),
  }
}

export interface ReplaceContentUnitInput {
  section:    ContentSection
  title:      string
  topics:     string[]
  sortOrder:  number
}

/** No `origin`/manual-edit concept here — nothing edits content units yet
 *  (that's Increment 2's audit-level UI), so a plain full replace per
 *  discipline is enough, unlike the extracted-preserving edge functions
 *  above. */
export async function replaceContentUnits(
  disciplineId: string, units: ReplaceContentUnitInput[],
  sourceDocId: string, provenance: 'approved' | 'latest',
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM program_content_units WHERE discipline_id = $1', [disciplineId])
    for (const u of units) {
      await client.query(
        `INSERT INTO program_content_units
           (discipline_id, section, title, topics, source_doc_id, provenance, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [disciplineId, u.section, u.title, JSON.stringify(u.topics), sourceDocId, provenance, u.sortOrder]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function listContentUnitsByDiscipline(disciplineId: string): Promise<ProgramContentUnit[]> {
  const { rows } = await pool.query<ContentUnitRow>(
    `SELECT * FROM program_content_units WHERE discipline_id = $1 ORDER BY section, sort_order`,
    [disciplineId]
  )
  return rows.map(toContentUnit)
}

/** Skip guard for the /analyze trigger — avoids re-running the extraction
 *  LLM pass on every analyze click when the discipline's document hasn't
 *  changed since the last extraction. */
export async function hasContentUnitsForDocument(disciplineId: string, sourceDocId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM program_content_units WHERE discipline_id = $1 AND source_doc_id = $2 LIMIT 1`,
    [disciplineId, sourceDocId]
  )
  return rows.length > 0
}
