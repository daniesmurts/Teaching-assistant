import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import type { ProgramCompetency, DisciplineCoverageResult, DisciplineCoverageItem, CoverageStatus } from '../../../shared/types'

// Checks an uploaded document (a discipline's рабочая программа, or — later —
// a practice's working programme) against the competencies it's meant to
// develop. This is Feature K (TODO.md "РПД ↔ competency/goals conformance
// check") scoped to a programme's own competency model instead of a
// standalone syllabus upload: the "criteria" are program_competencies, the
// "submission" is the extracted document text.
//
// Deliberately NOT built on services/grading.ts's grade()/gradeOnce() — those
// persist `assignments` rows, apply plan-tier watermarking, run RAG retrieval
// and revision handling, none of which apply here. Instead this mirrors the
// lighter chatJSON-direct pattern already used by programAnalysis.ts's
// analyzeSequencing/analyzeProgression.

const MAX_DOC_CHARS = 24000   // a single discipline РПД is assignment-scale, not the 80-page aggregate — no chunking needed
const MAX_COMPETENCIES = 24   // keeps the response within token budget

const VALID_STATUS: CoverageStatus[] = ['covered', 'partial', 'missing']

export async function reviewDocumentCoverage(params: {
  teacherId:      string
  institutionId?: string
  documentText:   string
  competencies:   ProgramCompetency[]
  label:          string   // e.g. discipline name — used in the prompt for context
}): Promise<DisciplineCoverageResult> {
  const competencies = params.competencies.slice(0, MAX_COMPETENCIES)
  if (competencies.length === 0) {
    return { overall_coverage: 0, items: [], summary: 'Нет заявленных компетенций для проверки.' }
  }

  const text = params.documentText.slice(0, MAX_DOC_CHARS)
  const haystack = text.toLowerCase().replace(/\s+/g, ' ').trim()

  const refs = competencies.map((c, i) => ({ ref: `R${i}`, c }))
  const reqBlock = refs.map(({ ref, c }) =>
    `${ref}. ${c.kind === 'goal' ? '[ЦЕЛЬ]' : `[${sanitiseForPrompt(c.code ?? '')}]`} ${sanitiseForPrompt(c.title)}`
  ).join('\n')

  const system =
    'Вы — методист российского вуза, эксперт по экспертизе рабочих программ дисциплин (РПД). ' +
    'Вы проверяете, действительно ли текст РПД раскрывает заявленные компетенции/цели — по содержанию ' +
    'дисциплины, формируемым результатам обучения, оценочным средствам. Отвечайте только валидным JSON на русском.'

  const user =
    `## Дисциплина\n${sanitiseForPrompt(params.label)}\n\n` +
    `## Компетенции/цели, которые должна формировать эта РПД\n${reqBlock}\n\n` +
    `## Текст рабочей программы\n<document>\n${sanitiseForPrompt(text)}\n</document>\n\n` +
    `## Задача\nДля КАЖДОГО требования (по ref) определите статус:\n` +
    `- "covered" — компетенция раскрыта содержательно (есть конкретное соответствие в тексте);\n` +
    `- "partial" — упомянута, но раскрыта поверхностно или лишь частично;\n` +
    `- "missing" — в тексте нет соответствия этой компетенции/цели.\n` +
    `Для "covered"/"partial" укажите evidence — ДОСЛОВНУЮ короткую цитату из документа (5–15 слов), ` +
    `подтверждающую вывод; если опереться не на что — null. Дайте note — 1 предложение с обоснованием ` +
    `и, для "partial"/"missing", рекомендацией, что добавить.\n\n` +
    `## Формат ответа\nВерните JSON: {"summary":"1-2 предложения общего вывода","items":[` +
    `{"ref":"R0","status":"covered","evidence":"...","note":"..."}]}. Сохраняйте ref. Только JSON.`

  const result = await chatJSON<{
    summary?: string
    items?: { ref?: string; status?: string; evidence?: string | null; note?: string }[]
  }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'проверка соответствия РПД компетенциям',
    { context: { teacherId: params.teacherId, institutionId: params.institutionId, feature: 'grading' }, maxTokens: 4000 },
  )

  const byRef = new Map<string, { status?: string; evidence?: string | null; note?: string }>()
  for (const it of result.items ?? []) {
    if (it.ref) byRef.set(String(it.ref).trim().toUpperCase(), it)
  }

  const items: DisciplineCoverageItem[] = refs.map(({ ref, c }) => {
    const raw = byRef.get(ref.toUpperCase())
    const status = VALID_STATUS.includes(raw?.status as CoverageStatus)
      ? (raw!.status as CoverageStatus)
      : 'missing'
    return {
      code:     c.code,
      title:    c.title,
      status,
      evidence: validateEvidence(raw?.evidence, haystack),
      note:     String(raw?.note ?? '').trim(),
    }
  })

  const weight = (s: CoverageStatus): number => (s === 'covered' ? 1 : s === 'partial' ? 0.5 : 0)
  const overall_coverage = Math.round(
    (items.reduce((sum, it) => sum + weight(it.status), 0) / items.length) * 100
  )

  return {
    overall_coverage,
    items,
    summary: String(result.summary ?? '').trim(),
  }
}

// ── Auto-detect declared competency codes ────────────────────────────────────
//
// After a рабочая программа is uploaded, we do a cheap LLM pass to extract
// which competency codes the РПД itself declares (usually in the "Планируемые
// результаты обучения" / "Компетенции" section). The result pre-populates
// `program_disciplines.competency_codes` so the "Проверить соответствие"
// button lights up without the user having to fill anything in manually.
//
// Filtered against `program.competencies.code` — a code the РПД mentions but
// the programme doesn't declare is silently dropped (either OCR noise, or a
// legitimate mismatch worth surfacing but not worth blocking on). This is
// cheaper and simpler than the coverage check: no evidence validation, no
// per-item classification, just "which of these codes does this document
// mention as its own".

export async function detectDeclaredCompetencyCodes(params: {
  teacherId:      string
  institutionId?: string
  documentText:   string
  programCompetencyCodes: string[]   // valid codes on the programme; extraction is filtered against this set
  label:          string
}): Promise<string[]> {
  if (params.programCompetencyCodes.length === 0) return []
  const text = params.documentText.slice(0, MAX_DOC_CHARS)
  if (text.trim().length < 200) return []   // nothing meaningful to extract

  const validSet = new Set(params.programCompetencyCodes.map((c) => c.trim().toUpperCase()))

  const system =
    'Вы — методист российского вуза. Из текста рабочей программы дисциплины (РПД) вы извлекаете ' +
    'коды компетенций, которые дисциплина участвует формировать. Ищите ВЕЗДЕ в тексте: разделе ' +
    '«Планируемые результаты обучения» / «Компетенции», в матрицах/картах компетенций, в описании ' +
    'содержания разделов, в оценочных средствах и таблицах. РПД часто перечисляет коды в нескольких ' +
    'местах — включайте код если он упомянут ХОТЯ БЫ ОДИН РАЗ как формируемый или закрепляемый ' +
    'дисциплиной. Отвечайте только валидным JSON.'

  const user =
    `## Дисциплина\n${sanitiseForPrompt(params.label)}\n\n` +
    `## Возможные коды компетенций программы\n${params.programCompetencyCodes.join(', ')}\n\n` +
    `## Текст РПД\n<document>\n${sanitiseForPrompt(text)}\n</document>\n\n` +
    `## Задача\nВерните ВСЕ коды из списка выше, которые эта РПД упоминает как формируемые ` +
    `дисциплиной — в любом разделе документа. Не добавляйте коды, которых нет в списке выше. ` +
    `Не пропускайте код только потому что он упомянут коротко или в одном месте — если он ` +
    `явно связан с этой дисциплиной, включите его.\n\n` +
    `## Формат ответа\n{"codes":["УК-1","ОПК-2","ПК-3"]}. Только JSON.`

  const result = await chatJSON<{ codes?: unknown }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'извлечение кодов компетенций',
    { context: { teacherId: params.teacherId, institutionId: params.institutionId, feature: 'grading' }, maxTokens: 1500 },
  )

  const raw = Array.isArray(result.codes) ? result.codes : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const norm = item.trim().toUpperCase()
    if (!validSet.has(norm) || seen.has(norm)) continue
    seen.add(norm)
    // Preserve the original casing/formatting from the programme's competency list.
    const original = params.programCompetencyCodes.find((c) => c.trim().toUpperCase() === norm)
    if (original) out.push(original)
  }
  return out
}

/** A quote survives only if it appears verbatim (case/whitespace-insensitive) in the document — same contract as grading.ts's citation validation. */
function validateEvidence(raw: string | null | undefined, haystack: string): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalised = trimmed.toLowerCase().replace(/\s+/g, ' ').trim()
  if (normalised.length < 8 || !haystack.includes(normalised)) return null
  return trimmed.slice(0, 240)
}
