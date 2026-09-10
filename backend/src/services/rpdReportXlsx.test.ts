import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { generateRpdGroupWorkbook, generateRpdGroupZip } from './rpdReportXlsx'
import { STATUS_FILL_HEX, STATUS_FONT_HEX, ANOMALY_FILL_HEX } from './rpdMonitor'
import type { RpdSnapshotRecord, RpdSnapshotRowRecord, RpdDeptGroupRecord } from '../db/queries/rpdMonitor'

const snapshot: RpdSnapshotRecord = {
  id: 'snap-1', institution_id: 'inst-1', uploaded_by: 't-1',
  captured_at: '2026-09-09T08:00:00.000Z', period_label: '2026/2027',
  source_filename: 'asu.xlsx', created_at: '2026-09-09T08:00:00.000Z',
}

function row(over: Partial<RpdSnapshotRowRecord> = {}): RpdSnapshotRowRecord {
  return {
    id: 'r', snapshot_id: 'snap-1', dept_code: 'ИХТ', edu_form: 'очная', edu_level: 'бакалавриат',
    plan_count: 100, rpd_done: 100, rpd_review: 0, rpd_debt: 0,
    fos_done: 90, fos_review: 0, fos_debt: 10,
    ...over,
  }
}

const group = (over: Partial<RpdDeptGroupRecord> = {}): RpdDeptGroupRecord => ({
  id: 'g-1', institution_id: 'inst-1', name: 'ИП', sort_order: 0, dept_codes: ['ИХТ', 'МИ'], ...over,
})

async function readSheet(buffer: Buffer, index = 1): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  return wb.worksheets[index - 1]
}

const values = (ws: ExcelJS.Worksheet, rowNum: number): unknown[] =>
  (ws.getRow(rowNum).values as unknown[]).slice(1)

// The per-institute file is the one the head of УМЦ forwards to each institute,
// so its shape is a compatibility contract with the sheet she used to build by
// hand — not an internal choice we can drift.
describe('generateRpdGroupWorkbook — columns match the УМЦ hand-built sheet', () => {
  it('emits her 11 columns, in her order', async () => {
    const ws = await readSheet(await generateRpdGroupWorkbook(snapshot, group(), [row()]))

    expect(values(ws, 4)).toEqual([
      '№', 'Кафедра', 'Форма обучения', 'Уровень образования',
      'Дисциплин по плану', 'Сделано РПД', '% заполнения РПД',
      'РПД на проверке', 'Долг по РПД', '% долга РПД', 'Сделано ФОС',
    ])
  })

  it('omits the master workbook\'s extra ФОС columns and the redundant Институт column', async () => {
    const ws = await readSheet(await generateRpdGroupWorkbook(snapshot, group(), [row()]))
    const header = values(ws, 4) as string[]

    for (const dropped of ['Институт', '% ФОС', 'ФОС на проверке', '% ФОС на проверке', 'Долг ФОС', '% долга ФОС']) {
      expect(header).not.toContain(dropped)
    }
  })

  it('numbers rows 1..N and recomputes both percentages', async () => {
    const rows = [
      row({ dept_code: 'ИХТ', plan_count: 133, rpd_done: 62, rpd_review: 56, rpd_debt: 15, fos_done: 62 }),
      row({ dept_code: 'МИ', plan_count: 39, rpd_done: 24, rpd_review: 9, rpd_debt: 6, fos_done: 25 }),
    ]
    const ws = await readSheet(await generateRpdGroupWorkbook(snapshot, group(), rows))

    expect(values(ws, 5)).toEqual([1, 'ИХТ', 'очная', 'бакалавриат', 133, 62, 46.6, 56, 15, 11.3, 62])
    expect(values(ws, 6)).toEqual([2, 'МИ', 'очная', 'бакалавриат', 39, 24, 61.5, 9, 6, 15.4, 25])
  })

  it('closes with a bold Итого row summing the counts', async () => {
    const rows = [
      row({ plan_count: 100, rpd_done: 40, rpd_review: 30, rpd_debt: 30, fos_done: 35 }),
      row({ dept_code: 'МИ', plan_count: 100, rpd_done: 60, rpd_review: 20, rpd_debt: 20, fos_done: 55 }),
    ]
    const ws = await readSheet(await generateRpdGroupWorkbook(snapshot, group(), rows))
    const totals = ws.getRow(7)

    expect(values(ws, 7)).toEqual(['', 'Итого', '', '', 200, 100, 50, 50, 50, 25, 90])
    expect(totals.font?.bold).toBe(true)
  })

  it('includes only the institute\'s own departments', async () => {
    const rows = [row({ dept_code: 'ИХТ' }), row({ dept_code: 'ЧУЖАЯ' })]
    const ws = await readSheet(await generateRpdGroupWorkbook(snapshot, group({ dept_codes: ['ИХТ'] }), rows))

    expect(ws.getCell('B5').value).toBe('ИХТ')
    expect(ws.getCell('B6').value).toBe('Итого')
  })
})

// The fills went fully saturated on the УМЦ head's feedback that the exported
// file looked washed-out next to the screen. That only works if the font moves
// with it — these lock the pairing so a future palette tweak can't half-apply.
describe('generateRpdGroupWorkbook — saturated status shading', () => {
  const fillOf = (ws: ExcelJS.Worksheet, ref: string) =>
    ((ws.getCell(ref).fill as ExcelJS.FillPattern).fgColor?.argb ?? '').slice(2)
  const fontOf = (ws: ExcelJS.Worksheet, ref: string) =>
    (ws.getCell(ref).font?.color?.argb ?? '').slice(2)

  it('shades a zero-debt row success, with the paired font colour', async () => {
    const ws = await readSheet(await generateRpdGroupWorkbook(snapshot, group(), [row({ rpd_debt: 0 })]))
    expect(fillOf(ws, 'B5')).toBe(STATUS_FILL_HEX.success)
    expect(fontOf(ws, 'B5')).toBe(STATUS_FONT_HEX.success)
  })

  it('shades a >50% debt row danger', async () => {
    const r = row({ plan_count: 100, rpd_done: 20, rpd_review: 0, rpd_debt: 80 })
    const ws = await readSheet(await generateRpdGroupWorkbook(snapshot, group(), [r]))
    expect(fillOf(ws, 'B5')).toBe(STATUS_FILL_HEX.danger)
    expect(fontOf(ws, 'B5')).toBe(STATUS_FONT_HEX.danger)
  })

  it('shades a mid-range debt row warning, with dark text rather than white', async () => {
    const r = row({ plan_count: 100, rpd_done: 60, rpd_review: 20, rpd_debt: 20 })
    const ws = await readSheet(await generateRpdGroupWorkbook(snapshot, group(), [r]))
    expect(fillOf(ws, 'B5')).toBe(STATUS_FILL_HEX.warning)
    expect(fontOf(ws, 'B5')).toBe(STATUS_FONT_HEX.warning)
    expect(fontOf(ws, 'B5')).not.toBe('FFFFFF')
  })

  it('lets a data anomaly override the performance tier', async () => {
    // done + review + debt (10) ≠ plan (100): a broken row, not a bad one.
    const r = row({ plan_count: 100, rpd_done: 10, rpd_review: 0, rpd_debt: 0 })
    const ws = await readSheet(await generateRpdGroupWorkbook(snapshot, group(), [r]))
    expect(fillOf(ws, 'B5')).toBe(ANOMALY_FILL_HEX)
  })

  it('uses the web palette itself, not a tint of it', async () => {
    // Guards the actual complaint: pastel Material-200 tints in the file next
    // to saturated bars on screen.
    expect(STATUS_FILL_HEX).toEqual({ danger: 'C0392B', warning: 'F97316', success: '2D7D46' })
  })
})

describe('generateRpdGroupZip', () => {
  it('writes one workbook per institute, named by institute and snapshot date', async () => {
    const groups = [group({ id: 'g-1', name: 'ИП', dept_codes: ['ИХТ'] }), group({ id: 'g-2', name: 'ИУИ', dept_codes: ['МИ'] })]
    const rows = [row({ dept_code: 'ИХТ' }), row({ dept_code: 'МИ' })]

    const zip = await JSZip.loadAsync(await generateRpdGroupZip(snapshot, groups, rows))

    expect(Object.keys(zip.files).sort()).toEqual(['РПД_ИП_2026-09-09.xlsx', 'РПД_ИУИ_2026-09-09.xlsx'])
  })

  it('skips an institute with no rows in this snapshot instead of emitting an empty file', async () => {
    const groups = [group({ id: 'g-1', name: 'ИП', dept_codes: ['ИХТ'] }), group({ id: 'g-2', name: 'Пустой', dept_codes: ['НЕТ'] })]

    const zip = await JSZip.loadAsync(await generateRpdGroupZip(snapshot, groups, [row({ dept_code: 'ИХТ' })]))

    expect(Object.keys(zip.files)).toEqual(['РПД_ИП_2026-09-09.xlsx'])
  })

  it('sanitises institute names that would otherwise create paths', async () => {
    const groups = [group({ name: 'ИП/ИУИ: смежный', dept_codes: ['ИХТ'] })]

    const zip = await JSZip.loadAsync(await generateRpdGroupZip(snapshot, groups, [row({ dept_code: 'ИХТ' })]))

    expect(Object.keys(zip.files)).toEqual(['РПД_ИП_ИУИ_ смежный_2026-09-09.xlsx'])
  })

  it('produces workbooks with the same per-institute layout as the single download', async () => {
    const groups = [group({ name: 'ИП', dept_codes: ['ИХТ'] })]
    const zip = await JSZip.loadAsync(await generateRpdGroupZip(snapshot, groups, [row({ dept_code: 'ИХТ' })]))
    const buffer = await zip.file('РПД_ИП_2026-09-09.xlsx')!.async('nodebuffer')

    const ws = await readSheet(buffer)
    expect(values(ws, 4)[0]).toBe('№')
    expect(ws.getCell('B5').value).toBe('ИХТ')
  })
})
