import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { asyncHandler } from '../lib/asyncHandler'
import { uploadConfig, verifyFileContent } from '../middleware/fileValidation'
import { ValidationError, NotFoundError } from '../errors/AppError'
import { findDisciplinesForResponsibleTeacher } from '../db/queries/programs'
import { getProgramDetail } from '../db/queries/programs'
import { findSubmissionByDiscipline, listSubmissionEvents } from '../db/queries/rpdSubmissions'
import { submitByUpload, submitByDraft } from '../services/rpdSubmissions'

// Teacher-facing view of the programme disciplines they are responsible for
// (docs/RPD-WORKFLOW.md phase 4a/4b) — the surface a teacher submits their
// РПД from.
//
// Deliberately a separate router rather than a relaxed gate on
// /api/institution/programs. That router is `requireProgramAccess`, which a
// plain teacher fails by design; widening it so one role can reach one thing
// is the same shape as the cross-domain leaks already caught twice on the
// §7.10 axis. Here the key is RESPONSIBILITY, not a subtree grant: every row
// returned/acted on is filtered by `responsible_teacher_id = <the caller>`,
// so there is no programme id, unit id, or scope the caller could supply to
// widen it.
//
// No plan gate — authoring the РПД you are responsible for is part of the
// job, not a paid feature.
const router = Router()
router.use(authenticate)

/** Loads the programme + asserts the caller is genuinely the discipline's
 *  responsible teacher — the authorization check every mutating route below
 *  needs, expressed once. Also returns the discipline's own linked
 *  `course_id` (submit-from-draft uses THIS, never a client-supplied one —
 *  otherwise a teacher responsible for discipline A could submit discipline
 *  B's course draft against A just by passing a different courseId). */
async function loadOwnDiscipline(req: import('express').Request, disciplineId: string) {
  const rows = await findDisciplinesForResponsibleTeacher(req.teacher.id)
  const row = rows.find((r) => r.discipline_id === disciplineId)
  if (!row) throw new NotFoundError('Дисциплина (или вы не назначены ответственным за неё)')
  const detail = await getProgramDetail(row.program_id, req.teacher.institution_id!)
  if (!detail) throw new NotFoundError('Программа')
  return { program: detail, courseId: row.course_id }
}

// GET /api/my-syllabi
router.get('/', asyncHandler(async (req, res) => {
  res.json(await findDisciplinesForResponsibleTeacher(req.teacher.id))
}))

// GET /api/my-syllabi/:disciplineId/submission — current state + event log,
// so the teacher sees why something was returned and what happens next.
router.get('/:disciplineId/submission', asyncHandler(async (req, res) => {
  await loadOwnDiscipline(req, req.params.disciplineId)   // authorization only
  const submission = await findSubmissionByDiscipline(req.params.disciplineId)
  if (!submission) { res.json({ status: 'draft', events: [] }); return }
  const events = await listSubmissionEvents(submission.id)
  res.json({ ...submission, events })
}))

// POST /api/my-syllabi/:disciplineId/submit — path A, a finished file.
router.post(
  '/:disciplineId/submit',
  uploadConfig.single('file'),
  verifyFileContent,
  asyncHandler(async (req, res) => {
    const { program } = await loadOwnDiscipline(req, req.params.disciplineId)
    if (!req.file) throw new ValidationError('Файл не передан')

    const submission = await submitByUpload({
      program, disciplineId: req.params.disciplineId, teacherId: req.teacher.id,
      institutionId: req.teacher.institution_id ?? undefined, file: req.file,
    })
    res.status(201).json(submission)
  })
)

// POST /api/my-syllabi/:disciplineId/submit-from-draft — path B, straight
// from the teacher's own РПД-студия draft for this discipline's linked course.
router.post('/:disciplineId/submit-from-draft', asyncHandler(async (req, res) => {
  const { program, courseId } = await loadOwnDiscipline(req, req.params.disciplineId)
  if (!courseId) {
    throw new ValidationError('У дисциплины не привязан предмет с черновиком РПД-студии — сдайте файлом')
  }

  const submission = await submitByDraft({
    program, disciplineId: req.params.disciplineId, teacherId: req.teacher.id,
    institutionId: req.teacher.institution_id ?? undefined, courseId,
  })
  res.status(201).json(submission)
}))

export default router
