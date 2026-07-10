import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../errors/AppError'
import { logger } from '../lib/logger'
import { recordIncident } from '../db/queries/incidents'
import { sendTelegramAlert } from '../lib/telegramAlert'

interface RawError extends Error {
  status?: number
  code?: string
  errors?: Error[] // pg-pool AggregateError
}

function sanitiseBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const sensitive = new Set(['password', 'password_hash', 'token', 'submission_text'])
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([k, v]) => [
      k,
      sensitive.has(k) ? '[REDACTED]' : v,
    ])
  )
}

// Unknown 500s and infra failures are the failure modes Uptime Kuma's
// black-box probing can't see (the app still answers 200 on /api/health
// while one route is broken) — push them to Telegram and log a row for
// per-client impact + future runbook matching. Fire-and-forget: alerting
// must never delay or fail the error response itself.
function alertAndRecordIncident(params: {
  code: string
  message: string
  req: Request
  stack?: string
}): void {
  const teacherId = (params.req as Request & { teacher?: { id: string } }).teacher?.id ?? null
  sendTelegramAlert({
    code: params.code,
    message: params.message,
    path: params.req.path,
    method: params.req.method,
  }).then((telegramSent) => {
    recordIncident({
      code: params.code,
      message: params.message,
      path: params.req.path,
      method: params.req.method,
      teacherId,
      stack: params.stack ?? null,
      telegramSent,
    })
  }).catch(() => {
    // sendTelegramAlert already logs its own failures; still record the incident.
    recordIncident({
      code: params.code,
      message: params.message,
      path: params.req.path,
      method: params.req.method,
      teacherId,
      stack: params.stack ?? null,
      telegramSent: false,
    })
  })
}

export function errorHandler(
  err: RawError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {

  // ── Known operational error (AppError subclass) ───────────────────────────
  if (err instanceof AppError) {
    logger.warn({
      code:       err.code,
      message:    err.message,
      statusCode: err.statusCode,
      path:       req.path,
      method:     req.method,
      teacherId:  (req as Request & { teacher?: { id: string } }).teacher?.id,
    })

    res.status(err.statusCode).json({
      error:   err.message,
      code:    err.code,
      upgrade: err.upgrade ?? false,
      ...(process.env.NODE_ENV === 'development' ? { details: err.details } : {}),
    })
    return
  }

  // ── pg-pool ECONNREFUSED ───────────────────────────────────────────────────
  if (err.code === 'ECONNREFUSED') {
    const message = process.env.NODE_ENV === 'development'
      ? 'Нет подключения к базе данных — запущен ли PostgreSQL?'
      : 'Сервис временно недоступен'

    logger.error({ message: 'DB connection refused', path: req.path })
    alertAndRecordIncident({ code: 'DB_UNAVAILABLE', message: 'DB connection refused', req })
    res.status(503).json({ error: message, code: 'DB_UNAVAILABLE' })
    return
  }

  // ── Unknown programmer error ───────────────────────────────────────────────
  logger.error({
    message: err.message,
    stack:   err.stack,
    path:    req.path,
    method:  req.method,
    body:    sanitiseBody(req.body),
    teacherId: (req as Request & { teacher?: { id: string } }).teacher?.id,
  })

  alertAndRecordIncident({ code: 'INTERNAL_ERROR', message: err.message, req, stack: err.stack })

  res.status(500).json({
    error: 'Произошла непредвиденная ошибка. Попробуйте ещё раз.',
    code:  'INTERNAL_ERROR',
  })
}
