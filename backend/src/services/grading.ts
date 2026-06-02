import { chatJSON } from './deepseek'
import { findRubricById } from '../db/queries/rubrics'
import { createAssignment, approveAssignment, findAssignmentById } from '../db/queries/assignments'
import { generateAndStoreEmbedding } from './embeddings'
import type { Assignment, GradeLetter, CriterionScore, RubricCriterion } from '../../../shared/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GradeParams {
  teacherId: string
  submissionText: string
  rubricId?: string
  courseId?: string
  studentName?: string
  studentEmail?: string
}

interface AIGradingResult {
  score: number
  grade: GradeLetter
  grade_label: string
  feedback: string
  criteria_scores: CriterionScore[]
  strengths: string[]
  improvements: string[]
}

export interface GradeResponse {
  assignment_id: string
  ai_score: number
  ai_grade: GradeLetter
  ai_grade_label: string
  ai_feedback: string
  ai_criteria_scores: CriterionScore[]
  ai_strengths: string[]
  ai_improvements: string[]
}

// ─── Grade ────────────────────────────────────────────────────────────────────

export async function grade(params: GradeParams): Promise<GradeResponse> {
  const rubric = params.rubricId
    ? await findRubricById(params.rubricId, params.teacherId)
    : null

  const systemPrompt = `You are an expert academic grader. Your job is to grade student assignments fairly and provide constructive feedback. Always respond with valid JSON only.`

  const userPrompt = rubric
    ? buildRubricPrompt(params.submissionText, rubric.name, rubric.criteria)
    : buildHolisticPrompt(params.submissionText)

  const result = await chatJSON<AIGradingResult>(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    'grading result'
  )

  const assignment = await createAssignment({
    teacherId: params.teacherId,
    courseId: params.courseId,
    rubricId: params.rubricId,
    studentName: params.studentName,
    studentEmail: params.studentEmail,
    submissionText: params.submissionText,
    aiScore: clampScore(result.score),
    aiGrade: normaliseGrade(result.grade),
    aiGradeLabel: result.grade_label ?? gradeToLabel(result.grade),
    aiFeedback: result.feedback ?? '',
    aiCriteriaScores: result.criteria_scores ?? [],
    aiStrengths: result.strengths ?? [],
    aiImprovements: result.improvements ?? [],
  })

  return {
    assignment_id: assignment.id,
    ai_score: assignment.ai_score!,
    ai_grade: assignment.ai_grade!,
    ai_grade_label: assignment.ai_grade_label!,
    ai_feedback: assignment.ai_feedback!,
    ai_criteria_scores: assignment.ai_criteria_scores ?? [],
    ai_strengths: assignment.ai_strengths ?? [],
    ai_improvements: assignment.ai_improvements ?? [],
  }
}

// ─── Approve ─────────────────────────────────────────────────────────────────

export async function approve(
  id: string,
  teacherId: string,
  data: { approvedScore: number; approvedGrade: GradeLetter; approvedFeedback: string }
): Promise<Assignment> {
  const assignment = await approveAssignment(id, teacherId, data)
  if (!assignment) throw Object.assign(new Error('Assignment not found'), { status: 404 })

  // Fire-and-forget embedding — do NOT await
  generateAndStoreEmbedding(id, assignment.submission_text).catch(() => null)

  return assignment
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildRubricPrompt(text: string, rubricName: string, criteria: RubricCriterion[]): string {
  const criteriaBlock = criteria
    .map(
      (c) =>
        `- ${c.name} (weight: ${c.weight}, max score: ${c.max_score}): ${c.description}`
    )
    .join('\n')

  return `## Rubric: ${rubricName}

${criteriaBlock}

## Student Submission
${text}

## Instructions
Grade this submission against each rubric criterion. Return a JSON object with:
- "score": overall weighted score 0–100
- "grade": one of "A", "B", "C", "D", "F"  (A≥90, B≥75, C≥60, D≥50, F<50)
- "grade_label": one of "Excellent", "Good", "Satisfactory", "Poor", "Failing"
- "feedback": 2–3 paragraph overall feedback
- "criteria_scores": array of {"name": string, "score": number (0–100), "feedback": string}
- "strengths": array of 3–5 specific strengths observed
- "improvements": array of 3–5 specific areas for improvement

Respond ONLY with the JSON object.`
}

function buildHolisticPrompt(text: string): string {
  return `## Student Submission
${text}

## Instructions
Grade this submission holistically using academic standards. Return a JSON object with:
- "score": overall score 0–100
- "grade": one of "A", "B", "C", "D", "F"  (A≥90, B≥75, C≥60, D≥50, F<50)
- "grade_label": one of "Excellent", "Good", "Satisfactory", "Poor", "Failing"
- "feedback": 2–3 paragraph overall feedback
- "criteria_scores": [] (empty array — no rubric)
- "strengths": array of 3–5 specific strengths observed
- "improvements": array of 3–5 specific areas for improvement

Respond ONLY with the JSON object.`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampScore(n: unknown): number {
  const num = typeof n === 'number' ? n : parseInt(String(n), 10)
  return Math.max(0, Math.min(100, isNaN(num) ? 0 : num))
}

function normaliseGrade(g: unknown): GradeLetter {
  const valid: GradeLetter[] = ['A', 'B', 'C', 'D', 'F']
  const s = String(g).toUpperCase().trim() as GradeLetter
  return valid.includes(s) ? s : 'F'
}

function gradeToLabel(g: GradeLetter): string {
  return { A: 'Excellent', B: 'Good', C: 'Satisfactory', D: 'Poor', F: 'Failing' }[g] ?? 'Unknown'
}
