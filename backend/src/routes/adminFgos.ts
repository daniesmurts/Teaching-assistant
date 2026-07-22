import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireAdmin } from '../middleware/requireRole'
import { uploadFields, verifyFileContent } from '../middleware/fileValidation'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, ValidationError } from '../errors/AppError'
import { extractText } from '../services/documentExtractor'
import { extractFgosDraft, type FgosDraft } from '../services/fgosExtractor'
import {
  listFgosStandards, getFgosStandardById, createFgosStandardDraft, publishFgosStandard, deleteFgosStandard,
  type FgosStandardPayload,
} from '../db/queries/fgos'
import { recordAudit } from '../db/queries/audit'

// Feature AA v1 (TODO.md "### AA") — ФГОС 3++ registry. Platform-wide
// reference data (a ФГОС is federal law, identical across every
// institution), so this is requireAdmin (platform owner), never
// requireInstitutionAdmin — own file rather than growing routes/admin.ts,
// matching how orgUnits.ts/rpdMonitor.ts got their own files for the same
// reason (own extraction pipeline + multipart upload).

const router = Router()
router.use(authenticate)
router.use(requireAdmin)
router.use((_req, res, next) => { res.locals.selfAudited = true; next() })

function payloadFromBody(body: unknown): FgosStandardPayload {
  const b = body as Partial<FgosDraft> & { standard?: FgosDraft['standard'] }
  if (!b || typeof b !== 'object' || !b.standard) {
    throw new ValidationError('Некорректные данные ФГОС')
  }
  const { direction_code, level, title } = b.standard
  if (!direction_code || !level || !title) {
    throw new ValidationError('Укажите код направления, уровень и наименование')
  }
  return {
    standard: {
      direction_code, level, title,
      generation:     b.standard.generation ?? null,
      order_number:   b.standard.order_number ?? null,
      order_date:     b.standard.order_date ?? null,
      effective_date: b.standard.effective_date ?? null,
    },
    competencies:          b.competencies ?? [],
    structureRequirements: b.structureRequirements ?? [],
    profstandardRefs:      b.profstandardRefs ?? [],
  }
}

// ─── List / detail ──────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (_req, res) => {
  res.json({ standards: await listFgosStandards() })
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const standard = await getFgosStandardById(req.params.id)
  if (!standard) throw new NotFoundError('ФГОС')
  res.json(standard)
}))

// ─── Extract (no DB write) ──────────────────────────────────────────────────

router.post('/extract', uploadFields([{ name: 'file', maxCount: 1 }]), verifyFileContent,
  asyncHandler(async (req, res) => {
    const files = req.files as { file?: Express.Multer.File[] } | undefined
    const file = files?.file?.[0]
    if (!file) throw new ValidationError('Загрузите файл ФГОС (PDF или Word)')

    const { text } = await extractText(file.buffer, file.mimetype)
    const draft = await extractFgosDraft(text)
    res.json(draft)
  }))

// ─── Create draft / publish / delete ───────────────────────────────────────

router.post('/', asyncHandler(async (req, res) => {
  const payload = payloadFromBody(req.body)
  const standard = await createFgosStandardDraft(payload, req.teacher.id)
  recordAudit({ institutionId: null, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'fgos_standard.draft_created', target: standard.title, metadata: { standardId: standard.id } })
  res.status(201).json(standard)
}))

router.post('/:id/publish', asyncHandler(async (req, res) => {
  const payload = payloadFromBody(req.body)
  const standard = await publishFgosStandard(req.params.id, payload)
  if (!standard) throw new NotFoundError('ФГОС')
  recordAudit({ institutionId: null, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'fgos_standard.published', target: standard.title, metadata: { standardId: standard.id } })
  res.json(standard)
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  const ok = await deleteFgosStandard(req.params.id)
  if (!ok) throw new NotFoundError('ФГОС')
  recordAudit({ institutionId: null, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'fgos_standard.deleted', target: req.params.id })
  res.status(204).end()
}))

export default router
