import { pool } from '../connection'
import { SIGNAL_SINCE, type BehaviourSignal } from '../../../../shared/releaseMarkers'
import type { WithinSubjectComparison, WithinSubjectMetric } from '../../../../shared/types'

// ─── Within-subject before/after ─────────────────────────────────────────────
//
// "Did behaviour change when we shipped X" has one dominant confound at this
// scale, and it is not noise — it is WHO was active. A plain before/after over
// all teachers compares two different groups of people: one busy fortnight
// from a single power user moves every pooled rate more than any feature will.
//
// So this compares each teacher to themselves, over teachers active in BOTH
// windows, and reports the MEDIAN OF PER-TEACHER DELTAS — which is not the
// delta of the medians, and the difference matters. If nine teachers each
// improve slightly and one collapses, the median delta says "nine improved";
// the delta of medians can say almost anything. Direction counts (улучшилось /
// ухудшилось / без изменений) are reported alongside, because at ten teachers
// the count of who moved which way is more legible than any average.
//
// This is not causal. Nothing here randomises anything, and a release is
// always confounded with whatever else happened that week — term start,
// a holiday, a support conversation. It removes population mix, which is the
// confound big enough to invent findings on its own; it does not remove time.

export interface ComparisonInput {
  /** Release date, YYYY-MM-DD. */
  date:  string
  /** Days each side. */
  days:  number
}

interface MetricSpec {
  key:     WithinSubjectMetric['key']
  label:   string
  signal:  BehaviourSignal
  /** SQL producing the per-teacher value in a window, from the `deck` CTE. */
  expr:    string
}

// Every metric is a per-teacher rate or count over THAT teacher's own decks in
// the window, so a teacher who made 2 decks and one who made 40 contribute
// equally to the median — which is the point of a within-subject design.
const METRICS: readonly MetricSpec[] = [
  { key: 'decks_created', label: 'Презентаций создано', signal: 'created',
    expr: 'COUNT(*)::numeric' },
  { key: 'edited_share', label: 'Доля колод, которые правили', signal: 'edited',
    expr: 'AVG(CASE WHEN edited THEN 1 ELSE 0 END)::numeric' },
  { key: 'exported_share', label: 'Доля выгруженных', signal: 'exported',
    expr: 'AVG(CASE WHEN exported THEN 1 ELSE 0 END)::numeric' },
  { key: 'reused_share', label: 'Доля ставших тестом или заданием', signal: 'reused',
    expr: 'AVG(CASE WHEN reused THEN 1 ELSE 0 END)::numeric' },
  { key: 'engaged_share', label: 'Доля как-то использованных', signal: 'exported',
    expr: 'AVG(CASE WHEN edited OR approved OR exported OR reused THEN 1 ELSE 0 END)::numeric' },
]

const DECK_CTE = `
  WITH edits AS (
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
  deck AS (
    SELECT p.id, p.teacher_id, p.created_at,
           e.first_at IS NOT NULL                            AS edited,
           p.approved_at IS NOT NULL                         AS approved,
           x.first_at IS NOT NULL                            AS exported,
           (q.first_at IS NOT NULL OR a.first_at IS NOT NULL) AS reused
      FROM presentations p
      JOIN teachers t ON t.id = p.teacher_id AND COALESCE(t.is_platform_admin, FALSE) = FALSE
      LEFT JOIN edits            e ON e.presentation_id = p.id
      LEFT JOIN exports          x ON x.artifact_id     = p.id
      LEFT JOIN quiz_reuse       q ON q.presentation_id = p.id
      LEFT JOIN assignment_reuse a ON a.presentation_id = p.id
  )
`

/** Pure — median of a numeric list. Exported for its own unit test. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export async function getWithinSubjectComparison(input: ComparisonInput): Promise<WithinSubjectComparison> {
  const { date, days } = input

  // Per teacher, per window, every metric at once. Teachers appear in a window
  // only if they created at least one deck in it — the matched panel is
  // "teachers who were doing this thing on both sides", which is the only
  // group whose change can mean anything.
  const { rows } = await pool.query<{
    teacher_id: string; window: 'before' | 'after'
    decks_created: string; edited_share: string; exported_share: string
    reused_share: string; engaged_share: string
  }>(
    `${DECK_CTE}
     SELECT teacher_id,
            CASE WHEN created_at < $1::date THEN 'before' ELSE 'after' END AS window,
            ${METRICS.map((m) => `${m.expr} AS ${m.key}`).join(',\n            ')}
       FROM deck
      WHERE created_at >= $1::date - ($2 || ' days')::INTERVAL
        AND created_at <  $1::date + ($2 || ' days')::INTERVAL
      GROUP BY teacher_id, 2`,
    [date, days]
  )

  const before = new Map(rows.filter((r) => r.window === 'before').map((r) => [r.teacher_id, r]))
  const after = new Map(rows.filter((r) => r.window === 'after').map((r) => [r.teacher_id, r]))
  const matched = [...before.keys()].filter((id) => after.has(id))

  const windowStart = new Date(new Date(date).getTime() - days * 86400_000)
    .toISOString().slice(0, 10)

  const metrics: WithinSubjectMetric[] = METRICS.map((spec) => {
    const since = SIGNAL_SINCE[spec.signal]
    // The signal must have existed for the WHOLE before-window, not merely by
    // the release date — otherwise part of the baseline is missing data being
    // read as low behaviour.
    const comparable = since === null || windowStart >= since

    const deltas: number[] = []
    const beforeValues: number[] = []
    const afterValues: number[] = []
    for (const id of matched) {
      const b = Number(before.get(id)![spec.key])
      const a = Number(after.get(id)![spec.key])
      beforeValues.push(b)
      afterValues.push(a)
      deltas.push(a - b)
    }

    return {
      key:            spec.key,
      label:          spec.label,
      comparable,
      unavailable_before: comparable ? null : since,
      before_median:  comparable ? median(beforeValues) : null,
      after_median:   comparable ? median(afterValues) : null,
      // Median of per-teacher deltas — deliberately not the delta of medians.
      median_delta:   comparable ? median(deltas) : null,
      improved:       comparable ? deltas.filter((d) => d > 0).length : 0,
      worsened:       comparable ? deltas.filter((d) => d < 0).length : 0,
      unchanged:      comparable ? deltas.filter((d) => d === 0).length : 0,
    }
  })

  return {
    release_date:     date,
    window_days:      days,
    window_start:     windowStart,
    matched_teachers: matched.length,
    before_only:      [...before.keys()].filter((id) => !after.has(id)).length,
    after_only:       [...after.keys()].filter((id) => !before.has(id)).length,
    metrics,
  }
}
