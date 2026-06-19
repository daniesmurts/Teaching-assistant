import client from './client'
import type { CurriculumAnalysis, SyllabusReview, SyllabusDraft } from '../types'

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
