import type { FosDocument } from '../../../shared/types'

// docx is imported lazily inside the generator so the rest of the backend
// boots even if the package isn't installed yet — same posture as pdfkit in
// programReportPdf.ts. Confirmed CommonJS-requirable: v9.7.1's package.json
// says "type": "module" but its "main" field points at a UMD/CJS bundle
// (dist/index.umd.cjs), so require()/dynamic import() both resolve the CJS
// build under this backend's CommonJS compile target — same shape as the
// pg-boss v10-vs-v12 check jobQueue.ts's header comment documents.

export async function generateFosDocx(doc: FosDocument, courseName: string): Promise<Buffer> {
  const {
    Document, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
    Packer, WidthType, BorderStyle,
  } = await import('docx')

  const sections = doc.sections
  if (!sections) throw new Error('ФОС ещё не сгенерирован')

  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: 'D8D2C6' }
  const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder }

  const heading = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 150 } })
  const subheading = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } })
  const body = (text: string) => new Paragraph({ children: [new TextRun(text)], spacing: { after: 80 } })

  const children: InstanceType<typeof Paragraph | typeof Table>[] = []

  children.push(
    new Paragraph({ text: `Фонд оценочных средств (ФОС)`, heading: HeadingLevel.TITLE, spacing: { after: 100 } }),
    new Paragraph({ text: courseName, heading: HeadingLevel.HEADING_2, spacing: { after: 200 } }),
    body(`Сформировано: ${new Date(doc.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`),
  )

  // ── Coverage warnings ──────────────────────────────────────────────────
  if (doc.coverage) {
    const warnings = [
      ...doc.coverage.topics_uncovered.map((t) => `Тема без оценочного средства: «${t}»`),
      ...doc.coverage.competencies_uncovered.map((c) => `Компетенция не отражена в паспорте: «${c}»`),
      ...(doc.coverage.balance_warning ? [doc.coverage.balance_warning] : []),
    ]
    if (warnings.length > 0) {
      children.push(subheading('Замечания по покрытию'))
      for (const w of warnings) children.push(body(`⚠ ${w}`))
    }
  }

  // ── Паспорт ФОС ────────────────────────────────────────────────────────
  children.push(heading('Паспорт ФОС'))
  if (sections.passport.competencies.length > 0) {
    children.push(body(`Компетенции: ${sections.passport.competencies.join(', ')}`))
  }
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({ borders, children: [new Paragraph({ children: [new TextRun({ text: 'Тема', bold: true })] })] }),
            new TableCell({ borders, children: [new Paragraph({ children: [new TextRun({ text: 'Оценочные средства', bold: true })] })] }),
          ],
        }),
        ...sections.passport.rows.map((row) => new TableRow({
          children: [
            new TableCell({ borders, children: [new Paragraph(row.topic)] }),
            new TableCell({ borders, children: [new Paragraph(row.instruments.length > 0 ? row.instruments.join('; ') : '— не покрыто —')] }),
          ],
        })),
      ],
    }),
  )

  // ── Экзаменационные билеты ──────────────────────────────────────────────
  if (sections.tickets.length > 0) {
    children.push(heading(`Экзаменационные билеты (${sections.tickets.length})`))
    for (const ticket of sections.tickets) {
      children.push(subheading(`Билет №${ticket.number}`))
      ticket.theory_questions.forEach((q, i) => children.push(body(`${i + 1}. ${q}`)))
      children.push(body(`Практическое задание: ${ticket.practical_task}`))
    }
  }

  // ── Критерии оценивания ─────────────────────────────────────────────────
  if (sections.criteria.length > 0) {
    children.push(heading('Критерии оценивания'))
    for (const c of sections.criteria) {
      children.push(subheading(c.title))
      for (const s of c.scale) children.push(body(`${s.grade} — ${s.description}`))
    }
  }

  const document = new Document({
    sections: [{ children }],
  })

  return Packer.toBuffer(document)
}
