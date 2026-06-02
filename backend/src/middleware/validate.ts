import { Request, Response, NextFunction } from 'express'

type Rule = {
  field: string
  type?: 'string' | 'number' | 'boolean' | 'array'
  required?: boolean
  minLength?: number
}

/**
 * Returns middleware that validates req.body against a list of rules.
 * On failure, sends 400 with a descriptive error message.
 */
export function validate(rules: Rule[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const rule of rules) {
      const value: unknown = (req.body as Record<string, unknown>)[rule.field]

      if (rule.required && (value === undefined || value === null || value === '')) {
        res.status(400).json({ error: `Field "${rule.field}" is required` })
        return
      }

      if (value !== undefined && value !== null) {
        if (rule.type && typeof value !== rule.type) {
          res.status(400).json({
            error: `Field "${rule.field}" must be of type ${rule.type}`,
          })
          return
        }

        if (
          rule.minLength !== undefined &&
          typeof value === 'string' &&
          value.length < rule.minLength
        ) {
          res.status(400).json({
            error: `Field "${rule.field}" must be at least ${rule.minLength} characters`,
          })
          return
        }
      }
    }

    next()
  }
}
