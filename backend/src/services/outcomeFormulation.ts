import { normaliseText, tokenize, tokenContainment } from '../lib/ruText'
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

/** Shared tokenizer, minus the ЗУВ-specific leading verb frame. Stripped
 *  BEFORE tokenizing so the frame words can't survive as stems. */
export function contentTokens(s: string): string[] {
  const words = normaliseText(s).split(' ').filter(Boolean)
  let start = 0
  while (start < words.length && FRAME_PREFIX_TOKENS.has(words[start])) start++
  return tokenize(words.slice(start).join(' '))
}

/** ЗУВ-specific wrapper over ruText.ts's tokenContainment, comparing after
 *  the leading verb frame is stripped from both sides. */
export function containment(a: string, b: string): number {
  return tokenContainment(contentTokens(a), contentTokens(b))
}

const OUTCOME_LABEL: Record<OutcomeKind, string> = {
  knowledge: 'Знать', skill: 'Уметь', mastery: 'Владеть',
}

export { normaliseText }

export interface OutcomesInput { knowledge: string[]; skills: string[]; mastery: string[] }

// What a ЗУВ item gets compared against — deliberately NOT nested indicators
// alone. Found in production 2026-08-24, on the very РПД the методист was
// re-testing: a real КНИТУ programme lists its competencies FLAT at the
// indicator level (ОПК-4.1, ОПК-4.3, with no parent «ОПК-4» row carrying its
// own formulation), so the parser emits them as top-level `competencies` with
// an EMPTY `indicators` array. The old call site passed only
// `competencies.flatMap(c => c.indicators)` — an empty list — so this
// function returned [] on its first line and the copy went unflagged, while
// the coverage check happily scored the copied ЗУВ «Обеспечена 90%».
// Callers must pass every declared requirement that carries a formulation,
// whichever level of the hierarchy it sits at.
export interface DeclaredRequirementInput {
  code:   string
  title:  string
  /** Wording only ('повторяет индикатор' vs 'повторяет компетенцию'). */
  level?: 'competency' | 'indicator'
}

/**
 * Flags every «Знать/Уметь/Владеть» item that merely restates one of the
 * declared competencies or their indicators. Pure — no DB, no LLM, no I/O.
 */
export function findCopiedOutcomeFormulations(
  declared: DeclaredRequirementInput[],
  outcomes: OutcomesInput,
): OutcomeFormulationFinding[] {
  if (declared.length === 0) return []

  const findings: OutcomeFormulationFinding[] = []
  const buckets: { kind: OutcomeKind; items: string[] }[] = [
    { kind: 'knowledge', items: outcomes.knowledge },
    { kind: 'skill',     items: outcomes.skills },
    { kind: 'mastery',   items: outcomes.mastery },
  ]

  for (const { kind, items } of buckets) {
    for (const item of items) {
      if (contentTokens(item).length < MIN_CONTENT_TOKENS) continue

      // Best-matching requirement wins — an РПД that copied one indicator into
      // several ЗУВ lines should point at the one it actually came from.
      let best: { target: DeclaredRequirementInput; score: number } | null = null
      for (const target of declared) {
        if (contentTokens(target.title).length < MIN_CONTENT_TOKENS) continue
        const score = containment(item, target.title)
        if (!best || score > best.score) best = { target, score }
      }
      if (!best || best.score < COPY_CONTAINMENT_THRESHOLD) continue

      const verbatim = normaliseText(best.target.title).includes(normaliseText(item))
      const label    = OUTCOME_LABEL[kind]
      const code     = best.target.code || null
      // Name the source the way a методист would. The CODE decides, not the
      // parse position: ФГОС numbers indicators «ОПК-4.1» and competencies
      // «ОПК-4», and a РПД that lists indicators flat (no parent row) parses
      // them as top-level competencies — calling ОПК-4.1 «компетенцию» there
      // would read as wrong to the person the finding is written for.
      // `level` is only the fallback for a requirement with no code at all.
      const looksLikeIndicator = code ? /\d+\s*\.\s*\d+/.test(code) : best.target.level !== 'competency'
      // Russian declension differs by gender, so the noun carries its own
      // forms rather than being interpolated bare into three sentences.
      const src = looksLikeIndicator
        ? { acc: 'индикатор',   nom: 'индикатор',   gen: 'индикатора',  achieved: 'был достигнут'   }
        : { acc: 'компетенцию', nom: 'компетенция', gen: 'компетенции', achieved: 'была достигнута' }

      findings.push({
        kind:            'copied_from_indicator',
        outcome_kind:    kind,
        outcome_title:   item,
        indicator_code:  code,
        indicator_title: best.target.title,
        similarity:      Math.round(best.score * 100) / 100,
        detail: verbatim
          ? `Формулировка «${label}» дословно повторяет ${src.acc}${code ? ` ${code}` : ''}.`
          : `Формулировка «${label}» почти дословно повторяет ${src.acc}${code ? ` ${code}` : ''} (совпадение ${Math.round(best.score * 100)}%).`,
        recommendation:
          `Переформулируйте пункт «${label}» через содержание этой дисциплины: что именно студент должен ` +
          `${label === 'Знать' ? 'знать' : label === 'Уметь' ? 'уметь делать' : 'освоить на практике'} ` +
          `по её темам, чтобы ${src.nom}${code ? ` ${code}` : ''} ${src.achieved}. Смысл ${src.gen} сохраняется, ` +
          `но формулировка не должна совпадать с ним дословно.`,
      })
    }
  }

  return findings
}
