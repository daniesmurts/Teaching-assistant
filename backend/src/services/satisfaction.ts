// Micro-satisfaction prompts (TODO Feature SAT, Phase 1 — grading only).
//
// The widget is trivial; the throttle is the feature. A satisfaction prompt is
// a tax on someone mid-task, and the failure mode isn't a bad question, it's a
// good question asked too often — at which point teachers learn to dismiss on
// sight and the data becomes a measure of reflex rather than of satisfaction.
// So the policy lives here, in one pure function, testable without a database
// and without a browser.
//
// Deliberately NOT asked:
//   • anything behaviour already answers. The teacher approving a grade
//     unedited, editing it first, or regenerating are all recorded already;
//     the survey exists only for the gap those can't close — a teacher who
//     ships a mediocre artefact because the lecture is tomorrow looks
//     identical to a satisfied one.
//   • anything before review. Prompting on a grade that hasn't been approved
//     would put "was this good?" in front of a teacher who hasn't checked yet,
//     nudging a rubber-stamp — a direct attack on "AI never final"
//     (CLAUDE.md §3). The trigger is the approve, never the grade.

import { getPromptCooldowns } from '../db/queries/satisfaction'

export type SatisfactionFeature = 'grading'

const DAY_MS = 24 * 60 * 60 * 1000

/** Across ALL features. The number that actually protects the user: a teacher
 *  using four features shouldn't meet four prompts. */
export const GLOBAL_COOLDOWN_DAYS = 14

/** Per feature. Long, because a feature's quality doesn't move week to week —
 *  and because the comparison worth making is release-over-release, not
 *  week-over-week (see the Phase 3 note in TODO). */
export const FEATURE_COOLDOWN_DAYS = 90

/** Nothing in the first week. A new teacher is rating onboarding and their own
 *  unfamiliarity, not the feature. */
export const MIN_ACCOUNT_AGE_DAYS = 7

/** Fraction of otherwise-eligible moments that actually prompt. 1.0 is correct
 *  at current volume — the cooldowns above already make prompts rare, and
 *  sampling on top of them at this N would just produce a number nobody can
 *  read. It's env-tunable so it can be dialled DOWN without a deploy once
 *  volume makes that the binding constraint, which is the direction this
 *  setting will need to move. */
export function sampleRate(): number {
  // Trim-and-check-empty before Number(): `SATISFACTION_SAMPLE_RATE=` with no
  // value is a normal thing to find in a .env, and Number('') is 0 — which
  // would silently switch the entire mechanism off while looking configured.
  // An unparseable value falls back to 1 rather than 0 for the same reason:
  // a typo should over-ask, which is visible, not under-ask, which isn't.
  const raw = process.env.SATISFACTION_SAMPLE_RATE?.trim()
  if (!raw) return 1
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 1
  return parsed
}

export interface EligibilityInput {
  accountCreatedAt: Date | string
  lastAnyPromptAt:  Date | string | null
  lastFeaturePromptAt: Date | string | null
  isPlatformAdmin:  boolean
  now?:             Date
  /** Injectable so the sampling branch is testable rather than flaky. */
  roll?:            number
}

export type IneligibleReason =
  | 'platform_admin' | 'account_too_new' | 'global_cooldown' | 'feature_cooldown' | 'not_sampled'

function daysSince(from: Date | string, now: Date): number {
  return (now.getTime() - new Date(from).getTime()) / DAY_MS
}

/** Pure policy. Returns null when the teacher should be prompted, or the
 *  reason they shouldn't — a reason rather than a boolean because "why didn't
 *  it fire" is the question that gets asked when this misbehaves. */
export function ineligibleReason(input: EligibilityInput): IneligibleReason | null {
  const now = input.now ?? new Date()

  // Platform admins see every feature constantly while testing; their ratings
  // would be both unrepresentative and the most frequent rows in the table.
  // Ordinary heavy users are handled by GLOBAL_COOLDOWN_DAYS instead of an
  // exclusion list, which would go stale the moment roles change.
  if (input.isPlatformAdmin) return 'platform_admin'
  if (daysSince(input.accountCreatedAt, now) < MIN_ACCOUNT_AGE_DAYS) return 'account_too_new'
  if (input.lastAnyPromptAt && daysSince(input.lastAnyPromptAt, now) < GLOBAL_COOLDOWN_DAYS) return 'global_cooldown'
  if (input.lastFeaturePromptAt && daysSince(input.lastFeaturePromptAt, now) < FEATURE_COOLDOWN_DAYS) return 'feature_cooldown'

  const roll = input.roll ?? Math.random()
  if (roll >= sampleRate()) return 'not_sampled'

  return null
}

/** DB-backed wrapper: reads the two cooldowns, applies the policy above. */
export async function shouldPrompt(params: {
  teacherId:        string
  feature:          SatisfactionFeature
  accountCreatedAt: Date | string
  isPlatformAdmin:  boolean
}): Promise<IneligibleReason | null> {
  const { lastAnyAt, lastFeatureAt } = await getPromptCooldowns(params.teacherId, params.feature)
  return ineligibleReason({
    accountCreatedAt:    params.accountCreatedAt,
    lastAnyPromptAt:     lastAnyAt,
    lastFeaturePromptAt: lastFeatureAt,
    isPlatformAdmin:     params.isPlatformAdmin,
  })
}
