// Russian text normalisation shared by the deterministic РПД checks.
//
// Extracted from services/outcomeFormulation.ts once a second consumer
// appeared (services/assessmentLinkage.ts): both need to decide whether two
// Russian phrases refer to the same thing despite inflection — «доклад» vs
// «доклада» vs «подготовка доклада» — and neither is asking a question that
// warrants an LLM call.

/** Lowercase, ё→е, drop punctuation, collapse whitespace. */
export function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Russian inflectional endings, longest first. A crude suffix strip, not a
// morphological analyser: it only has to make two inflections of the same
// word compare equal. The stem floor stops it collapsing genuinely distinct
// short words.
const RU_ENDINGS = [
  'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ией',
  'их', 'ых', 'ую', 'юю', 'ою', 'ею', 'ии', 'ия', 'ью',
  'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ой', 'ей', 'ый', 'ий', 'ом', 'ем',
  'ах', 'ях', 'ов', 'ев', 'ам', 'ям',
  'ы', 'и', 'а', 'я', 'о', 'е', 'у', 'ю', 'й', 'ь',
]
const MIN_STEM_LENGTH = 4

export function stem(token: string): string {
  for (const ending of RU_ENDINGS) {
    if (token.length - ending.length >= MIN_STEM_LENGTH && token.endsWith(ending)) {
      return token.slice(0, -ending.length)
    }
  }
  return token
}

// Function words carry no subject matter — including them would inflate the
// overlap between any two Russian phrases of similar shape.
export const STOPWORDS = new Set([
  'и', 'в', 'во', 'на', 'с', 'со', 'для', 'по', 'при', 'к', 'ко', 'от', 'из',
  'о', 'об', 'а', 'но', 'или', 'же', 'как', 'что', 'том', 'числе', 'т', 'ч',
  'также', 'их', 'его', 'её', 'ее',
])

/** Normalised, stemmed, stopword-free tokens. */
export function tokenize(s: string): string[] {
  return normaliseText(s)
    .split(' ')
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t))
    .map(stem)
}

/**
 * How much of the SHORTER token set the longer one already contains (0–1).
 * Containment rather than a symmetric measure (Jaccard/Dice): the copy
 * defects this powers are asymmetric — a short reformulation is a near-
 * subset of a longer source phrase with its lead-in words chopped off, and
 * a symmetric score would be dragged down by the source's extra words.
 * Extracted from services/outcomeFormulation.ts once a second consumer
 * appeared (services/pkFormulation.ts) — same reasoning as this file's own
 * extraction above.
 */
export function tokenContainment(tokensA: string[], tokensB: string[]): number {
  const setA = new Set(tokensA)
  const setB = new Set(tokensB)
  if (setA.size === 0 || setB.size === 0) return 0
  let shared = 0
  for (const t of setA) if (setB.has(t)) shared++
  return shared / Math.min(setA.size, setB.size)
}

// Splits an instrument name on internal synonym separators — «Доклад,
// сообщение» names ONE assessment genre with two interchangeable words for
// it (a common РПД convention), not two co-required concepts, and «Деловая
// и/или ролевая игра» is explicit OR by its own wording. Found in production
// 2026-08-20: requiring every token of «Доклад, сообщение» together made
// «Подготовка доклада» fail to match (it has «доклад» but not «сообщение»)
// even though it is unambiguously preparation for that instrument.
const SYNONYM_SEPARATOR = /\s*,\s*|\s+и\s*\/\s*или\s+|\s+или\s+|\s*\/\s*/i

function nameAlternatives(name: string): string[] {
  const parts = name.split(SYNONYM_SEPARATOR).map((s) => s.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [name]
}

/**
 * Is this instrument referenced by that phrase? True when every content stem
 * of ANY ONE of the instrument's name alternatives appears in the phrase —
 * «Доклад» matches «Подготовка доклада», «Доклад, сообщение» also matches it
 * (via its «Доклад» alternative), and «Контрольная работа» matches «Проверка
 * контрольных работ», while «Доклад» does not match «Лабораторная работа».
 *
 * Lives here rather than in services/assessmentLinkage.ts since
 * services/fosStructure.ts became a second consumer — same reason
 * tokenContainment moved down here.
 */
export function mentions(phrase: string, instrument: string): boolean {
  const hay = new Set(tokenize(phrase))
  return nameAlternatives(instrument).some((alt) => {
    const needle = tokenize(alt)
    return needle.length > 0 && needle.every((t) => hay.has(t))
  })
}

// NOT `\b` — JavaScript word boundaries are ASCII-only, so /(итого)\b/ never
// matches «Итого:» (Cyrillic 'о' isn't a word char, so there is no boundary
// before the colon). Anchored to the whole cell instead, which also keeps a
// real instrument named «Итоговая аттестация» out of the total rows.
const TOTAL_ROW = /^\s*(итого|всего)\s*:?\s*$/i

/** Is this a table's «Итого»/«Всего» summary row rather than a real entry? */
export function isTotalRow(name: string): boolean { return TOTAL_ROW.test(name) }
