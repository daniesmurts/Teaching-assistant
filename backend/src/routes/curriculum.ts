import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, ValidationError } from '../errors/AppError'
import {
  analyzeOverlapRules, syllabusReviewRules, syllabusDraftRules, syllabusStudioSaveRules,
} from '../validation/curriculumValidation'
import { analyzeCurriculumOverlap } from '../services/curriculumAnalysis'
import { reviewSyllabus, extractDeclared, type CompetencyInput } from '../services/syllabusReview'
import { draftSyllabus, draftToText } from '../services/syllabusAuthor'
import { findCourseById } from '../db/queries/courses'
import { getLatestKnowledgeText } from '../db/queries/documents'
import { saveSyllabusStudioDraft, getSyllabusStudioDraft } from '../db/queries/syllabusStudioDrafts'
import type { SyllabusSection, SyllabusReview } from '../../../shared/types'
import { logger } from '../lib/logger'

const router = Router()
router.use(authenticate)

// Resolve a discipline's syllabus text — inline syllabus_text, else latest
// ready РПД. Exported for routes/brs.ts (Feature AE), which needs the same
// course+document resolution to extract a БРС scheme from.
export async function resolveCourseText(courseId: string, teacherId: string) {
  const course = await findCourseById(courseId, teacherId)
  if (!course) throw new NotFoundError('Дисциплина')
  let text = (course.syllabus_text ?? '').trim()
  if (text.length < 80) {
    const doc = await getLatestKnowledgeText(courseId, teacherId)
    text = [text, doc ?? ''].filter(Boolean).join('\n\n').trim()
  }
  return { course, text }
}

// POST /api/curriculum/overlap
// КНИТУ admin feature A3 — detect duplicated/overlapping topics across the
// disciplines a single student takes.
router.post(
  '/overlap',
  aiLimiter,
  validate(analyzeOverlapRules),
  asyncHandler(async (req, res) => {
    const { course_ids } = req.body as { course_ids: string[] }
    const result = await analyzeCurriculumOverlap({ teacherId: req.teacher.id, courseIds: course_ids })
    res.json(result)
  })
)

// POST /api/curriculum/syllabus-review
// КНИТУ admin feature A2 — score how well a syllabus covers the ОПК/ПК/УК
// competencies and goals. Accepts either a course_id (resolve text + auto-extract
// targets) or raw syllabus_text + targets (re-checking an edited РПД-студия draft).
router.post(
  '/syllabus-review',
  aiLimiter,
  validate(syllabusReviewRules),
  asyncHandler(async (req, res) => {
    const { course_id, syllabus_text, competencies, goals } = req.body as {
      course_id?: string; syllabus_text?: string
      competencies?: CompetencyInput[]; goals?: string[]
    }

    let text = (syllabus_text ?? '').trim()
    if (!text && course_id) text = (await resolveCourseText(course_id, req.teacher.id)).text
    if (!text) throw new ValidationError('Укажите дисциплину или текст РПД.')

    const review = await reviewSyllabus({
      teacherId: req.teacher.id, syllabusText: text, competencies, goals,
    })
    res.json(review)
  })
)

// POST /api/curriculum/syllabus-draft
// КНИТУ teacher feature T5 — «РПД-студия». Draft (or improve) syllabus content for
// target competencies + goals, then self-check coverage. When a course_id is given
// the discipline name + declared targets are seeded from its РПД.
router.post(
  '/syllabus-draft',
  aiLimiter,
  validate(syllabusDraftRules),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      course_id?: string; discipline_name?: string; level?: string
      competencies?: CompetencyInput[]; goals?: string[]
      current_content?: string; gaps?: string[]
    }

    let name = (body.discipline_name ?? '').trim()
    let competencies = body.competencies ?? []
    let goals        = body.goals ?? []

    if (body.course_id) {
      const { course, text } = await resolveCourseText(body.course_id, req.teacher.id)
      if (!name) name = course.name
      if (competencies.length === 0 && goals.length === 0) {
        const declared = await extractDeclared(req.teacher.id, text)
        competencies = declared.competencies
        goals        = declared.goals
      }
    }

    if (!name) throw new ValidationError('Укажите дисциплину.')

    const draft = await draftSyllabus({
      teacherId:      req.teacher.id,
      disciplineName: name,
      level:          body.level,
      competencies,
      goals,
      currentContent: body.current_content,
      gaps:           body.gaps,
    })

    // Self-check the freshly drafted content against the same targets.
    const review = await reviewSyllabus({
      teacherId: req.teacher.id, syllabusText: draftToText(draft), competencies, goals,
    })

    // Persist so the teacher can reopen this draft after a refresh (only
    // when tied to a real course — the raw discipline_name path has no
    // stable key to save under and isn't used by the frontend today).
    if (body.course_id) {
      await saveSyllabusStudioDraft({
        courseId:       body.course_id,
        teacherId:      req.teacher.id,
        disciplineName: name,
        sections:       draft.sections,
        competencies,
        goals,
        review,
      }).catch((err) => {
        // Never let a save failure break the generation response the
        // teacher is actively waiting on.
        logger.warn({ message: 'Could not save РПД-студия draft', courseId: body.course_id, error: (err as Error).message })
      })
    }

    res.json({ draft, review, competencies, goals })
  })
)

// GET /api/curriculum/syllabus-draft/:courseId — reload a previously saved
// РПД-студия draft (initial generation or later edits/rechecks), if any.
router.get(
  '/syllabus-draft/:courseId',
  asyncHandler(async (req, res) => {
    const saved = await getSyllabusStudioDraft(req.params.courseId, req.teacher.id)
    res.json({
      draft: saved
        ? { sections: saved.sections, competencies: saved.competencies, goals: saved.goals, review: saved.review }
        : null,
    })
  })
)

// PUT /api/curriculum/syllabus-draft — save the current client-side state
// (a teacher's freehand edits, or an updated coverage review after
// "Перепроверить покрытие") so it survives a refresh, not just the
// original AI output.
router.put(
  '/syllabus-draft',
  validate(syllabusStudioSaveRules),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      course_id: string; discipline_name: string
      sections: SyllabusSection[]; competencies?: CompetencyInput[]; goals?: string[]
      review?: SyllabusReview | null
    }
    const course = await findCourseById(body.course_id, req.teacher.id)
    if (!course) throw new NotFoundError('Дисциплина')

    await saveSyllabusStudioDraft({
      courseId:       body.course_id,
      teacherId:      req.teacher.id,
      disciplineName: body.discipline_name,
      sections:       body.sections,
      competencies:   body.competencies ?? [],
      goals:          body.goals ?? [],
      review:         body.review ?? null,
    })

    res.json({ saved: true })
  })
)

export default router
