import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../db/connection'
import { createTestTeacher, createTestInstitution } from '../db/__tests__/fixtures'
import { createInstitutionContract } from '../db/queries/institutionContracts'
import { getUsageRollupForMonth, getInstitutionRollupForMonth } from '../db/queries/usageRollup'
import { computeUsageRollupForMonth } from './usageRollup'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

const MONTH = '2026-03'

async function insertUsageLog(teacherId: string, opts: {
  institutionId?: string | null
  feature?:       string
  costUsd?:       number
  tokens?:        number
  day?:           string   // 'DD'
} = {}) {
  await pool.query(
    `INSERT INTO api_usage_log
       (teacher_id, institution_id, feature, model, input_tokens, output_tokens, cost_usd, duration_ms, success, created_at)
     VALUES ($1,$2,$3,'deepseek:test',$4,0,$5,100,TRUE, $6::timestamptz)`,
    [
      teacherId, opts.institutionId ?? null, opts.feature ?? 'grading',
      opts.tokens ?? 1000, opts.costUsd ?? 1.5,
      `${MONTH}-${opts.day ?? '15'}T10:00:00Z`,
    ]
  )
}

async function insertPayment(teacherId: string, plan: string, amountKopecks: number, confirmedAt: string) {
  await pool.query(
    `INSERT INTO payments (order_id, teacher_id, plan, amount_kopecks, status, confirmed_at)
     VALUES ($1, $2, $3, $4, 'confirmed', $5::timestamptz)`,
    [`order-${teacherId}-${Date.now()}-${Math.random()}`, teacherId, plan, amountKopecks, confirmedAt]
  )
}

describe('computeUsageRollupForMonth', () => {
  it('writes one usage_rollup_monthly row per teacher with usage that month', async () => {
    const teacher = await createTestTeacher()
    await insertUsageLog(teacher.id, { costUsd: 2.5, tokens: 2000 })
    await insertUsageLog(teacher.id, { costUsd: 1.0, tokens: 500 })

    const summary = await computeUsageRollupForMonth(MONTH)
    expect(summary.teacherRows).toBe(1)

    const rows = await getUsageRollupForMonth(MONTH)
    expect(rows).toHaveLength(1)
    expect(rows[0].teacher_id).toBe(teacher.id)
    expect(rows[0].call_count).toBe(2)
    expect(rows[0].total_tokens).toBe(2500)
    expect(rows[0].cost_usd).toBeCloseTo(3.5)
    expect(rows[0].effective_tier).toBe('free')
  })

  it('excludes platform-admin teachers entirely, not just their cost', async () => {
    const admin = await createTestTeacher()
    await pool.query('UPDATE teachers SET is_platform_admin = TRUE WHERE id = $1', [admin.id])
    await insertUsageLog(admin.id, { costUsd: 100 })

    await computeUsageRollupForMonth(MONTH)
    const rows = await getUsageRollupForMonth(MONTH)
    expect(rows.find((r) => r.teacher_id === admin.id)).toBeUndefined()
  })

  it('excludes overhead-feature calls from the teacher row and routes them to institution overhead instead', async () => {
    const institution = await createTestInstitution()
    const teacher = await createTestTeacher({ institutionId: institution.id })
    await insertUsageLog(teacher.id, { institutionId: institution.id, feature: 'grading', costUsd: 2.0 })
    await insertUsageLog(teacher.id, { institutionId: institution.id, feature: 'rpd_reminder', costUsd: 5.0 })

    await computeUsageRollupForMonth(MONTH)

    const teacherRows = await getUsageRollupForMonth(MONTH)
    const row = teacherRows.find((r) => r.teacher_id === teacher.id)
    expect(row?.cost_usd).toBeCloseTo(2.0)   // rpd_reminder's 5.0 excluded
    expect(row?.call_count).toBe(1)

    const instRows = await getInstitutionRollupForMonth(MONTH)
    const instRow = instRows.find((r) => r.institution_id === institution.id)
    expect(instRow?.overhead_cost_usd).toBeCloseTo(5.0)
    expect(instRow?.overhead_call_count).toBe(1)
  })

  it('computes effective_tier as institution for a teacher inheriting an institution-tier seat', async () => {
    const institution = await createTestInstitution({ planTier: 'institution' })
    const teacher = await createTestTeacher({ institutionId: institution.id })
    await insertUsageLog(teacher.id, { institutionId: institution.id })

    await computeUsageRollupForMonth(MONTH)
    const rows = await getUsageRollupForMonth(MONTH)
    expect(rows.find((r) => r.teacher_id === teacher.id)?.effective_tier).toBe('institution')
  })

  it('amortizes a pro_annual payment into this teacher\'s row', async () => {
    const teacher = await createTestTeacher()
    await insertUsageLog(teacher.id, { costUsd: 1.0 })
    await insertPayment(teacher.id, 'pro_annual', 1_200_000, `${MONTH}-01T00:00:00Z`)   // 12,000₽ → 1,000₽/mo

    await computeUsageRollupForMonth(MONTH)
    const rows = await getUsageRollupForMonth(MONTH)
    const row = rows.find((r) => r.teacher_id === teacher.id)
    expect(row?.amortized_revenue_rub).toBeCloseTo(1000)
    expect(row?.amortized_revenue_usd).toBeGreaterThan(0)
  })

  it('leaves amortized revenue null for a teacher with no payment that month', async () => {
    const teacher = await createTestTeacher()
    await insertUsageLog(teacher.id)
    await computeUsageRollupForMonth(MONTH)
    const rows = await getUsageRollupForMonth(MONTH)
    expect(rows.find((r) => r.teacher_id === teacher.id)?.amortized_revenue_rub).toBeNull()
  })

  it('computes institution active_seats as the count of teachers with usage that month, not seats_purchased', async () => {
    const institution = await createTestInstitution()
    await createInstitutionContract({
      institutionId: institution.id, annualValueRub: 1_200_000, seatsPurchased: 100,
      termStart: '2026-01-01', termEnd: '2026-12-31', createdBy: (await createTestTeacher()).id,
    })
    const active1 = await createTestTeacher({ institutionId: institution.id })
    const active2 = await createTestTeacher({ institutionId: institution.id })
    await createTestTeacher({ institutionId: institution.id })   // no usage this month — not active

    await insertUsageLog(active1.id, { institutionId: institution.id })
    await insertUsageLog(active2.id, { institutionId: institution.id })

    await computeUsageRollupForMonth(MONTH)
    const instRows = await getInstitutionRollupForMonth(MONTH)
    const row = instRows.find((r) => r.institution_id === institution.id)
    expect(row?.active_seats).toBe(2)
    expect(row?.seats_purchased).toBe(100)
    expect(row?.amortized_revenue_rub).toBeCloseTo(100_000)   // 1,200,000 / 12
  })

  it('leaves institution revenue null when no contract term covers this month', async () => {
    const institution = await createTestInstitution()
    const teacher = await createTestTeacher({ institutionId: institution.id })
    await insertUsageLog(teacher.id, { institutionId: institution.id })

    await computeUsageRollupForMonth(MONTH)
    const instRows = await getInstitutionRollupForMonth(MONTH)
    const row = instRows.find((r) => r.institution_id === institution.id)
    expect(row?.seats_purchased).toBeNull()
    expect(row?.amortized_revenue_rub).toBeNull()
  })

  it('is idempotent — recomputing the same month upserts rather than duplicating rows', async () => {
    const teacher = await createTestTeacher()
    await insertUsageLog(teacher.id, { costUsd: 1.0 })

    await computeUsageRollupForMonth(MONTH)
    await insertUsageLog(teacher.id, { costUsd: 2.0, day: '20' })
    await computeUsageRollupForMonth(MONTH)

    const rows = await getUsageRollupForMonth(MONTH)
    const matching = rows.filter((r) => r.teacher_id === teacher.id)
    expect(matching).toHaveLength(1)
    expect(matching[0].cost_usd).toBeCloseTo(3.0)   // reflects the second, fuller computation
  })
})
