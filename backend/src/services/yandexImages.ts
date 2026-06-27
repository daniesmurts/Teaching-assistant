import axios from 'axios'
import { logger } from '../lib/logger'
import type { ImageCandidate } from '../../../shared/types'

// Yandex Cloud Search API v2 — image endpoint.
//
// Image search on this API is SYNCHRONOUS ONLY. There is no /image/searchAsync
// (calling it 404s). The sync endpoint returns the result inline, base64-
// encoded, in a single POST — no operation polling like the web endpoint.
//
// Auth + folder come from the same Yandex Cloud Search API credentials used
// by yandexSearch.ts (web grounding):
//   YANDEX_SEARCH_API_KEY  + YANDEX_FOLDER_ID
//
// Best-effort: any failure returns [] so the picker UI shows "ничего не
// найдено" rather than 500-ing the request.

const SEARCH_ENDPOINT   = 'https://searchapi.api.cloud.yandex.net/v2/image/search'
const REQUEST_BUDGET_MS = 12_000

function apiKey(): string | null {
  return process.env.YANDEX_SEARCH_API_KEY?.trim()
    || process.env.YANDEX_VISION_API_KEY?.trim()
    || null
}

export async function yandexImageSearch(query: string, maxResults = 6): Promise<ImageCandidate[]> {
  const key = apiKey()
  const folderId = process.env.YANDEX_FOLDER_ID?.trim()
  if (!key || !folderId) return []

  try {
    const res = await axios.post<{ rawData?: string }>(
      SEARCH_ENDPOINT,
      {
        query:     { searchType: 'SEARCH_TYPE_RU', queryText: query },
        // Medium is the right tradeoff for a slide preview: large enough to
        // tell what the image is, small enough that the picker stays snappy.
        imageSpec: { size: 'IMAGE_SIZE_MEDIUM' },
        folderId,
      },
      {
        headers: { Authorization: `Api-Key ${key}`, 'Content-Type': 'application/json' },
        timeout: REQUEST_BUDGET_MS,
      }
    )

    const rawBase64 = res.data?.rawData
    if (!rawBase64) {
      logger.warn({ message: 'Yandex image search returned no rawData', query })
      return []
    }

    const xml = Buffer.from(rawBase64, 'base64').toString('utf-8')
    return parseYandexImagesXml(xml).slice(0, maxResults)
  } catch (err) {
    const e = err as { response?: { status?: number; data?: unknown }; message?: string }
    logger.warn({
      message: 'Yandex image search failed',
      query,
      status:  e.response?.status,
      error:   e.message,
    })
    return []
  }
}

// ── Parser ─────────────────────────────────────────────────────────────────
//
// The image XML envelope looks roughly like:
//   <yandexsearch>
//     <response>
//       <error code="...">...</error>          ← present on quota / auth fail
//       <results>
//         <grouping>
//           <group>
//             <doc>
//               <url>page_url</url>
//               <domain>example.com</domain>
//               <image-properties>
//                 <image-source-url>direct_image_url</image-source-url>
//                 <thumbnail-link>https://...</thumbnail-link>
//                 <thumbnail-width>200</thumbnail-width>
//                 <thumbnail-height>150</thumbnail-height>
//                 <original-width>800</original-width>
//                 <original-height>600</original-height>
//               </image-properties>
//             </doc>
//           </group>
//         </grouping>
//       </results>
//     </response>
//   </yandexsearch>
//
// Field names have varied across Yandex generations — try several aliases.

export function parseYandexImagesXml(xml: string): ImageCandidate[] {
  // Surface a Yandex-side error (quota, bad auth) via the warn log and bail.
  const errorBlock = between(xml, '<error', '</error>')
  if (errorBlock) {
    logger.warn({ message: 'Yandex image search returned XML error', error: stripTags(errorBlock) })
    return []
  }

  const results: ImageCandidate[] = []
  const docs = xml.split(/<doc[\s>]/).slice(1)

  for (const doc of docs) {
    const sourceUrl = stripTags(between(doc, '<url>', '</url>'))
    const domain    = stripTags(between(doc, '<domain>', '</domain>'))

    const imageUrl = firstNonEmpty([
      stripTags(between(doc, '<image-source-url>',    '</image-source-url>')),
      stripTags(between(doc, '<image-link>',          '</image-link>')),
      stripTags(between(doc, '<original-image-link>', '</original-image-link>')),
    ])
    const thumb = firstNonEmpty([
      stripTags(between(doc, '<thumbnail-link>', '</thumbnail-link>')),
      stripTags(between(doc, '<passage-link>',   '</passage-link>')),
      imageUrl,
    ])
    const width  = num(between(doc, '<original-width>', '</original-width>')
                    || between(doc, '<image-width>',    '</image-width>'))
    const height = num(between(doc, '<original-height>', '</original-height>')
                    || between(doc, '<image-height>',   '</image-height>'))

    if (!imageUrl && !thumb) continue
    if (!/^https?:\/\//.test(imageUrl || thumb)) continue

    results.push({
      url:         imageUrl || thumb,
      source_url:  sourceUrl,
      thumbnail:   thumb,
      width,
      height,
      source_host: domain || extractHost(sourceUrl),
    })
  }

  return results
}

// ── XML helpers ────────────────────────────────────────────────────────────

function between(s: string, a: string, b: string): string {
  const i = s.indexOf(a)
  if (i === -1) return ''
  const j = s.indexOf(b, i + a.length)
  return j === -1 ? '' : s.slice(i + a.length, j)
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstNonEmpty(values: string[]): string {
  for (const v of values) if (v) return v
  return ''
}

function num(s: string): number | null {
  const cleaned = s.replace(/<[^>]+>/g, '').trim()
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function extractHost(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return null
  }
}
