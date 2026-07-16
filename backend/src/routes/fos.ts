import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { checkFeatureAccess } from '../middleware/checkPlan'
import { asyncHandler } from '../lib/asyncHandler'
import { createFosRules, listFosRules, fosIdRules, updateFosRules } from '../validation/fosValidation'
import { getJobQueue } from '../services/jobQueue'
import { FOS_QUEUE } from '../services/fosWorker'
import type { RunFosParams } from '../services/fosGenerator'
import {
  createFosDocument, getFosDocumentById, listFosDocumentsForCourse, updateFosSections,
} from '../db/queries/fosDocuments'
import { findCourseById } from '../db/queries/courses'
import { generateFosReportPdf } from '../services/fosReportPdf'
import { ValidationError, NotFoundError } from '../errors/AppError'

const router = Router()
router.use(authenticate)

// POST /api/fos — kick off a ФОС generation run (async, pg-boss job).
router.post(
  '/',
  aiLimiter,
  checkFeatureAccess('fosGenerator'),
  validate(createFosRules),
  asyncHandler(async (req, res) => {
    const { course_id, topics, competencies, ticket_count } = req.body as {
      course_id: string
      topics?: string[]
      competencies?: string[]
      ticket_count?: number
    }

    const doc = await createFosDocument({ courseId: course_id, teacherId: req.teacher.id })

    const jobPayload: RunFosParams = {
      fosId:        doc.id,
      teacherId:    req.teacher.id,
      courseId:     course_id,
      topics,
      competencies,
      ticketCount:  ticket_count,
    }
    // Enqueue durably (pg-boss persists this as a Postgres row before we
    // respond) — same "survives a PM2 restart mid-run" property as long-review.
    await getJobQueue().send(FOS_QUEUE, jobPayload)

    res.status(202).json({
      id: doc.id, status: doc.status, progress_done: 0, progress_total: 0,
      sections: null, coverage: null, error_message: null,
      created_at: doc.created_at, updated_at: doc.updated_at,
    })
  })
)

// GET /api/fos/:id — poll job status / fetch the finished document.
router.get(
  '/:id',
  validate(fosIdRules),
  asyncHandler(async (req, res) => {
    const doc = await getFosDocumentById(req.params.id, req.teacher.id)
    if (!doc) return res.status(404).json({ error: 'ФОС не найден', code: 'NOT_FOUND' })
    res.json(doc)
  })
)

// GET /api/fos?course_id= — generation history for a course.
router.get(
  '/',
  validate(listFosRules),
  asyncHandler(async (req, res) => {
    const docs = await listFosDocumentsForCourse(req.query.course_id as string, req.teacher.id)
    res.json({ documents: docs })
  })
)

// PUT /api/fos/:id — persist the teacher's edits to sections.
router.put(
  '/:id',
  validate(updateFosRules),
  asyncHandler(async (req, res) => {
    const updated = await updateFosSections(req.params.id, req.teacher.id, req.body.sections)
    if (!updated) return res.status(404).json({ error: 'ФОС не найден', code: 'NOT_FOUND' })
    res.json(updated)
  })
)

// GET /api/fos/:id/export.pdf — branded PDF download.
router.get(
  '/:id/export.pdf',
  validate(fosIdRules),
  asyncHandler(async (req, res) => {
    const doc = await getFosDocumentById(req.params.id, req.teacher.id)
    if (!doc) throw new NotFoundError('ФОС')
    if (doc.status !== 'ready' || !doc.sections) throw new ValidationError('ФОС ещё не готов.')
    const course = await findCourseById(doc.course_id, req.teacher.id)

    const pdf = await generateFosReportPdf(doc, course?.name ?? 'Дисциплина')
    const fname = `fos-${(course?.name || 'document').replace(/[^\w.-]/g, '_')}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`)
    res.setHeader('Content-Length', pdf.length)
    res.end(pdf)
  })
)

export default router
