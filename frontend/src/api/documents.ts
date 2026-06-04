import client from './client'

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
