// TODO.md Feature AL Phase 2 — the AdminCapacity page's data layer. Two
// halves: unit economics (reads Phase 1's rollup tables) and headroom
// (coefficient × scenario vs. ceiling, per docs/scaling.md's own
// thresholds). Deliberately NOT prediction — see TODO.md's framing note:
// "the human supplies the growth assumption via a scenario input; the page
// supplies headroom."

import {
  getUsageRollupForMonth, getInstitutionRollupForMonth, listRolledUpMonths,
  type UsageRollupRow, type InstitutionRollupRow,
} from '../db/queries/usageRollup'
import { getInstitutionById } from '../db/queries/institutions'
import { getDatabaseSizeBytes, getActiveConnectionCount, getEmbeddedAssignmentCount } from '../db/queries/capacity'
import { percentile } from './usageRollup'
import { getProviderCeilingsReport, type ProviderCeilingsReport } from './providerCeilings'

// ─── Unit economics ────────────────────────────────────────────────────────

export interface TierDistributionRow {
  tier: string
  n:    number
  mean: number
  p50:  number
  p95:  number
  max:  number
}

export function computeTierDistribution(rows: UsageRollupRow[]): TierDistributionRow[] {
  const byTier = new Map<string, number[]>()
  for (const r of rows) {
    const list = byTier.get(r.effective_tier) ?? []
    list.push(r.cost_usd)
    byTier.set(r.effective_tier, list)
  }
  return [...byTier.entries()]
    .map(([tier, costs]) => {
      const sorted = [...costs].sort((a, b) => a - b)
      const n = sorted.length
      return {
        tier, n,
        mean: n ? sorted.reduce((s, v) => s + v, 0) / n : 0,
        p50:  percentile(sorted, 0.5),
        p95:  percentile(sorted, 0.95),
        max:  n ? sorted[n - 1] : 0,
      }
    })
    .sort((a, b) => a.tier.localeCompare(b.tier))
}

export const FREE_COST_THRESHOLDS_USD = [1, 3, 5] as const

export interface FreeOutlierRow {
  thresholdUsd: number
  count:        number
  total:        number
}

export function computeFreeOutliers(rows: UsageRollupRow[]): FreeOutlierRow[] {
  const freeCosts = rows.filter((r) => r.effective_tier === 'free').map((r) => r.cost_usd)
  return FREE_COST_THRESHOLDS_USD.map((thresholdUsd) => ({
    thresholdUsd,
    count: freeCosts.filter((c) => c > thresholdUsd).length,
    total: freeCosts.length,
  }))
}

export interface InstitutionSummaryRow {
  institutionId:  string
  name:           string
  activeSeats:    number
  seatsPurchased: number | null
  utilizationPct: number | null
  costUsd:        number
  revenueUsd:     number | null
  marginUsd:      number | null
  costPerSeatUsd: number
}

export async function computeInstitutionSummaries(
  teacherRows: UsageRollupRow[], institutionRows: InstitutionRollupRow[],
): Promise<InstitutionSummaryRow[]> {
  const out: InstitutionSummaryRow[] = []
  for (const inst of institutionRows) {
    const institution = await getInstitutionById(inst.institution_id)
    const teacherCost = teacherRows
      .filter((r) => r.institution_id === inst.institution_id)
      .reduce((s, r) => s + r.cost_usd, 0)
    const costUsd = teacherCost + inst.overhead_cost_usd
    const revenueUsd = inst.amortized_revenue_usd
    out.push({
      institutionId:  inst.institution_id,
      name:           institution?.name ?? inst.institution_id,
      activeSeats:    inst.active_seats,
      seatsPurchased: inst.seats_purchased,
      utilizationPct: inst.seats_purchased ? (inst.active_seats / inst.seats_purchased) * 100 : null,
      costUsd,
      revenueUsd,
      marginUsd:      revenueUsd != null ? revenueUsd - costUsd : null,
      costPerSeatUsd: inst.active_seats > 0 ? costUsd / inst.active_seats : 0,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** ₽ per teacher isn't the point of a $ business; this reads the ₽-priced infra figure an operator sets once they know their VM cost. Unset by default — no guessed number pretending to be real, matching the Yandex-pricing-placeholder precedent this session already established. */
export function getMonthlyInfraCostUsd(): number | null {
  const raw = process.env.MONTHLY_INFRA_COST_USD
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

// ─── Headroom ───────────────────────────────────────────────────────────────

export interface ResourceHeadroom {
  key:             string
  label:           string
  unit:            string
  current:         number
  ceiling:         number | null
  ceilingLabel:    string
  projectedAtScenario: number | null
  breaksAtTeachers:    number | null
  // TODO.md Feature AL Phase 3 — for resources actually bound by
  // concurrency (db_connections), the mean-based breaksAtTeachers above
  // understates real risk. This is that number corrected by the empirical
  // peak-to-mean ratio (services/providerCeilings.ts) — null for resources
  // where peak concurrency isn't the relevant failure mode (pgvector,
  // db_size are cumulative totals, not concurrency-bound).
  breaksAtTeachersPeakAdjusted?: number | null
  note?:           string
}

/**
 * Pure — how many active teachers until `current` (measured at
 * `activeTeachers` today) would hit `ceiling`, assuming linear scaling.
 * Explicitly a MEAN-based estimate: a resource that's actually bound by
 * peak concurrency (DB connections, rate limits) will breach earlier than
 * this number suggests during сессия — Phase 3's peak-to-mean ratio is
 * what corrects for that. Returns null when there's nothing to project
 * (no ceiling, or zero usage/teachers to derive a coefficient from).
 */
export function computeBreaksAtTeachers(current: number, ceiling: number | null, activeTeachers: number): number | null {
  if (ceiling == null || activeTeachers <= 0 || current <= 0) return null
  const perTeacher = current / activeTeachers
  if (perTeacher <= 0) return null
  return Math.ceil(ceiling / perTeacher)
}

export function projectAtScenario(current: number, activeTeachers: number, scenarioTeachers: number): number | null {
  if (activeTeachers <= 0) return null
  return (current / activeTeachers) * scenarioTeachers
}

const PGVECTOR_REINDEX_TRIGGER = 50_000   // docs/scaling.md's own number
const DB_POOL_MAX_CONNECTIONS  = 50       // max=25 × 2 PM2 workers, connection.ts

export interface HeadroomResult {
  activeTeachers:    number
  scenarioTeachers:  number
  resources:         ResourceHeadroom[]
}

export async function computeHeadroom(activeTeachers: number, scenarioTeachers: number, peakToMeanRatio?: number | null): Promise<HeadroomResult> {
  const [dbSizeBytes, activeConnections, embeddedAssignments] = await Promise.all([
    getDatabaseSizeBytes(), getActiveConnectionCount(), getEmbeddedAssignmentCount(),
  ])

  const dbConnBreaksAt = computeBreaksAtTeachers(activeConnections, DB_POOL_MAX_CONNECTIONS, activeTeachers)
  // Peak-adjusted: if peak load runs R× the mean, the resource actually
  // reaches its ceiling at 1/R the naively-estimated teacher count —
  // fulfils the note Phase 2 originally left as "Phase 3 will refine".
  const dbConnBreaksAtPeakAdjusted =
    dbConnBreaksAt != null && peakToMeanRatio != null && peakToMeanRatio > 0
      ? Math.max(1, Math.ceil(dbConnBreaksAt / peakToMeanRatio))
      : null

  const resources: ResourceHeadroom[] = [
    {
      key: 'pgvector', label: 'Эмбеддинги (pgvector reindex)', unit: 'строк',
      current: embeddedAssignments, ceiling: PGVECTOR_REINDEX_TRIGGER,
      ceilingLabel: `${PGVECTOR_REINDEX_TRIGGER.toLocaleString('ru-RU')} строк (docs/scaling.md)`,
      projectedAtScenario: projectAtScenario(embeddedAssignments, activeTeachers, scenarioTeachers),
      breaksAtTeachers:    computeBreaksAtTeachers(embeddedAssignments, PGVECTOR_REINDEX_TRIGGER, activeTeachers),
      note: 'Кумулятивный итог, не зависит от пиковой конкурентности — поправка на пик здесь не нужна.',
    },
    {
      key: 'db_connections', label: 'Подключения к БД', unit: 'подключений',
      current: activeConnections, ceiling: DB_POOL_MAX_CONNECTIONS,
      ceilingLabel: `${DB_POOL_MAX_CONNECTIONS} (pool max=25 × 2 PM2-воркера)`,
      projectedAtScenario: projectAtScenario(activeConnections, activeTeachers, scenarioTeachers),
      breaksAtTeachers:    dbConnBreaksAt,
      breaksAtTeachersPeakAdjusted: dbConnBreaksAtPeakAdjusted,
      note: peakToMeanRatio != null
        ? `Оценка по среднему — до поправки на пик. Пиковая нагрузка в ${peakToMeanRatio.toFixed(1)}× выше средней (почасовые данные, Phase 3) — см. столбец «с поправкой на пик».`
        : 'Оценка по среднему, не по пику — недостаточно данных для расчёта пиковой нагрузки.',
    },
    {
      key: 'db_size', label: 'Размер базы данных', unit: 'МБ',
      current: Math.round(dbSizeBytes / 1_000_000), ceiling: null,
      ceilingLabel: 'нет фиксированного порога — зависит от диска ВМ (20 ГБ SSD), не измеряется изнутри приложения',
      projectedAtScenario: projectAtScenario(dbSizeBytes / 1_000_000, activeTeachers, scenarioTeachers),
      breaksAtTeachers: null,
      note: 'Справочно — не порог. Использование диска ВМ измеряется только Phase 4 (in-process sampler) или консолью Yandex Cloud.',
    },
  ]

  return { activeTeachers, scenarioTeachers, resources }
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export interface CapacityOverview {
  month:              string
  availableMonths:    string[]
  trackingSinceMonth: string | null
  isTrendReady:       boolean
  activeTeachers:     number
  tierDistribution:   TierDistributionRow[]
  freeOutliers:       FreeOutlierRow[]
  institutions:        InstitutionSummaryRow[]
  fixedCostUsd:        number | null
  variableCostPerTeacherUsd: number | null
  headroom:            HeadroomResult
  providerCeilings:    ProviderCeilingsReport   // TODO.md Feature AL Phase 3
}

export async function getCapacityOverview(month?: string, scenarioTeachers?: number): Promise<CapacityOverview | null> {
  const availableMonths = await listRolledUpMonths()
  if (availableMonths.length === 0) return null

  const resolvedMonth = month ?? availableMonths[availableMonths.length - 1]
  const [teacherRows, institutionRows, providerCeilings] = await Promise.all([
    getUsageRollupForMonth(resolvedMonth),
    getInstitutionRollupForMonth(resolvedMonth),
    getProviderCeilingsReport(),
  ])

  const activeTeachers = teacherRows.length
  const totalCost = teacherRows.reduce((s, r) => s + r.cost_usd, 0)
  const variableCostPerTeacherUsd = activeTeachers > 0 ? totalCost / activeTeachers : null

  return {
    month: resolvedMonth,
    availableMonths,
    trackingSinceMonth: availableMonths[0] ?? null,
    isTrendReady: availableMonths.length >= 3,
    activeTeachers,
    tierDistribution: computeTierDistribution(teacherRows),
    freeOutliers:      computeFreeOutliers(teacherRows),
    institutions:      await computeInstitutionSummaries(teacherRows, institutionRows),
    fixedCostUsd:      getMonthlyInfraCostUsd(),
    variableCostPerTeacherUsd,
    headroom: await computeHeadroom(activeTeachers, scenarioTeachers ?? activeTeachers, providerCeilings.peakToMean.ratio),
    providerCeilings,
  }
}
