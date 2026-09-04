import client from './client'
import type { Course } from '../types'
import type { LectureTopic, PolicyMemo } from '../../../shared/types'

export async function getCourses(): Promise<Course[]> {
  const res = await client.get<Course[]>('/api/courses')
  return res.data
}

export async function createCourse(data: {
  name: string
  code?: string
  level?: string
  syllabus_text?: string
  profession_context?: string
}): Promise<Course> {
  const res = await client.post<Course>('/api/courses', data)
  return res.data
}

export async function updateCourse(
  id: string,
  data: {
    name?: string
    code?: string
    level?: string
    syllabus_text?: string
    profession_context?: string
    share_rag_with_institution?: boolean
  }
): Promise<Course> {
  const res = await client.put<Course>(`/api/courses/${id}`, data)
  return res.data
}

export async function deleteCourse(id: string): Promise<void> {
  await client.delete(`/api/courses/${id}`)
}

export async function getPolicyMemo(courseId: string): Promise<PolicyMemo | null> {
  const res = await client.get<PolicyMemo | null>(`/api/courses/${courseId}/policy-memo`)
  return res.data
}

export async function regeneratePolicyMemo(courseId: string): Promise<PolicyMemo | null> {
  const res = await client.post<PolicyMemo | null>(`/api/courses/${courseId}/policy-memo/regenerate`)
  return res.data
}

// ─── Тематический план (TODO.md "### AO" Phase 3) ───────────────────────────
//
// The lecture list of a course, read out of its РПД once and then owned by the
// teacher — the presentation form picks from it instead of asking for a topic
// and a lecture number to be retyped for every deck.

export async function getLecturePlan(courseId: string): Promise<LectureTopic[]> {
  const res = await client.get<LectureTopic[]>(`/api/courses/${courseId}/lecture-plan`)
  return res.data
}

export async function extractLecturePlan(courseId: string): Promise<LectureTopic[]> {
  const res = await client.post<LectureTopic[]>(`/api/courses/${courseId}/lecture-plan/extract`)
  return res.data
}

export async function saveLecturePlan(
  courseId: string,
  topics: Array<{ title: string; description?: string | null }>,
): Promise<LectureTopic[]> {
  const res = await client.put<LectureTopic[]>(`/api/courses/${courseId}/lecture-plan`, { topics })
  return res.data
}
