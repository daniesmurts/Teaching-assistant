import { describe, it, expect } from 'vitest'
import { normaliseLecturePlan } from './lecturePlan'

// The extraction call itself is prompt-shaped and covered by the prompt's own
// instructions; what this layer can actually enforce is shape, and the two
// failures that reach a teacher are a duplicated тема (they pick the wrong one
// half the time) and a numbered title that then reads "1. 1. Введение".

describe('normaliseLecturePlan', () => {
  it('keeps the programme order and wording', () => {
    const out = normaliseLecturePlan([
      { title: 'Введение в гидравлику', description: 'Основные понятия' },
      { title: 'Насосы', description: '' },
    ])
    expect(out).toEqual([
      { title: 'Введение в гидравлику', description: 'Основные понятия', source: 'syllabus' },
      { title: 'Насосы', description: null, source: 'syllabus' },
    ])
  })

  it('strips a leading number the programme already carries', () => {
    // Otherwise the picker shows "1. 1. Введение" — position is rendered
    // separately, since it doubles as the lecture number.
    expect(normaliseLecturePlan([{ title: '1. Введение' }])[0].title).toBe('Введение')
    expect(normaliseLecturePlan([{ title: '12) Насосы' }])[0].title).toBe('Насосы')
  })

  it('drops a тема repeated later in the programme', () => {
    const out = normaliseLecturePlan([
      { title: 'Кавитация' },
      { title: 'Насосы' },
      { title: 'кавитация' },   // same тема from the assessment section
    ])
    expect(out.map((t) => t.title)).toEqual(['Кавитация', 'Насосы'])
  })

  it('drops blank rows and non-array input', () => {
    expect(normaliseLecturePlan([{ title: '   ' }, { description: 'нет заголовка' }])).toEqual([])
    expect(normaliseLecturePlan(null)).toEqual([])
    expect(normaliseLecturePlan('план')).toEqual([])
  })

  it('caps the plan and truncates oversized fields', () => {
    const many = Array.from({ length: 90 }, (_, i) => ({ title: `Тема ${i}`, description: 'о'.repeat(2000) }))
    const out = normaliseLecturePlan(many)
    expect(out.length).toBe(60)
    expect(out[0].description!.length).toBe(600)
    expect(normaliseLecturePlan([{ title: 'т'.repeat(500) }])[0].title.length).toBe(200)
  })
})
