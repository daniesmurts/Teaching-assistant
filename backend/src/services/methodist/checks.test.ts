import { describe, it, expect, vi } from 'vitest'
import { runCheck, runChecks } from './checks'
import * as target from './target'
import * as documentReview from '../documentReview'
import * as syllabusReview from '../syllabusReview'
import * as programDocumentReviews from '../../db/queries/programDocumentReviews'
import { NotFoundError } from '../../errors/AppError'
import type { ProgramDetail, ProgramDiscipline } from '../../../../shared/types'

const teacher = { id: 't1', is_platform_admin: false, institution_id: 'inst1' }

function discipline(overrides: Partial<ProgramDiscipline> = {}): ProgramDiscipline {
  return {
    id: 'disc1', course_id: null, name: 'Матанализ', semester: 1, credits: 3,
    control_form: null, competency_codes: ['УК-1'], sort_order: 0,
    ...overrides,
  }
}

function detail(overrides: Partial<ProgramDetail> = {}): ProgramDetail {
  return {
    id: 'prog1', institution_id: 'inst1', created_by: null, org_unit_id: 'unit1',
    disciplines: [discipline()],
    competencies: [{ id: 'c1', kind: 'competency', code: 'УК-1', title: 'Системное мышление', sort_order: 0 }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...overrides,
  } as any
}

describe('runCheck — per-check error isolation', () => {
  it('converts a ValidationError (e.g. no competency codes) into a status:error outcome, not a thrown error', async () => {
    vi.spyOn(target, 'loadReadableDiscipline').mockResolvedValue({
      detail: detail(), discipline: discipline({ competency_codes: [] }),
    })

    const outcome = await runCheck('coverage', { programId: 'prog1', disciplineId: 'disc1' }, teacher)

    expect(outcome.status).toBe('error')
    expect(outcome.key).toBe('coverage')
    expect(outcome.error).toMatch(/компетенции/)
  })

  it('lets a NotFoundError (bad target) propagate instead of becoming a per-check error', async () => {
    vi.spyOn(target, 'loadReadableDiscipline').mockRejectedValue(new NotFoundError('Дисциплина'))

    await expect(
      runCheck('coverage', { programId: 'prog1', disciplineId: 'ghost' }, teacher)
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns status:ok with a result_id when the check succeeds and persists', async () => {
    vi.spyOn(target, 'loadReadableDiscipline').mockResolvedValue({ detail: detail(), discipline: discipline() })
    // findWorkingProgrammeForDiscipline is imported directly in checks.ts —
    // mock via the module it's re-exported from.
    const programDocuments = await import('../../db/queries/programDocuments')
    vi.spyOn(programDocuments, 'findWorkingProgrammeForDiscipline').mockResolvedValue({
      document: { id: 'doc1' } as any, extractedText: 'x'.repeat(200),
    })
    vi.spyOn(documentReview, 'reviewDocumentCoverage').mockResolvedValue({
      overall_coverage: 80, items: [], summary: 'ок',
    })
    vi.spyOn(programDocumentReviews, 'insertReview').mockResolvedValue({
      id: 'review1', program_id: 'prog1', discipline_id: 'disc1', document_id: 'doc1',
      result: { overall_coverage: 80, items: [], summary: 'ок' }, created_at: '2026-01-01',
    })

    const outcome = await runCheck('coverage', { programId: 'prog1', disciplineId: 'disc1' }, teacher)

    expect(outcome).toEqual({ key: 'coverage', status: 'ok', result_id: 'review1' })
  })
})

describe('runCheck — linkage', () => {
  it('passes the discipline\'s uploaded ФОС text through to the linkage check, when one exists', async () => {
    vi.spyOn(target, 'resolveProgramDisciplineText').mockResolvedValue({
      disciplineName: 'Матанализ', text: 'x'.repeat(200), competencies: [],
    })
    const programDocuments = await import('../../db/queries/programDocuments')
    vi.spyOn(programDocuments, 'findFosForDiscipline').mockResolvedValue({
      document: { id: 'fos1' } as any, extractedText: 'фос текст',
    })
    const linkage = await import('../assessmentLinkage')
    vi.spyOn(linkage, 'parseAssessmentLinkage').mockResolvedValue({
      instruments: [], srs_forms: [], ksr_forms: [], brs_items: [],
    })
    const checkSpy = vi.spyOn(linkage, 'checkAssessmentLinkage')
    // Stubbed explicitly rather than left to the real parse — the point of the
    // test is that the ФОС text reaches BOTH the number extraction and the
    // check, not whatever a stubbed chatJSON happens to return.
    const numbersSpy = vi.spyOn(linkage, 'parseFosNumbers')
      .mockResolvedValue({ rows: null, criteria: [] })

    const outcome = await runCheck('linkage', { programId: 'prog1', disciplineId: 'disc1' }, teacher)

    expect(outcome.status).toBe('ok')
    expect(numbersSpy).toHaveBeenCalledWith(teacher.id, 'фос текст')
    expect(checkSpy).toHaveBeenCalledWith(expect.anything(), 'фос текст', { rows: null, criteria: [] })
  })

  it('runs with no ФОС text when none was uploaded — does not throw or block the check', async () => {
    vi.spyOn(target, 'resolveProgramDisciplineText').mockResolvedValue({
      disciplineName: 'Матанализ', text: 'x'.repeat(200), competencies: [],
    })
    const programDocuments = await import('../../db/queries/programDocuments')
    vi.spyOn(programDocuments, 'findFosForDiscipline').mockResolvedValue(null)
    const linkage = await import('../assessmentLinkage')
    vi.spyOn(linkage, 'parseAssessmentLinkage').mockResolvedValue({
      instruments: [], srs_forms: [], ksr_forms: [], brs_items: [],
    })

    const outcome = await runCheck('linkage', { programId: 'prog1', disciplineId: 'disc1' }, teacher)

    expect(outcome.status).toBe('ok')
    expect((outcome.result as { fos_available: boolean }).fos_available).toBe(false)
  })
})

describe('runChecks — batch independence', () => {
  it('one failing check does not block the others from returning a result', async () => {
    vi.spyOn(target, 'loadReadableDiscipline').mockResolvedValue({
      detail: detail(), discipline: discipline({ competency_codes: [] }),   // makes coverage fail
    })
    vi.spyOn(target, 'resolveProgramDisciplineText').mockResolvedValue({
      disciplineName: 'Матанализ', text: 'x'.repeat(200), competencies: [],
    })
    vi.spyOn(syllabusReview, 'reviewSyllabus').mockResolvedValue({
      items: [], summary: 'ок', covered: 0, partial: 0, missing: 0,
      competencies_source: 'declared', goals_source: 'declared',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const outcomes = await runChecks(['syllabus', 'coverage'], { programId: 'prog1', disciplineId: 'disc1' }, teacher)

    const syllabusOutcome = outcomes.find((o) => o.key === 'syllabus')
    const coverageOutcome = outcomes.find((o) => o.key === 'coverage')
    expect(syllabusOutcome?.status).toBe('ok')
    expect(coverageOutcome?.status).toBe('error')
  })
})
