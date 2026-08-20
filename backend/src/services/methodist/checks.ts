// Кабинет методиста (TODO.md Feature AM, Phase 2) — the check registry.
// Each entry is a thin adapter onto a service that already exists; running
// «полная экспертиза» costs one registry entry, not a new page. Every
// adapter persists to the SAME table the equivalent teacher/РОП-facing
// route already writes (program_document_reviews / program_placement_reviews
// / program_mto_reviews) — Кабинет методиста never forks a parallel result
// store, so a check run here shows up in the programme's own Report tab too,
// and vice versa. syllabus-review is the one exception: it has no persisted
// table anywhere in the codebase (routes/curriculum.ts's endpoint has always
// returned it inline), so its result is stored directly on the run row.

import { ValidationError, NotFoundError } from '../../errors/AppError'
import { loadReadableDiscipline, resolveProgramDisciplineText, type Teacher } from './target'
import { findWorkingProgrammeForDiscipline, findFosForDiscipline } from '../../db/queries/programDocuments'
import { insertReview } from '../../db/queries/programDocumentReviews'
import { insertPlacementReview, getLatestPlacementReviewsByProgram } from '../../db/queries/programPlacementReviews'
import { insertMtoReview, getLatestMtoReviewsByProgram } from '../../db/queries/programMtoReviews'
import { replaceDeclaredPrerequisites } from '../../db/queries/programTopology'
import { reviewDocumentCoverage } from '../documentReview'
import { reviewPlacement } from '../placementReview'
import { reviewMto } from '../mtoReview'
import { reviewSyllabus } from '../syllabusReview'
import { parseAssessmentLinkage, checkAssessmentLinkage } from '../assessmentLinkage'
import { logger } from '../../lib/logger'

export const ALL_CHECK_KEYS = ['syllabus', 'coverage', 'placement', 'mto', 'linkage'] as const
export type CheckKey = (typeof ALL_CHECK_KEYS)[number]

export interface CheckTarget { programId: string; disciplineId: string }

// A check either persists into an existing table (result_id points to that
// row — the frontend re-fetches the row's own GET endpoint to render it) or,
// for syllabus, has nowhere else to live so the result travels inline.
export interface CheckOutcome {
  key:      CheckKey
  status:   'ok' | 'error'
  result_id?: string
  result?:   unknown
  error?:    string
}

async function runSyllabusCheck(target: CheckTarget, teacher: Teacher): Promise<CheckOutcome> {
  const resolved = await resolveProgramDisciplineText(target, teacher)
  const result = await reviewSyllabus({
    teacherId: teacher.id, syllabusText: resolved.text, competencies: resolved.competencies,
  })
  return { key: 'syllabus', status: 'ok', result }
}

// «Связка оценочного средства» (методист feedback, 2026-08-20) — п.4 ↔ СРС ↔
// КСР ↔ п.9. Like syllabus-review it has no dedicated results table, so the
// result travels inline on the run row rather than inventing a table for a
// check whose output is a findings list.
async function runLinkageCheck(target: CheckTarget, teacher: Teacher): Promise<CheckOutcome> {
  const resolved = await resolveProgramDisciplineText(target, teacher)
  const parsed = await parseAssessmentLinkage(teacher.id, resolved.text)
  // Best-effort — an uploaded ФОС that fails to load must not break the rest
  // of the check; checkAssessmentLinkage treats a null/undefined fosText the
  // same as "none uploaded" (fos_available: false).
  const fos = await findFosForDiscipline(target.programId, target.disciplineId).catch(() => null)
  return { key: 'linkage', status: 'ok', result: checkAssessmentLinkage(parsed, fos?.extractedText) }
}

async function runCoverageCheck(target: CheckTarget, teacher: Teacher): Promise<CheckOutcome> {
  const { detail, discipline } = await loadReadableDiscipline(target, teacher)
  if (discipline.competency_codes.length === 0) {
    throw new ValidationError(
      'У дисциплины не указаны компетенции — заполните их в конструкторе плана перед проверкой.'
    )
  }

  const found = await findWorkingProgrammeForDiscipline(detail.id, discipline.id!)
  if (!found?.extractedText) {
    throw new ValidationError('Сначала загрузите рабочую программу для этой дисциплины.')
  }

  const competencies = detail.competencies.filter(
    (c) => c.code != null && discipline.competency_codes.includes(c.code)
  )
  if (competencies.length === 0) {
    throw new ValidationError('Заявленные коды компетенций дисциплины не найдены среди компетенций программы.')
  }

  const result = await reviewDocumentCoverage({
    teacherId:     teacher.id,
    institutionId: teacher.institution_id ?? undefined,
    documentText:  found.extractedText,
    competencies,
    label:         discipline.name,
  })

  const review = await insertReview({
    programId: detail.id, disciplineId: discipline.id!, documentId: found.document.id, result,
  })
  return { key: 'coverage', status: 'ok', result_id: review.id }
}

async function runPlacementCheck(target: CheckTarget, teacher: Teacher): Promise<CheckOutcome> {
  const { detail, discipline } = await loadReadableDiscipline(target, teacher)

  const found = await findWorkingProgrammeForDiscipline(detail.id, discipline.id!)
  if (!found?.extractedText) {
    throw new ValidationError('Сначала загрузите рабочую программу для этой дисциплины.')
  }

  const siblingReviews = (await getLatestPlacementReviewsByProgram(detail.id))
    .filter((r) => r.discipline_id !== discipline.id)

  const result = await reviewPlacement({
    teacherId:      teacher.id,
    program:        detail,
    discipline,
    allDisciplines: detail.disciplines,
    documentText:   found.extractedText,
    siblingReviews,
  })

  const review = await insertPlacementReview({
    programId: detail.id, disciplineId: discipline.id!, documentId: found.document.id, result,
  })

  // Same best-effort topology densification the equivalent programme-detail
  // route performs (routes/programs.ts) — a check run from here must behave
  // identically to one run from the programme page, not a lesser version.
  const goodEdges = result.declared
    .filter((d) => d.role === 'predecessor' && d.resolution === 'internal' && d.discipline_id)
    .map((d) => ({
      disciplineId:             discipline.id!,
      prerequisiteDisciplineId: d.discipline_id!,
      reason:                   'Указано в разделе «Место дисциплины в структуре ОП»',
      inverted:                 d.semester != null && d.semester > discipline.semester,
    }))
  await replaceDeclaredPrerequisites(detail.id, discipline.id!, goodEdges).catch((err) => {
    logger.warn({
      message: 'Could not sync declared prerequisites into topology graph (methodist run)',
      disciplineId: discipline.id, error: (err as Error).message,
    })
  })

  return { key: 'placement', status: 'ok', result_id: review.id }
}

async function runMtoCheck(target: CheckTarget, teacher: Teacher): Promise<CheckOutcome> {
  const { detail, discipline } = await loadReadableDiscipline(target, teacher)

  const found = await findWorkingProgrammeForDiscipline(detail.id, discipline.id!)
  if (!found?.extractedText) {
    throw new ValidationError('Сначала загрузите рабочую программу для этой дисциплины.')
  }

  const siblingReviews = (await getLatestMtoReviewsByProgram(detail.id))
    .filter((r) => r.discipline_id !== discipline.id)

  const result = await reviewMto({
    teacherId:      teacher.id,
    discipline,
    allDisciplines: detail.disciplines,
    documentText:   found.extractedText,
    siblingReviews,
  })

  const review = await insertMtoReview({
    programId: detail.id, disciplineId: discipline.id!, documentId: found.document.id, result,
  })
  return { key: 'mto', status: 'ok', result_id: review.id }
}

const RUNNERS: Record<CheckKey, (target: CheckTarget, teacher: Teacher) => Promise<CheckOutcome>> = {
  syllabus:  runSyllabusCheck,
  coverage:  runCoverageCheck,
  placement: runPlacementCheck,
  mto:       runMtoCheck,
  linkage:   runLinkageCheck,
}

/** Runs one check, converting any thrown error into a per-check failure
 *  outcome rather than letting it abort the whole batch — a методист running
 *  4 checks on a discipline missing competency codes should still get the
 *  other 3 results, not nothing. */
export async function runCheck(key: CheckKey, target: CheckTarget, teacher: Teacher): Promise<CheckOutcome> {
  try {
    return await RUNNERS[key](target, teacher)
  } catch (err) {
    if (err instanceof NotFoundError) throw err   // programme/discipline not found — not a per-check failure, abort the run
    return { key, status: 'error', error: (err as Error).message }
  }
}

/** Runs every requested check for one discipline. Independent per check —
 *  one failing check never blocks the others. */
export async function runChecks(
  keys: CheckKey[], target: CheckTarget, teacher: Teacher
): Promise<CheckOutcome[]> {
  return Promise.all(keys.map((key) => runCheck(key, target, teacher)))
}
