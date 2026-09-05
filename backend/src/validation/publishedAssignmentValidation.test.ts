import { describe, it, expect } from 'vitest'
import { isAllowedTelemetry } from './publishedAssignmentValidation'
import { SUBMISSION_TELEMETRY_KEYS } from '../../../shared/types'
import type { SubmissionTelemetry } from '../../../shared/types'

// Regression: the hand-written allowlist omitted `paste_count`, which
// StudentWrite.tsx has always sent because it is on the SubmissionTelemetry
// interface. Every draft save and every submit answered 400 «Недопустимые поля
// телеметрии» — the student writing surface was entirely down, and no test
// caught it because none had ever checked the server against a real payload.

const FROM_THE_CLIENT: SubmissionTelemetry = {
  total_chars: 142, active_ms: 61_000, revision_count: 17,
  paste_count: 1, pasted_chars: 120, largest_paste: 120,
  started_at: '2026-09-05T07:00:00.000Z', last_edit_at: '2026-09-05T07:01:00.000Z',
}

describe('isAllowedTelemetry', () => {
  it('accepts the exact object the student editor sends', () => {
    expect(isAllowedTelemetry(FROM_THE_CLIENT)).toBe(true)
  })

  it('accepts paste_count specifically', () => {
    // The single key whose absence took the feature down.
    expect(isAllowedTelemetry({ paste_count: 3 })).toBe(true)
  })

  it('covers every key of the shared type, with none left over', () => {
    // The other half of the guard: if someone adds a field to
    // SubmissionTelemetry, this fails until the allowlist knows about it —
    // and shared/types.ts fails to compile first.
    expect([...SUBMISSION_TELEMETRY_KEYS].sort()).toEqual(Object.keys(FROM_THE_CLIENT).sort())
    for (const key of SUBMISSION_TELEMETRY_KEYS) {
      expect(isAllowedTelemetry({ [key]: 1 })).toBe(true)
    }
  })

  it('still rejects a field nobody declared — the allowlist is the point', () => {
    // §5.1.2: teachers only ever see aggregates, so raw process data must not
    // be smuggled in under an unknown key.
    expect(isAllowedTelemetry({ ...FROM_THE_CLIENT, keystrokes: ['п', 'р'] })).toBe(false)
    expect(isAllowedTelemetry({ raw_paste_text: 'скопированный текст' })).toBe(false)
  })

  it('rejects non-objects', () => {
    expect(isAllowedTelemetry(null)).toBe(false)
    expect(isAllowedTelemetry('telemetry')).toBe(false)
  })
})
