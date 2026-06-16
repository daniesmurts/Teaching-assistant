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
    share_rag_with_institution?: boolean
  }
): Promise<Course> {
  const res = await client.put<Course>(`/api/courses/${id}`, data)
  return res.data
}

export async function deleteCourse(id: string): Promise<void> {
  await client.delete(`/api/courses/${id}`)
}
