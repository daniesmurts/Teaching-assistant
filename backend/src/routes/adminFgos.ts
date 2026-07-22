import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireAdmin } from '../middleware/requireRole'
import { uploadFields, verifyFileContent } from '../middleware/fileValidation'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, ValidationError } from '../errors/AppError'
import { extractText } from '../services/documentExtractor'
import { extractFgosDraft, type FgosDraft } from '../services/fgosExtractor'
import { fetchPageHtml, fetchDocumentFromUrl } from '../services/documentFetch'
import { parseCategoryLinks, parsePageLevel, parseDirectionRows } from '../services/fgosvoParser'
import {
  listFgosStandards, listFgosStandardsPage, getFgosStandardById, createFgosStandardDraft, publishFgosStandard, deleteFgosStandard,
  type FgosStandardPayload,
} from '../db/queries/fgos'
import { recordAudit } from '../db/queries/audit'
import { logger } from '../lib/logger'

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

router.get('/', asyncHandler(async (req, res) => {
  const { rows, total } = await listFgosStandardsPage({
    page:   req.query.page  ? Number(req.query.page)  : undefined,
    limit:  req.query.limit ? Number(req.query.limit) : undefined,
    search: req.query.search as string | undefined,
    level:  req.query.level as string | undefined,
  })
  res.json({ standards: rows, total })
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

// ─── Bulk import from fgosvo.ru ─────────────────────────────────────────────
// fgosvo.ru is a single, fixed, platform-controlled source (unlike the
// per-institution document links elsewhere in the app) — the allowlist is
// hardcoded, not admin-configurable.

const FGOSVO_ALLOWED_DOMAINS = ['fgosvo.ru']

interface FgosvoDiscoverItem {
  code:            string | null
  name:            string | null
  level:           string | null
  pdf_url:         string
  order_date:      string | null
  category:        string
  already_imported: boolean
}

// POST /discover — two-level crawl: the top listing page (e.g.
// https://fgosvo.ru/fgosvo/index/24) links every subject-area category page,
// each of which lists individual направления with a direct PDF link. One
// paste returns a combined checklist across every category. A category page
// that fails to fetch/parse doesn't abort the whole discovery — it's
// reported in `categories_failed` so the admin can retry just that one.
router.post('/discover', asyncHandler(async (req, res) => {
  const url = String(req.body.url ?? '').trim()
  if (!url) throw new ValidationError('Вставьте ссылку на страницу списка ФГОС (fgosvo.ru).')

  const { html: topHtml, finalUrl } = await fetchPageHtml(url, FGOSVO_ALLOWED_DOMAINS)
  const categories = parseCategoryLinks(topHtml, finalUrl)
  if (categories.length === 0) {
    throw new ValidationError('На странице не найдено списка категорий. Проверьте, что это страница списка ФГОС на fgosvo.ru.')
  }
  const level = parsePageLevel(topHtml)

  const existing = await listFgosStandards()
  const existingKeys = new Set(existing.map((s) => `${s.direction_code}::${s.level}`))

  const items: FgosvoDiscoverItem[] = []
  const categoriesFailed: { title: string; url: string; error: string }[] = []

  for (const category of categories) {
    try {
      const { html: catHtml, finalUrl: catFinalUrl } = await fetchPageHtml(category.url, FGOSVO_ALLOWED_DOMAINS)
      const rows = parseDirectionRows(catHtml, catFinalUrl)
      for (const row of rows) {
        const key = row.code && level ? `${row.code}::${level}` : null
        items.push({
          code:             row.code,
          name:             row.name,
          level,
          pdf_url:          row.pdf_url,
          order_date:       row.order_date,
          category:         category.title,
          already_imported: key ? existingKeys.has(key) : false,
        })
      }
    } catch (err) {
      logger.warn({ message: 'fgosvo.ru category fetch failed', category: category.title, error: (err as Error).message })
      categoriesFailed.push({ title: category.title, url: category.url, error: (err as Error).message })
    }
  }

  res.json({
    level,
    items,
    categories_scanned: categories.length,
    categories_failed:  categoriesFailed,
  })
}))

// POST /import-one — fetch one PDF by URL, extract, and land it as a draft
// (never auto-published — rule #3). Kept single-item so a bulk run of
// hundreds of standards is many small requests, not one that could time out
// mid-way through hundreds of sequential LLM calls. No aiLimiter here,
// matching /extract above — a 30/hour cap would make bulk-importing more
// than 30 standards impossible.
router.post('/import-one', asyncHandler(async (req, res) => {
  const code  = String(req.body.code ?? '').trim()
  const name  = String(req.body.name ?? '').trim()
  const level = String(req.body.level ?? '').trim()
  const pdfUrl = String(req.body.pdf_url ?? '').trim()
  if (!code || !name || !level || !pdfUrl) {
    throw new ValidationError('Не хватает данных для импорта (код, название, уровень или ссылка на файл).')
  }

  const file = await fetchDocumentFromUrl(pdfUrl, FGOSVO_ALLOWED_DOMAINS)
  const { text } = await extractText(file.buffer, file.mimetype)
  const draft = await extractFgosDraft(text)

  const standard = await createFgosStandardDraft({
    standard: {
      direction_code: code,
      level,
      title:          draft.standard.title ?? name,
      generation:     draft.standard.generation ?? '3++',
      order_number:   draft.standard.order_number ?? null,
      order_date:     draft.standard.order_date ?? null,
      source_url:     pdfUrl,
      effective_date: draft.standard.effective_date ?? null,
    },
    competencies:          draft.competencies,
    structureRequirements: draft.structureRequirements,
    profstandardRefs:      draft.profstandardRefs,
  }, req.teacher.id)

  recordAudit({ institutionId: null, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'fgos_standard.bulk_imported', target: standard.title, metadata: { standardId: standard.id, sourceUrl: pdfUrl } })

  res.status(201).json(standard)
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
