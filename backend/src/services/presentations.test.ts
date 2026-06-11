import { describe, it, expect } from 'vitest'
import { filterCitations } from './presentations'
import type { PresentationSource } from '../../../shared/types'

const SOURCES: PresentationSource[] = [
  { idx: 1, document_id: 'd1', file_name: 'syllabus.pdf', page_start: 1, page_end: 1, excerpt: '...', chunk_type: 'overview' },
  { idx: 2, document_id: 'd1', file_name: 'syllabus.pdf', page_start: 4, page_end: 5, excerpt: '...', chunk_type: 'schedule' },
  { idx: 3, document_id: 'd2', file_name: 'reading.pdf', page_start: 10, page_end: 10, excerpt: '...', chunk_type: 'reading_list' },
]

describe('filterCitations', () => {
  it('keeps valid single-number citations and lists only used sources', () => {
    const content = 'Тезис один [1]. Тезис два [3].'
    const { cleaned, used } = filterCitations(content, SOURCES)
    expect(cleaned).toBe(content)
    expect(used.map((s) => s.idx).sort()).toEqual([1, 3])
  })

  it('drops bracketed numbers that do not match a real source (hallucination)', () => {
    const content = 'Тезис [7] и [99] не имеют источников.'
    const { cleaned, used } = filterCitations(content, SOURCES)
    expect(cleaned).toBe('Тезис  и  не имеют источников.')
    expect(used).toEqual([])
  })

  it('handles multi-number citation forms', () => {
    const content = 'Тезис, опирающийся на [1, 2, 3].'
    const { cleaned, used } = filterCitations(content, SOURCES)
    expect(cleaned).toBe('Тезис, опирающийся на [1, 2, 3].')
    expect(used.map((s) => s.idx).sort()).toEqual([1, 2, 3])
  })

  it('removes invalid numbers from a mixed group', () => {
    const content = 'Тезис, источник [1, 99, 2].'
    const { cleaned } = filterCitations(content, SOURCES)
    expect(cleaned).toBe('Тезис, источник [1, 2].')
  })

  it('treats a group with only invalid numbers as fully bogus', () => {
    const content = 'Видимо взято из [42, 99].'
    const { cleaned, used } = filterCitations(content, SOURCES)
    expect(cleaned).toBe('Видимо взято из .')
    expect(used).toEqual([])
  })

  it('passes through content without any citations', () => {
    const content = 'СЛАЙД 1: Введение\n• Тезис\n• Ещё тезис'
    const { cleaned, used } = filterCitations(content, SOURCES)
    expect(cleaned).toBe(content)
    expect(used).toEqual([])
  })

  it('returns empty used when source list is empty', () => {
    const { cleaned, used } = filterCitations('Тезис [1].', [])
    expect(cleaned).toBe('Тезис .')
    expect(used).toEqual([])
  })

  it('deduplicates used sources across multiple mentions', () => {
    const content = '[1] первый. [1] снова. [1, 2].'
    const { used } = filterCitations(content, SOURCES)
    // idx 1 should appear once, idx 2 once
    expect(used.map((s) => s.idx).sort()).toEqual([1, 2])
  })
})
