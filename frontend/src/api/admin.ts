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
