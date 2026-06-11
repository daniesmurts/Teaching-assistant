import { chat, embed } from './deepseek'
import { findCourseById } from '../db/queries/courses'
import { findPresentationsByTeacher, createPresentation } from '../db/queries/presentations'
import { findRelevantChunks, type RelevantChunk } from '../db/queries/chunks'
import { incrementUsage } from '../db/queries/usageCounters'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { logger } from '../lib/logger'
import type { Presentation, PresentationSource } from '../../../shared/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenerateParams {
  teacherId: string
  courseId?: string
  lectureNumber?: number
  topic: string
  durationMinutes: number
  learningGoals: string[]
  audienceLevel?: string
  style?: string
  slideCountTarget?: number
}

export interface GenerateResult {
  presentation_id:   string
  generated_content: string
  sources:           PresentationSource[]
}

const MAX_SOURCES        = 6      // ceiling on retrieved chunks per generation
const SOURCE_EXCERPT_LEN = 280    // chars of chunk shown in the popover

// ─── Generate ─────────────────────────────────────────────────────────────────

export async function generatePresentation(params: GenerateParams): Promise<GenerateResult> {
  const course = params.courseId
    ? await findCourseById(params.courseId, params.teacherId)
    : null

  // Pull the teacher's uploaded syllabus/material chunks most relevant to the
  // requested lecture. We embed a compact query string (topic + first 3 goals
  // + course name) so the cosine search lands on contextually similar passages.
  const sources = params.courseId
    ? await retrieveSources(params)
    : []

  const previousTopics = params.courseId
    ? await getPreviousTopics(params.teacherId, params.courseId, params.lectureNumber)
    : []

  const slideTarget = params.slideCountTarget ?? estimateSlideCount(params.durationMinutes)

  const systemPrompt =
    `Вы опытный разработчик учебных программ и методист. ` +
    `Ваша задача — создавать структурированные, содержательные и педагогически выверенные лекции. ` +
    `Пишите на русском языке, если не указано иное.`

  const userPrompt = buildPrompt(params, course, previousTopics, slideTarget, sources)

  const content = await chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    { context: { teacherId: params.teacherId, feature: 'presentation' } }
  )

  // Strip [N] markers pointing at sources that don't exist (model invented a
  // citation). Leave valid ones in place. The list returned to the frontend
  // covers only sources the AI actually cited at least once — drops dead
  // weight from the popover list.
  const { cleaned, used } = filterCitations(content, sources)

  const presentation = await createPresentation({
    teacherId:        params.teacherId,
    courseId:         params.courseId,
    lectureNumber:    params.lectureNumber,
    topic:            params.topic,
    durationMinutes:  params.durationMinutes,
    audienceLevel:    params.audienceLevel,
    learningGoals:    params.learningGoals,
    style:            params.style,
    slideCountTarget: slideTarget,
    generatedContent: cleaned,
    sources:          used,
  })

  incrementUsage(params.teacherId, 'presentation').catch(() => null)

  return { presentation_id: presentation.id, generated_content: cleaned, sources: used }
}

// ─── RAG retrieval ───────────────────────────────────────────────────────────

async function retrieveSources(params: GenerateParams): Promise<PresentationSource[]> {
  try {
    const query = [
      params.topic,
      ...params.learningGoals.slice(0, 3),
    ].filter(Boolean).join(' · ')

    const vector = await embed(query, { teacherId: params.teacherId, feature: 'embedding' })
    const chunks = await findRelevantChunks(params.courseId!, vector, MAX_SOURCES)
    return chunks.map((c, i) => toSource(c, i + 1))
  } catch (err) {
    // RAG is a quality boost, not a hard requirement. Generation still
    // works without sources — slides just won't carry citations.
    logger.warn({ message: '[RAG presentations] could not retrieve sources', error: (err as Error).message })
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
  }
}

// ─── Citation cleanup ─────────────────────────────────────────────────────────

function filterCitations(
  content: string,
  sources: PresentationSource[]
): { cleaned: string; used: PresentationSource[] } {
  const validIdx = new Set(sources.map((s) => s.idx))
  const seenIdx  = new Set<number>()

  // Drop bracketed numbers that point at no source; e.g. "[7]" when we only
  // surfaced 4 sources. Multi-number forms like "[1, 3]" are split first.
  const cleaned = content.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_, group: string) => {
    const nums = group
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => validIdx.has(n))
    nums.forEach((n) => seenIdx.add(n))
    return nums.length ? `[${nums.join(', ')}]` : ''
  })

  const used = sources.filter((s) => seenIdx.has(s.idx))
  return { cleaned, used }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(
  params: GenerateParams,
  course: Awaited<ReturnType<typeof findCourseById>>,
  previousTopics: string[],
  slideTarget: number,
  sources: PresentationSource[],
): string {
  const lines: string[] = []

  if (course) {
    lines.push(`## Предмет: ${course.name}`)
    if (course.code)  lines.push(`Код: ${course.code}`)
    if (course.level) lines.push(`Уровень: ${course.level}`)
    if (course.syllabus_text) {
      const summary = course.syllabus_text.trim().split(/\s+/).slice(0, 500).join(' ')
      lines.push(`\nАннотация программы:\n${summary}`)
    }
    lines.push('')
  }

  if (previousTopics.length > 0) {
    lines.push(`## Предыдущие лекции (не повторять материал)`)
    previousTopics.forEach((t, i) => lines.push(`${i + 1}. ${t}`))
    lines.push('')
  }

  // Source corpus — numbered so the model can cite [N] in slides.
  if (sources.length > 0) {
    lines.push(`## Материалы для ссылок (используйте маркер [N] после тезисов и в заметках, опирающихся на эти источники)`)
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

  lines.push(`## Параметры лекции`)
  if (params.lectureNumber) lines.push(`Номер лекции: ${params.lectureNumber}`)
  lines.push(`Тема: ${params.topic}`)
  lines.push(`Продолжительность: ${params.durationMinutes} минут`)
  if (params.audienceLevel) lines.push(`Аудитория: ${params.audienceLevel}`)
  if (params.style)         lines.push(`Стиль подачи: ${styleLabel(params.style)}`)
  lines.push(`Целевое количество слайдов: ${slideTarget}`)

  if (params.learningGoals.length > 0) {
    lines.push(`\nЦели обучения:`)
    params.learningGoals.forEach((g) => lines.push(`- ${g}`))
  }

  const citationsClause = sources.length > 0
    ? `\n- ПОСЛЕ тезисов и фрагментов заметок, опирающихся на материалы выше, добавляйте маркер источника в квадратных скобках, например «[1]» или «[2, 4]». Не выдумывайте номера, которых нет в списке материалов. Если тезис общеизвестен и не опирается на материалы — НЕ ставьте маркер.`
    : ''

  lines.push(`
## Инструкция по формату

Создайте ровно ${slideTarget} слайдов. Используйте СТРОГО следующий формат для каждого слайда:

СЛАЙД [N]: [Заголовок слайда]
• [Тезис 1]
• [Тезис 2]
• [Тезис 3]
(3–6 тезисов на слайд; краткие, ёмкие фразы)

ЗАМЕТКИ ДОКЛАДЧИКА:
[2–4 предложения с пояснениями, примерами или советами для преподавателя]

---

Правила:
- Каждый слайд начинается с "СЛАЙД [N]:" — ровно в таком виде
- После каждого слайда обязательно ставьте разделитель "---"
- Заметки докладчика — только после ключевого слова "ЗАМЕТКИ ДОКЛАДЧИКА:"
- Первый слайд — титульный (название темы, предмет, имя лектора-заглушка)
- Последний слайд — итоги и вопросы для обсуждения
- Не добавляйте ничего за пределами этого формата${citationsClause}`)

  return lines.join('\n')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getPreviousTopics(
  teacherId: string,
  courseId: string,
  currentLecture?: number
): Promise<string[]> {
  const all = await findPresentationsByTeacher(teacherId, courseId)
  return all
    .filter((p) => currentLecture == null || (p.lecture_number ?? 0) < currentLecture)
    .map((p) => (p.lecture_number ? `Лекция ${p.lecture_number}: ${p.topic}` : p.topic))
    .slice(0, 10)
}

function estimateSlideCount(minutes: number): number {
  return Math.max(5, Math.min(30, Math.round(minutes / 2)))
}

function styleLabel(style: string): string {
  const map: Record<string, string> = {
    theory_heavy:    'Теоретический (лекция-объяснение)',
    case_study:      'Разбор кейсов',
    discussion_based:'Дискуссионный (вопросы и обсуждение)',
  }
  return map[style] ?? style
}
