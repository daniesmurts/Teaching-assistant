import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import path from 'path'
import { parseAsuExport } from './rpdMonitor'

const FIXTURES = path.join(__dirname, '__fixtures__', 'rpd')

describe('parseAsuExport — real АСУ Университет exports', () => {
  it('parses the legacy .doc export (долги.doc, 221 кафедра/форма/уровень rows)', async () => {
    const buffer = await readFile(path.join(FIXTURES, 'долги.doc'))
    const result = await parseAsuExport(buffer, 'долги.doc')

    expect(result.rows).toHaveLength(221)
    expect(result.periodLabel).toContain('01.09.2026')
    expect(result.capturedAt.getFullYear()).toBe(2026)
    expect(result.capturedAt.getMonth()).toBe(6) // July
    expect(result.capturedAt.getDate()).toBe(20)

    // known row: НХ, очная, бакалавриат — план 73
    const nx = result.rows.find((r) => r.deptCode === 'НХ' && r.eduForm === 'очная' && r.eduLevel === 'бакалавриат')
    expect(nx).toBeDefined()
    expect(nx).toMatchObject({ planCount: 73, rpdDone: 16, rpdReview: 24, rpdDebt: 33 })

    // known anomaly: ХТПНГ, очная, специалитет — на-проверке (2) exceeds план (2), долг = -1
    const htpng = result.rows.find((r) => r.deptCode === 'ХТПНГ' && r.eduForm === 'очная' && r.eduLevel === 'специалитет')
    expect(htpng).toBeDefined()
    expect(htpng).toMatchObject({ planCount: 2, rpdDone: 1, rpdReview: 2, rpdDebt: -1 })
    expect(result.flags.some((f) => f.deptCode === 'ХТПНГ' && f.message.includes('Отрицательный'))).toBe(true)

    // known overcompletion: УЧР, очная, магистратура — сделано (17) exceeds план (16)
    const uchr = result.rows.find((r) => r.deptCode === 'УЧР' && r.eduForm === 'очная' && r.eduLevel === 'магистратура')
    expect(uchr).toBeDefined()
    expect(uchr).toMatchObject({ planCount: 16, rpdDone: 17, rpdReview: 0, rpdDebt: -1 })
  })

  it('parses the master «сводка» workbook (17.07.2026.xlsx, 221 rows)', async () => {
    const buffer = await readFile(path.join(FIXTURES, '17.07.2026.xlsx'))
    const result = await parseAsuExport(buffer, '17.07.2026.xlsx')

    expect(result.rows).toHaveLength(221)
    expect(result.capturedAt.toISOString().slice(0, 10)).toBe('2026-07-17')

    // Ground truth is the row-level data itself (matches the sheet's own SUM(E2:E227)
    // formula, 6194) — the hand-typed «Всего РПД: 6191» dashboard label in the side
    // panel is a stale snapshot from earlier in the week and intentionally not used.
    const totalPlan = result.rows.reduce((s, r) => s + r.planCount, 0)
    expect(totalPlan).toBe(6194)
  })

  it('parses a single-institute export without the fos review/debt breakdown (ИНХН.xlsx)', async () => {
    const buffer = await readFile(path.join(FIXTURES, 'ИНХН.xlsx'))
    const result = await parseAsuExport(buffer, 'ИНХН.xlsx')

    expect(result.rows.length).toBeGreaterThan(0)
    // Ground truth is this file's own row-level data (hand-summed from the raw
    // export) — the «ИНХН: 1018 / 509» figures in the сводка workbook's side-panel
    // are from a different week's snapshot, not this file.
    const totalPlan = result.rows.reduce((s, r) => s + r.planCount, 0)
    const totalDebt = result.rows.reduce((s, r) => s + r.rpdDebt, 0)
    expect(totalPlan).toBe(968)
    expect(totalDebt).toBe(504)

    const nx = result.rows.find((r) => r.deptCode === 'НХ' && r.eduForm === 'очная' && r.eduLevel === 'бакалавриат')
    expect(nx).toMatchObject({ planCount: 73, rpdDone: 16, rpdReview: 35, rpdDebt: 22 })
  })

  it('rejects unsupported file types', async () => {
    await expect(parseAsuExport(Buffer.from('x'), 'report.pdf')).rejects.toThrow()
  })
})
