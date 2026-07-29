import { chatJSON, embed } from './deepseek'
import { findCourseById } from '../db/queries/courses'
import { findPresentationsByTeacher, createPresentation } from '../db/queries/presentations'
import { findRelevantChunks, hasAnyChunksForCourse, type RelevantChunk } from '../db/queries/chunks'
import { incrementUsage } from '../db/queries/usageCounters'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { yandexImageSearch } from './yandexImages'
import { webSearch, type SearchResult } from './yandexSearch'
import { logger } from '../lib/logger'
import type {
  Presentation,
  PresentationSource,
  PresentationDepth,
  Slide,
  SlideType,
  SlideImage,
  ImageCandidate,
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
  depth?: PresentationDepth   // 'standard' (default) or 'deep' (Pro+ — see planLimits.ts's presentationDeepMode)
}

export interface GenerateResult {
  presentation_id:   string
  slides:            Slide[]
  generated_content: string             // text rendering, for copy-all UX
  sources:           PresentationSource[]
}

// Generation runs as outline (cheap, structure-only) + parallel expansion
// batches (each with its own full token budget + RAG retrieval) rather than
// one call for the whole deck — see TODO.md Feature AG Phase 1. A single
// call budgeted ~220 tokens/slide total, nowhere near enough for the
// ≥1min30s-per-slide speaking notes teachers asked for; batching gives each
// slide the token budget of a small standalone generation.
const EXPANSION_BATCH_SIZE  = 5   // outline slides handled per expansion call
const EXPANSION_CONCURRENCY = 3   // parallel expansion calls — matches longReview.ts's MAP_CONCURRENCY
const MAX_SOURCES_PER_BATCH = 4   // RAG chunks retrieved per expansion batch (was a single MAX_SOURCES=6 for the whole deck)
const SOURCE_EXCERPT_LEN    = 280 // chars of chunk shown in the popover (prompt gets the full chunk text — see SourcePool)

export const NOTES_WORD_TARGET: Record<PresentationDepth, readonly [number, number]> = {
  standard: [180, 220],   // ~1min30s of speech — the floor the feedback asked for
  deep:     [260, 320],   // Pro+ — a fuller script with more worked example detail
}

// Auto-image (TODO.md Feature AG Phase 2) — images used to be `null` at
// generation, filled in only if the teacher manually opened the picker.
// Now every slide with a model-chosen image_query gets a best-effort search
// baked in, still swappable via the same picker afterward.
const IMAGE_SEARCH_CONCURRENCY = 3    // parallel Yandex Images calls
const MAX_AUTO_IMAGES          = 20   // ceiling on a very large deck — remaining slides keep a manually-searchable empty slot, same UX as before this feature

// ─── Generate ─────────────────────────────────────────────────────────────────

export async function generatePresentation(params: GenerateParams): Promise<GenerateResult> {
  const course = params.courseId
    ? await findCourseById(params.courseId, params.teacherId)
    : null

  const previousTopics = params.courseId
    ? await getPreviousTopics(params.teacherId, params.courseId, params.lectureNumber)
    : []

  const slideTarget = params.slideCountTarget ?? estimateSlideCount(params.durationMinutes)
  const depth: PresentationDepth = params.depth === 'deep' ? 'deep' : 'standard'

  // ── Web-search grounding (TODO.md Feature AG Phase 3) — a deck with no
  // pasted conspectus AND no course RAG material to draw on has nothing
  // grounding it besides the model's own training knowledge, which is
  // exactly the "shallow, generic" failure mode the original feedback
  // named. One cheap probe (no embedding call) decides whether this deck
  // qualifies; a single webSearch call (not per-batch — cost/latency stay
  // O(1) regardless of slide count) supplies background context to every
  // expansion batch. Narrative context only, same posture as
  // topics.ts's existing webSearch usage — NOT formally citable like RAG
  // chunks are, since we can't verbatim-verify a web snippet the way
  // validateCitation does for uploaded documents.
  const courseHasChunks = params.courseId ? await hasAnyChunksForCourse(params.courseId) : false
  const webGrounding = shouldUseWebGrounding(Boolean(params.sourceText), Boolean(params.courseId), courseHasChunks)
    ? await fetchWebGrounding(params.topic)
    : []

  // ── Outline pass — cheap, structure-only. Decides slide count/order/type
  // and a one-line brief per slide; no RAG, no full-length writing yet. ────
  const outlineSystemPrompt =
    `Вы опытный разработчик учебных программ и методист. ` +
    `Вы строите план лекции: порядок слайдов, их тип и краткое техническое ` +
    `задание по содержанию для каждого — сам текст слайдов напишет другой автор. ` +
    `Вы выбираете подходящий тип слайда под содержание: определение → concept, формула → formula, ` +
    `сравнение → comparison, схема/оборудование → diagram, вопрос для обсуждения → discussion. ` +
    `Длинные перечни маркеров — последний выбор, не первый. ` +
    `Пишите на русском языке. Отвечайте строго в формате JSON.`

  const outlineRaw = await chatJSON<{ outline: unknown[] }>(
    [
      { role: 'system', content: outlineSystemPrompt },
      { role: 'user',   content: buildOutlinePrompt(params, course, previousTopics, slideTarget, webGrounding) },
    ],
    'outline',
    {
      context: { teacherId: params.teacherId, feature: 'presentation' },
      maxTokens: outlineMaxTokens(slideTarget),
    }
  )
  const outline = normaliseOutline(outlineRaw?.outline, slideTarget)

  // ── Expansion pass — parallel batches, each with its own RAG retrieval
  // and its own full token budget (this is what actually fixes the
  // shallowness: ~700–1000 tokens/slide instead of the old whole-deck
  // call's ~220). A pasted conspectus (teacher's own material) or a
  // course-less generation skips RAG entirely, same precedent as
  // quizzes.ts's sourceText. ──────────────────────────────────────────────
  const pool = createSourcePool()
  const batches = chunkArray(outline, EXPANSION_BATCH_SIZE)

  const expandedBatches = await mapWithConcurrency(batches, EXPANSION_CONCURRENCY, async (batch) => {
    const batchSources = (params.sourceText || !params.courseId)
      ? []
      : await retrieveForBatch(params, batch, pool)

    const expansionSystemPrompt =
      `Вы опытный преподаватель, пишущий полный текст слайдов и сценарий ` +
      `выступления по уже готовому плану лекции — тип и заголовок каждого ` +
      `слайда уже определены, менять их нельзя. ` +
      `Пишите на русском языке. Отвечайте строго в формате JSON.`

    const raw = await chatJSON<{ slides: unknown[] }>(
      [
        { role: 'system', content: expansionSystemPrompt },
        { role: 'user',   content: buildExpansionPrompt(batch, params, depth, batchSources, pool.fullText, webGrounding) },
      ],
      'slides',
      {
        context: { teacherId: params.teacherId, feature: 'presentation' },
        maxTokens: expansionBatchMaxTokens(batch.length, depth),
      }
    )

    const validIdx = new Set(batchSources.map((s) => s.idx))
    return normaliseSlides(raw?.slides, validIdx)
  })

  const slidesWithoutImages = expandedBatches.flat()
  const slides  = await autoFillImages(slidesWithoutImages)
  const sources = pool.all()

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
//
// Retrieval runs once per expansion batch (query = topic + that batch's own
// slide titles/briefs) instead of once for the whole deck — each batch gets
// sources targeted at what it's actually writing, and the prompt gets the
// full chunk text rather than the 280-char excerpt reserved for the UI
// popover. A SourcePool dedupes chunks retrieved by more than one batch
// (common when adjacent slides cover related material) and hands out a
// single stable idx per chunk so [N] markers stay consistent across the
// whole deck even though retrieval itself is now per-batch.

export interface SourcePool {
  ingest(chunks: RelevantChunk[]): PresentationSource[]
  all(): PresentationSource[]
  fullText: Map<number, string>   // idx → untruncated chunk text, for the prompt
}

export function createSourcePool(): SourcePool {
  const byKey   = new Map<string, PresentationSource>()   // `${document_id}:${chunk_index}` → source
  const fullText = new Map<number, string>()
  let nextIdx = 1
  return {
    ingest(chunks) {
      // Synchronous — safe to call from multiple concurrently-running
      // expansion batches (mapWithConcurrency) despite JS's single-threaded
      // interleaving, since nothing here awaits mid-mutation.
      return chunks.map((c) => {
        const key = `${c.document_id}:${c.chunk_index}`
        const existing = byKey.get(key)
        if (existing) return existing
        const source = toSource(c, nextIdx++)
        byKey.set(key, source)
        fullText.set(source.idx, c.text)
        return source
      })
    },
    all() { return Array.from(byKey.values()) },
    fullText,
  }
}

async function retrieveForBatch(
  params: GenerateParams,
  batch: OutlineSlideSpec[],
  pool: SourcePool,
): Promise<PresentationSource[]> {
  try {
    const query = [
      params.topic,
      ...batch.map((s) => `${s.title}: ${s.brief}`.trim()),
    ].filter(Boolean).join(' · ')

    const vector = await embed(query, { teacherId: params.teacherId, feature: 'embedding' })
    const chunks = await findRelevantChunks(params.courseId!, vector, MAX_SOURCES_PER_BATCH)
    return pool.ingest(chunks)
  } catch (err) {
    logger.warn({ message: '[RAG presentations] could not retrieve sources for batch', error: (err as Error).message })
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

// ─── Auto-image ─────────────────────────────────────────────────────────────
//
// Every slide type can carry an image_query now (see shared/types.ts's
// SlideBase — diagram keeps its own body.image_query/image, everything else
// uses the top-level fields). This resolves whichever query a slide has,
// searches in parallel (bounded concurrency, capped at MAX_AUTO_IMAGES for a
// very large deck), and writes the top-ranked result back — best-effort,
// same as RAG retrieval: a search failure just leaves that slide's image
// slot empty for the teacher to fill manually, exactly like before this
// feature existed.

export function getSlideImageQuery(slide: Slide): string {
  return slide.type === 'diagram' ? slide.body.image_query : (slide.image_query ?? '')
}

export function hasSlideImage(slide: Slide): boolean {
  return Boolean(slide.type === 'diagram' ? slide.body.image : slide.image)
}

export function withSlideImage(slide: Slide, image: SlideImage): Slide {
  return slide.type === 'diagram'
    ? { ...slide, body: { ...slide.body, image } }
    : { ...slide, image }
}

function toSlideImage(c: ImageCandidate, query: string): SlideImage {
  return {
    url: c.url, source_url: c.source_url, thumbnail: c.thumbnail,
    width: c.width, height: c.height, source_host: c.source_host, query,
  }
}

export async function autoFillImages(slides: Slide[]): Promise<Slide[]> {
  const candidates = slides
    .map((slide, index) => ({ index, query: getSlideImageQuery(slide).trim() }))
    .filter((c) => c.query.length > 0)
    .slice(0, MAX_AUTO_IMAGES)

  if (candidates.length === 0) return slides

  const picks = await mapWithConcurrency(candidates, IMAGE_SEARCH_CONCURRENCY, async ({ index, query }) => {
    try {
      const results = await yandexImageSearch(query, 3)
      return results[0] ? { index, image: toSlideImage(results[0], query) } : null
    } catch (err) {
      logger.warn({ message: '[auto-image] search failed', query, error: (err as Error).message })
      return null
    }
  })

  const byIndex = new Map(picks.filter((p): p is { index: number; image: SlideImage } => p !== null).map((p) => [p.index, p.image]))
  return slides.map((slide, i) => {
    const image = byIndex.get(i)
    return image ? withSlideImage(slide, image) : slide
  })
}

// ─── Web-search grounding ───────────────────────────────────────────────────
//
// webSearch (yandexSearch.ts) is already best-effort — it swallows its own
// failures and returns [] with a warn log — so this wrapper's only job is
// picking a sane result count for prompt-injection purposes.

const WEB_GROUNDING_RESULTS = 5

/**
 * Pure decision rule, split out for unit-testing without a DB — a deck
 * qualifies for web-search grounding when it has neither a pasted
 * conspectus nor any course RAG material to draw on.
 */
export function shouldUseWebGrounding(hasSourceText: boolean, hasCourseId: boolean, courseHasChunks: boolean): boolean {
  return !hasSourceText && (!hasCourseId || !courseHasChunks)
}

async function fetchWebGrounding(topic: string): Promise<SearchResult[]> {
  return webSearch(topic, WEB_GROUNDING_RESULTS)
}

// ─── Outline ────────────────────────────────────────────────────────────────
//
// One slide's worth of plan: a decided type + title, and a brief that's a
// technical brief for the expansion pass, not prose — "виды насосов:
// объёмные vs динамические, критерий выбора", not "рассказать про насосы".

export interface OutlineSlideSpec {
  type:  SlideType
  title: string
  brief: string
}

// Renders web-search results as background orientation, not citable
// evidence — there's nothing to verbatim-verify a snippet against the way
// validateCitation checks an uploaded document, so the model is told
// explicitly not to attach [N] markers to it.
function renderWebGroundingBlock(results: SearchResult[]): string[] {
  if (results.length === 0) return []
  const lines = [
    `## Материалы из общего поиска (для общей ориентации — НЕ источник для маркеров [N], в отличие от материалов выше)`,
  ]
  results.forEach((r) => {
    lines.push(`- ${r.title}: ${sanitiseForPrompt(r.snippet)}`)
  })
  lines.push('')
  return lines
}

function buildOutlinePrompt(
  params: GenerateParams,
  course: Awaited<ReturnType<typeof findCourseById>>,
  previousTopics: string[],
  slideTarget: number,
  webGrounding: SearchResult[] = [],
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
    lines.push(`## Конспект лекции (план должен строго следовать этому материалу, не добавляя фактов от себя)`)
    lines.push(sanitiseForPrompt(params.sourceText))
    lines.push('')
  }

  lines.push(...renderWebGroundingBlock(webGrounding))

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

  lines.push(`
## Задача

Постройте ПЛАН лекции — порядок и тип каждого слайда с кратким техническим
заданием по содержанию. Полный текст слайдов напишет другой автор по этому
плану, поэтому задание должно быть конкретным: не "рассказать про насосы",
а "виды насосов: объёмные vs динамические, критерий выбора для конкретной
задачи".

Верните JSON объект с одним ключом "outline" — массивом из ${slideTarget} элементов.
Каждый элемент: { "type", "title", "brief" }.

- "type" — один из: title, bullets, concept, formula, comparison, diagram, discussion, summary.
- "title" — заголовок слайда.
- "brief" — 1–2 предложения: какой именно контент, факт, пример или вопрос должен раскрыть этот слайд.

ПРАВИЛА ВЫБОРА ТИПА:
- Первый слайд всегда type="title".
- Последний слайд всегда type="summary".
- Минимум 1 слайд "discussion" если стиль "Дискуссионный".
- "concept" вместо "bullets" когда вводится новое понятие.
- "formula" для любого слайда с уравнением.
- "comparison" когда содержание естественно делится на 2 (реже 3) колонки.
- "diagram" для слайдов, где визуальное представление критично (оборудование, процесс, анатомия) — brief должен явно называть, что именно изображено.
- "bullets" — резервный тип. В лекции из ${slideTarget} слайдов их должно быть не больше трети. Длинные перечни маркеров — последний выбор, не первый.

Верните строго JSON без обрамляющего текста.`)

  return lines.join('\n')
}

export function normaliseOutline(raw: unknown, slideTarget: number): OutlineSlideSpec[] {
  // Defensive ceiling against a hallucinated runaway array — each entry
  // becomes a real LLM call downstream, so an unbounded array is a real
  // cost/latency risk, not just a quality one.
  const arr = (Array.isArray(raw) ? raw : []).slice(0, Math.max(slideTarget * 2, 10))

  const out: OutlineSlideSpec[] = arr.map((entry, i) => {
    const o = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const type = typeof o.type === 'string' && (KNOWN_TYPES as string[]).includes(o.type)
      ? (o.type as SlideType)
      : 'bullets'
    const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : `Слайд ${i + 1}`
    const brief = typeof o.brief === 'string' ? o.brief.trim() : ''
    return { type, title, brief }
  })

  // Total outline failure — fall back to a minimal shell so expansion still
  // produces a valid (if thin) deck instead of the whole request failing.
  if (out.length === 0) {
    return [
      { type: 'title',   title: 'Слайд 1', brief: '' },
      { type: 'summary', title: 'Итоги',   brief: '' },
    ]
  }

  // Structural safety net — the prompt asks for this, but a slide sequence
  // that doesn't open/close correctly is worse than overriding the model.
  out[0] = { ...out[0], type: 'title' }
  out[out.length - 1] = { ...out[out.length - 1], type: 'summary' }
  return out
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// ─── Expansion ──────────────────────────────────────────────────────────────
//
// Writes the full text for one batch of outline slides. Type and title are
// already decided — the model isn't re-choosing them, only writing body +
// speaker notes, which shrinks the instruction surface (and error space)
// compared to the old single whole-deck prompt.

function buildExpansionPrompt(
  batch:   OutlineSlideSpec[],
  params:  GenerateParams,
  depth:   PresentationDepth,
  sources: PresentationSource[],
  fullTextByIdx: Map<number, string>,
  webGrounding: SearchResult[] = [],
): string {
  const lines: string[] = []

  if (params.sourceText) {
    lines.push(`## Конспект лекции (пишите строго по этому материалу, не добавляя фактов от себя)`)
    lines.push(sanitiseForPrompt(params.sourceText))
    lines.push('')
  }

  lines.push(...renderWebGroundingBlock(webGrounding))

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
      // Full chunk text, not the popover's 280-char excerpt — this is the
      // whole point of retrieving per batch instead of once for the deck.
      lines.push(sanitiseForPrompt(fullTextByIdx.get(s.idx) ?? s.excerpt))
      lines.push('')
    })
  }

  lines.push(`## План слайдов для написания (${batch.length})`)
  batch.forEach((s, i) => {
    lines.push(`${i + 1}. [${s.type}] ${s.title}`)
    if (s.brief) lines.push(`   Содержание: ${s.brief}`)
  })
  lines.push('')

  if (params.audienceLevel) lines.push(`Аудитория: ${params.audienceLevel}`)
  if (params.style)         lines.push(`Стиль подачи: ${styleLabel(params.style)}`)

  const [wMin, wMax] = NOTES_WORD_TARGET[depth]
  const citationsClause = sources.length > 0
    ? `\n- Помечайте источники маркером [N] прямо в тексте полей слайда (definition, items, caption, и т.д.) и одновременно дублируйте номера в поле "citations" слайда. Не выдумывайте номера, которых нет в списке материалов.`
    : ''

  lines.push(`
## Формат ответа

Тип и заголовок каждого слайда уже определены планом выше — скопируйте их
без изменений. Ваша задача — написать body (содержание слайда) и notes
(заметки докладчика).

Верните JSON объект с одним ключом "slides" — массивом из ${batch.length} элементов,
в том же порядке, что план. Каждый элемент: { "type", "title", "notes", "citations", "body" }.

ДОСТУПНЫЕ ТИПЫ СЛАЙДОВ (body по схеме для указанного в плане type):

• title
  body: { "subtitle": "<предмет/курс>", "lecturer": "[ФИО лектора]" }

• bullets (3–5 кратких тезисов)
  body: { "items": ["...", "...", "..."] }

• concept
  body: { "definition": "1–2 предложения", "supporting": ["уточнение 1", "уточнение 2", "уточнение 3"] }

• formula (LaTeX без обрамляющих $$)
  body: {
    "formulas": [{ "latex": "P = \\\\rho g Q H", "caption": "Полезная мощность насоса" }],
    "explanation": "1–2 предложения, что означают переменные"
  }

• comparison
  body: {
    "columns": [
      { "header": "...", "items": ["...", "..."] },
      { "header": "...", "items": ["...", "..."] }
    ]
  }

• diagram
  body: {
    "image_query": "поисковый запрос на русском: конкретный объект + техническое слово вида «разрез», «схема», «чертёж», «принципиальная схема» — НЕ общее название темы",
    "caption": "подпись под изображением",
    "points": ["1–3 уточняющих пункта сразу под изображением"],
    "image": null
  }

• discussion
  body: {
    "question": "главный провокационный вопрос",
    "prompts": ["подвопрос 1", "подвопрос 2"],
    "expected_angles": ["направление ответа 1", "направление ответа 2"]
  }

• summary
  body: { "takeaways": ["...", "...", "..."], "next_steps": ["к следующей лекции...", "литература..."] }

ИЗОБРАЖЕНИЯ ДЛЯ ДРУГИХ ТИПОВ СЛАЙДОВ (кроме title/summary/diagram — у diagram своё поле внутри body):
- Добавляйте необязательное поле верхнего уровня "image_query" (рядом с "type"/"title", НЕ внутри body), когда изображение реально усилит слайд: оборудование, схема, график, физический объект, пространственная компоновка.
- НЕ добавляйте это поле для чисто текстового/аргументационного содержания (bullets с тезисами, discussion-вопросы без визуальной составляющей) — большинство слайдов НЕ должны иметь картинку.
- Формат запроса тот же, что у diagram: конкретный объект + техническое слово («схема», «разрез», «график», «чертёж»), не общая тема лекции.
- Если поле не нужно — просто не добавляйте его (не пишите null явно и не пишите пустую строку).

ЗАМЕТКИ ДОКЛАДЧИКА (поле "notes") — сценарий выступления на ${wMin}–${wMax} слов
(этого хватает примерно на 1.5 минуты речи), а не короткая аннотация. Стройте по структуре:
1. Почему это важно для студента.
2. Развёрнутое объяснение содержания слайда.
3. Конкретный пример с реальными числами или деталями — не абстрактный.
4. Типичное заблуждение или ошибка, которую здесь допускают.
5. Переход к следующему слайду.
Не дублируйте текст слайда — notes должны звучать как речь, а не как повтор body.

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

  // Top-level image_query (any type except diagram, which keeps its own
  // body.image_query — see shared/types.ts's SlideBase comment). `image`
  // itself is never trusted from raw JSON — autoFillImages fills it via a
  // real search, same "never trust an inline URL" rule as diagram's.
  const topLevelImageQuery = result.type !== 'diagram' && typeof o.image_query === 'string'
    ? o.image_query.trim()
    : ''

  return {
    ...result,
    ...(topLevelImageQuery ? { image_query: topLevelImageQuery } : {}),
    citations: Array.from(citedAcc).sort((a, b) => a - b),
  } as Slide
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

  // Top-level image (any type except diagram, already handled in its own
  // case above via body.image/body.image_query).
  if (s.type !== 'diagram' && s.image_query) {
    out.push(s.image ? `[Изображение: ${s.image.source_url}]` : `[Подобрать изображение: «${s.image_query}»]`)
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
  // Was capped at 30 to fit the old single-call generation's 8192-token
  // ceiling (see the 2026-07-15 incident this codebase used to document
  // here). Outline+expansion batches independently now — each batch has its
  // own full 8192-token budget regardless of total slide count — so the cap
  // is a product/cost decision (a 90-slide "lecture" is a scope problem, not
  // a token-budget one), not a technical wall. Raised to 50.
  return Math.max(5, Math.min(50, Math.round(minutes / 2)))
}

// Outline is cheap: ~80-90 tokens/slide (type + title + one-line brief),
// plus a fixed buffer for the JSON envelope.
export function outlineMaxTokens(slideTarget: number): number {
  return Math.min(4000, 800 + slideTarget * 90)
}

// Expansion writes the actual body + speaking-script notes, so this is
// where the real per-slide budget lives — sized off the depth-specific word
// target (see NOTES_WORD_TARGET): ~700 tokens/slide for a 180-220 word
// script (standard), ~1000 for a 260-320 word script (deep), Russian text
// running roughly 1.5-2 tokens/word plus body content and JSON overhead.
// Capped at 8192 — deepseek/qwen's maxOutputTokens; yandex clamps this down
// to its own 8000 internally (see llm/yandex.ts), so passing 8192 is safe
// everywhere. Sized per BATCH, not per deck — EXPANSION_BATCH_SIZE keeps a
// batch's total comfortably under that ceiling regardless of how many
// slides the whole deck has.
const PER_SLIDE_TOKENS: Record<PresentationDepth, number> = {
  standard: 700,
  deep:     1000,
}

export function expansionBatchMaxTokens(batchSize: number, depth: PresentationDepth): number {
  return Math.min(8192, 600 + batchSize * PER_SLIDE_TOKENS[depth])
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
