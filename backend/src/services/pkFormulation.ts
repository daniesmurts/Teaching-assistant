import { normaliseText, tokenize, tokenContainment } from '../lib/ruText'
import type { PkFormulationFinding } from '../../../shared/types'

// ПК formulation copy-check (методист feedback item 3, migration 115) — same
// defect class as services/outcomeFormulation.ts's ЗУВ-copy check, one level
// up the hierarchy: when a вуз authors an ОП's ПК competency (and its
// ПК-N.1/.2/.3 indicators), the wording should express the MEANING of the
// linked ОТФ (обобщённая трудовая функция) it was derived from — never copy
// it verbatim. Her rule, restated at this level:
//
//   «...на основании неё формулирует ПК-компетенции и индикаторы. Опять же,
//    эти формулировки не должны быть идентичными.»
//
// DELIBERATELY DETERMINISTIC, same reasoning as outcomeFormulation.ts's
// header: "is this text a copy of that text" is a measurable string
// question, not a judgement call. Reuses ruText.ts's tokenContainment (now a
// two-consumer shared helper) rather than duplicating outcomeFormulation.ts's
// private copy of it.

const MIN_CONTENT_TOKENS = 4
const COPY_CONTAINMENT_THRESHOLD = 0.9

// ОТФ formulations conventionally lead with a gerund-noun frame
// («Выполнение...», «Осуществление...», «Организация...», «Разработка...»)
// that a well-written ПК naturally drops when restating the same activity as
// a competency ("способен выполнять..."). Left in, these would dilute the
// overlap ratio with tokens structurally absent from the ПК side — the
// opposite problem from outcomeFormulation.ts's FRAME_PREFIX_TOKENS, but the
// same fix.
const OTF_FRAME_PREFIX_TOKENS = new Set([
  'выполнение', 'осуществление', 'организация', 'разработка', 'проведение',
  'обеспечение', 'реализация', 'контроль', 'управление', 'координация', 'и',
])

function otfTokens(s: string): string[] {
  const words = normaliseText(s).split(' ').filter(Boolean)
  let start = 0
  while (start < words.length && OTF_FRAME_PREFIX_TOKENS.has(words[start])) start++
  return tokenize(words.slice(start).join(' '))
}

export interface PkCompetencyInput {
  code:        string | null
  title:       string
  indicators:  { code: string; title: string }[]
  otf:         { otf_code: string; name: string } | null
}

/**
 * Flags every ПК title or indicator that merely restates its linked ОТФ's
 * wording. Pure — no DB, no LLM, no I/O. Competencies with no linked ОТФ
 * (profstandard_otf_id unset) are silently skipped — nothing to compare
 * against, not a finding.
 */
export function findCopiedPkFormulations(competencies: PkCompetencyInput[]): PkFormulationFinding[] {
  const findings: PkFormulationFinding[] = []

  for (const c of competencies) {
    if (!c.otf) continue
    const otfWords = otfTokens(c.otf.name)
    if (otfWords.length < MIN_CONTENT_TOKENS) continue

    const candidates: { indicatorCode: string | null; title: string }[] = [
      { indicatorCode: null, title: c.title },
      ...c.indicators.map((i) => ({ indicatorCode: i.code, title: i.title })),
    ]

    for (const { indicatorCode, title } of candidates) {
      const words = otfTokens(title)
      if (words.length < MIN_CONTENT_TOKENS) continue

      const score = tokenContainment(words, otfWords)
      if (score < COPY_CONTAINMENT_THRESHOLD) continue

      const verbatim = normaliseText(c.otf.name).includes(normaliseText(title))
      const what = indicatorCode ? `Индикатор ${indicatorCode}` : `Формулировка ${c.code ?? 'ПК'}`

      findings.push({
        competency_code:  c.code,
        competency_title: c.title,
        indicator_code:   indicatorCode,
        otf_code:         c.otf.otf_code,
        otf_name:         c.otf.name,
        similarity:       Math.round(score * 100) / 100,
        detail: verbatim
          ? `${what} дословно повторяет ОТФ ${c.otf.otf_code}.`
          : `${what} почти дословно повторяет ОТФ ${c.otf.otf_code} (совпадение ${Math.round(score * 100)}%).`,
        recommendation:
          `Переформулируйте через содержание программы: что именно выпускник должен уметь делать, ` +
          `чтобы ОТФ ${c.otf.otf_code} была достигнута. Смысл ОТФ сохраняется, но формулировка не должна ` +
          `совпадать с ней дословно.`,
      })
    }
  }

  return findings
}
