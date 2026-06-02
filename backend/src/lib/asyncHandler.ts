import type { Request, Response, NextFunction, RequestHandler } from 'express'

/**
 * Wraps an async route handler so that any thrown error or rejected promise
 * is forwarded to next(err) → the global error handler.
 *
 * Use on every async route — no bare async (req, res) => {} without this.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
