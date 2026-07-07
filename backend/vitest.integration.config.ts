import { defineConfig } from 'vitest/config'

// DB-backed integration tests — separate from vitest.config.ts (pure
// functions only) so a contributor without local Postgres can still run
// `npm test`. Run via `npm run test:integration` after a one-time
// `npm run test:integration:setup` to create + migrate the test database.
export default defineConfig({
  test: {
    environment: 'node',
    include:     ['src/**/*.integration.test.ts'],
    setupFiles:  ['./vitest.setup.integration.ts'],
    globalSetup: ['./vitest.globalSetup.integration.ts'],
    globals:     false,
    reporters:   ['default'],
    // DB round-trips are slower than pure-function assertions; sequential
    // avoids the transaction-per-test rollback pattern racing itself across
    // parallel files against the same single-connection (DB_POOL_MAX=1) pool.
    fileParallelism: false,
    testTimeout: 15_000,
  },
})
