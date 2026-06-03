import client from './client'

export interface AdminOverview {
  totalTeachers:      number
  activeThisWeek:     number
  newThisMonth:       number
  totalGrades:        number
  totalPresentations: number
  gradesToday:        number
  todayCostUsd:       number
}

export interface DailyUsage {
  date:              string
  total_tokens:      number
  input_tokens:      number
  output_tokens:     number
  cost_usd:          number
  grade_count:       number
  presentation_count: number
  error_count:       number
}

export interface TeacherUsage {
  teacher_id:   string
  teacher_name: string | null
  email:        string
  total_tokens: number
  cost_usd:     number
  grade_count:  number
  last_active:  string | null
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const res = await client.get<AdminOverview>('/api/admin/overview')
  return res.data
}

export async function getDailyUsage(days = 30): Promise<DailyUsage[]> {
  const res = await client.get<DailyUsage[]>('/api/admin/usage/daily', { params: { days } })
  return res.data
}

export async function getUsageByTeacher(): Promise<TeacherUsage[]> {
  const res = await client.get<TeacherUsage[]>('/api/admin/usage/by-teacher')
  return res.data
}

export interface FeatureUsage {
  feature:             string
  total_tokens:        number
  cost_usd:            number
  call_count:          number
  avg_tokens_per_call: number
}

export async function getUsageByFeature(days = 30): Promise<FeatureUsage[]> {
  const res = await client.get<FeatureUsage[]>('/api/admin/usage/by-feature', { params: { days } })
  return res.data
}

export interface AdminTeacher {
  id:         string
  email:      string
  name:       string | null
  university: string | null
  role:       string
  plan_tier:  string
  is_active:  boolean
  grade_count: number
  created_at: string
}

export async function getAdminTeachers(params: { page?: number; search?: string } = {}): Promise<{ teachers: AdminTeacher[]; total: number }> {
  const res = await client.get<{ teachers: AdminTeacher[]; total: number }>('/api/admin/teachers', { params })
  return res.data
}

export async function patchTeacher(
  id: string,
  data: { role?: string; plan_tier?: string; is_active?: boolean }
): Promise<AdminTeacher> {
  const res = await client.patch<AdminTeacher>(`/api/admin/teachers/${id}`, data)
  return res.data
}

export interface AdminError {
  feature:    string
  error_code: string | null
  count:      number
  last_seen:  string
}

export async function getAdminErrors(days = 7): Promise<AdminError[]> {
  const res = await client.get<AdminError[]>('/api/admin/errors', { params: { days } })
  return res.data
}

export interface RubricTemplateCriterion {
  name: string; weight: number; max_score: number; description?: string
}

export interface RubricTemplate {
  id: string
  name: string
  criteria: RubricTemplateCriterion[]
  template_subject: string | null
  created_at: string
}

export async function getRubricTemplates(): Promise<RubricTemplate[]> {
  const res = await client.get<RubricTemplate[]>('/api/admin/rubrics/templates')
  return res.data
}

export async function createRubricTemplate(data: {
  name: string; criteria: RubricTemplateCriterion[]; template_subject: string
}): Promise<RubricTemplate> {
  const res = await client.post<RubricTemplate>('/api/admin/rubrics/templates', data)
  return res.data
}

export async function deleteRubricTemplate(id: string): Promise<void> {
  await client.delete(`/api/admin/rubrics/templates/${id}`)
}
