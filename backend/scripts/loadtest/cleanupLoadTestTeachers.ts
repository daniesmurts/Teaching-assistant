// Deletes every teacher seeded by seedLoadTestTeachers.ts (matched by the
// loadtest.ispum.internal email domain). ON DELETE CASCADE on teacher_id
// FKs takes their courses/assignments/etc. with them.
//
// Usage:
//   node --env-file=../../.env $(npm root)/.bin/tsx scripts/loadtest/cleanupLoadTestTeachers.ts

import { pool } from '../../src/db/connection'

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) throw new Error('DATABASE_URL is not set')
  if (!/staging|test|loadtest/i.test(dbUrl)) {
    throw new Error(`Refusing to clean up — DATABASE_URL does not look like staging/test: ${dbUrl}`)
  }

  const { rowCount } = await pool.query(
    `DELETE FROM teachers WHERE email LIKE '%@loadtest.ispum.internal'`
  )
  console.log(`Deleted ${rowCount} load-test teachers.`)
  await pool.end()
}

main().catch((err) => {
  console.error('Cleanup failed:', err.message)
  process.exit(1)
})
