// Кабинет методиста — «Отдельный файл» (TODO Feature AM, Phase 3). Same
// per-check error-isolation contract as checks.ts's runCheck/runChecks, for
// a document that isn't attached to any programme discipline. Deliberately
// a SEPARATE module rather than a generalisation of checks.ts's
// CheckTarget-based runners: three of the four discipline-tab checks
// genuinely cannot run without real programme data, so this isn't "the same
// registry with an optional target" — it's a smaller registry with a
// smaller, honest scope.
//
// What DOES run ad-hoc, and why:
//   - syllabus (§5-8 coverage) — self-contained; parses its own targets out
//     of the document.
//   - linkage (п.4 ↔ СРС/КСР/п.9) — self-contained; there's no discipline
//     row here to attach a persisted ФОС to, so the caller may instead pass
//     the ФОС's extracted text straight through for this one run (see
//     `fosText` below) — checked exactly like an attached one would be, just
//     not saved anywhere. Omitted, it reports fos_available: false, same as
//     a real discipline with no ФОС uploaded yet.
//   - mto (§12) — the core check (classify declared software, cross-check
//     against лабораторные/практические content) only needs the document's
//     own text + a discipline NAME. The one part that needs real programme
//     data — suggesting specialised software from a content-similar SIBLING
//     discipline — receives empty arrays and silently produces nothing,
//     which is the correct behaviour for "this document has no siblings",
//     not a degraded version of the check.
//
// What does NOT run ad-hoc, and why:
//   - coverage (services/documentReview.ts's reviewDocumentCoverage) needs a
//     declared competency list sourced from program_disciplines.competency_codes
//     matched against the programme's own competencies — there is no
//     institutional competency list to check against here. Falling back to
//     "extract competencies from the document itself" would just re-run what
//     `syllabus` already does (and better — with per-section citations), so
//     offering it here would be a confusing, weaker duplicate of a check
//     that's already in the list.
//   - placement (§2 «место дисциплины в структуре ОП») compares THREE real
//     sources against each other: the real учебный план's semester order,
//     the programme header's направление/профиль, and sibling disciplines'
//     own §2 (see services/placementReview.ts's header). Without a real
//     programme none of the three exist, so there is nothing for this check
//     to compare against — not a smaller version of the check, no check at
//     all.

import { reviewSyllabus } from '../syllabusReview'
import { parseAssessmentLinkage, checkAssessmentLinkage } from '../assessmentLinkage'
import { reviewMto } from '../mtoReview'
import type { ProgramDiscipline } from '../../../../shared/types'
import type { CheckOutcome } from './checks'

export const AD_HOC_CHECK_KEYS = ['syllabus', 'linkage', 'mto'] as const
export type AdHocCheckKey = (typeof AD_HOC_CHECK_KEYS)[number]

// A discipline shape reviewMto only reads .name from in the core path
// (crossDisciplineSuggestions — the only part touching allDisciplines/
// siblingReviews — is a no-op on the empty arrays below, see mtoReview.ts).
const AD_HOC_DISCIPLINE: ProgramDiscipline = {
  course_id: null, name: 'Загруженный файл', semester: 1, credits: null,
  control_form: null, competency_codes: [], sort_order: 0,
}

export interface AdHocCheckOptions {
  // Extracted text of a ФОС uploaded alongside the main document for this
  // one run only — nothing here is persisted, so there's no discipline row
  // to attach it to (see the linkage bullet above).
  fosText?: string | null
}

async function runAdHocSyllabus(teacherId: string, text: string): Promise<CheckOutcome> {
  const result = await reviewSyllabus({ teacherId, syllabusText: text })
  return { key: 'syllabus', status: 'ok', result }
}

async function runAdHocLinkage(teacherId: string, text: string, opts: AdHocCheckOptions): Promise<CheckOutcome> {
  const parsed = await parseAssessmentLinkage(teacherId, text)
  return { key: 'linkage', status: 'ok', result: checkAssessmentLinkage(parsed, opts.fosText) }
}

async function runAdHocMto(teacherId: string, text: string): Promise<CheckOutcome> {
  const result = await reviewMto({
    teacherId, discipline: AD_HOC_DISCIPLINE, allDisciplines: [], documentText: text, siblingReviews: [],
  })
  return { key: 'mto', status: 'ok', result }
}

const RUNNERS: Record<AdHocCheckKey, (teacherId: string, text: string, opts: AdHocCheckOptions) => Promise<CheckOutcome>> = {
  syllabus: runAdHocSyllabus,
  linkage:  runAdHocLinkage,
  mto:      runAdHocMto,
}

/** Same per-check isolation as checks.ts's runCheck — a bad document (e.g.
 *  too short for one check to parse) fails only that check's outcome, never
 *  the whole batch. There's no NotFoundError case here (no target to look
 *  up), so unlike runCheck this never re-throws. */
export async function runAdHocCheck(
  key: AdHocCheckKey, teacherId: string, text: string, opts: AdHocCheckOptions = {},
): Promise<CheckOutcome> {
  try {
    return await RUNNERS[key](teacherId, text, opts)
  } catch (err) {
    return { key, status: 'error', error: (err as Error).message }
  }
}

export async function runAdHocChecks(
  keys: AdHocCheckKey[], teacherId: string, text: string, opts: AdHocCheckOptions = {},
): Promise<CheckOutcome[]> {
  return Promise.all(keys.map((key) => runAdHocCheck(key, teacherId, text, opts)))
}
