import client from './client'
import type { Rubric, RubricCriterion } from '../types'

export interface RubricTemplate extends Rubric {
  template_subject: string | null
}

export interface RubricPayload {
  name:       string
  course_id?: string
  criteria:   RubricCriterion[]
  is_default?: boolean
}

export async function getRubrics(courseId?: string): Promise<Rubric[]> {
  const res = await client.get<Rubric[]>('/api/rubrics', { params: { course_id: courseId } })
  return res.data
}

export async function getRubricTemplates(): Promise<RubricTemplate[]> {
  const res = await client.get<RubricTemplate[]>('/api/rubrics/templates')
  return res.data
}

export async function createRubric(data: RubricPayload): Promise<Rubric> {
  const res = await client.post<Rubric>('/api/rubrics', data)
  return res.data
}

export async function updateRubric(id: string, data: Partial<RubricPayload>): Promise<Rubric> {
  const res = await client.put<Rubric>(`/api/rubrics/${id}`, data)
  return res.data
}

export async function deleteRubric(id: string): Promise<void> {
  await client.delete(`/api/rubrics/${id}`)
}
