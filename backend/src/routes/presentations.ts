import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { uploadFields, verifyFileContent } from '../middleware/fileValidation'
import { asyncHandler } from '../lib/asyncHandler'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors/AppError'
import { checkMonthlyLimit, checkFeatureAccess } from '../middleware/checkPlan'
import { canUseFeature } from '../config/planLimits'
import {
  generatePresentationRules, confirmOutlineRules, regenerateSlideRules, insertSlideRules,
  deckQuizRules,
} from '../validation/presentationValidation'
import {
  generatePresentation, getSlideImageQuery, normaliseEditedOutline, normaliseEditedSlide,
  regenerateSlide, applySlideMove, renderSlidesAsText, renderSlidesForQuiz,
  buildAssignmentFromDeck, slidesMissingNotes, paramsFromPresentation, type GenerateParams,
} from '../services/presentations'
import { createPublishedAssignment, findAssignmentByPresentation } from '../db/queries/publishedAssignments'
import { generateQuiz, assertQuizQuota } from '../services/quizzes'
import { findQuizzesByPresentation } from '../db/queries/quizzes'
import { generatePresentationPptx } from '../services/presentationExport'
import { generatePresentationHandoutPdf } from '../services/presentationHandoutPdf'
import { findTeacherById } from '../db/queries/teachers'
import { extractText } from '../services/documentExtractor'
import { importPptx } from '../services/pptxImport'
import { yandexImageSearch } from '../services/yandexImages'
import { PRESENTATION_JOB_QUEUE, type PresentationJobPayload } from '../services/presentationJobWorker'
import { getJobQueue } from '../services/jobQueue'
import { teacherCanActOnUnit } from '../db/queries/orgUnits'
import { pool } from '../db/connection'
import {
  createPresentationJob, getPresentationJobById, confirmPresentationJobOutline,
  type PresentationJobRow,
} from '../db/queries/presentationJobs'
import {
  findPresentationsByTeacher, findPresentationById, createPresentation, deletePresentation, setSlideImage,
  replaceSlides, findPresentationGenerationInputs, setPresentationApproved,
  setPresentationScope, findPresentationByIdUnscoped, findSharedPresentations,
} from '../db/queries/presentations'
import {
  recordSlideEvent, findSlideEventsForPresentation,
} from '../db/queries/presentationSlideEvents'
import type { Presentation, Slide } from '../../../shared/types'
import { MAX_SLIDE_COUNT, type LectureTopic, type SlideImage } from '../../../shared/types'
import { findLectureTopicById } from '../db/queries/lectureTopics'

const router = Router()
router.use(authenticate)

function buildGenerateParams(
  req: { teacher: { id: string; plan_tier: string; institution_id: string | null }; body: unknown },
  lectureTopic?: LectureTopic | null,
): GenerateParams {
  const {
    course_id, lecture_number, topic, duration_minutes,
    learning_goals, audience_level, style, slide_count_target, source_text, strict_source, depth,
  } = req.body as {
    topic: string; duration_minutes: number; learning_goals?: string[]
    course_id?: string; lecture_number?: number; audience_level?: string
    style?: string; slide_count_target?: number; source_text?: string
    strict_source?: boolean
    depth?: 'standard' | 'deep'
  }

  return {
    teacherId:        req.teacher.id,
    institutionId:    req.teacher.institution_id ?? undefined,
    courseId:         course_id,
    // A тема picked from the тематический план supplies both the topic text
    // and the lecture number, but neither overrides what the teacher typed:
    // they may be building lecture 4 out of order, or wording the title
    // differently from the programme.
    lectureNumber:    lecture_number ?? lectureTopic?.position,
    topic:            topic?.trim() || lectureTopic?.title || topic,
    durationMinutes:  Number(duration_minutes),
    learningGoals:    learning_goals ?? [],
    audienceLevel:    audience_level,
    style,
    slideCountTarget: slide_count_target ? Number(slide_count_target) : undefined,
    sourceText:       source_text,
    strictSource:     Boolean(strict_source),
    // Silent downgrade rather than a 403 — same convention as grading.ts's
    // thorough/checkCitations gating — a free-tier teacher who somehow
    // submits depth=deep just gets the standard depth instead of an error.
    depth: depth === 'deep' && canUseFeature(req.teacher.plan_tier, 'presentationDeepMode') ? 'deep' : 'standard',
    lectureTopicId:          lectureTopic?.id,
    lectureTopicDescription: lectureTopic?.description ?? undefined,
    // Style exemplars from the teacher's own approved decks ride the same
    // plan flag as grading's flywheel — it is the same mechanism, pointed at
    // style rather than scores.
    styleExemplars:          canUseFeature(req.teacher.plan_tier, 'ragFlywheel'),
  }
}

// Resolves the тематический план тема the request names, if any. Owner-scoped
// like everything else here — an id from another teacher's course simply
// doesn't resolve, and generation proceeds on the typed topic.
async function resolveLectureTopic(req: { teacher: { id: string }; body: unknown }): Promise<LectureTopic | null> {
  const id = (req.body as { lecture_topic_id?: unknown })?.lecture_topic_id
  if (typeof id !== 'string' || !id) return null
  return findLectureTopicById(id, req.teacher.id)
}

// POST /api/presentations/generate-jobs — async generation (the current
// client path). Generation can run multiple LLM calls (Phase 1 outline +
// per-slide expansion) and nothing should hold an HTTP socket open for that
// long at volume — same reasoning as grading's /grade-jobs. Plan gates and
// quota are checked here; the pg-boss worker (presentationJobWorker.ts) runs
// the generation itself, and the client polls GET /generate-jobs/:id. With
// the outline gate on (the default), that worker stops after the plan and
// the client resumes via POST /generate-jobs/:id/outline below.
router.post(
  '/generate-jobs',
  aiLimiter,
  checkMonthlyLimit('presentationsPerMonth'),
  validate(generatePresentationRules),
  asyncHandler(async (req, res) => {
    const params = buildGenerateParams(req, await resolveLectureTopic(req))

    // Outline approval gate (TODO.md "### AO" Phase 0) — opt-out, not
    // opt-in: reviewing the plan is the better default (it's where a wrong
    // structure is cheap to fix), but a teacher who trusts the generator
    // shouldn't be made to click through a step they don't want.
    const stage = req.body?.review_outline === false ? 'full' : 'outline'

    const job = await createPresentationJob(req.teacher.id, params)
    const payload: PresentationJobPayload = { jobId: job.id, params, stage }
    await getJobQueue().send(PRESENTATION_JOB_QUEUE, payload)

    res.status(202).json(toJobResponse(job))
  })
)

// POST /api/presentations/generate-jobs/:id/outline — teacher confirms (or
// replaces) the proposed plan, which enqueues the expensive half. No
// checkMonthlyLimit here: this is the second half of a generation whose
// quota was already checked at enqueue, and usage is billed once, when the
// deck is actually created (services/presentations.ts's expandPresentation).
router.post(
  '/generate-jobs/:id/outline',
  aiLimiter,
  validate(confirmOutlineRules),
  asyncHandler(async (req, res) => {
    const job = await getPresentationJobById(req.params.id, req.teacher.id)
    if (!job) throw new NotFoundError('Генерация')
    if (job.status !== 'outline_ready') {
      throw new ValidationError(
        job.status === 'failed'
          ? (job.error_message ?? 'Эта генерация уже завершилась ошибкой')
          : 'Этот план уже подтверждён'
      )
    }
    if (!job.params) throw new ValidationError('Параметры генерации утеряны — создайте презентацию заново')

    const outline = normaliseEditedOutline(req.body?.outline)
    if (!outline) throw new ValidationError('План пуст — оставьте хотя бы один слайд с заголовком')

    // Conditional UPDATE, not a read-then-write: two «Продолжить» clicks
    // racing would otherwise enqueue two expansions of one job — two decks,
    // two bills.
    const claimed = await confirmPresentationJobOutline(job.id, req.teacher.id, outline)
    if (!claimed) throw new ValidationError('Этот план уже подтверждён')

    const payload: PresentationJobPayload = { jobId: job.id, params: job.params, stage: 'expand' }
    await getJobQueue().send(PRESENTATION_JOB_QUEUE, payload)

    res.status(202).json(toJobResponse({ ...job, status: 'processing', outline }))
  })
)

// GET /api/presentations/generate-jobs/:id — poll job status / fetch the
// finished deck.
router.get(
  '/generate-jobs/:id',
  asyncHandler(async (req, res) => {
    const job = await getPresentationJobById(req.params.id, req.teacher.id)
    if (!job) throw new NotFoundError('Генерация')
    res.json(toJobResponse(job))
  })
)

// `params` and `web_grounding` are deliberately not exposed — internal
// generation state, and params is a verbatim copy of what the client already
// sent.
function toJobResponse(job: PresentationJobRow) {
  return {
    id:              job.id,
    status:          job.status,
    presentation_id: job.presentation_id,
    result:          job.result,
    outline:         job.outline,
    error_message:   job.error_message,
    created_at:      job.created_at,
  }
}

// POST /api/presentations/generate — legacy synchronous path. Kept only so
// cached frontend bundles from before the async rollout keep working; the
// current client posts to /generate-jobs. Remove after a deploy cycle or two.
router.post(
  '/generate',
  aiLimiter,
  checkMonthlyLimit('presentationsPerMonth'),
  validate(generatePresentationRules),
  asyncHandler(async (req, res) => {
    const result = await generatePresentation(buildGenerateParams(req, await resolveLectureTopic(req)))
    res.status(201).json(result)
  })
)

// Matches the frontend textarea's maxLength (PresentationForm.tsx's "Свой
// конспект" field) — capped here too so a huge upload can't silently blow
// past what the field (and the generation prompt) actually uses.
const SOURCE_TEXT_MAX_CHARS = 20_000

// POST /api/presentations/extract-text — reads text out of an uploaded
// PDF/Word/image so a teacher can attach a conspectus as a file instead of
// pasting it into the "Свой конспект" field. Paste alone can't carry a Word
// equation object — the clipboard has no plain-text form for it, so it just
// vanishes — while a .docx upload goes through documentExtractor.ts's DOCX
// path, which (via services/ommlToLatex.ts) recovers those formulas as
// LaTeX instead. No DB write — same "extract, don't persist" shape as
// adminFgos.ts's /extract.
router.post('/extract-text',
  checkFeatureAccess('documentUpload'),
  aiLimiter,
  uploadFields([{ name: 'file', maxCount: 1 }]),
  verifyFileContent,
  asyncHandler(async (req, res) => {
    const files = req.files as { file?: Express.Multer.File[] } | undefined
    const file = files?.file?.[0]
    if (!file) throw new ValidationError('Загрузите файл конспекта (PDF, Word или изображение)')

    const { text } = await extractText(file.buffer, file.mimetype, {
      teacherId: req.teacher.id, institutionId: req.teacher.institution_id ?? undefined,
      feature: 'document_extraction',
    })
    // Scanned pages and screenshot-built documents already go through OCR in
    // documentExtractor.ts, so reaching here means even that recovered
    // nothing — say so, rather than letting the teacher generate a deck with
    // no material behind it (which is how a presentation ends up written from
    // the topic string alone).
    if (!text.trim()) {
      throw new ValidationError(
        'Не удалось извлечь текст из файла. Если это скан или скриншоты, попробуйте файл лучшего качества, ' +
        'другой формат или вставьте текст вручную.'
      )
    }

    const truncated = text.length > SOURCE_TEXT_MAX_CHARS
    res.json({ text: text.slice(0, SOURCE_TEXT_MAX_CHARS), truncated })
  }))

// GET /api/presentations
router.get('/', asyncHandler(async (req, res) => {
  const courseId = req.query.course_id as string | undefined
  res.json(await findPresentationsByTeacher(req.teacher.id, courseId))
}))

// GET /api/presentations/shared — the кафедра bank: decks colleagues have
// shared to a unit on this teacher's own path. Read-only; opening one uses the
// same viewer, and it is what makes the shared pool visible rather than an
// invisible influence on generation.
router.get('/shared',
  asyncHandler(async (req, res) => {
    res.json(await findSharedPresentations(req.teacher.id))
  })
)

// GET /api/presentations/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const p = await findPresentationById(req.params.id, req.teacher.id)
  if (!p) throw new NotFoundError('Презентация')
  res.json(p)
}))

// DELETE /api/presentations/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const deleted = await deletePresentation(req.params.id, req.teacher.id)
  if (!deleted) throw new NotFoundError('Презентация')
  res.status(204).send()
}))

// GET /api/presentations/:id/export.pptx — real, editable PowerPoint download
// (TODO.md Feature D). Gated separately from generation itself — a free-tier
// teacher can still generate and copy-paste slides; the native .pptx file is
// the Pro differentiator.
router.get('/:id/export.pptx',
  checkFeatureAccess('pptxExport'),
  asyncHandler(async (req, res) => {
    const presentation = await findPresentationById(req.params.id, req.teacher.id)
    if (!presentation) throw new NotFoundError('Презентация')
    if (!presentation.slides || presentation.slides.length === 0) {
      throw new ValidationError('Эта презентация ещё в старом текстовом формате и не может быть экспортирована в PPTX — сгенерируйте новую.')
    }

    const pptx = await generatePresentationPptx(presentation)
    // presentation.topic is normally Cyrillic — `\w` only matches ASCII, so
    // a plain regex sanitiser turns the whole topic into underscores (grows
    // with the topic's length, which is exactly the "filename is just a
    // series of underscores" bug a teacher hit). Use an ASCII-safe fallback
    // name plus the RFC 5987 `filename*` param for the real UTF-8 name,
    // matching the pattern already used for program document downloads
    // (routes/programs.ts's `/documents/:docId/download`).
    const fname = `${(presentation.topic || 'presentation').trim()}.pptx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    res.setHeader('Content-Disposition', `attachment; filename="presentation.pptx"; filename*=UTF-8''${encodeURIComponent(fname)}`)
    res.setHeader('Content-Length', pptx.length)
    res.end(pptx)
  })
)

// POST /api/presentations/:id/slides/:idx/images — fetch image candidates
// from Yandex Images for the slide at index :idx. Picker UI calls this, then
// PATCH to commit the chosen one. Any slide type is searchable now (TODO.md
// Feature AG Phase 2 — most already carry a model-suggested query, and a
// teacher can attach an image to one that doesn't via the override below).
// We re-derive the model's own query from the persisted slide rather than
// trusting a client-supplied string as the default — keeps the surface
// honest and avoids letting the picker become an open search proxy.
router.post('/:id/slides/:idx/images',
  aiLimiter,
  asyncHandler(async (req, res) => {
    const presentation = await findPresentationById(req.params.id, req.teacher.id)
    if (!presentation) throw new NotFoundError('Презентация')
    const slides = presentation.slides ?? []
    const idx = Number(req.params.idx)
    if (!Number.isInteger(idx) || idx < 0 || idx >= slides.length) {
      throw new NotFoundError('Слайд')
    }
    const slide = slides[idx]
    // Allow a client-supplied query override (teacher tweaks the search box,
    // or adds an image to a slide the model didn't suggest one for), but
    // require it pass minimum sanity — otherwise fall back to the model-
    // suggested query, if any.
    const override = typeof req.body?.query === 'string' ? req.body.query.trim() : ''
    const query = override.length >= 3 && override.length <= 120 ? override : getSlideImageQuery(slide)
    if (!query) {
      throw new ValidationError('Для этого слайда нет запроса на изображение — введите свой')
    }
    const candidates = await yandexImageSearch(query, 8, {
      teacherId: req.teacher.id, institutionId: req.teacher.institution_id ?? undefined, feature: 'presentation',
    })
    res.json({ query, candidates })
  })
)

// PATCH /api/presentations/:id/slides/:idx — writes one slide. Two bodies,
// distinguished by which key is present:
//   { image: SlideImage | null }  — the picker (TODO.md Feature AG Phase 2)
//   { slide: Slide }              — a teacher-edited slide (Phase 1)
// Kept as one route because both are "replace part of slide N": splitting
// them would mean two paths racing on the same array with no shared guard.
router.patch('/:id/slides/:idx',
  asyncHandler(async (req, res) => {
    const idx = Number(req.params.idx)
    if (!Number.isInteger(idx) || idx < 0) throw new NotFoundError('Слайд')

    if (req.body && 'slide' in req.body) {
      const { presentation, slides } = await loadDeck(req.params.id, req.teacher.id, idx)

      // Same coercion boundary the model's own output crosses — a hand-typed
      // body must not be able to introduce a shape the renderers and the
      // PPTX exporter don't handle.
      const edited = normaliseEditedSlide(req.body.slide, presentation.sources ?? [])
      if (!edited) throw new ValidationError('Некорректные данные слайда')

      const next = slides.map((s, i) => (i === idx ? edited : s))
      const updated = await persistSlides(presentation, next)
      recordSlideEvent({
        presentationId: presentation.id, teacherId: req.teacher.id,
        event: 'edited', slideIndex: idx, slide: edited,
      })
      res.json(updated)
      return
    }

    // Hand-validate the inbound image shape rather than trusting whatever the
    // picker happens to send. Anything missing → 400.
    const image = parseSlideImage(req.body?.image)
    if (req.body?.image !== null && !image) {
      throw new ValidationError('Некорректные данные изображения')
    }

    const updated = await setSlideImage(req.params.id, req.teacher.id, idx, image)
    if (!updated) throw new NotFoundError('Слайд')
    res.json(updated)
  })
)

// POST /api/presentations/:id/slides/:idx/regenerate — rewrites one slide,
// optionally steered by a free-text remark. Runs inline rather than through
// pg-boss: it's a single LLM call (plus at most one retrieval), which is the
// same order of work as any other synchronous AI route here — the job queue
// exists for the ~20-call whole-deck generation.
//
// No checkMonthlyLimit: the quota counts decks, not edits. A teacher polishing
// one deck they already paid for isn't starting a new one, and aiLimiter is
// what bounds the call rate.
router.post('/:id/slides/:idx/regenerate',
  aiLimiter,
  validate(regenerateSlideRules),
  asyncHandler(async (req, res) => {
    const idx = Number(req.params.idx)
    const { presentation, slides } = await loadDeck(req.params.id, req.teacher.id, idx)

    const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : ''
    const inputs = await findPresentationGenerationInputs(presentation.id, req.teacher.id)

    const rewritten = await regenerateSlide({
      presentation,
      slideIdx:      idx,
      inputs,
      teacherId:     req.teacher.id,
      institutionId: req.teacher.institution_id ?? undefined,
      instruction:   instruction || undefined,
    })
    if (!rewritten) throw new ValidationError('Не удалось переписать слайд — попробуйте ещё раз')

    const updated = await persistSlides(presentation, slides.map((s, i) => (i === idx ? rewritten : s)))
    recordSlideEvent({
      presentationId: presentation.id, teacherId: req.teacher.id,
      event: 'regenerated', slideIndex: idx, slide: rewritten,
      instruction: instruction || null,
    })
    res.json(updated)
  })
)

// DELETE /api/presentations/:id/slides/:idx
router.delete('/:id/slides/:idx',
  asyncHandler(async (req, res) => {
    const idx = Number(req.params.idx)
    const { presentation, slides } = await loadDeck(req.params.id, req.teacher.id, idx)
    if (slides.length <= 1) throw new ValidationError('В презентации должен остаться хотя бы один слайд')

    // Logged before the write so the breadcrumb carries what was deleted —
    // after it, the slide is gone and only its index would survive.
    recordSlideEvent({
      presentationId: presentation.id, teacherId: req.teacher.id,
      event: 'deleted', slideIndex: idx, slide: slides[idx],
    })
    res.json(await persistSlides(presentation, slides.filter((_, i) => i !== idx)))
  })
)

// POST /api/presentations/:id/slides — inserts an empty slide after
// `after_index` (-1 for the very start). Empty on purpose: the teacher either
// types into it or hits «Переписать», which fills it from its type + title
// the same way every other slide was written.
router.post('/:id/slides',
  validate(insertSlideRules),
  asyncHandler(async (req, res) => {
    const presentation = await findPresentationById(req.params.id, req.teacher.id)
    if (!presentation?.slides) throw new NotFoundError('Презентация')
    const slides = presentation.slides
    if (slides.length >= MAX_SLIDE_COUNT) {
      throw new ValidationError(`В презентации не может быть больше ${MAX_SLIDE_COUNT} слайдов`)
    }

    const after = Number(req.body?.after_index)
    if (!Number.isInteger(after) || after < -1 || after >= slides.length) {
      throw new ValidationError('Некорректная позиция слайда')
    }

    const blank = normaliseEditedSlide(
      { type: req.body?.type, title: req.body?.title, notes: '', body: {} },
      presentation.sources ?? [],
    )
    if (!blank) throw new ValidationError('Не удалось создать слайд')

    const at = after + 1
    const next = [...slides.slice(0, at), blank, ...slides.slice(at)]
    const updated = await persistSlides(presentation, next)
    recordSlideEvent({
      presentationId: presentation.id, teacherId: req.teacher.id,
      event: 'inserted', slideIndex: at, slide: blank,
    })
    res.status(201).json(updated)
  })
)

// POST /api/presentations/:id/slides/move — { from, to }. A move, not a whole
// reordered array: the client sends the one thing that changed, so two
// reorders can't silently overwrite each other's other moves.
router.post('/:id/slides/move',
  asyncHandler(async (req, res) => {
    const presentation = await findPresentationById(req.params.id, req.teacher.id)
    if (!presentation?.slides) throw new NotFoundError('Презентация')

    const from = Number(req.body?.from)
    const to   = Number(req.body?.to)
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new ValidationError('Некорректная позиция слайда')

    const next = applySlideMove(presentation.slides, from, to)
    if (!next) throw new ValidationError('Некорректная позиция слайда')

    const updated = await persistSlides(presentation, next)
    recordSlideEvent({
      presentationId: presentation.id, teacherId: req.teacher.id,
      event: 'reordered', slideIndex: to, slide: presentation.slides[from],
    })
    res.json(updated)
  })
)

// POST /api/presentations/import — «Загрузить свою презентацию».
//
// The adoption lever (TODO.md "### AO" Phase 4): every prospective teacher
// already has a folder of decks, and "upload last week's lecture" is a far
// lower bar than "describe a lecture from scratch" for seeing what ИСПУМ
// does. Once imported, everything else applies to it — per-slide rewriting,
// «Проверить усвоение», раздатка, письменная работа, «Готово».
//
// No AI quota and no plan gate: this makes no model call at all (it is a zip
// and some XML), and charging a generation for reading a file the teacher
// already owns would be indefensible — as would putting the cheapest possible
// first step behind the paywall.
router.post('/import',
  uploadFields([{ name: 'file', maxCount: 1 }]),
  verifyFileContent,
  asyncHandler(async (req, res) => {
    const files = req.files as { file?: Express.Multer.File[] } | undefined
    const file = files?.file?.[0]
    if (!file) throw new ValidationError('Загрузите файл презентации (.pptx)')

    const { slides, sourceSlideCount } = await importPptx(file.buffer)
    if (slides.length === 0) {
      throw new ValidationError(
        'Не удалось прочитать эту презентацию. Поддерживается формат .pptx (PowerPoint 2007 и новее) — ' +
        'старый .ppt нужно сначала пересохранить.'
      )
    }

    // The deck's own first slide names it better than the file does
    // («Лекция_2_финал_v3.pptx»), but a title slide sometimes carries only a
    // course name, so the filename is the fallback rather than the reverse.
    const fromSlide = slides[0]?.title?.trim()
    const fromFile  = file.originalname.replace(/\.pptx$/i, '').replace(/[_-]+/g, ' ').trim()
    const topic = (fromSlide && fromSlide !== 'Без заголовка' ? fromSlide : fromFile) || 'Импортированная презентация'

    const presentation = await createPresentation({
      teacherId:        req.teacher.id,
      courseId:         typeof req.body?.course_id === 'string' && req.body.course_id ? req.body.course_id : undefined,
      topic:            topic.slice(0, 300),
      generatedContent: renderSlidesAsText(slides),
      slides,
      slideCountTarget: slides.length,
    })

    res.status(201).json({ presentation, source_slide_count: sourceSlideCount })
  })
)

// GET /api/presentations/:id/handout.pdf — раздатка, the student-facing
// companion to the deck (TODO.md "### AO" Phase 3). The PPTX is what the
// teacher projects; this is what students take away. `notes=0` drops the
// speaker notes, turning it from a ready конспект into a skeleton to take
// notes on during the lecture.
//
// Not gated behind pptxExport: that gate exists because a native .pptx is the
// editable artefact a teacher would otherwise rebuild by hand. A handout is
// for the students, and putting the thing that reaches the whole group behind
// the paid tier would be a strange place to draw the line.
router.get('/:id/handout.pdf',
  asyncHandler(async (req, res) => {
    const presentation = await findPresentationById(req.params.id, req.teacher.id)
    if (!presentation) throw new NotFoundError('Презентация')
    if (!presentation.slides || presentation.slides.length === 0) {
      throw new ValidationError('Эта презентация сохранена в старом текстовом формате — раздатку по ней собрать нельзя.')
    }

    const teacher = await findTeacherById(req.teacher.id)
    const pdf = await generatePresentationHandoutPdf(presentation, {
      includeNotes: req.query.notes !== '0',
      lecturer:     teacher?.name ?? null,
    })

    const fname = `${presentation.topic.slice(0, 60).replace(/[^\p{L}\p{N}\s-]/gu, '').trim() || 'Раздатка'}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="handout.pdf"; filename*=UTF-8''${encodeURIComponent(fname)}`)
    res.setHeader('Content-Length', pdf.length)
    res.end(pdf)
  })
)

// POST /api/presentations/:id/notes — «Написать заметки» for a deck whose
// slides have none, which is the normal state of an imported .pptx.
//
// Costs the monthly presentation quota, and says so in the UI: this is the
// same order of work as generating a deck (a sixty-slide lecture is twelve
// LLM calls), so making it free would be an easy way to get generation for
// nothing by importing an outline first. Import itself stays free — reading a
// file is not generation.
router.post('/:id/notes',
  aiLimiter,
  checkMonthlyLimit('presentationsPerMonth'),
  asyncHandler(async (req, res) => {
    const presentation = await findPresentationById(req.params.id, req.teacher.id)
    if (!presentation) throw new NotFoundError('Презентация')
    const slides = presentation.slides ?? []
    if (slides.length === 0) throw new ValidationError('В этой презентации нет слайдов')

    const missing = slidesMissingNotes(slides)
    if (missing.length === 0) {
      throw new ValidationError('У всех слайдов уже есть заметки — отдельные можно переписать кнопкой «Переписать»')
    }

    const inputs = await findPresentationGenerationInputs(presentation.id, req.teacher.id)
    const params = paramsFromPresentation(presentation, inputs, req.teacher.id, req.teacher.institution_id ?? undefined)

    const job = await createPresentationJob(req.teacher.id, params)
    await getJobQueue().send(PRESENTATION_JOB_QUEUE, {
      jobId: job.id, params, stage: 'notes', presentationId: presentation.id,
    } satisfies PresentationJobPayload)

    res.status(202).json({ ...toJobResponse(job), slides_missing_notes: missing.length })
  })
)

// POST /api/presentations/:id/quiz — «Проверить усвоение»: a test generated
// from this lecture's own slides and speaker notes (TODO.md "### AO" Phase 3).
//
// The deck, the test and the in-hall live session existed as three features
// that never touched: a teacher generated a lecture, then re-described the
// same material by hand on the Тесты page. This is the link — and because the
// quiz it produces is an ordinary quiz row, «Запустить в аудитории» (Feature
// Y) works on it with no further plumbing.
//
// Quota is the *quiz* quota, deliberately: a test generated from a deck is
// still a test, and reaching it from another page must not route around the
// limit the Тесты form enforces.
router.post('/:id/quiz',
  aiLimiter,
  validate(deckQuizRules),
  asyncHandler(async (req, res) => {
    const presentation = await findPresentationById(req.params.id, req.teacher.id)
    if (!presentation) throw new NotFoundError('Презентация')
    const slides = presentation.slides ?? []
    if (slides.length === 0) {
      throw new ValidationError('Эта презентация сохранена в старом формате — создайте тест на странице «Тесты»')
    }

    await assertQuizQuota(req.teacher.id, req.teacher.plan_tier)

    const { quiz } = await generateQuiz({
      teacherId:      req.teacher.id,
      courseId:       presentation.course_id ?? undefined,
      presentationId: presentation.id,
      topic:          presentation.topic,
      questionCount:  Number(req.body?.question_count ?? 8),
      level:          req.body?.level || undefined,
      sourceText:     renderSlidesForQuiz(slides),
    })

    res.status(201).json(quiz)
  })
)

// POST /api/presentations/:id/assignment — turns the deck's discussion slides
// into a published written assignment (TODO.md "### AO" Phase 3). No LLM call:
// the questions were already written for this lecture, so this is a rendering.
// Creates the assignment in its draft state and hands back the id — the
// teacher continues on the existing PublishedAssignmentDetail page to add
// students, set a deadline and publish, which is where all of that already
// lives.
router.post('/:id/assignment',
  asyncHandler(async (req, res) => {
    const presentation = await findPresentationById(req.params.id, req.teacher.id)
    if (!presentation) throw new NotFoundError('Презентация')

    const draft = buildAssignmentFromDeck(presentation)
    if (!draft) {
      throw new ValidationError(
        'В этой лекции нет слайдов с вопросами для обсуждения — добавьте слайд типа «Обсуждение» или создайте задание вручную.'
      )
    }

    // A second click hands back the draft made the first time rather than
    // making another — the same trap migration 120 closed for tests. The
    // teacher's edits to that draft are the reason: regenerating over them
    // would be worse than doing nothing.
    const existing = await findAssignmentByPresentation(presentation.id, req.teacher.id)
    if (existing) {
      res.json({ ...existing, already_existed: true })
      return
    }

    const assignment = await createPublishedAssignment({
      teacherId:      req.teacher.id,
      courseId:       presentation.course_id ?? null,
      presentationId: presentation.id,
      title:          draft.title,
      instructions:   draft.instructions,
    })
    res.status(201).json(assignment)
  })
)

// GET /api/presentations/:id/quizzes — tests already generated from this deck,
// so the view can offer to run one instead of silently making a second copy.
router.get('/:id/quizzes',
  asyncHandler(async (req, res) => {
    const presentation = await findPresentationById(req.params.id, req.teacher.id)
    if (!presentation) throw new NotFoundError('Презентация')
    res.json(await findQuizzesByPresentation(presentation.id, req.teacher.id))
  })
)

// POST /api/presentations/:id/approve — «Готово» (TODO.md "### AO" Phase 2).
// Body: { approved: boolean }.
//
// This is the consent gate for the flywheel, and the same rule grading has
// followed since day one (CLAUDE.md invariant 3): model output is never a
// training signal until a teacher has reviewed it. Only an approved deck's
// slides are ever shown to a later generation as style references — and only
// ever to the teacher who approved them (see findApprovedExemplarSlides).
//
// Not plan-gated: a teacher on any tier should be able to say "this one came
// out right". Whether their approved decks then *feed* generation is the
// gated part, checked at generation time.
router.post('/:id/approve',
  asyncHandler(async (req, res) => {
    const approved = req.body?.approved !== false
    const updated = await setPresentationApproved(req.params.id, req.teacher.id, approved)
    if (!updated) throw new NotFoundError('Презентация')
    res.json(updated)
  })
)

// PATCH /api/presentations/:id/scope — кафедральный банк лекций.
//
// Deliberately the same gate documents use for the same act (routes/documents.ts's
// PATCH /:id/scope): sharing to a unit needs `umu`/edit on that unit, because
// the consequence is the same class of thing — one teacher's material reaching
// another teacher's LLM prompt. A plain teacher marks their deck «Готово»
// (their own signal, their own decks); a методист with the УМУ grant decides
// what the кафедра as a whole learns from. That is exactly the curation
// workflow AM's Кабинет методиста exists for.
//
// Demotion back to 'private' needs no grant — narrowing visibility is always
// allowed, and the deck's own author must be able to take it back.
//
// No 'institution' rung, unlike documents: for reference material an
// institution-wide pool is meaningful, for *teaching style* it is not, and a
// wider blast radius for cross-teacher prompt content buys nothing.
router.patch('/:id/scope',
  asyncHandler(async (req, res) => {
    const presentation = await findPresentationByIdUnscoped(req.params.id)
    if (!presentation) throw new NotFoundError('Презентация')

    const target = req.body?.visibility_scope === 'unit' ? 'unit' : 'private'

    if (target === 'private') {
      if (presentation.teacher_id !== req.teacher.id) {
        // A методист who promoted someone else's deck can also take it back:
        // they hold the grant on the unit it was shared to.
        const allowed = presentation.scope_unit_id
          ? await teacherCanActOnUnit(req.teacher.id, presentation.scope_unit_id, ['edit', 'admin'], 'umu')
          : false
        if (!allowed) throw new ForbiddenError('Недостаточно прав для изменения области видимости')
      }
      res.json(await setPresentationScope(presentation.id, 'private', null))
      return
    }

    if (!presentation.approved_at) {
      // The кафедра bank is a curated shelf, not a dumping ground: a deck
      // nobody has vouched for has no business being the reference another
      // teacher's lecture is written against.
      throw new ValidationError('Сначала отметьте лекцию «Готово» — в банк кафедры попадают только готовые лекции')
    }

    const { rows } = await pool.query<{ primary_org_unit_id: string | null }>(
      'SELECT primary_org_unit_id FROM teachers WHERE id = $1', [req.teacher.id]
    )
    const targetUnitId = (typeof req.body?.scope_unit_id === 'string' && req.body.scope_unit_id)
      || rows[0]?.primary_org_unit_id
    if (!targetUnitId) throw new ValidationError('Укажите подразделение — у вас не задана основная кафедра')

    const allowed = await teacherCanActOnUnit(req.teacher.id, targetUnitId, ['edit', 'admin'], 'umu')
    if (!allowed) throw new ForbiddenError('Недостаточно прав на это подразделение (нужен домен УМУ)')

    res.json(await setPresentationScope(presentation.id, 'unit', targetUnitId))
  })
)

// GET /api/presentations/:id/slide-events — which slides this teacher has
// touched, for the «изменён»/«переписан» marks in the viewer.
router.get('/:id/slide-events',
  asyncHandler(async (req, res) => {
    const presentation = await findPresentationById(req.params.id, req.teacher.id)
    if (!presentation) throw new NotFoundError('Презентация')
    res.json(await findSlideEventsForPresentation(presentation.id, req.teacher.id))
  })
)

// ─── Slide-mutation helpers ─────────────────────────────────────────────────

async function loadDeck(
  id: string, teacherId: string, idx: number,
): Promise<{ presentation: Presentation; slides: Slide[] }> {
  const presentation = await findPresentationById(id, teacherId)
  if (!presentation) throw new NotFoundError('Презентация')
  const slides = presentation.slides ?? []
  // A legacy text-DSL deck has no `slides` array to edit — the viewer renders
  // those from parsed text and offers no edit controls, so reaching here means
  // a hand-made request, not a UI path.
  if (slides.length === 0) throw new ValidationError('Эта презентация сохранена в старом формате и не поддерживает правку слайдов')
  if (!Number.isInteger(idx) || idx < 0 || idx >= slides.length) throw new NotFoundError('Слайд')
  return { presentation, slides }
}

// `generated_content` is derived from the slides (it backs copy-all and the
// legacy text renderer), so every structural write refreshes it — otherwise
// the copied text drifts away from the deck on screen.
async function persistSlides(presentation: Presentation, slides: Slide[]): Promise<Presentation> {
  const updated = await replaceSlides(
    presentation.id, presentation.teacher_id, slides, renderSlidesAsText(slides),
  )
  if (!updated) throw new NotFoundError('Презентация')
  return updated
}

function parseSlideImage(input: unknown): SlideImage | null {
  if (input === null || input === undefined) return null
  if (typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  const url        = typeof o.url        === 'string' ? o.url.trim()        : ''
  const sourceUrl  = typeof o.source_url === 'string' ? o.source_url.trim() : ''
  const thumbnail  = typeof o.thumbnail  === 'string' ? o.thumbnail.trim()  : ''
  const query      = typeof o.query      === 'string' ? o.query.trim()      : ''
  if (!/^https?:\/\//.test(url)) return null
  if (!/^https?:\/\//.test(thumbnail)) return null
  return {
    url,
    source_url:  sourceUrl,
    thumbnail,
    width:       typeof o.width  === 'number' ? o.width  : null,
    height:      typeof o.height === 'number' ? o.height : null,
    query,
    source_host: typeof o.source_host === 'string' ? o.source_host : null,
  }
}

export default router
