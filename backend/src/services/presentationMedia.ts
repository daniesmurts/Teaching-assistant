import { uploadObject, deleteObject } from './objectStorage'
import { createPresentationMedia, listPresentationMediaPaths } from '../db/queries/presentationMedia'
import { withSlideImage } from './presentations'
import { logger } from '../lib/logger'
import type { Slide, SlideImage } from '../../../shared/types'
import type { ImportedSlide } from './pptxImport'

// Пришедшие из .pptx изображения (migration 128).
//
// The import read text only, so a lecture carried by drawings — the reported
// ЖКВН deck was 900 KB of schematics in a 995 KB file — arrived as a shell of
// captions: «Рис. 3. Принципиальная схема многоступенчатого…» above nothing.
//
// The slide model holds ONE image per slide (shared/types.ts's SlideBase), so
// a slide with several contributes its largest and the rest are dropped. That
// is a real loss and it is deliberate: the alternative is inventing a
// multi-image slide type, which changes rendering, export and the picker for
// every deck in the product to serve the minority of imported slides.

/** Belt-and-braces cap. The 20 MB upload limit already bounds this; a deck of
 *  screenshots shouldn't turn one import into 20 MB of stored objects either. */
const MAX_IMAGES_PER_DECK = 60
const MAX_TOTAL_BYTES     = 20 * 1024 * 1024

export interface StoredMediaResult {
  slides:  Slide[]
  stored:  number   // pictures that became slide images
  dropped: number   // extra pictures on a slide that already has one
}

/**
 * Store each slide's largest picture and hand back the slides pointing at it.
 *
 * Best-effort per image: a storage failure loses that picture, never the
 * import. A teacher who has just waited for an upload should get their deck
 * with nine of ten drawings, not an error.
 */
export async function attachImportedImages(
  presentationId: string,
  teacherId:      string,
  slides:         Slide[],
  imported:       ImportedSlide[],
): Promise<StoredMediaResult> {
  let out = slides
  let stored = 0
  let dropped = 0
  let bytes = 0

  for (const [index, source] of imported.entries()) {
    const [picture, ...extras] = source.images
    dropped += extras.length
    if (!picture || !out[index]) continue
    if (stored >= MAX_IMAGES_PER_DECK || bytes + picture.buffer.length > MAX_TOTAL_BYTES) {
      dropped += 1
      continue
    }

    const ext = picture.mime === 'image/jpeg' ? 'jpg' : 'png'
    const storagePath = `presentations/${teacherId}/${presentationId}/${index}.${ext}`

    try {
      await uploadObject(picture.buffer, storagePath, picture.mime)
      const row = await createPresentationMedia({
        presentationId, teacherId,
        slideIndex:  index,
        storagePath,
        mimeType:    picture.mime,
        width:       picture.width,
        height:      picture.height,
        bytes:       picture.buffer.length,
      })
      out = out.map((slide, i) => (i === index ? withSlideImage(slide, toSlideImage(row.id, picture, out[index])) : slide))
      stored += 1
      bytes  += picture.buffer.length
    } catch (err) {
      logger.warn({
        message: '[pptx import] could not store slide image', presentationId, index,
        error: (err as Error).message,
      })
      dropped += 1
    }
  }

  return { slides: out, stored, dropped }
}

function toSlideImage(
  mediaId: string,
  picture: { width: number; height: number },
  slide:   Slide,
): SlideImage {
  // This codebase has no pre-signed-URL mechanism, so an authenticated proxy
  // route is how a stored object reaches a page — same shape as the кафедра
  // figure library and the institution logo before it.
  const url = `/api/presentations/media/${mediaId}/image`
  return {
    url, source_url: url, thumbnail: url,
    width: picture.width, height: picture.height,
    // Shown as the credit line under the picture. It is not a web result, and
    // saying so is more honest than leaving a hostname-shaped blank.
    source_host: 'Из загруженной презентации',
    query: slide.title || 'Изображение со слайда',
  }
}

/** Delete a deck's stored pictures. The rows go with the deck (ON DELETE
 *  CASCADE); the objects behind them would not, and an orphaned object is
 *  storage nobody can reach and nobody is counting. */
export async function deletePresentationMediaObjects(presentationId: string): Promise<void> {
  try {
    const paths = await listPresentationMediaPaths(presentationId)
    for (const path of paths) await deleteObject(path)
  } catch (err) {
    logger.warn({
      message: '[pptx import] could not clean up slide images', presentationId,
      error: (err as Error).message,
    })
  }
}
