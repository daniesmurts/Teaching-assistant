import { describe, it, expect } from 'vitest'
import { findCopiedPkFormulations, type PkCompetencyInput } from './pkFormulation'

// ОТФ B from профстандарт 40.059 «Промышленный дизайнер» — the example the
// методист's screenshot showed alongside her feedback.
const OTF_B = { otf_code: 'B', name: 'Реализация эргономических требований к продукции (изделию) при создании элементов промышленного дизайна' }

describe('findCopiedPkFormulations — the reported defect', () => {
  it('flags a ПК title that is the ОТФ name with its lead-in gerund dropped', () => {
    const competencies: PkCompetencyInput[] = [{
      code: 'ПК-1',
      title: 'Способен обеспечивать эргономические требования к продукции (изделию) при создании элементов промышленного дизайна',
      indicators: [],
      otf: OTF_B,
    }]

    const findings = findCopiedPkFormulations(competencies)

    expect(findings).toHaveLength(1)
    expect(findings[0].competency_code).toBe('ПК-1')
    expect(findings[0].otf_code).toBe('B')
    expect(findings[0].indicator_code).toBeNull()
    expect(findings[0].detail).toMatch(/повторяет ОТФ B/)
  })

  it('flags an indicator (ПК-1.1) copied from the same ОТФ, independent of the ПК title', () => {
    const competencies: PkCompetencyInput[] = [{
      code: 'ПК-1',
      title: 'Способен создавать элементы промышленного дизайна с учётом требований пользователя',
      indicators: [
        { code: 'ПК-1.1', title: 'Эргономические требования к продукции (изделию) при создании элементов промышленного дизайна' },
      ],
      otf: OTF_B,
    }]

    const findings = findCopiedPkFormulations(competencies)

    expect(findings).toHaveLength(1)
    expect(findings[0].indicator_code).toBe('ПК-1.1')
  })

  it('does not flag a genuine reformulation that conveys the ОТФ meaning without copying it', () => {
    const competencies: PkCompetencyInput[] = [{
      code: 'ПК-1',
      title: 'Способен учитывать антропометрические данные пользователя при проектировании бытовой техники',
      indicators: [],
      otf: OTF_B,
    }]

    const findings = findCopiedPkFormulations(competencies)

    expect(findings).toHaveLength(0)
  })

  it('skips a competency with no linked ОТФ — nothing to compare against', () => {
    const competencies: PkCompetencyInput[] = [{
      code: 'ПК-2', title: 'Произвольная формулировка без привязки к профстандарту', indicators: [], otf: null,
    }]

    expect(findCopiedPkFormulations(competencies)).toHaveLength(0)
  })

  it('reports the correct verbatim vs almost-verbatim wording in detail', () => {
    const verbatim = findCopiedPkFormulations([{
      code: 'ПК-1', title: OTF_B.name, indicators: [], otf: OTF_B,
    }])
    expect(verbatim[0].detail).toMatch(/дословно повторяет ОТФ B\./)
    expect(verbatim[0].similarity).toBe(1)
  })
})
