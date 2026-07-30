import { applyTransition } from './rpdSubmissionState'
import { attachProgramDocument } from './programDocumentAttach'
import { extractText } from './documentExtractor'
import { generateSyllabusDraftDocx } from './syllabusDraftDocx'
import { reviewDocumentCoverage } from './documentReview'
import { getSyllabusStudioDraft } from '../db/queries/syllabusStudioDrafts'
import { supersedeWorkingProgrammeForDiscipline } from '../db/queries/programDocuments'
import { insertReview } from '../db/queries/programDocumentReviews'
import {
  getOrCreateSubmission, findSubmissionById, recordTransition,
} from '../db/queries/rpdSubmissions'
import { notifyForTransition } from './rpdNotifications'
import { logger } from '../lib/logger'
import { ValidationError } from '../errors/AppError'
import type { ProgramDetail, RpdSubmission, RpdSubmissionAction } from '../../../shared/types'
import type { FetchedFile } from './documentFetch'

// Orchestrator for docs/RPD-WORKFLOW.md phase 4b. The pure transition table
// lives in rpdSubmissionState.ts; this file does the I/O each transition
// implies (attach a document, run the AI coverage check, persist).

// ─── Submit / resubmit — both paths converge here (§2.1) ──────────────────

interface SubmitCommon {
  program:       ProgramDetail
  disciplineId:  string
  teacherId:     string
  institutionId?: string
}

async function finishSubmit(
  common: SubmitCommon,
  documentId: string,
  extractedText: string | null,
): Promise<RpdSubmission> {
  const discipline = common.program.disciplines.find((d) => d.id === common.disciplineId)
  if (!discipline) throw new ValidationError('Дисциплина не найдена')

  // AI coverage check runs automatically on submit — the РОП opens the
  // review queue with the report already attached (docs/RPD-WORKFLOW.md §2).
  // Best-effort: a failed check must not block the submission itself, same
  // "AI never final, and never load-bearing for the workflow" posture as
  // everywhere else — the РОП can trigger POST /disciplines/:id/review by
  // hand if this silently didn't run.
  if (extractedText && discipline.competency_codes.length > 0) {
    try {
      const competencies = common.program.competencies.filter(
        (c) => c.code != null && discipline.competency_codes.includes(c.code)
      )
      if (competencies.length > 0) {
        const result = await reviewDocumentCoverage({
          teacherId: common.teacherId, institutionId: common.institutionId,
          documentText: extractedText, competencies, label: discipline.name,
        })
        await insertReview({ programId: common.program.id, disciplineId: common.disciplineId, documentId, result })
      }
    } catch (err) {
      logger.warn({ message: 'РПД submit: AI coverage check failed, continuing without it', error: (err as Error).message })
    }
  }

  const submission = await getOrCreateSubmission(common.program.id, common.disciplineId)
  const transition = applyTransition(submission.status, 'submit')
  if (!transition) {
    // Only reachable if two submissions race — getOrCreateSubmission just
    // returned 'submitted'/'forwarded'/'approved' between our check and here.
    throw new ValidationError('Заявка уже отправлена на проверку')
  }
  const result = await recordTransition({
    submissionId: submission.id,
    toStatus: transition.status,
    returnedByStage: transition.returnedByStage,
    documentId,
    actorId: common.teacherId,
  })
  // Fire-and-forget (docs/RPD-WORKFLOW.md phase 4d) — notifying the РОП must
  // never block the teacher's own submit response.
  notifyForTransition('submit', common.disciplineId)
  return result
}

/** Path A — teacher uploads a finished file. */
export async function submitByUpload(params: SubmitCommon & { file: FetchedFile }): Promise<RpdSubmission> {
  await supersedeWorkingProgrammeForDiscipline(params.program.id, params.disciplineId)

  let extractedText: string | null = null
  try {
    extractedText = (await extractText(params.file.buffer, params.file.mimetype, {
      teacherId: params.teacherId, institutionId: params.institutionId, feature: 'document_extraction',
    })).text
  } catch (err) {
    logger.warn({ message: 'РПД submit (upload): text extraction failed', error: (err as Error).message })
  }

  const documentId = await attachProgramDocument({
    programId: params.program.id, kind: 'working_programme', practiceType: null,
    disciplineId: params.disciplineId, extractedText, file: params.file, uploadedBy: params.teacherId,
  })

  return finishSubmit(params, documentId, extractedText)
}

/** Path B — teacher submits straight from their РПД-студия draft. Renders
 *  the draft to a real .docx (so it's still a downloadable artifact like any
 *  other programme document) and uses the draft's OWN text for the AI check
 *  — never re-extracted from the rendered file, so nothing is lost to
 *  DOCX-parsing noise (docs/RPD-WORKFLOW.md §2.1's accuracy note). */
export async function submitByDraft(params: SubmitCommon & { courseId: string }): Promise<RpdSubmission> {
  const draft = await getSyllabusStudioDraft(params.courseId, params.teacherId)
  if (!draft) throw new ValidationError('Черновик РПД-студии не найден — сначала сохраните его')
  if (draft.sections.length === 0) throw new ValidationError('Черновик пуст — добавьте разделы перед отправкой')

  await supersedeWorkingProgrammeForDiscipline(params.program.id, params.disciplineId)

  const buffer = await generateSyllabusDraftDocx(draft.discipline_name, draft.sections)
  const text = draft.sections.map((s) => `${s.heading}\n${s.content}`).join('\n\n')
  const fileName = `${draft.discipline_name.replace(/[^\wа-яА-Я .-]/g, '_').slice(0, 80)}.docx`

  const documentId = await attachProgramDocument({
    programId: params.program.id, kind: 'working_programme', practiceType: null,
    disciplineId: params.disciplineId, extractedText: text,
    file: { buffer, originalname: fileName, mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: buffer.length },
    uploadedBy: params.teacherId,
  })

  return finishSubmit(params, documentId, text)
}

// ─── РОП / УМЦ actions — return, forward, approve ─────────────────────────

/**
 * Apply a non-submit transition (return/forward/approve). Authorization
 * (is this caller allowed to act on this programme/institution at all) is
 * the route's job via requireDomain/assertEdit — this only enforces that
 * the transition is legal from the submission's CURRENT state, independent
 * of who's asking.
 */
export async function transitionSubmission(
  submissionId: string,
  action:       Exclude<RpdSubmissionAction, 'submit'>,
  actorId:      string,
  comment?:     string,
): Promise<{ submission: RpdSubmission } | { error: string }> {
  const current = await findSubmissionById(submissionId)
  if (!current) return { error: 'Заявка не найдена' }

  const transition = applyTransition(current.status, action)
  if (!transition) return { error: `Действие недоступно для статуса «${current.status}»` }

  const submission = await recordTransition({
    submissionId, toStatus: transition.status, returnedByStage: transition.returnedByStage,
    actorId, comment,
  })
  // Fire-and-forget — a failed/slow notification must never affect whether
  // the РОП/УМЦ action itself succeeded.
  notifyForTransition(action, current.discipline_id, comment)
  return { submission }
}
