import { Request, Response, NextFunction } from 'express'
import { validationResult, type ValidationChain } from 'express-validator'
import { ValidationError } from '../errors/AppError'

/**
 * Runs a list of express-validator chains, then checks for errors.
 * On failure, passes a ValidationError to the global error handler.
 *
 * Usage:
 *   router.post('/register', validate(registerRules), asyncHandler(...))
 */
export function validate(chains: ValidationChain[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // Run all chains in parallel
    await Promise.all(chains.map((chain) => chain.run(req)))

    const result = validationResult(req)
    if (result.isEmpty()) {
      next()
      return
    }

    const details = result.array().map((e) => ({
      field:   'path' in e ? String(e.path) : 'unknown',
      message: e.msg as string,
    }))

    next(new ValidationError(details[0].message, details))
  }
}
