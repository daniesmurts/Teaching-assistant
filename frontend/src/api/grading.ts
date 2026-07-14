import client from './client'
import type {
  Assignment, GradeLetter, LongReview, RevisionCheckItem, CriteriaSnapshotItem, CriterionScore,
  ConfidenceLevel, AiEnsemble, BulletItem, VerificationQuestion, QuestionResponse,
  ApprovedEditReason, ApprovedRevision, CalcStepVerdict, CitationVerdict,
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
  assignment_context?: string
  assignment_type?: 'essay' | 'calculation'
  parent_assignment_id?: string
  thorough?: boolean                         // run the confidence ensemble (Pro+)
  check_citations?: boolean                  // check bibliography against a web search (Pro+, opt-in)
}

export interface GradeResponse {
  assignment_id: string
  ai_score: number
  ai_grade: GradeLetter
  ai_grade_label: string
  ai_feedback: string
  ai_criteria_scores: CriterionScore[]
  ai_strengths: BulletItem[]
  ai_improvements: BulletItem[]
  ai_verification_questions: VerificationQuestion[]
  ai_revision_check: RevisionCheckItem[] | null
  ai_question_responses: QuestionResponse[] | null
  criteria_snapshot: CriteriaSnapshotItem[] | null
  ai_confidence: ConfidenceLevel | null
  ai_ensemble: AiEnsemble | null
  ai_calc_verification: CalcStepVerdict[]
  ai_citation_check: CitationVerdict[]
  used_examples: number
  revision_number: number
  parent_assignment_id: string | null
}

// Fetch a single assignment (used to pre-fill the form when grading a revision)
export async function getAssignment(id: string): Promise<Assignment> {
  const res = await client.get<Assignment>(`/api/grading/assignment/${id}`)
  return res.data
}

/**
 * How many times this approved grade has been used as a RAG example by
 * another teacher inside the same institution (institutional flywheel).
 * Returns zeros when this assignment hasn't fed any colleague's grading.
 */
export async function getAssignmentCrossUses(id: string): Promise<{
  count_lifetime: number
  count_30d:      number
}> {
  const res = await client.get<{ count_lifetime: number; count_30d: number }>(
    `/api/grading/assignment/${id}/cross-uses`
  )
  return res.data
}

export async function gradeSubmission(data: GradeRequest): Promise<GradeResponse> {
  const res = await client.post<GradeResponse>('/api/grading/grade', data)
  return res.data
}

// ─── Async grade jobs ─────────────────────────────────────────────────────────
// Grading (calc mode especially) can run for minutes — longer than any HTTP
// timeout — so the client enqueues a job and polls, same as long reviews.

export type GradeJobStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface GradeJob {
  id:            string
  status:        GradeJobStatus
  assignment_id: string | null
  result:        GradeResponse | null
  error_message: string | null
  created_at:    string
}

export async function startGradeJob(data: GradeRequest): Promise<GradeJob> {
  const res = await client.post<GradeJob>('/api/grading/grade-jobs', data)
  return res.data
}

export async function getGradeJob(id: string): Promise<GradeJob> {
  const res = await client.get<GradeJob>(`/api/grading/grade-jobs/${id}`)
  return res.data
}

export async function approveGrade(
  id: string,
  data: {
    approved_score: number
    approved_grade: GradeLetter
    approved_feedback: string
    approved_strengths?:    BulletItem[]
    approved_improvements?: BulletItem[]
    approved_criteria_scores?: CriterionScore[]
    approved_edit_reason?:     ApprovedEditReason
  }
): Promise<{ assignment: Assignment }> {
  const res = await client.post<{ assignment: Assignment }>(`/api/grading/${id}/approve`, data)
  return res.data
}

/** Audit trail of every approve mutation on an assignment, newest first. */
export async function getApprovalHistory(id: string): Promise<ApprovedRevision[]> {
  const res = await client.get<{ history: ApprovedRevision[] }>(
    `/api/grading/assignment/${id}/approval-history`
  )
  return res.data.history
}

export async function generateEmail(
  id: string,
  tone?: 'encouraging' | 'neutral' | 'direct'
): Promise<{ subject: string; body: string }> {
  const res = await client.post<{ subject: string; body: string }>(`/api/grading/${id}/email`, { tone })
  return res.data
}

export async function composeHandout(
  id: string,
  data: {
    improvements: string[]
    questions:    string[]
    tone?:        'encouraging' | 'neutral' | 'direct'
  }
): Promise<{ subject: string; body: string }> {
  const res = await client.post<{ subject: string; body: string }>(`/api/grading/${id}/handout`, data)
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

export interface TrajectoryEntry {
  id:              string
  created_at:      string
  score:           number | null
  grade:           GradeLetter | null
  criteria_scores: CriterionScore[] | null
}

/** Last few grades for a known student — powers the grading screen's "За семестр" tab (Feature B). */
export async function getStudentTrajectory(params: {
  student_name:  string
  student_group?: string
  course_id?:    string
  exclude_id?:   string
}): Promise<TrajectoryEntry[]> {
  const res = await client.get<TrajectoryEntry[]>('/api/grading/student-trajectory', { params })
  return res.data
}

export interface GroupBreakdown {
  group:     string | null
  count:     number
  avg_score: number | null
  histogram: Record<string, number>
}

export interface MissedCriterion {
  name:      string
  avg_score: number
  count:     number
}

export interface SlippingStudent {
  student_name:  string
  student_group: string | null
  recent_avg:    number
  prior_avg:     number
  delta:         number
}

export interface CohortAnalytics {
  total_students:      number
  total_submissions:   number
  histogram:            Record<string, number>
  by_group:             GroupBreakdown[]
  top_missed_criteria:  MissedCriterion[]
  slipping:             SlippingStudent[]
}

/** Roster-wide grade distribution, per-group breakdown, weakest criteria, and who's slipping — pure aggregation, no AI (Feature C). */
export async function getCohortAnalytics(courseId?: string): Promise<CohortAnalytics> {
  const res = await client.get<CohortAnalytics>('/api/grading/cohort-analytics', { params: { course_id: courseId } })
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
  /** Чертежи (TODO Feature N) — OCR'd client-side (via /api/documents/upload) before submission. */
  drawings?:      Array<{ file_name: string; extracted_text: string }>
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
