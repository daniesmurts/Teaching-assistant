import { pool } from '../connection'
import type { PresentationLifecycle, SlideEditHotspot, SlideInstruction } from '../../../../shared/types'

// ─── What actually happens to a deck after it is generated ───────────────────
//
// The «Артефакты» tab reports 62 созданных and 14 выгруженных over the same
// 30 days, which is not a ratio: they are different populations. The 14
// exports include decks made in August, and the 62 includes decks made
// yesterday that have had no chance to be exported yet. Change creation
// volume and that "ratio" moves even when behaviour is identical.
//
// Worse, export was only ever a *proxy* for "this got used", and it worked
// because downloading was the only way to get value out of a deck. On-platform
// slide editing breaks the proxy: a teacher who refines slides in place and
// presents from the browser never exports. Keep scoring decks on exports and
// the editing release will read as a regression caused by the product getting
// better.
//
// So this query is cohort-based (one row per deck created in the window,
// scored on its own outcomes) and the headline metric is composite —
// правилась OR утверждена OR выгружена OR переиспользована OR поделились.
// Every one of those already exists in the schema; none needed new writes.
//
// Deliberately NOT a stage here: presentation_jobs.outline_ready_at. The
// outline gate happens during generation — a deck only exists as a row once
// the plan was confirmed — so it belongs to the job, not to the life of a
// saved deck.

/**
 * `days` bounds the creation cohort. Outcomes are counted whenever they
 * happened, which under-counts the newest decks — hence engaged_within_7d,
 * which is the number to compare across releases.
 *
 * That comparable figure is gated on observability. Export recording began
 * with migration 126 (2026-09-06); a deck whose seven days elapsed before
 * that could never have had an export recorded, so including it measures the
 * instrumentation's age rather than anyone's behaviour. On the first run this
 * made 22 decks read as "1 of 22 used within a week", which is not a finding,
 * it is an artefact. Only decks whose whole window falls after tracking
 * started are counted, and `export_tracking_since` lets the page say so
 * instead of showing a confident zero.
 */
export async function getPresentationLifecycle(days = 30): Promise<PresentationLifecycle> {
  const { rows } = await pool.query<PresentationLifecycle>(
    `WITH cohort AS (
       SELECT id, created_at, approved_at, visibility_scope
         FROM presentations
        WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
     ),
     edits AS (
       SELECT presentation_id, MIN(created_at) AS first_at,
              COUNT(*) FILTER (WHERE event = 'regenerated') AS regenerations
         FROM presentation_slide_events
        GROUP BY presentation_id
     ),
     exports AS (
       SELECT artifact_id, MIN(created_at) AS first_at
         FROM artifact_events
        WHERE kind = 'presentation' AND event = 'exported' AND artifact_id IS NOT NULL
        GROUP BY artifact_id
     ),
     quiz_reuse AS (
       SELECT presentation_id, MIN(created_at) AS first_at
         FROM quizzes WHERE presentation_id IS NOT NULL GROUP BY presentation_id
     ),
     assignment_reuse AS (
       SELECT presentation_id, MIN(created_at) AS first_at
         FROM published_assignments WHERE presentation_id IS NOT NULL GROUP BY presentation_id
     ),
     observed AS (
       -- When export recording actually began. NULL while no export has ever
       -- been logged, which correctly empties the comparable cohort below.
       SELECT MIN(created_at) AS since FROM artifact_events
     ),
     deck AS (
       SELECT
         c.created_at,
         e.first_at  IS NOT NULL                              AS edited,
         COALESCE(e.regenerations, 0) > 0                     AS regenerated,
         c.approved_at IS NOT NULL                            AS approved,
         x.first_at  IS NOT NULL                              AS exported,
         (q.first_at IS NOT NULL OR a.first_at IS NOT NULL)   AS reused,
         COALESCE(c.visibility_scope, 'private') <> 'private' AS shared,
         -- LEAST ignores NULLs in Postgres, so this is "the earliest thing
         -- that happened, if anything did". Sharing carries no timestamp
         -- (visibility_scope is a flag), so it counts toward engaged but
         -- cannot contribute to the timing figures.
         LEAST(e.first_at, c.approved_at, x.first_at, q.first_at, a.first_at) AS first_engagement_at,
         o.since                                              AS tracking_since
       FROM cohort c
       CROSS JOIN observed o
       LEFT JOIN edits            e ON e.presentation_id = c.id
       LEFT JOIN exports          x ON x.artifact_id     = c.id
       LEFT JOIN quiz_reuse       q ON q.presentation_id = c.id
       LEFT JOIN assignment_reuse a ON a.presentation_id = c.id
     )
     SELECT
       COUNT(*)::int                                       AS total,
       COUNT(*) FILTER (WHERE edited)::int                 AS edited,
       COUNT(*) FILTER (WHERE regenerated)::int            AS regenerated,
       COUNT(*) FILTER (WHERE approved)::int               AS approved,
       COUNT(*) FILTER (WHERE exported)::int               AS exported,
       COUNT(*) FILTER (WHERE reused)::int                 AS reused,
       COUNT(*) FILTER (WHERE shared)::int                 AS shared,
       COUNT(*) FILTER (
         WHERE edited OR approved OR exported OR reused OR shared
       )::int                                              AS engaged,
       ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM first_engagement_at - created_at) / 86400
       ) FILTER (WHERE first_engagement_at IS NOT NULL))::numeric, 1)::float
                                                           AS median_days_to_engagement,
       -- Release-over-release comparison needs a matched observation window:
       -- only decks that have HAD seven days count, and only what happened
       -- inside those seven days counts. This is the figure to watch when a
       -- feature ships; engaged above is the richer but drifting one.
       COUNT(*) FILTER (
         WHERE created_at <= NOW() - INTERVAL '7 days'
           AND tracking_since IS NOT NULL
           AND created_at >= tracking_since
       )::int                                              AS mature_total,
       COUNT(*) FILTER (
         WHERE created_at <= NOW() - INTERVAL '7 days'
           AND tracking_since IS NOT NULL
           AND created_at >= tracking_since
           AND first_engagement_at IS NOT NULL
           AND first_engagement_at <= created_at + INTERVAL '7 days'
       )::int                                              AS engaged_within_7d,
       MAX(tracking_since)                                 AS export_tracking_since
     FROM deck`,
    [days]
  )
  return rows[0]
}

/**
 * Which kinds of slide get rewritten — the generation-quality signal.
 * A slide type teachers always fix is a prompt problem, not a usage problem.
 */
export async function getSlideEditHotspots(days = 30): Promise<SlideEditHotspot[]> {
  const { rows } = await pool.query<SlideEditHotspot>(
    `SELECT
       COALESCE(slide_type, 'не указан')                        AS slide_type,
       COUNT(*)::int                                            AS events,
       COUNT(*) FILTER (WHERE event = 'regenerated')::int       AS regenerations,
       COUNT(*) FILTER (WHERE event = 'deleted')::int           AS deletions,
       COUNT(DISTINCT presentation_id)::int                     AS decks
     FROM presentation_slide_events
    WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
    GROUP BY COALESCE(slide_type, 'не указан')
    ORDER BY events DESC`,
    [days]
  )
  return rows
}

/**
 * What teachers actually typed when regenerating a slide ("короче", "добавь
 * пример с числами"). At single-digit teacher counts this is worth more than
 * any ratio on the page — it says why a deck wasn't good enough as generated.
 *
 * Teacher-authored free text: rendered as data in the admin UI, never fed
 * back into a prompt from here.
 */
export async function getRecentSlideInstructions(limit = 40): Promise<SlideInstruction[]> {
  const { rows } = await pool.query<SlideInstruction>(
    `SELECT instruction, slide_type, created_at
       FROM presentation_slide_events
      WHERE instruction IS NOT NULL AND btrim(instruction) <> ''
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.min(limit, 200)]
  )
  return rows
}
