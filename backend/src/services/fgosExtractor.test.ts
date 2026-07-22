import { describe, it, expect, vi } from 'vitest'
import { extractFgosDraft } from './fgosExtractor'

const { chatJSONMock } = vi.hoisted(() => ({ chatJSONMock: vi.fn() }))
vi.mock('./deepseek', () => ({ chatJSON: chatJSONMock }))

const SOURCE_TEXT = `
Федеральный государственный образовательный стандарт высшего образования
09.03.04 Программная инженерия (уровень бакалавриата)

УК-1. Способен осуществлять поиск, критический анализ и синтез информации,
применять системный подход для решения поставленных задач.

ОПК-1. Способен применять естественнонаучные и общеинженерные знания,
методы математического анализа и моделирования в профессиональной деятельности.
`.trim()

describe('extractFgosDraft', () => {
  it('returns empty draft for text too short to be a real ФГОС', async () => {
    const draft = await extractFgosDraft('too short')
    expect(draft.competencies).toEqual([])
    expect(chatJSONMock).not.toHaveBeenCalled()
  })

  it('marks a competency verified when its formulation is verbatim in the source', async () => {
    chatJSONMock.mockResolvedValueOnce({
      standard: { direction_code: '09.03.04', level: 'бакалавриат', title: 'Программная инженерия' },
      competencies: [
        { type: 'УК', code: 'УК-1', formulation: 'Способен осуществлять поиск, критический анализ и синтез информации, применять системный подход для решения поставленных задач.' },
      ],
      structure_requirements: [],
      profstandard_refs: [],
    })

    const draft = await extractFgosDraft(SOURCE_TEXT)
    expect(draft.competencies).toHaveLength(1)
    expect(draft.competencies[0].is_verbatim_verified).toBe(true)
    expect(draft.standard.direction_code).toBe('09.03.04')
  })

  it('marks a paraphrased (non-verbatim) competency as unverified, not dropped', async () => {
    chatJSONMock.mockResolvedValueOnce({
      standard: { direction_code: '09.03.04', level: 'бакалавриат', title: 'Программная инженерия' },
      competencies: [
        { type: 'УК', code: 'УК-1', formulation: 'Умеет искать и анализировать информацию системно.' }, // paraphrased, not verbatim
      ],
      structure_requirements: [],
      profstandard_refs: [],
    })

    const draft = await extractFgosDraft(SOURCE_TEXT)
    expect(draft.competencies).toHaveLength(1)
    expect(draft.competencies[0].is_verbatim_verified).toBe(false)
  })

  it('drops a competency row missing a required field (type/code/formulation)', async () => {
    chatJSONMock.mockResolvedValueOnce({
      standard: {},
      competencies: [
        { type: 'УК', code: 'УК-1' }, // missing formulation
        { type: 'ОПК', code: 'ОПК-1', formulation: 'Способен применять естественнонаучные и общеинженерные знания.' },
      ],
      structure_requirements: [],
      profstandard_refs: [],
    })

    const draft = await extractFgosDraft(SOURCE_TEXT)
    expect(draft.competencies).toHaveLength(1)
    expect(draft.competencies[0].code).toBe('ОПК-1')
  })

  it('fails soft to an empty draft when chatJSON throws', async () => {
    chatJSONMock.mockRejectedValueOnce(new Error('provider unavailable'))
    const draft = await extractFgosDraft(SOURCE_TEXT)
    expect(draft).toEqual({ standard: {}, competencies: [], structureRequirements: [], profstandardRefs: [] })
  })

  it('passes through structure requirements and профстандарт refs', async () => {
    chatJSONMock.mockResolvedValueOnce({
      standard: { direction_code: '09.03.04', level: 'бакалавриат', title: 'Программная инженерия' },
      competencies: [],
      structure_requirements: [{ block_label: 'Блок 1. Дисциплины (модули)', min_credits: 180, max_credits: 200, notes: null }],
      profstandard_refs: [{ code: '06.001', name: 'Программист', source_url: null }],
    })

    const draft = await extractFgosDraft(SOURCE_TEXT)
    expect(draft.structureRequirements).toEqual([
      { block_label: 'Блок 1. Дисциплины (модули)', min_credits: 180, max_credits: 200, notes: null },
    ])
    expect(draft.profstandardRefs).toEqual([{ code: '06.001', name: 'Программист', source_url: null }])
  })
})
