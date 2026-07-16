import rateLimit from 'express-rate-limit'
import type { Request } from 'express'
import { PgRateLimitStore } from '../services/rateLimitStore'

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
})

// ─── Public marketing-site forms — unauthenticated, spam-prone ────────────────
// Contact / research application forms: 5 submissions per hour per IP
export const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много обращений. Попробуйте позже или напишите на hello@ispum.ru.' },
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
})
