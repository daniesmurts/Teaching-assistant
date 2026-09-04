import client from './client'
import { downloadCsv } from './download'
import type {
  Presentation, PresentationSource, PresentationDepth, PresentationOutlineSlide,
  Quiz, QuizLevel, Slide, SlideType, SlideImage, ImageCandidate,
} from '../types'
// The published-assignment shape is declared by its own API module rather than
// in shared types, so it's imported from there.
import type { PublishedAssignment } from './publishedAssignments'

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
  // "Строго по конспекту" — build the deck only from source_text, without the
  // model supplementing it from its own knowledge. Ignored without source_text.
  strict_source?: boolean
  depth?: PresentationDepth
  // Тема of the course's тематический план this lecture covers (TODO.md
  // "### AO" Phase 3) — supplies the topic wording and the lecture number,
  // and links the finished deck back to the programme.
  lecture_topic_id?: string
  // Show the plan before writing the deck (TODO.md "### AO" Phase 0). Sent
  // explicitly — the backend reads a missing field as `true`, so an older
  // cached bundle can't land in a gate it has no UI for.
  review_outline?: boolean
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

// Reads text out of an uploaded PDF/Word/image conspectus (backend/src/
// routes/presentations.ts's /extract-text) so the "Свой конспект" field can
// be filled from a file instead of copy-paste — paste alone can't carry a
// Word equation object (its clipboard has no plain-text form), so a .docx
// upload is what actually preserves formulas (see services/ommlToLatex.ts).
export interface ExtractSourceTextResponse {
  text:       string
  truncated:  boolean
}

export async function extractPresentationSourceText(file: File): Promise<ExtractSourceTextResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await client.post<ExtractSourceTextResponse>(
    '/api/presentations/extract-text',
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return res.data
}

// ─── Async presentation jobs ──────────────────────────────────────────────────
// Generation can chain multiple LLM calls and outlive any HTTP timeout, so
// the client enqueues a job and polls — same pattern as grading's grade-jobs.

export type PresentationJobStatus = 'pending' | 'processing' | 'outline_ready' | 'ready' | 'failed'

export interface PresentationJob {
  id:              string
  status:          PresentationJobStatus
  presentation_id: string | null
  result:          GenerateResponse | null
  // Populated at 'outline_ready' (and kept afterwards) — the plan the
  // teacher is being asked to confirm.
  outline:         PresentationOutlineSlide[] | null
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

// Confirms the plan (as edited) and starts the expensive half. The job then
// continues through 'processing' → 'ready' on the same poll loop.
export async function confirmPresentationOutline(
  jobId: string,
  outline: PresentationOutlineSlide[],
): Promise<PresentationJob> {
  const res = await client.post<PresentationJob>(
    `/api/presentations/generate-jobs/${jobId}/outline`,
    { outline },
  )
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

// ─── Per-slide editing (TODO.md "### AO" Phase 1) ───────────────────────────
//
// Every one of these returns the whole updated presentation, so the viewer
// re-renders from one source of truth instead of patching its own copy and
// hoping it matches what was stored.

export async function updateSlide(
  presentationId: string,
  slideIdx: number,
  slide: Slide,
): Promise<Presentation> {
  const res = await client.patch<Presentation>(
    `/api/presentations/${presentationId}/slides/${slideIdx}`,
    { slide },
  )
  return res.data
}

export async function regenerateSlide(
  presentationId: string,
  slideIdx: number,
  instruction?: string,
): Promise<Presentation> {
  const res = await client.post<Presentation>(
    `/api/presentations/${presentationId}/slides/${slideIdx}/regenerate`,
    instruction ? { instruction } : {},
  )
  return res.data
}

export async function deleteSlide(presentationId: string, slideIdx: number): Promise<Presentation> {
  const res = await client.delete<Presentation>(`/api/presentations/${presentationId}/slides/${slideIdx}`)
  return res.data
}

export async function insertSlide(
  presentationId: string,
  afterIndex: number,
  type: SlideType,
  title: string,
): Promise<Presentation> {
  const res = await client.post<Presentation>(
    `/api/presentations/${presentationId}/slides`,
    { after_index: afterIndex, type, title },
  )
  return res.data
}

export async function moveSlide(presentationId: string, from: number, to: number): Promise<Presentation> {
  const res = await client.post<Presentation>(
    `/api/presentations/${presentationId}/slides/move`,
    { from, to },
  )
  return res.data
}

// ─── Дек → тест (TODO.md "### AO" Phase 3) ──────────────────────────────────
//
// «Проверить усвоение»: a test built from this lecture's own slides and
// speaker notes. What comes back is an ordinary quiz, so the existing
// «Запустить в аудитории» (Feature Y) runs it with no further plumbing.

export async function createQuizFromPresentation(
  presentationId: string,
  questionCount = 8,
  level?: QuizLevel,
): Promise<Quiz> {
  const res = await client.post<Quiz>(
    `/api/presentations/${presentationId}/quiz`,
    { question_count: questionCount, level },
  )
  return res.data
}

export async function getPresentationQuizzes(presentationId: string): Promise<Quiz[]> {
  const res = await client.get<Quiz[]>(`/api/presentations/${presentationId}/quizzes`)
  return res.data
}

// ─── Дек → раздатка / письменная работа (TODO.md "### AO" Phase 3) ──────────

/** Student-facing PDF. `includeNotes: false` gives a skeleton to write on. */
export async function downloadPresentationHandout(id: string, includeNotes = true): Promise<void> {
  await downloadCsv(`/api/presentations/${id}/handout.pdf${includeNotes ? '' : '?notes=0'}`)
}

/** Turns the deck's discussion slides into a draft published assignment. */
export async function createAssignmentFromPresentation(id: string): Promise<PublishedAssignment> {
  const res = await client.post<PublishedAssignment>(`/api/presentations/${id}/assignment`)
  return res.data
}
