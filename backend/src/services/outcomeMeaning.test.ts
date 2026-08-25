import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkOutcomeMeaning, buildMeaningItems } from './outcomeMeaning'
import type { ContentSection } from '../../../shared/types'

const { chatJSONMock } = vi.hoisted(() => ({ chatJSONMock: vi.fn() }))
vi.mock('./deepseek', () => ({ chatJSON: chatJSONMock }))

beforeEach(() => chatJSONMock.mockReset())

const INDICATOR = 'Знает и понимает сущность технологических процессов производства кулинарной продукции'
const declared = [{ code: 'ОПК-4.1', title: INDICATOR, level: 'indicator' as const }]

const content: Record<ContentSection, string | null> = {
  lectures: null,
  practicals: 'Умная кухня: датчики, термометры и электронные чек-листы.',
  labs: null,
  independent: 'Цифровой контроль качества готовой продукции.',
  control: null,
}

function run(items: { ref: string; kind: 'knowledge' | 'skill' | 'mastery'; title: string }[]) {
  return checkOutcomeMeaning({ teacherId: 't1', items, declared, content })
}

const GENERIC = { ref: 'K0', kind: 'knowledge' as const, title: 'современные подходы к решению профессиональных задач' }

describe('checkOutcomeMeaning', () => {
  it('reports only problems — an acceptable formulation produces nothing', async () => {
    chatJSONMock.mockResolvedValueOnce({
      items: [{ ref: 'K0', indicator_code: 'ОПК-4.1', verdict: 'ok', detail: '', recommendation: '' }],
    })
    expect(await run([GENERIC])).toEqual([])
  })

  it('returns a finding for a formulation with no link to the discipline', async () => {
    chatJSONMock.mockResolvedValueOnce({
      items: [{
        ref: 'K0', indicator_code: 'ОПК-4.1', verdict: 'weak_link',
        detail: 'Формулировка общая.', recommendation: 'Свяжите с темами дисциплины.',
      }],
    })

    const [f] = await run([GENERIC])
    expect(f.verdict).toBe('weak_link')
    expect(f.outcome_title).toBe(GENERIC.title)
    expect(f.indicator_code).toBe('ОПК-4.1')
    expect(f.indicator_title).toBe(INDICATOR)
  })

  it('drops a verdict for a ref the model invented', async () => {
    chatJSONMock.mockResolvedValueOnce({
      items: [{ ref: 'K99', indicator_code: 'ОПК-4.1', verdict: 'weak_link', detail: 'x', recommendation: 'y' }],
    })
    expect(await run([GENERIC])).toEqual([])
  })

  it('refuses to echo an indicator code the РПД never declared', async () => {
    chatJSONMock.mockResolvedValueOnce({
      items: [{ ref: 'K0', indicator_code: 'ПК-9.9', verdict: 'not_reflected', detail: 'x', recommendation: 'y' }],
    })

    const [f] = await run([GENERIC])
    // Points at nothing rather than at a row that does not exist — same
    // contract the coverage citations follow.
    expect(f.indicator_code).toBeNull()
    expect(f.indicator_title).toBeNull()
  })

  it('drops an unrecognised verdict rather than guessing', async () => {
    chatJSONMock.mockResolvedValueOnce({
      items: [{ ref: 'K0', indicator_code: 'ОПК-4.1', verdict: 'maybe', detail: 'x', recommendation: 'y' }],
    })
    expect(await run([GENERIC])).toEqual([])
  })

  it('fills in wording when the model returns a verdict but no explanation', async () => {
    chatJSONMock.mockResolvedValueOnce({
      items: [{ ref: 'K0', indicator_code: 'ОПК-4.1', verdict: 'not_reflected' }],
    })

    const [f] = await run([GENERIC])
    expect(f.detail).toMatch(/не раскрывает смысл/)
    expect(f.recommendation).toMatch(/Переформулируйте/)
  })

  it('never calls the model when there is nothing to judge', async () => {
    expect(await run([])).toEqual([])
    expect(await checkOutcomeMeaning({ teacherId: 't1', items: [GENERIC], declared: [], content })).toEqual([])
    expect(chatJSONMock).not.toHaveBeenCalled()
  })

  it('propagates a provider failure instead of returning an empty all-clear', async () => {
    chatJSONMock.mockRejectedValueOnce(new Error('provider unavailable'))
    // The caller decides how to degrade; swallowing it here would make a
    // failed check indistinguishable from a clean one.
    await expect(run([GENERIC])).rejects.toThrow('provider unavailable')
  })
})

describe('buildMeaningItems', () => {
  const outcomes = { knowledge: ['копия индикатора', 'своя формулировка'], skills: ['умение'], mastery: [] }

  it('skips lines the deterministic copy check already flagged', () => {
    const items = buildMeaningItems(outcomes, [
      { outcome_kind: 'knowledge', outcome_title: 'копия индикатора' },
    ])
    expect(items.map((i) => i.title)).toEqual(['своя формулировка', 'умение'])
  })

  it('keeps refs aligned to each list position, not to the filtered order', () => {
    const items = buildMeaningItems(outcomes, [
      { outcome_kind: 'knowledge', outcome_title: 'копия индикатора' },
    ])
    // 'своя формулировка' is index 1 of knowledge → K1, so a finding maps back
    // to the right line even after earlier ones are filtered out.
    expect(items[0].ref).toBe('K1')
    expect(items[1].ref).toBe('S0')
  })

  it('matches the skip list on kind as well as text', () => {
    const items = buildMeaningItems(
      { knowledge: ['одно и то же'], skills: ['одно и то же'], mastery: [] },
      [{ outcome_kind: 'skill', outcome_title: 'одно и то же' }],
    )
    expect(items.map((i) => i.kind)).toEqual(['knowledge'])
  })
})
