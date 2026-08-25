import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { isTotalRow } from '../lib/ruText'
import { MACKET_GRADING_SCALE, catalogueEntryFor } from './fosMacketReference'
import type {
  BrsScoreRow, FosScoreRow, FosCatalogueRow, FosCriteriaComponent,
  FosInstrumentCriteria, FosCompetencyMapRow, FosTitlePage,
} from '../../../shared/types'

// Builds the «Макет ФОС 3++» blocks for a generated ФОС.
//
// The point of this file is that the ФОС comes out conformant BY
// CONSTRUCTION: its «Перечень оценочных средств» is the discipline's own §9
// (the макет says so — «перечень оценочных средств приводиться из п.9 рабочей
// программы»), and each instrument's criteria are distributed to sum exactly
// to those same numbers. The checks in assessmentLinkage.ts / fosStructure.ts
// then become regressions rather than the primary mechanism — they exist for
// hand-written ФОС, and to catch this generator drifting.
//
// The split holds here too: the model supplies WORDING (what each part of an
// instrument's mark is awarded for), the arithmetic is done in code. Asking a
// model to make numbers add up is the one thing it is worst at, and the sums
// are exactly what the conformance check verifies.

const MAX_COMPONENTS = 6
const MIN_COMPONENTS = 2

/** §9 rows, «Итого» dropped and deduplicated by instrument name. */
export function instrumentsFromBrs(brsItems: BrsScoreRow[]): BrsScoreRow[] {
  const seen = new Set<string>()
  const out: BrsScoreRow[] = []
  for (const b of brsItems) {
    if (isTotalRow(b.name)) continue
    const key = `${(b.semester ?? '').trim().toLowerCase()}::${b.name.trim().toLowerCase()}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(b)
  }
  return out
}

/** «Перечень оценочных средств» — the макет's table, straight from §9, with
 *  the per-semester «Итого» rows the макет prints. Identical numbers by
 *  construction, so the ФОС↔§9 reconciliation has nothing to report. */
export function buildScoreTable(brsItems: BrsScoreRow[]): FosScoreRow[] {
  const rows = instrumentsFromBrs(brsItems)
  if (rows.length === 0) return []

  const out: FosScoreRow[] = []
  const semesters = [...new Set(rows.map((r) => r.semester ?? null))]
  for (const semester of semesters) {
    const inSem = rows.filter((r) => (r.semester ?? null) === semester)
    for (const r of inSem) {
      out.push({
        name: r.name, semester, count: null,
        min_points: r.min_points, max_points: r.max_points,
      })
    }
    const sum = (pick: (r: BrsScoreRow) => number | null): number | null => {
      const known = inSem.map(pick).filter((n): n is number => n != null)
      return known.length > 0 ? known.reduce((a, b) => a + b, 0) : null
    }
    out.push({
      name: 'Итого:', semester, count: null,
      min_points: sum((r) => r.min_points), max_points: sum((r) => r.max_points),
    })
  }
  return out
}

/** Catalogue entries for the instruments this discipline actually uses —
 *  the макет's full 28-row table trimmed to what is relevant. Instruments the
 *  макет has no entry for are skipped rather than described from thin air. */
export function buildCatalogue(brsItems: BrsScoreRow[]): FosCatalogueRow[] {
  const out: FosCatalogueRow[] = []
  const seen = new Set<string>()
  for (const r of instrumentsFromBrs(brsItems)) {
    const entry = catalogueEntryFor(r.name)
    if (!entry || seen.has(entry.name)) continue
    seen.add(entry.name)
    out.push(entry)
  }
  return out
}

export const buildGradingScale = () => MACKET_GRADING_SCALE

/** «Перечень компетенций и индикаторов с указанием этапов формирования».
 *  Topics are listed as the stages; which lesson type an indicator is formed
 *  in is a real authoring decision, so the columns are left for the teacher
 *  rather than guessed — «Не предусмотрены» is the макет's own placeholder. */
export function buildCompetencyMap(
  competencies: string[], topics: string[], instrumentNames: string[],
): FosCompetencyMapRow[] {
  const topicList = topics.join(', ')
  const instruments = instrumentNames.join(', ')
  return competencies.map((indicator) => ({
    indicator,
    lectures:   topicList,
    practicals: topicList,
    labs:       'Не предусмотрены',
    coursework: 'Не предусмотрены',
    instruments,
  }))
}

export function buildTitlePage(discipline: string): FosTitlePage {
  // Everything except the discipline name is institutional data the generator
  // has no access to — left null so the export prints the макет's own blank
  // rules for the кафедра to fill, rather than inventing a faculty.
  return {
    discipline,
    direction: null, profile: null, qualification: null,
    faculty: null, department: null,
    year: new Date().getFullYear(),
  }
}

// ── Per-instrument «Критерии оценки» ──────────────────────────────────────

interface RawComponents { instruments?: { instrument?: string; components?: string[] }[] }

/**
 * Distributes `total` across `n` components as evenly as possible, giving the
 * remainder to the earliest ones. Exact by construction — the parts always
 * sum back to the total, which is what fosStructure/assessmentLinkage verify.
 */
export function distributePoints(total: number | null, n: number): (number | null)[] {
  if (total == null || n <= 0) return Array(Math.max(0, n)).fill(null)
  const base = Math.floor(total / n)
  const remainder = total - base * n
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0))
}

/**
 * Asks the model what each instrument's mark should be awarded for, then
 * assigns the points itself from §9. Never lets the model choose numbers.
 */
export async function buildInstrumentCriteria(
  teacherId: string, disciplineName: string, brsItems: BrsScoreRow[],
): Promise<FosInstrumentCriteria[]> {
  const instruments = instrumentsFromBrs(brsItems)
  if (instruments.length === 0) return []

  // One criteria block per instrument NAME — a block is written once even when
  // the instrument recurs across semesters, so the first occurrence's points
  // are the ones it declares.
  const byName = new Map<string, BrsScoreRow>()
  for (const r of instruments) {
    const key = r.name.trim().toLowerCase()
    if (!byName.has(key)) byName.set(key, r)
  }
  const unique = [...byName.values()]

  const system =
    'Вы — методист российского вуза. Вы формулируете, ЗА ЧТО именно выставляются баллы за оценочное ' +
    'средство — перечень составляющих оценки. Баллы НЕ указывайте: их расставит система. ' +
    'Отвечайте только валидным JSON на русском языке.'

  const user =
    `## Дисциплина\n${sanitiseForPrompt(disciplineName)}\n\n` +
    `## Оценочные средства\n${unique.map((r) => `- ${sanitiseForPrompt(r.name)}`).join('\n')}\n\n` +
    `## Задача\nДля КАЖДОГО оценочного средства перечислите от ${MIN_COMPONENTS} до ${MAX_COMPONENTS} ` +
    `составляющих оценки — за что начисляются баллы (например для доклада: «Полнота раскрытия темы», ` +
    `«Качество ответов на вопросы», «Оформление и наглядность»). Составляющие должны быть связаны с ` +
    `содержанием этой дисциплины. Баллы не указывайте.\n\n` +
    `## Формат\nВерните JSON: {"instruments":[{"instrument":"...","components":["...","..."]}]}. Только JSON.`

  const raw = await chatJSON<RawComponents>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'составляющие критериев оценки ФОС',
    { context: { teacherId, feature: 'grading' }, temperature: 0 },
  )

  const labelsByInstrument = new Map<string, string[]>()
  for (const item of raw.instruments ?? []) {
    const name = String(item.instrument ?? '').trim()
    if (!name) continue
    const labels = (item.components ?? [])
      .map((s) => String(s ?? '').trim())
      .filter(Boolean)
      .slice(0, MAX_COMPONENTS)
    if (labels.length > 0) labelsByInstrument.set(name.toLowerCase(), labels)
  }

  return unique.map((r) => {
    const labels = labelsByInstrument.get(r.name.trim().toLowerCase())
      // A generic fallback beats emitting a block with no components at all,
      // which fosStructure would then read as criteria that don't add up.
      ?? ['Полнота и правильность выполнения', 'Самостоятельность и оформление']
    const mins = distributePoints(r.min_points, labels.length)
    const maxes = distributePoints(r.max_points, labels.length)
    const components: FosCriteriaComponent[] = labels.map((label, i) => ({
      label, min: mins[i] ?? null, max: maxes[i] ?? null,
    }))
    return {
      instrument: r.name,
      components,
      declared_min: r.min_points,
      declared_max: r.max_points,
    }
  })
}
