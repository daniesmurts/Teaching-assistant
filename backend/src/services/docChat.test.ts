import { describe, it, expect } from 'vitest'
import { extractCitedIndices } from './docChat'

describe('extractCitedIndices', () => {
  it('collects cited indices and leaves valid markers in place', () => {
    const { cleaned, cited } = extractCitedIndices('Первое утверждение [1]. Второе [2].', 3)
    expect(cleaned).toBe('Первое утверждение [1]. Второе [2].')
    expect(cited).toEqual(new Set([1, 2]))
  })

  it('strips markers pointing at a source index that does not exist', () => {
    const { cleaned, cited } = extractCitedIndices('Утверждение [5].', 2)
    expect(cleaned).toBe('Утверждение .')
    expect(cited.size).toBe(0)
  })

  it('handles a multi-index marker, dropping only the invalid numbers', () => {
    const { cleaned, cited } = extractCitedIndices('Комбинированный факт [1, 9, 2].', 3)
    expect(cleaned).toBe('Комбинированный факт [1, 2].')
    expect(cited).toEqual(new Set([1, 2]))
  })

  it('returns an empty cited set and unmodified text when there are no markers', () => {
    const { cleaned, cited } = extractCitedIndices('Просто текст без ссылок.', 3)
    expect(cleaned).toBe('Просто текст без ссылок.')
    expect(cited.size).toBe(0)
  })

  it('rejects index 0 and negative-looking groups as out of range', () => {
    const { cleaned, cited } = extractCitedIndices('Текст [0].', 3)
    expect(cleaned).toBe('Текст .')
    expect(cited.size).toBe(0)
  })
})
