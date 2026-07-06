import rateLimit from 'express-rate-limit'
import type { Request } from 'express'

// ─── Auth endpoints — IP-based brute-force guard ──────────────────────────────
// Login and register: 10 attempts per 15 minutes per IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
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

// ─── General API — broad IP-based catch-all ───────────────────────────────────
// All other endpoints: 200 requests per 15 minutes per IP
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Пожалуйста, подождите немного.' },
  // Skip health check
  skip: (req) => req.path === '/api/health',
})
