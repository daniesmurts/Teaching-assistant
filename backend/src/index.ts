import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { logger } from './lib/logger'
import { config, validateConfig } from './lib/config'
import { pool } from './db/connection'
import { errorHandler } from './middleware/errorHandler'
import { generalLimiter } from './middleware/rateLimits'
import authRouter from './routes/auth'
import coursesRouter from './routes/courses'
import rubricsRouter from './routes/rubrics'
import gradingRouter from './routes/grading'
import presentationsRouter from './routes/presentations'
import documentsRouter from './routes/documents'
import adminRouter from './routes/admin'
import institutionRouter from './routes/institution'
import feedbackRouter from './routes/feedback'
import paymentsRouter from './routes/payments'
import accountRouter from './routes/account'
import { startRenewalScheduler } from './services/renewals'

// Validate environment before anything else — crash early on misconfig
validateConfig()

const app = express()
const PORT = config.port

// Behind nginx (one proxy hop) — trust X-Forwarded-For so req.ip is the real
// client IP. Without this, all IP-keyed rate limiters bucket on 127.0.0.1.
app.set('trust proxy', 1)

// ─── Security headers ─────────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],   // Tailwind needs this
      imgSrc:         ["'self'", 'data:', 'blob:'],
      connectSrc:     ["'self'"],
      fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,   // needed for PDF preview
}))

// ─── CORS ─────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,      // production: https://ispum.ru
  'http://localhost:5173',        // Vite dev server
  'http://localhost:4173',        // Vite preview
].filter(Boolean) as string[]

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl in dev)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`))
    }
  },
  credentials:    true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  maxAge:         86400, // preflight cache 24 h
}))

// ─── Body parsing + global rate limit ─────────────────────────────────────────

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false }))
app.use(generalLimiter)

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({
      status:    'ok',
      timestamp: new Date().toISOString(),
      env:       config.nodeEnv,
    })
  } catch {
    res.status(503).json({ status: 'degraded', error: 'database unavailable' })
  }
})

app.use('/api/auth',          authRouter)
app.use('/api/courses',       coursesRouter)
app.use('/api/rubrics',       rubricsRouter)
app.use('/api/grading',       gradingRouter)
app.use('/api/presentations', presentationsRouter)
app.use('/api/documents',     documentsRouter)
app.use('/api/admin',         adminRouter)
app.use('/api/institution',   institutionRouter)
app.use('/api/feedback',      feedbackRouter)
app.use('/api/payments',      paymentsRouter)
app.use('/api/account',       accountRouter)

// ─── Global error handler (must be last) ──────────────────────────────────────

app.use(errorHandler)

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info({ message: `Backend running on port ${PORT}`, env: process.env.NODE_ENV })
  startRenewalScheduler()   // daily auto-renewal sweep
})

// ─── Safety net — catch anything that slips through ───────────────────────────

process.on('unhandledRejection', (reason) => {
  logger.error({ message: 'Unhandled promise rejection', reason })
  // Do not exit — PM2 will restart if needed
})

process.on('uncaughtException', (err) => {
  logger.error({ message: 'Uncaught exception', error: err.message, stack: err.stack })
  process.exit(1) // Let PM2 restart cleanly
})
