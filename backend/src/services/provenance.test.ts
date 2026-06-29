import { describe, it, expect } from 'vitest'
import { computeProvenance } from './provenance'
import type { SubmissionTelemetry } from '../../../shared/types'

const tele = (p: Partial<SubmissionTelemetry>): SubmissionTelemetry => ({
  total_chars: 0, active_ms: 0, revision_count: 0,
  paste_count: 0, pasted_chars: 0, largest_paste: 0,
  started_at: '', last_edit_at: '', ...p,
})

describe('computeProvenance', () => {
  it('returns all-zero facts for null/empty telemetry', () => {
    const f = computeProvenance(null)
    expect(f).toMatchObject({ activeMinutes: 0, spanMinutes: 0, revisionCount: 0, totalChars: 0, pasteRatio: 0 })
    expect(f.startedAt).toBeNull()
  })

  it('converts active time to minutes (1 dp)', () => {
    expect(computeProvenance(tele({ active_ms: 252_000 })).activeMinutes).toBe(4.2)
  })

  it('computes wall-clock span in whole minutes', () => {
    const start = '2026-06-29T10:00:00.000Z'
    const end   = '2026-06-29T10:42:00.000Z'
    expect(computeProvenance(tele({ started_at: start, last_edit_at: end })).spanMinutes).toBe(42)
  })

  it('computes paste ratio and caps it at 1', () => {
    expect(computeProvenance(tele({ total_chars: 1000, pasted_chars: 800 })).pasteRatio).toBeCloseTo(0.8, 5)
    // pasted exceeding total (shouldn't happen) is clamped
    const f = computeProvenance(tele({ total_chars: 500, pasted_chars: 900 }))
    expect(f.pasteRatio).toBe(1)
    expect(f.pastedChars).toBeLessThanOrEqual(f.totalChars || f.pastedChars)
  })

  it('passes through revision count and largest paste, never a verdict', () => {
    const f = computeProvenance(tele({ revision_count: 230, largest_paste: 800, total_chars: 4000 }))
    expect(f.revisionCount).toBe(230)
    expect(f.largestPaste).toBe(800)
    // facts only — no score/flag fields exist on the shape
    expect(Object.keys(f)).not.toContain('score')
  })

  it('floors negative or missing values at zero', () => {
    const f = computeProvenance(tele({ active_ms: -100, revision_count: -5 }))
    expect(f.activeMinutes).toBe(0)
    expect(f.revisionCount).toBe(0)
  })
})
