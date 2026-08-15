import rateLimit from 'express-rate-limit'
import type { Request } from 'express'
import { PgRateLimitStore } from '../services/rateLimitStore'

// FOUND 2026-08-15: the integration suite runs `fileParallelism: false`
// (vitest.integration.config.ts — required so DB_POOL_MAX=1's transaction-
// per-test isolation works), which means every test FILE shares one Node
// process and therefore one in-memory rate-limit counter for the whole
// `vitest run`, never resetting between files. None of these limiters had a
// test-mode exemption, so the suite's cumulative request count was ALWAYS
// going to cross generalLimiter's 200/15min ceiling eventually as more
// integration tests get added — a new test file (control-plane's) tipped it
// over first, failing an unrelated SSO test with no code connection to it.
// Confirmed by reverting: the same full-suite run was clean before that
// file existed. Gated on NODE_ENV alone — `.env.test` sets it, dev/prod
// never do — so this has zero effect outside the test harness.
const SKIP_IN_TEST = process.env.NODE_ENV === 'test'

// ─── Auth endpoints — IP-based brute-force guard ──────────────────────────────
// Login and register: 10 attempts per 15 minutes per IP.
//
// Postgres-backed store (migration 069) — this is the one limiter where PM2
// cluster mode's default per-process MemoryStore is a real security gap, not
// just an inconvenience: 2 workers round-robining requests means a "10
// attempts" brute-force guard was actually ~20 in practice, and resets on
// every deploy/restart. The other limiters below stay on MemoryStore
// deliberately — generalLimiter runs on every single request (a DB
// round-trip there is a real latency/pool-pressure cost for a broad DoS
// backstop, not a precision-critical boundary), and aiLimiter's real ceiling
// is spendCap.ts's actual-dollar cap, which IS shared across workers.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new PgRateLimitStore('auth'),
  message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
  skip: () => SKIP_IN_TEST,
})

// ─── AI endpoints — user-based (university networks share one IP) ─────────────
// Grade, email draft, generate presentation: 30 calls per hour per authenticated user
export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Key on user ID once authenticated, fall back to IP
  keyGenerator: (req: Request) =>
    req.teacher?.id ?? req.ip ?? 'anonymous',
  message: { error: 'Превышен лимит запросов к ИИ (30 в час). Попробуйте позже.' },
  skip: () => SKIP_IN_TEST,
})

// ─── Public marketing-site forms — unauthenticated, spam-prone ────────────────
// Contact / research application forms: 5 submissions per hour per IP
export const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много обращений. Попробуйте позже или напишите на hello@ispum.ru.' },
  skip: () => SKIP_IN_TEST,
})

// ─── LTI launch — platform-initiated but still bounded ────────────────────────
// A misconfigured or malicious platform shouldn't be able to hammer the OIDC
// login-init endpoint. Shared across both /login and /launch, keyed by IP —
// and a whole campus sits behind one IP, with every launch costing 2 requests
// (GET /login + POST /launch). 30/15min caps a lecture hall at ~15 launches
// before 429s start hitting real students. 600/15min covers a large class
// (~300 launches) clicking through within one period while still bounding a
// misbehaving platform.
export const ltiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много запросов LTI. Попробуйте позже.' },
  skip: () => SKIP_IN_TEST,
})

// ─── Payment webhook — server-to-server, but still bounded per source IP ──────
// T-Bank's callback endpoint sits behind generalLimiter today (200/15min),
// which is shared with every other unauthenticated route hitting that IP —
// a dedicated, tighter-windowed limiter keyed the same way (IP) bounds a
// flood of forged webhook POSTs without needing to touch the DB-backed
// per-account HMAC check to reject them. 120/min comfortably covers T-Bank's
// own retry behaviour (a handful of retries per order, not per-second) while
// still capping abuse well below what unbounded flooding could reach.
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests' },
  skip: () => SKIP_IN_TEST,
})

// ─── General API — broad IP-based catch-all ───────────────────────────────────
// All other endpoints: 200 requests per 15 minutes per IP
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Пожалуйста, подождите немного.' },
  // Skip health check + live-quiz routes (they get their own liveLimiter,
  // sized for sustained ~2s polling for the length of a whole lecture —
  // 200/15min would throttle a single device within minutes).
  skip: (req) =>
    SKIP_IN_TEST ||
    req.path === '/api/health' ||
    req.path.startsWith('/api/live-sessions') ||
    req.path.startsWith('/api/live-join'),
})

// ─── Live QR quiz — polling-shaped, keyed by participant not IP ───────────────
// Both the host (teacher device) and every joined student poll roughly every
// 2s for the length of a lecture (up to ~90 min) — an IP-keyed limiter would
// also let one classroom's shared campus IP collide destructively across all
// its students (same reasoning as ltiLimiter's campus-IP comment above).
// Keyed by participant_token when present (unique per student); the
// token-less join action falls back to IP, which is fine since it's a
// one-time action per student, not a sustained poll.
export const liveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,   // comfortably covers ~1 poll/2s (=30/min) with retry headroom
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    (req.body?.participant_token as string) || (req.query?.participant_token as string) || req.ip || 'anonymous',
  message: { error: 'Слишком много запросов. Подождите немного.' },
  skip: () => SKIP_IN_TEST,
})

// ─── Live QR quiz join — IP-keyed, tighter than liveLimiter ──────────────────
// /join is the one action on the token-less side of liveLimiter's fallback:
// no participant_token exists yet, so it's keyed by IP like a brute-force
// guard against the 6-char join code (32^6 ≈ 1.07B space) rather than a
// polling budget. A real student joins once; 8/min per IP is generous
// headroom for retries/typos while keeping a sustained-guessing attacker
// under a few thousand attempts across a lecture's lifetime.
export const liveJoinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много попыток присоединения. Подождите немного.' },
  skip: () => SKIP_IN_TEST,
})
