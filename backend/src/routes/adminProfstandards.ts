import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireAdmin } from '../middleware/requireRole'
import { uploadFields, verifyFileContent } from '../middleware/fileValidation'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, ValidationError } from '../errors/AppError'
import { extractText } from '../services/documentExtractor'
import { extractProfstandardDraft, type ProfstandardDraft } from '../services/profstandardExtractor'
import { fetchDocumentFromUrl } from '../services/documentFetch'
import {
  listProfstandardsPage, getProfstandardById, createProfstandardDraft, publishProfstandard, deleteProfstandard,
  type ProfstandardPayload,
} from '../db/queries/profstandards'
import { recordAudit } from '../db/queries/audit'

// Профстандарт/ОТФ registry (migration 115, методист feedback item 3).
// Mirrors routes/adminFgos.ts exactly: platform-wide reference data (a
// профстандарт is federal, identical across every institution), requireAdmin
// (platform owner) — own file for the same reason adminFgos.ts got one
// (own extraction pipeline + multipart upload).
//
// Unlike adminFgos.ts, this ships without a /discover bulk-crawl endpoint —
// fgosvo.ru's listing-page markup is known and already scraped
// (services/fgosvoParser.ts); the equivalent профстандарт catalog's markup
// isn't verified here, and a guessed parser against unconfirmed HTML would
// be a worse default than not having it. /extract (upload) and /import-one
// (single pasted document link) cover ingestion; bulk crawl-import can
// follow once a specific catalog page's structure is confirmed.

const router = Router()
router.use(authenticate)
router.use(requireAdmin)
router.use((_req, res, next) => { res.locals.selfAudited = true; next() })

function payloadFromBody(body: unknown): ProfstandardPayload {
  const b = body as Partial<ProfstandardDraft> & { standard?: ProfstandardDraft['standard'] }
  if (!b || typeof b !== 'object' || !b.standard) {
    throw new ValidationError('Некорректные данные профстандарта')
  }
  const { code, name } = b.standard
  if (!code || !name) {
    throw new ValidationError('Укажите код и наименование профстандарта')
  }
  return {
    standard: { code, name, source_url: null },
    otf: (b.otf ?? []).map((o) => ({
      otf_code:               o.otf_code,
      name:                   o.name,
      qualification_level:    o.qualification_level ?? null,
      education_requirement:  o.education_requirement ?? null,
      is_verbatim_verified:   o.is_verbatim_verified ?? false,
    })),
  }
}

// ─── List / detail ──────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  const { rows, total } = await listProfstandardsPage({
    page:   req.query.page  ? Number(req.query.page)  : undefined,
    limit:  req.query.limit ? Number(req.query.limit) : undefined,
    search: req.query.search as string | undefined,
  })
  res.json({ standards: rows, total })
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const standard = await getProfstandardById(req.params.id)
  if (!standard) throw new NotFoundError('Профстандарт')
  res.json(standard)
}))

// ─── Extract (no DB write) ──────────────────────────────────────────────────

router.post('/extract', uploadFields([{ name: 'file', maxCount: 1 }]), verifyFileContent,
  asyncHandler(async (req, res) => {
    const files = req.files as { file?: Express.Multer.File[] } | undefined
    const file = files?.file?.[0]
    if (!file) throw new ValidationError('Загрузите файл профстандарта (PDF или Word)')

    const { text } = await extractText(file.buffer, file.mimetype)
    const draft = await extractProfstandardDraft(text)
    res.json(draft)
  }))

// ─── Import one by pasted link ──────────────────────────────────────────────
// Platform-controlled allowlist, same posture as adminFgos.ts's
// FGOSVO_ALLOWED_DOMAINS (fixed, not admin-configurable — unlike the
// per-institution document_fetch_domains elsewhere in the app). The two
// official publication points for профстандарты.

const PROFSTANDARD_ALLOWED_DOMAINS = ['profstandart.rosmintrud.ru', 'fgosvo.ru']

router.post('/import-one', asyncHandler(async (req, res) => {
  const code = String(req.body.code ?? '').trim()
  const name = String(req.body.name ?? '').trim()
  const url  = String(req.body.url ?? '').trim()
  if (!code || !name || !url) {
    throw new ValidationError('Не хватает данных для импорта (код, название или ссылка на файл).')
  }

  const file = await fetchDocumentFromUrl(url, PROFSTANDARD_ALLOWED_DOMAINS)
  const { text } = await extractText(file.buffer, file.mimetype)
  const draft = await extractProfstandardDraft(text)

  const standard = await createProfstandardDraft({
    standard: { code: draft.standard.code ?? code, name: draft.standard.name ?? name, source_url: url },
    otf: draft.otf,
  }, req.teacher.id)

  recordAudit({ institutionId: null, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'profstandard.imported', target: standard.name, metadata: { standardId: standard.id, sourceUrl: url } })

  res.status(201).json(standard)
}))

// ─── Create draft / publish / delete ───────────────────────────────────────

router.post('/', asyncHandler(async (req, res) => {
  const payload = payloadFromBody(req.body)
  const standard = await createProfstandardDraft(payload, req.teacher.id)
  recordAudit({ institutionId: null, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'profstandard.draft_created', target: standard.name, metadata: { standardId: standard.id } })
  res.status(201).json(standard)
}))

router.post('/:id/publish', asyncHandler(async (req, res) => {
  const payload = payloadFromBody(req.body)
  const standard = await publishProfstandard(req.params.id, payload)
  if (!standard) throw new NotFoundError('Профстандарт')
  recordAudit({ institutionId: null, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'profstandard.published', target: standard.name, metadata: { standardId: standard.id } })
  res.json(standard)
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  const ok = await deleteProfstandard(req.params.id)
  if (!ok) throw new NotFoundError('Профстандарт')
  recordAudit({ institutionId: null, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'profstandard.deleted', target: req.params.id })
  res.status(204).end()
}))

export default router
