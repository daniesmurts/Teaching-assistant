import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../errors/AppError'
import { logger } from '../lib/logger'

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

  res.status(500).json({
    error: 'Произошла непредвиденная ошибка. Попробуйте ещё раз.',
    code:  'INTERNAL_ERROR',
  })
}
