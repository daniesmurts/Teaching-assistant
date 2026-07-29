import client from './client'
import { downloadCsv } from './download'
import type {
  Presentation, PresentationSource, PresentationDepth, Slide, SlideImage, ImageCandidate,
} from '../types'

export interface GenerateRequest {
  topic: string
  duration_minutes: number
  learning_goals?: string[]
  course_id?: string
  lecture_number?: number
  audience_level?: string
  style?: string
  slide_count_target?: number
  source_text?: string
  depth?: PresentationDepth
}

export interface GenerateResponse {
  presentation_id:   string
  // New generations include the typed slide array. Old presentations loaded
  // through `getPresentation` won't — renderer falls back to text parsing.
  slides:            Slide[] | null
  generated_content: string
  sources:           PresentationSource[]
}

export async function generatePresentation(data: GenerateRequest): Promise<GenerateResponse> {
  const res = await client.post<GenerateResponse>('/api/presentations/generate', data)
  return res.data
}

// ─── Async presentation jobs ──────────────────────────────────────────────────
// Generation can chain multiple LLM calls and outlive any HTTP timeout, so
// the client enqueues a job and polls — same pattern as grading's grade-jobs.

export type PresentationJobStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface PresentationJob {
  id:              string
  status:          PresentationJobStatus
  presentation_id: string | null
  result:          GenerateResponse | null
  error_message:   string | null
  created_at:      string
}

export async function startPresentationJob(data: GenerateRequest): Promise<PresentationJob> {
  const res = await client.post<PresentationJob>('/api/presentations/generate-jobs', data)
  return res.data
}

export async function getPresentationJob(id: string): Promise<PresentationJob> {
  const res = await client.get<PresentationJob>(`/api/presentations/generate-jobs/${id}`)
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

// Blob fetch (so the JWT interceptor authenticates the request) — a plain
// <a href> can't send the Authorization header, same reasoning as downloadCsv's
// other callers (fos.ts, InstitutionProgramDetail's PDF export).
export async function downloadPresentationPptx(id: string): Promise<void> {
  await downloadCsv(`/api/presentations/${id}/export.pptx`)
}

// ── Image picker for diagram slides ──────────────────────────────────────────

export interface ImageSearchResponse {
  query:      string
  candidates: ImageCandidate[]
}

export async function searchSlideImages(
  presentationId: string,
  slideIdx: number,
  query?: string,
): Promise<ImageSearchResponse> {
  const res = await client.post<ImageSearchResponse>(
    `/api/presentations/${presentationId}/slides/${slideIdx}/images`,
    query ? { query } : {},
  )
  return res.data
}

export async function setSlideImage(
  presentationId: string,
  slideIdx: number,
  image: SlideImage | null,
): Promise<Presentation> {
  const res = await client.patch<Presentation>(
    `/api/presentations/${presentationId}/slides/${slideIdx}`,
    { image },
  )
  return res.data
}
