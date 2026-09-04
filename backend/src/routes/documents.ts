import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { asyncHandler } from '../lib/asyncHandler'
import { checkFeatureAccess } from '../middleware/checkPlan'
import { aiLimiter } from '../middleware/rateLimits'
import { uploadConfig, verifyFileContent } from '../middleware/fileValidation'
import { uploadAndProcess } from '../services/documents'
import { getFigureById } from '../db/queries/documentFigures'
import { downloadObject, deleteObject } from '../services/objectStorage'
import { askDocument, type ChatTurn } from '../services/docChat'
import {
  getDocumentById, promoteDocumentScope, getDocumentReuseCount,
  listDocumentsForCourse, deleteDocumentOwnedByTeacher,
  type DocumentVisibilityScope, type DocumentProvenance, type DocumentType,
} from '../db/queries/documents'
import { countChunksForDocument } from '../db/queries/chunks'
import { findCourseById } from '../db/queries/courses'
import { teacherCanActOnUnit, getRootUnitForInstitution } from '../db/queries/orgUnits'
import { pool } from '../db/connection'
import { getAccessScope, resolveGrant } from '../services/accessScope'
import { canUseFeature } from '../config/planLimits'
import { ValidationError, NotFoundError, ForbiddenError, DocumentProcessingError } from '../errors/AppError'

const router = Router()
router.use(authenticate)

// POST /api/documents/upload
router.post(
  '/upload',
  checkFeatureAccess('documentUpload'),
  uploadConfig.single('file'),
  verifyFileContent,
  asyncHandler(async (req, res) => {
    const { course_id, document_type } = req.body as {
      course_id?: string
      document_type?: string
    }
    const file = req.file
    if (!file) throw new ValidationError('Файл не предоставлен')

    const validTypes = ['assignment', 'syllabus', 'material']
    if (!document_type || !validTypes.includes(document_type)) {
      throw new ValidationError('Неверный тип документа')
    }

    // Knowledge docs must be tied to a course (they're chunked per-course)
    if ((document_type === 'syllabus' || document_type === 'material') && !course_id) {
      throw new DocumentProcessingError('Для программы или материалов укажите предмет')
    }

    const document = await uploadAndProcess({
      fileBuffer:     file.buffer,
      fileName:       file.originalname,
      mimeType:       file.mimetype,
      fileSize:       file.size,
      teacherId:      req.teacher.id,
      institutionId:  req.teacher.institution_id ?? undefined,
      courseId:       course_id,
      documentType:   document_type as 'assignment' | 'syllabus' | 'material',
    })

    res.status(201).json({
      id:     document.id,
      status: document.processing_status,
    })
  })
)

// GET /api/documents?course_id=&document_type= — lists the caller's OWN
// documents for a course (frontend/src/components/courses/CourseMaterials.tsx).
// Own uploads only — a colleague's materials shared into this course's RAG
// scope (Feature AN) surface separately, via GET /api/institution/library,
// never mixed into "what did I upload" here.
router.get('/', asyncHandler(async (req, res) => {
  const { course_id, document_type } = req.query as { course_id?: string; document_type?: string }
  if (!course_id) throw new ValidationError('Укажите предмет')
  const course = await findCourseById(course_id, req.teacher.id)
  if (!course) throw new NotFoundError('Предмет')

  const validTypes: DocumentType[] = ['assignment', 'syllabus', 'material']
  const type = document_type && validTypes.includes(document_type as DocumentType) ? (document_type as DocumentType) : undefined

  const docs = await listDocumentsForCourse(course_id, req.teacher.id, type)
  res.json(docs.map((d) => ({
    id:              d.id,
    fileName:        d.file_name,
    status:          d.processing_status,
    documentType:    d.document_type,
    visibilityScope: d.visibility_scope,
    scopeUnitId:     d.scope_unit_id,
    provenance:      d.provenance,
    createdAt:       d.created_at,
  })))
}))

// DELETE /api/documents/:id — owner-only. Best-effort object-storage
// cleanup; document_chunks/document_figures cascade via their own FKs.
router.delete('/:id', asyncHandler(async (req, res) => {
  const storagePath = await deleteDocumentOwnedByTeacher(req.params.id, req.teacher.id)
  if (!storagePath) throw new NotFoundError('Документ')
  await deleteObject(storagePath).catch(() => null)
  res.status(204).send()
}))

// GET /api/documents/:id/status — frontend polls this every ~2s
router.get('/:id/status', asyncHandler(async (req, res) => {
  const doc = await getDocumentById(req.params.id)
  if (!doc || doc.teacher_id !== req.teacher.id) throw new NotFoundError('Документ')

  const chunkCount =
    doc.processing_status === 'ready' &&
    (doc.document_type === 'syllabus' || doc.document_type === 'material')
      ? await countChunksForDocument(doc.id)
      : undefined

  res.json({
    id:            doc.id,
    status:        doc.processing_status,
    error:         doc.error_message,
    documentType:  doc.document_type,
    extractedText: doc.processing_status === 'ready' ? doc.extracted_text : null,
    tokenEstimate: doc.token_estimate,
    pageCount:     doc.page_count,
    chunkCount,
    visibilityScope: doc.visibility_scope,
    scopeUnitId:     doc.scope_unit_id,
    provenance:      doc.provenance,
  })
}))

// GET /api/documents/:id/reuse — Feature AN Phase 3, the contributor-facing
// half of reuse tracking (the institution-wide roster is
// GET /api/institution/library). Owner-only.
router.get('/:id/reuse', asyncHandler(async (req, res) => {
  const doc = await getDocumentById(req.params.id)
  if (!doc || doc.teacher_id !== req.teacher.id) throw new NotFoundError('Документ')
  res.json({ reuseCount: await getDocumentReuseCount(doc.id) })
}))

const VISIBILITY_SCOPES: DocumentVisibilityScope[] = ['course', 'unit', 'institution']  // 'platform' excluded — curated-only, see below
const PROVENANCES: DocumentProvenance[] = ['own_work', 'open_licence', 'institution_owned', 'unknown']

// PATCH /api/documents/:id/scope — Feature AN Phase 1 (TODO.md "### AN")
// promotes/demotes a material's RAG visibility along the scope ladder.
// 'platform' is deliberately unreachable here — curated ИСПУМ content only,
// seeded directly, never through a user action (copyright containment, see
// TODO.md's spec for this feature).
router.patch('/:id/scope', asyncHandler(async (req, res) => {
  const { visibility_scope, scope_unit_id, provenance } = req.body as {
    visibility_scope?: string
    scope_unit_id?:    string
    provenance?:       string
  }

  const doc = await getDocumentById(req.params.id)
  if (!doc) throw new NotFoundError('Документ')
  if (doc.document_type !== 'material' && doc.document_type !== 'syllabus') {
    throw new ValidationError('Область видимости доступна только для материалов и программ курса')
  }

  if (!visibility_scope || !VISIBILITY_SCOPES.includes(visibility_scope as DocumentVisibilityScope)) {
    throw new ValidationError('Недопустимая область видимости')
  }
  const targetScope = visibility_scope as DocumentVisibilityScope

  // Demoting back to 'course' just narrows visibility — only the
  // contributing teacher needs to be able to do that, no domain grant.
  if (targetScope === 'course') {
    if (doc.teacher_id !== req.teacher.id) throw new ForbiddenError('Недостаточно прав для изменения области видимости')
    const updated = await promoteDocumentScope(doc.id, { visibilityScope: 'course', scopeUnitId: null, provenance: doc.provenance })
    res.json({ id: updated!.id, visibilityScope: updated!.visibility_scope, scopeUnitId: updated!.scope_unit_id, provenance: updated!.provenance })
    return
  }

  if (!provenance || !PROVENANCES.includes(provenance as DocumentProvenance)) {
    throw new ValidationError('Укажите происхождение материала (provenance)')
  }

  if (targetScope === 'unit') {
    // scope_unit_id omitted ⇒ default to the caller's own primary
    // department — the common case ("поделиться с моей кафедрой") doesn't
    // require the frontend to know or pick a unit id. An explicit
    // scope_unit_id (e.g. a УМУ editor promoting someone else's upload to a
    // specific unit) is still honoured when supplied.
    const { rows: teacherRows } = await pool.query<{ primary_org_unit_id: string | null }>(
      'SELECT primary_org_unit_id FROM teachers WHERE id = $1', [req.teacher.id]
    )
    const targetUnitId = scope_unit_id || teacherRows[0]?.primary_org_unit_id
    if (!targetUnitId) throw new ValidationError('Укажите подразделение (scope_unit_id) — у вас не задана основная кафедра')
    const allowed = await teacherCanActOnUnit(req.teacher.id, targetUnitId, ['edit', 'admin'], 'umu')
    if (!allowed) throw new ForbiddenError('Недостаточно прав на это подразделение (нужен домен УМУ)')
    const updated = await promoteDocumentScope(doc.id, { visibilityScope: 'unit', scopeUnitId: targetUnitId, provenance: provenance as DocumentProvenance })
    res.json({ id: updated!.id, visibilityScope: updated!.visibility_scope, scopeUnitId: updated!.scope_unit_id, provenance: updated!.provenance })
    return
  }

  // targetScope === 'institution'
  if (!req.teacher.institution_id) throw new ForbiddenError('Доступно только преподавателям учебного заведения')
  if (!canUseFeature(req.teacher.plan_tier, 'documentLibraryInstitution')) {
    throw new ForbiddenError('Общедоступная для учебного заведения библиотека доступна только на тарифе «Институция»')
  }
  const scope = await getAccessScope({
    id: req.teacher.id, is_platform_admin: req.teacher.is_platform_admin, institution_id: req.teacher.institution_id,
  })
  const grant = req.teacher.is_platform_admin ? { level: 'admin' as const, pathPrefixes: ['/'] } : resolveGrant(scope, 'umu', 'edit')
  const root = await getRootUnitForInstitution(req.teacher.institution_id)
  const isRootAnchored = req.teacher.is_platform_admin || (grant && root && grant.pathPrefixes.includes(root.path))
  if (!isRootAnchored) throw new ForbiddenError('Требуются права УМУ на уровне всего учебного заведения')

  const updated = await promoteDocumentScope(doc.id, { visibilityScope: 'institution', scopeUnitId: null, provenance: provenance as DocumentProvenance })
  res.json({ id: updated!.id, visibilityScope: updated!.visibility_scope, scopeUnitId: updated!.scope_unit_id, provenance: updated!.provenance })
}))

const MAX_QUESTION_LEN = 2000
const MAX_HISTORY_ITEMS = 12

// POST /api/documents/chat — "Спроси документ" grounded Q&A over a course's materials (TODO Feature I)
router.post(
  '/chat',
  aiLimiter,
  checkFeatureAccess('documentUpload'),
  asyncHandler(async (req, res) => {
    const { course_id, question, history } = req.body as {
      course_id?: string
      question?:  string
      history?:   ChatTurn[]
    }

    if (!course_id) throw new ValidationError('Укажите предмет')
    if (!question || !question.trim()) throw new ValidationError('Введите вопрос')
    if (question.length > MAX_QUESTION_LEN) throw new ValidationError(`Вопрос слишком длинный (максимум ${MAX_QUESTION_LEN} символов)`)

    const course = await findCourseById(course_id, req.teacher.id)
    if (!course) throw new NotFoundError('Предмет')

    const cleanHistory = Array.isArray(history)
      ? history
          .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
          .slice(-MAX_HISTORY_ITEMS)
      : undefined

    const result = await askDocument({
      teacherId:     req.teacher.id,
      institutionId: req.teacher.institution_id ?? undefined,
      courseId:      course_id,
      question,
      history:       cleanHistory,
    })

    res.json(result)
  })
)

// GET /api/documents/figures/:id/image — Feature AN Phase 2. Streams a
// stored figure from object storage. No pre-signed-URL mechanism exists in
// this codebase (services/objectStorage.ts), so this proxy is how a slide's
// image URL (services/presentations.ts's toSlideImageFromFigure) and the
// library page render a figure. Authenticated-only, not scope-checked
// against the caller's course — acceptable for MVP (the id itself isn't
// discoverable without already having retrieved the figure through scoped
// RAG), noted as a follow-up rather than solved here.
router.get('/figures/:id/image', asyncHandler(async (req, res) => {
  const figure = await getFigureById(req.params.id)
  if (!figure) throw new NotFoundError('Изображение')
  const buffer = await downloadObject(figure.storage_path)
  res.setHeader('Content-Type', figure.mime_type)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.send(buffer)
}))

export default router
