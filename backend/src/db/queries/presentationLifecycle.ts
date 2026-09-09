import { pool } from '../connection'
import type { PresentationLifecycle, SlideEditHotspot, SlideInstruction, PresentationCohort } from '../../../../shared/types'

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

/**
 * Weekly creation cohorts, each measured on the SAME horizons since its own
 * decks were made — the shape in which a feature's effect is actually visible.
 * A raw "engaged this month" line moves with creation volume; a cohort curve
 * does not, because every deck is scored on its own first N days.
 *
 * Observability is enforced PER DECK, not per cohort. A horizon's denominator
 * is the decks that have actually lived N days *and* were created after export
 * recording began; the numerator is those engaged inside that window. Gating
 * per cohort instead — demanding the whole week elapse before reporting
 * anything — is defensible but renders an empty chart for eight days after
 * every cohort starts, and throws away decks whose window genuinely is
 * complete. Reporting `observed` alongside `engaged` keeps it honest: the
 * denominator is on screen, so a rate over three decks cannot pass for a rate
 * over thirty.
 *
 * A horizon with `observed = 0` is omitted from the curve entirely rather than
 * drawn at zero — "not measurable yet" and "nobody used them" must not share
 * a pixel.
 */
export async function getPresentationCohorts(weeks = 8): Promise<PresentationCohort[]> {
  const { rows } = await pool.query<{
    week: string; cohort_size: number; tracked: boolean
    o1: number; e1: number; o3: number; e3: number; o7: number; e7: number
    o14: number; e14: number; o30: number; e30: number
  }>(
    `WITH tracking AS (
       SELECT MIN(created_at) AS since FROM artifact_events
     ),
     cohort AS (
       SELECT id, created_at, approved_at, visibility_scope,
              DATE_TRUNC('week', created_at) AS week
         FROM presentations
        WHERE created_at >= DATE_TRUNC('week', NOW()) - ($1 || ' weeks')::INTERVAL
     ),
     edits AS (
       SELECT presentation_id, MIN(created_at) AS first_at
         FROM presentation_slide_events GROUP BY presentation_id
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
     per_deck AS (
       SELECT c.week, c.created_at,
              LEAST(e.first_at, c.approved_at, x.first_at, q.first_at, a.first_at) AS first_at,
              -- A deck created before export recording began could never have
              -- an export logged in its window, so it cannot enter any
              -- denominator: its silence is missing data, not disuse.
              (t.since IS NOT NULL AND c.created_at >= t.since) AS observable
         FROM cohort c
         CROSS JOIN tracking t
         LEFT JOIN edits            e ON e.presentation_id = c.id
         LEFT JOIN exports          x ON x.artifact_id     = c.id
         LEFT JOIN quiz_reuse       q ON q.presentation_id = c.id
         LEFT JOIN assignment_reuse a ON a.presentation_id = c.id
     )
     SELECT
       TO_CHAR(week, 'YYYY-MM-DD')                     AS week,
       COUNT(*)::int                                   AS cohort_size,
       BOOL_OR(observable)                             AS tracked,
       COUNT(*) FILTER (WHERE observable AND created_at + INTERVAL  '1 day'  <= NOW())::int AS o1,
       COUNT(*) FILTER (WHERE observable AND created_at + INTERVAL  '1 day'  <= NOW()
                          AND first_at <= created_at + INTERVAL  '1 day')::int              AS e1,
       COUNT(*) FILTER (WHERE observable AND created_at + INTERVAL  '3 days' <= NOW())::int AS o3,
       COUNT(*) FILTER (WHERE observable AND created_at + INTERVAL  '3 days' <= NOW()
                          AND first_at <= created_at + INTERVAL  '3 days')::int             AS e3,
       COUNT(*) FILTER (WHERE observable AND created_at + INTERVAL  '7 days' <= NOW())::int AS o7,
       COUNT(*) FILTER (WHERE observable AND created_at + INTERVAL  '7 days' <= NOW()
                          AND first_at <= created_at + INTERVAL  '7 days')::int             AS e7,
       COUNT(*) FILTER (WHERE observable AND created_at + INTERVAL '14 days' <= NOW())::int AS o14,
       COUNT(*) FILTER (WHERE observable AND created_at + INTERVAL '14 days' <= NOW()
                          AND first_at <= created_at + INTERVAL '14 days')::int             AS e14,
       COUNT(*) FILTER (WHERE observable AND created_at + INTERVAL '30 days' <= NOW())::int AS o30,
       COUNT(*) FILTER (WHERE observable AND created_at + INTERVAL '30 days' <= NOW()
                          AND first_at <= created_at + INTERVAL '30 days')::int             AS e30
     FROM per_deck
     GROUP BY week
     ORDER BY week DESC`,
    [weeks]
  )

  return rows.map((r) => ({
    week:        r.week,
    cohort_size: r.cohort_size,
    tracked:     r.tracked,
    horizons: [
      { days: 1,  observed: r.o1,  engaged: r.e1 },
      { days: 3,  observed: r.o3,  engaged: r.e3 },
      { days: 7,  observed: r.o7,  engaged: r.e7 },
      { days: 14, observed: r.o14, engaged: r.e14 },
      { days: 30, observed: r.o30, engaged: r.e30 },
    ],
  }))
}
