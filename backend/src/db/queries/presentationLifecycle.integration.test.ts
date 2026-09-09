import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { getPresentationLifecycle, getSlideEditHotspots, getRecentSlideInstructions } from './presentationLifecycle'
import { createTestTeacher, createTestCourse } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function deck(teacherId: string, courseId: string, daysAgo = 0): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO presentations (teacher_id, course_id, topic, created_at)
     VALUES ($1, $2, 'Тема', NOW() - ($3 || ' days')::INTERVAL) RETURNING id`,
    [teacherId, courseId, daysAgo]
  )
  return rows[0].id
}

async function editSlide(deckId: string, teacherId: string, opts: {
  event?: string; daysAgo?: number; slideType?: string; instruction?: string
} = {}): Promise<void> {
  await pool.query(
    `INSERT INTO presentation_slide_events
       (presentation_id, teacher_id, event, slide_index, slide_type, instruction, created_at)
     VALUES ($1,$2,$3,0,$4,$5, NOW() - ($6 || ' days')::INTERVAL)`,
    [deckId, teacherId, opts.event ?? 'edited', opts.slideType ?? 'content',
     opts.instruction ?? null, opts.daysAgo ?? 0]
  )
}

describe('getPresentationLifecycle — composite engagement', () => {
  // The whole point: a deck refined in place and never downloaded is used,
  // not abandoned. Scoring on exports alone would call this a failure.
  it('counts an edited-but-never-exported deck as engaged', async () => {
    const t = await createTestTeacher()
    const c = await createTestCourse(t.id)
    const d = await deck(t.id, c.id)
    await editSlide(d, t.id)

    const l = await getPresentationLifecycle(30)
    expect(l.total).toBe(1)
    expect(l.edited).toBe(1)
    expect(l.exported).toBe(0)
    expect(l.engaged).toBe(1)
  })

  it('counts a deck reused as a quiz or an assignment as engaged', async () => {
    const t = await createTestTeacher()
    const c = await createTestCourse(t.id)
    const d = await deck(t.id, c.id)
    await pool.query(
      `INSERT INTO quizzes (teacher_id, course_id, topic, question_count, questions, presentation_id)
       VALUES ($1,$2,'Тема',1,'[]'::jsonb,$3)`,
      [t.id, c.id, d]
    )

    const l = await getPresentationLifecycle(30)
    expect(l.reused).toBe(1)
    expect(l.engaged).toBe(1)
  })

  it('leaves a generated-and-abandoned deck out of every engagement count', async () => {
    const t = await createTestTeacher()
    const c = await createTestCourse(t.id)
    await deck(t.id, c.id)

    const l = await getPresentationLifecycle(30)
    expect(l.total).toBe(1)
    expect(l.engaged).toBe(0)
    expect(l.median_days_to_engagement).toBeNull()
  })

  // Export recording began on a specific date. A deck whose seven days
  // elapsed before it would report "never used" no matter what the teacher
  // did — that is the instrumentation's age, not a finding. On real data this
  // made 22 decks read as 1-of-22 before the gate was added.
  async function trackExportsSince(daysAgo: number, teacherId: string): Promise<void> {
    await pool.query(
      `INSERT INTO artifact_events (kind, event, teacher_id, created_at)
       VALUES ('presentation','exported',$1, NOW() - ($2 || ' days')::INTERVAL)`,
      [teacherId, daysAgo]
    )
  }

  it('excludes decks whose 7-day window predates export tracking', async () => {
    const t = await createTestTeacher()
    const c = await createTestCourse(t.id)
    await trackExportsSince(10, t.id)               // tracking began 10 days ago
    await deck(t.id, c.id, 25)                      // its week ended before that
    const visible = await deck(t.id, c.id, 9)       // fully inside the tracked era
    await editSlide(visible, t.id, { daysAgo: 8 })

    const l = await getPresentationLifecycle(30)
    expect(l.total).toBe(2)
    expect(l.mature_total).toBe(1)                  // not 2
    expect(l.engaged_within_7d).toBe(1)
    expect(l.export_tracking_since).not.toBeNull()
  })

  it('reports an empty comparable cohort rather than a confident zero when nothing is tracked yet', async () => {
    const t = await createTestTeacher()
    const c = await createTestCourse(t.id)
    await deck(t.id, c.id, 20)

    const l = await getPresentationLifecycle(30)
    expect(l.total).toBe(1)
    expect(l.mature_total).toBe(0)
    expect(l.engaged_within_7d).toBe(0)
    expect(l.export_tracking_since).toBeNull()
  })

  it('does not credit engagement that happened outside the 7-day window', async () => {
    const t = await createTestTeacher()
    const c = await createTestCourse(t.id)
    await trackExportsSince(30, t.id)
    const d = await deck(t.id, c.id, 20)
    await editSlide(d, t.id, { daysAgo: 2 })        // 18 days after creation

    const l = await getPresentationLifecycle(30)
    expect(l.mature_total).toBe(1)
    expect(l.engaged).toBe(1)
    expect(l.engaged_within_7d).toBe(0)
  })
})

describe('slide edit quality signals', () => {
  it('ranks slide types by how often teachers rewrite them', async () => {
    const t = await createTestTeacher()
    const c = await createTestCourse(t.id)
    const d = await deck(t.id, c.id)
    await editSlide(d, t.id, { slideType: 'formula', event: 'regenerated' })
    await editSlide(d, t.id, { slideType: 'formula', event: 'regenerated' })
    await editSlide(d, t.id, { slideType: 'title' })

    const [top] = await getSlideEditHotspots(30)
    expect(top.slide_type).toBe('formula')
    expect(top.events).toBe(2)
    expect(top.regenerations).toBe(2)
  })

  it('returns the teacher steer text, skipping empty ones', async () => {
    const t = await createTestTeacher()
    const c = await createTestCourse(t.id)
    const d = await deck(t.id, c.id)
    await editSlide(d, t.id, { event: 'regenerated', instruction: 'короче' })
    await editSlide(d, t.id, { event: 'edited', instruction: '   ' })

    const rows = await getRecentSlideInstructions(10)
    expect(rows).toHaveLength(1)
    expect(rows[0].instruction).toBe('короче')
  })
})
