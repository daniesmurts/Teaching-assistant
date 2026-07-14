import type { Request, Response, NextFunction } from 'express'
import { logger } from '../lib/logger'
import { sendTelegramAlert } from '../lib/telegramAlert'
import { recordIncident } from '../db/queries/incidents'

// Client-aborted slow requests are the monitoring blind spot behind the
// calc-grading incident (CHANGELOG 2026-07-14): the client's HTTP timeout
// fired while the handler was still working, the handler later finished and
// wrote a 2xx to a dead socket, and because nothing server-side ever errored
// there was no Telegram alert and no incident row — the failure was invisible
// until the teacher phoned. Grading is an async job now, but every other
// slow AI route (email drafts, handouts, presentations, quizzes, doc chat,
// curriculum analysis, …) can still hit the same pattern.
//
// This middleware watches the response socket: `close` before
// `writableFinished` means the client hung up mid-request. Only aborts on
// requests older than THRESHOLD_MS are reported — a user navigating away
// from a fast endpoint is routine, a client giving up on a request that has
// been running 10+ seconds is exactly the timeout signature we were blind
// to. Alert + incident row reuse the errorHandler pipeline (sendTelegramAlert
// self-throttles per code, so a burst of aborts can't flood the chat).

const THRESHOLD_MS = 10_000

export function abortMonitor(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now()
  // req.path is relative to the router mount by the time the close listener
  // fires (Express rewrites req.url during routing) — capture the full path now.
  const path = req.originalUrl.split('?')[0]

  res.on('close', () => {
    if (res.writableFinished) return   // response completed normally
    const elapsedMs = Date.now() - start
    if (elapsedMs < THRESHOLD_MS) return

    const teacherId = (req as Request & { teacher?: { id: string } }).teacher?.id ?? null
    const message = `Client aborted after ${Math.round(elapsedMs / 1000)}s — handler still running`

    logger.warn({
      message: 'Client aborted slow request',
      path,
      method:  req.method,
      elapsedMs,
      teacherId,
    })

    sendTelegramAlert({
      code:    'CLIENT_ABORT',
      message,
      path,
      method:  req.method,
    }).then((telegramSent) => {
      recordIncident({
        code: 'CLIENT_ABORT',
        message,
        path,
        method: req.method,
        teacherId,
        telegramSent,
      })
    }).catch(() => {
      recordIncident({
        code: 'CLIENT_ABORT',
        message,
        path,
        method: req.method,
        teacherId,
        telegramSent: false,
      })
    })
  })

  next()
}
