// Shared verbatim-quote gate — same contract as grading.ts's validateCitation:
// a quote survives only if it appears in the source text case/whitespace-
// insensitively. Used wherever an AI response cites a passage but there's no
// page count to validate alongside it (grading.ts keeps its own copy because
// it also validates a page number in the same pass).
export function validateQuoteAgainstSource(rawQuote: unknown, sourceText: string): string | null {
  if (typeof rawQuote !== 'string') return null
  const trimmed = rawQuote.trim()
  if (!trimmed) return null

  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const normalisedQuote = normalise(trimmed)
  if (normalisedQuote.length < 8) return null

  const haystack = normalise(sourceText)
  if (!haystack.includes(normalisedQuote)) return null

  return trimmed.slice(0, 300)
}
