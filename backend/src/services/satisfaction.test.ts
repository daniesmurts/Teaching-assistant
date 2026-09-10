import { describe, it, expect, afterEach } from 'vitest'
import {
  ineligibleReason, sampleRate,
  GLOBAL_COOLDOWN_DAYS, FEATURE_COOLDOWN_DAYS, MIN_ACCOUNT_AGE_DAYS,
} from './satisfaction'

const NOW = new Date('2026-09-10T12:00:00.000Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000)

// `roll: 0` keeps sampling out of the way of the cooldown tests — sampling has
// its own block below.
const base = {
  accountCreatedAt:    daysAgo(365),
  lastAnyPromptAt:     null,
  lastFeaturePromptAt: null,
  isPlatformAdmin:     false,
  now:                 NOW,
  roll:                0,
}

describe('satisfaction throttle', () => {
  it('prompts an established teacher who has never been asked', () => {
    expect(ineligibleReason(base)).toBeNull()
  })

  it('never prompts a platform admin', () => {
    // They see every feature constantly while testing: their ratings would be
    // both unrepresentative and the most frequent rows in the table.
    expect(ineligibleReason({ ...base, isPlatformAdmin: true })).toBe('platform_admin')
  })

  it('leaves a brand-new account alone', () => {
    expect(ineligibleReason({ ...base, accountCreatedAt: daysAgo(MIN_ACCOUNT_AGE_DAYS - 1) })).toBe('account_too_new')
  })

  it('prompts once the account clears the minimum age', () => {
    expect(ineligibleReason({ ...base, accountCreatedAt: daysAgo(MIN_ACCOUNT_AGE_DAYS + 1) })).toBeNull()
  })

  describe('global cooldown — a teacher using four features must not meet four prompts', () => {
    it('blocks inside the window even for a feature never asked about', () => {
      expect(ineligibleReason({
        ...base,
        lastAnyPromptAt:     daysAgo(GLOBAL_COOLDOWN_DAYS - 1),
        lastFeaturePromptAt: null,
      })).toBe('global_cooldown')
    })

    it('allows once the window has passed', () => {
      expect(ineligibleReason({ ...base, lastAnyPromptAt: daysAgo(GLOBAL_COOLDOWN_DAYS + 1) })).toBeNull()
    })
  })

  describe('per-feature cooldown', () => {
    it('blocks a repeat ask about the same feature long after the global window', () => {
      expect(ineligibleReason({
        ...base,
        lastAnyPromptAt:     daysAgo(FEATURE_COOLDOWN_DAYS - 1),
        lastFeaturePromptAt: daysAgo(FEATURE_COOLDOWN_DAYS - 1),
      })).toBe('feature_cooldown')
    })

    it('allows once the feature window has passed', () => {
      const old = daysAgo(FEATURE_COOLDOWN_DAYS + 1)
      expect(ineligibleReason({ ...base, lastAnyPromptAt: old, lastFeaturePromptAt: old })).toBeNull()
    })
  })

  // Seasonality (TODO Feature AQ): decks dominate at the start of a semester,
  // grading at the end. These two encode what that means for the throttle —
  // the global window is what teachers feel, and once it passes a teacher
  // already asked about one feature becomes available for the other, which is
  // how grading accumulates answers as the season turns.
  describe('across features', () => {
    it('lets a teacher asked about one feature be asked about another once the global window passes', () => {
      expect(ineligibleReason({
        ...base,
        lastAnyPromptAt:     daysAgo(GLOBAL_COOLDOWN_DAYS + 1),  // was asked about презентации
        lastFeaturePromptAt: null,                                // never about проверка работ
      })).toBeNull()
    })

    it('reallocates rather than adds — a second surface cannot double the prompts a teacher sees', () => {
      // Adding презентации does not add a prompt for a teacher already asked
      // about grading this fortnight; it competes for the same budget. Benign
      // while grading is seasonally idle, worth remembering when both are busy.
      expect(ineligibleReason({
        ...base,
        lastAnyPromptAt:     daysAgo(2),
        lastFeaturePromptAt: null,
      })).toBe('global_cooldown')
    })
  })

  // The throttle advances when a prompt is SHOWN (the row is written by
  // /check), so a teacher who dismisses is covered by these same cooldowns
  // rather than being asked again on their next approve. This encodes the
  // consequence of that choice.
  it('treats a dismissed prompt exactly like an answered one', () => {
    expect(ineligibleReason({ ...base, lastAnyPromptAt: daysAgo(1), lastFeaturePromptAt: daysAgo(1) }))
      .toBe('global_cooldown')
  })

  describe('sampling', () => {
    afterEach(() => { delete process.env.SATISFACTION_SAMPLE_RATE })

    it('defaults to prompting every eligible moment at current volume', () => {
      expect(sampleRate()).toBe(1)
      expect(ineligibleReason({ ...base, roll: 0.99 })).toBeNull()
    })

    it('can be dialled down without a deploy', () => {
      process.env.SATISFACTION_SAMPLE_RATE = '0.25'
      expect(ineligibleReason({ ...base, roll: 0.5 })).toBe('not_sampled')
      expect(ineligibleReason({ ...base, roll: 0.1 })).toBeNull()
    })

    it('can be switched off entirely', () => {
      process.env.SATISFACTION_SAMPLE_RATE = '0'
      expect(ineligibleReason({ ...base, roll: 0 })).toBe('not_sampled')
    })

    it('ignores a nonsensical rate rather than silently muting every prompt', () => {
      for (const bad of ['', 'abc', '-1', '2']) {
        process.env.SATISFACTION_SAMPLE_RATE = bad
        expect(sampleRate()).toBe(1)
      }
    })
  })

  // Order matters for the "why didn't it fire" question: the cheapest and most
  // absolute reasons must win over the random one, or a platform admin would
  // sometimes come back as 'not_sampled'.
  it('reports the most specific reason when several apply', () => {
    expect(ineligibleReason({
      ...base,
      isPlatformAdmin:  true,
      accountCreatedAt: daysAgo(1),
      lastAnyPromptAt:  daysAgo(1),
      roll:             0.99,
    })).toBe('platform_admin')
  })
})
