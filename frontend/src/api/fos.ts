import client from './client'
import { downloadCsv } from './download'
import type { FosDocument, FosSections } from '../types'

// ФОС generator (TODO.md Feature X) — thin client mirroring api/curriculum.ts.

export async function createFosDocument(data: {
  courseId:     string
  topics?:      string[]
  competencies?: string[]
  ticketCount?: number
}): Promise<FosDocument> {
  const res = await client.post<FosDocument>('/api/fos', {
    course_id:    data.courseId,
    topics:       data.topics,
    competencies: data.competencies,
    ticket_count: data.ticketCount,
  })
  return res.data
}

// Poll endpoint — job may still be pending/processing.
export async function getFosDocument(id: string): Promise<FosDocument> {
  const res = await client.get<FosDocument>(`/api/fos/${id}`)
  return res.data
}

export async function listFosDocuments(courseId: string): Promise<FosDocument[]> {
  const res = await client.get<{ documents: FosDocument[] }>('/api/fos', { params: { course_id: courseId } })
  return res.data.documents
}

export async function saveFosSections(id: string, sections: FosSections): Promise<FosDocument> {
  const res = await client.put<FosDocument>(`/api/fos/${id}`, { sections })
  return res.data
}

// Blob fetch (so the JWT interceptor authenticates the request) — a plain
// <a href> can't send the Authorization header, same reasoning as downloadCsv.
export async function downloadFosExport(id: string, format: 'docx' | 'pdf'): Promise<void> {
  await downloadCsv(`/api/fos/${id}/export.${format}`)
}
