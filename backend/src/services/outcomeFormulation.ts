import type { OutcomeFormulationFinding, OutcomeKind } from '../../../shared/types'

// «Знать/Уметь/Владеть» formulation check — raised by a методист reviewing a
// real РПД (2026-08-20): the coverage check scored a discipline's ЗУВ items
// at 100% «Обеспечена» when they were nothing but the competency indicators
// copy-pasted verbatim. Her rule, stated precisely:
//
//   «Формулировки "должен знать/уметь/владеть" должны отражать смысл
//    индикатора и быть связаны с дисциплиной, но быть идентичными НЕ должны.»
//
// So a verbatim copy is a defect the report must surface, not a pass.
//
// DELIBERATELY DETERMINISTIC — no LLM call. "Is this text a copy of that
// text" is a measurable string question, not a judgement call: doing it in
// code makes it free, instant, reproducible run-to-run, and impossible to
// hallucinate. (Contrast with the coverage scoring itself, which is a real
// judgement and rightly goes to the model.)
//
// DELIBERATELY A SEPARATE FINDINGS LIST, not a demotion of the item's
// coverage status. "Does the content deliver this requirement?" and "is this
// requirement's wording copy-pasted?" are independent questions — a copied
// ЗУВ can still be genuinely delivered by the content, and it can equally be
// undelivered. Folding one into the other would make the covered/partial/
// missing counts mean two different things at once and destroy the coverage
// number's meaning. Same shape as the §2/§12 checks, which also carry their
// own findings lists alongside their verdicts.

// Below this many content tokens, overlap ratios stop being meaningful — a
// 3-word ЗУВ shares "most of its tokens" with almost anything on the same
// subject. Short items are left alone rather than flagged on noise.
const MIN_CONTENT_TOKENS = 4

// A ЗУВ item is a copy when nearly all of its content words also appear in
// the indicator. Set high on purpose: this finding accuses an author of
// copy-pasting, so it should fire on real copies (the observed case is a
// literal substring) and stay quiet on a genuine reformulation that happens
// to reuse the discipline's domain terms.
const COPY_CONTAINMENT_THRESHOLD = 0.9

// Leading "frame" words an indicator uses that a ЗУВ item conventionally
// drops («Знает и понимает X» → «X»). Stripped from the START of both sides
// before comparing — leaving them in would dilute the overlap ratio with
// tokens that are structurally absent from one side, hiding exactly the
// copies this check exists to catch.
const FRAME_PREFIX_TOKENS = new Set([
  'знает', 'знать', 'знание', 'знания', 'понимает', 'понимать',
  'умеет', 'уметь', 'умение', 'умения',
  'владеет', 'владеть', 'владение', 'навыками', 'навыки', 'навык',
  'способен', 'способность', 'демонстрирует', 'применяет', 'использует', 'и',
])

// Function words carry no subject matter — including them would inflate the
// overlap between any two Russian sentences of similar shape.
const STOPWORDS = new Set([
  'и', 'в', 'во', 'на', 'с', 'со', 'для', 'по', 'при', 'к', 'ко', 'от', 'из',
  'о', 'об', 'а', 'но', 'или', 'же', 'как', 'что', 'том', 'числе', 'т', 'ч',
  'также', 'их', 'его', 'её', 'ее', 'а также',
])

/** Lowercase, ё→е, drop punctuation, collapse whitespace. */
export function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Russian inflectional endings, longest first. Lifting a phrase out of an
// indicator and into a «Знать:» list changes its grammatical frame, so the
// case endings shift even when nothing else does («производство процессов» →
// «производства процессов»). Without this, that trivially-reworded copy —
// the «почти дословно» half of what the методист described — scores well
// below the threshold and slips through, while the exact copy is caught.
// A crude suffix strip, not a real morphological analyser: it only needs to
// make two inflections of the same word compare equal, and a stem floor
// keeps it from collapsing genuinely distinct short words.
const RU_ENDINGS = [
  'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ией',
  'их', 'ых', 'ую', 'юю', 'ою', 'ею', 'ии', 'ия', 'ью',
  'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ой', 'ей', 'ый', 'ий', 'ом', 'ем',
  'ах', 'ях', 'ов', 'ев', 'ам', 'ям',
  'ы', 'и', 'а', 'я', 'о', 'е', 'у', 'ю', 'й', 'ь',
]
const MIN_STEM_LENGTH = 4

function stem(token: string): string {
  for (const ending of RU_ENDINGS) {
    if (token.length - ending.length >= MIN_STEM_LENGTH && token.endsWith(ending)) {
      return token.slice(0, -ending.length)
    }
  }
  return token
}

/** Normalised, stemmed tokens with the leading frame words and stopwords removed. */
export function contentTokens(s: string): string[] {
  const tokens = normaliseText(s).split(' ').filter(Boolean)
  let start = 0
  while (start < tokens.length && FRAME_PREFIX_TOKENS.has(tokens[start])) start++
  return tokens.slice(start).filter((t) => !STOPWORDS.has(t)).map(stem)
}

/**
 * How much of the SHORTER item's vocabulary the longer one already contains
 * (0–1). Containment rather than a symmetric measure (Jaccard/Dice) because
 * the observed defect is asymmetric: the ЗУВ item is the indicator with its
 * verb prefix chopped off, so it's a near-subset of a longer string, and a
 * symmetric score would be dragged down by the indicator's extra words.
 */
export function containment(a: string, b: string): number {
  const setA = new Set(contentTokens(a))
  const setB = new Set(contentTokens(b))
  if (setA.size === 0 || setB.size === 0) return 0
  let shared = 0
  for (const t of setA) if (setB.has(t)) shared++
  return shared / Math.min(setA.size, setB.size)
}

const OUTCOME_LABEL: Record<OutcomeKind, string> = {
  knowledge: 'Знать', skill: 'Уметь', mastery: 'Владеть',
}

export interface IndicatorInput { code: string; title: string }
export interface OutcomesInput { knowledge: string[]; skills: string[]; mastery: string[] }

/**
 * Flags every «Знать/Уметь/Владеть» item that merely restates one of the
 * declared competency indicators. Pure — no DB, no LLM, no I/O.
 */
export function findCopiedOutcomeFormulations(
  indicators: IndicatorInput[],
  outcomes: OutcomesInput,
): OutcomeFormulationFinding[] {
  if (indicators.length === 0) return []

  const findings: OutcomeFormulationFinding[] = []
  const buckets: { kind: OutcomeKind; items: string[] }[] = [
    { kind: 'knowledge', items: outcomes.knowledge },
    { kind: 'skill',     items: outcomes.skills },
    { kind: 'mastery',   items: outcomes.mastery },
  ]

  for (const { kind, items } of buckets) {
    for (const item of items) {
      if (contentTokens(item).length < MIN_CONTENT_TOKENS) continue

      // Best-matching indicator wins — an РПД that copied one indicator into
      // several ЗУВ lines should point at the one it actually came from.
      let best: { indicator: IndicatorInput; score: number } | null = null
      for (const indicator of indicators) {
        if (contentTokens(indicator.title).length < MIN_CONTENT_TOKENS) continue
        const score = containment(item, indicator.title)
        if (!best || score > best.score) best = { indicator, score }
      }
      if (!best || best.score < COPY_CONTAINMENT_THRESHOLD) continue

      const verbatim = normaliseText(best.indicator.title).includes(normaliseText(item))
      const label    = OUTCOME_LABEL[kind]
      const code     = best.indicator.code || null

      findings.push({
        kind:            'copied_from_indicator',
        outcome_kind:    kind,
        outcome_title:   item,
        indicator_code:  code,
        indicator_title: best.indicator.title,
        similarity:      Math.round(best.score * 100) / 100,
        detail: verbatim
          ? `Формулировка «${label}» дословно повторяет индикатор${code ? ` ${code}` : ''}.`
          : `Формулировка «${label}» почти дословно повторяет индикатор${code ? ` ${code}` : ''} (совпадение ${Math.round(best.score * 100)}%).`,
        recommendation:
          `Переформулируйте пункт «${label}» через содержание этой дисциплины: что именно студент должен ` +
          `${label === 'Знать' ? 'знать' : label === 'Уметь' ? 'уметь делать' : 'освоить на практике'} ` +
          `по её темам, чтобы индикатор${code ? ` ${code}` : ''} был достигнут. Смысл индикатора сохраняется, ` +
          `но формулировка не должна совпадать с ним дословно.`,
      })
    }
  }

  return findings
}
