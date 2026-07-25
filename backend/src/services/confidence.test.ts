import { describe, it, expect } from 'vitest'
import { computeDispersion, classifyConfidence, buildReconciliationPrompt, type ConfidenceInput } from './confidence'
import type { GradeLetter, EnsembleSample } from '../../../shared/types'

const s = (score: number, grade: GradeLetter): ConfidenceInput => ({ score, grade })

describe('computeDispersion', () => {
  it('reports zero spread for identical samples', () => {
    const d = computeDispersion([s(85, '4'), s(85, '4'), s(85, '4')])
    expect(d.scoreStd).toBe(0)
    expect(d.scoreSpread).toBe(0)
    expect(d.modalGrade).toBe('4')
    expect(d.gradeAgreement).toBe(1)
  })

  it('computes population std and spread', () => {
    const d = computeDispersion([s(80, '4'), s(90, '5'), s(85, '4')])
    expect(d.scoreMean).toBeCloseTo(85, 5)
    expect(d.scoreSpread).toBe(10)
    // population std of [80,90,85] = sqrt(((-5)^2+5^2+0)/3) = sqrt(16.67) ≈ 4.08
    expect(d.scoreStd).toBeCloseTo(4.08, 1)
  })

  it('picks the modal grade and its agreement fraction', () => {
    const d = computeDispersion([s(80, '4'), s(82, '4'), s(70, '3')])
    expect(d.modalGrade).toBe('4')
    expect(d.gradeAgreement).toBeCloseTo(2 / 3, 2)
  })

  it('resolves a grade tie to the higher grade', () => {
    const d = computeDispersion([s(86, '5'), s(72, '4')])
    expect(d.modalGrade).toBe('5')
    expect(d.gradeAgreement).toBe(0.5)
  })

  it('throws on an empty ensemble', () => {
    expect(() => computeDispersion([])).toThrow()
  })
})

describe('classifyConfidence', () => {
  it('is HIGH when grades are unanimous and score std is tight', () => {
    const d = computeDispersion([s(88, '5'), s(90, '5'), s(86, '5')])
    expect(classifyConfidence(d)).toBe('high')
  })

  it('is LOW when the grade vote splits badly', () => {
    const d = computeDispersion([s(88, '5'), s(72, '4'), s(58, '2')])
    expect(classifyConfidence(d)).toBe('low')
  })

  it('is LOW when score std is large even if grades happen to match', () => {
    // All "4" but wildly different scores → still untrustworthy
    const d = computeDispersion([s(73, '4'), s(86, '4'), s(80, '4'), s(74, '4'), s(85, '4')])
    // std here ≈ 5.5; bump spread to force std ≥ 12
    const wide = computeDispersion([s(73, '4'), s(86, '4'), s(60, '4'), s(99, '4')])
    expect(wide.scoreStd).toBeGreaterThanOrEqual(12)
    expect(classifyConfidence(wide)).toBe('low')
    void d
  })

  it('is MEDIUM in the in-between band', () => {
    // grades agree but std between 5 and 12: [76,84,92] → mean 84, std ≈ 6.53
    const d = computeDispersion([s(76, '4'), s(84, '4'), s(92, '5')])
    // make grades unanimous to isolate the std band
    const band = computeDispersion([s(76, '4'), s(84, '4'), s(92, '4')])
    expect(band.scoreStd).toBeGreaterThan(5)
    expect(band.scoreStd).toBeLessThan(12)
    expect(classifyConfidence(band)).toBe('medium')
    void d
  })

  it('is MEDIUM for a single-sample ensemble (no disagreement evidence)', () => {
    const d = computeDispersion([s(85, '4')])
    expect(classifyConfidence(d)).toBe('medium')
  })

  it('is HIGH at the exact std boundary (≤ 5)', () => {
    const d = computeDispersion([s(85, '4'), s(90, '4')])  // std = 2.5
    expect(classifyConfidence(d)).toBe('high')
  })
})

describe('buildReconciliationPrompt', () => {
  const primary = {
    score: 72,
    grade: '4' as GradeLetter,
    strengths: [{ text: 'Чёткая структура аргументации' }],
    improvements: [{ text: 'Не хватает ссылок на источники' }],
  }
  const samples: EnsembleSample[] = [
    { persona: 'neutral', temperature: null, score: 72, grade: '4' },
    { persona: 'strict',  temperature: 0.8,  score: 58, grade: '2', provider: 'qwen' },
    { persona: 'lenient', temperature: 0.8,  score: 88, grade: '5' },
  ]

  it('includes the primary score/grade and every sample', () => {
    const { user } = buildReconciliationPrompt(primary, samples)
    expect(user).toContain('Балл: 72, оценка: «4»')
    expect(user).toContain('балл 72, оценка «4»')
    expect(user).toContain('балл 58, оценка «2»')
    expect(user).toContain('балл 88, оценка «5»')
    expect(user).toContain('модель qwen')
    expect(user).toContain('temperature 0.8')
  })

  it('includes the primary justification bullets', () => {
    const { user } = buildReconciliationPrompt(primary, samples)
    expect(user).toContain('Чёткая структура аргументации')
    expect(user).toContain('Не хватает ссылок на источники')
  })

  it('renders a placeholder when the primary has no strengths/improvements', () => {
    const { user } = buildReconciliationPrompt({ ...primary, strengths: [], improvements: [] }, samples)
    expect(user).toContain('- (нет)')
  })

  it('asks for a JSON score + note', () => {
    const { user, system } = buildReconciliationPrompt(primary, samples)
    expect(user).toContain('"score"')
    expect(user).toContain('"note"')
    expect(system).toContain('арбитром')
  })
})
