import client from './client'
import type { Rubric, RubricItem, CriterionSubject } from '../types'
import type { OrgUnitType } from './orgStructure'

// Root-first ancestor-or-self chain (own department → faculty → institution)
// — the units a teacher may share a rubric/criterion into.
export interface ShareTarget {
  id:         string
  name:       string
  type_code:  OrgUnitType
}

export interface RubricPayload {
  name:         string
  description?: string | null
  course_id?:   string
  subject?:     CriterionSubject
  items:        RubricItem[]
}

export async function getRubrics(courseId?: string): Promise<Rubric[]> {
  const res = await client.get<Rubric[]>('/api/rubrics', { params: { course_id: courseId } })
  return res.data
}

export async function getRubricTemplates(): Promise<Rubric[]> {
  const res = await client.get<Rubric[]>('/api/rubrics/templates')
  return res.data
}

export async function getRubricShareTargets(): Promise<ShareTarget[]> {
  const res = await client.get<ShareTarget[]>('/api/rubrics/share-targets')
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

export async function shareRubric(id: string, unitId: string): Promise<Rubric> {
  const res = await client.post<Rubric>(`/api/rubrics/${id}/share`, { unit_id: unitId })
  return res.data
}

export async function unshareRubric(id: string): Promise<Rubric> {
  const res = await client.post<Rubric>(`/api/rubrics/${id}/unshare`)
  return res.data
}
