import client from './client'
import type { Assignment, GradeLetter } from '../types'

export interface GradeRequest {
  submission_text: string
  rubric_id?: string
  course_id?: string
  student_name?: string
  student_email?: string
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
}

export async function gradeSubmission(data: GradeRequest): Promise<GradeResponse> {
  const res = await client.post<GradeResponse>('/api/grading/grade', data)
  return res.data
}

export async function approveGrade(
  id: string,
  data: { approved_score: number; approved_grade: GradeLetter; approved_feedback: string }
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

export async function getGradingHistory(params?: {
  course_id?: string
  page?: number
  limit?: number
}): Promise<{ assignments: Assignment[]; total: number }> {
  const res = await client.get<{ assignments: Assignment[]; total: number }>('/api/grading/history', { params })
  return res.data
}
