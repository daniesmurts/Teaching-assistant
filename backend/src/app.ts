import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { pool } from './db/connection'
import { config, validateConfig } from './lib/config'
import { getBuildVersion } from './lib/version'
import { errorHandler } from './middleware/errorHandler'
import { generalLimiter } from './middleware/rateLimits'
import { auditLog } from './middleware/auditLog'
import { abortMonitor } from './middleware/abortMonitor'
import authRouter from './routes/auth'
import ssoRouter from './routes/sso'
import ltiRouter from './routes/lti'
import coursesRouter from './routes/courses'
import criteriaRouter from './routes/criteria'
import rubricsRouter from './routes/rubrics'
import learningLoopRouter from './routes/learningLoop'
import gradingRouter from './routes/grading'
import presentationsRouter from './routes/presentations'
import documentsRouter from './routes/documents'
import adminRouter from './routes/admin'
import adminEvalsRouter from './routes/adminEvals'
import institutionRouter from './routes/institution'
import feedbackRouter from './routes/feedback'
import topicsRouter from './routes/topics'
import tasksRouter from './routes/tasks'
import curriculumRouter from './routes/curriculum'
import programsRouter from './routes/programs'
import orgStructureRouter from './routes/orgUnits'
import leadershipRouter from './routes/leadership'
import publishedAssignmentsRouter from './routes/publishedAssignments'
import publicWriteRouter from './routes/publicWrite'
import quizzesRouter from './routes/quizzes'
import paymentsRouter from './routes/payments'
import accountRouter from './routes/account'
import contactRouter from './routes/contact'
import challengesRouter from './routes/challenges'
// Side-effect import — registers per-institution provider resolution into the
// LLM registry before any AI call goes through.
import './services/llm/institutionResolver'

// Validate environment before anything else — crash early on misconfig
validateConfig()

// Extracted from index.ts (Improvement #7) so the Express app is importable
// without the side effect of binding a port — supertest needs a plain `app`
// to attach to an ephemeral listener of its own. index.ts stays the only
// place that calls `.listen()` for the real running process.
export const app = express()

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
// urlencoded body — needed for SAML ACS where the IdP POSTs SAMLResponse as
// application/x-www-form-urlencoded. Bumped from default 100kb because the
// base64-encoded assertion can be ~50kb on its own.
app.use(express.urlencoded({ extended: false, limit: '1mb' }))
app.use(generalLimiter)

// Records every successful mutation from an authenticated user. Runs before the
// routers so its finish-listener fires after req.teacher is populated; routes
// that audit themselves set res.locals.selfAudited to opt out (see auditLog).
app.use(auditLog)

// Surfaces client-aborted slow requests (the calc-grading blind spot — see
// middleware/abortMonitor.ts). Global with a 10s threshold rather than
// per-AI-route: cheap endpoints never run long enough to trigger it.
app.use(abortMonitor)

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({
      status:    'ok',
      timestamp: new Date().toISOString(),
      env:       config.nodeEnv,
      version:   getBuildVersion(),
    })
  } catch {
    res.status(503).json({ status: 'degraded', error: 'database unavailable' })
  }
})

app.use('/api/auth',          authRouter)
app.use('/api/sso',           ssoRouter)
app.use('/api/lti',           ltiRouter)
app.use('/api/write',         publicWriteRouter)   // public — token-authed student writing surface
app.use('/api/contact',       contactRouter)       // public — marketing-site Contact + Research forms
app.use('/api/courses',       coursesRouter)
app.use('/api/criteria',      criteriaRouter)
app.use('/api/rubrics',       rubricsRouter)
app.use('/api/learning-loop', learningLoopRouter)
app.use('/api/grading',       gradingRouter)
app.use('/api/presentations', presentationsRouter)
app.use('/api/topics',        topicsRouter)
app.use('/api/tasks',         tasksRouter)
app.use('/api/curriculum',    curriculumRouter)
app.use('/api/quizzes',       quizzesRouter)
app.use('/api/published-assignments', publishedAssignmentsRouter)
app.use('/api/documents',     documentsRouter)
app.use('/api/admin/evals',   adminEvalsRouter)   // before /api/admin so /evals isn't shadowed
app.use('/api/admin',         adminRouter)
app.use('/api/institution/programs',  programsRouter)      // before /api/institution so it isn't shadowed
app.use('/api/institution/structure', orgStructureRouter)  // before /api/institution so it isn't shadowed
app.use('/api/leadership', leadershipRouter)
app.use('/api/institution',   institutionRouter)
app.use('/api/feedback',      feedbackRouter)
app.use('/api/challenges',    challengesRouter)
app.use('/api/payments',      paymentsRouter)
app.use('/api/account',       accountRouter)

// ─── Global error handler (must be last) ──────────────────────────────────────

app.use(errorHandler)
