// Presentation quality eval harness (TODO.md Feature AG Phase 3) — a
// developer/admin tool for checking whether a prompt change to
// presentations.ts actually improved depth/images, not just changed them.
// No new DB table, no admin route, no job queue: unlike evalHarness.ts's
// grading replay (which needs historical ground-truth scores to compare
// against), there's no "correct" lecture deck to replay against — this is a
// fixed-topic smoke check with objective, computable metrics, run on demand
// via scripts/evalPresentations.ts. Same "small, standalone tool" posture as
// scripts/testYandexImages.ts.

import {
  generatePresentation, getSlideImageQuery, hasSlideImage, NOTES_WORD_TARGET,
  type GenerateParams,
} from './presentations'
import type { Slide, SlideType, PresentationDepth } from '../../../shared/types'
import { logger } from '../lib/logger'
import { computeLiveEditRates, type LiveEditRates } from '../db/queries/presentationSlideEvents'

export interface EvalTopic {
  topic:             string
  durationMinutes:   number
  teacherId:         string
  courseId?:         string
  depth?:            PresentationDepth
  slideCountTarget?: number
}

export interface SlideScore {
  type:            SlideType
  notesWordCount:  number
  hasImage:        boolean
  hasImageQuery:   boolean
  citationCount:   number
}

export interface PresentationScore {
  topic:                    string
  depth:                    PresentationDepth
  slideCount:                number
  slides:                    SlideScore[]
  avgNotesWordCount:         number   // across non-title slides — title's notes are structurally an intro line, not a script
  minNotesWordCount:         number   // the weakest slide matters more than the average for "is this actually deep enough"
  notesBelowTargetShare:     number   // fraction of non-title slides whose notes fall short of the depth's own word-count floor
  bulletsShare:              number   // the prompt itself asks for <1/3 — this checks whether the model actually complied
  typeDistribution:          Partial<Record<SlideType, number>>
  imageCoverageAmongEligible: number  // share of non-title/summary slides carrying an image or image_query
  citedSlideShare:            number  // share of slides with ≥1 citation — only meaningful when sourcesAvailable
  sourcesAvailable:           boolean
  durationMs:                 number
}

export interface PresentationEvalReport {
  scored:  PresentationScore[]
  failed:  Array<{ topic: string; error: string }>
  summary: {
    avgNotesWordCount:     number
    avgMinNotesWordCount:  number
    avgBulletsShare:       number
    avgImageCoverage:      number
    avgCitedSlideShare:    number   // averaged only over decks where sourcesAvailable
  }
  // What real teachers did with real decks over the window (TODO.md "### AO"
  // Phase 2). Everything above measures freshly generated output against
  // structural proxies; this is the only part of the report that reflects
  // whether the output was any *good*. Reported together on purpose: a prompt
  // change that lifts avgNotesWordCount while raising the rewrite rate has
  // improved nothing. Null when the database isn't reachable — an offline
  // scoring run must not fail because live stats are unavailable.
  live: LiveEditRates | null
}

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
}

/**
 * Pure metric computation over an already-generated deck — no network, no
 * DB. Split out from runPresentationEval so it's unit-testable against
 * hand-built slide fixtures instead of a real generation call.
 */
export function scoreSlides(
  slides: Slide[],
  depth: PresentationDepth,
): Omit<PresentationScore, 'topic' | 'durationMs' | 'sourcesAvailable'> {
  const [wMin] = NOTES_WORD_TARGET[depth]

  // Title's notes are structurally a short intro line ("сегодня мы
  // начинаем..."), not a speaking script — including it in the word-count
  // stats would understate real slide depth. Summary IS included: it's a
  // real slide with a real script, just excluded from image-coverage
  // expectations below since a takeaways slide rarely needs a picture.
  const notesEligible = slides.filter((s) => s.type !== 'title')
  const wordCounts = notesEligible.map((s) => countWords(s.notes))

  const imageEligible = slides.filter((s) => s.type !== 'title' && s.type !== 'summary')
  const withImage = imageEligible.filter(hasSlideImage)

  const typeDistribution: Partial<Record<SlideType, number>> = {}
  slides.forEach((s) => { typeDistribution[s.type] = (typeDistribution[s.type] ?? 0) + 1 })

  const citedSlides = slides.filter((s) => s.citations.length > 0)

  return {
    depth,
    slideCount: slides.length,
    slides: slides.map((s) => ({
      type:           s.type,
      notesWordCount: countWords(s.notes),
      hasImage:       hasSlideImage(s),
      hasImageQuery:  getSlideImageQuery(s).length > 0,
      citationCount:  s.citations.length,
    })),
    avgNotesWordCount:     avg(wordCounts),
    minNotesWordCount:     wordCounts.length ? Math.min(...wordCounts) : 0,
    notesBelowTargetShare: wordCounts.length ? wordCounts.filter((w) => w < wMin).length / wordCounts.length : 0,
    bulletsShare:          slides.length ? (typeDistribution.bullets ?? 0) / slides.length : 0,
    typeDistribution,
    imageCoverageAmongEligible: imageEligible.length ? withImage.length / imageEligible.length : 0,
    citedSlideShare:            slides.length ? citedSlides.length / slides.length : 0,
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const EVAL_CONCURRENCY = 2   // gentle on rate limits — real generation calls, not a load test

export async function runPresentationEval(
  topics: EvalTopic[],
  onProgress?: (done: number, total: number) => void,
): Promise<PresentationEvalReport> {
  const scored: PresentationScore[] = []
  const failed: Array<{ topic: string; error: string }> = []
  let done = 0

  await mapWithConcurrency(topics, EVAL_CONCURRENCY, async (t) => {
    const started = Date.now()
    try {
      const params: GenerateParams = {
        teacherId:        t.teacherId,
        courseId:         t.courseId,
        topic:            t.topic,
        durationMinutes:  t.durationMinutes,
        learningGoals:    [],
        depth:            t.depth ?? 'standard',
        slideCountTarget: t.slideCountTarget,
      }
      const result = await generatePresentation(params)
      const metrics = scoreSlides(result.slides, params.depth ?? 'standard')
      scored.push({
        ...metrics,
        topic:            t.topic,
        durationMs:       Date.now() - started,
        sourcesAvailable: result.sources.length > 0,
      })
    } catch (err) {
      logger.warn({ message: '[presentation eval] generation failed', topic: t.topic, error: (err as Error).message })
      failed.push({ topic: t.topic, error: (err as Error).message })
    } finally {
      done += 1
      onProgress?.(done, topics.length)
    }
  })

  const citedEligible = scored.filter((s) => s.sourcesAvailable)

  return {
    scored,
    failed,
    summary: {
      avgNotesWordCount:    avg(scored.map((s) => s.avgNotesWordCount)),
      avgMinNotesWordCount: avg(scored.map((s) => s.minNotesWordCount)),
      avgBulletsShare:      avg(scored.map((s) => s.bulletsShare)),
      avgImageCoverage:     avg(scored.map((s) => s.imageCoverageAmongEligible)),
      avgCitedSlideShare:   avg(citedEligible.map((s) => s.citedSlideShare)),
    },
    live: await computeLiveEditRates().catch((err: Error) => {
      logger.warn({ message: '[presentation eval] live edit rates unavailable', error: err.message })
      return null
    }),
  }
}
