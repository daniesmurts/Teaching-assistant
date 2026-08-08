import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { uploadFields, verifyFileContent } from '../middleware/fileValidation'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, ValidationError } from '../errors/AppError'
import { checkMonthlyLimit, checkFeatureAccess } from '../middleware/checkPlan'
import { canUseFeature } from '../config/planLimits'
import { generatePresentationRules } from '../validation/presentationValidation'
import { generatePresentation, getSlideImageQuery, type GenerateParams } from '../services/presentations'
import { generatePresentationPptx } from '../services/presentationExport'
import { extractText } from '../services/documentExtractor'
import { yandexImageSearch } from '../services/yandexImages'
import { PRESENTATION_JOB_QUEUE, type PresentationJobPayload } from '../services/presentationJobWorker'
import { getJobQueue } from '../services/jobQueue'
import {
  createPresentationJob, getPresentationJobById,
} from '../db/queries/presentationJobs'
import {
  findPresentationsByTeacher, findPresentationById, deletePresentation, setSlideImage,
} from '../db/queries/presentations'
import type { SlideImage } from '../../../shared/types'

const router = Router()
router.use(authenticate)

function buildGenerateParams(req: { teacher: { id: string; plan_tier: string; institution_id: string | null }; body: unknown }): GenerateParams {
  const {
    course_id, lecture_number, topic, duration_minutes,
    learning_goals, audience_level, style, slide_count_target, source_text, depth,
  } = req.body as {
    topic: string; duration_minutes: number; learning_goals?: string[]
    course_id?: string; lecture_number?: number; audience_level?: string
    style?: string; slide_count_target?: number; source_text?: string
    depth?: 'standard' | 'deep'
  }

  return {
    teacherId:        req.teacher.id,
    institutionId:    req.teacher.institution_id ?? undefined,
    courseId:         course_id,
    lectureNumber:    lecture_number,
    topic,
    durationMinutes:  Number(duration_minutes),
    learningGoals:    learning_goals ?? [],
    audienceLevel:    audience_level,
    style,
    slideCountTarget: slide_count_target ? Number(slide_count_target) : undefined,
    sourceText:       source_text,
    // Silent downgrade rather than a 403 — same convention as grading.ts's
    // thorough/checkCitations gating — a free-tier teacher who somehow
    // submits depth=deep just gets the standard depth instead of an error.
    depth: depth === 'deep' && canUseFeature(req.teacher.plan_tier, 'presentationDeepMode') ? 'deep' : 'standard',
  }
}

// POST /api/presentations/generate-jobs — async generation (the current
// client path). Generation can run multiple LLM calls (Phase 1 outline +
// per-slide expansion) and nothing should hold an HTTP socket open for that
// long at volume — same reasoning as grading's /grade-jobs. Plan gates and
// quota are checked here; the pg-boss worker (presentationJobWorker.ts) runs
// generatePresentation(), and the client polls GET /generate-jobs/:id.
router.post(
  '/generate-jobs',
  aiLimiter,
  checkMonthlyLimit('presentationsPerMonth'),
  validate(generatePresentationRules),
  asyncHandler(async (req, res) => {
    const params = buildGenerateParams(req)

    const job = await createPresentationJob(req.teacher.id)
    const payload: PresentationJobPayload = { jobId: job.id, params }
    await getJobQueue().send(PRESENTATION_JOB_QUEUE, payload)

    res.status(202).json({
      id:              job.id,
      status:          job.status,
      presentation_id: null,
      result:          null,
      error_message:   null,
      created_at:      job.created_at,
    })
  })
)

// GET /api/presentations/generate-jobs/:id — poll job status / fetch the
// finished deck.
router.get(
  '/generate-jobs/:id',
  asyncHandler(async (req, res) => {
    const job = await getPresentationJobById(req.params.id, req.teacher.id)
    if (!job) throw new NotFoundError('Генерация')
    res.json({
      id:              job.id,
      status:          job.status,
      presentation_id: job.presentation_id,
      result:          job.result,
      error_message:   job.error_message,
      created_at:      job.created_at,
    })
  })
)

// POST /api/presentations/generate — legacy synchronous path. Kept only so
// cached frontend bundles from before the async rollout keep working; the
// current client posts to /generate-jobs. Remove after a deploy cycle or two.
router.post(
  '/generate',
  aiLimiter,
  checkMonthlyLimit('presentationsPerMonth'),
  validate(generatePresentationRules),
  asyncHandler(async (req, res) => {
    const result = await generatePresentation(buildGenerateParams(req))
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
    if (!text.trim()) {
      throw new ValidationError('Не удалось извлечь текст из файла — попробуйте другой формат или вставьте текст вручную.')
    }

    const truncated = text.length > SOURCE_TEXT_MAX_CHARS
    res.json({ text: text.slice(0, SOURCE_TEXT_MAX_CHARS), truncated })
  }))

// GET /api/presentations
router.get('/', asyncHandler(async (req, res) => {
  const courseId = req.query.course_id as string | undefined
  res.json(await findPresentationsByTeacher(req.teacher.id, courseId))
}))

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

// PATCH /api/presentations/:id/slides/:idx — sets or clears the image on any
// slide (TODO.md Feature AG Phase 2 — setSlideImage picks the right storage
// location per slide type). Body: { image: SlideImage | null }.
router.patch('/:id/slides/:idx',
  asyncHandler(async (req, res) => {
    const idx = Number(req.params.idx)
    if (!Number.isInteger(idx) || idx < 0) throw new NotFoundError('Слайд')

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
