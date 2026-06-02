// Single source of truth for plan feature gates and usage limits.
// Never hardcode limit values in routes, services, or components — always import from here.

export const PLAN_LIMITS = {
  free: {
    gradesPerMonth:        20,
    presentationsPerMonth: 3,
    maxCourses:            3,
    maxRubrics:            5,
    documentUpload:        false,
    ragFlywheel:           false,
    emailGeneration:       false,
    historyDays:           30,
    presentationHistory:   false,
    watermark:             true,
  },
  pro: {
    gradesPerMonth:        Infinity,
    presentationsPerMonth: Infinity,
    maxCourses:            Infinity,
    maxRubrics:            Infinity,
    documentUpload:        true,
    ragFlywheel:           true,
    emailGeneration:       true,
    historyDays:           Infinity,
    presentationHistory:   true,
    watermark:             false,
  },
  institution: {
    gradesPerMonth:        Infinity,
    presentationsPerMonth: Infinity,
    maxCourses:            Infinity,
    maxRubrics:            Infinity,
    documentUpload:        true,
    ragFlywheel:           true,
    emailGeneration:       true,
    historyDays:           Infinity,
    presentationHistory:   true,
    watermark:             false,
  },
} as const

export type PlanTier   = keyof typeof PLAN_LIMITS
export type PlanLimits = typeof PLAN_LIMITS[PlanTier]

export function getLimits(tier: string): PlanLimits {
  return PLAN_LIMITS[tier as PlanTier] ?? PLAN_LIMITS.free
}

export function canUseFeature(
  tier: string,
  feature: keyof PlanLimits
): boolean {
  return Boolean(getLimits(tier)[feature])
}

// ─── DeepSeek V3 pricing (update if rates change) ─────────────────────────────

const INPUT_COST_PER_1M  = 0.14   // USD per 1M input tokens
const OUTPUT_COST_PER_1M = 0.28   // USD per 1M output tokens

export function calculateDeepSeekCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens  / 1_000_000) * INPUT_COST_PER_1M +
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_1M
  )
}
