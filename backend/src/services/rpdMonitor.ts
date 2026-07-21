// РПД Monitor — parses the АСУ Университет «Заполнение РПД и ФОС» export
// (Дисциплин по плану / Сделано / На проверке / Долг, for both РПД and ФОС)
// and computes per-institute rollups + week-over-week dynamics.
//
// АСУ exports two formats the head of УМЦ actually uses:
//   .xlsx — a normal worksheet, 11 columns (№, Кафедра, Форма, Уровень, План,
//           СделаноРПД, %, РПДнаПроверке, ДолгРПД, %, СделаноФОС). Either the
//           single-institute export or her hand-built master «сводка» sheet
//           (which additionally carries a side dashboard panel she no longer
//           needs to build by hand — we recompute it).
//   .doc  — the raw legacy-Word export, 17 columns (adds РПД-на-проверке-%,
//           ФОС-на-проверке / % / Долг-по-ФОС / %). Word encodes table cells
//           with a 0x07 (BEL) cell separator baked into the document's own
//           text stream — this isn't a formatting artifact introduced by any
//           particular converter, it's how legacy .doc stores table runs, so
//           any faithful text extractor (word-extractor included) should
//           reproduce it. We split on that primarily; if a row doesn't yield
//           exactly 17 fields (extractor stripped the separator), we fall
//           back to a constraint-based numeric decoder that reconstructs the
//           three (count, percent) pairs from the concatenated digits alone,
//           using done+review+debt===plan and the known 1-decimal percent
//           rounding as constraints. Both paths were validated against a real
//           production export (backend/src/services/__fixtures__/rpd).
//
// Percentages are always recomputed here — АСУ's own % columns contain
// rounding drift and occasional anomalies (negative долг when на-проверке
// exceeds план) — we surface those as flags, never silently correct them.

import ExcelJS from 'exceljs'
import WordExtractor from 'word-extractor'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import type { RpdRowInput, RpdSnapshotRowRecord } from '../db/queries/rpdMonitor'
import {
  getSnapshot, getSnapshotRows, getPreviousSnapshot, getDeptGroupMap,
  listDeptGroups, getSnapshotTotalsSeries,
} from '../db/queries/rpdMonitor'
import { DocumentProcessingError, NotFoundError } from '../errors/AppError'

export interface RpdParseFlag {
  deptCode: string
  eduForm:  string
  eduLevel: string
  message:  string
}

export interface RpdParseResult {
  capturedAt:   Date
  periodLabel:  string | null
  rows:         RpdRowInput[]
  flags:        RpdParseFlag[]
}

export class RpdParseError extends DocumentProcessingError {}

const EDU_FORMS  = ['очно-заочная', 'заочная', 'очная'] // longest-prefix-first: "заочная" is a substring of "очно-заочная"
const EDU_LEVELS = ['бакалавриат', 'магистратура', 'специалитет']

// ─── Entry point ────────────────────────────────────────────────────────────

export async function parseAsuExport(buffer: Buffer, filename: string): Promise<RpdParseResult> {
  const ext = path.extname(filename).toLowerCase()
  if (ext === '.xlsx' || ext === '.xls') return parseXlsx(buffer)
  if (ext === '.doc') return parseDoc(buffer)
  throw new RpdParseError('Поддерживаются файлы .xlsx и .doc из АСУ Университет')
}

function validateRow(r: RpdRowInput, flags: RpdParseFlag[]): void {
  const rpdSum = r.rpdDone + r.rpdReview + r.rpdDebt
  const fosSum = r.fosDone + r.fosReview + r.fosDebt
  if (rpdSum !== r.planCount) {
    flags.push({ deptCode: r.deptCode, eduForm: r.eduForm, eduLevel: r.eduLevel,
      message: `РПД: сделано+проверка+долг (${rpdSum}) ≠ план (${r.planCount})` })
  }
  if (r.fosDone + r.fosReview + r.fosDebt > 0 && fosSum !== r.planCount) {
    flags.push({ deptCode: r.deptCode, eduForm: r.eduForm, eduLevel: r.eduLevel,
      message: `ФОС: сделано+проверка+долг (${fosSum}) ≠ план (${r.planCount})` })
  }
  if (r.rpdDebt < 0 || r.fosDebt < 0) {
    flags.push({ deptCode: r.deptCode, eduForm: r.eduForm, eduLevel: r.eduLevel,
      message: 'Отрицательный долг — «на проверке» превышает план (данные АСУ)' })
  }
}

// ─── .xlsx path ─────────────────────────────────────────────────────────────
// Handles both the single-institute export (header at row 1) and her master
// «сводка» sheet (title/date block in rows 1-5, header at row 6, dashboard
// side-panel starting ~column M which we ignore and recompute ourselves).

async function parseXlsx(buffer: Buffer): Promise<RpdParseResult> {
  const wb = new ExcelJS.Workbook()
  // exceljs's bundled .d.ts declares its own local Buffer shape (Symbol.toStringTag
  // "ArrayBuffer") that doesn't structurally match the current @types/node Buffer
  // (Symbol.toStringTag "Uint8Array") — a real Node Buffer works fine at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any)

  const sheet = wb.getWorksheet('сводка') ?? wb.worksheets[0]
  if (!sheet) throw new RpdParseError('В файле не найдено листов')

  // Column positions are located by header TEXT, not fixed offsets from
  // «Уровень образования» — АСУ ships at least two layouts (an 11-column
  // variant with no ФОС на проверке/Долг по ФОС/«% РПД на проверке», and a
  // full 17-column one matching the .doc export exactly). A fixed-offset
  // scheme silently misreads columns when the layout has an extra % column
  // it doesn't expect — confirmed against a real full-width header sample.
  // Кафедра/Форма обучения have no header text at all in any sample (blank
  // cells above «Уровень образования»), so those two stay positional.
  let headerRow = -1
  let levelCol = -1
  const colByLabel = new Map<string, number>()
  for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
    const row = sheet.getRow(r)
    for (let c = 1; c <= row.cellCount; c++) {
      const label = String(sheet.getCell(r, c).value ?? '').trim()
      if (label === 'Уровень образования') { headerRow = r; levelCol = c }
      if (headerRow === r || label === 'Уровень образования') colByLabel.set(label, c)
    }
    if (headerRow > 0) break
  }
  if (headerRow < 0) {
    throw new RpdParseError('Не найден заголовок «Уровень образования» — проверьте, что это выгрузка АСУ Университет')
  }

  const col = (label: string): number => colByLabel.get(label) ?? -1

  const deptCol = levelCol - 2
  const formCol = levelCol - 1
  const planCol = col('Дисциплин по плану')
  const doneCol = col('Сделано РПД')
  const reviewCol = col('РПД на проверке')
  const debtCol = col('Долг по РПД')
  const fosDoneCol = col('Сделано ФОС')
  const fosReviewCol = col('ФОС на проверке')   // -1 on the 11-column variant — defaults to 0 below
  const fosDebtCol = col('Долг по ФОС')         // -1 on the 11-column variant — defaults to 0 below

  if (planCol < 0 || doneCol < 0 || reviewCol < 0 || debtCol < 0 || fosDoneCol < 0) {
    throw new RpdParseError('Не найдены ожидаемые заголовки колонок — проверьте, что это выгрузка «Заполнение РПД и ФОС»')
  }

  let capturedAt: Date | null = null
  let periodLabel: string | null = null
  for (let r = 1; r < headerRow; r++) {
    for (let c = 1; c <= sheet.getRow(r).cellCount; c++) {
      const v = sheet.getCell(r, c).value
      if (v instanceof Date && !capturedAt) capturedAt = v
      if (typeof v === 'string' && /\d{2}\.\d{2}\.\d{4}.*\d{2}\.\d{2}\.\d{4}/.test(v)) periodLabel = v.trim()
    }
  }

  const rows: RpdRowInput[] = []
  const flags: RpdParseFlag[] = []
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const deptCode = String(sheet.getCell(r, deptCol).value ?? '').trim()
    const eduForm  = String(sheet.getCell(r, formCol).value ?? '').trim()
    const eduLevel = String(sheet.getCell(r, levelCol).value ?? '').trim()
    const plan = Number(sheet.getCell(r, planCol).value ?? '')
    if (!deptCode || !eduForm || !eduLevel || !Number.isFinite(plan)) continue // dashboard side-panel / blank rows

    const row: RpdRowInput = {
      deptCode, eduForm, eduLevel,
      planCount: plan,
      rpdDone:   Number(sheet.getCell(r, doneCol).value ?? 0),
      rpdReview: Number(sheet.getCell(r, reviewCol).value ?? 0),
      rpdDebt:   Number(sheet.getCell(r, debtCol).value ?? 0),
      fosDone:   Number(sheet.getCell(r, fosDoneCol).value ?? 0),
      fosReview: fosReviewCol > 0 ? Number(sheet.getCell(r, fosReviewCol).value ?? 0) : 0,
      fosDebt:   fosDebtCol > 0 ? Number(sheet.getCell(r, fosDebtCol).value ?? 0) : 0,
    }
    validateRow(row, flags)
    rows.push(row)
  }

  if (rows.length === 0) throw new RpdParseError('В файле не найдено ни одной строки с данными')

  return { capturedAt: capturedAt ?? new Date(), periodLabel, rows, flags }
}

// ─── .doc path ──────────────────────────────────────────────────────────────

const HEADER_TAIL = '% долга ФОС'

async function parseDoc(buffer: Buffer): Promise<RpdParseResult> {
  const tmpPath = path.join(tmpdir(), `rpd-${randomUUID()}.doc`)
  await writeFile(tmpPath, buffer)
  let body: string
  try {
    const doc = await new WordExtractor().extract(tmpPath)
    body = doc.getBody()
  } finally {
    await unlink(tmpPath).catch(() => {})
  }

  const periodMatch = body.match(/c\s*\d{2}\.\d{2}\.\d{4}\s*по\s*\d{2}\.\d{2}\.\d{4}/)
  const periodLabel = periodMatch ? periodMatch[0].trim() : null
  const dateMatch = body.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/)
  const capturedAt = dateMatch
    ? new Date(Number(dateMatch[3]), Number(dateMatch[2]) - 1, Number(dateMatch[1]),
               Number(dateMatch[4]), Number(dateMatch[5]), Number(dateMatch[6]))
    : new Date()

  const tailIdx = body.indexOf(HEADER_TAIL)
  if (tailIdx < 0) {
    throw new RpdParseError('Не найден заголовок таблицы — проверьте, что это выгрузка «Заполнение РПД и ФОС»')
  }
  const dataText = body.slice(tailIdx + HEADER_TAIL.length)

  const rows: RpdRowInput[] = []
  const flags: RpdParseFlag[] = []

  const bySeparator = parseDocBySeparator(dataText)
  const parsed = bySeparator ?? parseDocByDigitDecoding(dataText)
  if (!parsed || parsed.length === 0) {
    throw new RpdParseError('Не удалось разобрать таблицу из .doc — попробуйте выгрузить .xlsx из АСУ')
  }
  for (const row of parsed) {
    validateRow(row, flags)
    rows.push(row)
  }

  return { capturedAt, periodLabel, rows, flags }
}

/** Primary path — Word's own cell separator (tab, or 0x07 depending on extractor), present in the .doc text stream. */
function parseDocBySeparator(dataText: string): RpdRowInput[] | null {
  const tokens = dataText.split(/[\x07\x0b\x0c\t]/).map((t) => t.trim()).filter((t) => t.length > 0)
  if (tokens.length < 17) return null

  const rows: RpdRowInput[] = []
  let i = 0
  let expectedNo = 1
  while (i + 17 <= tokens.length) {
    const chunk = tokens.slice(i, i + 17)
    if (Number(chunk[0]) !== expectedNo) break // separator scheme didn't match — bail to the fallback decoder
    rows.push({
      deptCode:  chunk[1],
      eduForm:   chunk[2],
      eduLevel:  chunk[3],
      planCount: toNum(chunk[4]),
      rpdDone:   toNum(chunk[5]),
      rpdReview: toNum(chunk[7]),
      rpdDebt:   toNum(chunk[9]),
      fosDone:   toNum(chunk[11]),
      fosReview: toNum(chunk[13]),
      fosDebt:   toNum(chunk[15]),
    })
    i += 17
    expectedNo += 1
  }
  return rows.length > 0 ? rows : null
}

function toNum(s: string): number {
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/**
 * Fallback path — no reliable cell separator survived extraction, so each
 * row is a run of concatenated digits with no delimiter at all, e.g.
 * "266,700133,3" for план=3. We know the six fields are (done, %done,
 * review, %review, debt, %debt) with done+review+debt===план and each
 * percent independently derivable from its count — so we can reconstruct
 * the split by searching for the (done, review) pair whose formatted
 * concatenation reproduces the exact source string. This was validated
 * against every one of the 221 rows in __fixtures__/rpd/долги.doc, including
 * rows where на-проверке exceeds план (negative долг) and where план itself
 * was revised down after completion (done > план).
 */
function parseDocByDigitDecoding(dataText: string): RpdRowInput[] | null {
  const flat = dataText.replace(/[\x07\x0b\x0c\s]/g, '')
  const rows: RpdRowInput[] = []
  let pos = 0
  let rowNo = 1

  while (pos < flat.length) {
    const noMatch = /^(\d+)/.exec(flat.slice(pos))
    if (!noMatch || Number(noMatch[1]) !== rowNo) break
    pos += noMatch[1].length

    let formMatch: string | null = null
    let formIdx = -1
    for (const f of EDU_FORMS) {
      const j = flat.indexOf(f, pos)
      if (j !== -1 && (formIdx === -1 || j < formIdx)) { formIdx = j; formMatch = f }
    }
    if (!formMatch) break
    const deptCode = flat.slice(pos, formIdx)
    pos = formIdx + formMatch.length

    const level = EDU_LEVELS.find((l) => flat.startsWith(l, pos))
    if (!level) break
    pos += level.length

    const planMatch = /^(\d+)/.exec(flat.slice(pos))
    if (!planMatch) break
    const plan = Number(planMatch[1])
    pos += planMatch[1].length

    const rpd = decodeTriplet(flat, pos, plan)
    if (!rpd) break
    const fos = decodeTriplet(flat, rpd.end, plan)
    if (!fos) break

    rows.push({
      deptCode, eduForm: formMatch, eduLevel: level, planCount: plan,
      rpdDone: rpd.done, rpdReview: rpd.review, rpdDebt: rpd.debt,
      fosDone: fos.done, fosReview: fos.review, fosDebt: fos.debt,
    })
    pos = fos.end
    rowNo += 1
  }

  return rows.length > 0 ? rows : null
}

/** Formats a percentage the way АСУ's export does: 1 decimal, comma separator, no trailing ".0". */
function fmtPct(count: number, plan: number): string {
  if (plan === 0) return '0'
  const v = (count / plan) * 100
  // Round-half-up at 1 decimal without float drift (31.25 must round to 31.3, not 31.2).
  const sign = v < 0 ? -1 : 1
  const rounded = sign * Math.round((Math.abs(v) * 10 + 1e-9)) / 10
  if (Number.isInteger(rounded)) return String(rounded)
  return rounded.toFixed(1).replace('.', ',')
}

/** Searches for (done, review) — debt is forced by done+review+debt===plan — that reproduces `s` at `start`. */
function decodeTriplet(s: string, start: number, plan: number): { done: number; review: number; debt: number; end: number } | null {
  const bound = plan + 50 // covers план revised down after work already logged
  for (let done = 0; done <= bound; done++) {
    const doneStr = String(done)
    if (!s.startsWith(doneStr, start)) continue
    const pctDoneStr = fmtPct(done, plan)
    const i1 = start + doneStr.length
    if (!s.startsWith(pctDoneStr, i1)) continue
    const i2 = i1 + pctDoneStr.length

    for (let review = 0; review <= bound; review++) {
      const reviewStr = String(review)
      if (!s.startsWith(reviewStr, i2)) continue
      const i3 = i2 + reviewStr.length
      const pctReviewStr = fmtPct(review, plan)
      if (!s.startsWith(pctReviewStr, i3)) continue
      const i4 = i3 + pctReviewStr.length

      const debt = plan - done - review
      const debtStr = String(debt)
      if (!s.startsWith(debtStr, i4)) continue
      const i5 = i4 + debtStr.length
      const pctDebtStr = fmtPct(debt, plan)
      if (!s.startsWith(pctDebtStr, i5)) continue
      const i6 = i5 + pctDebtStr.length

      return { done, review, debt, end: i6 }
    }
  }
  return null
}

// ─── Overview / rollups ─────────────────────────────────────────────────────

export interface RpdTotals {
  planCount: number
  rpdDone:   number
  rpdReview: number
  rpdDebt:   number
  rpdPct:    number
  fosDone:   number
  fosReview: number
  fosDebt:   number
  fosPct:    number
}

export interface RpdGroupOverview extends RpdTotals {
  groupId:   string
  groupName: string
  deptCount: number
  deltaRpdDone: number | null
  deltaRpdDebt: number | null // current - previous; negative means долг shrank (good)
}

export interface RpdProblemDept {
  deptCode:  string
  eduForm:   string
  eduLevel:  string
  groupName: string | null
  planCount: number
  rpdDebt:   number
  rpdPct:    number
  stalled:   boolean // no progress since the previous snapshot
}

export interface RpdLeaderDept {
  deptCode:  string
  eduForm:   string
  eduLevel:  string
  groupName: string | null
  planCount: number
  rpdDone:   number
  rpdDebt:   number
  rpdPct:    number
  improved:  boolean // rpd_done increased since the previous snapshot
}

export interface RpdRegressedDept {
  deptCode:     string
  eduForm:      string
  eduLevel:     string
  groupName:    string | null
  planCount:    number
  previousDebt: number
  currentDebt:  number
  deltaDebt:    number  // > 0 — долг got worse since the previous snapshot
  deltaReview:  number  // usually negative here — на проверке drained without becoming сделано
}

export interface RpdAllDept {
  deptCode:  string
  eduForm:   string
  eduLevel:  string
  groupName: string | null
  planCount: number
  rpdDone:   number
  rpdReview: number
  rpdDebt:   number
  rpdPct:    number
  fosDone:   number
  fosReview: number
  fosDebt:   number
  fosPct:    number
  deltaRpdDone: number | null
}

export interface RpdOverview {
  snapshot: { id: string; capturedAt: string; periodLabel: string | null; sourceFilename: string | null }
  previousSnapshot: { id: string; capturedAt: string } | null
  totals: RpdTotals
  previousTotals: RpdTotals | null
  groups: RpdGroupOverview[]
  ungroupedDeptCodes: string[]
  problemDepts: RpdProblemDept[]
  leaderDepts: RpdLeaderDept[]
  /** Кафедры whose долг got worse since the previous snapshot — usually because
      на проверке drained (rejected/returned) faster than it converted to сделано.
      Explains cases where both Сделано and Долг rise in the same period: they're
      not each other's mirror, на проверке is — this is that regression made visible. */
  regressedDepts: RpdRegressedDept[]
  /** Every кафедра/форма/уровень row in the snapshot — problemDepts/leaderDepts are curated
      top-N views of this same data, capped for the at-a-glance panels; this is the complete list
      so no department is ever invisible on the platform. */
  allDepts: RpdAllDept[]
  timeSeries: Array<{ snapshotId: string; capturedAt: string; planCount: number; rpdDone: number; rpdPct: number }>
}

// Same three tiers as the frontend's status pills/bar chart — shared here so the
// Excel and Word exports can colour-code by the same thresholds, not just the UI.
// Driven by % долга (debt as a share of план), not readiness: 0% долга is the
// good case (success), > 50% is the bad one (danger) — the opposite direction
// from a readiness percentage, hence the <= comparisons rather than <.
export type RpdStatus = 'danger' | 'warning' | 'success'

export function pctStatus(debtPct: number): RpdStatus {
  if (debtPct <= 0) return 'success'
  if (debtPct <= 50) return 'warning'
  return 'danger'
}

/** Cell-shading tints (6-hex, no #/alpha prefix) for the Excel/Word exports — same
    three tiers as the web pills. Saturated enough to read as a clear colour at a
    glance (the first pass was too washed-out), still light enough for black text. */
export const STATUS_FILL_HEX: Record<RpdStatus, string> = {
  danger:  'EF9A9A',
  warning: 'FFCC80',
  success: 'A5D6A7',
}

function sumTotals(rows: RpdSnapshotRowRecord[]): RpdTotals {
  const t = rows.reduce((acc, r) => ({
    planCount: acc.planCount + r.plan_count,
    rpdDone:   acc.rpdDone + r.rpd_done,
    rpdReview: acc.rpdReview + r.rpd_review,
    rpdDebt:   acc.rpdDebt + r.rpd_debt,
    fosDone:   acc.fosDone + r.fos_done,
    fosReview: acc.fosReview + r.fos_review,
    fosDebt:   acc.fosDebt + r.fos_debt,
  }), { planCount: 0, rpdDone: 0, rpdReview: 0, rpdDebt: 0, fosDone: 0, fosReview: 0, fosDebt: 0 })
  return {
    ...t,
    rpdPct: t.planCount > 0 ? round1((t.rpdDone / t.planCount) * 100) : 0,
    fosPct: t.planCount > 0 ? round1((t.fosDone / t.planCount) * 100) : 0,
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function rowKey(r: Pick<RpdSnapshotRowRecord, 'dept_code' | 'edu_form' | 'edu_level'>): string {
  return `${r.dept_code} ${r.edu_form} ${r.edu_level}`
}

export async function computeOverview(institutionId: string, snapshotId: string): Promise<RpdOverview> {
  const snapshot = await getSnapshot(snapshotId, institutionId)
  if (!snapshot) throw new NotFoundError('Снимок')

  const [rows, previousSnapshot, groupMap, groups, series] = await Promise.all([
    getSnapshotRows(snapshotId),
    getPreviousSnapshot(institutionId, snapshot.captured_at),
    getDeptGroupMap(institutionId),
    listDeptGroups(institutionId),
    getSnapshotTotalsSeries(institutionId),
  ])
  const previousRows = previousSnapshot ? await getSnapshotRows(previousSnapshot.id) : []
  const previousByKey = new Map(previousRows.map((r) => [rowKey(r), r]))

  const totals = sumTotals(rows)
  const previousTotals = previousSnapshot ? sumTotals(previousRows) : null

  // Group rows by кафедра group, tracking unmapped кафедры separately.
  const byGroup = new Map<string, RpdSnapshotRowRecord[]>()
  const ungrouped = new Set<string>()
  for (const r of rows) {
    const mapping = groupMap.get(r.dept_code)
    if (!mapping) { ungrouped.add(r.dept_code); continue }
    if (!byGroup.has(mapping.groupId)) byGroup.set(mapping.groupId, [])
    byGroup.get(mapping.groupId)!.push(r)
  }

  const groupOverviews: RpdGroupOverview[] = groups.map((g) => {
    const groupRows = byGroup.get(g.id) ?? []
    const t = sumTotals(groupRows)
    const deltaRpdDone = previousSnapshot
      ? groupRows.reduce((sum, r) => {
          const prev = previousByKey.get(rowKey(r))
          return sum + (r.rpd_done - (prev?.rpd_done ?? 0))
        }, 0)
      : null
    const deltaRpdDebt = previousSnapshot
      ? groupRows.reduce((sum, r) => {
          const prev = previousByKey.get(rowKey(r))
          return sum + (r.rpd_debt - (prev?.rpd_debt ?? r.plan_count))
        }, 0)
      : null
    return {
      ...t, groupId: g.id, groupName: g.name,
      deptCount: new Set(groupRows.map((r) => r.dept_code)).size,
      deltaRpdDone, deltaRpdDebt,
    }
  }).sort((a, b) => b.rpdDebt - a.rpdDebt)

  // Problem кафедры: meaningful debt outstanding. Ranked by % долга (proportionally
  // worst first), not raw count — a tiny кафедра owing 100% of its plan now
  // outranks a big one owing 60% of a much larger plan, matching the same
  // percentage the status colour uses. Flags ones with zero progress since last snapshot.
  const problemDepts: RpdProblemDept[] = rows
    .filter((r) => r.rpd_debt > 0)
    .map((r) => {
      const prev = previousByKey.get(rowKey(r))
      return {
        deptCode: r.dept_code, eduForm: r.edu_form, eduLevel: r.edu_level,
        groupName: groupMap.get(r.dept_code)?.groupName ?? null,
        planCount: r.plan_count, rpdDebt: r.rpd_debt,
        rpdPct: r.plan_count > 0 ? round1((r.rpd_done / r.plan_count) * 100) : 0,
        stalled: Boolean(prev) && r.rpd_done <= prev!.rpd_done,
      }
    })
    .sort((a, b) => (b.rpdDebt / b.planCount) - (a.rpdDebt / a.planCount) || b.rpdDebt - a.rpdDebt)
    .slice(0, 50)

  // Well-performing кафедры: the positive mirror of «Проблемные» — zero долг
  // (debt-free, including the rare negative-долг anomaly rows), biggest
  // workloads first so a substantial completion outranks a trivial one-discipline
  // case. Flags an «improved» badge for ones that moved since last snapshot.
  const leaderDepts: RpdLeaderDept[] = rows
    .filter((r) => r.rpd_debt <= 0)
    .map((r) => {
      const prev = previousByKey.get(rowKey(r))
      return {
        deptCode: r.dept_code, eduForm: r.edu_form, eduLevel: r.edu_level,
        groupName: groupMap.get(r.dept_code)?.groupName ?? null,
        planCount: r.plan_count, rpdDone: r.rpd_done, rpdDebt: r.rpd_debt,
        rpdPct: r.plan_count > 0 ? round1((r.rpd_done / r.plan_count) * 100) : 0,
        improved: Boolean(prev) && r.rpd_done > prev!.rpd_done,
      }
    })
    .sort((a, b) => b.planCount - a.planCount || b.rpdPct - a.rpdPct)
    .slice(0, 50)

  // Regressions: долг got worse since the previous snapshot. Needs a previous
  // snapshot AND a matching previous row (a кафедра that only just appeared has
  // no meaningful "regression", it's new — not covered here).
  const regressedDepts: RpdRegressedDept[] = previousSnapshot
    ? rows
        .map((r) => {
          const prev = previousByKey.get(rowKey(r))
          if (!prev) return null
          const deltaDebt = r.rpd_debt - prev.rpd_debt
          if (deltaDebt <= 0) return null
          return {
            deptCode: r.dept_code, eduForm: r.edu_form, eduLevel: r.edu_level,
            groupName: groupMap.get(r.dept_code)?.groupName ?? null,
            planCount: r.plan_count,
            previousDebt: prev.rpd_debt, currentDebt: r.rpd_debt, deltaDebt,
            deltaReview: r.rpd_review - prev.rpd_review,
          }
        })
        .filter((x): x is RpdRegressedDept => x !== null)
        .sort((a, b) => b.deltaDebt - a.deltaDebt)
        .slice(0, 50)
    : []

  // Complete list — every row, uncapped. problemDepts/leaderDepts above are curated
  // top-N subsets of exactly this data for the at-a-glance panels; this is what
  // guarantees no department is ever invisible on the platform.
  const allDepts: RpdAllDept[] = rows
    .map((r) => {
      const prev = previousByKey.get(rowKey(r))
      return {
        deptCode: r.dept_code, eduForm: r.edu_form, eduLevel: r.edu_level,
        groupName: groupMap.get(r.dept_code)?.groupName ?? null,
        planCount: r.plan_count, rpdDone: r.rpd_done, rpdReview: r.rpd_review, rpdDebt: r.rpd_debt,
        rpdPct: r.plan_count > 0 ? round1((r.rpd_done / r.plan_count) * 100) : 0,
        fosDone: r.fos_done, fosReview: r.fos_review, fosDebt: r.fos_debt,
        fosPct: r.plan_count > 0 ? round1((r.fos_done / r.plan_count) * 100) : 0,
        deltaRpdDone: prev ? r.rpd_done - prev.rpd_done : null,
      }
    })
    .sort((a, b) => (a.groupName ?? '').localeCompare(b.groupName ?? '') || a.deptCode.localeCompare(b.deptCode))

  return {
    snapshot: {
      id: snapshot.id, capturedAt: snapshot.captured_at,
      periodLabel: snapshot.period_label, sourceFilename: snapshot.source_filename,
    },
    previousSnapshot: previousSnapshot ? { id: previousSnapshot.id, capturedAt: previousSnapshot.captured_at } : null,
    totals, previousTotals,
    groups: groupOverviews,
    ungroupedDeptCodes: Array.from(ungrouped).sort(),
    problemDepts,
    leaderDepts,
    regressedDepts,
    allDepts,
    timeSeries: series.map((s) => ({
      snapshotId: s.snapshot_id, capturedAt: s.captured_at, planCount: s.plan_count,
      rpdDone: s.rpd_done, rpdPct: s.plan_count > 0 ? round1((s.rpd_done / s.plan_count) * 100) : 0,
    })),
  }
}

/** Bootstrap flow — she uploads her existing per-institute file so we learn which кафедры belong together. */
export async function learnDeptCodesFromWorkbook(buffer: Buffer, filename: string): Promise<string[]> {
  const { rows } = await parseAsuExport(buffer, filename)
  return Array.from(new Set(rows.map((r) => r.deptCode))).sort()
}
