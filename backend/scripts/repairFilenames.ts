// One-shot backfill: restore Cyrillic filenames that were mangled by the
// Latin-1 multipart-header decode before middleware/fileValidation.ts
// started repairing them at upload time.
//
// Safe to re-run — rows whose names already look like valid Cyrillic (or
// pure ASCII) are skipped. Mojibake-only rows are converted using the same
// `repairUploadFilename` heuristic the live upload path uses, so behaviour
// is identical going forward.
//
// Usage (from backend/):
//   npm run repair:filenames                  # prints the plan, makes the changes
//   npm run repair:filenames -- --dry-run     # prints only, no UPDATEs

import { pool } from '../src/db/connection'
import { repairUploadFilename } from '../src/middleware/fileValidation'

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  // Limit the scan to rows that could plausibly be mojibake: contain at
  // least one byte in the Latin-1 supplement range. Skips the bulk of the
  // table (clean ASCII filenames) without loading everything into memory.
  const { rows } = await pool.query<{ id: string; file_name: string }>(
    `SELECT id, file_name
       FROM documents
      WHERE file_name ~ '[\\u0080-\\u00FF]'
      ORDER BY created_at ASC`
  )

  console.log(`Scanning ${rows.length} candidate rows...`)
  let fixed = 0
  let skipped = 0

  for (const r of rows) {
    const repaired = repairUploadFilename(r.file_name)
    if (repaired === r.file_name) {
      skipped++
      continue
    }
    console.log(`  ${r.id}`)
    console.log(`    before: ${JSON.stringify(r.file_name)}`)
    console.log(`    after:  ${JSON.stringify(repaired)}`)
    if (!dryRun) {
      await pool.query('UPDATE documents SET file_name = $1 WHERE id = $2', [repaired, r.id])
    }
    fixed++
  }

  console.log()
  console.log(`${fixed} repaired${dryRun ? ' (DRY RUN — no writes)' : ''}, ${skipped} already-correct`)
  await pool.end()
  process.exit(0)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
