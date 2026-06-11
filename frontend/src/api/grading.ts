import client from './client'
import type {
  Assignment, GradeLetter, LongReview, RevisionCheckItem, CriteriaSnapshotItem,
} from '../types'

export interface GradeRequest {
  submission_text: string
  criterion_ids?: string[]                   // 0–10 chosen criteria
  weights?: number[]                         // same length, sum to 100
  course_id?: string
  student_name?: string
  student_email?: string
  student_group?: string
  reference_solution?: string
  assignment_type?: 'essay' | 'calculation'
  parent_assignment_id?: string
}

export interface GradeResponse {
  assignment_id: string
  ai_score: number
  ai_grade: GradeLetter
  ai_grade_label: string
  ai_feedback: string
  ai_criteria_scores: { name: string; score: number; feedback: string }[]
  ai_strengths: string[]
  ai_improvements: string[]
  ai_revision_check: RevisionCheckItem[] | null
  criteria_snapshot: CriteriaSnapshotItem[] | null
  used_examples: number
  revision_number: number
  parent_assignment_id: string | null
}

// Fetch a single assignment (used to pre-fill the form when grading a revision)
export async function getAssignment(id: string): Promise<Assignment> {
  const res = await client.get<Assignment>(`/api/grading/assignment/${id}`)
  return res.data
}

export async function gradeSubmission(data: GradeRequest): Promise<GradeResponse> {
  const res = await client.post<GradeResponse>('/api/grading/grade', data)
  return res.data
}

export async function approveGrade(
  id: string,
  data: {
    approved_score: number
    approved_grade: GradeLetter
    approved_feedback: string
    approved_strengths?:    string[]
    approved_improvements?: string[]
  }
): Promise<{ assignment: Assignment }> {
  const res = await client.post<{ assignment: Assignment }>(`/api/grading/${id}/approve`, data)
  return res.data
}

export async function generateEmail(
  id: string,
  tone?: 'encouraging' | 'neutral' | 'direct'
): Promise<{ subject: string; body: string }> {
  const res = await client.post<{ subject: string; body: string }>(`/api/grading/${id}/email`, { tone })
  return res.data
}

export interface GradingStats {
  total: number
  pending: number
  this_month: number
  last_month: number
  avg_score: number | null
}

export async function getGradingStats(): Promise<GradingStats> {
  const res = await client.get<GradingStats>('/api/grading/stats')
  return res.data
}

export async function getGradingHistory(params?: {
  course_id?: string
  student_name?: string
  student_group?: string
  search?: string
  status?: string
  page?: number
  limit?: number
}): Promise<{ assignments: Assignment[]; total: number }> {
  const res = await client.get<{ assignments: Assignment[]; total: number }>('/api/grading/history', { params })
  return res.data
}

export interface StudentSummary {
  student_name:    string
  student_group:   string | null
  submissions:     number
  avg_score:       number | null
  last_submission: string
}

export async function getStudents(courseId?: string): Promise<StudentSummary[]> {
  const res = await client.get<StudentSummary[]>('/api/grading/students', { params: { course_id: courseId } })
  return res.data
}

// ─── Long-document review (ВКР / диплом) ───────────────────────────────────────

export interface ReviewRequest {
  submission_text: string
  criterion_ids?: string[]
  weights?:       number[]
  course_id?:     string
  student_name?:  string
  student_email?: string
  student_group?: string
}

export async function startReview(data: ReviewRequest): Promise<LongReview> {
  const res = await client.post<LongReview>('/api/grading/review', data)
  return res.data
}

export async function getReview(id: string): Promise<LongReview> {
  const res = await client.get<LongReview>(`/api/grading/review/${id}`)
  return res.data
}

// Revisit the long review behind an assignment (null if it was a normal grade).
export async function getReviewByAssignment(assignmentId: string): Promise<LongReview | null> {
  const res = await client.get<{ review: LongReview | null }>(`/api/grading/assignment/${assignmentId}/review`)
  return res.data.review
}
