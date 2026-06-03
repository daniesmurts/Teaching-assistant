import { uploadObject } from './objectStorage'
import { extractText, estimateTokens } from './documentExtractor'
import { chunkDocument } from './chunker'
import { embed } from './deepseek'
import {
  createDocument, getDocumentById, setDocumentStatus,
  setDocumentFailed, updateDocumentExtraction,
  type DocumentRow, type DocumentType,
} from '../db/queries/documents'
import { createChunk } from '../db/queries/chunks'
import { logger } from '../lib/logger'

function fileTypeFromMime(mime: string): string {
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/'))  return 'image'
  return 'docx'
}

// ─── Upload + kick off async processing ───────────────────────────────────────

export async function uploadAndProcess(params: {
  fileBuffer:   Buffer
  fileName:     string
  mimeType:     string
  fileSize:     number
  teacherId:    string
  courseId?:    string
  documentType: DocumentType
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
  processDocument(document.id, params.fileBuffer, params.mimeType, params.documentType)
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
  documentType: DocumentType
): Promise<void> {
  await setDocumentStatus(documentId, 'extracting')

  const { text, method, pageCount } = await extractText(fileBuffer, mimeType)
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
      const chunks = chunkDocument(text, documentId, doc.course_id)
      for (const chunk of chunks) {
        try {
          const vector = await embed(chunk.text, { teacherId: doc.teacher_id, feature: 'embedding' })
          await createChunk(chunk, vector)
        } catch (err) {
          logger.warn({ message: 'Chunk embedding failed', documentId, chunkIndex: chunk.chunkIndex, error: (err as Error).message })
        }
      }
    }
  }

  await setDocumentStatus(documentId, 'ready')
}

function sanitiseName(name: string): string {
  return name.replace(/[^\w.\-]/g, '_').slice(0, 120)
}
