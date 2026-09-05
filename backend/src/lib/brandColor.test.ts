import { describe, it, expect } from 'vitest'
import { normaliseBrandColor, toPptxColor } from './brandColor'

// pptxgenjs takes a bare six-digit hex and produces a corrupt package for
// anything else, without complaining; pdfkit wants the '#'. Neither validates,
// so a bad value typed into the settings form would surface as a broken
// download much later. This is the one place that can catch it.

describe('normaliseBrandColor', () => {
  it('accepts the forms a person actually pastes', () => {
    expect(normaliseBrandColor('#1a4d8f')).toBe('#1A4D8F')
    expect(normaliseBrandColor('1a4d8f')).toBe('#1A4D8F')
    expect(normaliseBrandColor('  #1A4D8F  ')).toBe('#1A4D8F')
  })

  it('expands the three-digit shorthand', () => {
    expect(normaliseBrandColor('#0af')).toBe('#00AAFF')
  })

  it('rejects anything that would reach pptxgenjs as junk', () => {
    expect(normaliseBrandColor('rgb(26,77,143)')).toBeNull()
    expect(normaliseBrandColor('синий')).toBeNull()
    expect(normaliseBrandColor('#12345')).toBeNull()
    expect(normaliseBrandColor('#1a4d8fff')).toBeNull()   // 8-digit RGBA
    expect(normaliseBrandColor(0x1a4d8f)).toBeNull()
  })

  it('treats empty as "back to the platform default", not as an error', () => {
    expect(normaliseBrandColor('')).toBeNull()
    expect(normaliseBrandColor('   ')).toBeNull()
  })
})

describe('toPptxColor', () => {
  it('strips the hash pptxgenjs cannot take', () => {
    expect(toPptxColor('#1A4D8F')).toBe('1A4D8F')
  })
})
