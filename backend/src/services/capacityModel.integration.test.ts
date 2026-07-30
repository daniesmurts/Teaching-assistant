import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../db/connection'
import { createTestTeacher, createTestInstitution } from '../db/__tests__/fixtures'
import { createInstitutionContract } from '../db/queries/institutionContracts'
import { computeUsageRollupForMonth } from './usageRollup'
import { getCapacityOverview } from './capacityModel'
import { getDatabaseSizeBytes, getActiveConnectionCount, getEmbeddedAssignmentCount } from '../db/queries/capacity'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

const MONTH = '2026-04'

async function insertUsageLog(teacherId: string, institutionId: string | null, costUsd: number) {
  await pool.query(
    `INSERT INTO api_usage_log
       (teacher_id, institution_id, feature, model, input_tokens, output_tokens, cost_usd, duration_ms, success, created_at)
     VALUES ($1,$2,'grading','deepseek:test',500,0,$3,100,TRUE, $4::timestamptz)`,
    [teacherId, institutionId, costUsd, `${MONTH}-10T10:00:00Z`]
  )
}

describe('capacity.ts raw measurements', () => {
  it('returns positive, sane values from a real database', async () => {
    expect(await getDatabaseSizeBytes()).toBeGreaterThan(0)
    expect(await getActiveConnectionCount()).toBeGreaterThanOrEqual(1)   // this test's own connection
    expect(await getEmbeddedAssignmentCount()).toBeGreaterThanOrEqual(0)
  })
})

describe('getCapacityOverview', () => {
  it('returns null when no rollup data exists yet', async () => {
    // Deliberately no computeUsageRollupForMonth call — asserts the
    // "run rollup:backfill first" empty state, not a crash.
    const overview = await getCapacityOverview('1999-01')
    expect(overview).toBeNull()
  })

  it('assembles tier distribution, institution summaries, and headroom into one response', async () => {
    const institution = await createTestInstitution()
    const admin = await createTestTeacher()
    await createInstitutionContract({
      institutionId: institution.id, annualValueRub: 600_000, seatsPurchased: 50,
      termStart: '2026-01-01', termEnd: '2026-12-31', createdBy: admin.id,
    })
    const teacher = await createTestTeacher({ institutionId: institution.id })
    await insertUsageLog(teacher.id, institution.id, 2.0)

    await computeUsageRollupForMonth(MONTH)
    const overview = await getCapacityOverview(MONTH, 100)

    expect(overview).not.toBeNull()
    expect(overview!.month).toBe(MONTH)
    expect(overview!.activeTeachers).toBeGreaterThanOrEqual(1)
    expect(overview!.tierDistribution.length).toBeGreaterThan(0)

    const inst = overview!.institutions.find((i) => i.institutionId === institution.id)
    expect(inst).toBeDefined()
    expect(inst!.name).toBe(institution.name)
    expect(inst!.seatsPurchased).toBe(50)
    expect(inst!.revenueUsd).toBeGreaterThan(0)

    expect(overview!.headroom.scenarioTeachers).toBe(100)
    expect(overview!.headroom.resources.map((r) => r.key)).toContain('pgvector')
    expect(overview!.headroom.resources.map((r) => r.key)).toContain('db_connections')
    expect(overview!.headroom.resources.map((r) => r.key)).toContain('db_size')
    // db_size deliberately carries no ceiling — informational only.
    expect(overview!.headroom.resources.find((r) => r.key === 'db_size')?.ceiling).toBeNull()
  })

  it('defaults the scenario to current active-teacher count when none is given', async () => {
    const teacher = await createTestTeacher()
    await insertUsageLog(teacher.id, null, 1.0)
    await computeUsageRollupForMonth(MONTH)

    const overview = await getCapacityOverview(MONTH)
    expect(overview!.headroom.scenarioTeachers).toBe(overview!.activeTeachers)
  })
})
