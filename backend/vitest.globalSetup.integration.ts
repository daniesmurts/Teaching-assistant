// Runs ONCE, in its own process, before any integration test file starts.
// Ensures the test database's schema is current — if a new migration
// landed since the test DB was last set up, this applies it automatically
// rather than tests failing with a mysterious "column does not exist".
import { config } from 'dotenv'
import { resolve } from 'node:path'

export default async function globalSetup(): Promise<void> {
  config({ path: resolve(__dirname, '../.env.test') })

  const url = process.env.DATABASE_URL
  if (!url || !/test/i.test(new URL(url).pathname)) {
    throw new Error(
      `Integration tests refuse to run: DATABASE_URL does not look like a test database (${url ?? 'unset'}). ` +
      `Check .env.test at the repo root.`
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { migrate } = require('./scripts/migrate.js') as { migrate: (connectionString: string) => Promise<void> }
  await migrate(url)
}
