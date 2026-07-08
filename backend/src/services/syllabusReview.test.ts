import { describe, it, expect } from 'vitest'
import { toItem, type Requirement, type RawScored } from './syllabusReview'
import type { ContentSection } from '../../../shared/types'

// toItem is the deterministic layer of the РПД conformance check: it validates
// the model's excerpt quotes against the real section text and enforces the
// scoring rubric ("covered" requires verifiable evidence). These tests pin
// that behaviour — the LLM layer above it is stabilised separately via
// temperature 0.

const req: Requirement = {
  ref: 'K0', kind: 'knowledge', code: null,
  title: 'основные численные методы', parent_code: null,
}

// Haystacks are pre-normalised (lowercase, collapsed whitespace) by the caller.
function haystacks(overrides: Partial<Record<ContentSection, string>> = {}): Record<ContentSection, string> {
  return {
    lectures:    'тема 1. численные методы решения уравнений. тема 2. интерполяция и аппроксимация.',
    practicals:  'решение систем линейных уравнений методом гаусса.',
    labs:        '',
    independent: '',
    control:     'экзамен по билетам, включающим численные методы.',
    ...overrides,
  }
}

function raw(overrides: Partial<RawScored> = {}): RawScored {
  return {
    ref: 'K0',
    status: 'covered',
    score: 90,
    sources: [{ section: 'lectures', excerpt: 'численные методы решения уравнений' }],
    gap: '',
    recommendation: '',
    ...overrides,
  }
}

describe('toItem — excerpt validation', () => {
  it('keeps a source whose excerpt appears verbatim in the claimed section', () => {
    const item = toItem(req, raw(), haystacks())
    expect(item.status).toBe('covered')
    expect(item.sources).toHaveLength(1)
    expect(item.evidence).toBe('численные методы решения уравнений')
  })

  it('matches case- and whitespace-insensitively', () => {
    const item = toItem(req, raw({
      sources: [{ section: 'lectures', excerpt: 'ЧИСЛЕННЫЕ   МЕТОДЫ\nрешения уравнений' }],
    }), haystacks())
    expect(item.sources).toHaveLength(1)
  })

  it('drops a hallucinated excerpt that is not in the section', () => {
    const item = toItem(req, raw({
      sources: [{ section: 'lectures', excerpt: 'глубокое обучение и нейронные сети' }],
    }), haystacks())
    expect(item.sources).toHaveLength(0)
  })

  it('drops an excerpt attributed to the wrong section', () => {
    const item = toItem(req, raw({
      sources: [{ section: 'labs', excerpt: 'численные методы решения уравнений' }],
    }), haystacks())
    expect(item.sources).toHaveLength(0)
  })

  it('drops excerpts shorter than 8 characters (too weak to verify)', () => {
    const item = toItem(req, raw({
      sources: [{ section: 'lectures', excerpt: 'тема 1' }],
    }), haystacks())
    expect(item.sources).toHaveLength(0)
  })

  it('drops sources with an invalid section name', () => {
    const item = toItem(req, raw({
      sources: [{ section: 'seminars', excerpt: 'численные методы решения уравнений' }],
    }), haystacks())
    expect(item.sources).toHaveLength(0)
  })
})

describe('toItem — rubric enforcement (covered requires evidence)', () => {
  it('demotes covered → partial when every excerpt fails validation', () => {
    const item = toItem(req, raw({
      sources: [{ section: 'lectures', excerpt: 'выдуманная цитата которой нет в тексте' }],
    }), haystacks())
    expect(item.status).toBe('partial')
  })

  it('discards the model score on demotion (falls back to the partial default)', () => {
    const item = toItem(req, raw({
      score: 95,
      sources: [{ section: 'lectures', excerpt: 'выдуманная цитата которой нет в тексте' }],
    }), haystacks())
    expect(item.status).toBe('partial')
    expect(item.score).toBe(55)   // clampScore's partial default, not the model's 95
  })

  it('does not demote partial/missing — the rubric only binds covered', () => {
    const item = toItem(req, raw({ status: 'partial', sources: [] }), haystacks())
    expect(item.status).toBe('partial')
    const item2 = toItem(req, raw({ status: 'missing', sources: [], score: 10 }), haystacks())
    expect(item2.status).toBe('missing')
  })

  it('keeps covered when at least one source survives validation', () => {
    const item = toItem(req, raw({
      sources: [
        { section: 'lectures', excerpt: 'выдуманная цитата которой нет в тексте' },
        { section: 'control',  excerpt: 'экзамен по билетам' },
      ],
    }), haystacks())
    expect(item.status).toBe('covered')
    expect(item.sources).toHaveLength(1)
    expect(item.sources[0].section).toBe('control')
  })
})

describe('toItem — defensive defaults', () => {
  it('treats a requirement the model skipped entirely as missing', () => {
    const item = toItem(req, undefined, haystacks())
    expect(item.status).toBe('missing')
    expect(item.score).toBe(15)
    expect(item.sources).toHaveLength(0)
  })

  it('treats an invalid status string as missing', () => {
    const item = toItem(req, raw({ status: 'excellent', sources: [] }), haystacks())
    expect(item.status).toBe('missing')
  })
})
