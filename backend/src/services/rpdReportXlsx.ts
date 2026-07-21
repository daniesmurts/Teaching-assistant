// Excel exports for РПД Monitor — mirrors what the head of УМЦ used to build
// by hand every week (master «сводка» + per-institute workbooks + a dynamics
// table), minus the hand-typing. Percentages are always recomputed here, not
// copied from АСУ's own % columns (see services/rpdMonitor.ts header comment).

import ExcelJS from 'exceljs'
import type { RpdSnapshotRecord, RpdSnapshotRowRecord, RpdDeptGroupRecord } from '../db/queries/rpdMonitor'
import type { RpdOverview } from './rpdMonitor'
import { pctStatus, STATUS_FILL_HEX, type RpdStatus } from './rpdMonitor'

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true }
// Same three tiers as the web pills and the reminder-letter table — a row's colour
// always means the same thing everywhere. Anomalies (data inconsistency, not
// performance) override the tier colour since they're the more urgent signal.
const STATUS_FILLS: Record<RpdStatus, ExcelJS.Fill> = {
  danger:  { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${STATUS_FILL_HEX.danger}` } },
  warning: { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${STATUS_FILL_HEX.warning}` } },
  success: { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${STATUS_FILL_HEX.success}` } },
}
const YELLOW_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3B0' } }

// Mirrors every column in her source (Кафедра through % долга ФОС) plus
// «Институт» (our own addition, not in the raw export) — the earlier version
// silently dropped ФОС на проверке / Долг по ФОС even after the parser
// started capturing them.
const ROW_HEADERS = [
  'Кафедра', 'Форма обучения', 'Уровень образования', 'Институт',
  'План', 'Сделано РПД', '% РПД', 'На проверке', 'Долг РПД', '% долга',
  'Сделано ФОС', '% ФОС', 'ФОС на проверке', '% ФОС на проверке', 'Долг ФОС', '% долга ФОС',
]

function pct(count: number, plan: number): number {
  return plan > 0 ? Math.round((count / plan) * 1000) / 10 : 0
}

function rowIsAnomalous(r: RpdSnapshotRowRecord): boolean {
  return r.rpd_done + r.rpd_review + r.rpd_debt !== r.plan_count || r.rpd_debt < 0
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
  // Anomalies (data inconsistency, not performance) override the readiness-tier
  // colour since they're the more urgent signal — matches the reminder-letter table.
  const fill = rowIsAnomalous(r) ? YELLOW_FILL : STATUS_FILLS[pctStatus(pct(r.rpd_done, r.plan_count))]
  row.eachCell((c) => { c.fill = fill })
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
    const ws = wb.addWorksheet(groupName.slice(0, 31))
    const h = ws.addRow(ROW_HEADERS)
    styleHeaderRow(h)
    for (const r of groupRows) writeDataRow(ws, r, groupName)
    autoWidth(ws)
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
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
  const rows = allRows.filter((r) => deptSet.has(r.dept_code))

  const ws = wb.addWorksheet(group.name.slice(0, 31))
  ws.addRow([group.name])
  ws.addRow([`Снимок от ${new Date(snapshot.captured_at).toLocaleString('ru-RU')}`])
  ws.addRow([])
  const header = ws.addRow(ROW_HEADERS)
  styleHeaderRow(header)
  for (const r of rows) {
    writeDataRow(ws, r, group.name)
  }

  const totalPlan = rows.reduce((s, r) => s + r.plan_count, 0)
  const totalDone = rows.reduce((s, r) => s + r.rpd_done, 0)
  const totalDebt = rows.reduce((s, r) => s + r.rpd_debt, 0)
  const totalFosDone = rows.reduce((s, r) => s + r.fos_done, 0)
  const totalFosReview = rows.reduce((s, r) => s + r.fos_review, 0)
  const totalFosDebt = rows.reduce((s, r) => s + r.fos_debt, 0)
  const totalsRow = ws.addRow([
    'Итого', '', '', '', totalPlan, totalDone, pct(totalDone, totalPlan), '', totalDebt, pct(totalDebt, totalPlan),
    totalFosDone, pct(totalFosDone, totalPlan), totalFosReview, pct(totalFosReview, totalPlan),
    totalFosDebt, pct(totalFosDebt, totalPlan),
  ])
  totalsRow.font = { bold: true }
  autoWidth(ws)

  return Buffer.from(await wb.xlsx.writeBuffer())
}
