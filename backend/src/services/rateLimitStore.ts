// Postgres-backed Store for express-rate-limit, shared across PM2's cluster
// workers (see migration 069_rate_limit_store.sql for the "why" — the default
// MemoryStore is per-process, so every configured limit was silently ~2x
// looser and reset on every restart/deploy).
//
// Fixed-window counting (bucket = floor(now / windowMs)), same effective
// semantics as express-rate-limit's own MemoryStore. Fails OPEN on DB errors
// — a rate limiter must never be the reason logins/grading break outright;
// same philosophy as spendCap.ts.

import type { Store, Options, IncrementResponse } from 'express-rate-limit'
import { pool } from '../db/connection'
import { logger } from '../lib/logger'

export class PgRateLimitStore implements Store {
  private windowMs = 15 * 60 * 1000
  private readonly name: string

  constructor(name: string) {
    this.name = name
  }

  init(options: Options): void {
    this.windowMs = options.windowMs
  }

  private currentWindowStart(): Date {
    const now = Date.now()
    return new Date(Math.floor(now / this.windowMs) * this.windowMs)
  }

  async increment(key: string): Promise<IncrementResponse> {
    const windowStart = this.currentWindowStart()
    try {
      const { rows } = await pool.query<{ hits: number }>(
        `INSERT INTO rate_limit_hits (limiter_name, key, window_start, hits)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (limiter_name, key, window_start)
         DO UPDATE SET hits = rate_limit_hits.hits + 1
         RETURNING hits`,
        [this.name, key, windowStart]
      )
      // Cheap opportunistic cleanup — no dedicated scheduler needed for a
      // table this narrow. ~1% of increments sweep windows older than
      // themselves, well-bounded across all limiters/keys.
      if (Math.random() < 0.01) void this.sweepExpired()

      return { totalHits: rows[0].hits, resetTime: new Date(windowStart.getTime() + this.windowMs) }
    } catch (err) {
      logger.warn({ message: 'Rate limit store increment failed; failing open', limiter: this.name, error: (err as Error).message })
      return { totalHits: 0, resetTime: new Date(windowStart.getTime() + this.windowMs) }
    }
  }

  async decrement(key: string): Promise<void> {
    const windowStart = this.currentWindowStart()
    try {
      await pool.query(
        `UPDATE rate_limit_hits SET hits = GREATEST(hits - 1, 0)
         WHERE limiter_name = $1 AND key = $2 AND window_start = $3`,
        [this.name, key, windowStart]
      )
    } catch (err) {
      logger.warn({ message: 'Rate limit store decrement failed', limiter: this.name, error: (err as Error).message })
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await pool.query(
        `DELETE FROM rate_limit_hits WHERE limiter_name = $1 AND key = $2`,
        [this.name, key]
      )
    } catch (err) {
      logger.warn({ message: 'Rate limit store resetKey failed', limiter: this.name, error: (err as Error).message })
    }
  }

  private async sweepExpired(): Promise<void> {
    try {
      await pool.query(`DELETE FROM rate_limit_hits WHERE window_start < NOW() - INTERVAL '1 day'`)
    } catch (err) {
      logger.warn({ message: 'Rate limit store sweep failed', error: (err as Error).message })
    }
  }
}
