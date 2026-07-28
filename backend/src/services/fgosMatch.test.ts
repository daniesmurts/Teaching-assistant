import { describe, it, expect } from 'vitest'
import { inferFgosLevel, matchProgramCompetenciesToFgos } from './fgosMatch'
import type { ProgramCompetency, FgosCompetency } from '../../../shared/types'

describe('inferFgosLevel', () => {
  it('maps a populated level column directly', () => {
    expect(inferFgosLevel({ level: 'bachelor', education_level: null })).toBe('бакалавриат')
    expect(inferFgosLevel({ level: 'master', education_level: null })).toBe('магистратура')
    expect(inferFgosLevel({ level: 'specialist', education_level: null })).toBe('специалитет')
  })

  it('falls back to a substring match on education_level when level is null', () => {
    expect(inferFgosLevel({ level: null, education_level: 'Высшее образование — бакалавриат' })).toBe('бакалавриат')
  })

  it('returns null when neither column yields a known term', () => {
    expect(inferFgosLevel({ level: null, education_level: null })).toBeNull()
    expect(inferFgosLevel({ level: null, education_level: 'Среднее профессиональное' })).toBeNull()
  })
})

function competency(overrides: Partial<ProgramCompetency>): ProgramCompetency {
  return { id: 'c1', kind: 'competency', code: null, title: 'Test', sort_order: 0, ...overrides }
}

function fgosCompetency(overrides: Partial<FgosCompetency>): FgosCompetency {
  return { id: 'f1', type: 'УК', code: 'УК-1', formulation: 'Test', is_verbatim_verified: true, ...overrides }
}

describe('matchProgramCompetenciesToFgos', () => {
  it('matches a УК code to its registry counterpart', () => {
    const matches = matchProgramCompetenciesToFgos(
      [competency({ id: 'c1', code: 'УК-1' })],
      [fgosCompetency({ id: 'f1', type: 'УК', code: 'УК-1' })],
    )
    expect(matches).toEqual([{ competencyId: 'c1', fgosCompetencyId: 'f1' }])
  })

  it('matches an ОПК code to its registry counterpart', () => {
    const matches = matchProgramCompetenciesToFgos(
      [competency({ id: 'c1', code: 'ОПК-3' })],
      [fgosCompetency({ id: 'f1', type: 'ОПК', code: 'ОПК-3' })],
    )
    expect(matches).toEqual([{ competencyId: 'c1', fgosCompetencyId: 'f1' }])
  })

  it('normalizes whitespace and case when matching codes', () => {
    const matches = matchProgramCompetenciesToFgos(
      [competency({ id: 'c1', code: '  ук-1  ' })],
      [fgosCompetency({ id: 'f1', type: 'УК', code: 'УК-1' })],
    )
    expect(matches).toEqual([{ competencyId: 'c1', fgosCompetencyId: 'f1' }])
  })

  it('never matches a ПК code — no federal registry entry exists for it by design', () => {
    const matches = matchProgramCompetenciesToFgos(
      [competency({ id: 'c1', code: 'ПК-1' })],
      [fgosCompetency({ id: 'f1', type: 'УК', code: 'ПК-1' })], // even a coincidental registry row shouldn't match
    )
    expect(matches).toEqual([])
  })

  it('does not cross-match a code shared between types', () => {
    const matches = matchProgramCompetenciesToFgos(
      [competency({ id: 'c1', code: 'УК-1' })],
      [fgosCompetency({ id: 'f1', type: 'ОПК', code: 'УК-1' })],
    )
    expect(matches).toEqual([])
  })

  it('leaves goals and codeless rows unmatched', () => {
    const matches = matchProgramCompetenciesToFgos(
      [competency({ id: 'c1', kind: 'goal', code: null })],
      [fgosCompetency({ id: 'f1', type: 'УК', code: 'УК-1' })],
    )
    expect(matches).toEqual([])
  })

  it('leaves a competency unmatched when its code has no counterpart in the (already-published-filtered) registry', () => {
    const matches = matchProgramCompetenciesToFgos(
      [competency({ id: 'c1', code: 'УК-9' })],
      [fgosCompetency({ id: 'f1', type: 'УК', code: 'УК-1' })],
    )
    expect(matches).toEqual([])
  })
})
