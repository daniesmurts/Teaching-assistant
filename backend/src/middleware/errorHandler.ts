import { Request, Response, NextFunction } from 'express'

interface AppError extends Error {
  status?: number
  code?: string
  errors?: Error[]   // pg-pool AggregateError
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isDev = process.env.NODE_ENV !== 'production'

  if (isDev) {
    console.error(err)
  }

  const status = err.status ?? 500

  // pg-pool AggregateError has an empty .message but a nested errors array
  let message = err.message || (err.errors?.[0]?.message) || 'Internal server error'

  // Surface connection errors clearly in dev; hide internals in prod
  if (err.code === 'ECONNREFUSED') {
    message = isDev
      ? 'Database connection refused — is PostgreSQL running?'
      : 'Service temporarily unavailable'
  }

  res.status(status).json({ error: message })
}
