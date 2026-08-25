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

  const cell = (text: string, bold = false) => new TableCell({
    borders, children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
  })
  const table = (header: string[], rows: string[][]) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: header.map((h) => cell(h, true)) }),
      ...rows.map((r) => new TableRow({ children: r.map((v) => cell(v)) })),
    ],
  })
  const blank = '_________________________'
  const num = (n: number | null | undefined) => (n == null ? '' : String(n))

  // ── Титульный лист (макет) ─────────────────────────────────────────────
  // Institutional fields the generator has no access to print the макет's own
  // blank rules rather than a guess — this is a form to be completed, and an
  // invented факультет would be worse than an obvious gap.
  const tp = sections.title_page
  children.push(
    body('Министерство науки и высшего образования Российской Федерации'),
    body('Федеральное государственное бюджетное образовательное учреждение высшего образования'),
    body('«Казанский национальный исследовательский технологический университет»'),
    body(`Факультет/институт ${tp?.faculty ?? blank}`),
    body(`Кафедра ${tp?.department ?? blank}`),
    new Paragraph({ text: 'ФОНД ОЦЕНОЧНЫХ СРЕДСТВ', heading: HeadingLevel.TITLE, spacing: { before: 200, after: 100 } }),
    body('по дисциплине (модулю)'),
    body(tp?.discipline ?? courseName),
    body(`${tp?.direction ?? blank}`),
    body('(код и наименование направления подготовки/специальности)'),
    body(`${tp?.profile ?? blank}`),
    body('(наименование профиля/программы/направленности/специализации)'),
    body(`${tp?.qualification ?? blank}`),
    body('квалификация'),
    body(`Казань ${tp?.year ?? new Date().getFullYear()}`),
  )

  // ── Оборотная сторона титульного листа ─────────────────────────────────
  // «СОГЛАСОВАНО» is intentionally absent: the макет includes it only for
  // kafedras writing a ФОС for another kafedra, so printing it by default
  // would put a block on every document that most must not fill in.
  children.push(
    subheading('Оборотная сторона титульного листа'),
    body('Составитель ФОС:'),
    body(`${blank}   ${blank}   ${blank}`),
    body('(должность)                    (подпись)                    (Ф.И.О)'),
    body(`ФОС рассмотрен и одобрен на заседании кафедры ${blank},`),
    body('протокол от _________ 20__ г. № ___'),
    body(`Зав. кафедрой ${blank}`),
    body('УТВЕРЖДЕНО'),
    body(`Начальник УМЦ, доцент / Зав. магистратурой, доцент   ${blank}`),
    body('(подпись)                                  (Ф.И.О.)'),
  )

  children.push(
    body(`Сформировано: ${new Date(doc.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`),
  )

  // ── Перечень компетенций и индикаторов ─────────────────────────────────
  children.push(heading('Перечень компетенций и индикаторов достижения компетенций с указанием этапов формирования в процессе освоения дисциплины'))
  if (sections.competency_map && sections.competency_map.length > 0) {
    children.push(table(
      ['Индикаторы достижения компетенции', 'Лекции', 'Практические занятия', 'Лабораторные занятия', 'Курсовой проект (работа)', 'Наименование оценочного средства'],
      sections.competency_map.map((r) => [r.indicator, r.lectures, r.practicals, r.labs, r.coursework, r.instruments]),
    ))
  } else {
    children.push(body('Компетенции и индикаторы не заданы — заполните таблицу по форме макета.'))
  }

  // ── Перечень оценочных средств ─────────────────────────────────────────
  children.push(heading('Перечень оценочных средств по дисциплине (модулю)'))
  if (sections.score_table && sections.score_table.length > 0) {
    let lastSemester: string | null | undefined
    const rows: string[][] = []
    for (const r of sections.score_table) {
      if (r.semester && r.semester !== lastSemester) {
        rows.push([r.semester, '', '', ''])
        lastSemester = r.semester
      }
      rows.push([r.name, num(r.count), num(r.min_points), num(r.max_points)])
    }
    children.push(table(
      ['Оценочные средства', 'Кол-во', 'Min, баллов (базовый уровень)', 'Max, баллов (повышенный уровень)'],
      rows,
    ))
  } else {
    children.push(table(
      ['Оценочные средства', 'Кол-во', 'Min, баллов (базовый уровень)', 'Max, баллов (повышенный уровень)'],
      [['', '', '', '']],
    ))
  }
  children.push(body('Примечание: перечень оценочных средств приводиться из п.9 рабочей программы по дисциплине (модулю)'))

  // ── Шкала оценивания ───────────────────────────────────────────────────
  children.push(heading('Шкала оценивания'))
  children.push(table(
    ['Цифровое выражение', 'Выражение в баллах', 'Словесное выражение', 'Критерии оценки при экзамене / зачёте с оценкой', 'Критерии оценки при зачёте'],
    (sections.grading_scale ?? []).map((r) => [r.digit, r.points, r.word, r.criteria_exam, r.criteria_credit]),
  ))

  // ── Краткая характеристика оценочных средств ───────────────────────────
  children.push(heading('Краткая характеристика оценочных средств'))
  if (sections.catalogue && sections.catalogue.length > 0) {
    children.push(table(
      ['Наименование оценочного средства', 'Краткая характеристика оценочного средства', 'Представление оценочного средства в фонде'],
      sections.catalogue.map((r) => [r.name, r.description, r.representation]),
    ))
  } else {
    children.push(body('Перечень оценочных средств не определён — заполните таблицу по форме макета.'))
  }

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

  // ── Критерии оценки по каждому оценочному средству ──────────────────────
  // Points come from §9 and are distributed in code, so each block's parts
  // add up to what it declares and to its перечень row — the two arithmetic
  // rules assessmentLinkage.ts checks are satisfied rather than tested for.
  for (const block of sections.instrument_criteria ?? []) {
    children.push(heading(`Критерии оценки: ${block.instrument}`))
    if (block.declared_min != null || block.declared_max != null) {
      children.push(body(
        `Максимальное количество баллов за «${block.instrument}»: ${num(block.declared_max)}, ` +
        `минимальное: ${num(block.declared_min)}. Из них:`
      ))
    }
    children.push(table(
      ['Виды работ', 'Минимальный балл', 'Максимальный балл'],
      [
        ...block.components.map((cp) => [cp.label, num(cp.min), num(cp.max)]),
        ['ИТОГО:', num(block.declared_min), num(block.declared_max)],
      ],
    ))
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
