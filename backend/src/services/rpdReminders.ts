// Reminder letters for кафедры/institutes lagging on РПД — the other half of
// the weekly work the head of УМЦ used to do by hand (её «долги» notices).
// The долг table itself is deterministic; only the opening paragraph is
// drafted through the LLM so the letter doesn't read as a raw data dump —
// she reviews and edits before sending (docx path never mails anything).

import type { RpdSnapshotRecord, RpdSnapshotRowRecord, RpdDeptGroupRecord } from '../db/queries/rpdMonitor'
import { chat } from './llm/registry'

interface ProblemRow {
  deptCode:  string
  eduForm:   string
  eduLevel:  string
  planCount: number
  rpdDone:   number
  rpdDebt:   number
  rpdPct:    number
}

export interface RpdReminderPreview {
  groupName:  string
  dateStr:    string
  narrative:  string
  rows:       ProblemRow[]
  /** Plain tab-separated text — what «Скопировать текст» puts on the clipboard (pastes cleanly into Excel/Word/email). */
  text:       string
}

function problemRows(group: RpdDeptGroupRecord, rows: RpdSnapshotRowRecord[]): ProblemRow[] {
  const deptSet = new Set(group.dept_codes)
  return rows
    .filter((r) => deptSet.has(r.dept_code) && r.rpd_debt > 0)
    .map((r) => ({
      deptCode: r.dept_code, eduForm: r.edu_form, eduLevel: r.edu_level,
      planCount: r.plan_count, rpdDone: r.rpd_done, rpdDebt: r.rpd_debt,
      rpdPct: r.plan_count > 0 ? Math.round((r.rpd_done / r.plan_count) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.rpdDebt - a.rpdDebt)
}

async function draftNarrative(teacherId: string, group: RpdDeptGroupRecord, problems: ProblemRow[], periodLabel: string | null): Promise<string> {
  const totalDebt = problems.reduce((s, r) => s + r.rpdDebt, 0)
  const worst = problems.slice(0, 3).map((r) => `${r.deptCode} (${r.eduForm}, ${r.eduLevel}): долг ${r.rpdDebt} из ${r.planCount}`).join('; ')
  try {
    const text = await chat([
      { role: 'system', content: 'Ты помогаешь учебно-методическому центру составить короткое официальное деловое напоминание кафедрам о задолженности по заполнению РПД в АСУ Университет. Пиши по-русски, официально-деловым стилем, без канцеляризмов и без markdown. 2-4 предложения, без приветствия и подписи — только основной абзац.' },
      { role: 'user', content: `Институт: ${group.name}. Период отчётности: ${periodLabel ?? 'текущий учебный год'}. Общий долг по РПД: ${totalDebt} дисциплин. Наибольшее отставание: ${worst || 'нет данных'}. Составь абзац-напоминание.` },
    ], { context: { teacherId, feature: 'rpd_reminder' }, temperature: 0.4, maxTokens: 300 })
    return text.trim()
  } catch {
    // LLM is a nice-to-have here — the долг table below is what actually matters.
    return `Напоминаем о необходимости завершить заполнение рабочих программ дисциплин (РПД) в АСУ Университет. ` +
           `По состоянию на текущий снимок за институтом «${group.name}» числится задолженность по ${problems.length} ` +
           `позициям (${totalDebt} дисциплин). Просим завершить работу в кратчайшие сроки.`
  }
}

export async function generateRpdReminderText(
  teacherId: string,
  snapshot: RpdSnapshotRecord,
  group: RpdDeptGroupRecord,
  rows: RpdSnapshotRowRecord[],
): Promise<RpdReminderPreview> {
  const problems = problemRows(group, rows)
  const narrative = await draftNarrative(teacherId, group, problems, snapshot.period_label)
  const dateStr = new Date(snapshot.captured_at).toLocaleDateString('ru-RU')

  const lines = [
    `Институт «${group.name}» — напоминание о долге по РПД (по данным на ${dateStr})`,
    '',
    narrative,
    '',
    'Кафедра\tФорма обучения\tУровень образования\tСделано\tПлан\t% готовности\tДолг',
    ...problems.map((r) => `${r.deptCode}\t${r.eduForm}\t${r.eduLevel}\t${r.rpdDone}\t${r.planCount}\t${r.rpdPct}%\t${r.rpdDebt}`),
  ]
  return { groupName: group.name, dateStr, narrative, rows: problems, text: lines.join('\n') }
}

export async function generateRpdReminderDocx(
  teacherId: string,
  snapshot: RpdSnapshotRecord,
  group: RpdDeptGroupRecord,
  rows: RpdSnapshotRowRecord[],
): Promise<Buffer> {
  const {
    Document, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
    Packer, WidthType, BorderStyle,
  } = await import('docx')

  const problems = problemRows(group, rows)
  const narrative = await draftNarrative(teacherId, group, problems, snapshot.period_label)
  const dateStr = new Date(snapshot.captured_at).toLocaleDateString('ru-RU')

  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: 'D8D2C6' }
  const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder }
  const headCell = (text: string) => new TableCell({ borders, children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })] })
  const cell = (text: string) => new TableCell({ borders, children: [new Paragraph({ children: [new TextRun(text)] })] })

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [headCell('Кафедра'), headCell('Форма'), headCell('Уровень'), headCell('Сделано / План'), headCell('% готовности'), headCell('Долг')] }),
      ...problems.map((r) => new TableRow({
        children: [
          cell(r.deptCode), cell(r.eduForm), cell(r.eduLevel),
          cell(`${r.rpdDone} / ${r.planCount}`), cell(`${r.rpdPct}%`), cell(String(r.rpdDebt)),
        ],
      })),
    ],
  })

  const document = new Document({
    sections: [{
      children: [
        new Paragraph({ text: `Напоминание о долге по РПД`, heading: HeadingLevel.TITLE, spacing: { after: 100 } }),
        new Paragraph({ text: `Институт «${group.name}»`, heading: HeadingLevel.HEADING_2, spacing: { after: 100 } }),
        new Paragraph({ children: [new TextRun(`По данным на ${dateStr}${snapshot.period_label ? ` (период: ${snapshot.period_label})` : ''}`)], spacing: { after: 200 } }),
        new Paragraph({ children: [new TextRun(narrative)], spacing: { after: 300 } }),
        table,
      ],
    }],
  })

  return Packer.toBuffer(document)
}
