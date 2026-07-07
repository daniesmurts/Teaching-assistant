#!/usr/bin/env node
/**
 * Migration runner — applies pending SQL files from backend/migrations/
 * Run with: node scripts/migrate.js
 * Reads DATABASE_URL from process.env (load via dotenv-cli or --env-file)
 */
const { Pool }  = require('pg')
const fs        = require('fs')
const path      = require('path')

// Exported so both this CLI and the integration-test globalSetup (which needs
// a fresh test DB migrated before the suite runs) share one implementation
// instead of two copies drifting apart. `connectionString` defaults to
// process.env.DATABASE_URL for the CLI path; the test harness passes the
// test DB's URL explicitly instead of relying on env at call time.
async function migrate(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  const pool = new Pool({ connectionString })

  // Ensure migrations tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  const applied = new Set(
    (await pool.query('SELECT filename FROM migrations ORDER BY filename')).rows
      .map(r => r.filename)
  )

  const dir   = path.join(__dirname, '../migrations')
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()

  let ran = 0
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  ✓ skip   ${file}`)
      continue
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8')
    await pool.query(sql)
    await pool.query('INSERT INTO migrations (filename) VALUES ($1)', [file])
    console.log(`  ✓ applied ${file}`)
    ran++
  }

  if (ran === 0) console.log('  All migrations already applied.')
  await pool.end()
}

module.exports = { migrate }

// CLI entry point — only runs when invoked directly (`node scripts/migrate.js`),
// not when required as a module by the integration-test setup.
if (require.main === module) {
  migrate().catch(err => { console.error('Migration failed:', err.message); process.exit(1) })
}
