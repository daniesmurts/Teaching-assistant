import { describe, it, expect } from 'vitest'
import { parseInstructions } from './assignmentInstructions'

// The generated shape (services/presentations.ts's buildAssignmentFromDeck)
const FROM_A_LECTURE = `Письменная работа по материалу лекции 2 «Система фундаментальных уравнения сохранения».

1. В каких случаях применение LES оправдано, а когда достаточно RANS?
   — Какие физические явления важны?
   — Какие доступны вычислительные ресурсы?

Ответ обоснуйте, опираясь на материал лекции.`

describe('parseInstructions', () => {
  it('separates the intro, the question, its prompts and the closing line', () => {
    const blocks = parseInstructions(FROM_A_LECTURE)
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'question', 'paragraph'])
    expect(blocks[1]).toMatchObject({
      number: '1',
      text: 'В каких случаях применение LES оправдано, а когда достаточно RANS?',
      prompts: ['Какие физические явления важны?', 'Какие доступны вычислительные ресурсы?'],
    })
    expect((blocks[2] as { text: string }).text).toBe('Ответ обоснуйте, опираясь на материал лекции.')
  })

  it('handles several questions', () => {
    const blocks = parseInstructions('1. Первый?\n   — уточнение\n2) Второй?')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ number: '1', prompts: ['уточнение'] })
    expect(blocks[1]).toMatchObject({ number: '2', text: 'Второй?', prompts: [] })
  })

  it('joins a hard-wrapped paragraph instead of stacking one-line paragraphs', () => {
    // Text pasted out of Word arrives wrapped at ~80 columns.
    const blocks = parseInstructions('Опишите процесс\nи обоснуйте выбор\nметода.')
    expect(blocks).toEqual([{ kind: 'paragraph', text: 'Опишите процесс и обоснуйте выбор метода.' }])
  })

  it('does not attach a dash in prose to a question further up', () => {
    const blocks = parseInstructions('1. Вопрос?\nПояснение к работе.\n— это тире в тексте')
    const question = blocks[0] as { prompts: string[] }
    expect(question.prompts).toEqual([])
    expect(blocks.map((b) => b.kind)).toEqual(['question', 'paragraph', 'paragraph'])
  })

  it('leaves hand-typed instructions with no structure as one paragraph', () => {
    // Most assignments are typed freehand; nothing here may mangle them.
    expect(parseInstructions('Напишите эссе на 500 слов.')).toEqual([
      { kind: 'paragraph', text: 'Напишите эссе на 500 слов.' },
    ])
  })

  it('returns nothing for empty input', () => {
    expect(parseInstructions('')).toEqual([])
    expect(parseInstructions('\n\n   \n')).toEqual([])
  })
})
