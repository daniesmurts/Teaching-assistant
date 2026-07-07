// Runs once per test file (vitest setupFiles). Loads .env.test into this
// worker's process.env — globalSetup runs in a separate process, so its
// env loading doesn't carry over here. Re-checks the safety guard as
// defense in depth: this is the one place a bug would be genuinely
// destructive (every test freely BEGINs/ROLLBACKs), so never trust a single
// check.
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(__dirname, '../.env.test') })

const url = process.env.DATABASE_URL
if (!url || !/test/i.test(new URL(url).pathname)) {
  throw new Error(
    `Integration tests refuse to run: DATABASE_URL does not look like a test database (${url ?? 'unset'}). ` +
    `Check .env.test at the repo root.`
  )
}
