// Excel exports for РПД Monitor — mirrors what the head of УМЦ used to build
// by hand every week (master «сводка» + per-institute workbooks + a dynamics
// table), minus the hand-typing. Percentages are always recomputed here, not
// copied from АСУ's own % columns (see services/rpdMonitor.ts header comment).

import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import type { RpdSnapshotRecord, RpdSnapshotRowRecord, RpdDeptGroupRecord } from '../db/queries/rpdMonitor'
import type { RpdOverview } from './rpdMonitor'
import {
  pctStatus, STATUS_FILL_HEX, STATUS_FONT_HEX, ANOMALY_FILL_HEX, ANOMALY_FONT_HEX, type RpdStatus,
} from './rpdMonitor'

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true }

// Same three tiers as the web pills and the reminder-letter table — a row's colour
// always means the same thing everywhere. Anomalies (data inconsistency, not
// performance) override the tier colour since they're the more urgent signal.
//
// Fill and font travel together: the fills are fully saturated (see
// STATUS_FILL_HEX's comment), so leaving the font at Excel's default black
// would make the danger and success rows unreadable.
const fill = (hex: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } })
const STATUS_FILLS: Record<RpdStatus, ExcelJS.Fill> = {
  danger:  fill(STATUS_FILL_HEX.danger),
  warning: fill(STATUS_FILL_HEX.warning),
  success: fill(STATUS_FILL_HEX.success),
}
const STATUS_FONTS: Record<RpdStatus, Partial<ExcelJS.Font>> = {
  danger:  { color: { argb: `FF${STATUS_FONT_HEX.danger}` } },
  warning: { color: { argb: `FF${STATUS_FONT_HEX.warning}` } },
  success: { color: { argb: `FF${STATUS_FONT_HEX.success}` } },
}
const ANOMALY_FILL: ExcelJS.Fill = fill(ANOMALY_FILL_HEX)
const ANOMALY_FONT: Partial<ExcelJS.Font> = { color: { argb: `FF${ANOMALY_FONT_HEX}` }, bold: true }

// Mirrors every column in her source (Кафедра through % долга ФОС) plus
// «Институт» (our own addition, not in the raw export) — the earlier version
// silently dropped ФОС на проверке / Долг по ФОС even after the parser
// started capturing them.
const ROW_HEADERS = [
  'Кафедра', 'Форма обучения', 'Уровень образования', 'Институт',
  'План', 'Сделано РПД', '% РПД', 'На проверке', 'Долг РПД', '% долга',
  'Сделано ФОС', '% ФОС', 'ФОС на проверке', '% ФОС на проверке', 'Долг ФОС', '% долга ФОС',
]

/** Excel forbids * ? : \ / [ ] in a sheet name and ExcelJS throws rather than
 *  coercing, so an institute named «ИП/ИУИ» would fail the whole export instead
 *  of producing an oddly-named tab. Institute names are free text an admin
 *  types, so this is reachable, not theoretical. 31 chars is Excel's own cap. */
function safeSheetName(name: string): string {
  return name.replace(/[*?:\\/[\]]/g, '_').slice(0, 31)
}

function pct(count: number, plan: number): number {
  return plan > 0 ? Math.round((count / plan) * 1000) / 10 : 0
}

function rowIsAnomalous(r: RpdSnapshotRowRecord): boolean {
  return r.rpd_done + r.rpd_review + r.rpd_debt !== r.plan_count || r.rpd_debt < 0
}

/** Shades a whole data row by its % долга tier (or the anomaly colour, which
 *  overrides it — a broken row is a more urgent signal than a bad one). */
function shadeRow(row: ExcelJS.Row, r: RpdSnapshotRowRecord): void {
  const anomalous = rowIsAnomalous(r)
  const rowFill = anomalous ? ANOMALY_FILL : STATUS_FILLS[pctStatus(pct(r.rpd_debt, r.plan_count))]
  const rowFont = anomalous ? ANOMALY_FONT : STATUS_FONTS[pctStatus(pct(r.rpd_debt, r.plan_count))]
  row.eachCell((c) => { c.fill = rowFill; c.font = rowFont })
}

function writeDataRow(
  ws: ExcelJS.Worksheet,
  r: RpdSnapshotRowRecord,
  groupName: string,
): void {
  const row = ws.addRow([
    r.dept_code, r.edu_form, r.edu_level, groupName,
    r.plan_count, r.rpd_done, pct(r.rpd_done, r.plan_count), r.rpd_review, r.rpd_debt, pct(r.rpd_debt, r.plan_count),
    r.fos_done, pct(r.fos_done, r.plan_count), r.fos_review, pct(r.fos_review, r.plan_count),
    r.fos_debt, pct(r.fos_debt, r.plan_count),
  ])
  shadeRow(row, r)
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

export async function generateRpdMasterWorkbook(
  snapshot: RpdSnapshotRecord,
  rows: RpdSnapshotRowRecord[],
  overview: RpdOverview,
  groupMap: Map<string, { groupId: string; groupName: string }>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ИСПУМ'
  wb.created = new Date()

  // ── Итоги ──────────────────────────────────────────────────────────────
  const summary = wb.addWorksheet('Итоги')
  summary.addRow(['Заполнение РПД и ФОС'])
  summary.addRow([overview.snapshot.periodLabel ?? ''])
  summary.addRow([`Снимок от ${new Date(snapshot.captured_at).toLocaleString('ru-RU')}`])
  summary.addRow([])
  const totalsHeader = summary.addRow(['Показатель', 'Значение', 'Δ с прошлого снимка'])
  styleHeaderRow(totalsHeader)
  const t = overview.totals
  const pt = overview.previousTotals
  summary.addRow(['Дисциплин по плану', t.planCount, pt ? t.planCount - pt.planCount : ''])
  summary.addRow(['Сделано РПД', t.rpdDone, pt ? t.rpdDone - pt.rpdDone : ''])
  summary.addRow(['% заполнения РПД', `${t.rpdPct}%`, pt ? `${Math.round((t.rpdPct - pt.rpdPct) * 10) / 10}%` : ''])
  summary.addRow(['На проверке', t.rpdReview, ''])
  summary.addRow(['Долг по РПД', t.rpdDebt, pt ? t.rpdDebt - pt.rpdDebt : ''])
  summary.addRow(['Сделано ФОС', t.fosDone, pt ? t.fosDone - pt.fosDone : ''])
  summary.addRow(['ФОС на проверке', t.fosReview, ''])
  summary.addRow(['Долг по ФОС', t.fosDebt, pt ? t.fosDebt - pt.fosDebt : ''])
  summary.addRow([])

  const groupsHeader = summary.addRow(['Институт', 'План', 'Сделано РПД', '% РПД', 'Долг РПД', 'Δ сделано с прошлого снимка'])
  styleHeaderRow(groupsHeader)
  for (const g of overview.groups) {
    summary.addRow([g.groupName, g.planCount, g.rpdDone, `${g.rpdPct}%`, g.rpdDebt, g.deltaRpdDone ?? ''])
  }
  if (overview.ungroupedDeptCodes.length > 0) {
    summary.addRow([])
    summary.addRow([`Кафедры без института (задайте в настройках): ${overview.ungroupedDeptCodes.join(', ')}`])
  }
  summary.addRow([])

  const seriesHeader = summary.addRow(['Снимок от', 'План', 'Сделано РПД', '% РПД'])
  styleHeaderRow(seriesHeader)
  for (const s of overview.timeSeries) {
    summary.addRow([new Date(s.capturedAt).toLocaleDateString('ru-RU'), s.planCount, s.rpdDone, `${s.rpdPct}%`])
  }
  autoWidth(summary)

  // ── Сводка (all rows) ──────────────────────────────────────────────────
  const all = wb.addWorksheet('Сводка')
  const header = all.addRow(ROW_HEADERS)
  styleHeaderRow(header)
  for (const r of rows) {
    writeDataRow(all, r, groupMap.get(r.dept_code)?.groupName ?? '—')
  }
  autoWidth(all)

  // ── One sheet per institute ────────────────────────────────────────────
  const byGroup = new Map<string, RpdSnapshotRowRecord[]>()
  for (const r of rows) {
    const g = groupMap.get(r.dept_code)
    if (!g) continue
    if (!byGroup.has(g.groupName)) byGroup.set(g.groupName, [])
    byGroup.get(g.groupName)!.push(r)
  }
  for (const [groupName, groupRows] of byGroup) {
    const ws = wb.addWorksheet(safeSheetName(groupName))
    const h = ws.addRow(ROW_HEADERS)
    styleHeaderRow(h)
    for (const r of groupRows) writeDataRow(ws, r, groupName)
    autoWidth(ws)
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}

// ── Per-institute workbook ───────────────────────────────────────────────────
//
// Columns mirror the file the head of УМЦ used to assemble by hand for each
// institute (the «ИП» sheet she supplied as the reference), in her order,
// because she forwards it onward as-is and a reordered or widened table costs
// her a re-read every week. That means deliberately NOT emitting the five extra
// ФОС columns the master «Сводка» carries (`% ФОС`, `ФОС на проверке`,
// `% ФОС на проверке`, `Долг ФОС`, `% долга ФОС`) and NOT repeating the
// «Институт» column — the whole file is one institute, so it would be the same
// value in every row. The master workbook keeps the full 16 columns; this is
// the hand-off artefact, not the archive.
//
// `№` is a plain 1..N counter. Her own file carried АСУ's original row numbers
// (7, 39, 44…), which we don't persist — a sequential index is what the column
// actually communicates to a reader, and inventing gaps to imitate hers would
// be worse.
const GROUP_HEADERS = [
  '№', 'Кафедра', 'Форма обучения', 'Уровень образования',
  'Дисциплин по плану', 'Сделано РПД', '% заполнения РПД',
  'РПД на проверке', 'Долг по РПД', '% долга РПД', 'Сделано ФОС',
]

function writeGroupSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  title: string,
  capturedAt: Date | string,
  rows: RpdSnapshotRowRecord[],
): void {
  const ws = wb.addWorksheet(safeSheetName(sheetName))
  ws.addRow([title])
  ws.addRow([`Снимок от ${new Date(capturedAt).toLocaleString('ru-RU')}`])
  ws.addRow([])
  styleHeaderRow(ws.addRow(GROUP_HEADERS))

  rows.forEach((r, i) => {
    const row = ws.addRow([
      i + 1, r.dept_code, r.edu_form, r.edu_level,
      r.plan_count, r.rpd_done, pct(r.rpd_done, r.plan_count),
      r.rpd_review, r.rpd_debt, pct(r.rpd_debt, r.plan_count), r.fos_done,
    ])
    shadeRow(row, r)
  })

  const total = (pick: (r: RpdSnapshotRowRecord) => number) => rows.reduce((sum, r) => sum + pick(r), 0)
  const totalPlan = total((r) => r.plan_count)
  const totalDone = total((r) => r.rpd_done)
  const totalDebt = total((r) => r.rpd_debt)
  const totalsRow = ws.addRow([
    '', 'Итого', '', '',
    totalPlan, totalDone, pct(totalDone, totalPlan),
    total((r) => r.rpd_review), totalDebt, pct(totalDebt, totalPlan), total((r) => r.fos_done),
  ])
  totalsRow.font = { bold: true }
  autoWidth(ws)
}

export async function generateRpdGroupWorkbook(
  snapshot: RpdSnapshotRecord,
  group: RpdDeptGroupRecord,
  allRows: RpdSnapshotRowRecord[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ИСПУМ'
  wb.created = new Date()

  const deptSet = new Set(group.dept_codes)
  writeGroupSheet(
    wb, group.name, group.name, snapshot.captured_at,
    allRows.filter((r) => deptSet.has(r.dept_code)),
  )

  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** Every institute's own workbook, zipped — one file per institute, named the
 *  way she names them when forwarding. Built because the per-institute export
 *  existed for months as a per-row «Отчёт» link and went unnoticed: the УМЦ
 *  workflow is "send each institute its own file", so the natural unit of the
 *  action is all of them at once, not one click per institute. Institutes with
 *  no rows in this snapshot are skipped rather than emitted empty. */
export async function generateRpdGroupZip(
  snapshot: RpdSnapshotRecord,
  groups: RpdDeptGroupRecord[],
  allRows: RpdSnapshotRowRecord[],
): Promise<Buffer> {
  const zip = new JSZip()
  const dateStr = String(snapshot.captured_at).slice(0, 10)

  for (const group of groups) {
    const deptSet = new Set(group.dept_codes)
    const rows = allRows.filter((r) => deptSet.has(r.dept_code))
    if (rows.length === 0) continue
    const buffer = await generateRpdGroupWorkbook(snapshot, group, allRows)
    // Slashes and colons would create directories (or break the download) —
    // institute names are free text typed by an admin, so they can contain both.
    const safeName = group.name.replace(/[/\\:*?"<>|]/g, '_')
    zip.file(`РПД_${safeName}_${dateStr}.xlsx`, buffer)
  }

  return zip.generateAsync({ type: 'nodebuffer' })
}
