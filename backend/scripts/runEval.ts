// CLI for the eval harness (flywheel replay experiment).
//
// Usage (from backend/):
//   npm run eval -- --teacher <uuid> [--course <uuid>] [--k 0,3,5,10]
//                   [--limit N] [--resume <runId>] [--csv out.csv] [--notes "..."]
//
// Re-running with --resume <runId> skips already-completed conditions, so an
// interrupted run picks up where it left off and costs nothing extra.

import { writeFileSync } from 'node:fs'
import { runReplay, summariseRun, exportRunCsv } from '../src/services/evalHarness'
import { pool } from '../src/db/connection'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const teacherId = arg('teacher')
  if (!teacherId) {
    console.error('Required: --teacher <uuid>')
    process.exit(1)
  }

  const conditions = (arg('k') ?? '0,3,5')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0)

  console.log(`Eval replay — teacher=${teacherId} course=${arg('course') ?? '(all)'} K=[${conditions.join(',')}]`)

  const progress = await runReplay(
    {
      teacherId,
      courseId:    arg('course'),
      conditions,
      limit:       arg('limit') ? parseInt(arg('limit')!, 10) : undefined,
      resumeRunId: arg('resume'),
      notes:       arg('notes'),
    },
    (p) => {
      if (p.done % 5 === 0 || p.done === p.total) {
        process.stdout.write(`\r  ${p.done}/${p.total} (skipped ${p.skipped}, failed ${p.failed})   `)
      }
    },
  )

  console.log(`\n\nRun ${progress.runId} complete: ${progress.done}/${progress.total}, failed ${progress.failed}`)

  // Summary table
  const summary = await summariseRun(progress.runId)
  if (summary.length === 0) {
    console.log('No usable results (all conditions failed or no approved assignments found).')
  } else {
    console.log('\n  K  | n    | avg examples | QWK    | MAE   | Spearman')
    console.log('  ---|------|--------------|--------|-------|---------')
    for (const s of summary) {
      console.log(
        `  ${String(s.k).padEnd(2)} | ${String(s.n).padEnd(4)} | ${s.meanExamples.toFixed(1).padEnd(12)} | ` +
        `${s.qwk != null ? s.qwk.toFixed(3) : '—'.padEnd(6)} | ${s.mae != null ? s.mae.toFixed(1).padEnd(5) : '—'} | ` +
        `${s.rho != null ? s.rho.toFixed(3) : '—'}`
      )
    }
  }

  const csvPath = arg('csv')
  if (csvPath) {
    writeFileSync(csvPath, await exportRunCsv(progress.runId))
    console.log(`\nRaw results written to ${csvPath}`)
  }

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
