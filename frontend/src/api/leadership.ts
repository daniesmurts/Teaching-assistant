import client from './client'

export interface LeadershipUnit {
  id:                    string
  name:                  string
  short_name:            string | null
  type_code:             string
  role:                  'head' | 'admin'
  subtree_teacher_count: number
}

export interface LeadershipTeacher {
  id:                string
  name:              string | null
  email:             string
  primary_unit_name: string | null
  grades_30d:        number
  last_active_at:    string | null
}

export interface LeadershipOverview {
  unit: { id: string; name: string; short_name: string | null; type_code: string }
  teachers: LeadershipTeacher[]
  activity: {
    grades_by_day:    { date: string; count: number }[]
    total_grades_30d: number
    teacher_count:    number
  }
}

export async function getLeadershipUnits(): Promise<LeadershipUnit[]> {
  return (await client.get<{ units: LeadershipUnit[] }>('/api/leadership/units')).data.units
}

export async function getLeadershipOverview(unitId: string): Promise<LeadershipOverview> {
  return (await client.get<LeadershipOverview>('/api/leadership/overview', { params: { unitId } })).data
}
