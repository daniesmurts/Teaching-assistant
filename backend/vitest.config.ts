import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include:     ['src/**/*.test.ts'],
    // Even pure-function tests transitively import modules that read process.env
    // at import-time (db/connection.ts throws if DATABASE_URL is missing). Load
    // .env from the repo root before any test file runs so those imports go
    // through. When DB-backed tests land, swap to a Postgres test container.
    setupFiles:  ['./vitest.setup.ts'],
    globals:     false,
    reporters:   ['default'],
  },
})
