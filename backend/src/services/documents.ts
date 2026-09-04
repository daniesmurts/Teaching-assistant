import { uploadObject } from './objectStorage'
import { extractText, extractDocxFigures, extractPdfFigures, estimateTokens } from './documentExtractor'
import { chunkDocument } from './chunker'
import { embed } from './deepseek'
import { captionFigure, embedFigureCaption } from './figureCaptioning'
import {
  createDocument, getDocumentById, setDocumentStatus,
  setDocumentFailed, updateDocumentExtraction,
  type DocumentRow, type DocumentType,
} from '../db/queries/documents'
import { createChunk, deleteChunksForOtherSyllabusDocuments } from '../db/queries/chunks'
import { createFigure } from '../db/queries/documentFigures'
import { setCourseSyllabusText } from '../db/queries/courses'
import { logger } from '../lib/logger'
import type { CallContext } from './llm/types'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function fileTypeFromMime(mime: string): string {
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/'))  return 'image'
  return 'docx'
}

// ─── Upload + kick off async processing ───────────────────────────────────────

export async function uploadAndProcess(params: {
  fileBuffer:     Buffer
  fileName:       string
  mimeType:       string
  fileSize:       number
  teacherId:      string
  institutionId?: string
  courseId?:      string
  documentType:   DocumentType
}): Promise<DocumentRow> {

  // 1. Persist the original file immediately
  const storagePath = `uploads/${params.teacherId}/${Date.now()}_${sanitiseName(params.fileName)}`
  await uploadObject(params.fileBuffer, storagePath, params.mimeType)

  // 2. Create the DB record (status: pending)
  const document = await createDocument({
    teacherId:     params.teacherId,
    courseId:      params.courseId ?? null,
    fileName:      params.fileName,
    fileType:      fileTypeFromMime(params.mimeType),
    mimeType:      params.mimeType,
    fileSizeBytes: params.fileSize,
    storagePath,
    documentType:  params.documentType,
  })

  // 3. Process in the background — do NOT await
  processDocument(document.id, params.fileBuffer, params.mimeType, params.documentType, {
    teacherId: params.teacherId, institutionId: params.institutionId, feature: 'document_extraction',
  })
    .catch((err) => {
      logger.error({ message: 'Document processing failed', documentId: document.id, error: err.message })
      setDocumentFailed(document.id, err.message).catch(() => null)
    })

  return document
}

// ─── Extraction (+ chunking for knowledge docs) ───────────────────────────────

async function processDocument(
  documentId: string,
  fileBuffer: Buffer,
  mimeType: string,
  documentType: DocumentType,
  context: CallContext,
): Promise<void> {
  await setDocumentStatus(documentId, 'extracting')

  const { text, method, pageCount } = await extractText(fileBuffer, mimeType, context)
  const tokenEstimate = estimateTokens(text)

  await updateDocumentExtraction(documentId, {
    extractedText: text,
    extractionMethod: method,
    tokenEstimate,
    pageCount,
  })

  // Knowledge documents get chunked + embedded for RAG; assignments do not
  if (documentType === 'syllabus' || documentType === 'material') {
    await setDocumentStatus(documentId, 'chunking')

    const doc = await getDocumentById(documentId)
    if (doc?.course_id) {
      // A syllabus becomes the course's program text (used by the presentation generator)
      if (documentType === 'syllabus' && text.trim()) {
        await setCourseSyllabusText(doc.course_id, text).catch((err) =>
          logger.warn({ message: 'Could not set course syllabus_text', documentId, error: (err as Error).message })
        )
      }
      const chunks = chunkDocument(text, documentId, doc.course_id, {
        visibilityScope: doc.visibility_scope,
        scopeUnitId:     doc.scope_unit_id,
      })
      let createdCount = 0
      for (const chunk of chunks) {
        try {
          const vector = await embed(chunk.text, { teacherId: doc.teacher_id, feature: 'embedding' })
          await createChunk(chunk, vector)
          createdCount++
        } catch (err) {
          logger.warn({ message: 'Chunk embedding failed', documentId, chunkIndex: chunk.chunkIndex, error: (err as Error).message })
        }
      }

      // A new syllabus supersedes the course's previous one (single source
      // of truth — see setCourseSyllabusText above). Clear the old syllabus's
      // chunks so RAG retrieval stops mixing stale program content in with
      // current results. Only once the replacement has at least one chunk of
      // its own — if every embed call above failed, leaving the old (stale
      // but present) chunks in place beats leaving the course with none.
      if (documentType === 'syllabus' && createdCount > 0) {
        const deleted = await deleteChunksForOtherSyllabusDocuments(doc.course_id, documentId).catch((err) => {
          logger.warn({ message: 'Could not clear superseded syllabus chunks', documentId, error: (err as Error).message })
          return 0
        })
        if (deleted > 0) {
          logger.info({ message: 'Cleared superseded syllabus chunks', documentId, courseId: doc.course_id, deletedChunks: deleted })
        }
      }

      // Feature AN Phase 2 — persist embedded drawings/scanned pages as
      // retrievable figures instead of only OCRing-and-discarding them.
      // Material docs only (a чертёж belongs in a "материалы" upload, not a
      // syllabus). .docx scans embedded images; PDF rasterizes text-sparse
      // pages (documentExtractor.ts's extractPdfFigures) — most real
      // separately-scanned чертежи arrive as PDF, so this is the more
      // load-bearing of the two paths in practice.
      if (documentType === 'material' && (mimeType === DOCX_MIME || mimeType === 'application/pdf')) {
        await extractAndStoreFigures(documentId, doc, fileBuffer, mimeType, text, context).catch((err) =>
          logger.warn({ message: 'Figure extraction failed', documentId, error: (err as Error).message })
        )
      }
    }
  }

  await setDocumentStatus(documentId, 'ready')
}

function sanitiseName(name: string): string {
  return name.replace(/[^\w.\-]/g, '_').slice(0, 120)
}

/**
 * Feature AN Phase 2 — extracts embedded drawings (.docx) or scanned/
 * drawing-heavy pages (PDF) from a material, captions each (see
 * figureCaptioning.ts's OCR+chatJSON approach — no multimodal chat provider
 * exists in this codebase), and persists them. Best-effort per figure: one
 * bad image never aborts the rest, and this whole step never fails document
 * processing (the caller already wraps it in .catch()).
 */
async function extractAndStoreFigures(
  documentId: string,
  doc: DocumentRow,
  fileBuffer: Buffer,
  mimeType: string,
  fullText: string,
  context: CallContext,
): Promise<void> {
  const figures = mimeType === 'application/pdf'
    ? await extractPdfFigures(fileBuffer, fullText, context)
    : await extractDocxFigures(fileBuffer, context)
  if (figures.length === 0) return

  const textPages = fullText.split('\f')

  for (const figure of figures) {
    try {
      // Prefer the figure's own source page's text (PDF) over a crude
      // whole-document slice (.docx has no page concept to key off) — a
      // page-scoped чертёж's neighbouring prose is a much sharper caption
      // signal than the start of a possibly long document.
      const surroundingText = figure.sourcePageIndex !== undefined
        ? (textPages[figure.sourcePageIndex] ?? '').slice(0, 2000)
        : fullText.slice(0, 2000)
      const caption = await captionFigure(figure.ocrText, surroundingText, context, { buffer: figure.buffer, mime: figure.mime })
      const embedding = await embedFigureCaption(caption, figure.ocrText, context)
      if (!embedding) continue // nothing usable to retrieve by — skip rather than store an unfindable figure

      const ext = figure.mime.split('/').pop() ?? 'png'
      const storagePath = `figures/${documentId}/${figure.index}.${ext}`
      await uploadObject(figure.buffer, storagePath, figure.mime)

      await createFigure({
        documentId, figureIndex: figure.index, storagePath, mimeType: figure.mime,
        ocrText: figure.ocrText, caption: caption.caption, embedding,
        visibilityScope: doc.visibility_scope, scopeUnitId: doc.scope_unit_id,
      })
    } catch (err) {
      logger.warn({ message: 'Could not store figure', documentId, figureIndex: figure.index, error: (err as Error).message })
    }
  }
}
