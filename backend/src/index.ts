import express from 'express'
import cors from 'cors'
import { errorHandler } from './middleware/errorHandler'
import { generalLimiter } from './middleware/rateLimits'
import authRouter from './routes/auth'
import coursesRouter from './routes/courses'
import rubricsRouter from './routes/rubrics'
import gradingRouter from './routes/grading'
import presentationsRouter from './routes/presentations'

const app = express()
const PORT = process.env.PORT ?? 3000

app.use(cors())
app.use(express.json())
app.use(generalLimiter)

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/auth', authRouter)
app.use('/api/courses', coursesRouter)
app.use('/api/rubrics', rubricsRouter)
app.use('/api/grading', gradingRouter)
app.use('/api/presentations', presentationsRouter)

// ─── Error handler (must be last) ─────────────────────────────────────────────

app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})
