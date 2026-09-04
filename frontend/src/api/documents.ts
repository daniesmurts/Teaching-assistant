import client from './client'
import type { ChatTurn, DocChatResult, DocumentVisibilityScope, DocumentProvenance } from '../../../shared/types'
export type { ChatTurn, DocChatSource } from '../../../shared/types'

export type DocumentType   = 'assignment' | 'syllabus' | 'material'
export type ProcessingStatus = 'pending' | 'extracting' | 'chunking' | 'ready' | 'failed'

export interface DocumentStatus {
  id:            string
  status:        ProcessingStatus
  error:         string | null
  documentType:  DocumentType
  extractedText: string | null
  tokenEstimate: number | null
  pageCount:     number | null
  chunkCount?:   number
  // Feature AN — present once processing reaches at least 'chunking'
  visibilityScope?: DocumentVisibilityScope
  scopeUnitId?:     string | null
  provenance?:      DocumentProvenance
}

export async function uploadDocument(
  file: File,
  documentType: DocumentType,
  courseId?: string
): Promise<{ id: string; status: ProcessingStatus }> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('document_type', documentType)
  if (courseId) formData.append('course_id', courseId)

  const res = await client.post<{ id: string; status: ProcessingStatus }>(
    '/api/documents/upload',
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
  return res.data
}

export async function getDocumentStatus(id: string): Promise<DocumentStatus> {
  const res = await client.get<DocumentStatus>(`/api/documents/${id}/status`)
  return res.data
}

// A row from GET /api/documents?course_id=&document_type= — the teacher's
// own uploads for a course (components/courses/CourseMaterials.tsx).
export interface MaterialListItem {
  id:               string
  fileName:         string
  status:           ProcessingStatus
  documentType:     DocumentType
  visibilityScope:  DocumentVisibilityScope
  scopeUnitId:      string | null
  provenance:       DocumentProvenance
  createdAt:        string
}

export async function listDocuments(courseId: string, documentType: DocumentType): Promise<MaterialListItem[]> {
  const res = await client.get<MaterialListItem[]>('/api/documents', { params: { course_id: courseId, document_type: documentType } })
  return res.data
}

export async function deleteDocument(id: string): Promise<void> {
  await client.delete(`/api/documents/${id}`)
}

/**
 * Upload then poll until the document is ready (or fails).
 * Calls onProgress with each status transition.
 */
export async function uploadAndWait(
  file: File,
  documentType: DocumentType,
  courseId: string | undefined,
  onProgress: (status: ProcessingStatus) => void = () => {},
): Promise<DocumentStatus> {
  const { id } = await uploadDocument(file, documentType, courseId)
  onProgress('pending')

  return new Promise<DocumentStatus>((resolve, reject) => {
    const poll = async () => {
      try {
        const status = await getDocumentStatus(id)
        onProgress(status.status)
        if (status.status === 'ready')  return resolve(status)
        if (status.status === 'failed') return reject(new Error(status.error ?? 'Не удалось обработать документ'))
        setTimeout(poll, 2000)
      } catch (err) {
        reject(err)
      }
    }
    setTimeout(poll, 1500)
  })
}

// ─── "Спроси документ" grounded chat (Feature I) ───────────────────────────────

export async function askDocument(params: {
  course_id: string
  question:  string
  history?:  ChatTurn[]
}): Promise<DocChatResult> {
  const res = await client.post<DocChatResult>('/api/documents/chat', params)
  return res.data
}
