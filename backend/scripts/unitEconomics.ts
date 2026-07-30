// CLI for TODO.md Feature AL Phase 1 — reads usage_rollup_monthly +
// institution_rollup_monthly (already computed via
// `npm run rollup:backfill`) and prints the unit-economics picture: cost
// distribution per plan tier (p50/p95/max — the free-tier p95 user is what
// kills freemium margin, not the average one), and per-institution
// seats/cost/revenue/margin.
//
// Deliberately a script, not a page — Phase 2 (AdminCapacity) is where this
// becomes a UI; this is "prove the numbers are right first."
//
// Usage (from backend/):
//   npm run rollup:report                  # latest rolled-up month
//   npm run rollup:report -- --month 2026-03

import { getUsageRollupForMonth, getInstitutionRollupForMonth, listRolledUpMonths, type UsageRollupRow } from '../src/db/queries/usageRollup'
import { getInstitutionById } from '../src/db/queries/institutions'
import { percentile } from '../src/services/usageRollup'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const FREE_COST_THRESHOLDS = [1, 3, 5]

function tierDistribution(rows: UsageRollupRow[]): void {
  const byTier = new Map<string, number[]>()
  for (const r of rows) {
    const list = byTier.get(r.effective_tier) ?? []
    list.push(r.cost_usd)
    byTier.set(r.effective_tier, list)
  }

  console.log('── cost distribution by effective tier ──')
  for (const [tier, costs] of [...byTier.entries()].sort()) {
    const sorted = [...costs].sort((a, b) => a - b)
    const n = sorted.length
    const mean = sorted.reduce((s, v) => s + v, 0) / n
    console.log(
      `  ${tier.padEnd(12)} n=${n}` +
      `  mean=$${mean.toFixed(2)}` +
      `  p50=$${percentile(sorted, 0.5).toFixed(2)}` +
      `  p95=$${percentile(sorted, 0.95).toFixed(2)}` +
      `  max=$${sorted[n - 1].toFixed(2)}`
    )
  }

  const freeCosts = byTier.get('free') ?? []
  if (freeCosts.length > 0) {
    console.log('\n── free-tier cost outliers (freemium margin risk) ──')
    for (const threshold of FREE_COST_THRESHOLDS) {
      const count = freeCosts.filter((c) => c > threshold).length
      console.log(`  free teachers costing more than $${threshold}: ${count} of ${freeCosts.length} (${((count / freeCosts.length) * 100).toFixed(0)}%)`)
    }
  }
}

async function institutionSummary(month: string): Promise<void> {
  const instRows = await getInstitutionRollupForMonth(month)
  const teacherRows = await getUsageRollupForMonth(month)
  if (instRows.length === 0) {
    console.log('\n(no institution rollup rows this month)')
    return
  }

  console.log('\n── per-institution ──')
  for (const inst of instRows) {
    const institution = await getInstitutionById(inst.institution_id)
    const teacherCost = teacherRows
      .filter((r) => r.institution_id === inst.institution_id)
      .reduce((s, r) => s + r.cost_usd, 0)
    const totalCost = teacherCost + inst.overhead_cost_usd
    const revenue = inst.amortized_revenue_usd
    const margin = revenue != null ? revenue - totalCost : null
    const utilization = inst.seats_purchased ? (inst.active_seats / inst.seats_purchased) * 100 : null
    const costPerSeat = inst.active_seats > 0 ? totalCost / inst.active_seats : 0

    console.log(`  ${institution?.name ?? inst.institution_id}`)
    console.log(
      `    seats: ${inst.active_seats} active` +
      (inst.seats_purchased != null ? ` / ${inst.seats_purchased} purchased (${utilization!.toFixed(0)}% utilization)` : ' (no contract on file)')
    )
    console.log(`    cost: $${totalCost.toFixed(2)}  (teachers $${teacherCost.toFixed(2)} + overhead $${inst.overhead_cost_usd.toFixed(2)})`)
    console.log(`    cost/active seat: $${costPerSeat.toFixed(2)}`)
    if (revenue != null) {
      console.log(`    revenue (amortized): $${revenue.toFixed(2)}/mo   margin: ${margin! >= 0 ? '+' : ''}$${margin!.toFixed(2)}`)
    } else {
      console.log(`    revenue: no contract covers this month — margin unknown`)
    }
  }
}

async function main(): Promise<void> {
  const rolledUpMonths = await listRolledUpMonths()
  if (rolledUpMonths.length === 0) {
    console.error('No rollup data yet. Run `npm run rollup:backfill` first.')
    process.exit(1)
  }

  const month = arg('month') ?? rolledUpMonths[rolledUpMonths.length - 1]
  const rows = await getUsageRollupForMonth(month)

  console.log(`Unit economics — ${month}`)
  console.log(`(tracking since ${rolledUpMonths[0]}, ${rolledUpMonths.length} month(s) available)`)
  if (rolledUpMonths.length < 3) {
    console.log('⚠ fewer than 3 months rolled up — this is a level, not a trend yet.')
  }
  console.log()

  if (rows.length === 0) {
    console.log('No teacher usage rows for this month.')
    process.exit(0)
  }

  tierDistribution(rows)
  await institutionSummary(month)
  process.exit(0)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
