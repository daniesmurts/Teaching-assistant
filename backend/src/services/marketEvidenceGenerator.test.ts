import { describe, it, expect, vi, beforeEach } from 'vitest'

const { chatJSONMock } = vi.hoisted(() => ({ chatJSONMock: vi.fn() }))
vi.mock('./deepseek', () => ({ chatJSON: chatJSONMock }))

import { generateMarketEvidenceSection } from './marketEvidenceGenerator'
import type { VacancySnapshot } from './labourMarket'

const SNAPSHOT: VacancySnapshot = {
  fetched_at: '2026-07-22T20:00:00.000Z',
  regions: [{
    region_code: '1600000000000',
    region_name: 'Республика Татарстан',
    by_profession: [{
      term: 'инженер-технолог', total: 86,
      sample: [{ title: 'Инженер-технолог', employer: 'АО «ТАИФ-НК»', salary: 'от 85000', url: 'https://x', date: '2026-06-17' }],
    }],
  }],
}

describe('generateMarketEvidenceSection', () => {
  beforeEach(() => { chatJSONMock.mockClear() })

  it('returns the generated text from the LLM call', async () => {
    chatJSONMock.mockResolvedValueOnce({ text: 'По состоянию на 22.07.2026 в Республике Татарстан зафиксировано 86 вакансий по профессии «инженер-технолог»…' })

    const result = await generateMarketEvidenceSection({
      programTitle: 'Технологические машины и оборудование',
      profstandards: [{ code: '28.003', name: 'Специалист по автоматизации и механизации механосборочного производства' }],
      snapshot: SNAPSHOT,
      teacherId: 'teacher-1',
    })

    expect(result.text).toContain('86 вакансий')
    expect(chatJSONMock).toHaveBeenCalledOnce()
  })

  it('passes teacherId/institutionId through as call context for spend-cap tracking', async () => {
    chatJSONMock.mockResolvedValueOnce({ text: 'текст' })

    await generateMarketEvidenceSection({
      programTitle: 'X', profstandards: [], snapshot: SNAPSHOT,
      teacherId: 'teacher-1', institutionId: 'inst-1',
    })

    const [, , opts] = chatJSONMock.mock.calls[0]
    expect(opts.context).toMatchObject({ teacherId: 'teacher-1', institutionId: 'inst-1', feature: 'presentation' })
  })

  it('serializes only the given profstandards/vacancy data into the prompt (no fabrication surface)', async () => {
    chatJSONMock.mockResolvedValueOnce({ text: 'текст' })

    await generateMarketEvidenceSection({
      programTitle: 'Технологические машины и оборудование',
      profstandards: [{ code: '28.003', name: 'Тест' }],
      snapshot: SNAPSHOT,
      teacherId: 'teacher-1',
    })

    const [messages] = chatJSONMock.mock.calls[0]
    const userMessage = messages.find((m: { role: string }) => m.role === 'user').content
    expect(userMessage).toContain('28.003')
    expect(userMessage).toContain('86')
    expect(userMessage).toContain('Республика Татарстан')
  })

  it('serializes multiple regions into the prompt, each with its own vacancy data', async () => {
    chatJSONMock.mockResolvedValueOnce({ text: 'текст' })
    const multiRegionSnapshot: VacancySnapshot = {
      fetched_at: SNAPSHOT.fetched_at,
      regions: [
        SNAPSHOT.regions[0],
        { region_code: '7700000000000', region_name: 'Москва', by_profession: [{ term: 'инженер-технолог', total: 300, sample: [] }] },
      ],
    }

    await generateMarketEvidenceSection({
      programTitle: 'X', profstandards: [], snapshot: multiRegionSnapshot, teacherId: 'teacher-1',
    })

    const [messages] = chatJSONMock.mock.calls[0]
    const userMessage = messages.find((m: { role: string }) => m.role === 'user').content
    expect(userMessage).toContain('Республика Татарстан')
    expect(userMessage).toContain('Москва')
    expect(userMessage).toContain('300')
  })

  it('includes strategy excerpts in the prompt context only when passed (Plane-2)', async () => {
    chatJSONMock.mockResolvedValueOnce({ text: 'текст' })

    await generateMarketEvidenceSection({
      programTitle: 'X', profstandards: [], snapshot: SNAPSHOT, teacherId: 'teacher-1',
      strategyExcerpts: [{ text: 'Приоритет — развитие инженерных кадров региона.', pageStart: 4, pageEnd: 4 }],
    })

    const [messages] = chatJSONMock.mock.calls[0]
    const systemMessage = messages.find((m: { role: string }) => m.role === 'system').content
    const userMessage   = messages.find((m: { role: string }) => m.role === 'user').content
    expect(systemMessage).toContain('стратегии развития')
    expect(userMessage).toContain('Приоритет — развитие инженерных кадров региона.')
  })

  it('omits any strategy context when strategyExcerpts is not passed', async () => {
    chatJSONMock.mockResolvedValueOnce({ text: 'текст' })

    await generateMarketEvidenceSection({
      programTitle: 'X', profstandards: [], snapshot: SNAPSHOT, teacherId: 'teacher-1',
    })

    const [messages] = chatJSONMock.mock.calls[0]
    const userMessage = messages.find((m: { role: string }) => m.role === 'user').content
    expect(userMessage).not.toContain('"strategy"')
  })

  it('returns empty text (not throwing) when the LLM response has no text field', async () => {
    chatJSONMock.mockResolvedValueOnce({})
    const result = await generateMarketEvidenceSection({
      programTitle: 'X', profstandards: [], snapshot: SNAPSHOT, teacherId: 'teacher-1',
    })
    expect(result.text).toBe('')
  })
})
