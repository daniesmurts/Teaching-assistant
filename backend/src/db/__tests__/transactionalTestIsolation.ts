import type { Pool, PoolClient } from 'pg'

// Fixes a real, long-standing leak in the integration test harness (found
// while verifying Feature AA v1, 2026-07-22 — see TODO.md Feature AA and
// CHANGELOG.md for the full writeup).
//
// The harness wraps every test in `pool.query('BEGIN')` / `pool.query('ROLLBACK')`
// (vitest.setup.integration.ts + `beforeEach`/`afterEach` in each test file).
// That only isolates tests because `.env.test` sets `DB_POOL_MAX=1`, forcing
// every `pool.query()` call to reuse the same physical connection, so the
// outer BEGIN and every later `pool.query()` share one real transaction.
//
// But several query functions (`createOrgUnit`, `moveOrgUnit`, `createInstitution`,
// and others — any multi-table transactional write) call `pool.connect()` to
// run their OWN `BEGIN`/`COMMIT`/`ROLLBACK`. With pool size 1, `pool.connect()`
// grabs that same single connection, so the function's `BEGIN` silently
// continues the already-open outer transaction (Postgres just warns and
// no-ops), and its `COMMIT` commits the outer test's transaction along with
// it — leaving nothing for the later `afterEach: ROLLBACK` to undo. Rows
// leak permanently into the shared test database.
//
// Fix: rewrite nested `BEGIN`/`COMMIT`/`ROLLBACK` into
// `SAVEPOINT`/`RELEASE SAVEPOINT`/`ROLLBACK TO SAVEPOINT` — but "nested"
// has to be tracked by REAL transaction depth, not by "did this go through
// pool.connect()", because `pg-pool`'s own `Pool.prototype.query()` acquires
// its connection via that same public `connect()` internally (confirmed in
// pg-pool/index.js) — so the outer test's own `pool.query('BEGIN')` would
// otherwise ALSO get rewritten into a SAVEPOINT (with no transaction open
// yet, which Postgres rejects). A module-level depth counter, incremented/
// decremented on every BEGIN/COMMIT/ROLLBACK regardless of which client
// issued it, tells the difference: depth 0→1 is the real outer transaction;
// depth 1→2 (and deeper) is a nested call that must become a savepoint.

let transactionDepth = 0
let savepointCounter = 0
const savepointStack: string[] = []

function rewrite(keyword: 'BEGIN' | 'COMMIT' | 'ROLLBACK'): string {
  if (keyword === 'BEGIN') {
    transactionDepth++
    if (transactionDepth === 1) return 'BEGIN' // the real outer (per-test) transaction
    const name = `sp_test_${++savepointCounter}`
    savepointStack.push(name)
    return `SAVEPOINT ${name}`
  }

  // COMMIT / ROLLBACK
  if (transactionDepth <= 0) return keyword // defensive — shouldn't happen given how callers pair BEGIN with COMMIT/ROLLBACK
  if (transactionDepth === 1) {
    transactionDepth = 0
    return keyword // the real outer COMMIT/ROLLBACK
  }
  transactionDepth--
  const name = savepointStack.pop()
  if (!name) return keyword // defensive
  return keyword === 'COMMIT' ? `RELEASE SAVEPOINT ${name}` : `ROLLBACK TO SAVEPOINT ${name}`
}

function wrapClientForSavepoints(client: PoolClient): PoolClient {
  // pg-pool reuses the SAME PoolClient object across checkouts for the same
  // physical connection (confirmed by tracing: with DB_POOL_MAX=1, the
  // object returned by `connect()` is literally the same instance every
  // time). Without this guard, every connect() call would wrap `.query`
  // again on top of the previous wrapper, compounding — each layer calling
  // the next and re-applying the BEGIN/COMMIT/ROLLBACK rewrite redundantly.
  const marker = client as unknown as { __savepointWrapped?: boolean }
  if (marker.__savepointWrapped) return client
  marker.__savepointWrapped = true

  const originalQuery = client.query.bind(client)

  // pg's `query` overloads (string | QueryConfig, values?, callback?) don't
  // narrow cleanly through a wrapper — this cast is intentional and confined
  // to this one test-only file.
  ;(client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
    const first = args[0]
    const text = typeof first === 'string'
      ? first
      : (first && typeof first === 'object' && 'text' in first ? (first as { text: unknown }).text : null)
    const normalized = typeof text === 'string' ? text.trim().toUpperCase() : null

    if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
      // Preserve every other argument as-is (values, and critically any
      // callback — pg-pool's own internal query() calls
      // `client.query('BEGIN', undefined, callback)` and relies on that
      // callback firing to release the client back to the pool; collapsing
      // to a single-arg call here silently drops it and the connection
      // leaks for the rest of the process).
      const rewritten = rewrite(normalized)
      const newArgs = [...args]
      newArgs[0] = typeof first === 'string' ? rewritten : { ...(first as object), text: rewritten }
      return (originalQuery as (...a: unknown[]) => unknown)(...newArgs)
    }
    return (originalQuery as (...a: unknown[]) => unknown)(...args)
  }

  return client
}

// `pg-pool`'s OWN `Pool.prototype.query()` acquires its connection via
// `this.connect((err, client) => {...})` — callback style, not the promise
// style our codebase uses (`await pool.connect()`). A patched `connect` that
// only supports the promise style silently drops that callback, so
// `pool.query()` (used by every test file's `beforeEach`/`afterEach`) hangs
// forever waiting for a callback that never fires — confirmed by reading
// pg-pool/index.js directly. Must support both call shapes.
type ConnectCallback = (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void

export function installTransactionalTestIsolation(pool: Pool): void {
  const marker = pool as unknown as { __transactionalTestIsolationInstalled?: boolean }
  if (marker.__transactionalTestIsolationInstalled) return // idempotent — safe if called more than once against the same pool instance
  marker.__transactionalTestIsolationInstalled = true

  const originalConnect = pool.connect.bind(pool) as {
    (): Promise<PoolClient>
    (callback: ConnectCallback): void
  }

  pool.connect = ((callback?: ConnectCallback) => {
    if (typeof callback === 'function') {
      return originalConnect((err, client, done) => {
        if (err || !client) { callback(err, client, done); return }
        callback(undefined, wrapClientForSavepoints(client), done)
      })
    }
    return originalConnect().then((client) => wrapClientForSavepoints(client))
  }) as typeof pool.connect
}
