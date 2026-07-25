import { describe, it, expect, vi, beforeEach } from 'vitest'
import { scoreOnce } from './grading'
import type { CriteriaSnapshotItem } from '../../../shared/types'
import type { SimilarAssignment } from '../db/queries/assignments'

// scoreOnce is the ensemble's cheap score-only sampler. These tests assert it
// grades under the SAME information as the primary (gradeOnce): policy memo,
// criteria descriptions, and the full retrieved-examples block. Before the
// symmetry fix it saw none of the memo, criteria descriptions, or example
// content — only bare grade labels — so the ensemble's dispersion measured an
// information asymmetry we created ourselves as if it were examiner
// disagreement, inflating score_std and over-reporting 'low' confidence.
const { chatJSONMock, embedMock } = vi.hoisted(() => ({ chatJSONMock: vi.fn(), embedMock: vi.fn() }))
vi.mock('./deepseek', () => ({ chatJSON: chatJSONMock, embed: embedMock }))

/** The user-role prompt scoreOnce sent on its most recent call. */
function lastUserPrompt(): string {
  const messages = chatJSONMock.mock.calls[0][0] as Array<{ role: string; content: string }>
  return messages.find((m) => m.role === 'user')!.content
}

function criterion(over: Partial<CriteriaSnapshotItem> = {}): CriteriaSnapshotItem {
  return { criterion_id: null, name: 'Аргументация', weight: 100, description: null, ...over }
}

function example(over: Partial<SimilarAssignment> = {}): SimilarAssignment {
  return {
    id: 'a1',
    submission_text: 'Текст ранее оценённой работы про цифровизацию.',
    approved_score: 78,
    approved_grade: '4',
    approved_feedback: 'Хорошая структура, слабые выводы.',
    similarity: 0.9,
    ...over,
  } as SimilarAssignment
}

const baseParams = {
  submissionText: 'Работа студента о цифровизации образования.',
  criteria: [] as CriteriaSnapshotItem[],
  examples: [] as SimilarAssignment[],
  context: { teacherId: 't1', feature: 'grading' as const },
}

beforeEach(() => {
  chatJSONMock.mockReset()
  chatJSONMock.mockResolvedValue({ score: 80, grade: '4' })
})

describe('scoreOnce — ensemble information symmetry', () => {
  it('includes the grading-policy memo when one is supplied', async () => {
    await scoreOnce({ ...baseParams, policyMemo: 'Преподаватель строго снижает за отсутствие источников.' })
    expect(lastUserPrompt()).toContain('Преподаватель строго снижает за отсутствие источников.')
  })

  it('omits the memo block entirely when there is none', async () => {
    await scoreOnce({ ...baseParams, policyMemo: null })
    expect(lastUserPrompt()).not.toContain('Особенности оценивания')
  })

  it('includes criterion descriptions, not just name and weight', async () => {
    await scoreOnce({
      ...baseParams,
      criteria: [criterion({ name: 'Аргументация', weight: 100, description: 'Опора на источники и логика вывода.' })],
    })
    const prompt = lastUserPrompt()
    expect(prompt).toContain('Аргументация')
    expect(prompt).toContain('вес 100%')
    expect(prompt).toContain('Опора на источники и логика вывода.')
  })

  it('includes retrieved example CONTENT, not only the grade labels', async () => {
    await scoreOnce({ ...baseParams, examples: [example()] })
    const prompt = lastUserPrompt()
    // The old implementation emitted only "4 (78/100)" — the excerpt and the
    // teacher's feedback were dropped, which is the asymmetry being fixed.
    expect(prompt).toContain('Текст ранее оценённой работы')
    expect(prompt).toContain('Хорошая структура, слабые выводы.')
  })
})

describe('scoreOnce — score/grade consistency', () => {
  it('derives the letter from the score, overriding an inconsistent model letter', async () => {
    // Model returns a score in the '3' band (60–72) but claims '5'.
    chatJSONMock.mockResolvedValue({ score: 71, grade: '5' })
    const r = await scoreOnce(baseParams)
    expect(r.score).toBe(71)
    expect(r.grade).toBe('3')
  })

  it('leaves an already-consistent pair alone', async () => {
    chatJSONMock.mockResolvedValue({ score: 91, grade: '5' })
    expect(await scoreOnce(baseParams)).toEqual({ score: 91, grade: '5' })
  })

  it('clamps an out-of-range score before deriving the letter', async () => {
    chatJSONMock.mockResolvedValue({ score: 150, grade: '2' })
    const r = await scoreOnce(baseParams)
    expect(r.score).toBe(100)
    expect(r.grade).toBe('5')
  })
})
