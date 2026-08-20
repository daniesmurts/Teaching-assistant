import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { tokenize } from '../lib/ruText'
import type {
  AssessmentLinkageResult, AssessmentLinkageFinding, LinkageSlot,
  ParsedAssessmentLinkage,
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

const MAX_TEXT_CHARS = 14000
const MAX_FOS_TEXT_CHARS = 40000   // ФОС files run long (question banks, rubrics) — search, don't summarise

// «Экзамен»/«зачёт» are промежуточная аттестация, not текущий контроль. They
// legitimately carry points in §9 but have no «заслушивание» in КСР, and
// requiring one would generate a false finding on every correct РПД. They're
// still linkage-checked, just against §9 alone.
const FINAL_ATTESTATION = /экзамен|зач[еёе]т/i

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
  brs_items?:   { name?: string; points?: number | string | null }[]
}

export async function parseAssessmentLinkage(
  teacherId: string, text: string
): Promise<ParsedAssessmentLinkage> {
  const system =
    'Вы — методист российского вуза. Вы извлекаете из текста рабочей программы дисциплины (РПД) ' +
    'оценочные средства и формы работы. Берите формулировки из текста дословно, ничего не выдумывайте. ' +
    'Отвечайте только валидным JSON на русском языке.'

  const user =
    `## Текст РПД\n${sanitiseForPrompt(text.slice(0, MAX_TEXT_CHARS))}\n\n` +
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
    `4) "brs_items" — контрольные точки балльно-рейтинговой системы (обычно п.9): ` +
    `{"name": дословное название, "points": максимальный балл числом, или null если балл не указан}.\n\n` +
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

  return {
    instruments: (raw.instruments ?? [])
      .map((i) => ({ name: String(i.name ?? '').trim(), section: String(i.section ?? '').trim() || null }))
      .filter((i) => i.name),
    srs_forms: strArr(raw.srs_forms),
    ksr_forms: strArr(raw.ksr_forms),
    brs_items: (raw.brs_items ?? [])
      .map((b) => ({
        name: String(b.name ?? '').trim(),
        points: b.points == null || b.points === '' ? null : Number(b.points),
      }))
      .filter((b) => b.name)
      .map((b) => ({ ...b, points: Number.isFinite(b.points as number) ? b.points : null })),
  }
}

/**
 * Is this instrument referenced by that phrase? True when every content stem
 * of the instrument name appears in the phrase — «Доклад» matches «Подготовка
 * доклада», and «Контрольная работа» matches «Проверка контрольных работ»,
 * while «Доклад» does not match «Лабораторная работа». Exported for tests.
 */
export function mentions(phrase: string, instrument: string): boolean {
  const needle = tokenize(instrument)
  if (needle.length === 0) return false
  const hay = new Set(tokenize(phrase))
  return needle.every((t) => hay.has(t))
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
      brs: parsed.brs_items.find((b) => mentions(b.name, instrument.name))?.name ?? null,
      fos: fosAvailable && mentions(fosSearchText, instrument.name) ? instrument.name : null,
    }

    // A БРС row with no points is only half a link — the instrument is named
    // but nothing is actually riding on it.
    const brsMatch = parsed.brs_items.find((b) => mentions(b.name, instrument.name))
    const brsMissingPoints = !!brsMatch && brsMatch.points == null

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
