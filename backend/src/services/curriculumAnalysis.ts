import { chatJSON, embed } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { findCourseById } from '../db/queries/courses'
import { getLatestKnowledgeText } from '../db/queries/documents'
import { ValidationError } from '../errors/AppError'
import { logger } from '../lib/logger'
import type {
  CurriculumAnalysis, OverlapPair, OverlapType,
  AnalyzedDiscipline, SkippedDiscipline, DisciplinePairSummary,
} from '../../../shared/types'

// КНИТУ admin feature A3 — «Выявление задвоения содержания (одинаковых тем) в
// разных дисциплинах одного учебного плана». Extract a topic list per discipline,
// embed each topic, cross-compare by cosine similarity, then have the model
// classify the strongest candidate pairs. Reuses our existing embedding + LLM
// surface; cosine is computed in-process so the embedding dimension is irrelevant
// as long as every vector comes from the same `embed()`.

const MIN_CONTENT_CHARS    = 80     // below this a course has nothing useful to analyse
const MAX_CONTENT_CHARS    = 6000   // cap source text sent to the extractor
const MAX_TOPICS_PER_COURSE = 10   // keeps runtime snappy for a live analysis
const PREFILTER_THRESHOLD  = 0.70   // cosine floor for a candidate pair
const MAX_PAIRS            = 24     // cap pairs sent to the classifier
const EMBED_SPACING_MS     = 120   // gap between embed calls — stay under Yandex's rate limit
const EMBED_MAX_RETRIES    = 4     // on HTTP 429 / transient network errors

interface ExtractedTopic { title: string; summary: string; embedding: number[] }
interface DisciplineTopics { courseId: string; courseName: string; topics: ExtractedTopic[] }

export async function analyzeCurriculumOverlap(params: {
  teacherId: string
  courseIds: string[]
}): Promise<CurriculumAnalysis> {
  const { teacherId, courseIds } = params

  // De-dupe while preserving order.
  const ids = [...new Set(courseIds)]
  if (ids.length < 2) {
    throw new ValidationError('Выберите минимум две дисциплины для анализа.')
  }

  const analyzed: AnalyzedDiscipline[] = []
  const skipped:  SkippedDiscipline[]  = []
  const withTopics: DisciplineTopics[] = []

  for (const courseId of ids) {
    const course = await findCourseById(courseId, teacherId)
    if (!course) {
      skipped.push({ course_id: courseId, course_name: '—', reason: 'Дисциплина не найдена' })
      continue
    }

    const content = await resolveCourseContent(courseId, teacherId, course.syllabus_text)
    if (!content || content.trim().length < MIN_CONTENT_CHARS) {
      skipped.push({
        course_id: course.id, course_name: course.name,
        reason: 'Нет содержания для анализа — добавьте программу или загрузите РПД',
      })
      continue
    }

    const topics = await extractTopics(teacherId, course.name, content)
    if (topics.length === 0) {
      skipped.push({
        course_id: course.id, course_name: course.name,
        reason: 'Не удалось выделить темы из содержания',
      })
      continue
    }

    const embedded = await embedTopics(teacherId, topics)
    withTopics.push({ courseId: course.id, courseName: course.name, topics: embedded })
    analyzed.push({ course_id: course.id, course_name: course.name, topic_count: embedded.length })
  }

  if (withTopics.length < 2) {
    throw new ValidationError(
      'Недостаточно дисциплин с содержанием для сравнения. Нужно минимум две дисциплины с программой или загруженным РПД.'
    )
  }

  // Cross-compare every topic against topics in *other* disciplines.
  let pairs: OverlapPair[] = []
  for (let i = 0; i < withTopics.length; i++) {
    for (let j = i + 1; j < withTopics.length; j++) {
      const a = withTopics[i]
      const b = withTopics[j]
      for (const ta of a.topics) {
        for (const tb of b.topics) {
          const similarity = cosine(ta.embedding, tb.embedding)
          if (similarity >= PREFILTER_THRESHOLD) {
            pairs.push({
              course_a_id: a.courseId, course_a_name: a.courseName, topic_a: ta.title,
              course_b_id: b.courseId, course_b_name: b.courseName, topic_b: tb.title,
              similarity: round(similarity),
            })
          }
        }
      }
    }
  }

  pairs.sort((x, y) => y.similarity - x.similarity)
  pairs = pairs.slice(0, MAX_PAIRS)

  // Best-effort classification — never blocks the result.
  if (pairs.length > 0) {
    try {
      await classifyPairs(teacherId, pairs)
    } catch (err) {
      logger.warn({ message: 'Overlap classification failed; returning raw pairs', error: (err as Error).message })
    }
  }

  return {
    analyzed,
    skipped,
    pairs,
    pair_summary: summarisePairs(pairs),
    generated_at: new Date().toISOString(),
  }
}

// ── Content source: inline syllabus first, then latest ready РПД/material ──────
async function resolveCourseContent(
  courseId: string, teacherId: string, syllabusText: string | null
): Promise<string> {
  const inline = (syllabusText ?? '').trim()
  if (inline.length >= MIN_CONTENT_CHARS) return inline.slice(0, MAX_CONTENT_CHARS)
  const doc = await getLatestKnowledgeText(courseId, teacherId)
  const combined = [inline, doc ?? ''].filter(Boolean).join('\n\n').trim()
  return combined.slice(0, MAX_CONTENT_CHARS)
}

// ── Topic extraction (one LLM call per discipline) ────────────────────────────
async function extractTopics(
  teacherId: string, courseName: string, content: string
): Promise<{ title: string; summary: string }[]> {
  const system =
    'Вы — методист российского вуза. Вы выделяете изучаемые темы (разделы) дисциплины ' +
    'из её программы. Отвечайте только валидным JSON на русском языке.'

  const user =
    `## Дисциплина\n${sanitiseForPrompt(courseName)}\n\n` +
    `## Программа / содержание\n${sanitiseForPrompt(content)}\n\n` +
    `## Задача\nВыделите до ${MAX_TOPICS_PER_COURSE} ключевых изучаемых тем этой дисциплины. ` +
    `Для каждой темы дайте короткое описание (что именно изучается). ` +
    `Темы должны быть конкретными разделами содержания, а не общими словами.\n\n` +
    `## Формат ответа\nВерните JSON: {"topics":[{"title":"...","summary":"..."}]}. Только JSON.`

  const result = await chatJSON<{ topics: { title?: string; summary?: string }[] }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'список тем дисциплины',
    { context: { teacherId, feature: 'presentation' } },   // reuse a logged feature bucket
  )

  return (result.topics ?? [])
    .map((t) => ({ title: String(t.title ?? '').trim(), summary: String(t.summary ?? '').trim() }))
    .filter((t) => t.title)
    .slice(0, MAX_TOPICS_PER_COURSE)
}

// ── Embed topics sequentially ─────────────────────────────────────────────────
// Yandex's embedding endpoint rate-limits aggressively; the rest of the codebase
// embeds one item at a time. We do the same here, with a small inter-call gap and
// backoff on HTTP 429, so a 5-discipline plan (~50–70 topics) completes reliably.
async function embedTopics(
  teacherId: string, topics: { title: string; summary: string }[]
): Promise<ExtractedTopic[]> {
  const out: ExtractedTopic[] = []
  for (const t of topics) {
    const embedding = await embedWithBackoff(`${t.title}. ${t.summary}`, teacherId)
    out.push({ ...t, embedding })
    await sleep(EMBED_SPACING_MS)
  }
  return out
}

async function embedWithBackoff(text: string, teacherId: string): Promise<number[]> {
  let lastErr: unknown
  for (let attempt = 0; attempt < EMBED_MAX_RETRIES; attempt++) {
    try {
      return await embed(text, { teacherId, feature: 'embedding' })
    } catch (err) {
      lastErr = err
      const status = (err as { response?: { status?: number } })?.response?.status
      const retryable = status === 429 || status === undefined   // 429 or network blip
      if (!retryable || attempt === EMBED_MAX_RETRIES - 1) break
      await sleep(500 * 2 ** attempt)   // 500ms, 1s, 2s
    }
  }
  throw lastErr
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Classify the candidate pairs in a single LLM call ─────────────────────────
async function classifyPairs(teacherId: string, pairs: OverlapPair[]): Promise<void> {
  const system =
    'Вы — эксперт по учебным планам российского вуза. Вы оцениваете, насколько две темы ' +
    'из разных дисциплин дублируют друг друга для одного студента. Отвечайте только валидным JSON.'

  const list = pairs.map((p, i) =>
    `${i}. Дисциплина «${p.course_a_name}»: ${p.topic_a}\n   Дисциплина «${p.course_b_name}»: ${p.topic_b}`
  ).join('\n')

  const user =
    `## Пары тем из разных дисциплин\n${list}\n\n` +
    `## Задача\nДля каждой пары определите тип пересечения:\n` +
    `- "duplicate" — полное дублирование (одна и та же тема преподаётся дважды)\n` +
    `- "partial" — частичное пересечение содержания\n` +
    `- "adjacent" — смежные, но разные темы (пересечение оправдано)\n` +
    `Дайте краткое пояснение (note, 1 предложение) и рекомендацию (recommendation, 1 предложение: ` +
    `например «убрать дубль», «разграничить акценты», «оставить как есть»).\n\n` +
    `## Формат ответа\nВерните JSON: {"items":[{"index":0,"overlap_type":"partial","note":"...","recommendation":"..."}]}. ` +
    `Сохраняйте index из списка. Только JSON.`

  const result = await chatJSON<{
    items: { index: number; overlap_type: string; note?: string; recommendation?: string }[]
  }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'классификация пересечений',
    { context: { teacherId, feature: 'presentation' } },
  )

  const valid: OverlapType[] = ['duplicate', 'partial', 'adjacent']
  for (const item of result.items ?? []) {
    const p = pairs[item.index]
    if (!p) continue
    if (valid.includes(item.overlap_type as OverlapType)) p.overlap_type = item.overlap_type as OverlapType
    if (item.note) p.note = String(item.note).trim()
    if (item.recommendation) p.recommendation = String(item.recommendation).trim()
  }
}

// ── Per discipline-pair rollup, strongest overlap first ───────────────────────
function summarisePairs(pairs: OverlapPair[]): DisciplinePairSummary[] {
  const map = new Map<string, DisciplinePairSummary>()
  for (const p of pairs) {
    const key = `${p.course_a_id}|${p.course_b_id}`
    const existing = map.get(key)
    if (existing) {
      existing.overlap_count += 1
      existing.max_similarity = Math.max(existing.max_similarity, p.similarity)
    } else {
      map.set(key, {
        course_a_id: p.course_a_id, course_a_name: p.course_a_name,
        course_b_id: p.course_b_id, course_b_name: p.course_b_name,
        overlap_count: 1, max_similarity: p.similarity,
      })
    }
  }
  return [...map.values()].sort((a, b) => b.max_similarity - a.max_similarity)
}

// ── Math helpers ──────────────────────────────────────────────────────────────
function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na  += a[i] * a[i]
    nb  += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
