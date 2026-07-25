import { chatJSON, embed } from './deepseek'
import { findCourseById } from '../db/queries/courses'
import { findPresentationsByTeacher, createPresentation } from '../db/queries/presentations'
import { findRelevantChunks, type RelevantChunk } from '../db/queries/chunks'
import { incrementUsage } from '../db/queries/usageCounters'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { logger } from '../lib/logger'
import type {
  Presentation,
  PresentationSource,
  Slide,
  SlideType,
  TitleSlide,
  BulletsSlide,
  ConceptSlide,
  FormulaSlide,
  ComparisonSlide,
  DiagramSlide,
  DiscussionSlide,
  SummarySlide,
} from '../../../shared/types'

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
  sourceText?: string   // pasted lecture notes — takes priority over RAG retrieval, same as quizzes.ts
}

export interface GenerateResult {
  presentation_id:   string
  slides:            Slide[]
  generated_content: string             // text rendering, for copy-all UX
  sources:           PresentationSource[]
}

const MAX_SOURCES        = 6      // ceiling on retrieved chunks per generation
const SOURCE_EXCERPT_LEN = 280    // chars of chunk shown in the popover

// ─── Generate ─────────────────────────────────────────────────────────────────

export async function generatePresentation(params: GenerateParams): Promise<GenerateResult> {
  const course = params.courseId
    ? await findCourseById(params.courseId, params.teacherId)
    : null

  // A pasted conspectus is the teacher's own material — building the deck
  // from a course's uploaded reference chunks on top of it would mix two
  // different sources of truth for the same lecture. Same precedence as
  // quizzes.ts's sourceText.
  const sources = params.sourceText
    ? []
    : params.courseId
      ? await retrieveSources(params)
      : []

  const previousTopics = params.courseId
    ? await getPreviousTopics(params.teacherId, params.courseId, params.lectureNumber)
    : []

  const slideTarget = params.slideCountTarget ?? estimateSlideCount(params.durationMinutes)

  const systemPrompt =
    `Вы опытный разработчик учебных программ и методист. ` +
    `Ваша задача — создавать структурированные, разнообразные и педагогически выверенные лекции. ` +
    `Вы выбираете подходящий тип слайда под содержание: определение → concept, формула → formula, ` +
    `сравнение → comparison, схема/оборудование → diagram, вопрос для обсуждения → discussion. ` +
    `Длинные перечни маркеров — последний выбор, не первый. ` +
    `Пишите на русском языке. Отвечайте строго в формате JSON.`

  const userPrompt = buildPrompt(params, course, previousTopics, slideTarget, sources)

  // chatJSON handles "respond only with JSON" + a parse-and-retry loop, but
  // the retry re-sends the same prompt — it can't fix a truncation caused by
  // running out of output tokens. Left unset, providers default to ~4096
  // tokens (see longReview.ts's synthesis call for the same fix), which a
  // multi-slide deck (each slide's notes + body easily runs 150-250 tokens)
  // blows through well before slideTarget=40: JSON.parse then fails mid-array
  // on both the original and the retry, surfacing as an opaque
  // "Expected ',' or ']'" 500 (production incident, 2026-07-15). Scale with
  // slideTarget and cap at the lowest ceiling among the providers this call
  // can land on (yandex: 8000 — see llm/yandex.ts's CAPABILITIES).
  const raw = await chatJSON<{ slides: unknown[] }>(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    'slides',
    {
      context: { teacherId: params.teacherId, feature: 'presentation' },
      maxTokens: presentationMaxTokens(slideTarget),
    }
  )

  const validSourceIdx = new Set(sources.map((s) => s.idx))
  const slides = normaliseSlides(raw?.slides, validSourceIdx)

  // Union of structured citations and inline [N] markers found in slide
  // text — both are first-class. Sources nothing references get dropped from
  // the legend.
  const citedIdx = new Set<number>()
  slides.forEach((s) => s.citations.forEach((c) => citedIdx.add(c)))
  const usedSources = sources.filter((s) => citedIdx.has(s.idx))

  // Text rendering — populates `generated_content` so copy-all keeps working
  // and so the existing list/detail UIs (some of which still read text) don't
  // explode if they encounter a new-format row.
  const generatedContent = renderSlidesAsText(slides)

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
    generatedContent,
    slides,
    sources:          usedSources,
  })

  incrementUsage(params.teacherId, 'presentation').catch(() => null)

  return {
    presentation_id:   presentation.id,
    slides,
    generated_content: generatedContent,
    sources:           usedSources,
  }
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

  if (params.sourceText) {
    lines.push(`## Конспект лекции (стройте слайды строго по этому материалу, не добавляя фактов от себя)`)
    lines.push(sanitiseForPrompt(params.sourceText))
    lines.push('')
  }

  if (sources.length > 0) {
    lines.push(`## Материалы для ссылок`)
    lines.push(`Используйте маркер [N] в полях слайдов после тезисов/определений/заметок, опирающихся на эти источники.`)
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
    ? `\n- Помечайте источники маркером [N] прямо в тексте полей слайда (definition, items, caption, и т.д.) и одновременно дублируйте номера в поле "citations" слайда. Не выдумывайте номера, которых нет в списке материалов.`
    : ''

  lines.push(`
## Формат ответа

Верните JSON объект с одним ключом "slides" — массивом из ${slideTarget} элементов.
Каждый слайд имеет поля "type", "title", "notes", "citations" (массив номеров источников) и "body" в форме, зависящей от type.

ДОСТУПНЫЕ ТИПЫ СЛАЙДОВ:

• title (только слайд 1 — обложка)
  body: { "subtitle": "<предмет/курс>", "lecturer": "[ФИО лектора]" }

• bullets (универсальный, 3–5 кратких тезисов; используйте только когда никакой другой тип не подходит)
  body: { "items": ["...", "...", "..."] }

• concept (для введения и раскрытия одного понятия)
  body: { "definition": "1–2 предложения", "supporting": ["уточнение 1", "уточнение 2", "уточнение 3"] }

• formula (для уравнений и формул; LaTeX без обрамляющих $$)
  body: {
    "formulas": [{ "latex": "P = \\\\rho g Q H", "caption": "Полезная мощность насоса" }],
    "explanation": "1–2 предложения, что означают переменные"
  }

• comparison (для сопоставления двух подходов/типов)
  body: {
    "columns": [
      { "header": "Динамические насосы", "items": ["...", "..."] },
      { "header": "Объёмные насосы",     "items": ["...", "..."] }
    ]
  }

• diagram (для оборудования, схем, процессов — где визуал критичен)
  body: {
    "image_query": "осевой насос разрез схема",  // короткий поисковый запрос на русском
    "caption": "Конструкция центробежного насоса",
    "points": ["сразу под изображением — 1–3 уточняющих пункта"],
    "image": null  // изображение подберёт преподаватель
  }

• discussion (для вовлечения; обычно ближе к концу)
  body: {
    "question": "Главный провокационный вопрос",
    "prompts": ["подвопрос 1", "подвопрос 2"],
    "expected_angles": ["направление ответа 1", "направление ответа 2"]
  }

• summary (только последний слайд — итоги)
  body: { "takeaways": ["...", "...", "..."], "next_steps": ["к следующей лекции...", "литература..."] }

ПРАВИЛА ВЫБОРА ТИПА:
- Первый слайд всегда type="title".
- Последний слайд всегда type="summary".
- Минимум 1 слайд "discussion" если стиль "Дискуссионный".
- Используйте "concept" вместо "bullets" когда вводите новое понятие.
- Используйте "formula" для любого слайда с уравнением.
- Используйте "comparison" когда содержание естественно делится на 2 (реже 3) колонки.
- Используйте "diagram" для слайдов, где визуальное представление критично (оборудование, процесс, анатомия).
- "bullets" — резервный тип. В лекции из ${slideTarget} слайдов их должно быть не больше трети.

ЗАМЕТКИ ДОКЛАДЧИКА (поле "notes" каждого слайда):
- 2–4 предложения.
- Включайте КАК МИНИМУМ ОДНО из: провокационный вопрос для аудитории, типичное заблуждение, конкретный реальный пример из практики.
- Не дублируйте текст слайда — добавляйте контекст для лектора.

ФОРМУЛЫ В ТЕКСТЕ:
- В любом текстовом поле можно использовать LaTeX inline: $Q$, $\\\\eta$, $\\\\rho g Q H$. Не используйте $$ внутри полей text.${citationsClause}

Верните строго JSON без обрамляющего текста. Не добавляйте поля кроме перечисленных.`)

  return lines.join('\n')
}

// ─── Citation utilities ──────────────────────────────────────────────────────
//
// Slide text fields can still contain inline [N] markers (and we ask the model
// to include them so the rendered chips land at the right place in a sentence).
// This strips markers pointing at non-existent sources and reports which idx
// values were referenced. Kept as a named export for the test suite.

export function filterCitations(
  content: string,
  sources: PresentationSource[]
): { cleaned: string; used: PresentationSource[] } {
  const validIdx = new Set(sources.map((s) => s.idx))
  const { text, cited } = stripInvalidCitations(content, validIdx)
  const used = sources.filter((s) => cited.has(s.idx))
  return { cleaned: text, used }
}

function stripInvalidCitations(
  text: string,
  validIdx: Set<number>
): { text: string; cited: Set<number> } {
  const cited = new Set<number>()
  const cleaned = text.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_, group: string) => {
    const nums = group
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => validIdx.has(n))
    nums.forEach((n) => cited.add(n))
    return nums.length ? `[${nums.join(', ')}]` : ''
  })
  return { text: cleaned, cited }
}

function cleanInline(text: string, validIdx: Set<number>, citedAcc: Set<number>): string {
  const { text: out, cited } = stripInvalidCitations(text, validIdx)
  cited.forEach((c) => citedAcc.add(c))
  return out
}

// ─── Validation / coercion ───────────────────────────────────────────────────
//
// The model occasionally invents fields, misspells types, returns numbers
// where strings are expected, etc. We normalise once at the boundary so the
// rest of the system can trust the Slide union.

const KNOWN_TYPES: ReadonlyArray<SlideType> =
  ['title', 'bullets', 'concept', 'formula', 'comparison', 'diagram', 'discussion', 'summary']

function normaliseSlides(raw: unknown, validIdx: Set<number>): Slide[] {
  if (!Array.isArray(raw)) return []
  const out: Slide[] = []
  for (let i = 0; i < raw.length; i++) {
    const slide = coerceSlide(raw[i], validIdx, i + 1)
    if (slide) out.push(slide)
  }
  return out
}

function coerceSlide(input: unknown, validIdx: Set<number>, slideNumber: number): Slide | null {
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>

  const type = typeof o.type === 'string' && (KNOWN_TYPES as string[]).includes(o.type)
    ? (o.type as SlideType)
    : 'bullets'

  // Track citations from both the structured field and any inline [N] markers
  // we encounter while cleaning text bodies below.
  const citedAcc = new Set<number>()
  if (Array.isArray(o.citations)) {
    o.citations
      .map((c) => Number(c))
      .filter((n) => Number.isInteger(n) && validIdx.has(n))
      .forEach((n) => citedAcc.add(n))
  }

  const rawTitle = typeof o.title === 'string' && o.title.trim()
    ? o.title.trim()
    : `Слайд ${slideNumber}`
  const rawNotes = typeof o.notes === 'string' ? o.notes.trim() : ''

  const title = cleanInline(rawTitle, validIdx, citedAcc)
  const notes = cleanInline(rawNotes, validIdx, citedAcc)

  const body = (o.body && typeof o.body === 'object' ? o.body : {}) as Record<string, unknown>

  // Build body first (which may add to citedAcc), then snapshot citations.
  let result: Omit<Slide, 'citations'> & { citations?: number[] } | null = null

  switch (type) {
    case 'title': {
      const slide: Omit<TitleSlide, 'citations'> = {
        type: 'title',
        title,
        notes,
        body: {
          subtitle: strOrNull(body.subtitle, validIdx, citedAcc),
          lecturer: strOrNull(body.lecturer, validIdx, citedAcc),
        },
      }
      result = slide
      break
    }
    case 'bullets': {
      const slide: Omit<BulletsSlide, 'citations'> = {
        type: 'bullets',
        title,
        notes,
        body: { items: cleanArray(body.items, validIdx, citedAcc) },
      }
      result = slide
      break
    }
    case 'concept': {
      const slide: Omit<ConceptSlide, 'citations'> = {
        type: 'concept',
        title,
        notes,
        body: {
          definition: cleanInline(strOr(body.definition, ''), validIdx, citedAcc),
          supporting: cleanArray(body.supporting, validIdx, citedAcc),
        },
      }
      result = slide
      break
    }
    case 'formula': {
      const formulasRaw = Array.isArray(body.formulas) ? body.formulas : []
      const formulas = formulasRaw
        .map((f) => {
          if (!f || typeof f !== 'object') return null
          const fo = f as Record<string, unknown>
          const latex   = typeof fo.latex   === 'string' ? fo.latex.trim()   : ''
          const caption = typeof fo.caption === 'string'
            ? cleanInline(fo.caption.trim(), validIdx, citedAcc)
            : ''
          return latex ? { latex, caption } : null
        })
        .filter((f): f is { latex: string; caption: string } => f !== null)

      const slide: Omit<FormulaSlide, 'citations'> = {
        type: 'formula',
        title,
        notes,
        body: {
          formulas,
          explanation: strOrNull(body.explanation, validIdx, citedAcc),
        },
      }
      result = slide
      break
    }
    case 'comparison': {
      const colsRaw = Array.isArray(body.columns) ? body.columns : []
      const columns = colsRaw
        .map((c) => {
          if (!c || typeof c !== 'object') return null
          const co = c as Record<string, unknown>
          const header = typeof co.header === 'string'
            ? cleanInline(co.header.trim(), validIdx, citedAcc)
            : ''
          const items = cleanArray(co.items, validIdx, citedAcc)
          return header || items.length ? { header, items } : null
        })
        .filter((c): c is { header: string; items: string[] } => c !== null)

      // Need at least 2 columns to be a comparison. Otherwise demote to bullets.
      if (columns.length < 2) {
        const slide: Omit<BulletsSlide, 'citations'> = {
          type: 'bullets',
          title,
          notes,
          body: { items: columns[0]?.items ?? [] },
        }
        result = slide
        break
      }

      const slide: Omit<ComparisonSlide, 'citations'> = {
        type: 'comparison',
        title,
        notes,
        body: { columns },
      }
      result = slide
      break
    }
    case 'diagram': {
      const slide: Omit<DiagramSlide, 'citations'> = {
        type: 'diagram',
        title,
        notes,
        body: {
          image_query: typeof body.image_query === 'string' ? body.image_query.trim() : title,
          caption:     typeof body.caption     === 'string'
            ? cleanInline(body.caption.trim(), validIdx, citedAcc)
            : '',
          points:      cleanArray(body.points, validIdx, citedAcc),
          image:       null,   // teacher picks via UI — never trust an inline URL
        },
      }
      result = slide
      break
    }
    case 'discussion': {
      const slide: Omit<DiscussionSlide, 'citations'> = {
        type: 'discussion',
        title,
        notes,
        body: {
          question:        cleanInline(strOr(body.question, ''), validIdx, citedAcc),
          prompts:         cleanArray(body.prompts, validIdx, citedAcc),
          expected_angles: cleanArray(body.expected_angles, validIdx, citedAcc),
        },
      }
      result = slide
      break
    }
    case 'summary': {
      const slide: Omit<SummarySlide, 'citations'> = {
        type: 'summary',
        title,
        notes,
        body: {
          takeaways:  cleanArray(body.takeaways, validIdx, citedAcc),
          next_steps: cleanArray(body.next_steps, validIdx, citedAcc),
        },
      }
      result = slide
      break
    }
  }

  if (!result) return null
  return { ...result, citations: Array.from(citedAcc).sort((a, b) => a - b) } as Slide
}

function strOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v.trim() : fallback
}

function strOrNull(v: unknown, validIdx: Set<number>, citedAcc: Set<number>): string | null {
  if (typeof v !== 'string') return null
  const t = cleanInline(v.trim(), validIdx, citedAcc)
  return t.length ? t : null
}

function cleanArray(v: unknown, validIdx: Set<number>, citedAcc: Set<number>): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => cleanInline(s.trim(), validIdx, citedAcc))
    .filter(Boolean)
}

// ─── Text rendering (for copy-all + legacy `generated_content`) ──────────────
//
// Keeps a plain-text fallback alive so teachers can still "Скопировать всё"
// and dump the lecture into anywhere. Not parsed back — just for humans.

function renderSlidesAsText(slides: Slide[]): string {
  return slides
    .map((s, i) => renderSlideAsText(s, i + 1))
    .join('\n---\n')
}

function renderSlideAsText(s: Slide, n: number): string {
  const out: string[] = [`СЛАЙД ${n}: ${s.title}`]

  switch (s.type) {
    case 'title':
      if (s.body.subtitle) out.push(s.body.subtitle)
      if (s.body.lecturer) out.push(s.body.lecturer)
      break
    case 'bullets':
      s.body.items.forEach((b) => out.push(`• ${b}`))
      break
    case 'concept':
      out.push(s.body.definition)
      s.body.supporting.forEach((b) => out.push(`• ${b}`))
      break
    case 'formula':
      s.body.formulas.forEach((f) => {
        out.push(`  ${f.latex}`)
        if (f.caption) out.push(`  — ${f.caption}`)
      })
      if (s.body.explanation) out.push(s.body.explanation)
      break
    case 'comparison':
      s.body.columns.forEach((c) => {
        out.push(c.header.toUpperCase())
        c.items.forEach((it) => out.push(`  • ${it}`))
      })
      break
    case 'diagram':
      if (s.body.caption) out.push(s.body.caption)
      s.body.points.forEach((p) => out.push(`• ${p}`))
      if (s.body.image) out.push(`[Изображение: ${s.body.image.source_url}]`)
      else out.push(`[Подобрать изображение: «${s.body.image_query}»]`)
      break
    case 'discussion':
      out.push(`? ${s.body.question}`)
      s.body.prompts.forEach((p) => out.push(`  • ${p}`))
      break
    case 'summary':
      out.push('Главное:')
      s.body.takeaways.forEach((t) => out.push(`• ${t}`))
      if (s.body.next_steps.length) {
        out.push('Что дальше:')
        s.body.next_steps.forEach((t) => out.push(`• ${t}`))
      }
      break
  }

  if (s.notes) {
    out.push('')
    out.push('ЗАМЕТКИ ДОКЛАДЧИКА:')
    out.push(s.notes)
  }
  return out.join('\n')
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

// ~220 tokens/slide (title + 2-4 sentence notes + body — comparison/discussion
// bodies run higher) plus a fixed buffer for the JSON envelope. Capped at
// 8192 — deepseek/qwen's maxOutputTokens; yandex clamps this down to its own
// 8000 internally (see llm/yandex.ts), so passing 8192 is safe everywhere.
// This ceiling is the hard reason slide_count_target tops out at 30 (see
// generatePresentationRules) rather than higher — verified empirically
// (production incident, 2026-07-15): a 38-slide request burned the full
// requested budget on both the initial call AND chatJSON's built-in retry
// (usage log showed output_tokens=8000, i.e. hit the ceiling, twice) and
// still came back truncated — the retry re-sends the same oversized request,
// so it was always going to fail identically. There is no larger ceiling to
// raise to; 30 is where estimateSlideCount() below already tops out too.
export function presentationMaxTokens(slideTarget: number): number {
  return Math.min(8192, 1500 + slideTarget * 220)
}

function styleLabel(style: string): string {
  const map: Record<string, string> = {
    theory_heavy:    'Теоретический (лекция-объяснение)',
    case_study:      'Разбор кейсов',
    discussion_based:'Дискуссионный (вопросы и обсуждение)',
  }
  return map[style] ?? style
}

// Re-export so existing imports keep working even though we removed the old
// citation-filter approach (citations now live structurally on each slide).
export type { Presentation }
