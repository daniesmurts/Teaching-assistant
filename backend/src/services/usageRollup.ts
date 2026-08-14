// TODO.md Feature AL Phase 1 — computes usage_rollup_monthly +
// institution_rollup_monthly (migrations 106/107) from api_usage_log,
// teachers, institutions, institution_contracts, and payments. Designed
// script-first (scripts/backfillUsageRollup.ts, scripts/unitEconomics.ts) —
// no UI yet, that's Phase 2's AdminCapacity page.
//
// Pure functions here (amortizedRevenueForMonthRub, isOverheadFeature,
// percentile) are unit-tested without a DB; computeUsageRollupForMonth is
// the DB-touching orchestrator, covered by an integration test.

import { computeEffectiveTier } from '../lib/planTier'
import { logger } from '../lib/logger'
import { scheduleWithLease } from './schedulerLease'
import { getUsdRubRate, rubToUsd } from './fxRate'
import { getCurrentInstitutionContract } from '../db/queries/institutionContracts'
import {
  aggregateTeacherUsageForMonth, aggregateOverheadUsageForMonth, fetchPaymentsForAmortization,
  upsertUsageRollupRow, upsertInstitutionRollupRow,
  type PaymentForAmortization,
} from '../db/queries/usageRollup'

// rpd_reminder is triggered by whoever runs Мониторинг РПД (usually the
// УМЦ/УМУ head) but benefits the whole institution, not that one person —
// charged to institution overhead, not the triggering teacher (TODO.md,
// decided 2026-07-29). Cohort synthesis and institution-pool RAG retrieval
// are conceptually the same kind of shared work but are NOT yet separably
// tagged by `feature` (cohortSynthesis.ts logs as 'grading') — a known,
// documented gap, not something this pass silently gets wrong by omission.
export const OVERHEAD_FEATURES: readonly string[] = ['rpd_reminder']

export function isOverheadFeature(feature: string): boolean {
  return OVERHEAD_FEATURES.includes(feature)
}

function toMonthString(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthsBetween(fromMonth: string, toMonth: string): number {
  const [fy, fm] = fromMonth.split('-').map(Number)
  const [ty, tm] = toMonth.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

/**
 * Pure — how many ₽ of a given confirmed payment belong to `month`.
 * pro_monthly: the full amount, but only in the month it was confirmed —
 * no amortization, it's already a one-month unit.
 * pro_annual: 1/12 of the amount, for the 12 calendar months starting at
 * the confirmed month (inclusive) — summing amount_kopecks by confirmed
 * month instead would produce a fake profit spike in the confirmation
 * month and nothing for the other 11 (TODO.md's explicit example).
 */
export function amortizedRevenueForMonthRub(
  payment: Pick<PaymentForAmortization, 'plan' | 'amount_kopecks' | 'confirmed_at'>,
  month: string,
): number {
  const confirmedMonth = toMonthString(payment.confirmed_at)
  const rub = payment.amount_kopecks / 100

  if (payment.plan === 'pro_monthly') {
    return confirmedMonth === month ? rub : 0
  }
  if (payment.plan === 'pro_annual') {
    const offset = monthsBetween(confirmedMonth, month)
    return offset >= 0 && offset <= 11 ? rub / 12 : 0
  }
  return 0
}

/** Pure, nearest-rank percentile — good enough for a cost-distribution report, not a statistics library. `p` in [0,1]. */
export function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0
  const idx = Math.min(sortedAscending.length - 1, Math.floor(p * sortedAscending.length))
  return sortedAscending[idx]
}

export interface RollupSummary {
  month:           string
  teacherRows:     number
  institutionRows: number
}

export async function computeUsageRollupForMonth(month: string): Promise<RollupSummary> {
  const { rate, date: fxDate } = await getUsdRubRate()

  const teacherAggregates = await aggregateTeacherUsageForMonth(month, [...OVERHEAD_FEATURES])
  const payments = await fetchPaymentsForAmortization(month)
  const paymentsByTeacher = new Map<string, PaymentForAmortization[]>()
  for (const p of payments) {
    const list = paymentsByTeacher.get(p.teacher_id) ?? []
    list.push(p)
    paymentsByTeacher.set(p.teacher_id, list)
  }

  for (const agg of teacherAggregates) {
    const effectiveTier = computeEffectiveTier({
      plan_tier:             agg.plan_tier,
      plan_expires_at:       agg.plan_expires_at ? new Date(agg.plan_expires_at) : null,
      institution_id:        agg.institution_id,
      institution_plan_tier: agg.institution_plan_tier,
    })

    const revenueRub = (paymentsByTeacher.get(agg.teacher_id) ?? [])
      .reduce((sum, p) => sum + amortizedRevenueForMonthRub(p, month), 0)
    const hasRevenue = revenueRub > 0

    await upsertUsageRollupRow({
      month,
      teacherId:      agg.teacher_id,
      institutionId:  agg.institution_id,
      effectiveTier,
      callCount:      agg.call_count,
      totalTokens:    agg.total_tokens,
      costUsd:        agg.cost_usd,
      amortizedRevenueRub: hasRevenue ? revenueRub : null,
      amortizedRevenueUsd: hasRevenue ? rubToUsd(revenueRub, rate) : null,
      fxRateUsed:          hasRevenue ? rate : null,
      fxRateDate:          hasRevenue ? fxDate : null,
    })
  }

  const overheadAggregates = await aggregateOverheadUsageForMonth(month, [...OVERHEAD_FEATURES])
  const institutionIds = new Set<string>([
    ...overheadAggregates.map((a) => a.institution_id),
    ...teacherAggregates.filter((a): a is typeof a & { institution_id: string } => a.institution_id !== null)
      .map((a) => a.institution_id),
  ])

  for (const institutionId of institutionIds) {
    const overhead     = overheadAggregates.find((a) => a.institution_id === institutionId)
    const activeSeats  = teacherAggregates.filter((a) => a.institution_id === institutionId).length
    const contract     = await getCurrentInstitutionContract(institutionId, `${month}-01`)
    const revenueRub   = contract ? Number(contract.annual_value_rub) / 12 : null

    await upsertInstitutionRollupRow({
      month,
      institutionId,
      activeSeats,
      seatsPurchased:     contract?.seats_purchased ?? null,
      overheadCallCount:  overhead?.call_count ?? 0,
      overheadTokens:     overhead?.total_tokens ?? 0,
      overheadCostUsd:    overhead?.cost_usd ?? 0,
      amortizedRevenueRub: revenueRub,
      amortizedRevenueUsd: revenueRub != null ? rubToUsd(revenueRub, rate) : null,
      fxRateUsed:          revenueRub != null ? rate : null,
      fxRateDate:          revenueRub != null ? fxDate : null,
    })
  }

  return { month, teacherRows: teacherAggregates.length, institutionRows: institutionIds.size }
}

/** Current month + previous month, UTC — recomputing both on every tick catches late-arriving
 *  usage from just before/after a calendar boundary, not just the current one. */
export function monthsToRefresh(): string[] {
  const now = new Date()
  const cur  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return [prev, cur].map((d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
}

async function refreshRollups(): Promise<void> {
  for (const month of monthsToRefresh()) {
    try {
      const summary = await computeUsageRollupForMonth(month)
      logger.info({ message: '[UsageRollup] Recomputed', ...summary })
    } catch (err) {
      // A failed rollup must never crash the process — same fail-open posture as
      // every other background sampler/scheduler in this codebase (renewals.ts, resourceSampler.ts).
      logger.warn({ message: '[UsageRollup] Recompute failed', month, error: (err as Error).message })
    }
  }
}

/** Keeps usage_rollup_monthly / institution_rollup_monthly from going stale between manual
 *  `npm run rollup:backfill` runs — AdminCapacity's tier/margin numbers are a snapshot of
 *  whichever computeUsageRollupForMonth run last touched them, not a live query (unlike the
 *  provider-ceilings and resource-sampler sections of that page). Gated to PM2 worker 0 only —
 *  same precedent as services/renewals.ts's startRenewalScheduler — so cluster mode doesn't
 *  recompute the same month N times per tick. */
export function startUsageRollupScheduler(): void {
  const SIX_HOURS = 6 * 60 * 60 * 1000
  scheduleWithLease('usage_rollup', { intervalMs: SIX_HOURS, leaseMs: 5 * 60 * 60 * 1000, firstRunDelayMs: 2 * 60_000 },
    () => refreshRollups())
  logger.info({ message: 'Usage rollup scheduler started', intervalHours: 6 })
}
