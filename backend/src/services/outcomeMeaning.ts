import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import type {
  OutcomeKind, OutcomeMeaningFinding, OutcomeMeaningVerdict, ContentSection,
} from '../../../shared/types'
import type { DeclaredRequirementInput } from './outcomeFormulation'

// «Проверка смысла формулировки» — the second half of the методист's rule,
// asked for on 2026-08-24 once the copy check was fixed:
//
//   «нужна еще проверка смысла, формулировки (то есть того, как формулировка
//    "должен знать" отражает индикатор и есть ли смысловая связь с
//    дисциплиной)»
//
// DELIBERATELY AN LLM PASS — the opposite call from services/
// outcomeFormulation.ts, and for a reason that file's header states from the
// other side: "is this text a copy of that text" is a measurable string
// question, so it goes in code. "Does this wording convey that requirement's
// meaning, in terms this discipline actually teaches" is a judgement, and
// pretending otherwise would mean inventing a similarity threshold that
// stands in for reading comprehension. A ЗУВ reworded just enough to clear
// the copy detector's 0.9 containment can still be empty boilerplate; only
// reading it against the discipline's own content catches that.
//
// Scoped to what the copy check leaves behind: verbatim copies are already
// reported, and re-flagging them here would put two findings on one line
// saying the same thing in different words.

const MAX_CONTENT_CHARS = 6000
const MAX_ITEMS = 30          // prompt-size cap; ЗУВ lists run well under this

const VALID_VERDICT: OutcomeMeaningVerdict[] = ['not_reflected', 'weak_link']

const OUTCOME_LABEL: Record<OutcomeKind, string> = {
  knowledge: 'Знать', skill: 'Уметь', mastery: 'Владеть',
}

const SECTION_LABEL: Record<ContentSection, string> = {
  lectures:    '§5 лекции',
  practicals:  '§6 практические',
  labs:        '§7 лабораторные',
  independent: '§8 СРС',
  control:     '§8.1 контроль',
}

export interface OutcomeMeaningItem {
  ref:   string
  kind:  OutcomeKind
  title: string
}

export interface CheckOutcomeMeaningParams {
  teacherId: string
  /** ЗУВ lines to judge — callers must already have removed verbatim copies. */
  items:     OutcomeMeaningItem[]
  /** Competencies and indicators the ЗУВ items are supposed to reflect. */
  declared:  DeclaredRequirementInput[]
  /** §5–§8.1 content, so "связь с дисциплиной" is judged against real topics. */
  content:   Record<ContentSection, string | null>
}

interface RawMeaning {
  items?: {
    ref?:            string
    indicator_code?: string | null
    verdict?:        string
    detail?:         string
    recommendation?: string
  }[]
}

/** Builds the ЗУВ inputs for the ordered outcome lists, skipping anything the
 *  deterministic copy check already flagged (matched on kind + exact text —
 *  both sides read the same `parsed.outcomes` arrays). */
export function buildMeaningItems(
  outcomes: { knowledge: string[]; skills: string[]; mastery: string[] },
  alreadyFlagged: { outcome_kind: OutcomeKind; outcome_title: string }[],
): OutcomeMeaningItem[] {
  const skip = new Set(alreadyFlagged.map((f) => `${f.outcome_kind}::${f.outcome_title.trim()}`))
  const buckets: { kind: OutcomeKind; prefix: string; items: string[] }[] = [
    { kind: 'knowledge', prefix: 'K', items: outcomes.knowledge },
    { kind: 'skill',     prefix: 'S', items: outcomes.skills },
    { kind: 'mastery',   prefix: 'M', items: outcomes.mastery },
  ]
  const out: OutcomeMeaningItem[] = []
  for (const b of buckets) {
    b.items.forEach((title, i) => {
      if (skip.has(`${b.kind}::${title.trim()}`)) return
      out.push({ ref: `${b.prefix}${i}`, kind: b.kind, title })
    })
  }
  return out.slice(0, MAX_ITEMS)
}

function buildContentBlock(content: Record<ContentSection, string | null>): string {
  const present = (Object.keys(SECTION_LABEL) as ContentSection[])
    .filter((s) => content[s])
  if (present.length === 0) return '(разделы содержания не найдены)'
  const budget = Math.floor(MAX_CONTENT_CHARS / present.length)
  return present
    .map((s) => `### ${SECTION_LABEL[s]}\n${sanitiseForPrompt((content[s] ?? '').slice(0, budget))}`)
    .join('\n\n')
}

/**
 * Judges whether each ЗУВ line conveys a declared requirement's meaning in
 * terms of this discipline's own content. Returns problems only — an item the
 * model rates acceptable produces nothing.
 *
 * Throws on provider failure rather than returning []: an empty result has to
 * keep meaning "checked, nothing wrong". The caller decides whether to
 * degrade (see reviewSyllabus, which records a warning) — swallowing it here
 * would recreate the exact silence that let the copy check look healthy while
 * doing nothing.
 */
export async function checkOutcomeMeaning(
  params: CheckOutcomeMeaningParams,
): Promise<OutcomeMeaningFinding[]> {
  const { items, declared } = params
  if (items.length === 0 || declared.length === 0) return []

  const declaredBlock = declared
    .map((d) => `- ${d.code ? `[${sanitiseForPrompt(d.code)}] ` : ''}${sanitiseForPrompt(d.title)}`)
    .join('\n')

  const itemsBlock = items
    .map((i) => `${i.ref}. [${OUTCOME_LABEL[i.kind]}] ${sanitiseForPrompt(i.title)}`)
    .join('\n')

  const system =
    'Вы — методист российского вуза. Вы оцениваете КАЧЕСТВО ФОРМУЛИРОВОК планируемых результатов ' +
    'обучения («Знать/Уметь/Владеть») в рабочей программе дисциплины: раскрывает ли формулировка ' +
    'смысл заявленного индикатора компетенции и связана ли она с содержанием именно этой дисциплины. ' +
    'Вы НЕ оцениваете, обеспечено ли требование содержанием — это отдельная проверка. ' +
    'Отвечайте только валидным JSON на русском языке.'

  const user =
    `## Индикаторы и компетенции, заявленные в РПД\n${declaredBlock}\n\n` +
    `## Содержание дисциплины (что реально преподаётся)\n${buildContentBlock(params.content)}\n\n` +
    `## Формулировки «Знать/Уметь/Владеть» для оценки\n${itemsBlock}\n\n` +
    `## Задача\nДля КАЖДОЙ формулировки (по её ref) определите:\n` +
    `1) "indicator_code" — код индикатора/компетенции из списка выше, смысл которого эта формулировка ` +
    `должна раскрывать (или null, если подходящего нет);\n` +
    `2) "verdict" — одно из трёх:\n` +
    `   - "ok": формулировка раскрывает смысл индикатора И опирается на содержание этой дисциплины ` +
    `(названы её темы, объекты, методы);\n` +
    `   - "weak_link": смысл индикатора в целом передан, но формулировка общая — по ней нельзя понять, ` +
    `о какой именно дисциплине речь, она подошла бы любой другой;\n` +
    `   - "not_reflected": формулировка не раскрывает смысл ни одного заявленного индикатора ` +
    `(говорит о другом).\n` +
    `3) "detail" — 1 предложение: что именно не так (пусто при "ok");\n` +
    `4) "recommendation" — 1 предложение: как переформулировать через содержание этой дисциплины ` +
    `(пусто при "ok").\n\n` +
    `Будьте сдержанны: "ok" — нормальный результат для грамотно написанной РПД. ` +
    `Не придирайтесь к стилю, оценивайте только смысл и связь с дисциплиной.\n\n` +
    `## Формат\nВерните JSON: {"items":[{"ref":"...","indicator_code":"...","verdict":"...",` +
    `"detail":"...","recommendation":"..."}]}. Только JSON.`

  const raw = await chatJSON<RawMeaning>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'смысл формулировок «Знать/Уметь/Владеть»',
    // temperature 0 — same reasoning as every other parse/score pass here: a
    // verdict that flips between runs on an unchanged РПД is worse than a
    // slightly conservative one, because the методист re-runs checks.
    { context: { teacherId: params.teacherId, feature: 'grading' }, temperature: 0 },
  )

  const byRef = new Map(items.map((i) => [i.ref, i]))
  const declaredByCode = new Map(
    declared.filter((d) => d.code).map((d) => [d.code.trim().toUpperCase(), d]),
  )

  const findings: OutcomeMeaningFinding[] = []
  for (const r of raw.items ?? []) {
    const item = byRef.get(String(r.ref ?? '').trim())
    if (!item) continue                                   // hallucinated ref
    const verdict = String(r.verdict ?? '').trim() as OutcomeMeaningVerdict
    if (!VALID_VERDICT.includes(verdict)) continue        // 'ok' and junk both fall out here

    // Only echo a code the РПД actually declared — the finding points the
    // reader at a real row, never at one the model invented.
    const code = String(r.indicator_code ?? '').trim()
    const match = code ? declaredByCode.get(code.toUpperCase()) : undefined

    const label = OUTCOME_LABEL[item.kind]
    const detail = String(r.detail ?? '').trim()
    const recommendation = String(r.recommendation ?? '').trim()

    findings.push({
      verdict,
      outcome_kind:    item.kind,
      outcome_title:   item.title,
      indicator_code:  match?.code ?? null,
      indicator_title: match?.title ?? null,
      detail: detail || (verdict === 'not_reflected'
        ? `Формулировка «${label}» не раскрывает смысл ни одного заявленного индикатора.`
        : `Формулировка «${label}» слишком общая — по ней не видно связи с содержанием этой дисциплины.`),
      recommendation: recommendation ||
        `Переформулируйте пункт «${label}» через темы и объекты этой дисциплины.`,
    })
  }

  return findings
}
