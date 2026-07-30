// CLI for TODO.md Feature AL Phase 1 — computes/recomputes
// usage_rollup_monthly + institution_rollup_monthly for the last N months
// (default 2, per the "backfill 2 months" decision) or an explicit month.
// Safe to re-run: computeUsageRollupForMonth upserts, it doesn't duplicate.
//
// Usage (from backend/):
//   npm run rollup:backfill                  # last 2 months
//   npm run rollup:backfill -- --months 6    # last 6 months
//   npm run rollup:backfill -- --month 2026-03   # one specific month

import { computeUsageRollupForMonth } from '../src/services/usageRollup'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

function monthsBack(n: number): string[] {
  const months: string[] = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return months.reverse()
}

async function main(): Promise<void> {
  const explicitMonth = arg('month')
  const months = explicitMonth ? [explicitMonth] : monthsBack(Number(arg('months') ?? '2'))

  console.log(`Usage rollup backfill — ${months.join(', ')}`)
  console.log()

  for (const month of months) {
    const start = Date.now()
    const summary = await computeUsageRollupForMonth(month)
    console.log(
      `  ${month}: ${summary.teacherRows} teacher-months, ${summary.institutionRows} institution-months` +
      `  (${((Date.now() - start) / 1000).toFixed(1)}s)`
    )
  }

  console.log('\nDone. Run `npm run rollup:report` to see the unit-economics summary.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
