import { downloadObject } from './objectStorage'
import { getPresentationMediaById } from '../db/queries/presentationMedia'
import { getFigureById } from '../db/queries/documentFigures'
import { logger } from '../lib/logger'

// Loading the bytes behind a slide image, for every consumer that puts one on
// a page — the PPTX export and the раздатка PDF. One module because the two
// halves are easy to get subtly different: a slide image is a URL, but only
// SOME of them are out on the web.
//
// Two of the three sources are this app's own storage, addressed through an
// authenticated proxy route — the кафедра figure library
// (`/api/documents/figures/:id/image`) and a picture imported from a .pptx
// (`/api/presentations/media/:id/image`). Those URLs are ROOT-RELATIVE, and
// `fetch()` of a relative URL throws in Node, so a consumer that only knows
// how to fetch silently renders a placeholder while the bytes sit in object
// storage the same process can read.

const FETCH_TIMEOUT_MS = 10_000

export interface LoadedImage {
  buffer: Buffer
  mime:   string
}

const INTERNAL_ROUTES: [RegExp, (id: string) => Promise<{ path: string; mime: string } | null>][] = [
  [/^\/api\/presentations\/media\/([0-9a-f-]{36})\/image$/i, async (id) => {
    const media = await getPresentationMediaById(id)
    return media ? { path: media.storage_path, mime: media.mime_type } : null
  }],
  [/^\/api\/documents\/figures\/([0-9a-f-]{36})\/image$/i, async (id) => {
    const figure = await getFigureById(id)
    return figure ? { path: figure.storage_path, mime: figure.mime_type } : null
  }],
]

/**
 * Bytes for a slide image, wherever it lives. Never throws: an image is
 * decoration on a document that must still be produced, so every failure
 * (network, a deleted object, a URL pointing nowhere) returns null and the
 * caller falls back to whatever it does without a picture.
 */
export async function loadSlideImage(url: string): Promise<LoadedImage | null> {
  return url.startsWith('/') ? fromStorage(url) : fromWeb(url)
}

async function fromStorage(url: string): Promise<LoadedImage | null> {
  for (const [pattern, lookup] of INTERNAL_ROUTES) {
    const match = pattern.exec(url)
    if (!match) continue
    try {
      const found = await lookup(match[1])
      if (!found) return null
      return { buffer: await downloadObject(found.path), mime: found.mime }
    } catch (err) {
      logger.warn({ message: '[slide image] could not read from storage', url, error: (err as Error).message })
      return null
    }
  }
  return null
}

async function fromWeb(url: string): Promise<LoadedImage | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(url, { signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }
    if (!res.ok) return null
    const mime = res.headers.get('content-type') ?? ''
    if (!mime.startsWith('image/')) return null
    return { buffer: Buffer.from(await res.arrayBuffer()), mime: mime.split(';')[0].trim() }
  } catch (err) {
    logger.warn({ message: '[slide image] could not fetch', url, error: (err as Error).message })
    return null
  }
}
