import { describe, it, expect } from 'vitest'
import { repairUploadFilename, detectMimeFromBuffer } from './fileValidation'

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

describe('detectMimeFromBuffer — OOXML', () => {
  // Every OOXML format opens with the same four zip bytes, so the signature
  // alone cannot tell .docx from .pptx. It used to be mapped to Word, which
  // meant a genuine PowerPoint never matched its own declared type and
  // «Загрузить свою презентацию» answered 422 for every file it was given
  // (production, 2026-09-08). What separates them is the part layout.
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  const zipWith = async (paths: string[]): Promise<Buffer> => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    for (const p of paths) zip.file(p, '<xml/>')
    return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
  }

  it('reads a presentation as .pptx, not .docx', async () => {
    expect(detectMimeFromBuffer(await zipWith(['ppt/slides/slide1.xml']))).toBe(PPTX)
  })

  it('still reads a Word document as .docx', async () => {
    expect(detectMimeFromBuffer(await zipWith(['word/document.xml']))).toBe(DOCX)
  })

  it('reads a workbook as .xlsx', async () => {
    expect(detectMimeFromBuffer(await zipWith(['xl/workbook.xml']))).toBe(XLSX)
  })

  it('prefers Word when a .docx embeds a presentation object', async () => {
    expect(detectMimeFromBuffer(await zipWith(['word/document.xml', 'word/embeddings/deck.pptx']))).toBe(DOCX)
  })

  it('returns null for a zip that is no OOXML format — unknown, not wrong', async () => {
    expect(detectMimeFromBuffer(await zipWith(['notes.txt']))).toBeNull()
  })

  it('still identifies a PDF by signature', () => {
    expect(detectMimeFromBuffer(Buffer.from('%PDF-1.7\n', 'latin1'))).toBe('application/pdf')
  })
})
