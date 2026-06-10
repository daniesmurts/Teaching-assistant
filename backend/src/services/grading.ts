import { chatJSON, embed, REASONER_MODEL } from './deepseek'
import { findRubricById } from '../db/queries/rubrics'
import {
  createAssignment,
  approveAssignment,
  findAssignmentById,
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
  studentGroup?: string
  referenceSolution?: string                  // эталонное решение / правильный ответ
  assignmentType?: 'essay' | 'calculation'    // 'calculation' → reasoning model + STEM guidance
  parentAssignmentId?: string                 // link to previous version (revision flow)
}

interface RevisionCheckItem {
  point:  string
  status: 'addressed' | 'partial' | 'not_addressed'
  note:   string
}

interface AIGradingResult {
  score: number
  grade: GradeLetter
  grade_label: string
  feedback: string
  criteria_scores: CriterionScore[]
  strengths: string[]
  improvements: string[]
  revision_check?: RevisionCheckItem[]   // present only when grading a revision
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
  ai_revision_check: RevisionCheckItem[] | null
  used_examples: number          // how many RAG examples were injected
  revision_number: number        // 1 = original, 2+ = revised version
  parent_assignment_id: string | null
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

  const [rubric, examples, parent] = await Promise.all([
    params.rubricId ? findRubricById(params.rubricId, params.teacherId) : Promise.resolve(null),
    ragEnabled && params.courseId
      ? retrieveExamples(params.submissionText, params.courseId, params.teacherId)
      : Promise.resolve([]),
    params.parentAssignmentId
      ? findAssignmentById(params.parentAssignmentId, params.teacherId)
      : Promise.resolve(null),
  ])

  // Revision context — built only when the teacher explicitly linked a previous
  // version. Prefer the teacher's approved values; fall back to the AI's draft
  // (which is what's there if v1 wasn't approved before the resubmission).
  const isRevision = parent != null
  const revisionBlock = isRevision ? buildRevisionContext(parent) : ''

  const isCalc = params.assignmentType === 'calculation'

  const systemPrompt = isCalc
    ? `Вы опытный преподаватель точных наук (математика, физика, инженерные дисциплины). ` +
      `Проверяйте расчётные задачи строго: пошагово пересчитывайте решение, проверяйте формулы, ` +
      `единицы измерения, размерности и числовой ответ. Отличайте ошибку метода от арифметической описки ` +
      `и справедливо начисляйте частичный балл за верный ход решения. ` +
      `Давайте обратную связь на русском языке. Всегда отвечайте только валидным JSON-объектом.`
    : `Вы опытный преподаватель-эксперт. Ваша задача — объективно оценивать студенческие работы ` +
      `и давать конструктивную обратную связь на русском языке. Всегда отвечайте только валидным JSON.`

  const reference = params.referenceSolution?.trim()
    ? `## Эталонное решение / правильный ответ
Сравнивайте работу студента с этим эталоном. Если ответ студента совпадает по существу — засчитывайте, даже если оформление отличается.
<reference_solution>
${sanitiseForPrompt(params.referenceSolution.trim())}
</reference_solution>

`
    : ''

  const userPrompt = revisionBlock + reference + (rubric
    ? buildRubricPrompt(params.submissionText, rubric.name, rubric.criteria, examples, isCalc, isRevision)
    : buildHolisticPrompt(params.submissionText, examples, isCalc, isRevision))

  const result = await chatJSON<AIGradingResult>(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    'результат оценивания',
    { teacherId: params.teacherId, feature: 'grading' },
    isCalc ? REASONER_MODEL : undefined,   // calculation grading → reasoning model
  )

  // Revision check is only meaningful when this is a revision.
  const revisionCheck = isRevision
    ? normaliseRevisionCheck(result.revision_check)
    : null

  const assignment = await createAssignment({
    teacherId: params.teacherId,
    courseId: params.courseId,
    rubricId: params.rubricId,
    studentName: params.studentName,
    studentEmail: params.studentEmail,
    studentGroup: params.studentGroup,
    submissionText: params.submissionText,
    aiScore: clampScore(result.score),
    aiGrade: normaliseGrade(result.grade),
    aiGradeLabel: result.grade_label ?? gradeToLabel(result.grade),
    aiFeedback: applyWatermark(result.feedback ?? '', params.planTier),
    aiCriteriaScores: result.criteria_scores ?? [],
    aiStrengths: result.strengths ?? [],
    aiImprovements: result.improvements ?? [],
    parentAssignmentId: parent?.id,
    aiRevisionCheck: revisionCheck ?? undefined,
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
    ai_revision_check: assignment.ai_revision_check,
    used_examples: examples.length,
    revision_number: assignment.revision_number,
    parent_assignment_id: assignment.parent_assignment_id,
  }
}

// ─── Revision helpers ─────────────────────────────────────────────────────────

function buildRevisionContext(parent: Assignment): string {
  // Prefer the teacher's approved values; fall back to AI draft if v1 wasn't approved yet.
  const prevFeedback = parent.approved_feedback ?? parent.ai_feedback ?? ''
  const prevGrade    = parent.approved_grade   ?? parent.ai_grade   ?? '—'
  const prevScore    = parent.approved_score   ?? parent.ai_score   ?? '—'
  // Teacher-edited improvements take precedence — they're what the teacher
  // actually committed to as the v1 verdict. AI draft is the fallback for
  // assignments that were graded before this feature shipped, or while v1
  // was still pending approval.
  const prevImprovements = parent.approved_improvements ?? parent.ai_improvements ?? []

  const improvementsList = prevImprovements.length
    ? prevImprovements.map((p, i) => `${i + 1}. ${sanitiseForPrompt(p)}`).join('\n')
    : '(в предыдущей версии не было сформулированных пунктов улучшения)'

  return `## Контекст: предыдущая версия работы
Это переработанная версия (revision). Студент уже сдавал предыдущий вариант, и был дан следующий отзыв:

**Предыдущая оценка:** ${prevGrade} (${prevScore}/100)

**Общий отзыв на прошлую версию:**
${sanitiseForPrompt(prevFeedback)}

**Что было предложено улучшить в прошлой версии:**
${improvementsList}

При оценке текущей версии:
1. Учитывайте, что это переработка — её следует сравнивать с прошлой версией, а не оценивать «с нуля».
2. По каждому пункту из списка «что улучшить» выше явно укажите в поле "revision_check", был ли он учтён.

`
}

function normaliseRevisionCheck(raw: unknown): Array<{ point: string; status: 'addressed' | 'partial' | 'not_addressed'; note: string }> | null {
  if (!Array.isArray(raw)) return null
  const valid = ['addressed', 'partial', 'not_addressed'] as const
  type Status = typeof valid[number]
  return raw
    .map((item) => {
      const i = item as { point?: unknown; status?: unknown; note?: unknown }
      const status = String(i.status ?? '').trim() as Status
      return {
        point:  String(i.point  ?? '').trim(),
        status: valid.includes(status) ? status : 'partial' as Status,
        note:   String(i.note   ?? '').trim(),
      }
    })
    .filter((i) => i.point)
}

function applyWatermark(feedback: string, planTier: string): string {
  if (!canUseFeature(planTier, 'watermark')) return feedback
  return feedback + '\n\n---\nСгенерировано с ИСПУМ (бесплатный тариф) · ispum.ru'
}

// ─── Approve ─────────────────────────────────────────────────────────────────

export async function approve(
  id: string,
  teacherId: string,
  data: {
    approvedScore: number
    approvedGrade: GradeLetter
    approvedFeedback: string
    approvedStrengths?: string[]
    approvedImprovements?: string[]
  }
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

const CALC_GUIDANCE =
  `\nЭто расчётная задача: пересчитайте решение пошагово, проверьте формулы, единицы измерения и числовой ответ. ` +
  `За верный метод с арифметической опиской начисляйте частичный балл.\n`

const REVISION_FIELD_INSTRUCTION =
  `- "revision_check": массив объектов по каждому пункту из списка «что было предложено улучшить» в прошлой версии. ` +
  `Каждый объект: {"point": исходный пункт прошлой версии, "status": "addressed" | "partial" | "not_addressed", "note": 1-2 предложения с обоснованием — что именно изменилось/не изменилось}. ` +
  `Включите КАЖДЫЙ пункт из прошлой версии, даже если он полностью учтён.`

function buildRubricPrompt(
  text: string,
  rubricName: string,
  criteria: RubricCriterion[],
  examples: SimilarAssignment[],
  isCalc = false,
  isRevision = false,
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

## Инструкция${isCalc ? CALC_GUIDANCE : ''}
Оцените работу по каждому критерию рубрики. Верните JSON-объект со следующими полями:
- "score": итоговый взвешенный балл от 0 до 100
- "grade": одно из "5", "4", "3", "2"  (5: 87–100, 4: 73–86, 3: 60–72, 2: ниже 60)
- "grade_label": одно из "Отлично", "Хорошо", "Удовлетворительно", "Неудовлетворительно"
- "feedback": общий отзыв на 2–3 абзаца на русском языке
- "criteria_scores": массив {"name": string, "score": число 0–100, "feedback": string}
- "strengths": массив из 3–5 конкретных достоинств работы
- "improvements": массив из 3–5 конкретных областей для улучшения${isRevision ? `\n${REVISION_FIELD_INSTRUCTION}` : ''}

Ответьте ТОЛЬКО JSON-объектом, без пояснений.`
}

function buildHolisticPrompt(text: string, examples: SimilarAssignment[], isCalc = false, isRevision = false): string {
  return `${buildExamplesBlock(examples)}## Работа студента
<student_submission>
${sanitiseForPrompt(text)}
</student_submission>

## Инструкция${isCalc ? CALC_GUIDANCE : ''}
Оцените работу в целом по академическим стандартам. Верните JSON-объект со следующими полями:
- "score": итоговый балл от 0 до 100
- "grade": одно из "5", "4", "3", "2"  (5: 87–100, 4: 73–86, 3: 60–72, 2: ниже 60)
- "grade_label": одно из "Отлично", "Хорошо", "Удовлетворительно", "Неудовлетворительно"
- "feedback": общий отзыв на 2–3 абзаца на русском языке
- "criteria_scores": [] (пустой массив — без рубрики)
- "strengths": массив из 3–5 конкретных достоинств работы
- "improvements": массив из 3–5 конкретных областей для улучшения${isRevision ? `\n${REVISION_FIELD_INSTRUCTION}` : ''}

Ответьте ТОЛЬКО JSON-объектом, без пояснений.`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampScore(n: unknown): number {
  const num = typeof n === 'number' ? n : parseInt(String(n), 10)
  return Math.max(0, Math.min(100, isNaN(num) ? 0 : num))
}

function normaliseGrade(g: unknown): GradeLetter {
  const valid: GradeLetter[] = ['5', '4', '3', '2']
  const s = String(g).trim() as GradeLetter
  return valid.includes(s) ? s : '2'
}

function gradeToLabel(g: GradeLetter): string {
  return (
    { '5': 'Отлично', '4': 'Хорошо', '3': 'Удовлетворительно', '2': 'Неудовлетворительно' }[g] ??
    'Неизвестно'
  )
}
