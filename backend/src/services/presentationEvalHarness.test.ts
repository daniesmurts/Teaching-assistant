import { describe, it, expect, vi } from 'vitest'

vi.mock('./presentations', async () => {
  const actual = await vi.importActual<typeof import('./presentations')>('./presentations')
  return { ...actual, generatePresentation: vi.fn() }
})

import { scoreSlides, runPresentationEval, type EvalTopic } from './presentationEvalHarness'
import { generatePresentation } from './presentations'
import type { Slide, TitleSlide, ConceptSlide, BulletsSlide, SummarySlide, DiagramSlide } from '../../../shared/types'

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `слово${i}`).join(' ')
}

function titleSlide(notes = ''): TitleSlide {
  return { type: 'title', title: 'Титул', notes, citations: [], body: { subtitle: null, lecturer: null } }
}

function conceptSlide(overrides: Partial<ConceptSlide> = {}): ConceptSlide {
  return {
    type: 'concept', title: 'Понятие', notes: words(200), citations: [],
    body: { definition: 'x', supporting: [] },
    ...overrides,
  }
}

function bulletsSlide(overrides: Partial<BulletsSlide> = {}): BulletsSlide {
  return {
    type: 'bullets', title: 'Тезисы', notes: words(200), citations: [],
    body: { items: ['a'] },
    ...overrides,
  }
}

function summarySlide(overrides: Partial<SummarySlide> = {}): SummarySlide {
  return {
    type: 'summary', title: 'Итоги', notes: words(200), citations: [],
    body: { takeaways: [], next_steps: [] },
    ...overrides,
  }
}

function diagramSlide(overrides: Partial<DiagramSlide['body']> = {}): DiagramSlide {
  return {
    type: 'diagram', title: 'Схема', notes: words(200), citations: [],
    body: { image_query: 'x', caption: '', points: [], image: null, ...overrides },
  }
}

describe('scoreSlides', () => {
  it('excludes the title slide from notes word-count stats', () => {
    const slides: Slide[] = [titleSlide('короткое вступление'), conceptSlide()]
    const score = scoreSlides(slides, 'standard')
    // Only the concept slide's 200 words count — title's short intro is excluded.
    expect(score.avgNotesWordCount).toBe(200)
    expect(score.minNotesWordCount).toBe(200)
  })

  it('flags notes below the depth target via notesBelowTargetShare', () => {
    const thin = conceptSlide({ notes: words(50) })   // well under standard's 180-220 floor
    const full = conceptSlide({ notes: words(200) })
    const score = scoreSlides([titleSlide(), thin, full], 'standard')
    expect(score.notesBelowTargetShare).toBeCloseTo(0.5)
  })

  it('uses the deep target when scoring a deep-mode deck', () => {
    const midRange = conceptSlide({ notes: words(220) })   // clears standard's floor (180) but not deep's (260)
    const score = scoreSlides([titleSlide(), midRange], 'deep')
    expect(score.notesBelowTargetShare).toBe(1)
  })

  it('excludes title AND summary from image-coverage eligibility', () => {
    const slides: Slide[] = [titleSlide(), summarySlide(), conceptSlide()]
    const score = scoreSlides(slides, 'standard')
    // Neither title nor summary should count toward the eligible denominator.
    expect(score.imageCoverageAmongEligible).toBe(0)   // the one eligible slide (concept) has no image
  })

  it('counts an auto-filled image on a non-diagram slide toward coverage', () => {
    const withImage = conceptSlide({
      image: { url: 'u', source_url: 's', thumbnail: 't', width: 1, height: 1, query: 'q', source_host: null },
    })
    const score = scoreSlides([titleSlide(), withImage], 'standard')
    expect(score.imageCoverageAmongEligible).toBe(1)
  })

  it('counts a diagram image via body.image, not the (unused) top-level field', () => {
    const withImage = diagramSlide({
      image: { url: 'u', source_url: 's', thumbnail: 't', width: 1, height: 1, query: 'q', source_host: null },
    })
    const score = scoreSlides([titleSlide(), withImage], 'standard')
    expect(score.imageCoverageAmongEligible).toBe(1)
  })

  it('computes bulletsShare over the whole deck including title/summary', () => {
    const score = scoreSlides([titleSlide(), bulletsSlide(), bulletsSlide(), conceptSlide()], 'standard')
    expect(score.bulletsShare).toBeCloseTo(2 / 4)
  })

  it('computes citedSlideShare from any slide with ≥1 citation', () => {
    const cited = conceptSlide({ citations: [1] })
    const uncited = conceptSlide({ citations: [] })
    const score = scoreSlides([titleSlide(), cited, uncited], 'standard')
    expect(score.citedSlideShare).toBeCloseTo(1 / 3)
  })

  it('returns zeroed stats for an empty deck without dividing by zero', () => {
    const score = scoreSlides([], 'standard')
    expect(score.avgNotesWordCount).toBe(0)
    expect(score.minNotesWordCount).toBe(0)
    expect(score.notesBelowTargetShare).toBe(0)
    expect(score.bulletsShare).toBe(0)
    expect(score.imageCoverageAmongEligible).toBe(0)
    expect(score.citedSlideShare).toBe(0)
  })
})

describe('runPresentationEval', () => {
  const TOPIC: EvalTopic = { topic: 'x', durationMinutes: 60, teacherId: 't1' }

  it('scores a successful generation and reports sourcesAvailable from result.sources', async () => {
    vi.mocked(generatePresentation).mockResolvedValue({
      presentation_id: 'p1',
      slides: [titleSlide(), conceptSlide()],
      generated_content: '',
      sources: [{ idx: 1, document_id: 'd', file_name: 'f', page_start: null, page_end: null, excerpt: '', chunk_type: null }],
    })

    const report = await runPresentationEval([TOPIC])
    expect(report.failed).toEqual([])
    expect(report.scored).toHaveLength(1)
    expect(report.scored[0].sourcesAvailable).toBe(true)
    expect(report.scored[0].topic).toBe('x')
  })

  it('records a failure without throwing, so other topics still run', async () => {
    vi.mocked(generatePresentation).mockRejectedValue(new Error('LLM down'))

    const report = await runPresentationEval([TOPIC])
    expect(report.scored).toEqual([])
    expect(report.failed).toEqual([{ topic: 'x', error: 'LLM down' }])
  })

  it('excludes sourceless decks from the cited-slide-share summary average', async () => {
    vi.mocked(generatePresentation)
      .mockResolvedValueOnce({
        presentation_id: 'p1', slides: [conceptSlide({ citations: [1] })],
        generated_content: '', sources: [{ idx: 1, document_id: 'd', file_name: 'f', page_start: null, page_end: null, excerpt: '', chunk_type: null }],
      })
      .mockResolvedValueOnce({
        presentation_id: 'p2', slides: [conceptSlide({ citations: [] })],
        generated_content: '', sources: [],
      })

    const report = await runPresentationEval([TOPIC, { ...TOPIC, topic: 'y' }])
    // Only the sourced deck (citedSlideShare=1) should feed the average — not the sourceless one.
    expect(report.summary.avgCitedSlideShare).toBe(1)
  })

  it('reports progress as topics complete', async () => {
    vi.mocked(generatePresentation).mockResolvedValue({
      presentation_id: 'p1', slides: [titleSlide()], generated_content: '', sources: [],
    })
    const progress: Array<[number, number]> = []
    await runPresentationEval([TOPIC, { ...TOPIC, topic: 'y' }], (done, total) => progress.push([done, total]))
    expect(progress).toHaveLength(2)
    expect(progress[progress.length - 1]).toEqual([2, 2])
  })
})
