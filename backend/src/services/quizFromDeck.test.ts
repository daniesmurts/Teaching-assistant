import { describe, it, expect, vi, beforeEach } from 'vitest'

// Covers the deck → тест link (TODO.md "### AO" Phase 3): the quiz row records
// which lecture it came from, and the prompt frames the material as a lecture
// just delivered rather than as reference notes.
vi.mock('./deepseek', () => ({ chatJSON: vi.fn(), embed: vi.fn() }))
vi.mock('../db/queries/quizzes', () => ({ createQuiz: vi.fn(), countQuizzesThisMonth: vi.fn() }))
vi.mock('../db/queries/courses', () => ({ findCourseById: vi.fn() }))
vi.mock('../db/queries/chunks', () => ({ findRelevantChunks: vi.fn() }))
vi.mock('../db/queries/ragDocumentUses', () => ({ logDocumentRetrievals: vi.fn() }))
vi.mock('./ragScope', () => ({ resolveRagRetrievalScope: vi.fn() }))

import { generateQuiz, assertQuizQuota } from './quizzes'
import { chatJSON } from './deepseek'
import { createQuiz, countQuizzesThisMonth } from '../db/queries/quizzes'

const QUESTIONS = Array.from({ length: 8 }, (_, i) => ({
  question: `Вопрос ${i}`, options: ['a', 'b', 'c', 'd'], correct_index: 0, explanation: 'потому что',
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(chatJSON).mockResolvedValue({ questions: QUESTIONS } as never)
  vi.mocked(createQuiz).mockImplementation(async (d) => ({ id: 'q1', ...d }) as never)
})

const deckParams = {
  teacherId: 't1', topic: 'Кавитация', questionCount: 8,
  sourceText: 'СЛАЙД 1: Кавитация\nЗАМЕТКИ ДОКЛАДЧИКА: пример с насосом',
  presentationId: 'p1',
}

describe('generateQuiz from a lecture deck', () => {
  it('records which lecture the test came from', async () => {
    await generateQuiz(deckParams)
    expect(vi.mocked(createQuiz).mock.calls[0][0]).toMatchObject({ presentationId: 'p1', topic: 'Кавитация' })
  })

  it('frames the material as a lecture the students have just sat through', async () => {
    await generateQuiz(deckParams)
    const prompt = vi.mocked(chatJSON).mock.calls[0][0][1].content
    expect(prompt).toContain('Материал прочитанной лекции')
    expect(prompt).toContain('Не спрашивайте о том, чего в ней не было')
    expect(prompt).toContain('пример с насосом')   // speaker notes reach the prompt
  })

  it('keeps the plain conspectus framing when the source is pasted text, not a deck', async () => {
    await generateQuiz({ ...deckParams, presentationId: undefined })
    const prompt = vi.mocked(chatJSON).mock.calls[0][0][1].content
    expect(prompt).toContain('Конспект лекции')
    expect(prompt).not.toContain('Материал прочитанной лекции')
  })

  it('does not retrieve RAG sources when the deck supplies the material', async () => {
    await generateQuiz({ ...deckParams, courseId: 'c1' })
    // sourceText takes priority over retrieval — same precedent as a pasted
    // conspectus. The deck IS the material; topping it up with course
    // documents would put questions on the test about things not in the lecture.
    expect(vi.mocked(createQuiz).mock.calls[0][0].sources ?? []).toEqual([])
  })
})

describe('assertQuizQuota', () => {
  it('lets a Pro teacher through without counting', async () => {
    await expect(assertQuizQuota('t1', 'pro')).resolves.toBeUndefined()
    expect(countQuizzesThisMonth).not.toHaveBeenCalled()
  })

  it('throws once a free teacher is at their monthly limit', async () => {
    vi.mocked(countQuizzesThisMonth).mockResolvedValue(3)
    // The whole point of sharing this check with the deck route: generating a
    // test from a lecture is still generating a test.
    await expect(assertQuizQuota('t1', 'free')).rejects.toThrow(/лимит генерации тестов/)
  })

  it('lets a free teacher through below the limit', async () => {
    vi.mocked(countQuizzesThisMonth).mockResolvedValue(0)
    await expect(assertQuizQuota('t1', 'free')).resolves.toBeUndefined()
  })
})
