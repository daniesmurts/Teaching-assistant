import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { asyncHandler } from '../lib/asyncHandler'
import { checkFeatureAccess } from '../middleware/checkPlan'
import { aiLimiter } from '../middleware/rateLimits'
import { uploadConfig, verifyFileContent } from '../middleware/fileValidation'
import { uploadAndProcess } from '../services/documents'
import { askDocument, type ChatTurn } from '../services/docChat'
import { getDocumentById } from '../db/queries/documents'
import { countChunksForDocument } from '../db/queries/chunks'
import { findCourseById } from '../db/queries/courses'
import { ValidationError, NotFoundError, DocumentProcessingError } from '../errors/AppError'

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
  })
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

export default router
