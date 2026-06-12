// CLI for the confidence / risk-coverage study.
//
// Usage (from backend/):
//   npm run eval:confidence -- --teacher <uuid> [--course <uuid>]
//        [--k 5] [--samples 3] [--limit N] [--resume <runId>] [--notes "..."]
//
// Runs the grader ensemble over each approved assignment, then prints the
// risk-coverage curve (the headline selective-prediction result), the binned
// dispersion→error calibration, and per-label aggregates.

import { runConfidenceReplay, summariseConfidence } from '../src/services/evalHarness'
import { pool } from '../src/db/connection'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const teacherId = arg('teacher')
  if (!teacherId) { console.error('Required: --teacher <uuid>'); process.exit(1) }

  const k       = arg('k') ? parseInt(arg('k')!, 10) : 5
  const samples = arg('samples') ? parseInt(arg('samples')!, 10) : 3

  console.log(`Confidence replay — teacher=${teacherId} course=${arg('course') ?? '(all)'} K=${k} samples=${samples}`)

  const progress = await runConfidenceReplay(
    {
      teacherId,
      courseId:    arg('course'),
      k,
      samples,
      limit:       arg('limit') ? parseInt(arg('limit')!, 10) : undefined,
      resumeRunId: arg('resume'),
      notes:       arg('notes'),
    },
    (p) => {
      if (p.done % 3 === 0 || p.done === p.total) {
        process.stdout.write(`\r  ${p.done}/${p.total} (failed ${p.failed})   `)
      }
    },
  )

  console.log(`\n\nRun ${progress.runId} complete: ${progress.done}/${progress.total}, failed ${progress.failed}`)

  const s = await summariseConfidence(progress.runId)
  if (s.n === 0) { console.log('No usable results.'); await pool.end(); return }

  console.log(`\n── Risk-coverage (n=${s.n}) ──`)
  console.log('  coverage | n    | mean error | grade acc | std ≤')
  console.log('  ---------|------|------------|-----------|------')
  for (const c of s.riskCoverage) {
    console.log(
      `  ${(c.coverage * 100).toFixed(0).padStart(7)}% | ${String(c.n).padEnd(4)} | ` +
      `${c.meanError.toFixed(1).padStart(10)} | ${(c.gradeAccuracy * 100).toFixed(0).padStart(8)}% | ${c.signalMax.toFixed(1)}`
    )
  }

  console.log(`\n── Dispersion → error calibration (terciles) ──`)
  console.log('  bin | n   | std range    | mean error | grade acc')
  for (const b of s.calibration) {
    console.log(
      `  ${b.bin}   | ${String(b.n).padEnd(3)} | ${b.signalLow.toFixed(1)}–${b.signalHigh.toFixed(1).padEnd(6)} | ` +
      `${b.meanError.toFixed(1).padStart(10)} | ${(b.gradeAccuracy * 100).toFixed(0)}%`
    )
  }

  console.log(`\n── By confidence label ──`)
  for (const l of s.byLabel) {
    console.log(`  ${l.confidence.padEnd(6)} n=${l.n}  mean error ${l.meanError.toFixed(1)}  grade acc ${(l.gradeAccuracy * 100).toFixed(0)}%`)
  }

  console.log(`\nSelectivity gain (error gap least- vs most-confident tercile): ${s.selectivity.toFixed(1)} points`)

  await pool.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
