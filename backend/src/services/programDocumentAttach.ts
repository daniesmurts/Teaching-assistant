import { uploadObject, deleteObject } from './objectStorage'
import { insertProgramDocument } from '../db/queries/programDocuments'
import type { FetchedFile } from './documentFetch'
import type { ProgramDocumentKind, ProgramPracticeType } from '../../../shared/types'

// Extracted from routes/programs.ts so routes/mySyllabi.ts (docs/RPD-WORKFLOW.md
// phase 4b — both submission paths converge on the same program_documents row,
// see §2.1) can reuse the exact same attach logic instead of a second
// upload-then-insert code path.

function sanitiseName(name: string): string {
  return name.replace(/[^\w.\-]/g, '_').slice(0, 120)
}

function documentStoragePath(programId: string, docId: string, fileName: string): string {
  return `programs/${programId}/${docId}_${sanitiseName(fileName)}`
}

/**
 * Uploads a single file to object storage and inserts a program_documents
 * row. Returns the created row's id. Failures leave nothing behind — upload
 * first, insert second; a failed insert means an orphaned object, which we
 * log and best-effort clean.
 */
export async function attachProgramDocument(params: {
  programId:     string
  kind:          ProgramDocumentKind
  practiceType:  ProgramPracticeType | null
  disciplineId?: string | null
  extractedText?: string | null
  // FetchedFile is a structural subset of Express.Multer.File (buffer /
  // originalname / mimetype / size) — a real upload is assignable to it, so
  // both the multipart and URL-fetch paths flow through here unchanged.
  file:          FetchedFile
  uploadedBy:    string
}): Promise<string> {
  // Pre-generate an id so the storage key can include it before the row exists.
  // Any UUID works; the DB regenerates its own default anyway.
  const tempId = (globalThis.crypto as Crypto).randomUUID()
  const key    = documentStoragePath(params.programId, tempId, params.file.originalname)
  await uploadObject(params.file.buffer, key, params.file.mimetype)

  try {
    const row = await insertProgramDocument({
      programId:     params.programId,
      kind:          params.kind,
      practiceType:  params.practiceType,
      disciplineId:  params.disciplineId ?? null,
      fileName:      params.file.originalname,
      fileSize:      params.file.size,
      mimeType:      params.file.mimetype,
      storagePath:   key,
      extractedText: params.extractedText ?? null,
      uploadedBy:    params.uploadedBy,
    })
    return row.id
  } catch (err) {
    // DB insert failed after upload — clean up the object so we don't leave
    // orphaned files sitting in storage.
    await deleteObject(key)
    throw err
  }
}
