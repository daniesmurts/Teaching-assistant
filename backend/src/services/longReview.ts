import { chatJSON } from './deepseek'
import { resolveCriteriaSnapshot, normaliseBullets } from './grading'
import type { BulletItem } from '../../../shared/types'
import { createAssignment } from '../db/queries/assignments'
import {
  setLongReviewStatus,
  setLongReviewProgress,
  setLongReviewSnapshot,
  completeLongReview,
} from '../db/queries/longReviews'
import { incrementUsage } from '../db/queries/usageCounters'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { logger } from '../lib/logger'
import type { CallContext } from './deepseek'
import type { LongReviewResult, ChapterReview, DefenseQuestion, GradeLetter, CriteriaSnapshotItem, KeyQuantity, Inconsistency, RecomputationFinding, PremiseFinding, PremiseFindingKind, BulletSeverity } from '../../../shared/types'

// ─── Tuning ────────────────────────────────────────────────────────────────────

const SECTION_TARGET_CHARS = 17_500   // ~5k tokens per map unit
const SECTION_MAX_CHARS    = 31_500   // ~9k tokens — split anything larger
const MAX_SECTIONS         = 24       // cost ceiling on the map phase
const MAP_CONCURRENCY      = 3        // parallel section analyses
const VERBATIM_CHARS       = 6_000    // intro/conclusion kept in full for the reduce

// ─── Public entry — runs the whole pipeline for one review job ─────────────────

export interface RunParams {
  reviewId:       string
  teacherId:      string
  institutionId?: string | null
  courseId?:      string | null
  criterionIds?:  string[]
  weights?:       number[]
  studentName?:   string | null
  studentEmail?:  string | null
  studentGroup?:  string | null
  submissionText: string
  // Feature N — чертежи submitted alongside the ПЗ (OCR'd client-side upload,
  // already-extracted text by the time the job runs). Optional/empty on every
  // review that isn't a ВКР with drawings attached.
  drawings?:      DrawingInput[]
}

/**
 * Runs the whole map-reduce pipeline for one review job. Called by the
 * pg-boss worker (services/longReviewWorker.ts) — throws on failure rather
 * than swallowing errors, so pg-boss's retry/dead-letter policy actually
 * sees the failure. The worker wrapper is responsible for writing
 * `long_reviews.status = 'failed'` (only once retries are exhausted, so the
 * UI doesn't flash "failed" while a retry is still about to run).
 */
export async function runLongReview(p: RunParams): Promise<void> {
  const ctx: CallContext = { teacherId: p.teacherId, feature: 'grading' }
  const snapshot = await resolveCriteriaSnapshot(
    p.teacherId,
    p.institutionId ?? null,
    p.criterionIds ?? [],
    p.weights ?? [],
  )
  if (snapshot.length > 0) {
    await setLongReviewSnapshot(p.reviewId, snapshot).catch(() => null)
  }

  const sections = splitIntoSections(p.submissionText)
  await setLongReviewStatus(p.reviewId, 'analyzing')
  await setLongReviewProgress(p.reviewId, 0, sections.length)

  // ── Map: analyse each section, with bounded concurrency + progress ──────────
  let done = 0
  const analyses = await mapWithConcurrency(sections, MAP_CONCURRENCY, async (sec, idx) => {
    const a = await analyzeSection(sec, snapshot, ctx)
    // Tier-2: stamp each key quantity with the index of THIS section so the
    // cross-section pass — and the frontend — can show where it came from.
    a.key_quantities = a.key_quantities.map((q) => ({ ...q, chapter_index: idx }))
    done += 1
    await setLongReviewProgress(p.reviewId, done, sections.length).catch(() => null)
    return a
  })

  // ── Reduce: synthesise the overall review ───────────────────────────────────
  await setLongReviewStatus(p.reviewId, 'synthesizing')
  const result = await synthesizeReview(sections, analyses, snapshot, p.submissionText, ctx)

  // Defence questions go through their own dedicated call — the synthesis
  // JSON for a long ВКР (24 chapters × prose + arrays) regularly drained the
  // model's output budget before this field. Failing the call here is
  // recoverable: the rest of the review still goes through.
  try {
    result.defense_questions = await generateDefenseQuestions(sections, analyses, result, ctx)
  } catch (err) {
    logger.warn({ message: 'Defence questions failed', reviewId: p.reviewId, error: (err as Error).message })
    result.defense_questions = []
  }

  // Feature N — чертежи (drawings) submitted alongside the ПЗ. Each is
  // analysed as a lightweight pseudo-section (title-block facts + dimension/
  // label key_quantities, no chapter-style strengths/gaps critique — a
  // drawing isn't prose to review, it's a source of facts to cross-check).
  // Appended AFTER the written work's sections so drawing indices never
  // collide with real chapter indices; chapter_reviews/defense_questions/
  // recomputation stay scoped to the base sections/analyses (a drawing isn't
  // a "chapter" and has no formula to independently recompute) — only the
  // two contradiction-detecting passes below see the combined arrays.
  const drawingInputs   = p.drawings ?? []
  const drawingSections = drawingInputs.map(buildDrawingSection)
  const drawingAnalyses = await mapWithConcurrency(drawingInputs, MAP_CONCURRENCY, async (d, i) => {
    const a = await analyzeDrawing(d, ctx)
    a.key_quantities = a.key_quantities.map((q) => ({ ...q, chapter_index: sections.length + i }))
    return a
  })
  result.drawings = drawingSections.map((d) => ({ title: d.title }))
  const sectionsForChecks = [...sections, ...drawingSections]
  const analysesForChecks = [...analyses, ...drawingAnalyses]

  // Tier-2 cross-section consistency. Cluster extracted quantities by name;
  // if any cluster has conflicting numeric values, ask the model to confirm
  // it's a real contradiction (vs. two different concepts that happen to
  // share a name). Failing the call leaves inconsistencies=[] — review still
  // ships. Drawings included: this is exactly what catches "15 м in the
  // text vs. 54 000 мм on the чертёж" — same value, same name, two sources.
  try {
    result.inconsistencies = await findInconsistencies(analysesForChecks, result.chapter_reviews, ctx)
  } catch (err) {
    logger.warn({ message: 'Consistency pass failed', reviewId: p.reviewId, error: (err as Error).message })
    result.inconsistencies = []
  }

  // Tier-4 independent recomputation of headline numerical results. Runs on
  // the reasoner (slow + costly — only fire if there's actually math). Same
  // soft-fail contract as defence/consistency. Drawings excluded on purpose —
  // dimension callouts aren't a derivable formula to re-check.
  try {
    result.recomputation_findings = await findRecomputations(sections, analyses, result.chapter_reviews, ctx)
  } catch (err) {
    logger.warn({ message: 'Recomputation pass failed', reviewId: p.reviewId, error: (err as Error).message })
    result.recomputation_findings = []
  }

  // Tier-5 cross-section premise pass. Document-level reasoning over every
  // section's summary + quantities at once — catches contradictions spanning
  // sections (composition vs. reaction equation) and physically/logically
  // implausible assumptions (phase equilibrium, stoichiometry). Reasoner +
  // soft-fail, same contract as the passes above. Drawings included — the
  // whole point of Feature N: a mislabeled part or dimension callout that
  // contradicts the ПЗ's description of the same object.
  try {
    result.premise_findings = await findPremiseIssues(sectionsForChecks, analysesForChecks, result.chapter_reviews, p.submissionText, ctx)
  } catch (err) {
    logger.warn({ message: 'Premise pass failed', reviewId: p.reviewId, error: (err as Error).message })
    result.premise_findings = []
  }

  // ── Draft assignment so it flows into history / approval / email / RAG ──────
  const assignment = await createAssignment({
    teacherId:     p.teacherId,
    courseId:      p.courseId ?? undefined,
    studentName:   p.studentName ?? undefined,
    studentEmail:  p.studentEmail ?? undefined,
    studentGroup:  p.studentGroup ?? undefined,
    submissionText: p.submissionText,
    aiScore:       clampScore(result.suggested_score),
    aiGrade:       normaliseGrade(result.suggested_grade),
    aiGradeLabel:  result.grade_label ?? gradeToLabel(normaliseGrade(result.suggested_grade)),
    aiFeedback:    result.overall_summary,
    aiCriteriaScores: [],
    // Tier-1: overall_strengths/gaps are now BulletItem[] (with verbatim
    // quotes validated against the submission). Older review rows may still
    // hold plain strings — wrap any straggler defensively.
    aiStrengths:    (result.overall_strengths ?? []).map(toBulletItem),
    aiImprovements: (result.overall_gaps      ?? []).map(toBulletItem),
    criteriaSnapshot: snapshot.length > 0 ? snapshot : null,
  })

  await completeLongReview(p.reviewId, result, assignment.id)
  incrementUsage(p.teacherId, 'grade').catch(() => null)
  logger.info({ message: 'Long review completed', reviewId: p.reviewId, sections: sections.length })
}

// ─── Section splitting ─────────────────────────────────────────────────────────

export interface Section {
  title: string
  text:  string
  kind:  'intro' | 'conclusion' | 'references' | 'body' | 'drawing'
}

/** OCR'd чертёж, as pure per-drawing input — title-block/extractor text, no analysis yet. */
export interface DrawingInput {
  fileName:      string
  extractedText: string
}

/** Wrap an OCR'd drawing as a pseudo-section — pure, so it's unit-testable
 * without the LLM call that turns it into a SectionAnalysis. */
export function buildDrawingSection(drawing: DrawingInput): Section {
  return { title: `Чертёж: ${drawing.fileName}`, text: drawing.extractedText, kind: 'drawing' }
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
  // Each bullet carries a verbatim quote from this section so the synthesis
  // pass — and the teacher — can trace the claim back to its evidence.
  strengths: BulletItem[]
  gaps:      BulletItem[]
  // Tier-2: quantitative claims pulled from this section, used by the
  // post-synthesis consistency pass to detect cross-section contradictions.
  // chapter_index is stamped by the orchestrator (analyzeSection doesn't
  // know its own index).
  key_quantities: KeyQuantity[]
}

async function analyzeSection(
  section: Section,
  criteria: CriteriaSnapshotItem[],
  ctx: CallContext
): Promise<SectionAnalysis> {
  const criteriaHint = criteria.length
    ? `Критерии оценки работы: ${criteria.map((c) => c.name).join(', ')}.\n`
    : ''
  // Cap the text sent per section (huge reference lists / appendices)
  const body = capMiddle(section.text, SECTION_MAX_CHARS)

  // Tier-1 system prompt — recall-bias framing + neutral tone. The model
  // tends to hedge into generic prose without the explicit permission to flag
  // uncertainties as questions; this rewards over-flagging where it matters.
  const system =
    `Вы — научный рецензент выпускных квалификационных работ. Это ПРЕДВАРИТЕЛЬНЫЙ разбор для ` +
    `преподавателя, а не окончательная оценка. Лучше задать уточняющий вопрос, чем промолчать о ` +
    `подозрительном моменте. Не выносите финальный вердикт по работе — это делает преподаватель. ` +
    `Описывайте дефект и его последствие, а не личность студента. Если по предоставленному фрагменту ` +
    `раздел оценить нельзя — так и напишите. Отвечайте только валидным JSON на русском языке.`

  // Two-pass instruction: extract evidence first, then judge. Constrains the
  // model to commit to verbatim quotes before opinionating, which kills the
  // confident-but-ungrounded prose we were getting.
  const user =
    `${criteriaHint}Раздел: «${section.title}»
<section>
${sanitiseForPrompt(body)}
</section>

Работайте в два прохода:
ШАГ 1 (извлечение): соберите все ключевые количественные утверждения раздела — ` +
    `численные величины (плотности, давления, температуры, объёмы выборки, сроки, ` +
    `проценты), коэффициенты в формулах, марки материалов, объёмы выборки, размеры ` +
    `групп, ссылки на конкретные нормы. К каждому — точная цитата из раздела.
ШАГ 2 (суждение): рассуждайте ТОЛЬКО на основе извлечённого материала. Никаких ` +
    `догадок, никаких терминов и коэффициентов, которых нет в тексте. ` +
    `ДОПОЛНИТЕЛЬНО: если в разделе применяется эмпирическая корреляция или стандартная ` +
    `формула (например, Дитуса-Болтера для теплообмена при Re > 10⁴; формула Стокса при ` +
    `Ar < ~36; критерий Рейнольдса; формулы из ГОСТ/СП/ОСТ; статистические тесты при ` +
    `соответствующих условиях применимости) — проверьте, попадают ли входные параметры в ` +
    `область её применимости. Если данных для проверки в разделе недостаточно — оформите ` +
    `как gap с action="verify". Если параметры явно за пределами области — gap с ` +
    `severity="critical" или "substantial" и action="flag".

Верните JSON со следующими полями (все обязательны):
- "summary": 2–4 предложения о содержании раздела
- "key_quantities": массив объектов вида ` +
    `{"name": "название величины (стандартизованное, без вашего раздела)", "value": "значение с единицами как в тексте (например, «850 кг/м³», «n=42», «32 ч»)", "quote": "точная цитата из раздела, содержащая значение"}. ` +
    `Используйте короткое стандартное название («плотность нефти», а не «плотность нефти в первом столбце»), ` +
    `чтобы другое употребление этой же величины в другом разделе получило такое же имя. ` +
    `Если в разделе нет количественных утверждений — верните пустой массив.
- "strengths": до 3 объектов вида ` +
    `{"text": "что именно сделано хорошо (1–2 предложения)", "quote": "точная цитата из раздела"}. ` +
    `Помечайте сильной стороной ТОЛЬКО то, что вы проверили по цитате. Если проверить нельзя — не добавляйте.
- "gaps": до 3 объектов вида ` +
    `{"text": "недостаток или вопрос для проверки (1–2 предложения)", "quote": "точная цитата из раздела, к которой относится замечание", "severity": "critical"|"substantial"|"minor", "action": "flag"|"verify", "correction": "одно предложение — что именно сделать, чтобы исправить (например, «пересчитать с учётом плотности 850, а не 920»)"}. ` +
    `Если не можете точно процитировать то, что критикуете, переформулируйте пункт как ВОПРОС (что уточнить у автора) и поставьте action="verify"; в противном случае action="flag". ` +
    `severity: "critical" — ошибка, которая ставит под сомнение результат работы; "substantial" — заметный недостаток, требующий исправления; "minor" — мелочь, на которую стоит обратить внимание.

Ответьте ТОЛЬКО JSON-объектом.`

  try {
    const r = await chatJSON<{
      summary:         string
      strengths?:      unknown[]
      gaps?:           unknown[]
      key_quantities?: unknown[]
    }>(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      'анализ раздела',
      { context: ctx },
    )
    // Validate quotes against THIS section's text — quotes that don't appear
    // verbatim get dropped (page is irrelevant at section grain; pass a
    // permissive pageCount so the citation validator doesn't strip it).
    type RawBullets = Parameters<typeof normaliseBullets>[0]
    const strengths = normaliseBullets((r.strengths ?? []) as RawBullets, body, 9999).slice(0, 3)
    const gaps      = normaliseBullets((r.gaps      ?? []) as RawBullets, body, 9999).slice(0, 3)
    const key_quantities = normaliseKeyQuantities(r.key_quantities, body).slice(0, 8)
    return {
      title:     section.title,
      summary:   r.summary ?? '',
      strengths,
      gaps,
      key_quantities,
    }
  } catch (err) {
    logger.warn({ message: 'Section analysis failed', title: section.title, error: (err as Error).message })
    return { title: section.title, summary: '(не удалось проанализировать раздел)', strengths: [], gaps: [], key_quantities: [] }
  }
}

/**
 * Validate the model's key_quantities output. Same contract as bullet quotes:
 * a quantity is kept only if its quote appears verbatim in the section text
 * (case- and whitespace-insensitive). chapter_index is stamped to 0 here and
 * rewritten by the orchestrator once it knows the section's actual position.
 */
function normaliseKeyQuantities(raw: unknown, sectionText: string): KeyQuantity[] {
  if (!Array.isArray(raw)) return []
  const haystack = sectionText.toLowerCase().replace(/\s+/g, ' ').trim()
  const out: KeyQuantity[] = []
  for (const q of raw) {
    if (!q || typeof q !== 'object') continue
    const obj = q as Record<string, unknown>
    const name  = typeof obj.name  === 'string' ? obj.name.trim()  : ''
    const value = typeof obj.value === 'string' ? obj.value.trim() : ''
    const rawQuote = typeof obj.quote === 'string' ? obj.quote.trim() : ''
    if (!name || !value || !rawQuote) continue
    if (name.length > 120 || value.length > 80) continue
    const norm = rawQuote.toLowerCase().replace(/\s+/g, ' ').trim()
    if (norm.length < 8 || !haystack.includes(norm)) continue
    out.push({
      name,
      value,
      quote:         rawQuote.slice(0, 220),
      chapter_index: 0,    // stamped by the orchestrator
    })
  }
  return out
}

// ─── Drawings (Feature N) ───────────────────────────────────────────────────────
//
// Deliberately NOT a reuse of analyzeSection: that prompt asks for a
// prose-critique (strengths/gaps of a "chapter") which doesn't make sense
// applied to raw OCR of a title block and dimension callouts. This is purely
// extractive — pull out the facts (what's depicted, key dimensions/labels
// with their exact quote) and nothing else. strengths/gaps come back empty;
// only summary + key_quantities feed the contradiction-detecting passes.

const DRAWING_TEXT_CAP = 12_000   // OCR of a title block + callouts is short; generous cap

async function analyzeDrawing(drawing: DrawingInput, ctx: CallContext): Promise<SectionAnalysis> {
  const body = capMiddle(drawing.extractedText, DRAWING_TEXT_CAP)

  const system =
    `Вы читаете распознанный (OCR) текст инженерного чертежа — размеры, обозначения штуцеров/позиций, ` +
    `титульный блок, спецификацию. Текст может быть фрагментированным и не в порядке чтения — это нормально ` +
    `для OCR чертежа. Извлекайте ТОЛЬКО факты, ничего не оценивайте. Отвечайте только валидным JSON на русском.`

  const user =
    `Распознанный текст чертежа «${drawing.fileName}»:
<drawing_ocr>
${sanitiseForPrompt(body)}
</drawing_ocr>

Верните JSON:
- "summary": 1–2 предложения — что изображено на чертеже (тип аппарата/узла, что видно из титульного блока).
- "key_quantities": массив объектов вида ` +
    `{"name": "название величины, стандартизованное так же, как её могли бы назвать в тексте работы (например, «габаритная высота», а не «H, мм»)", "value": "значение с единицами как в тексте", "quote": "точная цитата из распознанного текста, содержащая значение"}. ` +
    `Включайте размеры, диаметры, обозначения штуцеров/позиций с их значениями, марки материалов — всё, что может быть сверено с текстом работы. ` +
    `Если ничего значимого не распознано — верните пустой массив.

Ответьте ТОЛЬКО JSON-объектом.`

  try {
    const r = await chatJSON<{ summary?: string; key_quantities?: unknown[] }>(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      'анализ чертежа',
      { context: ctx },
    )
    return {
      title:          `Чертёж: ${drawing.fileName}`,
      summary:        r.summary ?? '',
      strengths:      [],
      gaps:           [],
      key_quantities: normaliseKeyQuantities(r.key_quantities, body).slice(0, 12),
    }
  } catch (err) {
    logger.warn({ message: 'Drawing analysis failed', fileName: drawing.fileName, error: (err as Error).message })
    return { title: `Чертёж: ${drawing.fileName}`, summary: '(не удалось распознать чертёж)', strengths: [], gaps: [], key_quantities: [] }
  }
}

// ─── Reduce: synthesise the overall review ─────────────────────────────────────

async function synthesizeReview(
  sections: Section[],
  analyses: SectionAnalysis[],
  criteria: CriteriaSnapshotItem[],
  submissionText: string,
  ctx: CallContext
): Promise<LongReviewResult> {
  const intro = sections.find((s) => s.kind === 'intro')
  const concl = sections.find((s) => s.kind === 'conclusion')

  const criteriaBlock = criteria.length
    ? `## Критерии оценки\n${criteria.map((c) => `- ${c.name} (вес ${c.weight}%)${c.description ? `: ${c.description}` : ''}`).join('\n')}\n\n`
    : ''

  const verbatim =
    (intro ? `## Введение (полностью)\n<intro>\n${sanitiseForPrompt(capMiddle(intro.text, VERBATIM_CHARS))}\n</intro>\n\n` : '') +
    (concl ? `## Заключение (полностью)\n<conclusion>\n${sanitiseForPrompt(capMiddle(concl.text, VERBATIM_CHARS))}\n</conclusion>\n\n` : '')

  // Tier-1: preserve evidence per bullet so the synthesis can carry quotes
  // through to the overall view instead of joining bullets into prose.
  const renderBullets = (bs: BulletItem[]) =>
    bs.length === 0 ? '—' :
    bs.map((b) => `· ${b.text}${b.quote ? ` — «${b.quote}»` : ''}`).join('\n  ')

  const analysisBlock = analyses
    .map((a, i) => `### Раздел ${i + 1}: ${a.title}
${a.summary}
Сильные стороны:
  ${renderBullets(a.strengths)}
Недостатки/вопросы:
  ${renderBullets(a.gaps)}`)
    .join('\n\n')

  // Tier-1 system prompt — recall-bias + role separation. The "это не
  // окончательная оценка" reminder is intentional: it makes the model braver
  // about flagging things, not blander, because it knows the teacher reviews.
  const system =
    `Вы — научный руководитель и член аттестационной комиссии. Это ПРЕДВАРИТЕЛЬНЫЙ разбор работы ` +
    `для преподавателя — окончательное решение по оценке принимает он. Лучше поднять сомнение, чем ` +
    `промолчать. Не утверждайте то, что не можете подкрепить цитатой. Если по предоставленному ` +
    `материалу критерий проверить нельзя — отметьте это в "coverage_note", а не выдумывайте оценку. ` +
    `Тон — академический и нейтральный: описывайте дефект и его последствие, не личность студента. ` +
    `Отвечайте только валидным JSON на русском языке.`

  const user =
    `${criteriaBlock}${verbatim}## Поразделный анализ работы (с цитатами)
${analysisBlock}

Составьте итоговую рецензию. Используйте ТОЛЬКО материал из поразделного анализа выше — не ` +
    `придумывайте новых фактов и цитат. Цитаты, которые вы переносите в итоговые пункты, должны ` +
    `точно совпадать с цитатами из анализа разделов.

Верните JSON со следующими полями (все обязательны):
- "overall_summary": общее заключение по работе (2–3 абзаца)
- "suggested_score": рекомендуемый балл 0–100
- "suggested_grade": одна из "5","4","3","2" (5: 87–100, 4: 73–86, 3: 60–72, 2: ниже 60)
- "grade_label": "Отлично"|"Хорошо"|"Удовлетворительно"|"Неудовлетворительно"
- "chapter_reviews": массив по разделам ` +
    `{"title": string, "assessment": "1–2 абзаца", "strengths": [{"text": "...", "quote": "точная цитата"}], "gaps": [{"text": "...", "quote": "точная цитата", "severity": "critical"|"substantial"|"minor", "action": "flag"|"verify", "correction": "что сделать (1 предложение)"}]}
- "overall_strengths": 3–6 главных достоинств работы в виде ` +
    `[{"text": "...", "quote": "цитата из работы, подтверждающая пункт"}]. Сильной стороной может быть только то, что вы проверили по цитате.
- "overall_gaps": 3–6 главных недостатков в виде ` +
    `[{"text": "...", "quote": "цитата из работы, к которой относится замечание", "severity": "critical"|"substantial"|"minor", "action": "flag"|"verify", "correction": "что сделать (1 предложение)"}]. ` +
    `Сортируйте от самого критичного к самому мелкому. Если цитировать нечего, переформулируйте как вопрос для уточнения у автора и поставьте action="verify".
- "coverage_note": 1–3 предложения о том, какие критерии вы фактически проверили и где материала не хватило ` +
    `для уверенного суждения (например, "методология описана подробно, но проверить расчёты в главе 3 по предоставленному тексту нельзя").

Ответьте ТОЛЬКО JSON-объектом.`

  const r = await chatJSON<{
    overall_summary?:   string
    suggested_score?:   number
    suggested_grade?:   unknown
    grade_label?:       string
    chapter_reviews?:   Array<{
      title?:      string
      assessment?: string
      strengths?:  unknown[]
      gaps?:       unknown[]
    }>
    overall_strengths?: unknown[]
    overall_gaps?:      unknown[]
    coverage_note?:     string
  }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'итоговая рецензия',
    {
      context:   ctx,
      maxTokens: 8192,   // lifted from the 4096 default; the synthesis JSON
                         // (chapter_reviews × up to MAX_SECTIONS + arrays)
                         // routinely exceeded the default cap and truncated mid-array.
    },
  )

  // Validate quotes against the FULL submission — section-grain validation
  // already ran at analyzeSection time, but the model may rewrite quotes when
  // summarising, so we re-check.
  type RawBullets = Parameters<typeof normaliseBullets>[0]
  const overallStrengths = normaliseBullets((r.overall_strengths ?? []) as RawBullets, submissionText, 9999).slice(0, 8)
  const overallGaps      = normaliseBullets((r.overall_gaps      ?? []) as RawBullets, submissionText, 9999).slice(0, 8)

  return {
    overall_summary:   r.overall_summary ?? '',
    suggested_score:   typeof r.suggested_score === 'number' ? clampScore(r.suggested_score) : null,
    suggested_grade:   r.suggested_grade ? normaliseGrade(r.suggested_grade) : null,
    grade_label:       r.grade_label ?? null,
    chapter_reviews:   normaliseChapters(r.chapter_reviews, analyses, submissionText),
    overall_strengths: overallStrengths,
    overall_gaps:      overallGaps,
    defense_questions: [],        // populated by generateDefenseQuestions in the orchestrator
    coverage_note:     (r.coverage_note ?? '').trim() || null,
    inconsistencies:   [],        // populated by findInconsistencies in the orchestrator
    recomputation_findings: [],   // populated by findRecomputations in the orchestrator
    premise_findings:  [],        // populated by findPremiseIssues in the orchestrator
    drawings:          [],        // populated by the orchestrator after analysing any uploaded чертежи
  }
}

// ─── Defence questions — dedicated call ────────────────────────────────────────
//
// Generated outside synthesizeReview because: (a) the synthesis JSON
// consistently truncated this field on real-ВКР scale even with max_tokens
// lifted to 8192; (b) we want each question grounded in a specific chapter,
// which is a tighter ask than "list 4–6 questions".

interface RawDefenseQuestion {
  question?:      string
  chapter_index?: number | null
  quote?:         string | null
  page?:          number | null
}

async function generateDefenseQuestions(
  sections: Section[],
  analyses: SectionAnalysis[],
  result:   LongReviewResult,
  ctx:      CallContext,
): Promise<DefenseQuestion[]> {
  // Reuse the chapter list the teacher will see so chapter_index aligns.
  const chapters = result.chapter_reviews.length > 0
    ? result.chapter_reviews
    : analyses.map((a) => ({ title: a.title, assessment: a.summary, strengths: a.strengths, gaps: a.gaps }))

  const chapterBlock = chapters
    .map((c, i) => {
      // c.gaps is now BulletItem[] (Tier-1) but legacy review rows held strings.
      // Render either shape as plain text — the defence-questions model only
      // needs the gist of what was flagged in each chapter.
      const gapText = c.gaps.map((g) => typeof g === 'string' ? g : g.text).filter(Boolean).join('; ') || '—'
      return `### Раздел ${i}: ${c.title}\n${c.assessment}\nЗамечания: ${gapText}`
    })
    .join('\n\n')

  const system =
    `Вы — научный руководитель, готовящий вопросы к защите ВКР. На основе разбора работы ` +
    `сформулируйте 5–7 конкретных вопросов, которые комиссия может задать. Каждый вопрос ` +
    `должен опираться на конкретный раздел и проверять понимание студентом собственной работы — ` +
    `обоснование выбора метода, источник данных, интерпретация результата. Избегайте общих ` +
    `формулировок («как вы видите будущее этой темы»). Отвечайте только валидным JSON.`

  const user =
    `## Краткое заключение по работе
${sanitiseForPrompt(result.overall_summary).slice(0, 1500)}

## Разделы (с номерами для chapter_index)
${chapterBlock}

Верните JSON: {"questions": [{"question": "...", "chapter_index": число 0–${chapters.length - 1} или null если вопрос общий, "quote": ДОСЛОВНАЯ цитата из соответствующего раздела (5–12 слов) которая мотивирует вопрос, либо null}]}`

  const r = await chatJSON<{ questions?: RawDefenseQuestion[] }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'вопросы к защите',
    {
      context:   ctx,
      maxTokens: 1024,   // ~7 questions of 1–2 sentences each is well under
    },
  )

  const haystackBySection = sections.map((s) => s.text.toLowerCase().replace(/\s+/g, ' ').trim())
  const fullHaystack = sections.map((s) => s.text).join('\n\n').toLowerCase().replace(/\s+/g, ' ').trim()

  return (r.questions ?? [])
    .map((q): DefenseQuestion | null => {
      const question = typeof q.question === 'string' ? q.question.trim() : ''
      if (!question) return null

      let chapter_index: number | null = null
      if (typeof q.chapter_index === 'number'
          && Number.isInteger(q.chapter_index)
          && q.chapter_index >= 0
          && q.chapter_index < chapters.length) {
        chapter_index = q.chapter_index
      }

      let quote: string | null = null
      if (typeof q.quote === 'string' && q.quote.trim().length >= 8) {
        const normalised = q.quote.toLowerCase().replace(/\s+/g, ' ').trim()
        // Prefer a match inside the cited chapter; fall back to whole document.
        const localHay = chapter_index != null ? haystackBySection[chapter_index] : null
        if (localHay && localHay.includes(normalised)) {
          quote = q.quote.trim().slice(0, 200)
        } else if (fullHaystack.includes(normalised)) {
          quote = q.quote.trim().slice(0, 200)
        }
      }
      return { question, chapter_index, quote, page: null }
    })
    .filter((q): q is DefenseQuestion => q !== null)
    .slice(0, 8)
}

// ─── Tier 2: cross-section consistency ─────────────────────────────────────────
//
// Two-stage to keep cost and false-positive rate low:
//   1. Deterministic clustering — group key_quantities by lowercased name;
//      keep clusters where >=2 occurrences have different numeric values.
//      Cheap, predictable, and catches the "плотность 850 vs 920" case.
//   2. LLM confirmation pass — over the *candidates only*, ask the model
//      whether each cluster is a real contradiction or just two unrelated
//      concepts that share a name ("температура реакции" vs "температура
//      окружающей среды"). Returns a 1-line summary per real contradiction.
//
// Failing the LLM call leaves inconsistencies=[] — the rest of the review
// still ships. Stage 1 alone is not used as a fallback because the false-
// positive rate is too high without semantic check (e.g. "выборка" appears
// with different sizes in different sub-studies).

interface QuantityCluster {
  name:         string                 // canonical (lowercased) name used to group
  display_name: string                 // model's most common spelling, for the UI
  occurrences:  KeyQuantity[]
}

export function clusterByName(quantities: KeyQuantity[]): QuantityCluster[] {
  const groups = new Map<string, KeyQuantity[]>()
  for (const q of quantities) {
    const key = q.name.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!key) continue
    const arr = groups.get(key) ?? []
    arr.push(q)
    groups.set(key, arr)
  }

  const candidates: QuantityCluster[] = []
  for (const [key, arr] of groups) {
    if (arr.length < 2) continue
    // Need at least two different numeric values to be a candidate
    // contradiction. Pure text-only mismatches ("сталь 09Г2С" vs "сталь
    // 09Г2С-У") are rejected here — they're rarely real contradictions and
    // raising them inflates noise.
    const numerics = new Set(
      arr
        .map((q) => extractFirstNumber(q.value))
        .filter((n): n is string => n !== null)
    )
    if (numerics.size < 2) continue
    candidates.push({
      name:         key,
      display_name: arr[0].name,
      occurrences:  arr,
    })
  }
  return candidates
}

function extractFirstNumber(s: string): string | null {
  // Pulls the first number, normalising the decimal separator. Used only
  // for deterministic clustering — the model sees the original value text.
  const m = s.match(/-?\d+(?:[.,]\d+)?/)
  return m ? m[0].replace(',', '.') : null
}

async function findInconsistencies(
  analyses:       SectionAnalysis[],
  chapterReviews: ChapterReview[],
  ctx:            CallContext,
): Promise<Inconsistency[]> {
  const allQuantities = analyses.flatMap((a) => a.key_quantities)
  const clusters = clusterByName(allQuantities)
  if (clusters.length === 0) return []

  // Build a compact, numbered list the model can refer back to by index.
  const titleOf = (idx: number) =>
    chapterReviews[idx]?.title ?? analyses[idx]?.title ?? `Раздел ${idx + 1}`

  const clusterBlock = clusters
    .map((c, i) => {
      const lines = c.occurrences
        .map((o) => `    – «${titleOf(o.chapter_index)}»: ${o.value}  — «${o.quote}»`)
        .join('\n')
      return `${i + 1}. ${c.display_name}\n${lines}`
    })
    .join('\n\n')

  const system =
    `Вы — рецензент, проверяющий внутреннюю согласованность работы. На вход дан список ` +
    `количественных величин, извлечённых из разных разделов. Часть из них может оказаться ` +
    `РАЗНЫМИ понятиями с похожим названием — это НЕ противоречие. Реальное противоречие — ` +
    `когда одна и та же величина в одной и той же работе имеет несовместимые значения. ` +
    `Отвечайте только валидным JSON на русском языке.`

  const user =
    `## Кандидаты на противоречие (каждый — группа упоминаний с расходящимися значениями)
${clusterBlock}

По каждой группе определите: это РЕАЛЬНОЕ противоречие в работе или просто разные ` +
    `понятия со схожими именами? Верните JSON:
{
  "items": [
    {
      "cluster_index": число (номер группы выше, начиная с 1),
      "is_contradiction": true|false,
      "summary": "если is_contradiction=true: 1 предложение, в чём именно несовместимость. Иначе — пустая строка."
    }
  ]
}
Включите ответ по КАЖДОЙ группе из списка. Не добавляйте групп, которых не было в списке.`

  const r = await chatJSON<{
    items?: Array<{
      cluster_index?:    number
      is_contradiction?: boolean
      summary?:          string
    }>
  }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'проверка согласованности',
    { context: ctx, maxTokens: 1024 },
  )

  const out: Inconsistency[] = []
  for (const item of r.items ?? []) {
    if (item.is_contradiction !== true) continue
    const idx = typeof item.cluster_index === 'number' ? item.cluster_index - 1 : -1
    const cluster = clusters[idx]
    if (!cluster) continue
    const summary = typeof item.summary === 'string' ? item.summary.trim() : ''
    if (!summary) continue
    out.push({
      name:        cluster.display_name,
      occurrences: cluster.occurrences,
      summary:     summary.slice(0, 280),
    })
  }
  return out.slice(0, 6)   // cap UI noise — anything beyond ~5 is fatigue
}

// ─── Tier 4: independent recomputation via the reasoner ────────────────────────
//
// Why this exists: DeepSeek V3 is unreliable at arithmetic. The reasoning
// model (DeepSeek-Reasoner) is much better. For ВКР — where bad arithmetic
// matters and is a recurring failure mode — we accept the cost (slow,
// expensive) of one extra reasoner call per review to independently re-derive
// the headline numerical results and surface any divergence from what the
// author claimed.
//
// Gating: only fires if ANY section emitted a key_quantity with a number. A
// purely qualitative work (humanities ВКР) skips the call entirely.
//
// Soft-fail: failures are logged and leave recomputation_findings=[] — the
// rest of the review still ships. We never gate the whole pipeline on the
// reasoner being available.

const RECOMP_SECTION_CHAR_CAP   = 7_500   // per-section content cap
const RECOMP_TOTAL_CHAR_BUDGET  = 60_000  // total chars across all sections sent

async function findRecomputations(
  sections:       Section[],
  analyses:       SectionAnalysis[],
  chapterReviews: ChapterReview[],
  ctx:            CallContext,
): Promise<RecomputationFinding[]> {
  // Gate 1: any numeric key_quantity at all?
  const allQuantities = analyses.flatMap((a) => a.key_quantities)
  const numericQs = allQuantities.filter((q) => extractFirstNumber(q.value) !== null)
  if (numericQs.length === 0) return []

  // Build a per-section block — title + (capped) text + the quantities the
  // first pass already pulled out. Only sections that contributed at least
  // one numeric quantity are included; everything else is noise here.
  const numericByChapter = new Map<number, KeyQuantity[]>()
  for (const q of numericQs) {
    const arr = numericByChapter.get(q.chapter_index) ?? []
    arr.push(q)
    numericByChapter.set(q.chapter_index, arr)
  }

  let budget = RECOMP_TOTAL_CHAR_BUDGET
  const blocks: string[] = []
  for (const [chapterIdx, qs] of numericByChapter) {
    const section = sections[chapterIdx]
    if (!section) continue
    const title = chapterReviews[chapterIdx]?.title ?? section.title
    // Take head + tail of the section so a long section still has its
    // conclusion visible to the reasoner (where the headline results usually
    // sit).
    const sectionText = capMiddle(section.text, RECOMP_SECTION_CHAR_CAP)
    if (sectionText.length > budget) break    // out of budget — stop adding
    budget -= sectionText.length

    const qsBlock = qs.map((q) => `  · ${q.name} = ${q.value}   («${q.quote}»)`).join('\n')
    blocks.push(
      `### Раздел ${chapterIdx}: ${title}
Извлечённые количественные величины:
${qsBlock}
<section_text>
${sanitiseForPrompt(sectionText)}
</section_text>`)
  }

  if (blocks.length === 0) return []

  const system =
    `Вы — независимый рецензент-расчётчик. Ваша задача — проверить АРИФМЕТИКУ и ПРИМЕНИМОСТЬ ` +
    `формул в работе. Не доверяйте вычислениям автора: перепроверяйте каждое головное ` +
    `численное значение по тем входным данным и формулам, которые приведены в самом разделе. ` +
    `Если входов недостаточно для перепроверки — НЕ выдумывайте; пропустите этот пункт. ` +
    `Если формула цитируется по стандарту (ГОСТ, СП, ОСТ) — проверяйте именно ФОРМУ формулы ` +
    `(коэффициенты, члены), а не только перемножение. Сообщайте только РЕАЛЬНЫЕ расхождения ` +
    `(> 5% или принципиальная ошибка). Совпадения не упоминайте. Думайте пошагово, отвечайте ` +
    `только валидным JSON на русском языке.`

  const user =
    `## Разделы работы с численными результатами

${blocks.join('\n\n')}

Перепроверьте каждое головное численное значение из извлечённых величин. ` +
    `Верните JSON:
{
  "items": [
    {
      "chapter_index": число (0-based),
      "claim": "что именно проверяется (например, «Число Рейнольдса в трубе»)",
      "claimed_value": "значение из работы, как в тексте (например, «50 000»)",
      "recomputed_value": "ваше независимое значение (например, «170 000»)",
      "discrepancy": "1 предложение: характер расхождения (например, «расчёт автора не учитывает плотность нефти 850, а использует 920»)",
      "inputs": "входные данные, которые вы использовали (например, «ρ=850 кг/м³, v=2 м/с, d=0.1 м, μ=0.001 Па·с»), либо null если автор не указал",
      "formula": "формула, по которой вы пересчитали (например, «Re = ρvd/μ»), либо null если автор не привёл",
      "quote": "точная цитата из раздела, содержащая claimed_value",
      "severity": "critical" (результат сильно неверен и ломает выводы) | "substantial" (заметная ошибка, требует исправления) | "minor" (округление/единицы)
    }
  ]
}
Если расхождений нет — верните {"items": []}. Не дублируйте уже отмеченные противоречия между разделами.`

  const r = await chatJSON<{
    items?: Array<{
      chapter_index?:    number
      claim?:            string
      claimed_value?:    string
      recomputed_value?: string
      discrepancy?:      string
      inputs?:           string | null
      formula?:          string | null
      quote?:            string
      severity?:         unknown
    }>
  }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'независимый перерасчёт',
    {
      context:   ctx,
      reasoner:  true,    // routes to DeepSeek-Reasoner; no fallback
      maxTokens: 4096,
    },
  )

  return normaliseRecomputations(r.items, sections, numericByChapter)
}

function normaliseRecomputations(
  items:            unknown,
  sections:         Section[],
  numericByChapter: Map<number, KeyQuantity[]>,
): RecomputationFinding[] {
  if (!Array.isArray(items)) return []
  const out: RecomputationFinding[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const obj = it as Record<string, unknown>
    const chapter_index = typeof obj.chapter_index === 'number' ? obj.chapter_index : -1
    const section = sections[chapter_index]
    if (!section) continue
    const claim            = typeof obj.claim            === 'string' ? obj.claim.trim()            : ''
    const claimed_value    = typeof obj.claimed_value    === 'string' ? obj.claimed_value.trim()    : ''
    const recomputed_value = typeof obj.recomputed_value === 'string' ? obj.recomputed_value.trim() : ''
    const discrepancy      = typeof obj.discrepancy      === 'string' ? obj.discrepancy.trim()      : ''
    const rawQuote         = typeof obj.quote            === 'string' ? obj.quote.trim()            : ''
    if (!claim || !claimed_value || !recomputed_value || !discrepancy || !rawQuote) continue
    // Quote must appear verbatim somewhere in the section we sent — same
    // citation contract as bullets. Stops the reasoner inventing context.
    const haystack = section.text.toLowerCase().replace(/\s+/g, ' ').trim()
    const norm = rawQuote.toLowerCase().replace(/\s+/g, ' ').trim()
    if (norm.length < 8 || !haystack.includes(norm)) continue
    // Defensive: only accept claims for sections that *did* contribute numeric
    // quantities. If the reasoner invents a chapter_index that didn't have
    // numbers, drop it.
    if (!numericByChapter.has(chapter_index)) continue
    const inputs  = typeof obj.inputs  === 'string' && obj.inputs.trim()  ? obj.inputs.trim().slice(0, 280)  : null
    const formula = typeof obj.formula === 'string' && obj.formula.trim() ? obj.formula.trim().slice(0, 160) : null
    const severity: BulletSeverity =
      obj.severity === 'critical' || obj.severity === 'substantial' || obj.severity === 'minor'
        ? obj.severity
        : 'substantial'
    out.push({
      claim:            claim.slice(0, 160),
      claimed_value:    claimed_value.slice(0, 80),
      recomputed_value: recomputed_value.slice(0, 80),
      discrepancy:      discrepancy.slice(0, 320),
      inputs,
      formula,
      quote:            rawQuote.slice(0, 220),
      chapter_index,
      severity,
    })
  }
  return out.slice(0, 8)   // cap UI noise
}

// ─── Tier 5: cross-section premise pass via the reasoner ───────────────────────
//
// Why this exists: the consistency pass (Tier-2) only clusters numeric
// quantities by name — it can't catch a contradiction between *concepts* across
// sections (e.g. a combustion equation that burns methane when the declared gas
// has none) or a physically implausible *assumption* (a component that stays
// gaseous at the stated p/T). Those need a single reasoner pass that sees the
// whole work's claims at once. V4-pro + thinking + large context makes this
// affordable as one extra call.
//
// Soft-fail + reasoner, same contract as recomputation.

const PREMISE_DIGEST_BUDGET = 70_000   // char cap on the document digest we send

async function findPremiseIssues(
  sections:       Section[],
  analyses:       SectionAnalysis[],
  chapterReviews: ChapterReview[],
  submissionText: string,
  ctx:            CallContext,
): Promise<PremiseFinding[]> {
  // Need at least a couple of sections with content to reason across them.
  const contentful = analyses.filter((a) => a.summary && a.summary.length > 0)
  if (contentful.length < 2) return []

  const titleOf = (idx: number) =>
    chapterReviews[idx]?.title ?? analyses[idx]?.title ?? sections[idx]?.title ?? `Раздел ${idx + 1}`

  // Build a compact per-section digest: index, title, summary, and the
  // quantities/materials already extracted (with quotes). This is the model's
  // map of the whole work — enough to spot cross-section conflicts without
  // re-sending every full section.
  let budget = PREMISE_DIGEST_BUDGET
  const blocks: string[] = []
  analyses.forEach((a, idx) => {
    if (sections[idx]?.kind === 'references') return
    const qs = a.key_quantities.length
      ? '\n' + a.key_quantities.map((q) => `  · ${q.name} = ${q.value}  («${q.quote}»)`).join('\n')
      : ''
    const block = `### Раздел ${idx}: ${titleOf(idx)}\n${a.summary}${qs}`
    if (block.length > budget) return
    budget -= block.length
    blocks.push(block)
  })
  if (blocks.length < 2) return []

  // Intro + conclusion verbatim — headline claims/assumptions usually live there.
  const intro = sections.find((s) => s.kind === 'intro')
  const concl = sections.find((s) => s.kind === 'conclusion')
  const verbatim =
    (intro ? `\n## Введение (фрагмент)\n${sanitiseForPrompt(capMiddle(intro.text, 4_000))}\n` : '') +
    (concl ? `\n## Заключение (фрагмент)\n${sanitiseForPrompt(capMiddle(concl.text, 4_000))}\n` : '')

  const system =
    `Вы — рецензент, проверяющий ФИЗИЧЕСКУЮ, ХИМИЧЕСКУЮ и ЛОГИЧЕСКУЮ состоятельность ВКР В ЦЕЛОМ. ` +
    `Перед вами карта всей работы: сводка каждого раздела и извлечённые величины. Ищите проблемы, ` +
    `которые видны ТОЛЬКО при взгляде на работу целиком:\n` +
    `1) МЕЖРАЗДЕЛОВЫЕ ПРОТИВОРЕЧИЯ — допущение, значение или описание объекта в одном разделе ` +
    `несовместимо с другим (например, состав смеси не соответствует уравнению реакции; аппарат ` +
    `описан по-разному в расчёте и в другом разделе);\n` +
    `2) ФИЗИЧЕСКИ НЕПРАВДОПОДОБНЫЕ ДОПУЩЕНИЯ — проверяйте по известным константам (температуры ` +
    `кипения, давления насыщенных паров, фазовое равновесие при заданных p и T, балансы масс и энергии);\n` +
    `3) ЛОГИЧЕСКИЕ/СТЕХИОМЕТРИЧЕСКИЕ ОШИБКИ — небаланс уравнений реакций по элементам, неучтённые ` +
    `компоненты, неверные допущения в выводе.\n` +
    `Сообщайте только РЕАЛЬНЫЕ проблемы, обоснованные конкретными числами/фактами из работы. ` +
    `Не выдумывайте данных, которых нет. Думайте пошагово. Отвечайте только валидным JSON на русском.`

  const user =
    `## Карта работы по разделам\n${blocks.join('\n\n')}\n${verbatim}\n\n` +
    `Найдите проблемы уровня всей работы. Верните JSON:\n` +
    `{\n  "items": [\n    {\n` +
    `      "kind": "contradiction" (противоречие между разделами) | "physical" (неправдоподобное физ./хим. допущение) | "logical" (логическая/стехиометрическая ошибка),\n` +
    `      "title": "краткий заголовок проблемы (до 90 символов)",\n` +
    `      "explanation": "2–3 предложения: в чём проблема и почему это ошибка (с числами/константами)",\n` +
    `      "evidence": [{"chapter_index": число (0-based, из карты выше), "quote": "точная цитата из работы"}],\n` +
    `      "severity": "critical" | "substantial" | "minor",\n` +
    `      "correction": "одно предложение — что сделать, чтобы устранить"\n` +
    `    }\n  ]\n}\n` +
    `Для kind="physical" допускается evidence без цитат (если допущение описано в сводке, а не одной фразой). ` +
    `Для "contradiction"/"logical" приводите цитаты из соответствующих разделов. ` +
    `Если проблем уровня всей работы нет — верните {"items": []}. ` +
    `Не дублируйте чисто арифметические расхождения и числовые противоречия — они проверяются отдельно.`

  const r = await chatJSON<{
    items?: Array<{
      kind?:        unknown
      title?:       string
      explanation?: string
      evidence?:    Array<{ chapter_index?: number; quote?: string }>
      severity?:    unknown
      correction?:  string
    }>
  }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'проверка состоятельности',
    { context: ctx, reasoner: true, maxTokens: 4096 },
  )

  return normalisePremiseFindings(r.items, submissionText, sections.length)
}

function normalisePremiseFindings(
  items:       unknown,
  submissionText: string,
  sectionCount: number,
): PremiseFinding[] {
  if (!Array.isArray(items)) return []
  const haystack = submissionText.toLowerCase().replace(/\s+/g, ' ').trim()

  const out: PremiseFinding[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const obj = it as Record<string, unknown>

    const kind: PremiseFindingKind =
      obj.kind === 'contradiction' || obj.kind === 'physical' || obj.kind === 'logical'
        ? obj.kind
        : 'contradiction'
    const title       = typeof obj.title       === 'string' ? obj.title.trim()       : ''
    const explanation = typeof obj.explanation === 'string' ? obj.explanation.trim() : ''
    const correction  = typeof obj.correction  === 'string' ? obj.correction.trim()  : ''
    if (!title || !explanation) continue

    // Validate each evidence quote against the FULL submission — drop quotes
    // that don't appear verbatim (same citation discipline as the other passes).
    const evidence: PremiseFinding['evidence'] = []
    for (const e of Array.isArray(obj.evidence) ? obj.evidence : []) {
      if (!e || typeof e !== 'object') continue
      const ci = typeof (e as { chapter_index?: unknown }).chapter_index === 'number'
        ? (e as { chapter_index: number }).chapter_index : -1
      const q = typeof (e as { quote?: unknown }).quote === 'string'
        ? (e as { quote: string }).quote.trim() : ''
      if (ci < 0 || ci >= sectionCount || !q) continue
      const norm = q.toLowerCase().replace(/\s+/g, ' ').trim()
      if (norm.length < 8 || !haystack.includes(norm)) continue
      evidence.push({ chapter_index: ci, quote: q.slice(0, 220) })
    }

    // 'physical' findings may stand on the explanation alone; the others must
    // cite at least one verified quote, else we can't trust the cross-reference.
    if (kind !== 'physical' && evidence.length === 0) continue

    const severity: BulletSeverity =
      obj.severity === 'critical' || obj.severity === 'substantial' || obj.severity === 'minor'
        ? obj.severity
        : 'substantial'

    out.push({
      kind,
      title:       title.slice(0, 120),
      explanation: explanation.slice(0, 400),
      evidence:    evidence.slice(0, 3),
      severity,
      correction:  correction.slice(0, 200),
    })
  }
  return out.slice(0, 5)   // cap UI noise
}

function normaliseChapters(
  chapters: Array<{
    title?:      string
    assessment?: string
    strengths?:  unknown[]
    gaps?:       unknown[]
  }> | undefined,
  analyses: SectionAnalysis[],
  submissionText: string,
): ChapterReview[] {
  type RawBullets = Parameters<typeof normaliseBullets>[0]
  if (chapters && chapters.length) {
    return chapters.map((c) => ({
      title:      c.title ?? '',
      assessment: c.assessment ?? '',
      // Validate quotes against the full submission — synthesis may rewrite
      // them when consolidating. Bullets without verbatim quotes survive as
      // plain text (normaliseBullets keeps .text, drops only the quote).
      strengths:  normaliseBullets((c.strengths ?? []) as RawBullets, submissionText, 9999),
      gaps:       normaliseBullets((c.gaps      ?? []) as RawBullets, submissionText, 9999),
    }))
  }
  // Fallback to the raw section analyses if the reduce omitted chapter_reviews
  return analyses.map((a) => ({
    title:      a.title,
    assessment: a.summary,
    strengths:  a.strengths,
    gaps:       a.gaps,
  }))
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Coerce a possibly-legacy (string) or new (BulletItem) entry into BulletItem.
// Used at the boundary into the assignments table, which expects BulletItem[].
function toBulletItem(b: BulletItem | string): BulletItem {
  return typeof b === 'string'
    ? { text: b, quote: null, page: null }
    : b
}

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
