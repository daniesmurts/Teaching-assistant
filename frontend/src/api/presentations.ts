import client from './client'
import type { Presentation, PresentationSource } from '../types'

export interface GenerateRequest {
  topic: string
  duration_minutes: number
  learning_goals?: string[]
  course_id?: string
  lecture_number?: number
  audience_level?: string
  style?: string
  slide_count_target?: number
}

export interface GenerateResponse {
  presentation_id:   string
  generated_content: string
  sources:           PresentationSource[]
}

export async function generatePresentation(data: GenerateRequest): Promise<GenerateResponse> {
  const res = await client.post<GenerateResponse>('/api/presentations/generate', data)
  return res.data
}

export async function getPresentations(params?: { course_id?: string }): Promise<Presentation[]> {
  const res = await client.get<Presentation[]>('/api/presentations', { params })
  return res.data
}

export async function getPresentation(id: string): Promise<Presentation> {
  const res = await client.get<Presentation>(`/api/presentations/${id}`)
  return res.data
}

export async function deletePresentation(id: string): Promise<void> {
  await client.delete(`/api/presentations/${id}`)
}
