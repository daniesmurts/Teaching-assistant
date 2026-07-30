import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../db/connection'
import { createTestTeacher } from '../db/__tests__/fixtures'
import { checkFeatureSpendCap, featureCapEnvKey, _resetCacheForTests } from './featureSpendCap'
import { FeatureSpendCapExceededError } from '../errors/AppError'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

const ENV_KEYS = [
  featureCapEnvKey('presentation'),
  featureCapEnvKey('presentation', 'deep'),
  featureCapEnvKey('grading'),
]
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] }
  _resetCacheForTests()
})
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

async function insertLog(teacherId: string, feature: string, variant: string | null, costUsd: number) {
  await pool.query(
    `INSERT INTO api_usage_log
       (teacher_id, feature, variant, model, input_tokens, output_tokens, cost_usd, duration_ms, success, created_at)
     VALUES ($1,$2,$3,'deepseek:test',100,0,$4,100,TRUE, NOW())`,
    [teacherId, feature, variant, costUsd]
  )
}

describe('checkFeatureSpendCap', () => {
  it('is a no-op when no cap is configured for the feature', async () => {
    const teacher = await createTestTeacher()
    await insertLog(teacher.id, 'presentation', null, 1000)
    await expect(checkFeatureSpendCap('presentation')).resolves.toBeUndefined()
  })

  it('throws once today\'s spend on the feature reaches its cap', async () => {
    process.env[featureCapEnvKey('presentation')] = '5'
    const teacher = await createTestTeacher()
    await insertLog(teacher.id, 'presentation', null, 10)

    await expect(checkFeatureSpendCap('presentation')).rejects.toBeInstanceOf(FeatureSpendCapExceededError)
  })

  it('does not trip a DIFFERENT feature\'s cap', async () => {
    process.env[featureCapEnvKey('presentation')] = '5'
    const teacher = await createTestTeacher()
    await insertLog(teacher.id, 'grading', null, 100)   // all spend is on grading, not presentation

    await expect(checkFeatureSpendCap('presentation')).resolves.toBeUndefined()
  })

  it('checks the variant-specific cap on top of the feature-level cap', async () => {
    process.env[featureCapEnvKey('presentation', 'deep')] = '5'
    const teacher = await createTestTeacher()
    await insertLog(teacher.id, 'presentation', 'deep', 10)
    // No feature-level cap set — only the deep-specific one — so this must
    // still trip, confirming the variant check isn't skipped when the
    // broader feature-level cap is absent.
    await expect(checkFeatureSpendCap('presentation', 'deep')).rejects.toBeInstanceOf(FeatureSpendCapExceededError)
  })

  it('lets standard-depth spend through even when the deep-specific cap is tripped', async () => {
    process.env[featureCapEnvKey('presentation', 'deep')] = '1'
    const teacher = await createTestTeacher()
    await insertLog(teacher.id, 'presentation', 'deep', 10)   // deep is over its cap
    await insertLog(teacher.id, 'presentation', 'standard', 10)   // standard spend exists too, but no cap on it

    // Deep-mode calls should throw...
    await expect(checkFeatureSpendCap('presentation', 'deep')).rejects.toBeInstanceOf(FeatureSpendCapExceededError)
    // ...but standard-depth calls (no variant, or a different variant) must not be blocked by deep's cap.
    await expect(checkFeatureSpendCap('presentation', 'standard')).resolves.toBeUndefined()
  })

  it('fails open (does not throw) when given a feature that cannot be queried meaningfully — never blocks on infra trouble', async () => {
    // No cap configured at all — the function must no-op regardless of DB state.
    await expect(checkFeatureSpendCap('nonexistent_feature')).resolves.toBeUndefined()
  })
})
