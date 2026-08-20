import { describe, it, expect, vi } from 'vitest'
import { extractProfstandardDraft } from './profstandardExtractor'

const { chatJSONMock } = vi.hoisted(() => ({ chatJSONMock: vi.fn() }))
vi.mock('./deepseek', () => ({ chatJSON: chatJSONMock }))

const SOURCE_TEXT = `
Профессиональный стандарт
40.059 Промышленный дизайнер

III. Характеристика обобщённых трудовых функций

Обобщённая трудовая функция B: Реализация эргономических требований к
продукции (изделию) при создании элементов промышленного дизайна.
Уровень квалификации: 6.
Требования к образованию и обучению: Высшее образование – бакалавриат.
`.trim()

describe('extractProfstandardDraft', () => {
  it('returns empty draft for text too short to be a real профстандарт', async () => {
    const draft = await extractProfstandardDraft('too short')
    expect(draft.otf).toEqual([])
    expect(chatJSONMock).not.toHaveBeenCalled()
  })

  it('marks an ОТФ verified when its name is verbatim in the source', async () => {
    chatJSONMock.mockResolvedValueOnce({
      standard: { code: '40.059', name: 'Промышленный дизайнер' },
      otf: [{
        otf_code: 'B',
        name: 'Реализация эргономических требований к продукции (изделию) при создании элементов промышленного дизайна',
        qualification_level: '6',
        education_requirement: 'Высшее образование – бакалавриат',
      }],
    })

    const draft = await extractProfstandardDraft(SOURCE_TEXT)
    expect(draft.otf).toHaveLength(1)
    expect(draft.otf[0].is_verbatim_verified).toBe(true)
    expect(draft.standard.code).toBe('40.059')
  })

  it('marks a paraphrased (non-verbatim) ОТФ as unverified, not dropped', async () => {
    chatJSONMock.mockResolvedValueOnce({
      standard: { code: '40.059', name: 'Промышленный дизайнер' },
      otf: [{ otf_code: 'B', name: 'Учёт эргономики изделий дизайна' }], // paraphrased, not verbatim
    })

    const draft = await extractProfstandardDraft(SOURCE_TEXT)
    expect(draft.otf).toHaveLength(1)
    expect(draft.otf[0].is_verbatim_verified).toBe(false)
  })

  it('drops an ОТФ row missing a required field (otf_code/name)', async () => {
    chatJSONMock.mockResolvedValueOnce({
      standard: {},
      otf: [
        { otf_code: 'A' }, // missing name
        { otf_code: 'B', name: 'Реализация эргономических требований к продукции' },
      ],
    })

    const draft = await extractProfstandardDraft(SOURCE_TEXT)
    expect(draft.otf).toHaveLength(1)
    expect(draft.otf[0].otf_code).toBe('B')
  })

  it('propagates a chatJSON error rather than silently returning an empty draft (same discipline as fgosExtractor.ts)', async () => {
    chatJSONMock.mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(extractProfstandardDraft(SOURCE_TEXT)).rejects.toThrow('provider unavailable')
  })
})
