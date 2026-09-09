// ─── Release markers ─────────────────────────────────────────────────────────
//
// Dates worth drawing a vertical line at, so a chart can be read as "did this
// change when we shipped X" instead of "the line wobbles".
//
// A hardcoded list on purpose. A table would need an admin UI, and the person
// who knows what shipped is the person editing this repo — so it is versioned
// alongside the code that shipped, and adding a line here is part of the same
// commit as the feature.
//
// THE DATE IS THE DEPLOY DATE, not the commit or migration date. Behaviour can
// only change once users can reach the thing; migration 119 landed 2026-09-04
// and reached production with v1.6.0 the next day, and it is the second date
// that a curve could possibly bend around.
//
// Two honest limits worth keeping in mind when reading any line here:
//   • Features that ship together cannot be told apart in the data. v1.6.0
//     carried deck editing, tests-from-a-deck, .pptx import and the кафедральный
//     банк at once — a change after it is attributable to the release, never to
//     one of its parts.
//   • An `instrumentation` marker is not a feature at all. It is the date a
//     signal started existing, and NO comparison may cross it: before it the
//     metric is not low, it is absent.

export interface ReleaseMarker {
  /** ISO date (YYYY-MM-DD) the change reached production. */
  date:   string
  label:  string
  /** 'feature' — something users can now do. 'instrumentation' — something we can now see. */
  kind:   'feature' | 'instrumentation'
  /** What it was expected to move. Written down BEFORE the data arrives, so the reading isn't fitted to the result afterwards. */
  expect?: string
}

export const RELEASE_MARKERS: readonly ReleaseMarker[] = [
  {
    date:  '2026-09-05',
    label: 'v1.6.0 — правка слайдов, тесты и задания из презентации, импорт .pptx',
    kind:  'feature',
    expect: 'Доля колод, которые правят на платформе, растёт; доля выгружаемых падает — при неизменной или растущей «как-то использованы».',
  },
  {
    date:  '2026-09-06',
    label: 'Включён учёт выгрузок',
    kind:  'instrumentation',
    expect: 'Раньше этой даты выгрузок не «мало» — их не существует как сигнала. Сравнения через эту границу недействительны.',
  },
]
