import { pool } from '../connection'
import type { Assignment, GradeLetter, CriterionScore } from '../../../../shared/types'

interface AssignmentRow {
  id: string
  teacher_id: string
  course_id: string | null
  rubric_id: string | null
  student_name: string | null
  student_email: string | null
  submission_text: string
  ai_score: number | null
  ai_grade: string | null
  ai_grade_label: string | null
  ai_feedback: string | null
  ai_criteria_scores: CriterionScore[] | null
  ai_strengths: string[] | null
  ai_improvements: string[] | null
  approved_score: number | null
  approved_grade: string | null
  approved_feedback: string | null
  approved_at: Date | null
  status: string
  created_at: Date
}

function toAssignment(row: AssignmentRow): Assignment {
  return {
    id: row.id,
    teacher_id: row.teacher_id,
    course_id: row.course_id,
    rubric_id: row.rubric_id,
    student_name: row.student_name,
    student_email: row.student_email,
    submission_text: row.submission_text,
    ai_score: row.ai_score,
    ai_grade: row.ai_grade as GradeLetter | null,
    ai_grade_label: row.ai_grade_label,
    ai_feedback: row.ai_feedback,
    ai_criteria_scores: row.ai_criteria_scores,
    ai_strengths: row.ai_strengths,
    ai_improvements: row.ai_improvements,
    approved_score: row.approved_score,
    approved_grade: row.approved_grade as GradeLetter | null,
    approved_feedback: row.approved_feedback,
    approved_at: row.approved_at?.toISOString() ?? null,
    status: row.status as Assignment['status'],
    created_at: row.created_at.toISOString(),
  }
}

export async function createAssignment(data: {
  teacherId: string
  courseId?: string
  rubricId?: string
  studentName?: string
  studentEmail?: string
  submissionText: string
  aiScore: number
  aiGrade: GradeLetter
  aiGradeLabel: string
  aiFeedback: string
  aiCriteriaScores: CriterionScore[]
  aiStrengths: string[]
  aiImprovements: string[]
}): Promise<Assignment> {
  const { rows } = await pool.query<AssignmentRow>(
    `INSERT INTO assignments (
       teacher_id, course_id, rubric_id, student_name, student_email,
       submission_text, ai_score, ai_grade, ai_grade_label, ai_feedback,
       ai_criteria_scores, ai_strengths, ai_improvements, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')
     RETURNING *`,
    [
      data.teacherId,
      data.courseId ?? null,
      data.rubricId ?? null,
      data.studentName ?? null,
      data.studentEmail ?? null,
      data.submissionText,
      data.aiScore,
      data.aiGrade,
      data.aiGradeLabel,
      data.aiFeedback,
      JSON.stringify(data.aiCriteriaScores),
      data.aiStrengths,
      data.aiImprovements,
    ]
  )
  return toAssignment(rows[0])
}

export async function findAssignmentById(id: string, teacherId: string): Promise<Assignment | null> {
  const { rows } = await pool.query<AssignmentRow>(
    'SELECT * FROM assignments WHERE id = $1 AND teacher_id = $2 LIMIT 1',
    [id, teacherId]
  )
  return rows[0] ? toAssignment(rows[0]) : null
}

export async function approveAssignment(
  id: string,
  teacherId: string,
  data: { approvedScore: number; approvedGrade: GradeLetter; approvedFeedback: string }
): Promise<Assignment | null> {
  const { rows } = await pool.query<AssignmentRow>(
    `UPDATE assignments
     SET approved_score    = $3,
         approved_grade    = $4,
         approved_feedback = $5,
         approved_at       = NOW(),
         status            = 'approved'
     WHERE id = $1 AND teacher_id = $2
     RETURNING *`,
    [id, teacherId, data.approvedScore, data.approvedGrade, data.approvedFeedback]
  )
  return rows[0] ? toAssignment(rows[0]) : null
}

export async function updateEmbedding(id: string, embedding: number[]): Promise<void> {
  await pool.query(
    `UPDATE assignments SET embedding = $2 WHERE id = $1`,
    [id, `[${embedding.join(',')}]`]
  )
}

export interface SimilarAssignment {
  submission_text: string
  approved_score: number
  approved_grade: string
  approved_feedback: string
}

export async function findSimilarAssignments(
  courseId: string,
  embedding: number[],
  limit = 5
): Promise<SimilarAssignment[]> {
  const { rows } = await pool.query<SimilarAssignment>(
    `SELECT submission_text, approved_score, approved_grade, approved_feedback
     FROM assignments
     WHERE course_id = $1
       AND status = 'approved'
       AND embedding IS NOT NULL
     ORDER BY embedding <=> $2
     LIMIT $3`,
    [courseId, `[${embedding.join(',')}]`, limit]
  )
  return rows
}

export async function findAssignmentsByTeacher(
  teacherId: string,
  options: { courseId?: string; page?: number; limit?: number }
): Promise<{ assignments: Assignment[]; total: number }> {
  const page = Math.max(1, options.page ?? 1)
  const limit = Math.min(50, options.limit ?? 20)
  const offset = (page - 1) * limit

  const whereClause = options.courseId
    ? 'WHERE teacher_id = $1 AND course_id = $2'
    : 'WHERE teacher_id = $1'
  const params: unknown[] = options.courseId ? [teacherId, options.courseId] : [teacherId]

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query<AssignmentRow>(
      `SELECT * FROM assignments ${whereClause} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM assignments ${whereClause}`,
      params
    ),
  ])

  return {
    assignments: rows.map(toAssignment),
    total: parseInt(countRows[0].count, 10),
  }
}
