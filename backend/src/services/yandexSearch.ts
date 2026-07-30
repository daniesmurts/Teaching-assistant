import axios from 'axios'
import { logger } from '../lib/logger'
import { createUsageLog } from '../db/queries/usageLog'
import { calculateYandexWebSearchCostRub } from '../config/planLimits'
import { getUsdRubRate, rubToUsd } from './fxRate'
import type { CallContext } from './llm/types'

export interface SearchResult {
  title:   string
  url:     string
  snippet: string
}

// Yandex Search API v2 is asynchronous: submit → poll operation → decode XML.
// Everything here is BEST-EFFORT and time-boxed: any failure returns [] so topic
// generation proceeds on model knowledge alone (grounding is an enhancement).

const SEARCH_ENDPOINT    = 'https://searchapi.api.cloud.yandex.net/v2/web/searchAsync'
const OPERATION_ENDPOINT = 'https://operation.api.cloud.yandex.net/operations'
const TOTAL_BUDGET_MS    = 9_000

function apiKey(): string | null {
  return process.env.YANDEX_SEARCH_API_KEY?.trim() || process.env.YANDEX_VISION_API_KEY?.trim() || null
}

// `context` is optional (TODO.md Improvement #13) — best-effort usage
// logging, mirrors yandexImages.ts's yandexImageSearch.
export async function webSearch(query: string, maxResults = 6, context?: CallContext): Promise<SearchResult[]> {
  const key = apiKey()
  const folderId = process.env.YANDEX_FOLDER_ID?.trim()
  if (!key || !folderId) return [] // not configured → silent model-only

  const started = Date.now()
  const headers = { Authorization: `Api-Key ${key}`, 'Content-Type': 'application/json' }

  try {
    // 1. Submit the async search
    const submit = await axios.post(
      SEARCH_ENDPOINT,
      {
        query: { searchType: 'SEARCH_TYPE_RU', queryText: query },
        folderId,
        responseFormat: 'FORMAT_XML',
      },
      { headers, timeout: 4_000 }
    )
    const operationId = submit.data?.id as string | undefined
    if (!operationId) {
      logWebSearchUsage(context, Date.now() - started, false)
      return []
    }

    // 2. Poll the operation until done (within the time budget)
    let rawBase64: string | undefined
    while (Date.now() - started < TOTAL_BUDGET_MS) {
      await new Promise((r) => setTimeout(r, 1_200))
      const op = await axios.get(`${OPERATION_ENDPOINT}/${operationId}`, { headers, timeout: 4_000 })
      if (op.data?.done) {
        rawBase64 = op.data?.response?.rawData
        break
      }
    }
    if (!rawBase64) {
      logWebSearchUsage(context, Date.now() - started, false)
      return []
    }

    // 3. Decode + parse the XML result
    const xml = Buffer.from(rawBase64, 'base64').toString('utf-8')
    // Fire-and-forget, including the FX lookup inside logWebSearchUsage —
    // must never add latency to the grounding/citation-check response itself.
    logWebSearchUsage(context, Date.now() - started, true)
    return parseYandexXml(xml).slice(0, maxResults)
  } catch (err) {
    logger.warn({ message: 'Yandex search failed (continuing model-only)', error: (err as Error).message })
    logWebSearchUsage(context, Date.now() - started, false)
    return []
  }
}

async function logWebSearchUsage(context: CallContext | undefined, durationMs: number, success: boolean): Promise<void> {
  if (!context) return
  try {
    const costRub = calculateYandexWebSearchCostRub(1)
    const { rate } = await getUsdRubRate()
    await createUsageLog({
      ...context,
      model:        'yandex:web-search',
      inputTokens:  0,
      outputTokens: 0,
      costUsd:      rubToUsd(costRub, rate),
      costNative:   costRub,
      currency:     'RUB',
      fxRateUsed:   rate,
      durationMs,
      success,
    })
  } catch (e) {
    logger.warn({ message: 'Failed to write web-search usage log', error: (e as Error).message })
  }
}

// Lightweight XML extraction — no dependency, tolerant of missing fields.
function parseYandexXml(xml: string): SearchResult[] {
  const results: SearchResult[] = []
  const docs = xml.split(/<doc[\s>]/).slice(1)
  for (const doc of docs) {
    const title   = stripTags(between(doc, '<title>', '</title>'))
    const url     = stripTags(between(doc, '<url>', '</url>'))
    const snippet = stripTags(between(doc, '<passage>', '</passage>') || between(doc, '<headline>', '</headline>'))
    if (title || snippet) results.push({ title, url, snippet })
  }
  return results
}

function between(s: string, a: string, b: string): string {
  const i = s.indexOf(a)
  if (i === -1) return ''
  const j = s.indexOf(b, i + a.length)
  return j === -1 ? '' : s.slice(i + a.length, j)
}
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}
