import { describe, it, expect } from 'vitest'
import { aggregateUmcDashboard } from './umcDashboard'
import type { UmcReadinessRow } from '../../../shared/types'

let seq = 0
function row(overrides: Partial<UmcReadinessRow>): UmcReadinessRow {
  seq++
  return {
    program_id:             overrides.program_id ?? `prog-${seq}`,
    program_name:           overrides.program_name ?? `Программа ${seq}`,
    program_code:           overrides.program_code ?? null,
    department_org_unit_id: 'department_org_unit_id' in overrides ? overrides.department_org_unit_id! : 'dept-1',
    department_name:        'department_name' in overrides ? overrides.department_name! : 'Кафедра машиностроения',
    discipline_id:          overrides.discipline_id ?? `disc-${seq}`,
    discipline_name:        overrides.discipline_name ?? `Дисциплина ${seq}`,
    semester:                overrides.semester ?? 1,
    has_syllabus:            overrides.has_syllabus ?? false,
    syllabus_uploaded_at:    overrides.syllabus_uploaded_at ?? null,
    reviewed:                overrides.reviewed ?? false,
    overall_coverage:        overrides.overall_coverage ?? null,
    review_created_at:       overrides.review_created_at ?? null,
    submission_status:       overrides.submission_status ?? null,
  }
}

describe('aggregateUmcDashboard', () => {
  it('counts disciplines/syllabi/reviews per department', () => {
    const { departments } = aggregateUmcDashboard([
      row({ has_syllabus: true, reviewed: true, overall_coverage: 80 }),
      row({ has_syllabus: true, reviewed: false }),
      row({ has_syllabus: false, reviewed: false }),
    ])
    expect(departments).toHaveLength(1)
    expect(departments[0]).toMatchObject({
      discipline_count: 3, syllabus_count: 2, reviewed_count: 1,
    })
  })

  it('averages coverage only over reviewed disciplines, not the whole department', () => {
    const { departments } = aggregateUmcDashboard([
      row({ reviewed: true, overall_coverage: 90 }),
      row({ reviewed: true, overall_coverage: 70 }),
      row({ reviewed: false, overall_coverage: null }),   // not-yet-reviewed — must not drag the average toward 0
    ])
    expect(departments[0].avg_coverage).toBe(80)
  })

  it('reports null avg_coverage for a department with no reviews at all', () => {
    const { departments } = aggregateUmcDashboard([
      row({ reviewed: false }), row({ reviewed: false }),
    ])
    expect(departments[0].avg_coverage).toBeNull()
  })

  it('splits rows into separate departments, keyed by org unit id', () => {
    const { departments } = aggregateUmcDashboard([
      row({ department_org_unit_id: 'dept-1', department_name: 'Кафедра А' }),
      row({ department_org_unit_id: 'dept-2', department_name: 'Кафедра Б' }),
      row({ department_org_unit_id: 'dept-2', department_name: 'Кафедра Б' }),
    ])
    expect(departments).toHaveLength(2)
    const deptB = departments.find((d) => d.department_org_unit_id === 'dept-2')
    expect(deptB?.discipline_count).toBe(2)
  })

  it('buckets programmes with no org-tree link under a single null-keyed department', () => {
    const { departments } = aggregateUmcDashboard([
      row({ department_org_unit_id: null, department_name: null }),
      row({ department_org_unit_id: null, department_name: null }),
    ])
    expect(departments).toHaveLength(1)
    expect(departments[0].department_name).toBe('Без подразделения')
    expect(departments[0].discipline_count).toBe(2)
  })

  it('sorts departments alphabetically', () => {
    const { departments } = aggregateUmcDashboard([
      row({ department_org_unit_id: 'dept-b', department_name: 'Ябедово' }),
      row({ department_org_unit_id: 'dept-a', department_name: 'Абрамово' }),
    ])
    expect(departments.map((d) => d.department_name)).toEqual(['Абрамово', 'Ябедово'])
  })

  it('computes institution-wide totals across all departments', () => {
    const { totals } = aggregateUmcDashboard([
      row({ department_org_unit_id: 'dept-1', has_syllabus: true, reviewed: true, overall_coverage: 100 }),
      row({ department_org_unit_id: 'dept-2', has_syllabus: false, reviewed: false }),
    ])
    expect(totals).toMatchObject({
      discipline_count: 2, syllabus_count: 1, reviewed_count: 1, avg_coverage: 100,
    })
  })

  it('returns an empty department list and zeroed totals for no rows', () => {
    const { departments, totals } = aggregateUmcDashboard([])
    expect(departments).toEqual([])
    expect(totals).toEqual({ discipline_count: 0, syllabus_count: 0, reviewed_count: 0, avg_coverage: null })
  })
})
