import { chatJSON, embed } from './deepseek'
import { findCourseById } from '../db/queries/courses'
import { findRelevantChunks, type RelevantChunk } from '../db/queries/chunks'
import { logDocumentRetrievals } from '../db/queries/ragDocumentUses'
import { resolveRagRetrievalScope } from './ragScope'
import { createQuiz, countQuizzesThisMonth } from '../db/queries/quizzes'
import { getLimits, type PlanTier } from '../config/planLimits'
import { PlanLimitError } from '../errors/AppError'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { logger } from '../lib/logger'
import type { Quiz, QuizQuestion, QuizLevel, PresentationSource } from '../../../shared/types'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface GenerateQuizParams {
  teacherId:     string
  courseId?:     string
  topic:         string
  questionCount: number             // 5–20, clamped server-side
  level?:        QuizLevel
  sourceText?:   string             // pasted lecture notes — takes priority over RAG retrieval
  // Set when the source text is a generated lecture deck («Проверить
  // усвоение», TODO.md "### AO" Phase 3). Two effects: the quiz row records
  // which lecture it came from, and the prompt frames the material as a
  // lecture that has just been delivered rather than as reference notes —
  // the questions should check what was said in the hall.
  presentationId?: string
}

export interface GenerateQuizResult {
  quiz: Quiz
}

const MAX_SOURCES        = 6
const SOURCE_EXCERPT_LEN = 280
const MIN_QUESTIONS      = 5
const MAX_QUESTIONS      = 20

// ─── Generate ─────────────────────────────────────────────────────────────────

export async function generateQuiz(params: GenerateQuizParams): Promise<GenerateQuizResult> {
  const course = params.courseId
    ? await findCourseById(params.courseId, params.teacherId)
    : null

  const sources = params.sourceText
    ? []
    : params.courseId
      ? await retrieveSources(params)
      : []

  const count = clampCount(params.questionCount)

  const systemPrompt =
    `Вы опытный методист, составляющий короткие проверочные тесты по учебному материалу. ` +
    `Возвращайте только валидный JSON.`

  const userPrompt = buildPrompt(params, course, sources, count)

  type RawQuestion = {
    question:      string
    options:       string[]
    correct_index: number
    explanation:   string
    citations?:    number[]
  }
  type RawQuiz = { questions: RawQuestion[] }

  const raw = await chatJSON<RawQuiz>(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    'тестовые вопросы',
    { context: { teacherId: params.teacherId, feature: 'presentation' } },   // bucket with presentation usage logging
  )

  const { questions, usedSourceIdx } = normaliseQuestions(raw.questions ?? [], sources, count)
  const usedSources = sources.filter((s) => usedSourceIdx.has(s.idx))

  const quiz = await createQuiz({
    teacherId:     params.teacherId,
    courseId:      params.courseId,
    presentationId: params.presentationId,
    topic:         params.topic,
    level:         params.level,
    questionCount: questions.length,
    questions,
    sources:       usedSources,
  })

  // No counter-table bump — monthly usage is COUNT(*) from the quizzes table
  // (same pattern as topics). See /auth/me population in routes/auth.ts.

  return { quiz }
}

// ─── RAG retrieval ───────────────────────────────────────────────────────────

async function retrieveSources(params: GenerateQuizParams): Promise<PresentationSource[]> {
  try {
    const scope = await resolveRagRetrievalScope(params.courseId!)
    const vector = await embed(params.topic, { teacherId: params.teacherId, feature: 'embedding' })
    const chunks = await findRelevantChunks(scope, vector, MAX_SOURCES)
    logDocumentRetrievals(chunks, scope.courseId, params.teacherId).catch(() => null)
    return chunks.map((c, i) => toSource(c, i + 1))
  } catch (err) {
    logger.warn({ message: '[RAG quiz] could not retrieve sources', error: (err as Error).message })
    return []
  }
}

function toSource(c: RelevantChunk, idx: number): PresentationSource {
  const excerpt = c.text.length > SOURCE_EXCERPT_LEN
    ? c.text.slice(0, SOURCE_EXCERPT_LEN).trimEnd() + '…'
    : c.text
  return {
    idx,
    document_id: c.document_id,
    file_name:   c.file_name,
    page_start:  c.page_start,
    page_end:    c.page_end,
    excerpt,
    chunk_type:  c.chunk_type ?? null,
    source_scope: c.source_scope,
  }
}

// ─── Question validation ──────────────────────────────────────────────────────

/**
 * Validate and clean the model output:
 *  - exactly 4 options per question
 *  - correct_index inside [0,3]
 *  - drop citations that don't map to a real source (hallucination guard)
 *  - truncate to the requested count if the model overshot
 *  - skip malformed questions silently
 *
 * Returns a deduplicated set of source indices that actually got cited so the
 * caller can trim the persisted sources list to only what was referenced.
 */
export function normaliseQuestions(
  raw: Array<{
    question:      unknown
    options:       unknown
    correct_index: unknown
    explanation:   unknown
    citations?:    unknown
  }>,
  sources: PresentationSource[],
  targetCount: number
): { questions: QuizQuestion[]; usedSourceIdx: Set<number> } {
  const validIdx = new Set(sources.map((s) => s.idx))
  const used     = new Set<number>()
  const out: QuizQuestion[] = []

  for (const q of raw) {
    if (out.length >= targetCount) break
    const question = typeof q.question === 'string' ? q.question.trim() : ''
    const options  = Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : []
    const idx      = typeof q.correct_index === 'number' ? Math.trunc(q.correct_index) : -1
    const expl     = typeof q.explanation === 'string' ? q.explanation.trim() : ''
    if (!question || options.length !== 4 || idx < 0 || idx > 3 || !expl) continue

    const citations = Array.isArray(q.citations)
      ? (q.citations as unknown[])
          .map((n) => (typeof n === 'number' ? Math.trunc(n) : Number(n)))
          .filter((n) => Number.isInteger(n) && validIdx.has(n))
      : []
    citations.forEach((c) => used.add(c))

    out.push({
      question,
      options,
      correct_index: idx,
      explanation:   expl,
      citations,
    })
  }

  return { questions: out, usedSourceIdx: used }
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildPrompt(
  params: GenerateQuizParams,
  course: Awaited<ReturnType<typeof findCourseById>>,
  sources: PresentationSource[],
  count: number,
): string {
  const lines: string[] = []

  if (course) {
    lines.push(`## Предмет: ${course.name}`)
    if (course.level) lines.push(`Уровень курса: ${course.level}`)
    if (course.syllabus_text) {
      const summary = course.syllabus_text.trim().split(/\s+/).slice(0, 300).join(' ')
      lines.push(`\nАннотация программы:\n${summary}`)
    }
    // Profession-anchored generation — see Research.md §8. Kept lighter than the
    // materials generator: forcing a job framing onto every recall-level question
    // reads as contrived, so this is a nudge rather than a hard instruction.
    if (course.profession_context) {
      lines.push(`\nВыпускники этого предмета работают как: ${sanitiseForPrompt(course.profession_context)}.`)
      lines.push(
        `Где это уместно (особенно для вопросов на применение), формулируйте вопросы и объяснения ` +
        `через рабочие ситуации этой профессии, и в "explanation" кратко отмечайте, где это встретится в работе.`
      )
    }
    lines.push('')
  }

  if (params.sourceText) {
    // A deck is material the students have just sat through, slide by slide,
    // with the speaker notes as what was actually said — so the test is a
    // check on that lecture, not a general quiz on the topic. Saying so
    // keeps the questions inside what was covered instead of drifting to
    // whatever else the topic contains.
    lines.push(params.presentationId
      ? `## Материал прочитанной лекции — слайды и заметки докладчика\nСоставляйте вопросы строго по этому материалу: студенты только что прослушали именно эту лекцию. Не спрашивайте о том, чего в ней не было.`
      : `## Конспект лекции (составляйте вопросы строго по этому материалу)`)
    lines.push(sanitiseForPrompt(params.sourceText))
    lines.push('')
  }

  if (sources.length > 0) {
    lines.push(`## Материалы (опирайтесь на эти фрагменты; ссылайтесь на источники маркером [N])`)
    sources.forEach((s) => {
      const meta: string[] = [s.file_name]
      if (s.page_start && s.page_end && s.page_start !== s.page_end) {
        meta.push(`стр. ${s.page_start}–${s.page_end}`)
      } else if (s.page_start) {
        meta.push(`стр. ${s.page_start}`)
      }
      lines.push(`[${s.idx}] ${meta.join(' · ')}`)
      lines.push(sanitiseForPrompt(s.excerpt))
      lines.push('')
    })
  }

  lines.push(`## Параметры теста`)
  lines.push(`Тема: ${params.topic}`)
  lines.push(`Количество вопросов: ровно ${count}`)
  if (params.level) lines.push(`Когнитивный уровень: ${levelLabel(params.level)}`)

  const citationClause = sources.length > 0
    ? ` Для каждого вопроса в поле "citations" укажите номера источников из списка выше, на которые опирается вопрос (массив целых чисел; пустой массив, если опереться не на что — не выдумывайте номера).`
    : ''

  lines.push(`
## Формат ответа

Верните JSON-объект ровно следующей формы (без markdown-обёртки):

{
  "questions": [
    {
      "question": "Текст вопроса",
      "options": ["Вариант 1", "Вариант 2", "Вариант 3", "Вариант 4"],
      "correct_index": 0,
      "explanation": "Короткое (1–2 предложения) пояснение, почему этот вариант верен",
      "citations": [1, 3]
    }
  ]
}

Правила:
- РОВНО ${count} вопросов в массиве "questions"
- РОВНО 4 варианта ответа в "options" (один верный, три правдоподобных дистрактора)
- "correct_index": целое число 0–3, индекс правильного варианта в "options"
- Вопросы строго по теме «${params.topic}» — не уходите в сторону
- Не повторяйте формулировки между вопросами
- Все тексты — на русском языке${citationClause}

Ответьте ТОЛЬКО JSON-объектом, без пояснений до или после.`)

  return lines.join('\n')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 10
  return Math.max(MIN_QUESTIONS, Math.min(MAX_QUESTIONS, Math.trunc(n)))
}

function levelLabel(level: QuizLevel): string {
  return {
    recall:        'запоминание (определения, факты)',
    understanding: 'понимание (объяснение, сравнение)',
    application:   'применение (использование в задачах)',
  }[level]
}

// ─── Monthly quota ───────────────────────────────────────────────────────────
//
// Quiz usage is COUNT(*) over the quizzes table rather than a counter row, so
// the check is a query, not a middleware read. Shared by the Тесты form and by
// «Проверить усвоение» on a lecture deck — a test generated from a deck is
// still a test, and routing around the Тесты page must not route around its
// limit.

export async function assertQuizQuota(teacherId: string, planTier: string): Promise<void> {
  const limit = getLimits(planTier as PlanTier).quizzesPerMonth
  if (limit === Infinity) return
  const used = await countQuizzesThisMonth(teacherId)
  if (used >= limit) {
    throw new PlanLimitError(
      `Достигнут месячный лимит генерации тестов (${limit}). Перейдите на Pro для безлимита.`,
      'PLAN_LIMIT_REACHED'
    )
  }
}
