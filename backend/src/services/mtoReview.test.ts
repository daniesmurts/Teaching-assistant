import { describe, it, expect, vi } from 'vitest'
import { reviewMto } from './mtoReview'

const { chatJSONMock, embedMock } = vi.hoisted(() => ({ chatJSONMock: vi.fn(), embedMock: vi.fn() }))
vi.mock('./deepseek', () => ({ chatJSON: chatJSONMock, embed: embedMock }))

describe('reviewMto — §12 must survive truncation on a real-length РПД', () => {
  // Found in production 2026-08-20: a naive slice(0, 20000) from the start of
  // the document cut off §12 (it sits after §9-11, near the end of a real
  // 14-page РПД), so the check reported "раздел пуст" even when §12 clearly
  // listed real software (ABBYY FineReader, MS Office, 7-Zip, …) — the model
  // was simply never shown that text. Same fix, same shape of test, as
  // assessmentLinkage.test.ts's §9 regression.
  it('includes §12 text in the prompt even when it sits past the old 20000-char cutoff', async () => {
    chatJSONMock.mockResolvedValue({ software: [], generic: [] })

    const filler = 'Лекционный материал по теме. '.repeat(1200)   // ~36000 chars
    const documentText = [
      '4. Структура и содержание дисциплины',
      filler,
      '12. Материально-техническое обеспечение дисциплины',
      'Офисные и деловые программы: ABBYY FineReader 9.0 проф; MS Office 2010-2016 Standard; 7 Zip',
    ].join('\n')
    expect(documentText.length).toBeGreaterThan(20000)

    await reviewMto({
      teacherId: 't1',
      discipline: { course_id: null, name: 'Иностранный язык', semester: 1, credits: null, control_form: null, competency_codes: [], sort_order: 0 },
      allDisciplines: [],
      documentText,
      siblingReviews: [],
    })

    const userMessage = chatJSONMock.mock.calls[0][0][1].content as string
    expect(userMessage).toContain('Материально-техническое обеспечение')
    expect(userMessage).toContain('ABBYY FineReader')
  })
})
