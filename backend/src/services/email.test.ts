import { describe, it, expect } from 'vitest'
import { extractSignatureName } from './email'

describe('extractSignatureName', () => {
  it('returns Имя Отчество from a 3-word Russian full name', () => {
    expect(extractSignatureName('Иванов Иван Иванович')).toBe('Иван Иванович')
  })

  it('takes only the middle two of a 4+ word name (titles, double surnames)', () => {
    // "Иванова-Петрова Анна Сергеевна" is 3 tokens — same as 3-word case
    expect(extractSignatureName('Иванова-Петрова Анна Сергеевна')).toBe('Анна Сергеевна')
    // 4 words: surname + double given + patronymic → takes words 1+2
    expect(extractSignatureName('Иванов Иван Сергей Иванович')).toBe('Иван Сергей')
  })

  it('returns the full string for 1 or 2 words (ambiguous)', () => {
    expect(extractSignatureName('Daniel')).toBe('Daniel')
    expect(extractSignatureName('Анна Смирнова')).toBe('Анна Смирнова')
  })

  it('returns null for empty or whitespace-only', () => {
    expect(extractSignatureName('')).toBeNull()
    expect(extractSignatureName('   ')).toBeNull()
    expect(extractSignatureName(null)).toBeNull()
    expect(extractSignatureName(undefined)).toBeNull()
  })

  it('collapses extra whitespace before parsing', () => {
    expect(extractSignatureName('  Иванов   Иван    Иванович  ')).toBe('Иван Иванович')
  })

  it('handles names with hyphens or apostrophes as single tokens', () => {
    expect(extractSignatureName("О'Брайен Шон Патрик")).toBe('Шон Патрик')
  })
})
