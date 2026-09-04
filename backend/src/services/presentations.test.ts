import { describe, it, expect, vi } from 'vitest'

vi.mock('./yandexImages', () => ({ yandexImageSearch: vi.fn() }))

import {
  filterCitations, outlineMaxTokens, expansionBatchMaxTokens,
  normaliseOutline, normaliseEditedOutline, OUTLINE_TITLE_MAX_CHARS, OUTLINE_BRIEF_MAX_CHARS,
  createSourcePool, chunkArray,
  getSlideImageQuery, withSlideImage, autoFillImages,
  shouldUseWebGrounding, isStrictSource, OUTLINE_MAX_OUTPUT_TOKENS,
} from './presentations'
import {
  estimateSlideCount, MAX_SLIDE_COUNT, MIN_SLIDE_COUNT,
} from '../../../shared/types'
import { yandexImageSearch } from './yandexImages'
import type { PresentationSource, Slide, DiagramSlide, ConceptSlide, ImageCandidate } from '../../../shared/types'
import type { RelevantChunk } from '../db/queries/chunks'

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

describe('outlineMaxTokens', () => {
  it('scales up for larger decks', () => {
    expect(outlineMaxTokens(20)).toBeGreaterThan(outlineMaxTokens(5))
  })

  // The ceiling used to be 4000, which covers only ~44 slides at the ~90
  // tokens/slide the outline actually needs — so any deck past that had its
  // outline JSON truncated mid-array, normaliseOutline() accepted the short
  // result, and the teacher silently got fewer slides than requested. That
  // was reachable in production because validation already allowed 50.
  it('budgets the whole supported slide range without truncating', () => {
    for (const n of [45, 50, MAX_SLIDE_COUNT]) {
      expect(outlineMaxTokens(n)).toBeGreaterThanOrEqual(n * 90)
    }
  })

  it('never exceeds the provider output ceiling', () => {
    expect(outlineMaxTokens(MAX_SLIDE_COUNT)).toBeLessThanOrEqual(OUTLINE_MAX_OUTPUT_TOKENS)
    expect(outlineMaxTokens(500)).toBeLessThanOrEqual(OUTLINE_MAX_OUTPUT_TOKENS)
  })
})

describe('estimateSlideCount', () => {
  // The old ratio was 2 min/slide, which teachers reported as far too sparse
  // — a 45-minute lecture produced 23 slides where they expected 30–45.
  it('matches the 1–1.5 min/slide density teachers actually lecture at', () => {
    expect(estimateSlideCount(45)).toBe(30)
    expect(estimateSlideCount(90)).toBe(60)
  })

  it('clamps to the supported range', () => {
    expect(estimateSlideCount(1)).toBe(MIN_SLIDE_COUNT)
    expect(estimateSlideCount(240)).toBe(MAX_SLIDE_COUNT)
  })

  // A duration whose estimate exceeds the cap must not produce a target the
  // validator would reject — the two ceilings are the same constant.
  it('never returns more than validation accepts', () => {
    for (const m of [10, 45, 60, 90, 120, 180, 240]) {
      expect(estimateSlideCount(m)).toBeLessThanOrEqual(MAX_SLIDE_COUNT)
    }
  })
})

describe('expansionBatchMaxTokens', () => {
  it('gives deep mode a larger per-slide budget than standard', () => {
    expect(expansionBatchMaxTokens(5, 'deep')).toBeGreaterThan(expansionBatchMaxTokens(5, 'standard'))
  })

  it('scales up with batch size', () => {
    expect(expansionBatchMaxTokens(6, 'standard')).toBeGreaterThan(expansionBatchMaxTokens(3, 'standard'))
  })

  it('caps at 8192 regardless of batch size (deepseek/qwen maxOutputTokens ceiling)', () => {
    expect(expansionBatchMaxTokens(50, 'deep')).toBe(8192)
  })

  it('fits a realistic batch (EXPANSION_BATCH_SIZE=5) comfortably under the ceiling at both depths', () => {
    expect(expansionBatchMaxTokens(5, 'standard')).toBeLessThan(8192)
    expect(expansionBatchMaxTokens(5, 'deep')).toBeLessThan(8192)
  })
})

describe('normaliseOutline', () => {
  it('coerces valid entries and preserves order', () => {
    const raw = [
      { type: 'title', title: 'Введение', brief: 'обзор темы' },
      { type: 'concept', title: 'Насосы', brief: 'определение насоса' },
      { type: 'summary', title: 'Итоги', brief: '' },
    ]
    const out = normaliseOutline(raw, 3)
    expect(out.map((s) => s.type)).toEqual(['title', 'concept', 'summary'])
    expect(out[1].title).toBe('Насосы')
    expect(out[1].brief).toBe('определение насоса')
  })

  it('falls back unknown types to bullets', () => {
    // Middle slide (not position 0/last) so the title/summary safety net
    // below doesn't mask the fallback being tested here.
    const out = normaliseOutline([
      { type: 'title', title: 'A', brief: '' },
      { type: 'nonsense', title: 'X', brief: '' },
      { type: 'summary', title: 'Y', brief: '' },
    ], 3)
    expect(out[1].type).toBe('bullets')
  })

  it('forces the first slide to title and the last to summary even if the model got it wrong', () => {
    const raw = [
      { type: 'bullets', title: 'A', brief: '' },
      { type: 'concept', title: 'B', brief: '' },
      { type: 'discussion', title: 'C', brief: '' },
    ]
    const out = normaliseOutline(raw, 3)
    expect(out[0].type).toBe('title')
    expect(out[out.length - 1].type).toBe('summary')
    expect(out[1].type).toBe('concept')   // middle untouched
  })

  it('falls back to a minimal 2-slide shell on total outline failure', () => {
    expect(normaliseOutline(null, 20)).toHaveLength(2)
    expect(normaliseOutline([], 20).map((s) => s.type)).toEqual(['title', 'summary'])
  })

  it('bounds a runaway array to a defensive ceiling instead of trusting it unbounded', () => {
    const huge = Array.from({ length: 500 }, (_, i) => ({ type: 'bullets', title: `S${i}`, brief: '' }))
    const out = normaliseOutline(huge, 10)
    expect(out.length).toBeLessThanOrEqual(20)   // slideTarget*2
  })

  it('gives a fallback title to entries missing one, keyed by position', () => {
    const out = normaliseOutline([{ type: 'title' }, { type: 'summary' }], 2)
    expect(out[0].title).toBe('Слайд 1')
    expect(out[1].title).toBe('Слайд 2')
  })
})

describe('chunkArray', () => {
  it('splits into groups of the given size', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns a single group when size exceeds the array length', () => {
    expect(chunkArray([1, 2], 5)).toEqual([[1, 2]])
  })

  it('returns an empty array for an empty input', () => {
    expect(chunkArray([], 3)).toEqual([])
  })
})

describe('createSourcePool', () => {
  function chunk(overrides: Partial<RelevantChunk> = {}): RelevantChunk {
    return {
      document_id: 'd1', file_name: 'syllabus.pdf', chunk_index: 0,
      chunk_type: 'overview', text: 'full chunk text here', page_start: 1, page_end: 1,
      source_scope: 'course',
      ...overrides,
    }
  }

  it('assigns incrementing idx to distinct chunks', () => {
    const pool = createSourcePool()
    const [s1] = pool.ingest([chunk({ chunk_index: 0 })])
    const [s2] = pool.ingest([chunk({ chunk_index: 1 })])
    expect(s1.idx).toBe(1)
    expect(s2.idx).toBe(2)
  })

  it('dedupes the same chunk retrieved by two different batches, reusing the same idx', () => {
    const pool = createSourcePool()
    const [first]  = pool.ingest([chunk({ chunk_index: 0 })])
    const [second] = pool.ingest([chunk({ chunk_index: 0 })])   // same document_id+chunk_index
    expect(second.idx).toBe(first.idx)
    expect(pool.all()).toHaveLength(1)
  })

  it('treats the same chunk_index on a different document as distinct', () => {
    const pool = createSourcePool()
    pool.ingest([chunk({ document_id: 'd1', chunk_index: 0 })])
    pool.ingest([chunk({ document_id: 'd2', chunk_index: 0 })])
    expect(pool.all()).toHaveLength(2)
  })

  it('stores the untruncated chunk text for the prompt, separate from the excerpt', () => {
    const pool = createSourcePool()
    const longText = 'x'.repeat(500)
    const [source] = pool.ingest([chunk({ text: longText })])
    expect(pool.fullText.get(source.idx)).toBe(longText)
    expect(source.excerpt.length).toBeLessThan(longText.length)   // popover excerpt stays truncated
  })
})

// ─── Phase 2 — auto-images ─────────────────────────────────────────────────

function diagramSlide(overrides: Partial<DiagramSlide['body']> = {}): DiagramSlide {
  return {
    type: 'diagram', title: 'Схема', notes: '', citations: [],
    body: { image_query: 'осевой насос разрез', caption: '', points: [], image: null, ...overrides },
  }
}

function conceptSlide(overrides: Partial<ConceptSlide> = {}): ConceptSlide {
  return {
    type: 'concept', title: 'Понятие', notes: '', citations: [],
    body: { definition: 'x', supporting: [] },
    ...overrides,
  }
}

function imageCandidate(overrides: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    url: 'https://example.com/a.jpg', source_url: 'https://example.com/p',
    thumbnail: 'https://example.com/t.jpg', width: 800, height: 600,
    source_host: 'example.com', ...overrides,
  }
}

describe('getSlideImageQuery', () => {
  it("reads diagram's query from body", () => {
    expect(getSlideImageQuery(diagramSlide({ image_query: 'разрез насоса' }))).toBe('разрез насоса')
  })

  it('reads other types from the top-level field', () => {
    expect(getSlideImageQuery(conceptSlide({ image_query: 'схема детали' }))).toBe('схема детали')
  })

  it('returns empty string when a non-diagram slide has no image_query', () => {
    expect(getSlideImageQuery(conceptSlide())).toBe('')
  })
})

describe('withSlideImage', () => {
  it("writes into body.image for diagram, leaving top-level image untouched", () => {
    const img = { url: 'u', source_url: 's', thumbnail: 't', width: 1, height: 1, query: 'q', source_host: null }
    const out = withSlideImage(diagramSlide(), img) as DiagramSlide
    expect(out.body.image).toEqual(img)
    expect((out as Slide).image).toBeUndefined()
  })

  it('writes into the top-level field for non-diagram types', () => {
    const img = { url: 'u', source_url: 's', thumbnail: 't', width: 1, height: 1, query: 'q', source_host: null }
    const out = withSlideImage(conceptSlide(), img)
    expect(out.image).toEqual(img)
  })
})

describe('autoFillImages', () => {
  it('fills the top-ranked candidate for slides that have a query', async () => {
    vi.mocked(yandexImageSearch).mockResolvedValue([imageCandidate({ source_host: 'winner.com' })])
    const [out] = await autoFillImages([conceptSlide({ image_query: 'деталь чертёж' })], null)
    expect(out.image?.source_host).toBe('winner.com')
    expect(out.image?.query).toBe('деталь чертёж')
  })

  it('leaves slides without a query untouched (no search call)', async () => {
    const search = vi.mocked(yandexImageSearch)
    search.mockClear()
    const [out] = await autoFillImages([conceptSlide()], null)
    expect(out.image).toBeUndefined()
    expect(search).not.toHaveBeenCalled()
  })

  it('leaves the image empty when search finds nothing, without throwing', async () => {
    vi.mocked(yandexImageSearch).mockResolvedValue([])
    const [out] = await autoFillImages([conceptSlide({ image_query: 'ничего не найдётся' })], null)
    expect(out.image).toBeUndefined()
  })

  it('degrades silently on a search failure — best-effort, same as RAG retrieval', async () => {
    vi.mocked(yandexImageSearch).mockRejectedValue(new Error('network down'))
    const [out] = await autoFillImages([conceptSlide({ image_query: 'x' })], null)
    expect(out.image).toBeUndefined()
  })

  it('fills diagram slides too (previously always left null at generation)', async () => {
    vi.mocked(yandexImageSearch).mockResolvedValue([imageCandidate()])
    const [out] = await autoFillImages([diagramSlide()], null) as [DiagramSlide]
    expect(out.body.image).not.toBeNull()
  })
})

// ─── Phase 3 — web-search grounding ────────────────────────────────────────

describe('shouldUseWebGrounding', () => {
  it('grounds a course-less generation with no pasted conspectus', () => {
    expect(shouldUseWebGrounding(false, false, false)).toBe(true)
  })

  it('grounds a course with zero ingested chunks', () => {
    expect(shouldUseWebGrounding(false, true, false)).toBe(true)
  })

  it('does not ground when a course has RAG material', () => {
    expect(shouldUseWebGrounding(false, true, true)).toBe(false)
  })

  it('never grounds when the teacher pasted their own conspectus, regardless of course state', () => {
    expect(shouldUseWebGrounding(true, false, false)).toBe(false)
    expect(shouldUseWebGrounding(true, true, false)).toBe(false)
    expect(shouldUseWebGrounding(true, true, true)).toBe(false)
  })
})

// ─── «Строго по конспекту» ─────────────────────────────────────────────────

describe('isStrictSource', () => {
  it('is on when the box is checked and a conspectus was supplied', () => {
    expect(isStrictSource({ strictSource: true, sourceText: 'Мой конспект.' })).toBe(true)
  })

  it('is off when the box is unchecked', () => {
    expect(isStrictSource({ strictSource: false, sourceText: 'Мой конспект.' })).toBe(false)
    expect(isStrictSource({ sourceText: 'Мой конспект.' })).toBe(false)
  })

  // A checked box with no conspectus would otherwise forbid the model from
  // writing anything at all — there'd be no material to be strict about.
  it('is off when there is no conspectus to be strict about', () => {
    expect(isStrictSource({ strictSource: true })).toBe(false)
    expect(isStrictSource({ strictSource: true, sourceText: '' })).toBe(false)
    expect(isStrictSource({ strictSource: true, sourceText: '   \n  ' })).toBe(false)
  })

  // Strict mode implies sourceText, and sourceText already disables both web
  // grounding and RAG retrieval — so a strict deck is grounded solely in the
  // teacher's own text. Pinning that here so the two rules can't drift apart.
  it('implies a conspectus, which already suppresses web grounding', () => {
    const params = { strictSource: true, sourceText: 'Мой конспект.' }
    expect(isStrictSource(params)).toBe(true)
    expect(shouldUseWebGrounding(Boolean(params.sourceText), true, true)).toBe(false)
  })
})

// ─── normaliseEditedOutline (TODO.md "### AO" Phase 0) ──────────────────────
//
// The teacher-edited counterpart of normaliseOutline. The distinction that
// matters: this one must NOT repair structure — a teacher who deleted the
// title slide meant to.

describe('normaliseEditedOutline', () => {
  it('keeps a teacher-edited order and types verbatim', () => {
    const edited = [
      { type: 'concept', title: 'Понятие', brief: 'определение' },
      { type: 'formula', title: 'Формула', brief: '' },
    ]
    expect(normaliseEditedOutline(edited)).toEqual(edited)
  })

  it('does not force a title first or a summary last, unlike normaliseOutline', () => {
    const edited = [
      { type: 'concept',    title: 'Понятие',   brief: '' },
      { type: 'discussion', title: 'Обсуждение', brief: '' },
    ]
    const out = normaliseEditedOutline(edited)!
    expect(out[0].type).toBe('concept')
    expect(out[out.length - 1].type).toBe('discussion')

    // Same input through the model-repair path *is* restructured — this is
    // the behavioural difference the two functions exist for.
    const repaired = normaliseOutline(edited, 2)
    expect(repaired[0].type).toBe('title')
    expect(repaired[repaired.length - 1].type).toBe('summary')
  })

  it('drops rows the teacher blanked out', () => {
    const out = normaliseEditedOutline([
      { type: 'bullets', title: 'Оставить', brief: '' },
      { type: 'bullets', title: '   ',      brief: 'осиротевшее описание' },
    ])
    expect(out).toEqual([{ type: 'bullets', title: 'Оставить', brief: '' }])
  })

  it('coerces an unknown type to bullets rather than rejecting the row', () => {
    const out = normaliseEditedOutline([{ type: 'wat', title: 'Слайд', brief: '' }])
    expect(out).toEqual([{ type: 'bullets', title: 'Слайд', brief: '' }])
  })

  it('truncates oversized fields — every one lands in the expansion prompt', () => {
    const out = normaliseEditedOutline([
      { type: 'bullets', title: 'т'.repeat(500), brief: 'б'.repeat(2000) },
    ])!
    expect(out[0].title.length).toBe(OUTLINE_TITLE_MAX_CHARS)
    expect(out[0].brief.length).toBe(OUTLINE_BRIEF_MAX_CHARS)
  })

  it('caps the array at MAX_SLIDE_COUNT', () => {
    const many = Array.from({ length: MAX_SLIDE_COUNT + 20 }, (_, i) => ({ type: 'bullets', title: `С${i}`, brief: '' }))
    expect(normaliseEditedOutline(many)!.length).toBe(MAX_SLIDE_COUNT)
  })

  it('returns null when nothing usable survives, so the route can 400', () => {
    expect(normaliseEditedOutline([])).toBeNull()
    expect(normaliseEditedOutline([{ type: 'bullets', title: '', brief: 'x' }])).toBeNull()
    expect(normaliseEditedOutline('не массив')).toBeNull()
    expect(normaliseEditedOutline(null)).toBeNull()
  })
})
