import { normaliseText, mentions, isTotalRow } from '../lib/ruText'
import type {
  BrsScoreRow, FosSectionKey, FosStructureCheck, FosStructureFinding,
} from '../../../shared/types'

// «Правильность оформления в ФОСе по макету» — asked for by a методист
// 2026-08-25 alongside the score reconciliation, with КНИТУ's «Макет ФОС 3++»
// attached. The макет prescribes a fixed skeleton, so this is a string
// question and stays deterministic — same call as services/
// outcomeFormulation.ts, and the opposite of services/outcomeMeaning.ts,
// where a judgement genuinely needed a model.
//
// SCOPE — presence of the blocks the макет requires, not their contents.
// Whether «Шкала оценивания» holds the right thresholds, or whether a
// комплект заданий is any good, is a different (and much harder) question
// this check deliberately does not pretend to answer.
//
// «СОГЛАСОВАНО» is NOT checked, on the макет's own instruction: «Пункт
// согласовано в ФОС включают только те кафедры, которые разрабатывают ФОС для
// других кафедр». Requiring it would fire on every ФОС written by the kafedra
// that teaches the discipline — the normal case.
//
// Point breakdowns in the макет («например, максимальное количество баллов за
// деловую (ролевую) игру 20…») are ILLUSTRATIONS, not norms — each кафедра
// sets its own per положение о БРС — so nothing here treats them as required
// values. The one number that is a real invariant (60/100 per semester) is
// checked in assessmentLinkage.ts against §9, where it belongs.

// A «Критерии оценки» heading names its instrument in one of two places, and
// the макет uses both: either in the heading itself («Критерии оценки
// лабораторных работ») or only in the block above it («Темы эссе (рефератов,
// докладов, сообщений)» → the list → a bare «Критерии оценки:»). So the
// window looks both ways — back a section's length, forward just far enough
// to cover the rest of the heading without swallowing the next block.
const CRITERIA_LOOKBACK_CHARS = 2500
const CRITERIA_LOOKAHEAD_CHARS = 200

// Below this there is no document to speak of — same noise floor the linkage
// check uses for ФОС text.
const MIN_TEXT_CHARS = 40

interface SectionSpec {
  key:      FosSectionKey
  label:    string
  /** ANY match counts as present — alternatives, not additional requirements. */
  patterns: RegExp[]
  fix:      string
}

// Patterns run against NORMALISED text (lowercased, ё→е, punctuation stripped,
// whitespace collapsed), so they carry no punctuation or case of their own.
const SECTIONS: SectionSpec[] = [
  {
    key: 'title_page', label: 'Титульный лист',
    patterns: [/фонд оценочных средств/],
    fix: 'Добавьте титульный лист по форме макета: «ФОНД ОЦЕНОЧНЫХ СРЕДСТВ» по дисциплине (модулю), направление, профиль, квалификация.',
  },
  {
    key: 'compiler', label: 'Составитель ФОС',
    patterns: [/составитель фос/, /составитель фонда/],
    fix: 'Добавьте на оборотной стороне титульного листа блок «Составитель ФОС» с должностью, подписью и Ф.И.О.',
  },
  {
    key: 'department_minutes', label: 'Рассмотрение на заседании кафедры',
    patterns: [/заседании кафедры/, /протокол от/],
    fix: 'Добавьте запись «ФОС рассмотрен и одобрен на заседании кафедры, протокол от … № …» с подписью зав. кафедрой.',
  },
  {
    key: 'approved', label: 'Гриф УТВЕРЖДЕНО',
    patterns: [/утверждено/],
    fix: 'Добавьте гриф «УТВЕРЖДЕНО» (начальник УМЦ / зав. магистратурой) по форме макета.',
  },
  {
    key: 'competency_map', label: 'Перечень компетенций и индикаторов с этапами формирования',
    patterns: [/перечень компетенций/, /индикаторов достижения компетенц/, /этапы формирования/],
    fix: 'Добавьте таблицу «Перечень компетенций и индикаторов достижения компетенций с указанием этапов формирования» — индикатор × темы (лекции / практические / лабораторные / курсовой проект) × наименование оценочного средства.',
  },
  {
    key: 'score_table', label: 'Перечень оценочных средств с баллами',
    patterns: [/перечень оценочных средств/],
    fix: 'Добавьте таблицу «Перечень оценочных средств по дисциплине (модулю)» со столбцами «Кол-во», «Min, баллов (базовый уровень)», «Max, баллов (повышенный уровень)» — по макету она приводится из п.9 РПД.',
  },
  {
    key: 'grading_scale', label: 'Шкала оценивания',
    patterns: [/шкала оценивания/],
    fix: 'Добавьте таблицу «Шкала оценивания»: цифровое выражение, выражение в баллах, словесное выражение и критерии оценки при экзамене / зачёте.',
  },
  {
    key: 'instrument_catalogue', label: 'Краткая характеристика оценочных средств',
    patterns: [/краткая характеристика оценочных средств/, /краткая характеристика оценочного средства/],
    fix: 'Добавьте таблицу «Краткая характеристика оценочных средств» — наименование, характеристика и представление оценочного средства в фонде.',
  },
]

// NOT `\w` — it is ASCII-only in JavaScript, so /критери\w* оценки/ never
// matched a single Cyrillic heading. Same trap as `\b` in lib/ruText.ts's
// total-row guard; caught here by the макет failing its own check.
const CRITERIA_MARKER = /критери[а-яё]* оценки/g

/** Every distinct instrument §9 budgets points for — «Итого» rows excluded,
 *  deduped the same way the linkage check dedupes its §4 list. */
function distinctInstruments(brsItems: BrsScoreRow[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const b of brsItems) {
    if (isTotalRow(b.name)) continue
    const key = b.name.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(b.name)
  }
  return out
}

/**
 * Checks a ФОС against the макет's required skeleton, plus that every
 * instrument the РПД budgets points for actually has «Критерии оценки» in the
 * fund. Pure — no I/O, no model.
 *
 * `brsItems` comes from the §9 parse the linkage check already ran; pass an
 * empty array to check the skeleton alone.
 */
export function checkFosStructure(
  fosText: string | null | undefined,
  brsItems: BrsScoreRow[] = [],
): FosStructureCheck {
  const raw = (fosText ?? '').trim()
  if (raw.length < MIN_TEXT_CHARS) {
    return {
      checked: false, present: [], findings: [],
      summary: 'ФОС не загружен — соответствие макету не проверялось.',
    }
  }

  const hay = normaliseText(raw)
  const findings: FosStructureFinding[] = []
  const present: FosSectionKey[] = []

  for (const s of SECTIONS) {
    if (s.patterns.some((re) => re.test(hay))) {
      present.push(s.key)
      continue
    }
    findings.push({
      kind: 'missing_section', section: s.key, instrument: null,
      detail: `В ФОС не найден обязательный по макету раздел «${s.label}».`,
      recommendation: s.fix,
    })
  }

  // Per-instrument criteria. Every оценочное средство that carries points has
  // to say how those points are awarded — the макет gives each instrument its
  // own «Критерии оценки» block.
  const criteriaPositions: number[] = []
  for (const m of hay.matchAll(CRITERIA_MARKER)) {
    if (m.index != null) criteriaPositions.push(m.index)
  }

  for (const instrument of distinctInstruments(brsItems)) {
    // A criteria heading belongs to this instrument when the text just before
    // it names the instrument — reuses the linkage check's stem-aware matcher,
    // so «Контрольная работа» is found in «контрольных работ» and a
    // comma-joined «Доклад, сообщение» matches either half.
    const hasCriteria = criteriaPositions.some((pos) =>
      mentions(
        hay.slice(Math.max(0, pos - CRITERIA_LOOKBACK_CHARS), pos + CRITERIA_LOOKAHEAD_CHARS),
        instrument,
      )
    )
    if (hasCriteria) continue
    findings.push({
      kind: 'missing_criteria', section: null, instrument,
      detail: `Для «${instrument}» в ФОС не найден блок «Критерии оценки», хотя в п.9 РПД за него начисляются баллы.`,
      recommendation: `Добавьте в ФОС раздел «Критерии оценки» для «${instrument}» с распределением баллов ` +
                      `(в соответствии с положением о БРС), как в макете.`,
    })
  }

  const missingSections = findings.filter((f) => f.kind === 'missing_section').length
  const missingCriteria = findings.filter((f) => f.kind === 'missing_criteria').length

  let summary: string
  if (findings.length === 0) {
    summary = 'ФОС содержит все обязательные по макету разделы, у каждого оценочного средства есть критерии оценки.'
  } else {
    const parts: string[] = []
    if (missingSections > 0) parts.push(`не найдено разделов: ${missingSections}`)
    if (missingCriteria > 0) parts.push(`оценочных средств без критериев оценки: ${missingCriteria}`)
    summary = `Отклонения от макета ФОС — ${parts.join('; ')}.`
  }

  return { checked: true, present, findings, summary }
}
