import { chatJSON, embed } from './deepseek'
import { findRubricById } from '../db/queries/rubrics'
import {
  createAssignment,
  approveAssignment,
  findSimilarAssignments,
  type SimilarAssignment,
} from '../db/queries/assignments'
import { generateAndStoreEmbedding } from './embeddings'
import { incrementUsage } from '../db/queries/usageCounters'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { canUseFeature } from '../config/planLimits'
import { NotFoundError } from '../errors/AppError'
import { logger } from '../lib/logger'
import type { Assignment, GradeLetter, CriterionScore, RubricCriterion } from '../../../shared/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GradeParams {
  teacherId:  string
  planTier:   string   // 'free' | 'pro' | 'institution'
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
  used_examples: number   // how many RAG examples were injected
}

// ─── RAG retrieval ────────────────────────────────────────────────────────────

/**
 * Embed the incoming submission and find the most similar approved assignments
 * for the same course. Returns [] silently if embeddings are unavailable.
 */
async function retrieveExamples(
  submissionText: string,
  courseId: string,
  teacherId: string
): Promise<SimilarAssignment[]> {
  try {
    const vector = await embed(submissionText, { teacherId, feature: 'embedding' })
    return await findSimilarAssignments(courseId, vector, 5)
  } catch (err) {
    // Non-fatal — RAG is a quality boost, not a hard requirement
    logger.warn({ message: '[RAG] Could not retrieve similar examples', error: (err as Error).message })
    return []
  }
}

// ─── Grade ────────────────────────────────────────────────────────────────────

export async function grade(params: GradeParams): Promise<GradeResponse> {
  // RAG flywheel only available on Pro/Institution — free tier grades without examples
  const ragEnabled = canUseFeature(params.planTier, 'ragFlywheel')

  const [rubric, examples] = await Promise.all([
    params.rubricId ? findRubricById(params.rubricId, params.teacherId) : Promise.resolve(null),
    ragEnabled && params.courseId
      ? retrieveExamples(params.submissionText, params.courseId, params.teacherId)
      : Promise.resolve([]),
  ])

  const systemPrompt =
    `Вы опытный преподаватель-эксперт. Ваша задача — объективно оценивать студенческие работы ` +
    `и давать конструктивную обратную связь на русском языке. Всегда отвечайте только валидным JSON.`

  const userPrompt = rubric
    ? buildRubricPrompt(params.submissionText, rubric.name, rubric.criteria, examples)
    : buildHolisticPrompt(params.submissionText, examples)

  const result = await chatJSON<AIGradingResult>(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    'результат оценивания',
    { teacherId: params.teacherId, feature: 'grading' }
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
    aiFeedback: applyWatermark(result.feedback ?? '', params.planTier),
    aiCriteriaScores: result.criteria_scores ?? [],
    aiStrengths: result.strengths ?? [],
    aiImprovements: result.improvements ?? [],
  })

  // Increment usage counter — fire-and-forget
  incrementUsage(params.teacherId, 'grade').catch(() => null)

  return {
    assignment_id: assignment.id,
    ai_score: assignment.ai_score!,
    ai_grade: assignment.ai_grade!,
    ai_grade_label: assignment.ai_grade_label!,
    ai_feedback: assignment.ai_feedback!,
    ai_criteria_scores: assignment.ai_criteria_scores ?? [],
    ai_strengths: assignment.ai_strengths ?? [],
    ai_improvements: assignment.ai_improvements ?? [],
    used_examples: examples.length,
  }
}

function applyWatermark(feedback: string, planTier: string): string {
  if (!canUseFeature(planTier, 'watermark')) return feedback
  return feedback + '\n\n---\nСгенерировано с GradeAssist (бесплатный тариф) · gradeassist.ru'
}

// ─── Approve ─────────────────────────────────────────────────────────────────

export async function approve(
  id: string,
  teacherId: string,
  data: { approvedScore: number; approvedGrade: GradeLetter; approvedFeedback: string }
): Promise<Assignment> {
  const assignment = await approveAssignment(id, teacherId, data)
  if (!assignment) throw new NotFoundError('Работа')

  // Fire-and-forget — store embedding so future gradings can use this as an example
  generateAndStoreEmbedding(id, assignment.submission_text).catch(() => null)

  return assignment
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildExamplesBlock(examples: SimilarAssignment[]): string {
  if (examples.length === 0) return ''

  const items = examples
    .map(
      (ex, i) => `### Пример ${i + 1}
Работа студента (фрагмент):
${ex.submission_text.slice(0, 600)}${ex.submission_text.length > 600 ? '…' : ''}

Оценка преподавателя: ${ex.approved_grade} (${ex.approved_score}/100)
Отзыв преподавателя: ${ex.approved_feedback}`
    )
    .join('\n\n---\n\n')

  return `## Примеры оценённых работ по этому курсу
Используйте их как ориентир для калибровки своей оценки.

${items}

`
}

function buildRubricPrompt(
  text: string,
  rubricName: string,
  criteria: RubricCriterion[],
  examples: SimilarAssignment[]
): string {
  const criteriaBlock = criteria
    .map((c) => `- ${c.name} (вес: ${c.weight}, максимум: ${c.max_score}): ${c.description}`)
    .join('\n')

  return `${buildExamplesBlock(examples)}## Рубрика: ${rubricName}

${criteriaBlock}

## Работа студента
<student_submission>
${sanitiseForPrompt(text)}
</student_submission>

## Инструкция
Оцените работу по каждому критерию рубрики. Верните JSON-объект со следующими полями:
- "score": итоговый взвешенный балл от 0 до 100
- "grade": одно из "A", "B", "C", "D", "F"  (A≥90, B≥75, C≥60, D≥50, F<50)
- "grade_label": одно из "Отлично", "Хорошо", "Удовлетворительно", "Плохо", "Неудовлетворительно"
- "feedback": общий отзыв на 2–3 абзаца на русском языке
- "criteria_scores": массив {"name": string, "score": число 0–100, "feedback": string}
- "strengths": массив из 3–5 конкретных достоинств работы
- "improvements": массив из 3–5 конкретных областей для улучшения

Ответьте ТОЛЬКО JSON-объектом, без пояснений.`
}

function buildHolisticPrompt(text: string, examples: SimilarAssignment[]): string {
  return `${buildExamplesBlock(examples)}## Работа студента
<student_submission>
${sanitiseForPrompt(text)}
</student_submission>

## Инструкция
Оцените работу в целом по академическим стандартам. Верните JSON-объект со следующими полями:
- "score": итоговый балл от 0 до 100
- "grade": одно из "A", "B", "C", "D", "F"  (A≥90, B≥75, C≥60, D≥50, F<50)
- "grade_label": одно из "Отлично", "Хорошо", "Удовлетворительно", "Плохо", "Неудовлетворительно"
- "feedback": общий отзыв на 2–3 абзаца на русском языке
- "criteria_scores": [] (пустой массив — без рубрики)
- "strengths": массив из 3–5 конкретных достоинств работы
- "improvements": массив из 3–5 конкретных областей для улучшения

Ответьте ТОЛЬКО JSON-объектом, без пояснений.`
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
  return (
    { A: 'Отлично', B: 'Хорошо', C: 'Удовлетворительно', D: 'Плохо', F: 'Неудовлетворительно' }[g] ??
    'Неизвестно'
  )
}
