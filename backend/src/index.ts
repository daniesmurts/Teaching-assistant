import { app } from './app'
import { logger } from './lib/logger'
import { config } from './lib/config'
import { startRenewalScheduler } from './services/renewals'
import { startActivationScheduler } from './services/activation'
import { startActivationDigestScheduler } from './services/activationDigest'
import { startJobQueue, stopJobQueue } from './services/jobQueue'
import { registerLongReviewWorker } from './services/longReviewWorker'
import { registerGradeJobWorker } from './services/gradeJobWorker'
import { registerFosWorker } from './services/fosWorker'

const PORT = config.port

async function main(): Promise<void> {
  // Start the job queue (and register its workers) before accepting HTTP
  // traffic — POST /api/grading/review enqueues onto it immediately.
  const boss = await startJobQueue()
  await registerLongReviewWorker(boss)
  await registerGradeJobWorker(boss)
  await registerFosWorker(boss)

  app.listen(PORT, () => {
    logger.info({ message: `Backend running on port ${PORT}`, env: process.env.NODE_ENV })
    startRenewalScheduler()   // daily auto-renewal sweep
    startActivationScheduler()        // hourly onboarding-nudge sweep
    startActivationDigestScheduler()  // weekly Telegram activation summary
  })
}

main().catch((err) => {
  logger.error({ message: 'Fatal startup error', error: (err as Error).message })
  process.exit(1)
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

// PM2 sends SIGTERM on restart/reload — let in-flight jobs finish (up to the
// timeout) rather than yanking the worker mid-job, which is exactly the
// failure mode this queue exists to avoid.
process.on('SIGTERM', () => {
  stopJobQueue()
    .catch((err) => logger.error({ message: 'Error stopping job queue', error: (err as Error).message }))
    .finally(() => process.exit(0))
})
