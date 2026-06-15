import { useAuthStore } from '../store/authStore'
import type { PlanState } from '../types'

/**
 * Clean accessor for plan state. Use this in components instead of
 * reaching directly into authStore — keeps plan logic in one place.
 */
export function usePlan() {
  const plan = useAuthStore((s) => s.plan)

  const tier = (plan?.tier ?? 'free') as PlanState['tier']

  return {
    tier,
    isFree:        tier === 'free',
    isPro:         tier === 'pro',
    isInstitution: tier === 'institution',

    /** Check a boolean feature gate */
    can: (feature: keyof PlanState['features']): boolean =>
      plan?.features[feature] ?? false,

    gradesUsed:         plan?.gradesUsed        ?? 0,
    // Limits: `null` is MEANINGFUL (unlimited / Pro). Only fall back to the
    // free default when the plan isn't loaded yet — `plan?.x ?? default` would
    // wrongly coerce a Pro user's null limit to the free number and show the
    // usage counter on an unlimited plan.
    gradesLimit:        plan ? plan.gradesLimit        : 20,
    presentationsUsed:  plan?.presentationsUsed  ?? 0,
    presentationsLimit: plan ? plan.presentationsLimit : 3,
    topicsUsed:         plan?.topicsUsed         ?? 0,
    topicsLimit:        plan ? plan.topicsLimit       : 3,
    quizzesUsed:        plan?.quizzesUsed        ?? 0,
    quizzesLimit:       plan ? plan.quizzesLimit      : 3,

    atTopicLimit: plan?.topicsLimit !== null &&
      (plan?.topicsUsed ?? 0) >= (plan?.topicsLimit ?? 3),

    atQuizLimit: plan?.quizzesLimit !== null &&
      (plan?.quizzesUsed ?? 0) >= (plan?.quizzesLimit ?? 3),

    /** Remaining grades (Infinity when on unlimited plan) */
    gradesRemaining: plan?.gradesLimit === null
      ? Infinity
      : (plan?.gradesLimit ?? 20) - (plan?.gradesUsed ?? 0),

    presentationsRemaining: plan?.presentationsLimit === null
      ? Infinity
      : (plan?.presentationsLimit ?? 3) - (plan?.presentationsUsed ?? 0),

    /** At hard limit — disable grade button */
    atGradeLimit: plan?.gradesLimit !== null &&
      (plan?.gradesUsed ?? 0) >= (plan?.gradesLimit ?? 20),

    /** At 80% of limit — show soft warning */
    nearGradeLimit: plan?.gradesLimit !== null &&
      (plan?.gradesUsed ?? 0) >= Math.floor((plan?.gradesLimit ?? 20) * 0.8),
  }
}
