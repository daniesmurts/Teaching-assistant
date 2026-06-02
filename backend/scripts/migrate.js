#!/usr/bin/env node
/**
 * Migration runner — applies pending SQL files from backend/migrations/
 * Run with: node scripts/migrate.js
 * Reads DATABASE_URL from process.env (load via dotenv-cli or --env-file)
 */
const { Pool }  = require('pg')
const fs        = require('fs')
const path      = require('path')

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error('❌  DATABASE_URL is not set')
    process.exit(1)
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

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

migrate().catch(err => { console.error('Migration failed:', err.message); process.exit(1) })
