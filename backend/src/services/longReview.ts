import { chatJSON } from './deepseek'
import { findRubricById } from '../db/queries/rubrics'
import { createAssignment } from '../db/queries/assignments'
import {
  setLongReviewStatus,
  setLongReviewProgress,
  completeLongReview,
  failLongReview,
} from '../db/queries/longReviews'
import { incrementUsage } from '../db/queries/usageCounters'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { logger } from '../lib/logger'
import type { CallContext } from './deepseek'
import type { LongReviewResult, ChapterReview, GradeLetter, RubricCriterion } from '../../../shared/types'

// ─── Tuning ────────────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN     = 3.5
const SECTION_TARGET_CHARS = 17_500   // ~5k tokens per map unit
const SECTION_MAX_CHARS    = 31_500   // ~9k tokens — split anything larger
const MAX_SECTIONS         = 24       // cost ceiling on the map phase
const MAP_CONCURRENCY      = 3        // parallel section analyses
const VERBATIM_CHARS       = 6_000    // intro/conclusion kept in full for the reduce

// ─── Public entry — runs the whole pipeline for one review job ─────────────────

interface RunParams {
  reviewId:       string
  teacherId:      string
  courseId?:      string | null
  rubricId?:      string | null
  studentName?:   string | null
  studentEmail?:  string | null
  studentGroup?:  string | null
  submissionText: string
}

/** Fire-and-forget orchestrator. Updates the job row as it progresses. */
export async function runLongReview(p: RunParams): Promise<void> {
  const ctx: CallContext = { teacherId: p.teacherId, feature: 'grading' }
  try {
    const rubric = p.rubricId ? await findRubricById(p.rubricId, p.teacherId) : null

    const sections = splitIntoSections(p.submissionText)
    await setLongReviewStatus(p.reviewId, 'analyzing')
    await setLongReviewProgress(p.reviewId, 0, sections.length)

    // ── Map: analyse each section, with bounded concurrency + progress ──────────
    let done = 0
    const analyses = await mapWithConcurrency(sections, MAP_CONCURRENCY, async (sec) => {
      const a = await analyzeSection(sec, rubric?.criteria ?? [], ctx)
      done += 1
      await setLongReviewProgress(p.reviewId, done, sections.length).catch(() => null)
      return a
    })

    // ── Reduce: synthesise the overall review ───────────────────────────────────
    await setLongReviewStatus(p.reviewId, 'synthesizing')
    const result = await synthesizeReview(sections, analyses, rubric?.name, rubric?.criteria, ctx)

    // ── Draft assignment so it flows into history / approval / email / RAG ──────
    const assignment = await createAssignment({
      teacherId:     p.teacherId,
      courseId:      p.courseId ?? undefined,
      rubricId:      p.rubricId ?? undefined,
      studentName:   p.studentName ?? undefined,
      studentEmail:  p.studentEmail ?? undefined,
      studentGroup:  p.studentGroup ?? undefined,
      submissionText: p.submissionText,
      aiScore:       clampScore(result.suggested_score),
      aiGrade:       normaliseGrade(result.suggested_grade),
      aiGradeLabel:  result.grade_label ?? gradeToLabel(normaliseGrade(result.suggested_grade)),
      aiFeedback:    result.overall_summary,
      aiCriteriaScores: [],
      aiStrengths:   result.overall_strengths ?? [],
      aiImprovements: result.overall_gaps ?? [],
    })

    await completeLongReview(p.reviewId, result, assignment.id)
    incrementUsage(p.teacherId, 'grade').catch(() => null)
    logger.info({ message: 'Long review completed', reviewId: p.reviewId, sections: sections.length })
  } catch (err) {
    logger.error({ message: 'Long review failed', reviewId: p.reviewId, error: (err as Error).message })
    await failLongReview(p.reviewId, (err as Error).message).catch(() => null)
  }
}

// ─── Section splitting ─────────────────────────────────────────────────────────

export interface Section {
  title: string
  text:  string
  kind:  'intro' | 'conclusion' | 'references' | 'body'
}

const HEADING_KEYWORDS =
  /^(?:(?:ГЛАВА|РАЗДЕЛ|CHAPTER|PART)\s+[\dIVXLС]+.*|ВВЕДЕНИЕ|ЗАКЛЮЧЕНИЕ|ОГЛАВЛЕНИЕ|СОДЕРЖАНИЕ|РЕФЕРАТ|АННОТАЦИЯ|ABSTRACT|INTRODUCTION|CONCLUSION|ВЫВОДЫ.*|СПИСОК\s+(?:ИСПОЛЬЗОВАННЫХ\s+)?(?:ИСТОЧНИКОВ|ЛИТЕРАТУРЫ).*|БИБЛИОГРАФ\w*.*|REFERENCES|ПРИЛОЖЕНИ\w+.*)$/iu

const NUMBERED_HEADING = /^\d+(?:\.\d+){0,3}\.?\s+\S.{0,88}$/u

function isHeading(line: string): boolean {
  const t = line.trim()
  if (!t || t.length > 90) return false
  if (HEADING_KEYWORDS.test(t)) return true
  if (NUMBERED_HEADING.test(t)) return true
  // Mostly-uppercase short line (e.g. "ТЕОРЕТИЧЕСКИЕ ОСНОВЫ")
  const letters = t.replace(/[^\p{L}]/gu, '')
  if (letters.length >= 4 && letters === letters.toUpperCase() && /\s/.test(t)) return true
  return false
}

function classify(title: string): Section['kind'] {
  const t = title.toLowerCase()
  if (/введение|introduction/.test(t)) return 'intro'
  if (/заключение|выводы|conclusion/.test(t)) return 'conclusion'
  if (/список|литератур|библиограф|references|приложени/.test(t)) return 'references'
  return 'body'
}

/** Split a long document into balanced, section-aware units for the map phase. */
export function splitIntoSections(text: string): Section[] {
  const lines = text.split('\n')
  const raw: { title: string; body: string[] }[] = []
  let current: { title: string; body: string[] } | null = null

  for (const line of lines) {
    if (isHeading(line)) {
      if (current) raw.push(current)
      current = { title: line.trim(), body: [] }
    } else {
      if (!current) current = { title: 'Начало работы', body: [] }
      current.body.push(line)
    }
  }
  if (current) raw.push(current)

  // Build sections, dropping empties
  let sections: Section[] = raw
    .map((s) => ({ title: s.title, text: s.body.join('\n').trim(), kind: classify(s.title) }))
    .filter((s) => s.text.length > 0 || s.kind !== 'body')

  // No headings detected at all → fall back to pure size-based windows
  if (sections.length <= 1 && text.length > SECTION_MAX_CHARS) {
    sections = sizeSplit(text, 'Часть').map((s) => ({ ...s, kind: 'body' as const }))
  }

  sections = balance(sections)
  return sections
}

// Greedily merge small adjacent sections and split oversized ones, capped at MAX_SECTIONS.
function balance(sections: Section[]): Section[] {
  // Split oversized sections first
  const expanded: Section[] = []
  for (const s of sections) {
    if (s.text.length > SECTION_MAX_CHARS) {
      const parts = sizeSplit(s.text, s.title)
      parts.forEach((p) => expanded.push({ ...p, kind: s.kind }))
    } else {
      expanded.push(s)
    }
  }

  // Merge consecutive small sections of the same-ish kind up to the target size
  const merged: Section[] = []
  for (const s of expanded) {
    const last = merged[merged.length - 1]
    if (
      last &&
      last.kind === 'body' && s.kind === 'body' &&
      last.text.length + s.text.length <= SECTION_TARGET_CHARS
    ) {
      last.title = `${last.title} · ${s.title}`.slice(0, 160)
      last.text  = `${last.text}\n\n${s.title}\n${s.text}`
    } else {
      merged.push({ ...s })
    }
  }

  // Final cost cap — if still too many units, merge the smallest neighbours
  while (merged.length > MAX_SECTIONS) {
    let idx = 0
    let min = Infinity
    for (let i = 0; i < merged.length - 1; i++) {
      const size = merged[i].text.length + merged[i + 1].text.length
      if (size < min) { min = size; idx = i }
    }
    merged[idx].title = `${merged[idx].title} · ${merged[idx + 1].title}`.slice(0, 160)
    merged[idx].text  = `${merged[idx].text}\n\n${merged[idx + 1].text}`
    merged.splice(idx + 1, 1)
  }

  return merged
}

// Split a big block into ~target-sized parts on paragraph boundaries.
function sizeSplit(text: string, baseTitle: string): { title: string; text: string }[] {
  const paras = text.split(/\n\s*\n/)
  const parts: { title: string; text: string }[] = []
  let buf = ''
  let n = 1
  for (const para of paras) {
    if (buf && buf.length + para.length > SECTION_TARGET_CHARS) {
      parts.push({ title: `${baseTitle} (часть ${n++})`, text: buf.trim() })
      buf = para
    } else {
      buf = buf ? `${buf}\n\n${para}` : para
    }
  }
  if (buf.trim()) parts.push({ title: `${baseTitle} (часть ${n})`, text: buf.trim() })
  return parts
}

// ─── Map: analyse one section ──────────────────────────────────────────────────

interface SectionAnalysis {
  title:     string
  summary:   string
  strengths: string[]
  gaps:      string[]
}

async function analyzeSection(
  section: Section,
  criteria: RubricCriterion[],
  ctx: CallContext
): Promise<SectionAnalysis> {
  const criteriaHint = criteria.length
    ? `Критерии оценки работы: ${criteria.map((c) => c.name).join(', ')}.\n`
    : ''
  // Cap the text sent per section (huge reference lists / appendices)
  const body = capMiddle(section.text, SECTION_MAX_CHARS)

  const system =
    `Вы — научный рецензент выпускных квалификационных работ. Кратко и предметно проанализируйте ` +
    `один раздел работы. Отвечайте только валидным JSON на русском языке.`
  const user =
    `${criteriaHint}Раздел: «${section.title}»
<section>
${sanitiseForPrompt(body)}
</section>

Верните JSON: {"summary": "2–4 предложения о содержании и качестве раздела", ` +
    `"strengths": ["до 3 сильных сторон"], "gaps": ["до 3 недостатков или вопросов"]}`

  try {
    const r = await chatJSON<{ summary: string; strengths?: string[]; gaps?: string[] }>(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      'анализ раздела',
      ctx,
    )
    return {
      title:     section.title,
      summary:   r.summary ?? '',
      strengths: (r.strengths ?? []).slice(0, 3),
      gaps:      (r.gaps ?? []).slice(0, 3),
    }
  } catch (err) {
    logger.warn({ message: 'Section analysis failed', title: section.title, error: (err as Error).message })
    return { title: section.title, summary: '(не удалось проанализировать раздел)', strengths: [], gaps: [] }
  }
}

// ─── Reduce: synthesise the overall review ─────────────────────────────────────

async function synthesizeReview(
  sections: Section[],
  analyses: SectionAnalysis[],
  rubricName: string | undefined,
  criteria: RubricCriterion[] | undefined,
  ctx: CallContext
): Promise<LongReviewResult> {
  const intro = sections.find((s) => s.kind === 'intro')
  const concl = sections.find((s) => s.kind === 'conclusion')

  const rubricBlock = rubricName && criteria?.length
    ? `## Рубрика: ${rubricName}\n${criteria.map((c) => `- ${c.name} (вес ${c.weight}): ${c.description}`).join('\n')}\n\n`
    : ''

  const verbatim =
    (intro ? `## Введение (полностью)\n<intro>\n${sanitiseForPrompt(capMiddle(intro.text, VERBATIM_CHARS))}\n</intro>\n\n` : '') +
    (concl ? `## Заключение (полностью)\n<conclusion>\n${sanitiseForPrompt(capMiddle(concl.text, VERBATIM_CHARS))}\n</conclusion>\n\n` : '')

  const analysisBlock = analyses
    .map((a, i) => `### Раздел ${i + 1}: ${a.title}
${a.summary}
Сильные стороны: ${a.strengths.join('; ') || '—'}
Недостатки/вопросы: ${a.gaps.join('; ') || '—'}`)
    .join('\n\n')

  const system =
    `Вы — научный руководитель и член аттестационной комиссии. На основе поразделного анализа ` +
    `составьте развёрнутую рецензию на выпускную квалификационную работу. Будьте конкретны и ` +
    `академичны. Оценка является РЕКОМЕНДАТЕЛЬНОЙ — окончательное решение принимает преподаватель. ` +
    `Отвечайте только валидным JSON на русском языке.`

  const user =
    `${rubricBlock}${verbatim}## Поразделный анализ работы
${analysisBlock}

Составьте итоговую рецензию. Верните JSON со следующими полями:
- "overall_summary": общее заключение по работе (2–3 абзаца)
- "suggested_score": рекомендуемый балл 0–100
- "suggested_grade": одна из "5","4","3","2" (5: 87–100, 4: 73–86, 3: 60–72, 2: ниже 60)
- "grade_label": "Отлично"|"Хорошо"|"Удовлетворительно"|"Неудовлетворительно"
- "chapter_reviews": массив {"title": string, "assessment": "1–2 абзаца", "strengths": [..], "gaps": [..]} по каждому разделу
- "overall_strengths": 3–6 ключевых достоинств работы
- "overall_gaps": 3–6 ключевых недостатков
- "defense_questions": 4–6 вопросов, которые комиссия может задать на защите

Ответьте ТОЛЬКО JSON-объектом.`

  const r = await chatJSON<Partial<LongReviewResult>>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'итоговая рецензия',
    ctx,
  )

  return {
    overall_summary:   r.overall_summary ?? '',
    suggested_score:   typeof r.suggested_score === 'number' ? clampScore(r.suggested_score) : null,
    suggested_grade:   r.suggested_grade ? normaliseGrade(r.suggested_grade) : null,
    grade_label:       r.grade_label ?? null,
    chapter_reviews:   normaliseChapters(r.chapter_reviews, analyses),
    overall_strengths: (r.overall_strengths ?? []).slice(0, 8),
    overall_gaps:      (r.overall_gaps ?? []).slice(0, 8),
    defense_questions: (r.defense_questions ?? []).slice(0, 8),
  }
}

function normaliseChapters(
  chapters: ChapterReview[] | undefined,
  analyses: SectionAnalysis[]
): ChapterReview[] {
  if (chapters && chapters.length) {
    return chapters.map((c) => ({
      title:     c.title ?? '',
      assessment: c.assessment ?? '',
      strengths: c.strengths ?? [],
      gaps:      c.gaps ?? [],
    }))
  }
  // Fallback to the raw section analyses if the reduce omitted chapter_reviews
  return analyses.map((a) => ({ title: a.title, assessment: a.summary, strengths: a.strengths, gaps: a.gaps }))
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Keep head + tail of an over-long block, dropping the middle with a marker.
function capMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const head = Math.floor(maxChars * 0.6)
  const tail = maxChars - head
  return `${text.slice(0, head)}\n\n[…пропущено ${text.length - maxChars} симв.…]\n\n${text.slice(-tail)}`
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function clampScore(n: unknown): number {
  const num = typeof n === 'number' ? n : parseInt(String(n), 10)
  return Math.max(0, Math.min(100, isNaN(num) ? 0 : num))
}

function normaliseGrade(g: unknown): GradeLetter {
  const valid: GradeLetter[] = ['5', '4', '3', '2']
  const s = String(g).trim() as GradeLetter
  return valid.includes(s) ? s : '3'
}

function gradeToLabel(g: GradeLetter): string {
  return { '5': 'Отлично', '4': 'Хорошо', '3': 'Удовлетворительно', '2': 'Неудовлетворительно' }[g] ?? '—'
}
