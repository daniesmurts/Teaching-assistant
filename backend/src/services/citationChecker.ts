// Citation existence checking — flag hallucinated bibliographies instead of
// trusting a ChatGPT-drafted reference list at face value.
//
// Bounded to exactly ONE LLM call regardless of reference count: the model
// extracts up to MAX_REFS bibliography entries as structured JSON (raw text
// only — citation styles vary too much to parse reliably); everything after
// that is deterministic local work (search + token-overlap classification).
// Mirrors calcVerifier.ts's shape: one extraction call, then pure/local
// processing, fail-open on any error. Never treat a 'not_found' verdict as
// proof of fabrication — paywalled journals and offline books are real and
// won't show up in a web search either.

import { chatJSON, type CallContext } from './deepseek'
import { webSearch, type SearchResult } from './yandexSearch'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { logger } from '../lib/logger'
import type { BulletItem, CitationVerdict } from '../../../shared/types'

const MAX_REFS = 15
const CONCURRENCY = 4
const SUBMISSION_EXCERPT_CHARS = 8000

interface RawReference {
  index?:    unknown
  raw_text?: unknown
}

const STOP_WORDS = new Set([
  'и', 'в', 'на', 'с', 'по', 'для', 'к', 'от', 'из', 'о', 'а', 'the', 'a', 'an', 'of', 'in', 'on', 'and', 'for',
])

/** Pure — normalises text into a set of significant lowercase tokens for overlap scoring. */
function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[«»"'.,;:()[\]]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
  )
}

/** Pure — strips leading numbering/brackets ("12.", "[3]", "3)") a reference list commonly starts with. */
export function stripLeadingNumbering(s: string): string {
  return s.trim().replace(/^[\[(]?\d{1,3}[\]).]?\s*/, '').trim()
}

/** Pure — a shorter "title-only" reformulation for the retry: everything before the first comma or a 4-digit year. */
export function reformulateQuery(rawText: string): string {
  const stripped = stripLeadingNumbering(rawText)
  const yearMatch = stripped.match(/^(.*?)(?:,?\s*\(?\d{4}\)?)/)
  const beforeComma = stripped.split(',')[0]
  const candidate = (yearMatch?.[1] ?? beforeComma).trim()
  return candidate.length >= 8 ? candidate : stripped.slice(0, 120)
}

/** Pure — token-overlap classification against the best-matching search result. No LLM call. */
export function classifyMatch(
  rawText: string,
  results: SearchResult[],
): { status: CitationVerdict['status']; best_match_title: string | null; best_match_url: string | null } {
  if (results.length === 0) return { status: 'not_found', best_match_title: null, best_match_url: null }

  const refTokens = tokenize(rawText)
  if (refTokens.size === 0) return { status: 'not_found', best_match_title: null, best_match_url: null }

  let best = { overlap: 0, result: results[0] }
  for (const r of results) {
    const resultTokens = tokenize(`${r.title} ${r.snippet}`)
    const shared = [...refTokens].filter((t) => resultTokens.has(t)).length
    const overlap = shared / refTokens.size
    if (overlap > best.overlap) best = { overlap, result: r }
  }

  const status: CitationVerdict['status'] =
    best.overlap >= 0.5 ? 'found' : best.overlap >= 0.25 ? 'similar_found' : 'not_found'

  return status === 'not_found'
    ? { status, best_match_title: null, best_match_url: null }
    : { status, best_match_title: best.result.title || null, best_match_url: best.result.url || null }
}

async function searchForReference(rawText: string, context: CallContext): Promise<{ queryUsed: string; results: SearchResult[] }> {
  const primaryQuery = stripLeadingNumbering(rawText).slice(0, 200)
  let results = await webSearch(primaryQuery, 6, context)
  if (results.length > 0) return { queryUsed: primaryQuery, results }

  const fallbackQuery = reformulateQuery(rawText)
  if (fallbackQuery !== primaryQuery) {
    results = await webSearch(fallbackQuery, 6, context)
    if (results.length > 0) return { queryUsed: fallbackQuery, results }
  }
  return { queryUsed: primaryQuery, results: [] }
}

function noteFor(status: CitationVerdict['status']): string {
  if (status === 'found') return 'Источник найден в открытом доступе.'
  if (status === 'similar_found') return 'Найден похожий источник — точное совпадение не подтверждено.'
  return 'Не удалось найти источник — возможно, неточная ссылка или вымышленный источник. ' +
    'Отсутствие в поиске не доказывает подделку: источник может быть платным, устаревшим или не проиндексированным.'
}

export async function checkCitations(params: {
  submissionText: string
  context:        CallContext
  providerOverride?: 'deepseek' | 'yandex' | 'gigachat' | 'qwen'
}): Promise<CitationVerdict[]> {
  try {
    const system = `Вы извлекаете список использованных источников (библиографию) из работы студента. ` +
      `Верните каждую отдельную запись библиографического списка как есть, без изменений и сокращений — ` +
      `не более ${MAX_REFS} записей. Если списка литературы нет, верните пустой массив. Отвечайте только валидным JSON.`

    const user = `## Работа студента\n<submission>\n` +
      `${sanitiseForPrompt(params.submissionText).slice(0, SUBMISSION_EXCERPT_CHARS)}\n</submission>\n\n` +
      `Верните JSON: {"references": [{"index": число, "raw_text": запись библиографического списка дословно}]}.`

    const result = await chatJSON<{ references?: RawReference[] }>(
      [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
      'список литературы',
      { context: params.context, providerOverride: params.providerOverride },
    )

    const refs = (Array.isArray(result.references) ? result.references : [])
      .map((r, i) => ({
        index:    Number.isInteger(r.index) ? Number(r.index) : i,
        raw_text: String(r.raw_text ?? '').trim().slice(0, 400),
      }))
      .filter((r) => r.raw_text.length >= 8)
      .slice(0, MAX_REFS)

    if (refs.length === 0) return []

    const verdicts: CitationVerdict[] = new Array(refs.length)
    let next = 0
    async function worker(): Promise<void> {
      while (next < refs.length) {
        const i = next++
        const ref = refs[i]
        const { queryUsed, results } = await searchForReference(ref.raw_text, params.context)
        const { status, best_match_title, best_match_url } = classifyMatch(ref.raw_text, results)
        verdicts[i] = {
          index:            ref.index,
          raw_text:         ref.raw_text,
          query_used:       queryUsed,
          status,
          best_match_title,
          best_match_url,
          note:             noteFor(status),
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, refs.length) }, worker))

    return verdicts
  } catch (err) {
    logger.warn({ message: '[CitationChecker] Verification failed, skipping', error: (err as Error).message })
    return []
  }
}

/** Pure — turns a not_found verdict into a citable improvement bullet, reusing the Tier-3 BulletItem fields. */
export function toCitationBullet(verdict: CitationVerdict, submissionText: string): BulletItem {
  const haystack = submissionText.toLowerCase().replace(/\s+/g, ' ').trim()
  const candidateQuote = verdict.raw_text.trim()
  const normalisedQuote = candidateQuote.toLowerCase().replace(/\s+/g, ' ').trim()
  const quote = normalisedQuote.length >= 8 && haystack.includes(normalisedQuote)
    ? candidateQuote.slice(0, 200)
    : null

  return {
    text:        `Источник «${verdict.raw_text.slice(0, 120)}»: ${verdict.note}`,
    quote,
    page:        null,
    question:    null,
    criterion_id: null,
    severity:    'substantial',
    action:      'verify',
    correction:  'Проверьте точность библиографической ссылки у студента.',
  }
}
