import client from './client'
import type { Criterion, CriterionSubject } from '../types'

export interface CriterionPayload {
  name:         string
  description?: string | null
  course_id?:   string
  subject?:     CriterionSubject
}

export async function getCriteria(courseId?: string): Promise<Criterion[]> {
  const res = await client.get<Criterion[]>('/api/criteria', { params: { course_id: courseId } })
  return res.data
}

export async function getCriteriaTemplates(): Promise<Criterion[]> {
  const res = await client.get<Criterion[]>('/api/criteria/templates')
  return res.data
}

export async function createCriterion(data: CriterionPayload): Promise<Criterion> {
  const res = await client.post<Criterion>('/api/criteria', data)
  return res.data
}

export async function updateCriterion(id: string, data: Partial<CriterionPayload>): Promise<Criterion> {
  const res = await client.put<Criterion>(`/api/criteria/${id}`, data)
  return res.data
}

export async function deleteCriterion(id: string): Promise<void> {
  await client.delete(`/api/criteria/${id}`)
}

export async function improveCriterionDescription(name: string, description: string): Promise<string> {
  const res = await client.post<{ improved: string }>('/api/criteria/improve-description', { name, description })
  return res.data.improved
}
