import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { ValidationError } from '../errors/AppError'
import type {
  SyllabusReview, SyllabusCoverageItem, CoverageStatus,
} from '../../../shared/types'

// КНИТУ admin feature A2 — «Анализ соответствия РПД заявленным компетенциям
// (ОПК/ПК/УК) и целям/результатам». Structurally the grading engine pointed at a
// syllabus: each competency/goal is a "criterion", the РПД is the "submission".
// Competencies/goals are either declared inside the РПД (auto-extracted) or
// supplied by the admin. Reuses the same chatJSON + verbatim-quote conventions as
// grading; computed live, not persisted (MVP).

const MAX_SYLLABUS_CHARS = 9000
const MAX_ITEMS          = 30      // competencies + goals sent to the reviewer
const VALID_STATUS: CoverageStatus[] = ['covered', 'partial', 'missing']

export interface CompetencyInput {
  code:   string          // 'ОПК-1' / 'ПК-3' / 'УК-2'
  title:  string          // competency statement
}

export interface ReviewParams {
  teacherId:     string
  syllabusText:  string
  competencies?: CompetencyInput[]   // if omitted, extracted from the syllabus
  goals?:        string[]            // if omitted, extracted from the syllabus
}

export async function reviewSyllabus(params: ReviewParams): Promise<SyllabusReview> {
  const syllabus = (params.syllabusText ?? '').trim().slice(0, MAX_SYLLABUS_CHARS)
  if (syllabus.length < 80) {
    throw new ValidationError('Недостаточно содержания РПД для анализа.')
  }

  // Resolve targets: use what's supplied, otherwise extract what the РПД declares.
  let competencies = (params.competencies ?? []).filter((c) => c.title?.trim())
  let goals        = (params.goals ?? []).filter((g) => g?.trim())
  const competenciesProvided = competencies.length > 0
  const goalsProvided        = goals.length > 0

  if (!competenciesProvided || !goalsProvided) {
    const declared = await extractDeclared(params.teacherId, syllabus)
    if (!competenciesProvided) competencies = declared.competencies
    if (!goalsProvided)        goals        = declared.goals
  }

  if (competencies.length === 0 && goals.length === 0) {
    throw new ValidationError(
      'Не удалось определить компетенции и цели. Укажите их вручную или загрузите РПД, где они заявлены.'
    )
  }

  // Cap the workload — competencies take priority over goals if we're over.
  competencies = competencies.slice(0, MAX_ITEMS)
  goals        = goals.slice(0, Math.max(0, MAX_ITEMS - competencies.length))

  const items = await scoreCoverage(params.teacherId, syllabus, competencies, goals)

  const summary = await summarise(items)

  return {
    competencies_source: competenciesProvided ? 'provided' : 'declared',
    goals_source:        goalsProvided ? 'provided' : 'declared',
    items,
    summary,
    covered: items.filter((i) => i.status === 'covered').length,
    partial: items.filter((i) => i.status === 'partial').length,
    missing: items.filter((i) => i.status === 'missing').length,
    generated_at: new Date().toISOString(),
  }
}

// ── Extract the competencies + goals the РПД itself declares ───────────────────
// Exported so the РПД-студия (syllabusAuthor) can seed authoring targets from a
// discipline's existing РПД.
export async function extractDeclared(
  teacherId: string, syllabus: string
): Promise<{ competencies: CompetencyInput[]; goals: string[] }> {
  const system =
    'Вы — методист российского вуза. Вы извлекаете из текста рабочей программы дисциплины (РПД) ' +
    'заявленные компетенции (ОПК/ПК/УК) и цели/планируемые результаты обучения. ' +
    'Отвечайте только валидным JSON на русском языке.'

  const user =
    `## Текст РПД\n${sanitiseForPrompt(syllabus)}\n\n` +
    `## Задача\nИзвлеките:\n` +
    `- "competencies": компетенции, которые дисциплина должна формировать. Каждый элемент: ` +
    `{"code": код вида "ОПК-1"/"ПК-3"/"УК-2" (или "" если кода нет), "title": формулировка компетенции}.\n` +
    `- "goals": цели освоения и планируемые результаты обучения (массив строк).\n` +
    `Берите формулировки из текста, не выдумывайте. Если чего-то нет — верните пустой массив.\n\n` +
    `## Формат ответа\nВерните JSON: {"competencies":[...],"goals":[...]}. Только JSON.`

  const result = await chatJSON<{
    competencies?: { code?: string; title?: string }[]; goals?: string[]
  }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'компетенции и цели РПД',
    { context: { teacherId, feature: 'grading' } },
  )

  const competencies = (result.competencies ?? [])
    .map((c) => ({ code: String(c.code ?? '').trim(), title: String(c.title ?? '').trim() }))
    .filter((c) => c.title)
  const goals = (result.goals ?? []).map((g) => String(g ?? '').trim()).filter(Boolean)
  return { competencies, goals }
}

// ── Score how well the syllabus covers each competency/goal ────────────────────
async function scoreCoverage(
  teacherId: string,
  syllabus: string,
  competencies: CompetencyInput[],
  goals: string[],
): Promise<SyllabusCoverageItem[]> {
  const compBlock = competencies.length
    ? competencies.map((c, i) => `K${i}. [${sanitiseForPrompt(c.code || 'без кода')}] ${sanitiseForPrompt(c.title)}`).join('\n')
    : '— нет —'
  const goalBlock = goals.length
    ? goals.map((g, i) => `G${i}. ${sanitiseForPrompt(g)}`).join('\n')
    : '— нет —'

  const system =
    'Вы — эксперт по качеству учебных программ российского вуза. Вы оцениваете, насколько ' +
    'содержание, темы и формы работы рабочей программы дисциплины (РПД) действительно ' +
    'обеспечивают заявленные компетенции и цели. Отвечайте только валидным JSON на русском языке.'

  const user =
    `## Текст РПД\n<syllabus>\n${sanitiseForPrompt(syllabus)}\n</syllabus>\n\n` +
    `## Компетенции (ОПК/ПК/УК)\n${compBlock}\n\n## Цели и результаты\n${goalBlock}\n\n` +
    `## Задача\nДля КАЖДОЙ компетенции (K0, K1, …) и КАЖДОЙ цели (G0, G1, …) оцените, ` +
    `насколько содержание РПД её действительно обеспечивает.\n\n` +
    `## Формат ответа\nВерните JSON: {"items":[ ... ]}, где каждый элемент:\n` +
    `- "ref": идентификатор из списков выше ("K0", "G1", …)\n` +
    `- "status": "covered" (полностью обеспечена), "partial" (частично), "missing" (не обеспечена)\n` +
    `- "score": число 0–100 — степень покрытия\n` +
    `- "evidence": ДОСЛОВНАЯ цитата из РПД (5–15 слов), подтверждающая покрытие, либо null если опереться не на что. Не выдумывайте цитаты.\n` +
    `- "gap": чего не хватает или что слабо (1–2 предложения; для полностью покрытых — пусто)\n` +
    `- "recommendation": конкретная рекомендация, что добавить/изменить в РПД (1 предложение)\n` +
    `Ответьте ТОЛЬКО JSON-объектом.`

  const result = await chatJSON<{
    items: { ref?: string; status?: string; score?: number; evidence?: string | null; gap?: string; recommendation?: string }[]
  }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'оценка покрытия РПД',
    { context: { teacherId, feature: 'grading' } },
  )

  // Map model refs (K0/G1) back to the source items, preserving order
  // (competencies first, then goals) and filling any the model skipped.
  const byRef = new Map<string, { status?: string; score?: number; evidence?: string | null; gap?: string; recommendation?: string }>()
  for (const it of result.items ?? []) {
    if (it.ref) byRef.set(String(it.ref).trim().toUpperCase(), it)
  }

  const items: SyllabusCoverageItem[] = []
  competencies.forEach((c, i) => items.push(toItem('competency', c.code || null, c.title, byRef.get(`K${i}`))))
  goals.forEach((g, i)        => items.push(toItem('goal', null, g, byRef.get(`G${i}`))))
  return items
}

function toItem(
  kind: 'competency' | 'goal',
  code: string | null,
  title: string,
  raw?: { status?: string; score?: number; evidence?: string | null; gap?: string; recommendation?: string },
): SyllabusCoverageItem {
  const status = VALID_STATUS.includes(raw?.status as CoverageStatus)
    ? (raw!.status as CoverageStatus)
    : 'missing'
  const score = clampScore(raw?.score, status)
  return {
    kind, code, title, status, score,
    evidence:       raw?.evidence ? String(raw.evidence).trim() : null,
    gap:            (raw?.gap ?? '').trim(),
    recommendation: (raw?.recommendation ?? '').trim(),
  }
}

function clampScore(score: number | undefined, status: CoverageStatus): number {
  if (typeof score === 'number' && isFinite(score)) {
    return Math.max(0, Math.min(100, Math.round(score)))
  }
  // Fall back to a sensible default from the status if the model omitted a number.
  return status === 'covered' ? 90 : status === 'partial' ? 55 : 15
}

// ── One-line overall verdict ───────────────────────────────────────────────────
async function summarise(items: SyllabusCoverageItem[]): Promise<string> {
  const missing = items.filter((i) => i.status === 'missing')
  const partial = items.filter((i) => i.status === 'partial')
  const total = items.length
  if (total === 0) return 'Нет элементов для оценки.'
  if (missing.length === 0 && partial.length === 0) {
    return 'РПД полностью покрывает заявленные компетенции и цели.'
  }
  const parts: string[] = []
  if (missing.length) parts.push(`${missing.length} не обеспечено`)
  if (partial.length) parts.push(`${partial.length} частично`)
  return `Из ${total} элементов: ${parts.join(', ')}. Требуется доработка содержания РПД.`
}
