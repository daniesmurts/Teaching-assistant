import client from './client'
import type { CurriculumAnalysis, SyllabusReview, SyllabusDraft, SyllabusSection } from '../types'

export interface DraftCompetency { code: string; title: string }

export interface SyllabusDraftResult {
  draft:        SyllabusDraft
  review:       SyllabusReview
  competencies: DraftCompetency[]
  goals:        string[]
}

// КНИТУ admin feature A3 — анализ дублирования содержания между дисциплинами.
export async function analyzeOverlap(courseIds: string[]): Promise<CurriculumAnalysis> {
  // Extraction + per-topic embedding + classification across several disciplines
  // can run ~1 minute — override the client's default timeout for this call.
  const res = await client.post<CurriculumAnalysis>('/api/curriculum/overlap', {
    course_ids: courseIds,
  }, { timeout: 180_000 })
  return res.data
}

// КНИТУ admin feature A2 — соответствие РПД заявленным компетенциям и целям.
export async function reviewSyllabus(courseId: string): Promise<SyllabusReview> {
  const res = await client.post<SyllabusReview>('/api/curriculum/syllabus-review', {
    course_id: courseId,
  }, { timeout: 120_000 })
  return res.data
}

// TODO Feature AM — same check, targeted at a programme discipline instead
// of a teacher's own course (Кабинет методиста).
export async function reviewProgramDisciplineSyllabus(
  programId: string, disciplineId: string
): Promise<SyllabusReview> {
  const res = await client.post<SyllabusReview>('/api/curriculum/syllabus-review', {
    program_id: programId, discipline_id: disciplineId,
  }, { timeout: 120_000 })
  return res.data
}

// TODO Feature AM — overlap analysis across disciplines inside a programme
// a методист has read access to, instead of a teacher's own courses.
export async function analyzeProgramOverlap(
  programId: string, disciplineIds: string[]
): Promise<CurriculumAnalysis> {
  const res = await client.post<CurriculumAnalysis>('/api/curriculum/overlap', {
    program_id: programId, discipline_ids: disciplineIds,
  }, { timeout: 180_000 })
  return res.data
}

// КНИТУ teacher feature T5 — «РПД-студия»: draft content for a course's competencies,
// then self-check coverage. Returns the draft + its conformance review + the targets used.
export async function draftSyllabus(courseId: string): Promise<SyllabusDraftResult> {
  const res = await client.post<SyllabusDraftResult>('/api/curriculum/syllabus-draft', {
    course_id: courseId,
  }, { timeout: 180_000 })
  return res.data
}

// Re-check edited draft text against the same targets (the "check" half of the loop).
export async function reviewSyllabusText(
  syllabusText: string, competencies: DraftCompetency[], goals: string[]
): Promise<SyllabusReview> {
  const res = await client.post<SyllabusReview>('/api/curriculum/syllabus-review', {
    syllabus_text: syllabusText, competencies, goals,
  }, { timeout: 120_000 })
  return res.data
}

export interface SavedSyllabusDraft {
  sections:     SyllabusSection[]
  competencies: DraftCompetency[]
  goals:        string[]
  review:       SyllabusReview | null
}

// Reload a previously saved РПД-студия draft for this course, if any —
// survives a page refresh instead of the studio always starting blank.
export async function getSavedSyllabusDraft(courseId: string): Promise<SavedSyllabusDraft | null> {
  const res = await client.get<{ draft: SavedSyllabusDraft | null }>(
    `/api/curriculum/syllabus-draft/${courseId}`
  )
  return res.data.draft
}

// Persist the current state (freehand edits or an updated coverage review)
// so a later refresh reopens exactly where the teacher left off.
export async function saveSyllabusDraft(data: {
  courseId:        string
  disciplineName:  string
  sections:        SyllabusSection[]
  competencies:    DraftCompetency[]
  goals:           string[]
  review:          SyllabusReview | null
}): Promise<void> {
  await client.put('/api/curriculum/syllabus-draft', {
    course_id:       data.courseId,
    discipline_name: data.disciplineName,
    sections:        data.sections,
    competencies:    data.competencies,
    goals:           data.goals,
    review:          data.review,
  })
}
