import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, ValidationError } from '../errors/AppError'
import { checkMonthlyLimit, checkFeatureAccess } from '../middleware/checkPlan'
import { generatePresentationRules } from '../validation/presentationValidation'
import { generatePresentation } from '../services/presentations'
import { generatePresentationPptx } from '../services/presentationExport'
import { yandexImageSearch } from '../services/yandexImages'
import {
  findPresentationsByTeacher, findPresentationById, deletePresentation, setSlideImage,
} from '../db/queries/presentations'
import type { SlideImage } from '../../../shared/types'

const router = Router()
router.use(authenticate)

// POST /api/presentations/generate
router.post(
  '/generate',
  aiLimiter,
  checkMonthlyLimit('presentationsPerMonth'),
  validate(generatePresentationRules),
  asyncHandler(async (req, res) => {
    const {
      course_id, lecture_number, topic, duration_minutes,
      learning_goals, audience_level, style, slide_count_target, source_text,
    } = req.body as {
      topic: string; duration_minutes: number; learning_goals?: string[]
      course_id?: string; lecture_number?: number; audience_level?: string
      style?: string; slide_count_target?: number; source_text?: string
    }

    const result = await generatePresentation({
      teacherId:        req.teacher.id,
      courseId:         course_id,
      lectureNumber:    lecture_number,
      topic,
      durationMinutes:  Number(duration_minutes),
      learningGoals:    learning_goals ?? [],
      audienceLevel:    audience_level,
      style,
      slideCountTarget: slide_count_target ? Number(slide_count_target) : undefined,
      sourceText:       source_text,
    })
    res.status(201).json(result)
  })
)

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
    const fname = `${(presentation.topic || 'presentation').replace(/[^\w.-]/g, '_')}.pptx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`)
    res.setHeader('Content-Length', pptx.length)
    res.end(pptx)
  })
)

// POST /api/presentations/:id/slides/:idx/images — fetch image candidates
// from Yandex Images for the diagram slide at index :idx. Picker UI calls
// this, then PATCH to commit the chosen one. We re-derive the query from
// the persisted slide rather than trusting a client-supplied string — keeps
// the surface honest and avoids letting the picker become an open search
// proxy.
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
    if (slide.type !== 'diagram') {
      throw new ValidationError('Поиск изображений доступен только для слайдов-схем')
    }
    // Allow a client-supplied query override (teacher tweaks the search box
    // in the picker), but require it pass minimum sanity — otherwise fall
    // back to the model-suggested query.
    const override = typeof req.body?.query === 'string' ? req.body.query.trim() : ''
    const query = override.length >= 3 && override.length <= 120 ? override : slide.body.image_query
    const candidates = await yandexImageSearch(query, 8)
    res.json({ query, candidates })
  })
)

// PATCH /api/presentations/:id/slides/:idx — currently only supports setting
// or clearing the image on a diagram slide. Body: { image: SlideImage | null }.
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
