// One-time (or re-run-anytime) setup for the integration-test database.
// Creates the test DB if missing, enables pgvector, then runs every
// migration against it — the same migration runner the real dev/prod DB
// uses (backend/scripts/migrate.js), so the test schema never drifts from
// what's actually deployed.
//
// Run with: npm run test:integration:setup

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { Client } from 'pg'

config({ path: resolve(__dirname, '../../.env.test') })

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('./migrate.js') as { migrate: (connectionString: string) => Promise<void> }

async function main(): Promise<void> {
  const testUrl = process.env.DATABASE_URL
  if (!testUrl) throw new Error('DATABASE_URL is not set — check .env.test')
  if (!/test/i.test(new URL(testUrl).pathname)) {
    throw new Error(`Refusing to run — DATABASE_URL does not look like a test database: ${testUrl}`)
  }

  const dbName = new URL(testUrl).pathname.replace(/^\//, '')

  // Postgres has no `CREATE DATABASE IF NOT EXISTS` — check pg_database first,
  // via a connection to the always-present `postgres` maintenance database.
  const maintenanceUrl = new URL(testUrl)
  maintenanceUrl.pathname = '/postgres'
  const admin = new Client({ connectionString: maintenanceUrl.toString() })
  await admin.connect()
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (rows.length === 0) {
      // Database names can't be parameterised — dbName came from our own
      // trusted .env.test, not user input.
      await admin.query(`CREATE DATABASE "${dbName}"`)
      console.log(`  ✓ created database ${dbName}`)
    } else {
      console.log(`  ✓ database ${dbName} already exists`)
    }
  } finally {
    await admin.end()
  }

  const testClient = new Client({ connectionString: testUrl })
  await testClient.connect()
  try {
    await testClient.query('CREATE EXTENSION IF NOT EXISTS vector')
    console.log('  ✓ pgvector extension enabled')
  } finally {
    await testClient.end()
  }

  console.log('  Running migrations against the test database…')
  await migrate(testUrl)
}

main().catch((err) => {
  console.error('Test DB setup failed:', err.message)
  process.exit(1)
})
