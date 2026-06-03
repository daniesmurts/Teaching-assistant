import { pool } from '../connection'

export type DocumentType   = 'assignment' | 'syllabus' | 'material'
export type ProcessingStatus = 'pending' | 'extracting' | 'chunking' | 'ready' | 'failed'

export interface DocumentRow {
  id:                string
  teacher_id:        string
  course_id:         string | null
  file_name:         string
  file_type:         string
  mime_type:         string
  file_size_bytes:   number | null
  storage_path:      string
  document_type:     DocumentType
  extracted_text:    string | null
  extraction_method: string | null
  token_estimate:    number | null
  page_count:        number | null
  processing_status: ProcessingStatus
  error_message:     string | null
  created_at:        Date
}

export async function createDocument(data: {
  teacherId:     string
  courseId?:     string | null
  fileName:      string
  fileType:      string
  mimeType:      string
  fileSizeBytes: number
  storagePath:   string
  documentType:  DocumentType
}): Promise<DocumentRow> {
  const { rows } = await pool.query<DocumentRow>(
    `INSERT INTO documents
       (teacher_id, course_id, file_name, file_type, mime_type,
        file_size_bytes, storage_path, document_type, processing_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
     RETURNING *`,
    [
      data.teacherId, data.courseId ?? null, data.fileName, data.fileType,
      data.mimeType, data.fileSizeBytes, data.storagePath, data.documentType,
    ]
  )
  return rows[0]
}

export async function getDocumentById(id: string): Promise<DocumentRow | null> {
  const { rows } = await pool.query<DocumentRow>(
    'SELECT * FROM documents WHERE id = $1 LIMIT 1',
    [id]
  )
  return rows[0] ?? null
}

export async function setDocumentStatus(id: string, status: ProcessingStatus): Promise<void> {
  await pool.query('UPDATE documents SET processing_status = $2 WHERE id = $1', [id, status])
}

export async function setDocumentFailed(id: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE documents SET processing_status = 'failed', error_message = $2 WHERE id = $1`,
    [id, message.slice(0, 500)]
  )
}

export async function updateDocumentExtraction(id: string, data: {
  extractedText:    string
  extractionMethod: string
  tokenEstimate:    number
  pageCount?:       number
}): Promise<void> {
  await pool.query(
    `UPDATE documents
     SET extracted_text = $2, extraction_method = $3, token_estimate = $4, page_count = $5
     WHERE id = $1`,
    [id, data.extractedText, data.extractionMethod, data.tokenEstimate, data.pageCount ?? null]
  )
}
