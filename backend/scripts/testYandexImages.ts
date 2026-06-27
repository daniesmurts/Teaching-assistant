// Standalone verification for the Yandex Images integration.
//
// Image search uses the SYNCHRONOUS endpoint on Yandex Cloud Search API v2
// (https://searchapi.api.cloud.yandex.net/v2/image/search). The async sibling
// /v2/image/searchAsync does not exist — image search is sync-only per the
// upstream docs. Same credentials as web grounding:
//   YANDEX_SEARCH_API_KEY  + YANDEX_FOLDER_ID
//
// Usage (from backend/):
//   npm run test:yandex-images -- "осевой насос разрез"
//   npm run test:yandex-images -- "your query" --raw      # also dumps the XML
//
// Exit codes:
//   0 — at least one candidate parsed (search works end-to-end)
//   1 — env missing, network error, or zero results

import axios from 'axios'
import { yandexImageSearch } from '../src/services/yandexImages'

const ENDPOINT = 'https://searchapi.api.cloud.yandex.net/v2/image/search'

async function main(): Promise<void> {
  const args  = process.argv.slice(2)
  const query = args.filter((a) => !a.startsWith('--')).join(' ').trim()
  const dumpRaw = args.includes('--raw')

  if (!query) {
    console.error('usage: npm run test:yandex-images -- "<query>" [--raw]')
    process.exit(2)
  }

  // ── 1. Env ────────────────────────────────────────────────────────────
  const apiKey = process.env.YANDEX_SEARCH_API_KEY?.trim()
              || process.env.YANDEX_VISION_API_KEY?.trim()
              || null
  const folderId = process.env.YANDEX_FOLDER_ID?.trim()

  console.log('── env ──')
  console.log('YANDEX_SEARCH_API_KEY:', process.env.YANDEX_SEARCH_API_KEY ? '✓ set' : '✗ missing')
  console.log('YANDEX_VISION_API_KEY:', process.env.YANDEX_VISION_API_KEY ? '✓ set (fallback)' : '✗ missing')
  console.log('YANDEX_FOLDER_ID:    ', folderId ? `✓ ${folderId}` : '✗ missing')
  console.log()

  if (!apiKey || !folderId) {
    console.error('Missing required environment variables. Set YANDEX_SEARCH_API_KEY + YANDEX_FOLDER_ID in .env.')
    process.exit(1)
  }

  // ── 2. Raw request (optional) ─────────────────────────────────────────
  if (dumpRaw) {
    console.log('── raw POST ──')
    try {
      const res = await axios.post(
        ENDPOINT,
        {
          query:     { searchType: 'SEARCH_TYPE_RU', queryText: query },
          imageSpec: { size: 'IMAGE_SIZE_MEDIUM' },
          folderId,
        },
        {
          headers: { Authorization: `Api-Key ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 15_000,
        }
      )
      console.log('HTTP', res.status)
      const raw = res.data?.rawData
      if (!raw) {
        console.error('Response had no rawData. Body:', JSON.stringify(res.data, null, 2))
        process.exit(1)
      }
      const xml = Buffer.from(raw, 'base64').toString('utf-8')
      console.log('── raw XML (first 4KB) ──')
      console.log(xml.slice(0, 4096))
      if (xml.length > 4096) console.log(`\n[... truncated, total ${xml.length} chars ...]`)
      console.log()
    } catch (err) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string }
      console.error('Raw request failed:', e.response?.status, e.message)
      if (e.response?.data) {
        console.error('Response body:', JSON.stringify(e.response.data, null, 2).slice(0, 2048))
      }
      process.exit(1)
    }
  }

  // ── 3. Service call (uses the same parser the app uses) ───────────────
  console.log('── parsed candidates (via services/yandexImages.ts) ──')
  const candidates = await yandexImageSearch(query, 6)
  console.log(`Got ${candidates.length} candidates.`)
  candidates.forEach((c, i) => {
    console.log()
    console.log(`[${i + 1}] ${c.source_host ?? '(no host)'}`)
    console.log(`    image:  ${c.url}`)
    console.log(`    thumb:  ${c.thumbnail}`)
    console.log(`    page:   ${c.source_url}`)
    console.log(`    size:   ${c.width ?? '?'} × ${c.height ?? '?'}`)
  })

  if (candidates.length === 0) {
    console.error('\nZero candidates parsed. Re-run with --raw to inspect the XML field names.')
    console.error('If the XML shows an <error> element, check that the Search API service is enabled on this folder and the key has searchapi.user role.')
    console.error('If results look fine but parsing returns nothing, the field aliases in services/yandexImages.ts may need updating.')
    process.exit(1)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
