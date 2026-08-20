// Кабинет методиста (TODO.md Feature AM) — target resolution for checks that
// used to only work when the caller owned a `courses` row.
//
// `resolveCourseText` (routes/curriculum.ts) keys everything off
// `courses.teacher_id`, so a методист/УМУ role — which owns no courses —
// could never run the richer teacher-side checks (syllabus-review's §5-§8
// evidence report) on a discipline that lives inside a programme they have
// real access to. This resolves the same {text, declared competencies} shape
// straight from `program_documents` + `program_disciplines`, gated on
// `getProgramAccessScope` (the same read check `/api/institution/programs`
// already uses) instead of course ownership.

import { NotFoundError, ValidationError, ForbiddenError } from '../../errors/AppError'
import { getProgramDetail } from '../../db/queries/programs'
import { findWorkingProgrammeForDiscipline } from '../../db/queries/programDocuments'
import { getProgramAccessScope, canReadProgram } from '../programAccess'
import type { CompetencyInput } from '../syllabusReview'

export interface ProgramDisciplineTarget {
  programId:      string
  disciplineId:   string
}

export interface ResolvedProgramDisciplineText {
  disciplineName: string
  text:           string
  competencies:   CompetencyInput[]
}

export type Teacher = { id: string; is_platform_admin: boolean; institution_id: string | null }

// Below this, an uploaded РПД has nothing useful to check — mirrors
// curriculumAnalysis.ts's MIN_CONTENT_CHARS (kept as a literal, not a shared
// import, since the two are conceptually independent thresholds that happen
// to agree today).
const MIN_TEXT_CHARS = 80

/** One round trip for the programme + access check, reused by both the
 *  single- and batch-discipline resolvers below so a multi-discipline call
 *  (overlap) doesn't refetch the same programme once per discipline. Throws
 *  ForbiddenError if the caller's programAccessScope doesn't reach it.
 *  Exported for services/methodist/checks.ts — the placement/MTO/coverage
 *  check adapters need the same programme+discipline resolution but persist
 *  to their own tables, so they can't just call resolveProgramDisciplineText. */
export async function loadReadableProgram(programId: string, teacher: Teacher) {
  if (!teacher.institution_id) throw new ValidationError('Ваш аккаунт не привязан к организации')

  const detail = await getProgramDetail(programId, teacher.institution_id)
  if (!detail) throw new NotFoundError('Учебный план')

  const scope = await getProgramAccessScope(teacher)
  if (!canReadProgram(scope, detail.org_unit_id)) {
    throw new ForbiddenError('Нет доступа к этой образовательной программе')
  }
  return detail
}

/** loadReadableProgram + discipline lookup — the other common step every
 *  per-discipline check needs. */
export async function loadReadableDiscipline(target: ProgramDisciplineTarget, teacher: Teacher) {
  const detail = await loadReadableProgram(target.programId, teacher)
  const discipline = detail.disciplines.find((d) => d.id === target.disciplineId)
  if (!discipline) throw new NotFoundError('Дисциплина')
  return { detail, discipline }
}

/** Same {text, declared competencies} shape as resolveCourseText, sourced
 *  from the programme structure instead of a personal course. */
export async function resolveProgramDisciplineText(
  target: ProgramDisciplineTarget,
  teacher: Teacher
): Promise<ResolvedProgramDisciplineText> {
  const { detail, discipline } = await loadReadableDiscipline(target, teacher)

  const found = await findWorkingProgrammeForDiscipline(detail.id, discipline.id!)
  const text = (found?.extractedText ?? '').trim()
  if (text.length < MIN_TEXT_CHARS) {
    throw new ValidationError('Сначала загрузите рабочую программу для этой дисциплины.')
  }

  const competencies = detail.competencies
    .filter((c) => c.code != null && discipline.competency_codes.includes(c.code))
    .map((c) => ({ code: c.code!, title: c.title }))

  return { disciplineName: discipline.name, text, competencies }
}

export interface ResolvedDiscipline { id: string; name: string; text: string }
export interface SkippedDiscipline  { id: string; name: string; reason: string }

/** Batch variant for checks that compare several disciplines at once
 *  (overlap analysis) — one programme fetch + one access check for the
 *  whole set, then per-discipline text resolution. Disciplines that don't
 *  exist or have no uploaded/short РПД are skipped rather than failing the
 *  whole batch, matching analyzeCurriculumOverlap's existing per-course skip
 *  behaviour. Throws only for programme-level problems (not found / no
 *  access) — never for a single discipline's missing document. */
export async function resolveProgramDisciplinesText(
  programId: string,
  disciplineIds: string[],
  teacher: Teacher
): Promise<{ resolved: ResolvedDiscipline[]; skipped: SkippedDiscipline[] }> {
  const detail = await loadReadableProgram(programId, teacher)

  const resolved: ResolvedDiscipline[] = []
  const skipped:  SkippedDiscipline[]  = []

  for (const disciplineId of disciplineIds) {
    const discipline = detail.disciplines.find((d) => d.id === disciplineId)
    if (!discipline) {
      skipped.push({ id: disciplineId, name: '—', reason: 'Дисциплина не найдена' })
      continue
    }

    const found = await findWorkingProgrammeForDiscipline(detail.id, discipline.id!)
    const text = (found?.extractedText ?? '').trim()
    if (text.length < MIN_TEXT_CHARS) {
      skipped.push({
        id: disciplineId, name: discipline.name,
        reason: 'Нет содержания для анализа — загрузите рабочую программу',
      })
      continue
    }

    resolved.push({ id: discipline.id!, name: discipline.name, text })
  }

  return { resolved, skipped }
}
