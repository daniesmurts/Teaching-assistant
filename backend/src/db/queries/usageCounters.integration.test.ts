import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { getOrCreateCounter, incrementUsage } from './usageCounters'
import { createTestTeacher } from '../__tests__/fixtures'

// Transaction-per-test rollback — DB_POOL_MAX=1 (.env.test) means every
// query in this file routes through the pool's single connection, so BEGIN
// here and ROLLBACK after each test isolates every test with zero cleanup.
beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

const currentMonth = () => new Date().toISOString().slice(0, 7)

describe('getOrCreateCounter', () => {
  it('creates a zeroed row on first call', async () => {
    const teacher = await createTestTeacher()
    const counter = await getOrCreateCounter(teacher.id)
    expect(counter.grades_this_month).toBe(0)
    expect(counter.presentations_this_month).toBe(0)
    expect(counter.month_year).toBe(currentMonth())
  })

  it('returns the existing row on a second call rather than resetting it', async () => {
    const teacher = await createTestTeacher()
    await getOrCreateCounter(teacher.id)
    await incrementUsage(teacher.id, 'grade')
    const counter = await getOrCreateCounter(teacher.id)
    expect(counter.grades_this_month).toBe(1)
  })
})

describe('incrementUsage', () => {
  it('increments grades_this_month independently of presentations_this_month', async () => {
    const teacher = await createTestTeacher()
    await incrementUsage(teacher.id, 'grade')
    await incrementUsage(teacher.id, 'grade')
    await incrementUsage(teacher.id, 'presentation')
    const counter = await getOrCreateCounter(teacher.id)
    expect(counter.grades_this_month).toBe(2)
    expect(counter.presentations_this_month).toBe(1)
  })

  it('resets to 1, not N+1, when the stored month_year is a prior month', async () => {
    const teacher = await createTestTeacher()
    await incrementUsage(teacher.id, 'grade')
    await incrementUsage(teacher.id, 'grade')
    let counter = await getOrCreateCounter(teacher.id)
    expect(counter.grades_this_month).toBe(2)

    // Simulate a month rollover by backdating the stored month directly —
    // this is the one behavior that's genuinely hard to verify without a
    // real DB and real row state.
    await pool.query(`UPDATE usage_counters SET month_year = '2020-01' WHERE teacher_id = $1`, [teacher.id])

    await incrementUsage(teacher.id, 'grade')
    counter = await getOrCreateCounter(teacher.id)
    expect(counter.grades_this_month).toBe(1)
    expect(counter.month_year).toBe(currentMonth())
  })
})
