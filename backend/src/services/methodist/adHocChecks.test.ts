import { describe, it, expect, vi } from 'vitest'
import { runAdHocCheck, runAdHocChecks } from './adHocChecks'
import * as syllabusReview from '../syllabusReview'
import * as linkage from '../assessmentLinkage'
import * as mtoReview from '../mtoReview'

describe('runAdHocCheck — per-check error isolation', () => {
  it('converts a thrown error into a status:error outcome instead of throwing', async () => {
    vi.spyOn(syllabusReview, 'reviewSyllabus').mockRejectedValue(new Error('Недостаточно содержания РПД для анализа.'))

    const outcome = await runAdHocCheck('syllabus', 't1', 'x'.repeat(100))

    expect(outcome).toEqual({ key: 'syllabus', status: 'error', error: 'Недостаточно содержания РПД для анализа.' })
  })

  it('runs the linkage check with no ФОС text when none was supplied', async () => {
    vi.spyOn(linkage, 'parseAssessmentLinkage').mockResolvedValue({
      instruments: [], srs_forms: [], ksr_forms: [], brs_items: [],
    })
    const checkSpy = vi.spyOn(linkage, 'checkAssessmentLinkage')

    const outcome = await runAdHocCheck('linkage', 't1', 'x'.repeat(100))

    expect(outcome.status).toBe('ok')
    // Third arg is the parsed ФОС score table — null with no ФОС at all.
    expect(checkSpy).toHaveBeenCalledWith(expect.anything(), undefined, null)
  })

  it('forwards a ФОС uploaded alongside the ad-hoc document — checked for real, just not persisted', async () => {
    vi.spyOn(linkage, 'parseAssessmentLinkage').mockResolvedValue({
      instruments: [], srs_forms: [], ksr_forms: [], brs_items: [],
    })
    const checkSpy = vi.spyOn(linkage, 'checkAssessmentLinkage')

    const scoreSpy = vi.spyOn(linkage, 'parseFosNumbers').mockResolvedValue({ rows: null, criteria: [] })

    await runAdHocCheck('linkage', 't1', 'x'.repeat(100), { fosText: 'текст фос' })

    expect(scoreSpy).toHaveBeenCalledWith('t1', 'текст фос')
    expect(checkSpy).toHaveBeenCalledWith(expect.anything(), 'текст фос', { rows: null, criteria: [] })
  })

  it('runs the mto check with an empty allDisciplines/siblingReviews — no siblings to suggest from', async () => {
    const mtoSpy = vi.spyOn(mtoReview, 'reviewMto').mockResolvedValue({
      software_items: [], generic_items: [], findings: [], summary: 'ок',
    })

    const outcome = await runAdHocCheck('mto', 't1', 'x'.repeat(100))

    expect(outcome.status).toBe('ok')
    expect(mtoSpy).toHaveBeenCalledWith(expect.objectContaining({ allDisciplines: [], siblingReviews: [] }))
  })
})

describe('runAdHocChecks — batch independence', () => {
  it('one failing check does not block the others', async () => {
    vi.spyOn(syllabusReview, 'reviewSyllabus').mockRejectedValue(new Error('boom'))
    vi.spyOn(linkage, 'parseAssessmentLinkage').mockResolvedValue({
      instruments: [], srs_forms: [], ksr_forms: [], brs_items: [],
    })

    const outcomes = await runAdHocChecks(['syllabus', 'linkage'], 't1', 'x'.repeat(100))

    expect(outcomes.find((o) => o.key === 'syllabus')?.status).toBe('error')
    expect(outcomes.find((o) => o.key === 'linkage')?.status).toBe('ok')
  })
})
