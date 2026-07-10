import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import {
  findNudgeCandidates, claimNudge, getStalledTeachers, getFunnelSummary,
} from './activation'
import { createTestTeacher, createTestCourse, createTestAssignment } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function ageTeacher(teacherId: string, hoursAgo: number): Promise<void> {
  await pool.query(
    `UPDATE teachers SET created_at = NOW() - make_interval(hours => $2) WHERE id = $1`,
    [teacherId, hoursAgo]
  )
}

describe('findNudgeCandidates', () => {
  it('returns a 30h-old teacher with no grades for the 24h nudge', async () => {
    const t = await createTestTeacher()
    await ageTeacher(t.id, 30)
    const hits = await findNudgeCandidates('activation_24h', 24, 72)
    expect(hits.map((h) => h.id)).toContain(t.id)
  })

  it('excludes teachers outside the age window (too new / too old)', async () => {
    const fresh = await createTestTeacher()   // just created — under 24h
    const stale = await createTestTeacher()
    await ageTeacher(stale.id, 100)           // past the 72h ceiling
    const hits = await findNudgeCandidates('activation_24h', 24, 72)
    const ids = hits.map((h) => h.id)
    expect(ids).not.toContain(fresh.id)
    expect(ids).not.toContain(stale.id)
  })

  it('excludes a teacher who has already graded (reached the aha moment)', async () => {
    const t = await createTestTeacher()
    await ageTeacher(t.id, 30)
    const course = await createTestCourse(t.id)
    await createTestAssignment(t.id, course.id)
    const hits = await findNudgeCandidates('activation_24h', 24, 72)
    expect(hits.map((h) => h.id)).not.toContain(t.id)
  })

  it('excludes opted-out teachers', async () => {
    const t = await createTestTeacher()
    await ageTeacher(t.id, 30)
    await pool.query(`UPDATE teachers SET nudge_emails_enabled = FALSE WHERE id = $1`, [t.id])
    const hits = await findNudgeCandidates('activation_24h', 24, 72)
    expect(hits.map((h) => h.id)).not.toContain(t.id)
  })

  it('excludes teachers already sent this nudge type, but not other types', async () => {
    const t = await createTestTeacher()
    await ageTeacher(t.id, 80)   // inside the 72h–7d window
    await claimNudge(t.id, 'activation_24h')
    const hits24 = await findNudgeCandidates('activation_24h', 24, 72)
    const hits72 = await findNudgeCandidates('activation_72h', 72, 7 * 24)
    expect(hits24.map((h) => h.id)).not.toContain(t.id)   // sent (and out of window anyway)
    expect(hits72.map((h) => h.id)).toContain(t.id)        // different type — still due
  })
})

describe('claimNudge', () => {
  it('first claim wins, second is a no-op', async () => {
    const t = await createTestTeacher()
    expect(await claimNudge(t.id, 'activation_24h')).toBe(true)
    expect(await claimNudge(t.id, 'activation_24h')).toBe(false)
  })
})

describe('getStalledTeachers', () => {
  it('flags an unactivated teacher not seen for 48h+, and clears the flag once they grade', async () => {
    const t = await createTestTeacher()
    await ageTeacher(t.id, 60)   // 60h old, last_seen_at NULL → COALESCEs to created_at
    let stalled = await getStalledTeachers(500)
    expect(stalled.map((s) => s.id)).toContain(t.id)

    const course = await createTestCourse(t.id)
    await createTestAssignment(t.id, course.id)
    stalled = await getStalledTeachers(500)
    expect(stalled.map((s) => s.id)).not.toContain(t.id)
  })

  it('does not flag a teacher seen recently', async () => {
    const t = await createTestTeacher()
    await ageTeacher(t.id, 60)
    await pool.query(`UPDATE teachers SET last_seen_at = NOW() WHERE id = $1`, [t.id])
    const stalled = await getStalledTeachers(500)
    expect(stalled.map((s) => s.id)).not.toContain(t.id)
  })
})

describe('getFunnelSummary', () => {
  it('counts steps and the 24h window correctly', async () => {
    const before = await getFunnelSummary()

    // Activated inside 24h: signup 30h ago, graded 20h ago (10h after signup)
    const fast = await createTestTeacher()
    await ageTeacher(fast.id, 30)
    const fastCourse = await createTestCourse(fast.id)
    await createTestAssignment(fast.id, fastCourse.id, { createdAt: new Date(Date.now() - 20 * 3600_000) })

    // Never activated: signup only
    await createTestTeacher()

    const after = await getFunnelSummary()
    expect(after.total_teachers).toBe(before.total_teachers + 2)
    expect(after.reached_first_grade).toBe(before.reached_first_grade + 1)
    expect(after.graded_within_24h).toBe(before.graded_within_24h + 1)
  })
})
