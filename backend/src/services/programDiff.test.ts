import { describe, it, expect } from 'vitest'
import { validateEvidence } from './documentReview'

// diffWorkingProgrammes validates each diff item's evidence against the
// document it's supposed to come from — the NEW text for 'added'/'changed',
// the OLD text for 'removed' (see programDiff.ts). validateEvidence itself
// is document-agnostic (just "does this quote appear verbatim in this
// haystack"), so these tests exercise it the way programDiff.ts does: one
// haystack per side, picking the correct one per change kind.
describe('validateEvidence (reused by programDiff for old/new evidence)', () => {
  const oldHaystack = 'раздел 1. введение в дисциплину. раздел 2. основы теории баз данных.'
  const newHaystack = 'раздел 1. введение в дисциплину. раздел 2. основы теории машинного обучения.'

  it('accepts a quote that appears verbatim in the NEW text (added/changed evidence)', () => {
    expect(validateEvidence('основы теории машинного обучения', newHaystack)).toBe(
      'основы теории машинного обучения'
    )
  })

  it('accepts a quote that appears verbatim in the OLD text (removed evidence)', () => {
    expect(validateEvidence('основы теории баз данных', oldHaystack)).toBe('основы теории баз данных')
  })

  it('rejects a quote checked against the wrong side (hallucinated cross-version evidence)', () => {
    // "баз данных" was removed — a diff item claiming it as evidence from
    // the NEW text must be dropped, not silently validated against the OLD one.
    expect(validateEvidence('основы теории баз данных', newHaystack)).toBeNull()
  })

  it('is case/whitespace-insensitive, same contract as the coverage check', () => {
    expect(validateEvidence('ОСНОВЫ   теории машинного обучения', newHaystack)).toBe(
      'ОСНОВЫ   теории машинного обучения'
    )
  })

  it('rejects quotes under 8 characters or not present at all', () => {
    expect(validateEvidence('корот', newHaystack)).toBeNull()
    expect(validateEvidence('текст, которого нет в документе', newHaystack)).toBeNull()
  })

  it('rejects null/empty evidence', () => {
    expect(validateEvidence(null, newHaystack)).toBeNull()
    expect(validateEvidence(undefined, newHaystack)).toBeNull()
    expect(validateEvidence('', newHaystack)).toBeNull()
  })
})
