import dns from 'node:dns'
// Prod VM has no routable IPv6 (eth0 carries only a link-local address), but
// Node's default DNS resolution can still return/prefer a target's AAAA
// record — the connection then hangs until it times out, with no fallback
// to the working A record. Confirmed live (2026-07-24): a raw TCP connect to
// api.telegram.org over IPv6 hung/failed while the same host over IPv4
// connected instantly, and it silently broke Telegram alerting (including
// the pre-existing incident-alert path in errorHandler.ts, not just the new
// DeepSeek-account-fallback alert that surfaced it) with no visible error —
// sendTelegramMessage's catch only logs and returns false. `ipv4first`
// affects every outbound call process-wide, not just Telegram.
dns.setDefaultResultOrder('ipv4first')

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
import { registerPresentationJobWorker } from './services/presentationJobWorker'

const PORT = config.port

async function main(): Promise<void> {
  // Start the job queue (and register its workers) before accepting HTTP
  // traffic — POST /api/grading/review enqueues onto it immediately.
  const boss = await startJobQueue()
  await registerLongReviewWorker(boss)
  await registerGradeJobWorker(boss)
  await registerFosWorker(boss)
  await registerPresentationJobWorker(boss)

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
