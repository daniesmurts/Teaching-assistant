import client from './client'
import type { Criterion, CriterionSubject } from '../types'
import type { ShareTarget } from './rubrics'

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

export async function getCriteriaShareTargets(): Promise<ShareTarget[]> {
  const res = await client.get<ShareTarget[]>('/api/criteria/share-targets')
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

export async function shareCriterion(id: string, unitId: string): Promise<Criterion> {
  const res = await client.post<Criterion>(`/api/criteria/${id}/share`, { unit_id: unitId })
  return res.data
}

export async function unshareCriterion(id: string): Promise<Criterion> {
  const res = await client.post<Criterion>(`/api/criteria/${id}/unshare`)
  return res.data
}
