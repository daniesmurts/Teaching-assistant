import { describe, it, expect } from 'vitest'
import { parseFeatureCapUsd, featureCapEnvKey } from './featureSpendCap'

describe('parseFeatureCapUsd', () => {
  it('disables the breaker (Infinity) when unset', () => {
    expect(parseFeatureCapUsd(undefined)).toBe(Infinity)
    expect(parseFeatureCapUsd('')).toBe(Infinity)
  })

  it('parses a positive numeric override', () => {
    expect(parseFeatureCapUsd('50')).toBe(50)
    expect(parseFeatureCapUsd('2.5')).toBe(2.5)
  })

  it('falls back to Infinity for non-numeric or non-positive values', () => {
    expect(parseFeatureCapUsd('not-a-number')).toBe(Infinity)
    expect(parseFeatureCapUsd('0')).toBe(Infinity)
    expect(parseFeatureCapUsd('-5')).toBe(Infinity)
  })
})

describe('featureCapEnvKey', () => {
  it('builds a feature-level key when no variant is given', () => {
    expect(featureCapEnvKey('presentation')).toBe('FEATURE_SPEND_CAP_PRESENTATION_USD')
  })

  it('builds a more specific variant-level key when a variant is given', () => {
    expect(featureCapEnvKey('presentation', 'deep')).toBe('FEATURE_SPEND_CAP_PRESENTATION_DEEP_USD')
  })

  it('uppercases and sanitises characters that would not be a valid env var name', () => {
    // Guards against a feature/variant value (however unlikely to be attacker-controlled
    // in practice — both come from CallContext, not raw user input) turning into an
    // arbitrary env var lookup.
    expect(featureCapEnvKey('document_extraction')).toBe('FEATURE_SPEND_CAP_DOCUMENT_EXTRACTION_USD')
    expect(featureCapEnvKey('weird feature!', 'v@riant')).toBe('FEATURE_SPEND_CAP_WEIRD_FEATURE__V_RIANT_USD')
  })
})
