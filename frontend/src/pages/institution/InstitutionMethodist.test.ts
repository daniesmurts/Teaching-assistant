import { describe, it, expect } from 'vitest'
import { queueUrgency } from './InstitutionMethodist'
import type { UmcReadinessRow } from '../../types'

// queueUrgency is the sole filter deciding what shows up in the Очередь
// triage list (TODO Feature AM, Phase 3) — a mistake here means either
// hiding a discipline that genuinely needs attention, or flooding the queue
// with disciplines that are actually fine.

function row(overrides: Partial<UmcReadinessRow> = {}): UmcReadinessRow {
  return {
    program_id: 'p1', program_name: 'Программа', program_code: null,
    department_org_unit_id: null, department_name: null,
    discipline_id: 'd1', discipline_name: 'Дисциплина', semester: 1,
    has_syllabus: true, syllabus_uploaded_at: '2026-01-01',
    reviewed: true, overall_coverage: 90, review_created_at: '2026-01-02',
    submission_status: null,
    ...overrides,
  }
}

describe('queueUrgency', () => {
  it('flags a discipline with no uploaded РПД at all', () => {
    expect(queueUrgency(row({ has_syllabus: false, reviewed: false, overall_coverage: null }))).toBe('no-rpd')
  })

  it('flags a discipline with a РПД that was never checked', () => {
    expect(queueUrgency(row({ has_syllabus: true, reviewed: false, overall_coverage: null }))).toBe('not-reviewed')
  })

  it('flags a reviewed discipline with coverage below 50%', () => {
    expect(queueUrgency(row({ reviewed: true, overall_coverage: 49 }))).toBe('low-coverage')
  })

  it('does not flag a reviewed discipline with coverage at or above 50%', () => {
    expect(queueUrgency(row({ reviewed: true, overall_coverage: 50 }))).toBeNull()
    expect(queueUrgency(row({ reviewed: true, overall_coverage: 90 }))).toBeNull()
  })

  it('treats a null coverage on a reviewed row as 0 (flags it), not as passing', () => {
    expect(queueUrgency(row({ reviewed: true, overall_coverage: null }))).toBe('low-coverage')
  })
})
