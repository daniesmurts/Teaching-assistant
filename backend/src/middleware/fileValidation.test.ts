import { describe, it, expect } from 'vitest'
import { repairUploadFilename } from './fileValidation'

// Real mojibake contains NBSP and C1 control chars between the visible
// glyphs, so we construct test strings by encoding the original name as
// UTF-8 then decoding those bytes as Latin-1 — exactly what multer does
// when it reads a Cyrillic Content-Disposition header without telling
// anyone the encoding.
function mangle(name: string): string {
  return Buffer.from(name, 'utf8').toString('latin1')
}

describe('repairUploadFilename', () => {
  it('repairs Cyrillic filenames mangled by Latin-1 header decode', () => {
    expect(repairUploadFilename(mangle('Расчёт') + '.docx')).toBe('Расчёт.docx')
  })

  it('repairs a multi-word Cyrillic name with em-dash', () => {
    expect(repairUploadFilename(mangle('Лекция 1 — введение') + '.pdf'))
      .toBe('Лекция 1 — введение.pdf')
  })

  it('leaves pure ASCII names alone', () => {
    expect(repairUploadFilename('report.pdf')).toBe('report.pdf')
  })

  it('leaves already-correct Cyrillic alone (no double-repair)', () => {
    expect(repairUploadFilename('Расчёт.docx')).toBe('Расчёт.docx')
  })

  it('leaves real Latin-1 names alone (no false positives)', () => {
    // "café.pdf" — é is U+00E9, valid Latin-1, but byte 0xE9 alone isn't
    // valid UTF-8. Round-trip would produce a replacement char, so we
    // keep the original.
    expect(repairUploadFilename('café.pdf')).toBe('café.pdf')
  })

  it('handles empty input', () => {
    expect(repairUploadFilename('')).toBe('')
  })

  it('is idempotent — running on the output gives the same output', () => {
    const once  = repairUploadFilename(mangle('Расчёт') + '.docx')
    const twice = repairUploadFilename(once)
    expect(twice).toBe(once)
  })
})
