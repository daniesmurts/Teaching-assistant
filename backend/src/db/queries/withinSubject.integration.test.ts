import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { getWithinSubjectComparison, median } from './withinSubject'
import { createTestTeacher, createTestCourse } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

// A fixed release date well after every signal started, so these tests
// exercise the comparison itself rather than the availability gate.
const RELEASE = '2026-10-01'
const day = (offset: number) => `${RELEASE}T00:00:00Z`.replace('2026-10-01', new Date(
  new Date('2026-10-01T00:00:00Z').getTime() + offset * 86400_000).toISOString().slice(0, 10))

async function deck(teacherId: string, courseId: string, offsetDays: number): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO presentations (teacher_id, course_id, topic, created_at)
     VALUES ($1,$2,'Тема',$3::timestamptz) RETURNING id`,
    [teacherId, courseId, day(offsetDays)]
  )
  return rows[0].id
}

async function markExported(deckId: string, teacherId: string, offsetDays: number): Promise<void> {
  await pool.query(
    `INSERT INTO artifact_events (kind, event, artifact_id, teacher_id, created_at)
     VALUES ('presentation','exported',$1,$2,$3::timestamptz)`,
    [deckId, teacherId, day(offsetDays)]
  )
}

const metric = (c: Awaited<ReturnType<typeof getWithinSubjectComparison>>, key: string) => {
  const m = c.metrics.find((x) => x.key === key)
  if (!m) throw new Error(`no metric ${key}`)
  return m
}

describe('median', () => {
  it('averages the middle pair on an even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([])).toBeNull()
  })
})

describe('getWithinSubjectComparison', () => {
  // The whole design: only teachers present on both sides are compared, so a
  // change cannot be manufactured by a different set of people showing up.
  it('compares only teachers active in both windows', async () => {
    const both = await createTestTeacher()
    const onlyBefore = await createTestTeacher()
    const onlyAfter = await createTestTeacher()
    const cb = await createTestCourse(both.id)
    const c1 = await createTestCourse(onlyBefore.id)
    const c2 = await createTestCourse(onlyAfter.id)

    await deck(both.id, cb.id, -3)
    await deck(both.id, cb.id, 3)
    await deck(onlyBefore.id, c1.id, -3)
    await deck(onlyAfter.id, c2.id, 3)

    const c = await getWithinSubjectComparison({ date: RELEASE, days: 14 })
    expect(c.matched_teachers).toBe(1)
    expect(c.before_only).toBe(1)
    expect(c.after_only).toBe(1)
  })

  // Median of per-teacher deltas, NOT delta of medians. Constructed so the two
  // disagree: every teacher improves by 1, but the pooled medians are equal.
  it('reports the median of per-teacher deltas, not the delta of medians', async () => {
    const a = await createTestTeacher()
    const b = await createTestTeacher()
    const ca = await createTestCourse(a.id)
    const cb = await createTestCourse(b.id)

    // A: 1 deck before, 2 after. B: 2 before, 3 after. Each +1.
    await deck(a.id, ca.id, -3)
    await deck(a.id, ca.id, 3); await deck(a.id, ca.id, 4)
    await deck(b.id, cb.id, -3); await deck(b.id, cb.id, -4)
    await deck(b.id, cb.id, 3); await deck(b.id, cb.id, 4); await deck(b.id, cb.id, 5)

    const c = await getWithinSubjectComparison({ date: RELEASE, days: 14 })
    const m = metric(c, 'decks_created')
    expect(m.median_delta).toBe(1)
    expect(m.improved).toBe(2)
    expect(m.worsened).toBe(0)
  })

  it('counts direction per teacher so a single outlier cannot define the result', async () => {
    const up1 = await createTestTeacher()
    const up2 = await createTestTeacher()
    const collapse = await createTestTeacher()
    for (const [t, beforeN, afterN] of [[up1, 1, 2], [up2, 1, 2], [collapse, 20, 1]] as const) {
      const course = await createTestCourse(t.id)
      for (let i = 0; i < beforeN; i++) await deck(t.id, course.id, -3)
      for (let i = 0; i < afterN; i++) await deck(t.id, course.id, 3)
    }

    const m = metric(await getWithinSubjectComparison({ date: RELEASE, days: 14 }), 'decks_created')
    expect(m.improved).toBe(2)
    expect(m.worsened).toBe(1)
    expect(m.median_delta).toBe(1)   // not dragged negative by the -19
  })

  it('computes per-teacher rates over that teacher own decks', async () => {
    const t = await createTestTeacher()
    const c = await createTestCourse(t.id)
    const b1 = await deck(t.id, c.id, -3)
    await deck(t.id, c.id, -4)                    // before: 1 of 2 exported
    await markExported(b1, t.id, -2)
    const a1 = await deck(t.id, c.id, 3)
    await markExported(a1, t.id, 4)               // after: 1 of 1 exported

    const m = metric(await getWithinSubjectComparison({ date: RELEASE, days: 14 }), 'exported_share')
    expect(m.before_median).toBe(0.5)
    expect(m.after_median).toBe(1)
    expect(m.median_delta).toBe(0.5)
  })
})

describe('signal availability gate', () => {
  // The failure this prevents is the most flattering one available: telemetry
  // switching on mid-window reads as the release causing a jump.
  it('refuses to compare a metric whose signal did not exist for the whole before-window', async () => {
    const t = await createTestTeacher()
    const c = await createTestCourse(t.id)
    await createTestCourse(t.id)
    await pool.query(
      `INSERT INTO presentations (teacher_id, course_id, topic, created_at)
       VALUES ($1,$2,'Тема','2026-09-04T00:00:00Z'), ($1,$2,'Тема','2026-09-08T00:00:00Z')`,
      [t.id, c.id]
    )

    // Release 2026-09-06, window 5 days → before-window starts 2026-09-01,
    // earlier than export recording (2026-09-06).
    const cmp = await getWithinSubjectComparison({ date: '2026-09-06', days: 5 })
    const exported = metric(cmp, 'exported_share')
    expect(exported.comparable).toBe(false)
    expect(exported.median_delta).toBeNull()
    expect(exported.unavailable_before).toBe('2026-09-06')

    // Deck creation is derived from the table itself and has always existed.
    expect(metric(cmp, 'decks_created').comparable).toBe(true)
  })
})
