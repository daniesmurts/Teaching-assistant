import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../db/connection'
import { createTestTeacher } from '../db/__tests__/fixtures'
import { getPeakToMeanRatio, getRateLimitKnee, getAccountCeilings, getProviderCeilingsReport } from './providerCeilings'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function insertLog(teacherId: string, opts: {
  hoursAgo?: number; account?: string | null; errorCode?: string | null; success?: boolean; costUsd?: number
} = {}) {
  await pool.query(
    `INSERT INTO api_usage_log
       (teacher_id, feature, model, input_tokens, output_tokens, cost_usd, duration_ms, success, error_code, account, created_at)
     VALUES ($1,'grading','deepseek:test',100,0,$2,100,$3,$4,$5, NOW() - ($6 || ' hours')::interval)`,
    [teacherId, opts.costUsd ?? 1, opts.success ?? true, opts.errorCode ?? null, opts.account ?? null, opts.hoursAgo ?? 0]
  )
}

describe('getPeakToMeanRatio', () => {
  it('computes a real ratio from a burst of calls concentrated in one hour', async () => {
    const teacher = await createTestTeacher()
    // 10 calls all within the same hour (hoursAgo=1), nothing else in the window.
    for (let i = 0; i < 10; i++) await insertLog(teacher.id, { hoursAgo: 1 })

    const { ratio, totalCalls, peakHourlyCalls } = await getPeakToMeanRatio(1)
    expect(totalCalls).toBe(10)
    expect(peakHourlyCalls).toBe(10)
    expect(ratio).toBeGreaterThan(1)   // concentrated in 1 of 24 hours → well above the mean
  })

  it('returns a null ratio when there is no usage in the window', async () => {
    const { ratio, totalCalls } = await getPeakToMeanRatio(1)
    expect(totalCalls).toBe(0)
    expect(ratio).toBeNull()
  })
})

describe('getRateLimitKnee', () => {
  it('reports observed:false when no 429s exist in the window', async () => {
    const teacher = await createTestTeacher()
    await insertLog(teacher.id, { hoursAgo: 1 })
    const knee = await getRateLimitKnee(1)
    expect(knee.observed).toBe(false)
  })

  it('reports observed:true and a bracket when a 429 occurred', async () => {
    const teacher = await createTestTeacher()
    for (let i = 0; i < 5; i++) await insertLog(teacher.id, { hoursAgo: 2 })   // clean hour, 5 calls
    for (let i = 0; i < 8; i++) await insertLog(teacher.id, { hoursAgo: 5, errorCode: 'HTTP_429', success: false })   // rate-limited hour, 8 calls

    const knee = await getRateLimitKnee(1)
    expect(knee.observed).toBe(true)
    expect(knee.maxHourlyVolumeWithoutRateLimit).toBe(5)
    expect(knee.minHourlyVolumeWithRateLimit).toBe(8)
  })
})

describe('getAccountCeilings', () => {
  it('returns empty when no rows carry an account label', async () => {
    const teacher = await createTestTeacher()
    await insertLog(teacher.id, { account: null })
    expect(await getAccountCeilings(30)).toEqual([])
  })

  it('summarises burn rate and failure history per account', async () => {
    const teacher = await createTestTeacher()
    await insertLog(teacher.id, { account: 'primary', costUsd: 3, success: true })
    await insertLog(teacher.id, { account: 'primary', costUsd: 0, success: false, errorCode: 'HTTP_402', hoursAgo: 1 })
    await insertLog(teacher.id, { account: 'secondary', costUsd: 10, success: true })

    const ceilings = await getAccountCeilings(30)
    const primary = ceilings.find((c) => c.account === 'primary')!
    const secondary = ceilings.find((c) => c.account === 'secondary')!

    expect(primary.burnRatePerDayUsd).toBeCloseTo(3 / 30)
    expect(primary.balanceFailures).toBe(1)
    expect(primary.failureCount).toBe(1)
    expect(secondary.burnRatePerDayUsd).toBeCloseTo(10 / 30)
    expect(secondary.balanceFailures).toBe(0)
  })
})

describe('getProviderCeilingsReport', () => {
  it('assembles peak-to-mean, rate-limit knee, and account ceilings into one report', async () => {
    const teacher = await createTestTeacher()
    await insertLog(teacher.id, { account: 'primary', costUsd: 1 })

    const report = await getProviderCeilingsReport(7)
    expect(report.windowDays).toBe(7)
    expect(report.peakToMean.totalCalls).toBeGreaterThan(0)
    expect(report.accounts.length).toBeGreaterThan(0)
    expect(report.yandexEmbedSpofNote).toContain('Yandex')
  })
})
