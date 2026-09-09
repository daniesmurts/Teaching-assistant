import { logger } from '../../lib/logger'

// Reading JSON back out of a model answer — one module, because every
// provider does it and they were each doing it slightly differently.
//
// The failure this exists for, from production 2026-09-09: a teacher pressed
// «Построить план лекции» and got
//
//   Expected ',' or ']' after array element in JSON at position 3203
//
// The model's answer had been CUT OFF mid-array. extractJSON slices from the
// first `{` to the LAST `}` — which, on a severed answer, trims it back to
// the last complete element and turns "unterminated string" into a parser
// message that points at a position nobody can act on. The truncation is the
// fact worth knowing; the syntax error is an artefact of our own trimming.

/**
 * Pull a JSON object out of an answer that may be fenced or wrapped in prose
 * (a provider without a strict JSON mode wraps its output often enough).
 */
export function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : raw).trim()
  const first = candidate.indexOf('{')
  const last  = candidate.lastIndexOf('}')
  return first !== -1 && last > first ? candidate.slice(first, last + 1) : candidate
}

/**
 * Was this answer cut off, rather than merely malformed?
 *
 * Decided on the RAW text, before extractJSON trims it: a severed answer ends
 * with brackets still open (or inside a string), while a model that simply
 * wrote bad JSON usually closes what it opened. The distinction is what tells
 * a retry loop "the identical request will fail identically" apart from
 * "worth one more try".
 */
export function looksTruncated(raw: string): boolean {
  const scan = scanStructure(raw)
  return scan.inString || scan.stack.length > 0
}

/**
 * Repair a cut-off answer by discarding the incomplete tail.
 *
 * Rewinds to the last complete ELEMENT OF AN ARRAY and closes the containers
 * still open around it. Array elements only, deliberately: rewinding to the
 * last complete key inside a half-written object would hand the caller an
 * item with `type` and no `title` — an element that parses and is still
 * nonsense, which is worse than one fewer slide. An outline of 14 usable slides beats an error: the plan is
 * a list of independent items, the teacher is looking at an editor for it,
 * and adding the rest by hand costs seconds where the error costs the whole
 * generation.
 *
 * Returns null when nothing complete survived (a cut inside the very first
 * element), because half an element is not something to hand anyone.
 */
export function repairTruncatedJSON(raw: string): string | null {
  const scan = scanStructure(raw)
  if (scan.safeCut <= 0 || scan.safeStack.length === 0) return null

  const closing = [...scan.safeStack].reverse().map((open) => (open === '{' ? '}' : ']')).join('')
  const repaired = raw.slice(0, scan.safeCut) + closing
  try {
    JSON.parse(repaired)
    return repaired
  } catch {
    return null
  }
}

interface Scan {
  inString:  boolean
  stack:     string[]
  safeCut:   number     // index to cut at (exclusive) for the last complete value
  safeStack: string[]   // containers open at that point, outermost first
}

/**
 * One pass over the text, tracking string state and container nesting.
 *
 * A "safe cut" is recorded after any value that finished cleanly INSIDE AN
 * ARRAY — the closing bracket that returns us to the array, or the comma
 * separating one element from the next.
 */
function scanStructure(raw: string): Scan {
  const stack: string[] = []
  let inString = false
  let escaped  = false
  let safeCut  = 0
  let safeStack: string[] = []

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]

    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }

    if (c === '"') { inString = true; continue }

    if (c === '{' || c === '[') { stack.push(c); continue }

    if (c === '}' || c === ']') {
      stack.pop()
      if (stack[stack.length - 1] === '[') { safeCut = i + 1; safeStack = [...stack] }
      continue
    }

    // Recorded BEFORE the comma, so the repair never leaves a trailing one.
    if (c === ',' && stack[stack.length - 1] === '[') { safeCut = i; safeStack = [...stack] }
  }

  return { inString, stack, safeCut, safeStack }
}

export interface ParsedModelJson<T> {
  value:     T | null
  /** The answer was cut off, not merely malformed — a retry of the identical
   *  request will be cut off in the same place. */
  truncated: boolean
  /** Parsed from a repaired tail, so it is a PREFIX of what was asked for. */
  salvaged:  boolean
}

/**
 * Parse a model's JSON answer, salvaging a truncated one where possible.
 *
 * Never throws: the caller decides between retrying, using a short result,
 * and failing — and it needs to know which of those it is looking at, which a
 * bare SyntaxError cannot tell it.
 */
export function parseModelJSON<T>(raw: string, label = 'response'): ParsedModelJson<T> {
  try {
    return { value: JSON.parse(extractJSON(raw)) as T, truncated: false, salvaged: false }
  } catch {
    if (!looksTruncated(raw)) return { value: null, truncated: false, salvaged: false }

    const repaired = repairTruncatedJSON(raw)
    if (!repaired) {
      logger.warn({ message: '[model json] answer was cut off with nothing complete to salvage', label, length: raw.length })
      return { value: null, truncated: true, salvaged: false }
    }

    logger.warn({
      message: '[model json] answer was cut off — using the complete part',
      label, rawLength: raw.length, salvagedLength: repaired.length,
    })
    try {
      return { value: JSON.parse(repaired) as T, truncated: true, salvaged: true }
    } catch {
      return { value: null, truncated: true, salvaged: false }
    }
  }
}

/**
 * The answer was cut off at the token ceiling. Distinguished from a generic
 * failure because retrying the identical request truncates it identically —
 * both retry loops in this codebase check for it and fail fast rather than
 * burning a second doomed call.
 */
export class TruncatedResponseError extends Error {
  constructor(model: string, maxTokens?: number, provider = 'Model') {
    super(
      `${provider} response truncated at the token ceiling (model=${model}` +
      `${maxTokens != null ? `, max_tokens=${maxTokens}` : ''}) — retrying the identical request would truncate again.`
    )
    this.name = 'TruncatedResponseError'
  }

  /** Cut off, and not even a partial list survived — raised where the answer
   *  is all we have and the provider that produced it is out of scope. */
  static unsalvageable(label: string): TruncatedResponseError {
    const err = new TruncatedResponseError('—')
    err.message = `The model's "${label}" answer was cut off with nothing complete to salvage.`
    return err
  }
}

/** The model answered with something that is not JSON, twice. */
export class InvalidModelJsonError extends Error {
  constructor(label: string) {
    super(`Model did not return valid JSON for "${label}", including after one corrective retry.`)
    this.name = 'InvalidModelJsonError'
  }
}

/**
 * The shared body of every provider's chatJSON: parse, salvage, or retry once.
 *
 * The three providers had three copies of "parse, and on failure ask again",
 * and only one of them (DeepSeek) knew that a truncated answer must not be
 * retried. Worse, the retry re-sends the same request with the SAME token
 * ceiling and the cut-off answer appended — so for truncation it is not just
 * doomed, it is doomed with a longer prompt.
 */
export async function resolveModelJSON<T>(
  raw:   string,
  label: string,
  retry: () => Promise<string>,
): Promise<T> {
  const first = parseModelJSON<T>(raw, label)
  if (first.value !== null && !first.truncated) return first.value
  // A salvaged answer is short, not wrong — the caller's own normalisation
  // decides whether a shorter list is usable, and for an outline it is.
  if (first.value !== null && first.salvaged)   return first.value
  if (first.truncated) throw TruncatedResponseError.unsalvageable(label)

  const second = parseModelJSON<T>(await retry(), label)
  if (second.value !== null) return second.value
  if (second.truncated) throw TruncatedResponseError.unsalvageable(label)
  throw new InvalidModelJsonError(label)
}
