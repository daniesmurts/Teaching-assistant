// Backfill embeddings for approved assignments that lack them.
//
// Needed once after migration 024 (provider switch), and harmless to re-run —
// it only touches rows where embedding IS NULL. Document chunks are NOT
// backfilled here: re-upload the document instead (extraction also improved).
//
// Usage (from backend/): npm run backfill:embeddings

import { pool } from '../src/db/connection'
import { embed } from '../src/services/deepseek'

async function main(): Promise<void> {
  const { rows } = await pool.query<{ id: string; teacher_id: string; submission_text: string }>(
    `SELECT id, teacher_id, submission_text FROM assignments
      WHERE status = 'approved' AND embedding IS NULL
      ORDER BY created_at ASC`
  )
  console.log(`${rows.length} approved assignments missing embeddings`)

  let ok = 0
  let failed = 0
  for (const row of rows) {
    try {
      const vector = await embed(row.submission_text, { teacherId: row.teacher_id, feature: 'embedding' })
      await pool.query(
        `UPDATE assignments SET embedding = $2 WHERE id = $1`,
        [row.id, `[${vector.join(',')}]`]
      )
      ok += 1
      process.stdout.write(`\r  ${ok + failed}/${rows.length} (failed ${failed})  `)
    } catch (err) {
      failed += 1
      console.error(`\n  ✗ ${row.id}: ${(err as Error).message}`)
    }
  }

  console.log(`\nDone: ${ok} embedded, ${failed} failed`)
  await pool.end()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => { console.error(err); process.exit(1) })
