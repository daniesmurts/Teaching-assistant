import { describe, it, expect } from 'vitest'
import { cleanForSlide, latexToPlainText } from './presentationExport'

describe('latexToPlainText', () => {
  it('converts Greek letters', () => {
    expect(latexToPlainText('\\rho g Q H')).toBe('ρ g Q H')
    expect(latexToPlainText('\\eta \\Omega')).toBe('η Ω')
  })

  it('does not let a longer command name get shadowed by a shorter one', () => {
    expect(latexToPlainText('\\varrho')).toBe('ρ')
    expect(latexToPlainText('\\rho')).toBe('ρ')
  })

  it('converts \\frac to a parenthesised division', () => {
    expect(latexToPlainText('\\frac{a}{b}')).toBe('(a)/(b)')
  })

  it('converts \\frac whose arguments themselves contain a subscript (nested braces)', () => {
    expect(latexToPlainText('\\eta = \\frac{P_{полезн}}{P_{затрач}}'))
      .toBe('η = (P_полезн)/(P_затрач)')
  })

  it('converts \\sqrt with and without braces', () => {
    expect(latexToPlainText('\\sqrt{x+1}')).toBe('√(x+1)')
    expect(latexToPlainText('\\sqrt2')).toBe('√2')
  })

  it('converts single-character superscripts and subscripts', () => {
    expect(latexToPlainText('x^2')).toBe('x²')
    expect(latexToPlainText('a_1')).toBe('a₁')
  })

  it('converts braced multi-character superscripts and subscripts', () => {
    expect(latexToPlainText('x^{23}')).toBe('x²³')
    expect(latexToPlainText('a_{max}')).toBe('a_max')  // non-digit subscript chars have no unicode form — kept as-is, no stray brace
  })

  it('converts common operators', () => {
    expect(latexToPlainText('a \\cdot b \\times c')).toBe('a · b × c')
    expect(latexToPlainText('x \\leq y \\geq z')).toBe('x ≤ y ≥ z')
  })

  it('drops the backslash from an unrecognised command instead of leaving it raw', () => {
    expect(latexToPlainText('\\text{Re}')).toBe('textRe')
  })

  it('leaves plain arithmetic untouched', () => {
    expect(latexToPlainText('P = m g h')).toBe('P = m g h')
  })
})

describe('cleanForSlide', () => {
  it('strips a single citation marker', () => {
    expect(cleanForSlide('Насосы делятся на два типа [1].')).toBe('Насосы делятся на два типа .')
  })

  it('strips a multi-number citation marker', () => {
    expect(cleanForSlide('См. источники [1, 2, 3]')).toBe('См. источники')
  })

  it('converts inline LaTeX to readable Unicode instead of leaving raw commands', () => {
    expect(cleanForSlide('Мощность $P = \\rho g Q H$ насоса')).toBe('Мощность P = ρ g Q H насоса')
  })

  it('converts block LaTeX to readable Unicode', () => {
    expect(cleanForSlide('$$x^2 + y^2$$')).toBe('x² + y²')
  })

  it('collapses runs of spaces left behind by stripping', () => {
    expect(cleanForSlide('Текст   с   пробелами')).toBe('Текст с пробелами')
  })

  it('trims leading/trailing whitespace', () => {
    expect(cleanForSlide('  текст  ')).toBe('текст')
  })

  it('leaves plain text untouched', () => {
    expect(cleanForSlide('Обычный текст без разметки')).toBe('Обычный текст без разметки')
  })
})
