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

export interface LiveEditRates {
  decks:            number   // decks generated in the window
  decksWithEdits:   number
  editedSlides:     number
  regeneratedSlides: number
  deletedSlides:    number
  approvedDecks:    number
  /** Share of generated decks the teacher touched at all. */
  editedDeckShare:  number
  /** Share of generated decks the teacher explicitly marked «Готово». */
  approvedShare:    number
}

/**
 * The live counterpart to presentationEvalHarness's structural scores
 * (TODO.md "### AO" Phase 2). The harness can measure notes length and bullets
 * share on freshly generated decks; only real teachers rewriting slides says
 * whether the output was any good. Reporting both on the same axis is the
 * point — a prompt change that improves `avgNotesWordCount` while raising the
 * rewrite rate has not improved anything.
 */
export async function computeLiveEditRates(days = 30): Promise<LiveEditRates> {
  const { rows } = await pool.query<{
    decks: string; decks_with_edits: string; approved_decks: string
    edited: string; regenerated: string; deleted: string
  }>(
    `WITH window_decks AS (
       SELECT id, approved_at FROM presentations
        WHERE created_at > NOW() - ($1 || ' days')::interval
     ),
     window_events AS (
       SELECT e.presentation_id, e.event
         FROM presentation_slide_events e
         JOIN window_decks d ON d.id = e.presentation_id
     )
     SELECT (SELECT count(*) FROM window_decks)                                            AS decks,
            (SELECT count(DISTINCT presentation_id) FROM window_events)                    AS decks_with_edits,
            (SELECT count(*) FROM window_decks WHERE approved_at IS NOT NULL)              AS approved_decks,
            (SELECT count(*) FROM window_events WHERE event = 'edited')                    AS edited,
            (SELECT count(*) FROM window_events WHERE event = 'regenerated')               AS regenerated,
            (SELECT count(*) FROM window_events WHERE event = 'deleted')                   AS deleted`,
    [String(days)]
  )

  const r = rows[0]
  const decks = Number(r.decks)
  return {
    decks,
    decksWithEdits:    Number(r.decks_with_edits),
    editedSlides:      Number(r.edited),
    regeneratedSlides: Number(r.regenerated),
    deletedSlides:     Number(r.deleted),
    approvedDecks:     Number(r.approved_decks),
    editedDeckShare:   decks > 0 ? Number(r.decks_with_edits) / decks : 0,
    approvedShare:     decks > 0 ? Number(r.approved_decks) / decks : 0,
  }
}
