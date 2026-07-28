import client from './client'
import type { RpdSubmission, RpdSubmissionEvent } from '../types'

export interface MySyllabusItem {
  discipline_id:    string
  discipline_name:  string
  semester:         number
  competency_codes: string[]
  course_id:        string | null
  program_id:       string
  program_name:     string
  program_code:     string | null
  has_document:     boolean
  document_uploaded_at: string | null
}

export interface SubmissionWithEvents extends Partial<RpdSubmission> {
  status: RpdSubmission['status']
  events: RpdSubmissionEvent[]
}

export async function getMySyllabi(): Promise<MySyllabusItem[]> {
  const res = await client.get<MySyllabusItem[]>('/api/my-syllabi')
  return res.data
}

export async function getMySubmission(disciplineId: string): Promise<SubmissionWithEvents> {
  const res = await client.get<SubmissionWithEvents>(`/api/my-syllabi/${disciplineId}/submission`)
  return res.data
}

export async function submitSyllabusFile(disciplineId: string, file: File): Promise<RpdSubmission> {
  const form = new FormData()
  form.append('file', file)
  const res = await client.post<RpdSubmission>(`/api/my-syllabi/${disciplineId}/submit`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function submitSyllabusFromDraft(disciplineId: string): Promise<RpdSubmission> {
  const res = await client.post<RpdSubmission>(`/api/my-syllabi/${disciplineId}/submit-from-draft`, {})
  return res.data
}
