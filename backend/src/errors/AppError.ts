// ─── Base error ───────────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public override message: string, // user-facing — safe to show in the UI
    public statusCode: number,        // HTTP status
    public code: string,              // machine-readable — frontend switches on this
    public details?: unknown,         // optional extra context, never shown to user
    public upgrade?: boolean,         // true → frontend shows upgrade prompt
  ) {
    super(message)
    this.name = 'AppError'
    Error.captureStackTrace(this, this.constructor)
  }
}

// ─── Convenience subclasses ───────────────────────────────────────────────────

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND')
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED')
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'FORBIDDEN')
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details)
  }
}

export class PlanLimitError extends AppError {
  constructor(message: string, code = 'PLAN_LIMIT_REACHED') {
    super(message, 403, code, undefined, true)
  }
}

export class DocumentProcessingError extends AppError {
  constructor(message: string) {
    super(message, 422, 'DOCUMENT_PROCESSING_ERROR')
  }
}

// Not a plan/paywall gate (upgrade wouldn't necessarily fix it faster than an
// admin raising the cap) — a cost-protection circuit breaker. 429, not 403.
export class SpendCapExceededError extends AppError {
  constructor(capUsd: number) {
    super(
      `Достигнут месячный лимит расходов на ИИ для этого аккаунта (${capUsd.toFixed(2)} $). ` +
      `Лимит обновится в начале следующего месяца или может быть изменён администратором платформы.`,
      429,
      'SPEND_CAP_EXCEEDED',
    )
  }
}

// Platform-wide circuit breaker, distinct from the per-teacher cap above —
// protects against a burst across many accounts each individually under
// their own limit. 503 (temporary, not a per-account state) rather than 429.
export class GlobalSpendCapExceededError extends AppError {
  constructor() {
    super(
      'Временная перегрузка: платформа достигла дневного лимита расходов на генерацию. ' +
      'Попробуйте через несколько минут.',
      503,
      'GLOBAL_SPEND_CAP_EXCEEDED',
    )
  }
}

// TODO.md Feature AL Phase 4 — the correct blast radius for a runaway
// feature (e.g. deep-mode presentations) is that ONE feature, not the whole
// platform — GlobalSpendCapExceededError above would otherwise take down
// grading too. 503 for the same reason: temporary, not a per-account state.
export class FeatureSpendCapExceededError extends AppError {
  constructor(feature: string) {
    super(
      `Временная перегрузка: функция «${feature}» достигла дневного лимита расходов. ` +
      'Попробуйте через несколько минут — другие функции платформы работают в обычном режиме.',
      503,
      'FEATURE_SPEND_CAP_EXCEEDED',
    )
  }
}
