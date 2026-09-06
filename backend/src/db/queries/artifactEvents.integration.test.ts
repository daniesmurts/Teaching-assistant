import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { recordArtifactEvent, getArtifactExports } from './artifactEvents'
import { getArtifactUsage } from './artifactUsage'
import { createTestTeacher, createTestCourse } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

/** recordArtifactEvent is deliberately fire-and-forget; await the write itself. */
async function recordAndSettle(params: Parameters<typeof recordArtifactEvent>[0]): Promise<void> {
  recordArtifactEvent(params)
  await new Promise((resolve) => setImmediate(resolve))
}

async function createPresentation(teacherId: string, courseId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO presentations (teacher_id, course_id, topic)
     VALUES ($1, $2, 'Тема') RETURNING id`,
    [teacherId, courseId]
  )
  return rows[0].id
}

describe('recordArtifactEvent', () => {
  it('records an export without the caller awaiting it', async () => {
    const t = await createTestTeacher()
    const course = await createTestCourse(t.id)
    const presentationId = await createPresentation(t.id, course.id)

    await recordAndSettle({
      kind: 'presentation', event: 'exported', artifactId: presentationId,
      teacherId: t.id, format: 'pptx',
    })

    const [row] = await getArtifactExports(30)
    expect(row.kind).toBe('presentation')
    expect(row.export_count).toBe(1)
    expect(row.exported_items).toBe(1)
  })

  // The point of the metric: two downloads of one deck is one deck that got
  // used, not two. Counting only export_count would flatter a feature that a
  // single teacher re-downloads.
  it('separates how many times something was exported from how many things were exported', async () => {
    const t = await createTestTeacher()
    const course = await createTestCourse(t.id)
    const deck = await createPresentation(t.id, course.id)

    await recordAndSettle({ kind: 'presentation', event: 'exported', artifactId: deck, teacherId: t.id, format: 'pptx' })
    await recordAndSettle({ kind: 'presentation', event: 'exported', artifactId: deck, teacherId: t.id, format: 'pdf' })

    const [row] = await getArtifactExports(30)
    expect(row.export_count).toBe(2)
    expect(row.exported_items).toBe(1)
    expect(row.export_teachers).toBe(1)
  })
})

describe('getArtifactUsage — created vs exported', () => {
  it('reports creation and export side by side for the same kind', async () => {
    const t = await createTestTeacher()
    const course = await createTestCourse(t.id)
    const a = await createPresentation(t.id, course.id)
    await createPresentation(t.id, course.id)   // generated, never exported

    await recordAndSettle({ kind: 'presentation', event: 'exported', artifactId: a, teacherId: t.id, format: 'pptx' })

    const row = (await getArtifactUsage(30)).find((r) => r.kind === 'presentation')!
    expect(row.period_count).toBe(2)
    expect(row.exported_items).toBe(1)
  })

  // Мониторинг РПД / УМЦ-готовность render from a live query and store no
  // row, so they exist in artifact_events and in no artefact table. Keying
  // the result off ARTIFACT_SOURCES alone would hide them entirely.
  it('surfaces an export-only kind that has no artefact table behind it', async () => {
    const t = await createTestTeacher()
    await recordAndSettle({ kind: 'umc_dashboard', event: 'exported', teacherId: t.id, format: 'xlsx' })

    const row = (await getArtifactUsage(30)).find((r) => r.kind === 'umc_dashboard')
    expect(row).toBeDefined()
    expect(row!.total_count).toBe(0)
    expect(row!.export_count).toBe(1)
    expect(row!.exported_items).toBe(0)   // no artifact_id to count
  })

  it('leaves export columns at zero for kinds nobody exported', async () => {
    const row = (await getArtifactUsage(30)).find((r) => r.kind === 'quiz')!
    expect(row.export_count).toBe(0)
    expect(row.export_teachers).toBe(0)
  })
})
