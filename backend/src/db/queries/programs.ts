import { pool } from '../connection'
import type {
  Program, ProgramDetail, ProgramDiscipline, ProgramCompetency, ProgramLevel, ProgramAnalysis,
} from '../../../../shared/types'

// Persistence for academic programs (учебные планы). Everything is scoped to an
// institution_id — callers pass the authenticated admin's institution, never a
// body value. Bulk replaces (disciplines/competencies) run in a transaction so
// the saved plan is never left half-written.

interface ProgramRow {
  id: string
  institution_id: string
  created_by: string | null
  name: string
  code: string | null
  level: string | null
  duration_semesters: number
  description: string | null
  specialty_name: string | null
  education_level: string | null
  profile: string | null
  forms_of_study: string | null
  description_text: string | null
  plan_text: string | null
  created_at: Date
  updated_at: Date
}

function toProgram(r: ProgramRow): Program {
  return {
    id: r.id,
    institution_id: r.institution_id,
    created_by: r.created_by,
    name: r.name,
    code: r.code,
    level: r.level as ProgramLevel | null,
    duration_semesters: r.duration_semesters,
    description: r.description,
    specialty_name: r.specialty_name,
    education_level: r.education_level,
    profile: r.profile,
    forms_of_study: r.forms_of_study,
    has_description_doc: Boolean((r.description_text ?? '').trim()),
    has_plan_doc: Boolean((r.plan_text ?? '').trim()),
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  }
}

export interface ProgramMeta {
  name: string
  code?: string | null
  level?: string | null
  duration_semesters?: number
  description?: string | null
  specialty_name?: string | null
  education_level?: string | null
  profile?: string | null
  forms_of_study?: string | null
}

interface DisciplineRow {
  id: string
  course_id: string | null
  name: string
  semester: number
  credits: string | null          // pg returns NUMERIC as string
  control_form: string | null
  competency_codes: string[]
  sort_order: number
}

function toDiscipline(r: DisciplineRow): ProgramDiscipline {
  return {
    id: r.id,
    course_id: r.course_id,
    name: r.name,
    semester: r.semester,
    credits: r.credits == null ? null : Number(r.credits),
    control_form: r.control_form,
    competency_codes: r.competency_codes ?? [],
    sort_order: r.sort_order,
  }
}

interface CompetencyRow {
  id: string
  kind: string
  code: string | null
  title: string
  sort_order: number
}

function toCompetency(r: CompetencyRow): ProgramCompetency {
  return {
    id: r.id,
    kind: r.kind === 'goal' ? 'goal' : 'competency',
    code: r.code,
    title: r.title,
    sort_order: r.sort_order,
  }
}

// ── Programs ───────────────────────────────────────────────────────────────────

export async function listPrograms(institutionId: string): Promise<Program[]> {
  const { rows } = await pool.query<ProgramRow>(
    'SELECT * FROM programs WHERE institution_id = $1 ORDER BY created_at DESC',
    [institutionId]
  )
  return rows.map(toProgram)
}

export async function createProgram(
  institutionId: string,
  createdBy: string,
  data: ProgramMeta
): Promise<Program> {
  const { rows } = await pool.query<ProgramRow>(
    `INSERT INTO programs
       (institution_id, created_by, name, code, level, duration_semesters, description,
        specialty_name, education_level, profile, forms_of_study)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [institutionId, createdBy, data.name, data.code ?? null, data.level ?? null,
     data.duration_semesters ?? 8, data.description ?? null,
     data.specialty_name ?? null, data.education_level ?? null, data.profile ?? null, data.forms_of_study ?? null]
  )
  return toProgram(rows[0])
}

export async function findProgram(id: string, institutionId: string): Promise<Program | null> {
  const { rows } = await pool.query<ProgramRow>(
    'SELECT * FROM programs WHERE id = $1 AND institution_id = $2 LIMIT 1',
    [id, institutionId]
  )
  return rows[0] ? toProgram(rows[0]) : null
}

export async function getProgramDetail(id: string, institutionId: string): Promise<ProgramDetail | null> {
  const program = await findProgram(id, institutionId)
  if (!program) return null

  const [disciplines, competencies] = await Promise.all([
    pool.query<DisciplineRow>(
      `SELECT id, course_id, name, semester, credits, control_form, competency_codes, sort_order
       FROM program_disciplines WHERE program_id = $1
       ORDER BY semester, sort_order`,
      [id]
    ),
    pool.query<CompetencyRow>(
      `SELECT id, kind, code, title, sort_order
       FROM program_competencies WHERE program_id = $1
       ORDER BY sort_order`,
      [id]
    ),
  ])

  return {
    ...program,
    disciplines: disciplines.rows.map(toDiscipline),
    competencies: competencies.rows.map(toCompetency),
  }
}

export async function updateProgram(
  id: string,
  institutionId: string,
  data: Partial<ProgramMeta>
): Promise<Program | null> {
  const { rows } = await pool.query<ProgramRow>(
    `UPDATE programs SET
       name               = COALESCE($3, name),
       code               = COALESCE($4, code),
       level              = COALESCE($5, level),
       duration_semesters = COALESCE($6, duration_semesters),
       description        = COALESCE($7, description),
       specialty_name     = COALESCE($8, specialty_name),
       education_level    = COALESCE($9, education_level),
       profile            = COALESCE($10, profile),
       forms_of_study     = COALESCE($11, forms_of_study),
       updated_at         = NOW()
     WHERE id = $1 AND institution_id = $2
     RETURNING *`,
    [id, institutionId, data.name ?? null, data.code ?? null, data.level ?? null,
     data.duration_semesters ?? null, data.description ?? null,
     data.specialty_name ?? null, data.education_level ?? null, data.profile ?? null, data.forms_of_study ?? null]
  )
  return rows[0] ? toProgram(rows[0]) : null
}

/** Store the extracted text of the uploaded интейк PDFs (for re-parsing/audit). */
export async function setProgramDocs(
  id: string, docs: { description_text?: string | null; plan_text?: string | null }
): Promise<void> {
  await pool.query(
    `UPDATE programs SET
       description_text = COALESCE($2, description_text),
       plan_text        = COALESCE($3, plan_text),
       updated_at       = NOW()
     WHERE id = $1`,
    [id, docs.description_text ?? null, docs.plan_text ?? null]
  )
}

export async function deleteProgram(id: string, institutionId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM programs WHERE id = $1 AND institution_id = $2',
    [id, institutionId]
  )
  return (rowCount ?? 0) > 0
}

// ── Bulk replaces (delete-then-insert in a transaction) ─────────────────────────

export async function replaceDisciplines(
  programId: string, disciplines: ProgramDiscipline[]
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM program_disciplines WHERE program_id = $1', [programId])
    for (const [i, d] of disciplines.entries()) {
      await client.query(
        `INSERT INTO program_disciplines
           (program_id, course_id, name, semester, credits, control_form, competency_codes, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [programId, d.course_id ?? null, d.name, d.semester, d.credits ?? null,
         d.control_form ?? null, d.competency_codes ?? [], d.sort_order ?? i]
      )
    }
    await client.query('UPDATE programs SET updated_at = NOW() WHERE id = $1', [programId])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => null)
    throw err
  } finally {
    client.release()
  }
}

export async function replaceCompetencies(
  programId: string, competencies: ProgramCompetency[]
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM program_competencies WHERE program_id = $1', [programId])
    for (const [i, c] of competencies.entries()) {
      await client.query(
        `INSERT INTO program_competencies (program_id, kind, code, title, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [programId, c.kind === 'goal' ? 'goal' : 'competency', c.code ?? null, c.title, c.sort_order ?? i]
      )
    }
    await client.query('UPDATE programs SET updated_at = NOW() WHERE id = $1', [programId])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => null)
    throw err
  } finally {
    client.release()
  }
}

// ── Cached analysis ──────────────────────────────────────────────────────────

export async function saveAnalysis(programId: string, result: ProgramAnalysis): Promise<void> {
  await pool.query(
    'INSERT INTO program_analyses (program_id, result) VALUES ($1, $2)',
    [programId, JSON.stringify(result)]
  )
}

export async function getLatestAnalysis(programId: string): Promise<ProgramAnalysis | null> {
  const { rows } = await pool.query<{ result: ProgramAnalysis }>(
    'SELECT result FROM program_analyses WHERE program_id = $1 ORDER BY created_at DESC LIMIT 1',
    [programId]
  )
  return rows[0] ? rows[0].result : null
}
