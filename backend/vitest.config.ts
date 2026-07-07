import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include:     ['src/**/*.test.ts'],
    // `*.integration.test.ts` also matches `*.test.ts` (suffix match, not an
    // exact-name match) — exclude explicitly. Those tests open a real DB
    // connection and belong to vitest.integration.config.ts only; without
    // this exclusion `npm test` would run them against whatever DATABASE_URL
    // vitest.setup.ts loads (the real dev DB, not a test one) — confirmed the
    // hard way once during development. Never remove this without also
    // verifying the integration suite still only runs under its own config.
    exclude:     ['**/node_modules/**', 'src/**/*.integration.test.ts'],
    // Even pure-function tests transitively import modules that read process.env
    // at import-time (db/connection.ts throws if DATABASE_URL is missing). Load
    // .env from the repo root before any test file runs so those imports go
    // through. When DB-backed tests land, swap to a Postgres test container.
    setupFiles:  ['./vitest.setup.ts'],
    globals:     false,
    reporters:   ['default'],
  },
})
