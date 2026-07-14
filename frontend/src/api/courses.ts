import client from './client'
import type { Course } from '../types'

export async function getCourses(): Promise<Course[]> {
  const res = await client.get<Course[]>('/api/courses')
  return res.data
}

export async function getCourse(id: string): Promise<Course> {
  const res = await client.get<Course>(`/api/courses/${id}`)
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

export interface PolicyMemo {
  course_id:      string
  memo_text:      string
  based_on_count: number
  generated_at:   string
  model_used:     string | null
}

export async function getPolicyMemo(courseId: string): Promise<PolicyMemo | null> {
  const res = await client.get<PolicyMemo | null>(`/api/courses/${courseId}/policy-memo`)
  return res.data
}

export async function regeneratePolicyMemo(courseId: string): Promise<PolicyMemo | null> {
  const res = await client.post<PolicyMemo | null>(`/api/courses/${courseId}/policy-memo/regenerate`)
  return res.data
}
