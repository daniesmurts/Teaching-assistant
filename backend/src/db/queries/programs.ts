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
  // Migration 049 — link into the §7 org tree so RОП (head on the linked
  // `program` org_unit) can be scoped to their programs. NULL for legacy
  // programs; IT admin sets the link on the edit form.
  org_unit_id: string | null
  // Migration 057 — semester → credits map, as printed in the plan's own
  // Итого rows. Nullable; JSONB.
  reported_semester_totals: Record<string, number> | null
  created_at: Date
  updated_at: Date
}

function toProgram(r: ProgramRow): Program {
  // JSONB keys come back as strings; normalise to numeric semester keys so
  // callers can index by `Number` without surprises.
  const rst = r.reported_semester_totals
  const totals: Record<number, number> | undefined = rst
    ? Object.fromEntries(Object.entries(rst).map(([k, v]) => [Number(k), Number(v)]).filter(([k, v]) => Number.isFinite(k) && Number.isFinite(v)))
    : undefined
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
    org_unit_id: r.org_unit_id,
    has_description_doc: Boolean((r.description_text ?? '').trim()),
    has_plan_doc: Boolean((r.plan_text ?? '').trim()),
    reported_semester_totals: totals,
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
  // Migration 049 — link to the `program` org_unit whose head is this
  // program's РОП. Optional; NULL means no РОП scoping is possible yet.
  org_unit_id?: string | null
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
  responsible_teacher_id?: string | null
  responsible_teacher_name?: string | null
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
    responsible_teacher_id:   r.responsible_teacher_id ?? null,
    responsible_teacher_name: r.responsible_teacher_name ?? null,
  }
}

interface CompetencyRow {
  id: string
  kind: string
  code: string | null
  title: string
  sort_order: number
  profstandard_otf_id: string | null
}

interface CompetencyIndicatorRow {
  id: string
  program_competency_id: string
  code: string
  title: string
  sort_order: number
}

function toCompetency(r: CompetencyRow, indicators: CompetencyIndicatorRow[]): ProgramCompetency {
  return {
    id: r.id,
    kind: r.kind === 'goal' ? 'goal' : 'competency',
    code: r.code,
    title: r.title,
    sort_order: r.sort_order,
    profstandard_otf_id: r.profstandard_otf_id,
    indicators: indicators.map((i) => ({ id: i.id, code: i.code, title: i.title, sort_order: i.sort_order })),
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

/** Scoped listing for a РОП: only programs whose `org_unit_id` is in the
 *  caller's held program-unit set. Programs with a NULL org_unit_id are never
 *  visible in the scoped list — the IT admin must link them before an РОП can
 *  see them. */
export async function listProgramsForUnits(
  institutionId: string,
  programUnitIds: string[],
): Promise<Program[]> {
  if (programUnitIds.length === 0) return []
  const { rows } = await pool.query<ProgramRow>(
    `SELECT * FROM programs
      WHERE institution_id = $1
        AND org_unit_id = ANY($2::uuid[])
      ORDER BY created_at DESC`,
    [institutionId, programUnitIds]
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
        specialty_name, education_level, profile, forms_of_study, org_unit_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [institutionId, createdBy, data.name, data.code ?? null, data.level ?? null,
     data.duration_semesters ?? 8, data.description ?? null,
     data.specialty_name ?? null, data.education_level ?? null, data.profile ?? null, data.forms_of_study ?? null,
     data.org_unit_id ?? null]
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
      `SELECT d.id, d.course_id, d.name, d.semester, d.credits, d.control_form,
              d.competency_codes, d.sort_order, d.responsible_teacher_id,
              t.name AS responsible_teacher_name
         FROM program_disciplines d
         LEFT JOIN teachers t ON t.id = d.responsible_teacher_id
        WHERE d.program_id = $1
        ORDER BY d.semester, d.sort_order`,
      [id]
    ),
    pool.query<CompetencyRow>(
      `SELECT id, kind, code, title, sort_order, profstandard_otf_id
       FROM program_competencies WHERE program_id = $1
       ORDER BY sort_order`,
      [id]
    ),
  ])

  const competencyIds = competencies.rows.map((c) => c.id)
  const { rows: indicators } = competencyIds.length > 0
    ? await pool.query<CompetencyIndicatorRow>(
        `SELECT * FROM program_competency_indicators
          WHERE program_competency_id = ANY($1)
          ORDER BY sort_order`,
        [competencyIds]
      )
    : { rows: [] as CompetencyIndicatorRow[] }
  const indicatorsByCompetency = new Map<string, CompetencyIndicatorRow[]>()
  for (const i of indicators) {
    const list = indicatorsByCompetency.get(i.program_competency_id) ?? []
    list.push(i)
    indicatorsByCompetency.set(i.program_competency_id, list)
  }

  return {
    ...program,
    disciplines: disciplines.rows.map(toDiscipline),
    competencies: competencies.rows.map((c) => toCompetency(c, indicatorsByCompetency.get(c.id) ?? [])),
  }
}

export async function updateProgram(
  id: string,
  institutionId: string,
  data: Partial<ProgramMeta>
): Promise<Program | null> {
  // org_unit_id needs explicit CASE handling — COALESCE can't distinguish
  // "clear the link" from "don't touch" since both would pass NULL.
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
       org_unit_id        = CASE WHEN $12 THEN $13 ELSE org_unit_id END,
       updated_at         = NOW()
     WHERE id = $1 AND institution_id = $2
     RETURNING *`,
    [id, institutionId, data.name ?? null, data.code ?? null, data.level ?? null,
     data.duration_semesters ?? null, data.description ?? null,
     data.specialty_name ?? null, data.education_level ?? null, data.profile ?? null, data.forms_of_study ?? null,
     data.org_unit_id !== undefined, data.org_unit_id ?? null]
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

/** Persist the per-semester totals extracted from the plan's Итого rows so
 *  deriveLoadCheck can reconcile against them later. */
export async function setReportedSemesterTotals(
  id: string, totals: Record<number, number> | null
): Promise<void> {
  await pool.query(
    `UPDATE programs SET reported_semester_totals = $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [id, totals ? JSON.stringify(totals) : null]
  )
}

export async function deleteProgram(id: string, institutionId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM programs WHERE id = $1 AND institution_id = $2',
    [id, institutionId]
  )
  return (rowCount ?? 0) > 0
}

// ── Targeted discipline updates ─────────────────────────────────────────────────

/**
 * Sets `competency_codes` on a single discipline — used by the auto-detect
 * pass that runs after a рабочая программа is uploaded (migration 051). Only
 * touches the row if it's currently empty, so a manual entry made in the
 * конструктор is never clobbered by a later re-extract. Returns true iff the
 * row was updated.
 */
export async function fillDisciplineCompetencyCodesIfEmpty(
  disciplineId: string, codes: string[]
): Promise<boolean> {
  if (codes.length === 0) return false
  const { rowCount } = await pool.query(
    `UPDATE program_disciplines
        SET competency_codes = $2
      WHERE id = $1
        AND (competency_codes IS NULL OR cardinality(competency_codes) = 0)`,
    [disciplineId, codes]
  )
  return (rowCount ?? 0) > 0
}

// ── Bulk replaces (delete-then-insert in a transaction) ─────────────────────────

/**
 * Reconcile a programme's disciplines with the incoming list, PRESERVING the
 * ids of disciplines that already exist. This matters because uploaded РПД
 * (program_documents.discipline_id) and coverage reviews
 * (program_document_reviews.discipline_id) are ON DELETE CASCADE — a naïve
 * DELETE-all + re-INSERT regenerates every UUID and silently wipes every
 * uploaded document and review on every save/analyze. Reconciling keeps the
 * ids stable, so those links survive; only disciplines the user actually
 * removed are deleted (and their documents cascade, which is correct).
 */
export async function replaceDisciplines(
  programId: string, disciplines: ProgramDiscipline[]
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Delete disciplines the user dropped (their docs/reviews cascade — intended).
    // Incoming rows that carry an id are the ones to keep in place.
    const keepIds = disciplines.map((d) => d.id).filter((x): x is string => typeof x === 'string' && x.length > 0)
    if (keepIds.length > 0) {
      await client.query(
        `DELETE FROM program_disciplines WHERE program_id = $1 AND id <> ALL($2::uuid[])`,
        [programId, keepIds]
      )
    } else {
      await client.query('DELETE FROM program_disciplines WHERE program_id = $1', [programId])
    }

    // Upsert each incoming discipline. An existing id → UPDATE in place (id
    // preserved → document links survive); a new/absent/stale id → INSERT.
    for (const [i, d] of disciplines.entries()) {
      const sort = d.sort_order ?? i
      const vals = [d.course_id ?? null, d.name, d.semester, d.credits ?? null,
                    d.control_form ?? null, d.competency_codes ?? [], sort]
      if (d.id) {
        const upd = await client.query(
          `UPDATE program_disciplines
              SET course_id=$3, name=$4, semester=$5, credits=$6, control_form=$7, competency_codes=$8, sort_order=$9
            WHERE id=$1 AND program_id=$2`,
          [d.id, programId, ...vals]
        )
        if ((upd.rowCount ?? 0) > 0) continue   // updated in place — id (and its docs) preserved
        // id didn't match this programme (stale/foreign) — fall through to insert fresh.
      }
      await client.query(
        `INSERT INTO program_disciplines
           (program_id, course_id, name, semester, credits, control_form, competency_codes, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [programId, ...vals]
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
    // ON DELETE CASCADE on program_competency_indicators takes care of the
    // indicator rows — no separate DELETE needed for them.
    await client.query('DELETE FROM program_competencies WHERE program_id = $1', [programId])
    for (const [i, c] of competencies.entries()) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO program_competencies (program_id, kind, code, title, sort_order, profstandard_otf_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [programId, c.kind === 'goal' ? 'goal' : 'competency', c.code ?? null, c.title, c.sort_order ?? i,
         c.profstandard_otf_id ?? null]
      )
      const competencyId = rows[0].id
      for (const [j, ind] of (c.indicators ?? []).entries()) {
        await client.query(
          `INSERT INTO program_competency_indicators (program_competency_id, code, title, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [competencyId, ind.code, ind.title, ind.sort_order ?? j]
        )
      }
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

// Topology graph substrate (docs/topology-spec.md, Increment 0) — resolves
// program_competencies onto the canonical ФГОС registry (migration 099's
// fgos_competency_id column). Independent, idempotent per-row writes — no
// transaction needed, unlike replaceDisciplines/replaceCompetencies above,
// since each update is a standalone fact with no all-or-nothing requirement.
export async function setCompetencyFgosLinks(
  matches: { competencyId: string; fgosCompetencyId: string }[]
): Promise<void> {
  for (const m of matches) {
    await pool.query(
      'UPDATE program_competencies SET fgos_competency_id = $2 WHERE id = $1',
      [m.competencyId, m.fgosCompetencyId]
    )
  }
}

// ── Cached analysis ──────────────────────────────────────────────────────────

export async function saveAnalysis(programId: string, result: ProgramAnalysis): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO program_analyses (program_id, result) VALUES ($1, $2) RETURNING id',
    [programId, JSON.stringify(result)]
  )
  return rows[0]
}

export async function getLatestAnalysis(programId: string): Promise<ProgramAnalysis | null> {
  const { rows } = await pool.query<{ result: ProgramAnalysis }>(
    'SELECT result FROM program_analyses WHERE program_id = $1 ORDER BY created_at DESC LIMIT 1',
    [programId]
  )
  return rows[0] ? rows[0].result : null
}

// ── Pickable program units — for the import form and the detail linker ──────

export interface PickableProgramUnit {
  id:         string
  name:       string
  short_name: string | null
  // Lets the frontend distinguish an ОП/профиль («program») from its parent
  // Направление подготовки («program_direction») in the picker so the user
  // knows which level they're linking at.
  type_code:  'program' | 'program_direction'
  // Programme metadata (migration 055) — prefills the import form when the
  // admin recorded the ФГОС header on the unit.
  code:            string | null
  specialty_name:  string | null
  education_level: string | null
  forms_of_study:  string | null
}

const PICKABLE_COLS =
  `id, name, short_name, type_code, code, specialty_name, education_level, forms_of_study`

export async function listProgramUnitsForInstitution(institutionId: string): Promise<PickableProgramUnit[]> {
  // Both `program_direction` (Направление подготовки, the ФГОС level) and
  // `program` (ОП/профиль beneath it) are valid anchors for a programme —
  // a направление with one ОП links directly, one with several профили
  // links at the ОП children.
  const { rows } = await pool.query<PickableProgramUnit & { type_code: string }>(
    `SELECT ${PICKABLE_COLS}
       FROM org_units
      WHERE institution_id = $1 AND type_code IN ('program', 'program_direction')
      ORDER BY name`,
    [institutionId]
  )
  return rows
}

export async function listProgramUnitsByIds(ids: string[]): Promise<PickableProgramUnit[]> {
  if (ids.length === 0) return []
  const { rows } = await pool.query<PickableProgramUnit & { type_code: string }>(
    `SELECT ${PICKABLE_COLS}
       FROM org_units
      WHERE id = ANY($1::uuid[]) AND type_code IN ('program', 'program_direction')
      ORDER BY name`,
    [ids]
  )
  return rows
}

// ─── «Ответственный за дисциплину» (migration 097, docs/RPD-WORKFLOW.md) ──────

/**
 * Assign (or clear, with `null`) the teacher responsible for authoring this
 * discipline's РПД. Scoped by program_id as well as discipline id so a
 * caller authorised for programme A can't reassign programme B's discipline
 * by guessing an id.
 *
 * Deliberately its own endpoint rather than a field on replaceDisciplines:
 * re-saving the учебный план must never silently clear who owns each РПД.
 */
export async function setDisciplineResponsible(
  programId:    string,
  disciplineId: string,
  teacherId:    string | null,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE program_disciplines
        SET responsible_teacher_id = $3
      WHERE id = $1 AND program_id = $2`,
    [disciplineId, programId, teacherId]
  )
  return (rowCount ?? 0) > 0
}

export interface MySyllabusRow {
  discipline_id:    string
  discipline_name:  string
  semester:         number
  competency_codes: string[]
  course_id:        string | null
  program_id:       string
  program_name:     string
  program_code:     string | null
  has_document:     boolean
  document_uploaded_at: string | null
}

/**
 * Every discipline a teacher is responsible for, across all programmes —
 * the whole data set behind the teacher-facing `/api/my-syllabi` surface.
 *
 * This is intentionally NOT reachable through the programmes router: that
 * one is gated by requireProgramAccess, which a plain teacher fails, and
 * widening it for one role is the same class of leak already caught twice
 * on the domain axis. Responsibility — not a subtree grant — is the key.
 */
export async function findDisciplinesForResponsibleTeacher(
  teacherId: string
): Promise<MySyllabusRow[]> {
  const { rows } = await pool.query<{
    discipline_id: string; discipline_name: string; semester: number
    competency_codes: string[]; course_id: string | null
    program_id: string; program_name: string; program_code: string | null
    document_uploaded_at: Date | null
  }>(
    `SELECT d.id            AS discipline_id,
            d.name          AS discipline_name,
            d.semester,
            d.competency_codes,
            d.course_id,
            p.id            AS program_id,
            p.name          AS program_name,
            p.code          AS program_code,
            doc.uploaded_at AS document_uploaded_at
       FROM program_disciplines d
       JOIN programs p ON p.id = d.program_id
       LEFT JOIN LATERAL (
         SELECT uploaded_at FROM program_documents
          WHERE discipline_id = d.id
            AND kind = 'working_programme'
            AND superseded_at IS NULL
          LIMIT 1
       ) doc ON true
      WHERE d.responsible_teacher_id = $1
      ORDER BY p.name, d.semester, d.sort_order`,
    [teacherId]
  )
  return rows.map((r) => ({
    discipline_id:    r.discipline_id,
    discipline_name:  r.discipline_name,
    semester:         r.semester,
    competency_codes: r.competency_codes ?? [],
    course_id:        r.course_id,
    program_id:       r.program_id,
    program_name:     r.program_name,
    program_code:     r.program_code,
    has_document:     r.document_uploaded_at !== null,
    document_uploaded_at: r.document_uploaded_at ? r.document_uploaded_at.toISOString() : null,
  }))
}

export interface AssignableTeacher {
  id:    string
  name:  string | null
  email: string
}

/**
 * Lean institution-wide teacher list for the «Ответственный за дисциплину»
 * picker (docs/RPD-WORKFLOW.md phase 4a) — deliberately not
 * listInstitutionTeachers (institutions.ts), which is gated `teaching:view`
 * and returns grading-usage fields this picker doesn't need. A РОП typically
 * holds `curriculum` access without a `teaching` grant (docs/ACCESS-MATRIX.md
 * Table A), so reusing that gate would 403 exactly the caller who needs this.
 */
export async function listAssignableTeachers(institutionId: string): Promise<AssignableTeacher[]> {
  const { rows } = await pool.query<AssignableTeacher>(
    `SELECT id, name, email FROM teachers
      WHERE institution_id = $1 AND is_active = true
      ORDER BY name NULLS LAST, email`,
    [institutionId]
  )
  return rows
}

export interface DisciplineNotificationInfo {
  discipline_name:         string
  program_id:              string
  program_name:            string
  program_org_unit_id:     string | null
  responsible_teacher_id:  string | null
}

/** Lean lookup for services/rpdNotifications.ts (docs/RPD-WORKFLOW.md phase
 *  4d) — everything one transition-event email needs and nothing more. */
export async function getDisciplineNotificationInfo(disciplineId: string): Promise<DisciplineNotificationInfo | null> {
  const { rows } = await pool.query<DisciplineNotificationInfo>(
    `SELECT d.name AS discipline_name, p.id AS program_id, p.name AS program_name,
            p.org_unit_id AS program_org_unit_id, d.responsible_teacher_id
       FROM program_disciplines d
       JOIN programs p ON p.id = d.program_id
      WHERE d.id = $1`,
    [disciplineId]
  )
  return rows[0] ?? null
}
