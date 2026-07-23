import { uploadObject } from './objectStorage'
import { extractText } from './documentExtractor'
import { splitTextIntoChunks } from './chunker'
import { embed } from './deepseek'
import {
  replaceStrategyDocument, setStrategyDocumentStatus, setStrategyDocumentFailed,
  setStrategyDocumentExtractedText, insertStrategyChunk,
  type StrategyDocumentRow,
} from '../db/queries/institutionStrategyDoc'
import { logger } from '../lib/logger'

// РОП Студия's Plane-2 document (TODO.md Feature Z, Phase 0 pilot
// completion) — the university's own «стратегия развития», the one
// grounded document Z's pilot definition asks for alongside the Plane-1
// market data. Mirrors services/documents.ts's uploadAndProcess/
// processDocument shape (extract → chunk → embed, in the background), but
// institution-scoped instead of course-scoped, and reuses
// chunker.ts's splitTextIntoChunks() directly since there's no course to
// stamp onto a chunk.

function sanitiseName(name: string): string {
  return name.replace(/[^\w.\-]/g, '_').slice(0, 120)
}

export async function uploadStrategyDocument(params: {
  institutionId: string
  teacherId:     string
  fileBuffer:    Buffer
  fileName:      string
  mimeType:      string
}): Promise<StrategyDocumentRow> {
  const storagePath = `institution-strategy/${params.institutionId}/${Date.now()}_${sanitiseName(params.fileName)}`
  await uploadObject(params.fileBuffer, storagePath, params.mimeType)

  const document = await replaceStrategyDocument({
    institutionId: params.institutionId,
    fileName:      params.fileName,
    storagePath,
    uploadedBy:    params.teacherId,
  })

  processDocument(document.id, params.institutionId, params.teacherId, params.fileBuffer, params.mimeType)
    .catch((err) => {
      logger.error({ message: 'Strategy document processing failed', documentId: document.id, error: err.message })
      setStrategyDocumentFailed(document.id, err.message).catch(() => null)
    })

  return document
}

async function processDocument(
  documentId:    string,
  institutionId: string,
  teacherId:     string,
  fileBuffer:    Buffer,
  mimeType:      string
): Promise<void> {
  await setStrategyDocumentStatus(documentId, 'extracting')

  const { text } = await extractText(fileBuffer, mimeType)
  await setStrategyDocumentExtractedText(documentId, text)

  await setStrategyDocumentStatus(documentId, 'chunking')

  const chunks = splitTextIntoChunks(text)
  for (const chunk of chunks) {
    try {
      const vector = await embed(chunk.text, { teacherId, institutionId, feature: 'embedding' })
      await insertStrategyChunk(documentId, chunk, vector)
    } catch (err) {
      logger.warn({ message: 'Strategy chunk embedding failed', documentId, chunkIndex: chunk.chunkIndex, error: (err as Error).message })
    }
  }

  await setStrategyDocumentStatus(documentId, 'ready')
}
