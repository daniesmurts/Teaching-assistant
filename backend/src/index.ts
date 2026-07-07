import { app } from './app'
import { logger } from './lib/logger'
import { config } from './lib/config'
import { startRenewalScheduler } from './services/renewals'

const PORT = config.port

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
