import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { tokenize, mentions, isTotalRow } from '../lib/ruText'

// Re-exported: several modules and tests import these from here, and both
// are conceptually part of this check's vocabulary even though they now live
// in lib/ruText.ts (see there for why they moved).
export { mentions, isTotalRow }
import { selectRelevantSections } from './documentReview'
import { checkFosStructure } from './fosStructure'
import { checkBrsReadiness } from './brsReadiness'
import { BRS_SEMESTER_MIN, BRS_SEMESTER_MAX, FINAL_ATTESTATION } from '../config/brs'
import type {
  AssessmentLinkageResult, AssessmentLinkageFinding, LinkageSlot,
  ParsedAssessmentLinkage, BrsScoreRow, FosScoreRow, FosScoreFinding, FosScoreCheck,
  FosCriteriaBlock,
} from '../../../shared/types'

// «Связка оценочного средства» — raised by a методист reviewing a real РПД
// (2026-08-20). Her rule, stated precisely:
//
//   «Должна быть связка оценочного средства, написанного в п.4 РПД, с формой
//    СРС, формой КСР, п.9 и ФОС. Например, если в п.4 есть оценочное средство
//    "ДОКЛАД", то в СРС должно быть "ПОДГОТОВКА ДОКЛАДА", в КСР —
//    "ЗАСЛУШИВАНИЕ ДОКЛАДА", в п.9 — "ДОКЛАД" с баллами, в ФОС — доклад.»
//
// So an оценочное средство named in §4's column 9 is a promise, and the rest
// of the РПД has to keep it: the student has to be given time to prepare it
// (СРС), the teacher has to be scheduled to assess it (КСР), and it has to
// carry points in the БРС (§9). A name that appears in §4 and nowhere else is
// an assessment that exists only on paper.
//
// Same split as services/outcomeFormulation.ts: the EXTRACTION is an LLM pass
// (reading a table out of unstructured РПД prose is exactly what a model is
// for), the LINKAGE is deterministic code (whether «Доклад» is present in
// «Подготовка доклада» is a measurable string question — free, reproducible,
// unhallucinatable). Nothing here is scored by the model.
//
// ФОС is checked ONLY when one has been uploaded against the discipline
// (program_documents kind='fos' — methodist/РОП upload, mirrors how working
// programmes are attached). The ФОС is a separate document governed by the
// institution's own положение and was never in the РПД text, so before that
// upload path existed this check could not verify it at all — claiming to
// have would have been a lie. `fos_available` on the result says which case
// applies; when false every finding's ФОС link is genuinely unverified, not
// "checked and failed", and the UI must show that distinction, not collapse
// it into a red mark.

// A naive slice(0, N) from the start was the original approach here — wrong
// for this check specifically, because ВСЕ four things it needs (§4's table,
// §8 СРС, §8.1 КСР, §9 БРС) routinely sit in the back half of a real РПД:
// found in production 2026-08-20 against a 14-page РПД whose §9 (page 11)
// never made it inside a 14000-char window that started from page 1 — every
// instrument came back "missing from п.9" not because the linkage was
// broken, but because the model was never shown §9's text at all. Reuses
// documentReview.ts's selectRelevantSections (heading-anchored, packs by
// priority, proportional-trim) with THIS check's own heading set instead of
// its default one, same fix documented in fgosExtractor.ts for the same
// failure mode (a late-document appendix silently truncated away).
const MAX_TEXT_CHARS = 40000
const MAX_FOS_TEXT_CHARS = 40000   // ФОС files run long (question banks, rubrics) — search, don't summarise

const LINKAGE_HEADINGS: { key: string; re: RegExp }[] = [
  // §4 «Структура и содержание дисциплины» — same anchor documentReview.ts's
  // default 'lectures' heading uses; renamed here since this check reads the
  // table's оценочные средства column, not the lecture topics.
  { key: 'structure', re: /^[\s\d.]*(?:содержание\s+(?:разделов|дисциплины)|тематический\s+план|разделы\s+дисциплины)/im },
  { key: 'srs',        re: /^[\s\d.]*(?:самостоятельн(?:ая|ой)\s+работ|срс)/im },
  { key: 'ksr',         re: /^[\s\d.]*(?:контрол[ья]\s+самостоятельной\s+работ|кср)/im },
  { key: 'ratings',     re: /^[\s\d.]*(?:рейтинговой\s+систем|балльно-рейтингов|использование\s+рейтинговой)/im },
]
// §4 first — with no instrument list, the check produces nothing regardless
// of what else is in budget. §9 next, since a truncated §9 is exactly the
// failure mode this reuse was built to fix.
const LINKAGE_PRIORITY = ['structure', 'ratings', 'srs', 'ksr']

// «Экзамен»/«зачёт» are промежуточная аттестация, not текущий контроль. They
// legitimately carry points in §9 but have no «заслушивание» in КСР, and
// requiring one would generate a false finding on every correct РПД. They're
// still linkage-checked, just against §9 alone. Shared with brsReadiness.ts,
// which exempts them from the макет catalogue for the same reason.

const SLOT_LABEL: Record<LinkageSlot, string> = {
  srs: 'СРС',
  ksr: 'КСР',
  brs: 'п.9 (БРС)',
  fos: 'ФОС',
}

interface RawParse {
  instruments?: { name?: string; section?: string }[]
  srs_forms?:   unknown
  ksr_forms?:   unknown
  brs_items?:   { name?: string; semester?: string | null; min_points?: number | string | null; max_points?: number | string | null }[]
}

export async function parseAssessmentLinkage(
  teacherId: string, text: string
): Promise<ParsedAssessmentLinkage> {
  const system =
    'Вы — методист российского вуза. Вы извлекаете из текста рабочей программы дисциплины (РПД) ' +
    'оценочные средства и формы работы. Берите формулировки из текста дословно, ничего не выдумывайте. ' +
    'Отвечайте только валидным JSON на русском языке.'

  const user =
    `## Текст РПД\n${sanitiseForPrompt(selectRelevantSections(text, MAX_TEXT_CHARS, LINKAGE_HEADINGS, LINKAGE_PRIORITY))}\n\n` +
    `## Задача\nИзвлеките четыре списка.\n\n` +
    `1) "instruments" — ОЦЕНОЧНЫЕ СРЕДСТВА из таблицы раздела «Структура и содержание дисциплины» ` +
    `(п.4), последний столбец «Оценочные средства для проведения текущей и промежуточной аттестации». ` +
    `Для каждого: {"name": "Доклад" (одно средство — одна запись; если в ячейке через «;» перечислено ` +
    `несколько, разбейте их), "section": название раздела дисциплины из этой строки}.\n\n` +
    `2) "srs_forms" — массив строк: формы/виды САМОСТОЯТЕЛЬНОЙ РАБОТЫ студентов (СРС), как они названы ` +
    `в тексте (например «Подготовка доклада», «Проработка лекционного материала»).\n\n` +
    `3) "ksr_forms" — массив строк: формы КОНТРОЛЯ САМОСТОЯТЕЛЬНОЙ РАБОТЫ (КСР) — что делает ` +
    `преподаватель (например «Заслушивание доклада», «Защита лабораторной работы»). ` +
    `КСР — это ОТДЕЛЬНАЯ от СРС графа/раздел. Пустой массив, если раздела КСР нет.\n\n` +
    `4) "brs_items" — строки таблицы балльно-рейтинговой системы (обычно п.9 «Использование ` +
    `рейтинговой системы оценки знаний»). Для КАЖДОЙ строки: {"name": дословное название оценочного ` +
    `средства, "semester": заголовок семестра, под которым идёт строка (например "1-й семестр"), или ` +
    `null если таблица не разбита по семестрам, "min_points": минимальный балл числом или null, ` +
    `"max_points": максимальный балл числом или null}. ` +
    `ВКЛЮЧИТЕ и строки «Итого» — они нужны для проверки суммы.\n\n` +
    `## Формат\nВерните JSON: {"instruments":[...],"srs_forms":[...],"ksr_forms":[...],"brs_items":[...]}. ` +
    `Только JSON. Если раздела нет — пустой массив, не выдумывайте.`

  const raw = await chatJSON<RawParse>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'связка оценочных средств РПД',
    // temperature 0 — pure extraction, same rationale as the syllabus parser:
    // a non-deterministic parse makes the findings jump around between runs
    // on an unchanged document.
    { context: { teacherId, feature: 'grading' }, temperature: 0 },
  )

  const strArr = (x: unknown): string[] =>
    Array.isArray(x) ? x.map((v) => String(v ?? '').trim()).filter(Boolean) : []
  const num = (x: unknown): number | null => {
    if (x == null || x === '') return null
    const n = Number(x)
    return Number.isFinite(n) ? n : null
  }

  return {
    instruments: (raw.instruments ?? [])
      .map((i) => ({ name: String(i.name ?? '').trim(), section: String(i.section ?? '').trim() || null }))
      .filter((i) => i.name),
    srs_forms: strArr(raw.srs_forms),
    ksr_forms: strArr(raw.ksr_forms),
    brs_items: (raw.brs_items ?? [])
      .map((b) => ({
        name:       String(b.name ?? '').trim(),
        semester:   String(b.semester ?? '').trim() || null,
        min_points: num(b.min_points),
        max_points: num(b.max_points),
      }))
      .filter((b) => b.name),
  }
}

// ─── ФОС «Перечень оценочных средств» ↔ §9 (методист, 2026-08-25) ────────────
// «баллы должны брать из п.9 РП (вот такую связку еще тоже можно проверять)».
// The КНИТУ «Макет ФОС 3++» prints the rule under the table itself:
//   «Примечание: перечень оценочных средств приводиться из п.9 рабочей
//    программы по дисциплине (модулю)»
// so this is arithmetic. Extraction goes to the model (reading a table out of
// a Word export), the reconciliation stays in code — same split as the rest
// of this file.
//
// PER SEMESTER, not per discipline: a multi-semester РПД repeats the same
// instrument with different points in each («Проект» 10/15, 10/15, 18/30 in
// the reported document), and each semester totals 60/100 separately.
// Summing across semesters would report 180/300 and flag every correct
// multi-semester РПД.

// Re-exported so existing importers keep working; see config/brs.ts for why
// the numbers live there.
export { BRS_SEMESTER_MIN, BRS_SEMESTER_MAX }

interface RawFosScores {
  rows?: { name?: string; semester?: string | null; count?: number | string | null;
           min_points?: number | string | null; max_points?: number | string | null }[]
  criteria?: { instrument?: string; declared_min?: number | string | null; declared_max?: number | string | null;
               components?: { min?: number | string | null; max?: number | string | null }[] }[]
}

export interface ParsedFosNumbers {
  rows:     FosScoreRow[] | null
  criteria: FosCriteriaBlock[]
}

/** Extracts BOTH numeric layers of the ФОС in one pass — the «Перечень
 *  оценочных средств» table and each instrument's «Критерии оценки» block.
 *  One call rather than two because they read the same document and the
 *  linkage check already costs an LLM pass for §9.
 *
 *  `rows` is null when the document has no перечень table at all — distinct
 *  from "found it and it was empty", so the caller can say which case applies
 *  instead of reporting a clean result for a ФОС that isn't laid out to the
 *  макет. */
export async function parseFosNumbers(
  teacherId: string, fosText: string,
): Promise<ParsedFosNumbers> {
  const empty: ParsedFosNumbers = { rows: null, criteria: [] }
  const text = (fosText ?? '').trim()
  if (text.length < 40) return empty

  const system =
    'Вы — методист российского вуза. Вы извлекаете из фонда оценочных средств (ФОС) таблицу ' +
    '«Перечень оценочных средств по дисциплине (модулю)». Берите числа из таблицы, ничего не ' +
    'вычисляйте и не выдумывайте. Отвечайте только валидным JSON на русском языке.'

  const user =
    `## Текст ФОС\n${sanitiseForPrompt(text.slice(0, MAX_FOS_TEXT_CHARS))}\n\n` +
    `## Задача\nНайдите таблицу «Перечень оценочных средств по дисциплине (модулю)» со столбцами ` +
    `«Оценочные средства», «Кол-во», «Min, баллов (базовый уровень)», «Max, баллов (повышенный ` +
    `уровень)». Верните КАЖДУЮ её строку: {"name": дословное название, "semester": заголовок ` +
    `семестра, под которым идёт строка (например "1-й семестр"), или null если таблица не разбита ` +
    `по семестрам, "count": число из «Кол-во» или null, "min_points": число или null, ` +
    `"max_points": число или null}.\n` +
    `ВКЛЮЧИТЕ строки «Итого». Если такой таблицы в документе НЕТ — верните {"rows": []}.\n\n` +
    `2) "criteria" — блоки «Критерии оценки» по каждому оценочному средству. В макете они бывают ` +
    `в двух видах: таблицей («Виды работ | Минимальный балл | Максимальный балл» с итоговой строкой) ` +
    `и текстом («максимальная оценка за работу составляет 20 баллов, минимальная 10. Из них: ` +
    `Презентация работы – мах 3 балла; …»). Для КАЖДОГО блока верните: ` +
    `{"instrument": к какому оценочному средству относится блок, ` +
    `"declared_min"/"declared_max": ОБЩИЙ балл за это средство, если он назван в блоке (в тексте — ` +
    `«максимальная оценка за работу составляет N», в таблице — строка «ИТОГО»), иначе null, ` +
    `"components": массив ОТДЕЛЬНЫХ составляющих {"min": число или null, "max": число или null} — ` +
    `строки таблицы кроме «ИТОГО», либо перечисленные после «Из них:» пункты}. ` +
    `ВАЖНО: общий балл НЕ включайте в "components" — иначе он посчитается дважды. ` +
    `Если блоков «Критерии оценки» нет — верните "criteria": [].\n\n` +
    `## Формат\nВерните JSON: {"rows":[...],"criteria":[...]}. Только JSON.`

  const raw = await chatJSON<RawFosScores>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'перечень оценочных средств ФОС',
    { context: { teacherId, feature: 'grading' }, temperature: 0 },
  )

  const num = (x: unknown): number | null => {
    if (x == null || x === '') return null
    const n = Number(x)
    return Number.isFinite(n) ? n : null
  }
  const rows = (raw.rows ?? [])
    .map((r) => ({
      name:       String(r.name ?? '').trim(),
      semester:   String(r.semester ?? '').trim() || null,
      count:      num(r.count),
      min_points: num(r.min_points),
      max_points: num(r.max_points),
    }))
    .filter((r) => r.name)

  // A component list that itemises nothing is not a sum of zero — it means the
  // block wasn't itemised, and summing it would invent a 0/0 mismatch.
  const sum = (xs: (number | null)[]): number | null => {
    const known = xs.filter((n): n is number => n != null)
    return known.length > 0 ? known.reduce((a, b) => a + b, 0) : null
  }

  const criteria: FosCriteriaBlock[] = (raw.criteria ?? [])
    .map((b) => {
      const parts = b.components ?? []
      return {
        instrument:    String(b.instrument ?? '').trim(),
        declared_min:  num(b.declared_min),
        declared_max:  num(b.declared_max),
        component_min: sum(parts.map((p) => num(p.min))),
        component_max: sum(parts.map((p) => num(p.max))),
      }
    })
    .filter((b) => b.instrument)

  return { rows: rows.length > 0 ? rows : null, criteria }
}

const semKey = (s: string | null) => (s ?? '').trim().toLowerCase() || '—'
const semLabel = (s: string | null) => (s && s.trim()) || 'без разбивки по семестрам'
const fmt = (n: number | null) => (n == null ? '—' : String(n))

/**
 * Reconciles the ФОС score table against §9. Pure — no I/O, no model.
 * Both sides are grouped by semester first; comparison never crosses a
 * semester boundary.
 */
export function checkFosScores(
  brsItems: BrsScoreRow[],
  fosRows: FosScoreRow[] | null,
  criteriaBlocks: FosCriteriaBlock[] = [],
): FosScoreCheck {
  if (!fosRows) {
    return {
      table_found: false, rows: [], criteria: criteriaBlocks, findings: [],
      summary: 'В ФОС не найдена таблица «Перечень оценочных средств» — сверить баллы с п.9 не с чем.',
    }
  }

  const findings: FosScoreFinding[] = []
  const rpd = brsItems.filter((b) => !isTotalRow(b.name))
  const fos = fosRows.filter((r) => !isTotalRow(r.name))

  // 1) Every §9 instrument must appear in the ФОС table with the same numbers.
  for (const b of rpd) {
    const match = fos.find(
      (r) => semKey(r.semester) === semKey(b.semester) &&
             (mentions(r.name, b.name) || mentions(b.name, r.name)),
    )
    if (!match) {
      findings.push({
        kind: 'missing_in_fos', instrument: b.name, semester: b.semester,
        rpd_min: b.min_points, rpd_max: b.max_points, fos_min: null, fos_max: null,
        detail: `«${b.name}» есть в п.9 РПД (${fmt(b.min_points)}–${fmt(b.max_points)} баллов), ` +
                `но в перечне оценочных средств ФОС (${semLabel(b.semester)}) такой строки нет.`,
        recommendation: `Добавьте «${b.name}» в перечень ФОС с теми же баллами, что в п.9 РПД.`,
      })
      continue
    }
    if (b.min_points != null && match.min_points != null && b.min_points !== match.min_points) {
      findings.push({
        kind: 'min_mismatch', instrument: b.name, semester: b.semester,
        rpd_min: b.min_points, rpd_max: b.max_points,
        fos_min: match.min_points, fos_max: match.max_points,
        detail: `«${b.name}» (${semLabel(b.semester)}): минимальный балл в ФОС — ${match.min_points}, ` +
                `в п.9 РПД — ${b.min_points}.`,
        recommendation: `Приведите минимальный балл в соответствие с п.9 РПД (${b.min_points}) — ` +
                        `по макету перечень ФОС берётся из п.9.`,
      })
    }
    if (b.max_points != null && match.max_points != null && b.max_points !== match.max_points) {
      findings.push({
        kind: 'max_mismatch', instrument: b.name, semester: b.semester,
        rpd_min: b.min_points, rpd_max: b.max_points,
        fos_min: match.min_points, fos_max: match.max_points,
        detail: `«${b.name}» (${semLabel(b.semester)}): максимальный балл в ФОС — ${match.max_points}, ` +
                `в п.9 РПД — ${b.max_points}.`,
        recommendation: `Приведите максимальный балл в соответствие с п.9 РПД (${b.max_points}) — ` +
                        `по макету перечень ФОС берётся из п.9.`,
      })
    }
  }

  // 2) …and nothing extra, which would mean points the РПД never budgeted.
  for (const r of fos) {
    const match = rpd.find(
      (b) => semKey(b.semester) === semKey(r.semester) &&
             (mentions(r.name, b.name) || mentions(b.name, r.name)),
    )
    if (!match) {
      findings.push({
        kind: 'missing_in_rpd', instrument: r.name, semester: r.semester,
        rpd_min: null, rpd_max: null, fos_min: r.min_points, fos_max: r.max_points,
        detail: `«${r.name}» есть в перечне ФОС (${semLabel(r.semester)}), но в п.9 РПД такой ` +
                `контрольной точки нет — баллы за неё нигде не заложены.`,
        recommendation: `Добавьте «${r.name}» в п.9 РПД с баллами либо уберите его из перечня ФОС.`,
      })
    }
  }

  // 3) Each semester must total 60/100 (КНИТУ положение о БРС).
  const semesters = [...new Set(fos.map((r) => semKey(r.semester)))]
  for (const key of semesters) {
    const inSem = fos.filter((r) => semKey(r.semester) === key)
    const label = semLabel(inSem[0]?.semester ?? null)
    const sumMin = inSem.reduce((n, r) => n + (r.min_points ?? 0), 0)
    const sumMax = inSem.reduce((n, r) => n + (r.max_points ?? 0), 0)
    if (sumMin !== BRS_SEMESTER_MIN || sumMax !== BRS_SEMESTER_MAX) {
      findings.push({
        kind: 'total_mismatch', instrument: null, semester: inSem[0]?.semester ?? null,
        rpd_min: null, rpd_max: null, fos_min: sumMin, fos_max: sumMax,
        detail: `${label}: сумма баллов в перечне ФОС — ${sumMin}/${sumMax}, ` +
                `а по положению о БРС должна быть ${BRS_SEMESTER_MIN}/${BRS_SEMESTER_MAX}.`,
        recommendation: `Проверьте баллы по строкам: за семестр должно набираться ровно ` +
                        `${BRS_SEMESTER_MIN} минимальных и ${BRS_SEMESTER_MAX} максимальных баллов.`,
      })
    }
  }

  // 4) Each «Критерии оценки» block must add up to what it declares, and what
  // it declares must be the instrument's row in the перечень — the third link
  // in the chain §9 → перечень ФОС → критерии. In the макет the лабораторная
  // criteria table sums to 12/20, exactly its перечень row.
  for (const block of criteriaBlocks) {
    if (block.component_min != null && block.declared_min != null &&
        block.component_min !== block.declared_min) {
      findings.push({
        kind: 'criteria_sum_mismatch', instrument: block.instrument, semester: null,
        rpd_min: block.declared_min, rpd_max: block.declared_max,
        fos_min: block.component_min, fos_max: block.component_max,
        detail: `«${block.instrument}»: в критериях оценки заявлен минимум ${block.declared_min} баллов, ` +
                `а составляющие дают в сумме ${block.component_min}.`,
        recommendation: `Проверьте распределение минимальных баллов по пунктам критериев — ` +
                        `сумма должна совпадать с заявленным минимумом.`,
      })
    }
    if (block.component_max != null && block.declared_max != null &&
        block.component_max !== block.declared_max) {
      findings.push({
        kind: 'criteria_sum_mismatch', instrument: block.instrument, semester: null,
        rpd_min: block.declared_min, rpd_max: block.declared_max,
        fos_min: block.component_min, fos_max: block.component_max,
        detail: `«${block.instrument}»: в критериях оценки заявлен максимум ${block.declared_max} баллов, ` +
                `а составляющие дают в сумме ${block.component_max}.`,
        recommendation: `Проверьте распределение максимальных баллов по пунктам критериев — ` +
                        `сумма должна совпадать с заявленным максимумом.`,
      })
    }

    // …and the block's own total against the перечень row it belongs to.
    // Matched across every semester: a criteria block is written once for the
    // instrument, not per semester, so it is compared against any row that
    // names it.
    const rowsFor = fos.filter(
      (r) => mentions(r.name, block.instrument) || mentions(block.instrument, r.name),
    )
    if (rowsFor.length === 0) continue
    // Only meaningful when every row agrees — an instrument carrying different
    // points in different semesters has no single total to check against.
    const uniqMin = [...new Set(rowsFor.map((r) => r.min_points))]
    const uniqMax = [...new Set(rowsFor.map((r) => r.max_points))]

    if (block.declared_min != null && uniqMin.length === 1 && uniqMin[0] != null &&
        uniqMin[0] !== block.declared_min) {
      findings.push({
        kind: 'criteria_table_mismatch', instrument: block.instrument, semester: null,
        rpd_min: uniqMin[0], rpd_max: uniqMax.length === 1 ? uniqMax[0] : null,
        fos_min: block.declared_min, fos_max: block.declared_max,
        detail: `«${block.instrument}»: в критериях оценки минимум ${block.declared_min} баллов, ` +
                `а в перечне оценочных средств — ${uniqMin[0]}.`,
        recommendation: `Приведите критерии оценки и перечень к одним и тем же баллам — ` +
                        `по макету перечень берётся из п.9 РПД.`,
      })
    }
    if (block.declared_max != null && uniqMax.length === 1 && uniqMax[0] != null &&
        uniqMax[0] !== block.declared_max) {
      findings.push({
        kind: 'criteria_table_mismatch', instrument: block.instrument, semester: null,
        rpd_min: uniqMin.length === 1 ? uniqMin[0] : null, rpd_max: uniqMax[0],
        fos_min: block.declared_min, fos_max: block.declared_max,
        detail: `«${block.instrument}»: в критериях оценки максимум ${block.declared_max} баллов, ` +
                `а в перечне оценочных средств — ${uniqMax[0]}.`,
        recommendation: `Приведите критерии оценки и перечень к одним и тем же баллам — ` +
                        `по макету перечень берётся из п.9 РПД.`,
      })
    }
  }

  return {
    table_found: true,
    rows: fosRows,
    criteria: criteriaBlocks,
    findings,
    summary: findings.length === 0
      ? `Баллы в перечне ФОС совпадают с п.9 РПД, по каждому семестру набирается ${BRS_SEMESTER_MIN}/${BRS_SEMESTER_MAX}.`
      : `Расхождений между перечнем ФОС и п.9 РПД: ${findings.length}.`,
  }
}

/**
 * The linkage check itself. Pure — no I/O, no model. Takes the parsed lists
 * and reports which of СРС / КСР / §9 / ФОС each оценочное средство is
 * missing from. `fosText` is the discipline's uploaded ФОС document, when
 * one exists — omit it (or pass null) to leave ФОС genuinely unverified
 * rather than silently treating "no ФОС uploaded" as "ФОС confirms nothing".
 */
export function checkAssessmentLinkage(
  parsed: ParsedAssessmentLinkage,
  fosText?: string | null,
  /** Pre-parsed ФОС numbers (parseFosNumbers). Passed in rather than fetched
   *  here so this function stays pure and synchronous — the same reason
   *  `fosText` is a parameter. */
  fosNumbers?: ParsedFosNumbers | null,
): AssessmentLinkageResult {
  const findings: AssessmentLinkageFinding[] = []
  const fosAvailable = !!fosText && fosText.trim().length >= 40
  const fosSearchText = fosAvailable ? fosText!.slice(0, MAX_FOS_TEXT_CHARS) : ''

  // De-dupe: the same instrument usually repeats across every раздел row of
  // the §4 table, and reporting «Доклад» five times would bury the signal.
  const seen = new Set<string>()

  for (const instrument of parsed.instruments) {
    const key = tokenize(instrument.name).join(' ')
    if (!key || seen.has(key)) continue
    seen.add(key)

    const isFinal = FINAL_ATTESTATION.test(instrument.name)
    const required: LinkageSlot[] = [...(isFinal ? [] : ['srs' as const, 'ksr' as const]), 'brs']
    if (fosAvailable) required.push('fos')

    const found: Record<LinkageSlot, string | null> = {
      srs: parsed.srs_forms.find((f) => mentions(f, instrument.name)) ?? null,
      ksr: parsed.ksr_forms.find((f) => mentions(f, instrument.name)) ?? null,
      brs: parsed.brs_items.find((b) => !isTotalRow(b.name) && mentions(b.name, instrument.name))?.name ?? null,
      fos: fosAvailable && mentions(fosSearchText, instrument.name) ? instrument.name : null,
    }

    // A БРС row with no points is only half a link — the instrument is named
    // but nothing is actually riding on it.
    const brsMatch = parsed.brs_items.find((b) => !isTotalRow(b.name) && mentions(b.name, instrument.name))
    const brsMissingPoints = !!brsMatch && brsMatch.max_points == null

    const missing = required.filter((slot) => !found[slot])
    if (missing.length === 0 && !brsMissingPoints) continue

    const parts: string[] = []
    if (missing.length > 0) {
      parts.push(`не найдено в ${missing.map((s) => SLOT_LABEL[s]).join(', ')}`)
    }
    if (brsMissingPoints) parts.push('в п.9 указано без баллов')

    findings.push({
      instrument:  instrument.name,
      section:     instrument.section,
      missing,
      brs_missing_points: brsMissingPoints,
      matched_srs: found.srs,
      matched_ksr: found.ksr,
      matched_brs: found.brs,
      matched_fos: found.fos,
      detail: `Оценочное средство «${instrument.name}» заявлено в п.4, но ${parts.join('; ')}.`,
      recommendation: buildRecommendation(instrument.name, missing, brsMissingPoints, isFinal, fosAvailable),
    })
  }

  return {
    parsed,
    fos_available: fosAvailable,
    // Only meaningful when a ФОС exists at all; omitted otherwise so the UI
    // can tell "no ФОС" from "ФОС has no score table".
    fos_scores: fosAvailable ? checkFosScores(parsed.brs_items, fosNumbers?.rows ?? null, fosNumbers?.criteria ?? []) : undefined,
    // Deterministic, so it runs off the same text with no extra model call.
    fos_structure: fosAvailable ? checkFosStructure(fosText, parsed.brs_items) : undefined,
    // Always present — «is §9 itself fit to build a ФОС from» is worth
    // answering long before a ФОС exists.
    brs_readiness: checkBrsReadiness(parsed.brs_items),
    findings,
    summary: summarise(parsed, findings, fosAvailable),
    generated_at: new Date().toISOString(),
  }
}

// The instrument name is always quoted in the nominative, never bent into a
// genitive slot: «Доклад» would have to become «доклада», and «Контрольная
// работа» → «контрольной работы» — Russian declension we cannot generate
// correctly from a bare noun phrase, and a recommendation written in broken
// Russian undermines the finding it is trying to make. The pattern is shown
// with the методист's own canonical example instead.
function buildRecommendation(
  name: string, missing: LinkageSlot[], brsMissingPoints: boolean, isFinal: boolean, fosAvailable: boolean,
): string {
  const fixes: string[] = []
  if (missing.includes('srs')) {
    fixes.push('в СРС — форму подготовки к нему, чтобы у студента было заложено время')
  }
  if (missing.includes('ksr')) {
    fixes.push('в КСР — форму его контроля, чтобы работа преподавателя была учтена')
  }
  if (missing.includes('brs')) {
    fixes.push(`в п.9 — «${name}» с максимальным баллом`)
  } else if (brsMissingPoints) {
    fixes.push(`в п.9 у «${name}» — максимальный балл`)
  }
  if (missing.includes('fos')) {
    fixes.push(`в ФОС — «${name}», оформленный по положению вуза`)
  }

  const pattern = (missing.includes('srs') || missing.includes('ksr'))
    ? ' Образец связки: «ДОКЛАД» в п.4 → «ПОДГОТОВКА ДОКЛАДА» в СРС → «ЗАСЛУШИВАНИЕ ДОКЛАДА» в КСР → «ДОКЛАД» с баллами в п.9 → «ДОКЛАД» в ФОС.'
    : ''
  const tail = isFinal
    ? ' Промежуточная аттестация проверяется только по п.9 — форма в СРС/КСР для неё не требуется.'
    : ''
  // Only tell the reader to check the ФОС by hand when we genuinely
  // couldn't — if a ФОС was uploaded and searched, that instruction would
  // be redundant with (or contradict) the 'fos' entry in `missing` above.
  const fosReminder = fosAvailable
    ? ''
    : ` Также убедитесь, что «${name}» есть в ФОС и оформлено по положению вуза — ФОС не был загружен для этой дисциплины, автоматически он не проверяется.`

  return `Для «${name}» добавьте ${fixes.join('; ')}.${pattern}${fosReminder}${tail}`
}

function summarise(parsed: ParsedAssessmentLinkage, findings: AssessmentLinkageFinding[], fosAvailable: boolean): string {
  if (parsed.instruments.length === 0) {
    return 'В п.4 не найдено оценочных средств — проверьте, заполнен ли последний столбец таблицы «Структура и содержание дисциплины».'
  }
  const total = new Set(parsed.instruments.map((i) => tokenize(i.name).join(' '))).size
  const fosNote = fosAvailable
    ? ' Наличие в ФОС проверено по загруженному документу.'
    : ' ФОС для этой дисциплины не загружен — свяжите его с дисциплиной, чтобы проверять и этот пункт автоматически.'

  if (findings.length === 0) {
    const slots = fosAvailable ? 'СРС, КСР, п.9 и ФОС' : 'СРС, КСР и п.9'
    return `Все оценочные средства из п.4 (${total}) прослеживаются в ${slots}.${fosNote}`
  }
  return `Из ${total} оценочных средств п.4 у ${findings.length} нарушена связка.${fosNote}`
}
