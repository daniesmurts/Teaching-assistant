import ExcelJS from 'exceljs'
import { STATUS_FILL_HEX } from './rpdMonitor'
import type { UmcDashboardResult, UmcReadinessRow } from '../../../shared/types'

// TODO.md Feature V. Mirrors rpdReportXlsx.ts's structure and colour tiers
// (same STATUS_FILL_HEX — a colour always means the same thing everywhere in
// this app) — «Итоги» rollup sheet + one flat «Дисциплины» sheet per row.

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true }
const STATUS_FILLS = {
  danger:  { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${STATUS_FILL_HEX.danger}` } } as ExcelJS.Fill,
  warning: { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${STATUS_FILL_HEX.warning}` } } as ExcelJS.Fill,
  success: { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${STATUS_FILL_HEX.success}` } } as ExcelJS.Fill,
}

// Coverage is a "higher is better" score (opposite of РПД monitor's debt %),
// so the tier thresholds are inverted from pctStatus() rather than reused —
// no syllabus/review at all is its own, more urgent case than a low score.
function coverageStatus(row: UmcReadinessRow): keyof typeof STATUS_FILLS | null {
  if (!row.has_syllabus) return 'danger'
  if (!row.reviewed) return null   // uploaded but not yet checked — no verdict to colour
  const c = row.overall_coverage ?? 0
  if (c >= 80) return 'success'
  if (c >= 50) return 'warning'
  return 'danger'
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((c) => { c.fill = HEADER_FILL; c.font = HEADER_FONT })
  row.font = HEADER_FONT
}

function autoWidth(ws: ExcelJS.Worksheet): void {
  ws.columns.forEach((col) => {
    let max = 10
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      max = Math.max(max, String(cell.value ?? '').length + 2)
    })
    col.width = Math.min(max, 40)
  })
}

const ROW_HEADERS = [
  'Подразделение', 'Программа', 'Код направления', 'Дисциплина', 'Семестр',
  'РПД загружена', 'Дата загрузки', 'Проверена', 'Покрытие компетенций, %', 'Дата проверки',
]

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('ru-RU') : ''
}

export async function generateUmcDashboardXlsx(data: UmcDashboardResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ИСПУМ'
  wb.created = new Date()

  // ── Итоги ──────────────────────────────────────────────────────────────
  const summary = wb.addWorksheet('Итоги')
  summary.addRow(['Готовность УМК'])
  summary.addRow([`Сформировано ${new Date().toLocaleString('ru-RU')}`])
  summary.addRow([])
  summary.addRow(['Всего дисциплин', data.totals.discipline_count])
  summary.addRow(['С загруженной РПД', data.totals.syllabus_count])
  summary.addRow(['Проверено', data.totals.reviewed_count])
  summary.addRow(['Среднее покрытие компетенций, %', data.totals.avg_coverage ?? '—'])
  summary.addRow([])

  const deptHeader = summary.addRow(['Подразделение', 'Дисциплин', 'РПД загружено', 'Проверено', 'Среднее покрытие, %'])
  styleHeaderRow(deptHeader)
  for (const d of data.departments) {
    summary.addRow([d.department_name, d.discipline_count, d.syllabus_count, d.reviewed_count, d.avg_coverage ?? '—'])
  }
  autoWidth(summary)

  // ── Дисциплины (flat, every row) ─────────────────────────────────────────
  const all = wb.addWorksheet('Дисциплины')
  const header = all.addRow(ROW_HEADERS)
  styleHeaderRow(header)
  for (const r of data.rows) {
    const row = all.addRow([
      r.department_name ?? 'Без подразделения', r.program_name, r.program_code ?? '', r.discipline_name, r.semester,
      r.has_syllabus ? 'Да' : 'Нет', fmtDate(r.syllabus_uploaded_at),
      r.reviewed ? 'Да' : 'Нет', r.overall_coverage ?? '', fmtDate(r.review_created_at),
    ])
    const status = coverageStatus(r)
    if (status) row.eachCell((c) => { c.fill = STATUS_FILLS[status] })
  }
  autoWidth(all)

  return Buffer.from(await wb.xlsx.writeBuffer())
}
