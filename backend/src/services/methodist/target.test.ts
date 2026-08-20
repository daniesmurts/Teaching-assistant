import { describe, it, expect, vi } from 'vitest'
import { resolveProgramDisciplineText } from './target'
import * as programsQueries from '../../db/queries/programs'
import * as programDocumentsQueries from '../../db/queries/programDocuments'
import * as programAccess from '../programAccess'
import { NotFoundError, ValidationError, ForbiddenError } from '../../errors/AppError'
import type { ProgramDetail } from '../../../../shared/types'

function baseDetail(overrides: Partial<ProgramDetail> = {}): ProgramDetail {
  return {
    id: 'prog1', institution_id: 'inst1', created_by: null,
    org_unit_id: 'unit1',
    disciplines: [
      { id: 'disc1', course_id: null, name: 'Матанализ', semester: 1, credits: 3, control_form: null, competency_codes: ['УК-1'], sort_order: 0 },
    ],
    competencies: [
      { id: 'c1', kind: 'competency', code: 'УК-1', title: 'Системное мышление', sort_order: 0 },
      { id: 'c2', kind: 'competency', code: 'УК-2', title: 'Другая', sort_order: 1 },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...overrides,
  } as any
}

const teacher = { id: 't1', is_platform_admin: false, institution_id: 'inst1' }

describe('resolveProgramDisciplineText', () => {
  it('resolves text + only the discipline-declared competencies', async () => {
    vi.spyOn(programsQueries, 'getProgramDetail').mockResolvedValue(baseDetail())
    vi.spyOn(programAccess, 'getProgramAccessScope').mockResolvedValue({ kind: 'all-rw' })
    vi.spyOn(programDocumentsQueries, 'findWorkingProgrammeForDiscipline').mockResolvedValue({
      document: {} as any, extractedText: 'x'.repeat(200),
    })

    const result = await resolveProgramDisciplineText({ programId: 'prog1', disciplineId: 'disc1' }, teacher)

    expect(result.disciplineName).toBe('Матанализ')
    expect(result.text.length).toBe(200)
    expect(result.competencies).toEqual([{ code: 'УК-1', title: 'Системное мышление' }])
  })

  it('throws ForbiddenError when programAccessScope does not reach this programme', async () => {
    vi.spyOn(programsQueries, 'getProgramDetail').mockResolvedValue(baseDetail())
    vi.spyOn(programAccess, 'getProgramAccessScope').mockResolvedValue({ kind: 'specific', programUnitIds: ['other-unit'], editableUnitIds: [] })

    await expect(
      resolveProgramDisciplineText({ programId: 'prog1', disciplineId: 'disc1' }, teacher)
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('throws NotFoundError for an unknown programme', async () => {
    vi.spyOn(programsQueries, 'getProgramDetail').mockResolvedValue(null)

    await expect(
      resolveProgramDisciplineText({ programId: 'missing', disciplineId: 'disc1' }, teacher)
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError for a discipline not in the programme', async () => {
    vi.spyOn(programsQueries, 'getProgramDetail').mockResolvedValue(baseDetail())
    vi.spyOn(programAccess, 'getProgramAccessScope').mockResolvedValue({ kind: 'all-rw' })

    await expect(
      resolveProgramDisciplineText({ programId: 'prog1', disciplineId: 'ghost' }, teacher)
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ValidationError when no working programme has been uploaded yet', async () => {
    vi.spyOn(programsQueries, 'getProgramDetail').mockResolvedValue(baseDetail())
    vi.spyOn(programAccess, 'getProgramAccessScope').mockResolvedValue({ kind: 'all-rw' })
    vi.spyOn(programDocumentsQueries, 'findWorkingProgrammeForDiscipline').mockResolvedValue(null)

    await expect(
      resolveProgramDisciplineText({ programId: 'prog1', disciplineId: 'disc1' }, teacher)
    ).rejects.toBeInstanceOf(ValidationError)
  })
})
