import { pool } from '../connection'
import { logger } from '../../lib/logger'
import type { Slide } from '../../../../shared/types'

// Per-slide edit telemetry (migration 119, TODO.md "### AO" Phase 1).
//
// This is the first non-structural quality signal the presentation feature
// has: presentationEvalHarness.ts can measure notes length and bullets share
// offline, but only a teacher rewriting or regenerating a slide tells us it
// was actually bad. Recording it is a byproduct of the editing UI, not extra
// work asked of anyone.

export type SlideEventKind = 'edited' | 'regenerated' | 'deleted' | 'inserted' | 'reordered'

export interface SlideEventInput {
  presentationId: string
  teacherId:      string
  event:          SlideEventKind
  slideIndex:     number
  slide?:         Slide | null      // for type/title breadcrumbs
  instruction?:   string | null     // regenerate only
}

/**
 * Fire-and-forget: telemetry must never fail a teacher's edit. Same posture
 * as incrementUsage() and logDocumentRetrievals() — the caller doesn't await
 * a rejection it has nothing useful to do about.
 */
export function recordSlideEvent(input: SlideEventInput): void {
  pool.query(
    `INSERT INTO presentation_slide_events
       (presentation_id, teacher_id, event, slide_index, slide_type, slide_title, instruction)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.presentationId,
      input.teacherId,
      input.event,
      input.slideIndex,
      input.slide?.type ?? null,
      input.slide?.title?.slice(0, 300) ?? null,
      input.instruction?.slice(0, 500) ?? null,
    ]
  ).catch((err: Error) => {
    logger.warn({ message: 'Could not record presentation slide event', event: input.event, error: err.message })
  })
}

export interface SlideEventRow {
  event:       SlideEventKind
  slide_index: number
  slide_title: string | null
  created_at:  Date
}

/** Events for one deck, newest first — powers the "изменён" marks in the viewer. */
export async function findSlideEventsForPresentation(
  presentationId: string,
  teacherId: string,
): Promise<SlideEventRow[]> {
  const { rows } = await pool.query<SlideEventRow>(
    `SELECT event, slide_index, slide_title, created_at
       FROM presentation_slide_events
      WHERE presentation_id = $1 AND teacher_id = $2
      ORDER BY created_at DESC
      LIMIT 200`,
    [presentationId, teacherId]
  )
  return rows
}
