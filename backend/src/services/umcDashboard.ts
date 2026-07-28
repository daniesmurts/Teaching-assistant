import { findReadinessRows } from '../db/queries/umcDashboard'
import type { UmcReadinessRow, UmcDepartmentSummary, UmcDashboardTotals, UmcDashboardResult } from '../../../shared/types'

// TODO.md Feature V — УМЦ dashboard. "Almost entirely assembly, not new
// capability": program_documents/program_document_reviews already carry
// every signal this needs (Feature K's coverage engine, migration 084's
// supersede-tracked РПД uploads). This file is the aggregation layer over
// findReadinessRows() — pure and unit-tested, same split as cohortAnalytics.ts.

const DEPARTMENT_FALLBACK = 'Без подразделения'

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Rolls a flat readiness-row list up by department. Pure — no DB, no AI. */
export function aggregateUmcDashboard(rows: UmcReadinessRow[]): { departments: UmcDepartmentSummary[]; totals: UmcDashboardTotals } {
  const byDept = new Map<string, UmcDepartmentSummary>()

  for (const r of rows) {
    const key = r.department_org_unit_id ?? '__none__'
    let dept = byDept.get(key)
    if (!dept) {
      dept = {
        department_org_unit_id: r.department_org_unit_id,
        department_name:        r.department_name ?? DEPARTMENT_FALLBACK,
        discipline_count:       0,
        syllabus_count:         0,
        reviewed_count:         0,
        avg_coverage:           null,
      }
      byDept.set(key, dept)
    }
    dept.discipline_count += 1
    if (r.has_syllabus) dept.syllabus_count += 1
    if (r.reviewed) dept.reviewed_count += 1
  }

  // Average coverage per department, computed over REVIEWED disciplines only
  // — a discipline with no review yet has no coverage number to average in,
  // and treating it as 0 would conflate "not yet checked" with "checked and
  // found lacking."
  const coverageSums = new Map<string, { sum: number; n: number }>()
  for (const r of rows) {
    if (r.overall_coverage == null) continue
    const key = r.department_org_unit_id ?? '__none__'
    const acc = coverageSums.get(key) ?? { sum: 0, n: 0 }
    acc.sum += r.overall_coverage
    acc.n += 1
    coverageSums.set(key, acc)
  }
  for (const [key, dept] of byDept) {
    const acc = coverageSums.get(key)
    dept.avg_coverage = acc ? round1(acc.sum / acc.n) : null
  }

  const departments = [...byDept.values()].sort((a, b) => a.department_name.localeCompare(b.department_name, 'ru'))

  const totals: UmcDashboardTotals = {
    discipline_count: rows.length,
    syllabus_count:   rows.filter((r) => r.has_syllabus).length,
    reviewed_count:   rows.filter((r) => r.reviewed).length,
    avg_coverage:     null,
  }
  const reviewed = rows.filter((r) => r.overall_coverage != null)
  if (reviewed.length > 0) {
    totals.avg_coverage = round1(reviewed.reduce((a, r) => a + (r.overall_coverage ?? 0), 0) / reviewed.length)
  }

  return { departments, totals }
}

export async function getUmcDashboard(institutionId: string, unitPathPrefixes?: string[]): Promise<UmcDashboardResult> {
  const rows = await findReadinessRows(institutionId, unitPathPrefixes)
  const { departments, totals } = aggregateUmcDashboard(rows)
  return { rows, departments, totals }
}
