import { chatJSON, embed, REASONER_MODEL, type CallContext } from './deepseek'
import { gradeEnsemble } from './confidence'
import { findCriteriaByIds } from '../db/queries/criteria'
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
import { NotFoundError, ValidationError } from '../errors/AppError'
import { logger } from '../lib/logger'
import type { Assignment, GradeLetter, CriterionScore, CriteriaSnapshotItem } from '../../../shared/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GradeParams {
  teacherId:  string
  institutionId?: string | null
  planTier:   string   // 'free' | 'pro' | 'institution'
  submissionText: string
  criterionIds?: string[]                     // 0–10 ids; empty/absent → holistic
  weights?: number[]                          // same length as criterionIds, sum to 100
  courseId?: string
  studentName?: string
  studentEmail?: string
  studentGroup?: string
  referenceSolution?: string
  assignmentType?: 'essay' | 'calculation'
  parentAssignmentId?: string
  thorough?: boolean   // run the confidence ensemble (premium "тщательная проверка")
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
  revision_check?: RevisionCheckItem[]
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
  criteria_snapshot: CriteriaSnapshotItem[] | null
  ai_confidence: import('../../../shared/types').ConfidenceLevel | null
  ai_ensemble: import('../../../shared/types').AiEnsemble | null
  used_examples: number
  revision_number: number
  parent_assignment_id: string | null
}

// ─── Criteria resolution ──────────────────────────────────────────────────────

/**
 * Build the criteria snapshot for this grading event from the teacher's chosen
 * criterion_ids + weights. Validates that every id resolves to a criterion the
 * teacher is allowed to use; throws ValidationError otherwise.
 */
export async function resolveCriteriaSnapshot(
  teacherId: string,
  institutionId: string | null,
  ids: string[],
  weights: number[]
): Promise<CriteriaSnapshotItem[]> {
  if (ids.length === 0) return []
  const criteria = await findCriteriaByIds(ids, teacherId, institutionId)
  if (criteria.length !== ids.length) {
    throw new ValidationError('Один или несколько критериев недоступны')
  }
  const byId = new Map(criteria.map((c) => [c.id, c]))
  return ids.map((id, i) => {
    const c = byId.get(id)!
    return {
      criterion_id: c.id,
      name:         c.name,
      weight:       weights[i],
      description:  c.description,
      max_score:    100,
    } as CriteriaSnapshotItem & { max_score: number }
  })
}

// ─── RAG retrieval ────────────────────────────────────────────────────────────

async function retrieveExamples(
  submissionText: string,
  courseId: string,
  teacherId: string
): Promise<SimilarAssignment[]> {
  try {
    const vector = await embed(submissionText, { teacherId, feature: 'embedding' })
    return await findSimilarAssignments(courseId, vector, 5)
  } catch (err) {
    logger.warn({ message: '[RAG] Could not retrieve similar examples', error: (err as Error).message })
    return []
  }
}

// ─── Pure grading core ────────────────────────────────────────────────────────
//
// gradeOnce() is the single prompt path shared by production grading AND the
// eval harness (offline replay for the flywheel/triage experiments). It has no
// side effects on the database: no assignment row, no usage counter, no
// watermark — those are concerns of grade() below. Keeping the experiment and
// production on one code path is what makes replay results valid.

// Grading persona — biases the examiner's leniency. Used by the confidence
// ensemble to sample genuine disagreement; 'neutral' is the production default.
export type GradingPersona = 'strict' | 'neutral' | 'lenient'

const PERSONA_MODIFIER: Record<GradingPersona, string> = {
  neutral: '',
  strict:  ' Будьте требовательным экзаменатором: придирайтесь к деталям, ' +
           'не завышайте оценку, любые недочёты должны снижать балл.',
  lenient: ' Будьте благожелательным проверяющим: засчитывайте частично верное, ' +
           'не занижайте за мелкие огрехи, оценивайте по существу.',
}

export interface GradeOnceParams {
  submissionText: string
  criteria:       CriteriaSnapshotItem[]   // empty → holistic grading
  examples:       SimilarAssignment[]      // RAG few-shot examples (may be [])
  assignmentType?: 'essay' | 'calculation'
  referenceSolution?: string
  parent?:        Assignment | null        // revision context, if re-grading a resubmission
  persona?:       GradingPersona           // default 'neutral'
  temperature?:   number                   // for ensemble sampling; default undefined (provider default)
  context:        CallContext              // teacherId + feature, for usage logging
}

export interface GradeOnceResult {
  score:          number
  grade:          GradeLetter
  gradeLabel:     string
  feedback:       string
  criteriaScores: CriterionScore[]         // normalised + citation-validated
  strengths:      string[]
  improvements:   string[]
  revisionCheck:  RevisionCheckItem[] | null
}

export interface GradingMessages {
  system:    string
  user:      string
  pageCount: number
}

/**
 * Deterministic prompt assembly — fully testable without network. Everything
 * that decides WHAT the model sees lives here; gradeOnce only adds the call
 * and response normalisation.
 */
export function buildGradingMessages(params: {
  submissionText: string
  criteria:       CriteriaSnapshotItem[]
  examples:       SimilarAssignment[]
  assignmentType?: 'essay' | 'calculation'
  referenceSolution?: string
  parent?:        Assignment | null
  persona?:       GradingPersona
}): GradingMessages {
  const isCalc     = params.assignmentType === 'calculation'
  const isRevision = params.parent != null

  const base = isCalc
    ? `Вы опытный преподаватель точных наук (математика, физика, инженерные дисциплины). ` +
      `Проверяйте расчётные задачи строго: пошагово пересчитывайте решение, проверяйте формулы, ` +
      `единицы измерения, размерности и числовой ответ. Отличайте ошибку метода от арифметической описки ` +
      `и справедливо начисляйте частичный балл за верный ход решения. ` +
      `Давайте обратную связь на русском языке. Всегда отвечайте только валидным JSON-объектом.`
    : `Вы опытный преподаватель-эксперт. Ваша задача — объективно оценивать студенческие работы ` +
      `и давать конструктивную обратную связь на русском языке. Всегда отвечайте только валидным JSON.`

  const system = base + PERSONA_MODIFIER[params.persona ?? 'neutral']

  const revisionBlock = isRevision ? buildRevisionContext(params.parent!) : ''

  const reference = params.referenceSolution?.trim()
    ? `## Эталонное решение / правильный ответ
Сравнивайте работу студента с этим эталоном. Если ответ студента совпадает по существу — засчитывайте, даже если оформление отличается.
<reference_solution>
${sanitiseForPrompt(params.referenceSolution.trim())}
</reference_solution>

`
    : ''

  const { text: annotated, pageCount } = annotateWithPageMarkers(params.submissionText)

  const user = revisionBlock + reference + (params.criteria.length > 0
    ? buildCriteriaPrompt(annotated, params.criteria, params.examples, isCalc, isRevision, pageCount)
    : buildHolisticPrompt(annotated, params.examples, isCalc, isRevision))

  return { system, user, pageCount }
}

/** One grading call: prompt → model → normalised result. No DB writes. */
export async function gradeOnce(params: GradeOnceParams): Promise<GradeOnceResult> {
  const { system, user, pageCount } = buildGradingMessages(params)
  const isCalc = params.assignmentType === 'calculation'

  const result = await chatJSON<AIGradingResult>(
    [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
    'результат оценивания',
    params.context,
    isCalc ? REASONER_MODEL : undefined,
    params.temperature,
  )

  const grade = normaliseGrade(result.grade)
  return {
    score:          clampScore(result.score),
    grade,
    gradeLabel:     result.grade_label ?? gradeToLabel(grade),
    feedback:       result.feedback ?? '',
    criteriaScores: normaliseCriteriaScores(result.criteria_scores ?? [], params.submissionText, pageCount),
    strengths:      result.strengths ?? [],
    improvements:   result.improvements ?? [],
    revisionCheck:  params.parent != null ? normaliseRevisionCheck(result.revision_check) : null,
  }
}

// ─── Score-only sampling (for the confidence ensemble) ───────────────────────
//
// The ensemble needs M independent score estimates to measure disagreement,
// but only the PRIMARY run needs full prose feedback. scoreOnce() asks the
// model for just {score, grade} under the same submission + criteria + persona,
// at ~1/5 the output tokens of a full grade. This keeps "thorough mode" at
// roughly 1× full grade + (M−1)× cheap samples instead of M× full grades.

export interface ScoreOnceParams {
  submissionText: string
  criteria:       CriteriaSnapshotItem[]
  examples:       SimilarAssignment[]
  assignmentType?: 'essay' | 'calculation'
  referenceSolution?: string
  persona?:       GradingPersona
  temperature?:   number
  context:        CallContext
}

export interface ScoreOnceResult {
  score: number
  grade: GradeLetter
}

export async function scoreOnce(params: ScoreOnceParams): Promise<ScoreOnceResult> {
  const isCalc = params.assignmentType === 'calculation'
  const base = isCalc
    ? `Вы строгий преподаватель точных наук. Пошагово проверьте расчёт и выставьте балл.`
    : `Вы опытный преподаватель-эксперт. Оцените работу студента и выставьте балл.`
  const system = base + PERSONA_MODIFIER[params.persona ?? 'neutral'] +
    ` Отвечайте только валидным JSON.`

  const reference = params.referenceSolution?.trim()
    ? `\n## Эталон\n<reference>\n${sanitiseForPrompt(params.referenceSolution.trim())}\n</reference>\n`
    : ''
  const criteriaBlock = params.criteria.length > 0
    ? `\n## Критерии\n${params.criteria.map((c) => `- ${c.name} (вес ${c.weight}%)`).join('\n')}\n`
    : ''
  const examplesBlock = params.examples.length > 0
    ? `\n## Примеры оценок по предмету (ориентир)\n${params.examples
        .map((e) => `${e.approved_grade} (${e.approved_score}/100)`).join(', ')}\n`
    : ''

  const user =
    `${criteriaBlock}${examplesBlock}${reference}\n## Работа студента\n<submission>\n` +
    `${sanitiseForPrompt(params.submissionText)}\n</submission>\n\n` +
    `Верните ТОЛЬКО JSON: {"score": число 0–100, "grade": "5"|"4"|"3"|"2"} ` +
    `(5: 87–100, 4: 73–86, 3: 60–72, 2: ниже 60). Без пояснений.`

  const result = await chatJSON<{ score: number; grade: string }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'балл',
    params.context,
    isCalc ? REASONER_MODEL : undefined,
    params.temperature,
  )

  return { score: clampScore(result.score), grade: normaliseGrade(result.grade) }
}

// ─── Grade (production path: resolve inputs → gradeOnce → persist) ───────────

export async function grade(params: GradeParams): Promise<GradeResponse> {
  const ragEnabled = canUseFeature(params.planTier, 'ragFlywheel')
  const ids     = params.criterionIds ?? []
  const weights = params.weights ?? []

  const [snapshot, examples, parent] = await Promise.all([
    resolveCriteriaSnapshot(params.teacherId, params.institutionId ?? null, ids, weights),
    ragEnabled && params.courseId
      ? retrieveExamples(params.submissionText, params.courseId, params.teacherId)
      : Promise.resolve([]),
    params.parentAssignmentId
      ? findAssignmentById(params.parentAssignmentId, params.teacherId)
      : Promise.resolve(null),
  ])

  const gradeParams = {
    submissionText:    params.submissionText,
    criteria:          snapshot,
    examples,
    assignmentType:    params.assignmentType,
    referenceSolution: params.referenceSolution,
    parent,
    context:           { teacherId: params.teacherId, feature: 'grading' as const },
  }

  // "Thorough" mode runs the confidence ensemble: the primary call still
  // provides the full feedback, plus cheap score-only samples whose
  // disagreement yields a confidence label. Revisions skip it — the
  // revision-check flow is its own thing and ensemble adds little there.
  const ensemble = params.thorough && parent == null
    ? await gradeEnsemble(gradeParams)
    : null
  const result = ensemble ? ensemble.primary : await gradeOnce(gradeParams)

  // Merge AI per-criterion scores back into the snapshot so the history view
  // can reconstruct exactly what was graded against what.
  const filledSnapshot: CriteriaSnapshotItem[] | null = snapshot.length > 0
    ? mergeScoresIntoSnapshot(snapshot, result.criteriaScores)
    : null

  const assignment = await createAssignment({
    teacherId: params.teacherId,
    courseId: params.courseId,
    studentName: params.studentName,
    studentEmail: params.studentEmail,
    studentGroup: params.studentGroup,
    submissionText: params.submissionText,
    aiScore: result.score,
    aiGrade: result.grade,
    aiGradeLabel: result.gradeLabel,
    aiFeedback: applyWatermark(result.feedback, params.planTier),
    aiCriteriaScores: result.criteriaScores,
    aiStrengths: result.strengths,
    aiImprovements: result.improvements,
    criteriaSnapshot: filledSnapshot,
    parentAssignmentId: parent?.id,
    aiRevisionCheck: result.revisionCheck ?? undefined,
    aiConfidence: ensemble?.confidence ?? null,
    aiEnsemble: ensemble?.ensemble ?? null,
  })

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
    criteria_snapshot: assignment.criteria_snapshot,
    ai_confidence: assignment.ai_confidence,
    ai_ensemble: assignment.ai_ensemble,
    used_examples: examples.length,
    revision_number: assignment.revision_number,
    parent_assignment_id: assignment.parent_assignment_id,
  }
}

function mergeScoresIntoSnapshot(
  snapshot: CriteriaSnapshotItem[],
  aiScores: CriterionScore[]
): CriteriaSnapshotItem[] {
  const byName = new Map(aiScores.map((s) => [s.name.toLowerCase().trim(), s]))
  return snapshot.map((item) => {
    const match = byName.get(item.name.toLowerCase().trim())
    return match
      ? { ...item, score: match.score, feedback: match.feedback }
      : item
  })
}

/**
 * Convert form-feed page boundaries in the raw submission into "[стр. N]"
 * headers the AI can cite. Page 1 is implicit (no header before the first
 * page), subsequent pages are prefixed. Returns the annotated text plus the
 * total page count so the prompt can constrain the citation field.
 */
export function annotateWithPageMarkers(text: string): { text: string; pageCount: number } {
  if (!text.includes('\f')) return { text, pageCount: 1 }
  const pages = text.split('\f')
  const annotated = pages
    .map((page, i) => (i === 0 ? page : `\n\n[стр. ${i + 1}]\n${page}`))
    .join('')
  return { text: annotated, pageCount: pages.length }
}

/**
 * Validate citations against the original (un-annotated) submission. A quote
 * survives only if it actually appears in the source — otherwise the model
 * hallucinated it. Pages are clamped to the document's real range.
 */
export function normaliseCriteriaScores(
  scores: CriterionScore[],
  submissionText: string,
  pageCount: number
): CriterionScore[] {
  const haystack = submissionText.toLowerCase().replace(/\s+/g, ' ').trim()
  return scores.map((s) => {
    const next: CriterionScore = {
      // The model sometimes echoes the weight into the name («Структура (вес: 40%)»)
      // — strip it so display stays clean and the snapshot merge-by-name works.
      name:     String(s.name ?? '').replace(/\s*\(вес:?\s*\d+\s*%?\)\s*$/i, '').trim(),
      score:    clampScore(s.score),
      feedback: String(s.feedback ?? '').trim(),
      quote:    null,
      page:     null,
    }
    const quote = typeof s.quote === 'string' ? s.quote.trim() : ''
    if (quote) {
      const normalised = quote.toLowerCase().replace(/\s+/g, ' ').trim()
      // Accept the quote only if it shows up verbatim (case- and whitespace-insensitive).
      if (normalised.length >= 8 && haystack.includes(normalised)) {
        next.quote = quote.slice(0, 200)
      }
    }
    const page = typeof s.page === 'number' ? Math.round(s.page) : null
    if (page != null && Number.isInteger(page) && page >= 1 && page <= pageCount) {
      next.page = page
    }
    return next
  })
}

// ─── Revision helpers ─────────────────────────────────────────────────────────

function buildRevisionContext(parent: Assignment): string {
  const prevFeedback = parent.approved_feedback ?? parent.ai_feedback ?? ''
  const prevGrade    = parent.approved_grade   ?? parent.ai_grade   ?? '—'
  const prevScore    = parent.approved_score   ?? parent.ai_score   ?? '—'
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

  return `## Примеры оценённых работ по этому предмету
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

function buildCriteriaPrompt(
  text: string,
  snapshot: CriteriaSnapshotItem[],
  examples: SimilarAssignment[],
  isCalc = false,
  isRevision = false,
  pageCount = 0,
): string {
  const criteriaBlock = snapshot
    .map((c) => `- ${c.name} (вес: ${c.weight}%)${c.description ? `: ${c.description}` : ''}`)
    .join('\n')

  const pageInstruction = pageCount > 1
    ? `номер страницы из маркера [стр. N], если фрагмент с этой страницы (целое число 1–${pageCount}); иначе null`
    : `всегда null (работа однострочная, без страниц)`

  return `${buildExamplesBlock(examples)}## Критерии оценки

${criteriaBlock}

## Работа студента${pageCount > 1 ? ` (страницы помечены маркерами [стр. N])` : ''}
<student_submission>
${sanitiseForPrompt(text)}
</student_submission>

## Инструкция${isCalc ? CALC_GUIDANCE : ''}
Оцените работу по каждому из перечисленных критериев. Верните JSON-объект со следующими полями:
- "score": итоговый взвешенный балл от 0 до 100
- "grade": одно из "5", "4", "3", "2"  (5: 87–100, 4: 73–86, 3: 60–72, 2: ниже 60)
- "grade_label": одно из "Отлично", "Хорошо", "Удовлетворительно", "Неудовлетворительно"
- "feedback": общий отзыв на 2–3 абзаца на русском языке
- "criteria_scores": массив объектов по каждому критерию выше. КАЖДЫЙ объект:
    {"name": точное название критерия,
     "score": число 0–100,
     "feedback": краткое обоснование оценки (2–4 предложения),
     "quote": ДОСЛОВНАЯ цитата из работы студента (5–12 слов), на которую опирается ваш вывод — используйте её ТОЛЬКО если в работе действительно есть такой фрагмент. Если опереть вывод не на что — null,
     "page": ${pageInstruction}}
   Маркеры [стр. N] в цитату НЕ ВКЛЮЧАЙТЕ. Не выдумывайте цитаты — лучше null, чем неточная цитата.
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
- "criteria_scores": [] (пустой массив — без критериев)
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
