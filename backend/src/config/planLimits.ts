// Single source of truth for plan feature gates and usage limits.
// Never hardcode limit values in routes, services, or components — always import from here.

export const PLAN_LIMITS = {
  free: {
    gradesPerMonth:        20,
    topicsPerMonth:        3,
    quizzesPerMonth:       3,
    tasksPerMonth:         3,
    presentationsPerMonth: 3,
    maxCourses:            3,
    maxCriteria:           15,
    maxRubrics:            5,
    documentUpload:        false,
    ragFlywheel:           false,
    confidenceCheck:       false,
    emailGeneration:       false,
    verificationQuestions: false,
    handout:               false,
    publishedAssignments:  false,   // §5.1 process-of-creation attestation — Pro/Institution
    historyDays:           30,
    presentationHistory:   false,
    watermark:             true,
  },
  pro: {
    gradesPerMonth:        Infinity,
    topicsPerMonth:        Infinity,
    quizzesPerMonth:       Infinity,
    tasksPerMonth:         Infinity,
    presentationsPerMonth: Infinity,
    maxCourses:            Infinity,
    maxCriteria:            Infinity,
    maxRubrics:            Infinity,
    documentUpload:        true,
    ragFlywheel:           true,
    confidenceCheck:       true,
    emailGeneration:       true,
    verificationQuestions: true,
    handout:               true,
    publishedAssignments:  true,
    historyDays:           Infinity,
    presentationHistory:   true,
    watermark:             false,
  },
  institution: {
    gradesPerMonth:        Infinity,
    topicsPerMonth:        Infinity,
    quizzesPerMonth:       Infinity,
    tasksPerMonth:         Infinity,
    presentationsPerMonth: Infinity,
    maxCourses:            Infinity,
    maxCriteria:            Infinity,
    maxRubrics:            Infinity,
    documentUpload:        true,
    ragFlywheel:           true,
    confidenceCheck:       true,
    emailGeneration:       true,
    verificationQuestions: true,
    handout:               true,
    publishedAssignments:  true,
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

// USD per 1M tokens — update if DeepSeek rates change.
const RATES: Record<string, { in: number; out: number }> = {
  // V4 (current). Flash matches the old chat price; Pro ~3× for the reasoning
  // tier. Cache-hit input is ~50× cheaper but we don't yet split it out here.
  'deepseek-v4-flash': { in: 0.14,  out: 0.28 },
  'deepseek-v4-pro':   { in: 0.435, out: 0.87 },
  // Legacy — deprecate 2026-07-24. Kept so historical usage rows still cost out.
  'deepseek-chat':     { in: 0.14, out: 0.28 },
  'deepseek-reasoner': { in: 0.55, out: 2.19 },
}

export function calculateDeepSeekCost(inputTokens: number, outputTokens: number, model = 'deepseek-v4-flash'): number {
  const r = RATES[model] ?? RATES['deepseek-v4-flash']
  return (inputTokens / 1_000_000) * r.in + (outputTokens / 1_000_000) * r.out
}
