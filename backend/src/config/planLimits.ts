// Single source of truth for plan feature gates and usage limits.
// Never hardcode limit values in routes, services, or components — always import from here.

export const PLAN_LIMITS = {
  free: {
    gradesPerMonth:        20,
    topicsPerMonth:        3,
    quizzesPerMonth:       3,
    tasksPerMonth:         3,
    presentationsPerMonth: 3,
    criteriaImprovePerMonth: 5,
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
    feedbackCritic:        false,
    evidenceFirst:         false,   // Feature AH — evidence-first two-phase grading
    cohortSynthesis:       false,
    calcVerification:      false,
    citationCheck:         false,
    challengeFeedback:     false,
    fosGenerator:          false,
    rpdMonitor:            false,
    brsEngine:             false,   // Feature AE v1 — БРС semester ledger — Pro/Institution
    pptxExport:            false,   // Feature D — real PowerPoint export
    umcDashboard:          false,   // Feature V — УМЦ readiness dashboard, Institution only
    liveSessionsPerMonth:  1,
    monthlySpendCapUsd:    3,
  },
  pro: {
    gradesPerMonth:        Infinity,
    topicsPerMonth:        Infinity,
    quizzesPerMonth:       Infinity,
    tasksPerMonth:         Infinity,
    presentationsPerMonth: Infinity,
    criteriaImprovePerMonth: Infinity,
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
    feedbackCritic:        true,
    evidenceFirst:         true,   // Feature AH — evidence-first two-phase grading
    cohortSynthesis:       true,
    calcVerification:      true,
    citationCheck:         true,
    challengeFeedback:     true,
    fosGenerator:          true,
    rpdMonitor:            false,
    brsEngine:             true,
    pptxExport:            true,   // Feature D — real PowerPoint export
    umcDashboard:          false,  // Feature V — Institution only, same tier as rpdMonitor
    liveSessionsPerMonth:  Infinity,
    monthlySpendCapUsd:    30,
  },
  institution: {
    gradesPerMonth:        Infinity,
    topicsPerMonth:        Infinity,
    quizzesPerMonth:       Infinity,
    tasksPerMonth:         Infinity,
    presentationsPerMonth: Infinity,
    criteriaImprovePerMonth: Infinity,
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
    feedbackCritic:        true,
    evidenceFirst:         true,   // Feature AH — evidence-first two-phase grading
    cohortSynthesis:       true,
    calcVerification:      true,
    citationCheck:         true,
    challengeFeedback:     true,
    fosGenerator:          true,
    rpdMonitor:            true,
    brsEngine:             true,
    pptxExport:            true,   // Feature D — real PowerPoint export
    umcDashboard:          true,   // Feature V — УМЦ readiness dashboard
    liveSessionsPerMonth:  Infinity,
    monthlySpendCapUsd:    150,
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

// ─── Qwen3 pricing (DashScope compatible-mode rates) ──────────────────────────
// USD per 1M tokens. Confirmed against DashScope's console pricing page
// (2026-07-11) — standard international tier, 0–256K context for Plus /
// 0–1M for Max. Plus steps up to $1.20 in / $4.80 out per 1M above 256K
// context, not modelled here (flat single-tier rate, same simplification
// DeepSeek's calculator already makes for its own cache-hit discount tier);
// underprices the rare submission whose prompt crosses 256K tokens. Ignores
// the temporary 20% Plus discount (input only, expires 2026-07-23) since a
// promo rate would go stale within days of landing.
const QWEN_RATES: Record<string, { in: number; out: number }> = {
  'qwen3.7-plus': { in: 0.40, out: 1.60 },
  'qwen3.7-max':  { in: 2.50, out: 7.50 },
}

export function calculateQwenCost(inputTokens: number, outputTokens: number, model = 'qwen3.7-plus'): number {
  const r = QWEN_RATES[model] ?? QWEN_RATES['qwen3.7-plus']
  return (inputTokens / 1_000_000) * r.in + (outputTokens / 1_000_000) * r.out
}
