import path from 'path'
import type { FosDocument } from '../../../shared/types'

// pdfkit is imported lazily inside the generator so the rest of the backend
// boots even if the package isn't installed yet — only this endpoint depends
// on it (same posture as programReportPdf.ts).

// Server-rendered branded PDF of a ФОС generation run (TODO.md Feature X).
// A sibling file to programReportPdf.ts rather than a variant of it — a
// different document shape (паспорт/билеты/критерии, not a programme
// analysis) — but reuses the same design-token and hand-laid-layout approach.

const C = {
  ink:       '#1A1A1A',
  ink2:      '#6B6560',
  ink3:      '#A09890',
  amber:     '#C8860A',
  amberLight:'#FDF3DC',
  border:    '#E7E2D9',
  bg:        '#F7F5F0',
  warning:   '#9A6800',
  warningBg: '#FEF6E0',
}

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts')
const FONTS = {
  serif:  path.join(FONT_DIR, 'PTSerif-Bold.ttf'),
  serifR: path.join(FONT_DIR, 'PTSerif-Regular.ttf'),
  sans:   path.join(FONT_DIR, 'PTSans-Regular.ttf'),
  sansB:  path.join(FONT_DIR, 'PTSans-Bold.ttf'),
}

export async function generateFosReportPdf(doc: FosDocument, courseName: string): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit')
  const sections = doc.sections
  if (!sections) throw new Error('ФОС ещё не сгенерирован')

  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: {
      Title: `ФОС — ${courseName}`,
      Author: 'ИСПУМ',
    } })

    pdf.registerFont('serif',  FONTS.serif)
    pdf.registerFont('serifR', FONTS.serifR)
    pdf.registerFont('sans',   FONTS.sans)
    pdf.registerFont('sansB',  FONTS.sansB)

    const chunks: Buffer[] = []
    pdf.on('data', (c: Buffer) => chunks.push(c))
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)

    const M = 48
    const W = pdf.page.width
    const H = pdf.page.height
    const CW = W - M * 2
    const bottom = H - M - 24
    let y = M

    const ensure = (h: number) => { if (y + h > bottom) { pdf.addPage(); y = M } }
    const fontMap = { serif: 'serif', serifR: 'serifR', sans: 'sans', sansB: 'sansB' } as const
    const text = (s: string, font: keyof typeof fontMap, size: number, color: string,
      opts: { x?: number; w?: number; align?: 'left' | 'center' | 'right'; gap?: number } = {}) => {
      const x = opts.x ?? M
      const w = opts.w ?? CW
      pdf.font(fontMap[font]).fontSize(size).fillColor(color)
      const h = pdf.heightOfString(s, { width: w, align: opts.align, lineGap: opts.gap ?? 0 })
      ensure(h)
      pdf.text(s, x, y, { width: w, align: opts.align, lineGap: opts.gap ?? 0 })
      y += h
    }
    const gap = (h: number) => { y += h }
    const rule = (color = C.border) => { ensure(8); pdf.moveTo(M, y).lineTo(M + CW, y).lineWidth(1).strokeColor(color).stroke(); y += 1 }
    const sectionHeading = (label: string) => {
      gap(18); ensure(28)
      pdf.rect(M, y + 2, 3, 16).fill(C.amber)
      pdf.font('serif').fontSize(15).fillColor(C.ink).text(label, M + 12, y, { width: CW - 12 })
      y += 22; rule(); gap(8)
    }

    // ── HEADER ────────────────────────────────────────────────────────────
    pdf.rect(0, 0, W, 96).fill(C.bg)
    pdf.font('serif').fontSize(17).fillColor(C.ink).text('ИСПУМ', M, 30)
    const wmW = pdf.widthOfString('ИСПУМ')
    pdf.font('sans').fontSize(9).fillColor(C.amber)
      .text('Фонд оценочных средств (ФОС)', M + wmW + 10, 36)
    pdf.font('sans').fontSize(9).fillColor(C.ink3)
      .text(new Date(doc.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
        M, 30, { width: CW, align: 'right' })
    y = 116
    text(courseName, 'serif', 22, C.ink, { gap: 2 })
    gap(10)

    // ── COVERAGE WARNINGS ──────────────────────────────────────────────────
    if (doc.coverage) {
      const { topics_uncovered, competencies_uncovered, balance_warning } = doc.coverage
      const warnings = [
        ...topics_uncovered.map((t) => `Тема без оценочного средства: «${t}»`),
        ...competencies_uncovered.map((c) => `Компетенция не отражена в паспорте: «${c}»`),
        ...(balance_warning ? [balance_warning] : []),
      ]
      if (warnings.length > 0) {
        gap(4); ensure(20)
        pdf.font('sansB').fontSize(8).fillColor(C.warning).text('Замечания по покрытию', M, y); y += 12
        for (const w of warnings) { text(`⚠  ${w}`, 'sans', 9, C.ink2, { gap: 1 }); gap(2) }
      }
    }

    // ── ПАСПОРТ ФОС ────────────────────────────────────────────────────────
    sectionHeading('Паспорт ФОС')
    if (sections.passport.competencies.length > 0) {
      text(`Компетенции: ${sections.passport.competencies.join(', ')}`, 'sans', 9.5, C.ink2, { gap: 1.5 })
      gap(6)
    }
    const rowH = 16
    const topicW = CW * 0.4
    const instrW = CW - topicW
    ensure(rowH)
    pdf.font('sansB').fontSize(8.5).fillColor(C.ink3).text('Тема', M, y, { width: topicW })
    pdf.font('sansB').fontSize(8.5).fillColor(C.ink3).text('Оценочные средства', M + topicW, y, { width: instrW })
    y += rowH
    rule()
    for (const row of sections.passport.rows) {
      const label = row.instruments.length > 0 ? row.instruments.join('; ') : '— не покрыто —'
      const h = Math.max(rowH, pdf.font('sans').fontSize(9).heightOfString(label, { width: instrW }))
      ensure(h)
      pdf.font('sans').fontSize(9).fillColor(C.ink).text(row.topic, M, y, { width: topicW })
      pdf.font('sans').fontSize(9).fillColor(row.instruments.length > 0 ? C.ink2 : C.warning)
        .text(label, M + topicW, y, { width: instrW })
      y += h + 4
    }

    // ── ЭКЗАМЕНАЦИОННЫЕ БИЛЕТЫ ───────────────────────────────────────────
    if (sections.tickets.length > 0) {
      sectionHeading(`Экзаменационные билеты (${sections.tickets.length})`)
      for (const ticket of sections.tickets) {
        ensure(20)
        pdf.font('sansB').fontSize(10).fillColor(C.ink).text(`Билет №${ticket.number}`, M, y)
        y += 14
        ticket.theory_questions.forEach((q, i) => {
          text(`${i + 1}. ${q}`, 'sans', 9.5, C.ink2, { gap: 1, x: M + 12, w: CW - 12 })
          gap(2)
        })
        text(`Практическое задание: ${ticket.practical_task}`, 'sans', 9.5, C.ink2, { gap: 1, x: M + 12, w: CW - 12 })
        gap(8)
      }
    }

    // ── КРИТЕРИИ ОЦЕНИВАНИЯ ───────────────────────────────────────────────
    if (sections.criteria.length > 0) {
      sectionHeading('Критерии оценивания')
      for (const c of sections.criteria) {
        ensure(16)
        pdf.font('sansB').fontSize(10).fillColor(C.ink).text(c.title, M, y)
        y += 14
        for (const s of c.scale) {
          text(`${s.grade} — ${s.description}`, 'sans', 9, C.ink2, { gap: 1, x: M + 12, w: CW - 12 })
          gap(2)
        }
        gap(6)
      }
    }

    // ── FOOTERS ───────────────────────────────────────────────────────────
    const range = pdf.bufferedPageRange()
    const fy = H - 30
    for (let i = 0; i < range.count; i++) {
      pdf.switchToPage(range.start + i)
      const ob = pdf.page.margins.bottom
      pdf.page.margins.bottom = 0
      pdf.font('sans').fontSize(7.5).fillColor(C.ink3)
        .text('ИСПУМ', M, fy, { width: CW / 2, lineBreak: false })
      pdf.font('sans').fontSize(7.5).fillColor(C.ink3)
        .text(`${i + 1} / ${range.count}`, M + CW / 2, fy, { width: CW / 2, align: 'right', lineBreak: false })
      pdf.page.margins.bottom = ob
    }

    pdf.end()
  })
}
