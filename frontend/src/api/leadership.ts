import client from './client'

export interface LeadershipUnit {
  id:                    string
  name:                  string
  short_name:            string | null
  type_code:             string
  role:                  'edit' | 'admin'
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

export interface LeadershipProgramUnitState {
  unit_id:              string
  unit_name:            string
  unit_short_name:      string | null
  program_id:           string | null
  program_name:         string | null
  program_code:         string | null
  program_level:        string | null
  has_description_doc:  boolean
  has_plan_doc:         boolean
  discipline_count:     number
  competency_count:     number
  last_analysis_at:     string | null
}

export interface LeadershipOverview {
  unit: { id: string; name: string; short_name: string | null; type_code: string }
  teachers: LeadershipTeacher[]
  activity: {
    grades_by_day:    { date: string; count: number }[]
    total_grades_30d: number
    teacher_count:    number
  }
  program_units: LeadershipProgramUnitState[]
}

export async function getLeadershipUnits(): Promise<LeadershipUnit[]> {
  return (await client.get<{ units: LeadershipUnit[] }>('/api/leadership/units')).data.units
}

export async function getLeadershipOverview(unitId: string): Promise<LeadershipOverview> {
  return (await client.get<LeadershipOverview>('/api/leadership/overview', { params: { unitId } })).data
}

// ─── Per-teacher drill (V2) ───────────────────────────────────────────────────

export interface LeadershipTeacherDrill {
  teacher: {
    id:                string
    email:             string
    name:              string | null
    primary_unit_name: string | null
  }
  activity: {
    total_grades_30d:      number
    approved_grades_30d:   number
    approval_rate_30d:     number | null
    avg_edit_distance_30d: number | null
    grades_by_day:         { date: string; count: number }[]
  }
  active_subjects: {
    course_id:  string
    name:       string
    grades_30d: number
  }[]
  recent_grades: {
    id:              string
    created_at:      string
    status:          string
    ai_score:        number | null
    ai_grade:        string | null
    approved_score:  number | null
    approved_grade:  string | null
    course_id:       string | null
    course_name:     string | null
    student_name:    string | null
  }[]
}

export async function getLeadershipTeacher(teacherId: string): Promise<LeadershipTeacherDrill> {
  return (await client.get<LeadershipTeacherDrill>(`/api/leadership/teachers/${teacherId}`)).data
}
