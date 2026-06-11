import { describe, it, expect } from 'vitest'
import {
  scoreToGrade,
  snapScoreToGrade,
  gradeLabel,
  gradeColor,
  GRADE_BRACKETS,
  GRADES,
} from './grades'

describe('GRADE_BRACKETS', () => {
  it('covers the full 0–100 range with no gaps or overlaps', () => {
    // Sort by lower bound, expect contiguous coverage from 0 to 100.
    const sorted = GRADES.map((g) => GRADE_BRACKETS[g]).sort((a, b) => a[0] - b[0])
    expect(sorted[0][0]).toBe(0)
    expect(sorted[sorted.length - 1][1]).toBe(100)
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i + 1][0]).toBe(sorted[i][1] + 1)
    }
  })
})

describe('scoreToGrade', () => {
  it('maps the AI brackets precisely', () => {
    expect(scoreToGrade(100)).toBe('5')
    expect(scoreToGrade(87)).toBe('5')   // lower bound of 5
    expect(scoreToGrade(86)).toBe('4')
    expect(scoreToGrade(73)).toBe('4')
    expect(scoreToGrade(72)).toBe('3')
    expect(scoreToGrade(60)).toBe('3')
    expect(scoreToGrade(59)).toBe('2')
    expect(scoreToGrade(0)).toBe('2')
  })

  it('clamps out-of-range input', () => {
    expect(scoreToGrade(-10)).toBe('2')
    expect(scoreToGrade(200)).toBe('5')
  })

  it('rounds fractional scores before bucketing', () => {
    expect(scoreToGrade(86.6)).toBe('5')   // rounds to 87
    expect(scoreToGrade(86.4)).toBe('4')
  })
})

describe('snapScoreToGrade — minimum-movement nudging', () => {
  it('leaves the score alone when it already falls inside the bracket', () => {
    expect(snapScoreToGrade(80, '4')).toBe(80)
    expect(snapScoreToGrade(95, '5')).toBe(95)
  })

  it('pulls up to the lower bound when score is below the bracket', () => {
    expect(snapScoreToGrade(50, '4')).toBe(73)
    expect(snapScoreToGrade(85, '5')).toBe(87)
  })

  it('pulls down to the upper bound when score is above the bracket', () => {
    expect(snapScoreToGrade(95, '4')).toBe(86)
    expect(snapScoreToGrade(80, '3')).toBe(72)
  })

  it('preserves the exact boundary value', () => {
    expect(snapScoreToGrade(73, '4')).toBe(73)
    expect(snapScoreToGrade(86, '4')).toBe(86)
  })
})

describe('gradeLabel', () => {
  it('returns the Russian academic label for each grade', () => {
    expect(gradeLabel('5')).toBe('Отлично')
    expect(gradeLabel('4')).toBe('Хорошо')
    expect(gradeLabel('3')).toBe('Удовлетворительно')
    expect(gradeLabel('2')).toBe('Неудовлетворительно')
  })

  it('falls back to em-dash for unknown / null', () => {
    expect(gradeLabel(null)).toBe('—')
    expect(gradeLabel(undefined)).toBe('—')
    expect(gradeLabel('weird')).toBe('—')
  })
})

describe('gradeColor', () => {
  it('uses semantic colors per grade', () => {
    expect(gradeColor('5')).toContain('success')
    expect(gradeColor('4')).toContain('amber')
    expect(gradeColor('3')).toContain('warning')
    expect(gradeColor('2')).toContain('danger')
  })

  it('falls back to tertiary text for unknown', () => {
    expect(gradeColor(null)).toContain('tertiary')
  })
})
