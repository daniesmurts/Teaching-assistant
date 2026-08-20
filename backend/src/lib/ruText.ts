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
