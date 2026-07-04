import path from 'path'
import type { ProgramDetail, ProgramAnalysis, CompetencyProgressionRow, CoverageLevel } from '../../../shared/types'

// pdfkit is imported lazily inside the generator so the rest of the backend
// boots even if the package isn't installed yet — only this endpoint depends on it.

// Server-rendered, premium PDF of the program-analysis report. Hand-laid with
// pdfkit (no headless Chrome — keeps us off Google infra, works offline on the
// Yandex VM). Embeds PT Serif + PT Sans (vendored, Cyrillic-native). The layout
// is fixed and brand-consistent, unlike the print-to-PDF of the web view.

// ── Design tokens (mirror frontend/src/index.css) ───────────────────────────────
const C = {
  ink:        '#1A1A1A',
  ink2:       '#6B6560',
  ink3:       '#A09890',
  amber:      '#C8860A',
  amberLight: '#FDF3DC',
  amberMid:   '#F4C55A',
  success:    '#2D7D46',
  successBg:  '#EBF7EF',
  warning:    '#9A6800',
  warningBg:  '#FEF6E0',
  danger:     '#C0392B',
  dangerBg:   '#FDF0EE',
  bg:         '#F7F5F0',
  surface:    '#FFFFFF',
  border:     '#E7E2D9',
  borderMid:  '#D8D2C6',
}

const LEVEL_FILL: Record<CoverageLevel, string> = {
  introduce: C.amberLight,
  develop:   C.amberMid,
  master:    C.success,
}
const LEVEL_LABEL: Record<CoverageLevel, string> = {
  introduce: 'Введение', develop: 'Развитие', master: 'Владение',
}
const STATUS_LABEL: Record<CompetencyProgressionRow['status'], string> = {
  ok: 'последовательно', thin: 'поверхностно', late: 'поздно', uncovered: 'не покрыто',
}

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts')
const FONTS = {
  serif:   path.join(FONT_DIR, 'PTSerif-Bold.ttf'),
  serifR:  path.join(FONT_DIR, 'PTSerif-Regular.ttf'),
  sans:    path.join(FONT_DIR, 'PTSans-Regular.ttf'),
  sansB:   path.join(FONT_DIR, 'PTSans-Bold.ttf'),
}

function scoreColor(s: number): string {
  return s >= 75 ? C.success : s >= 50 ? C.amber : C.danger
}

export async function generateProgramReportPdf(
  program: ProgramDetail,
  analysis: ProgramAnalysis
): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit')
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: {
      Title: `Анализ ОП — ${program.name}`,
      Author: 'ИСПУМ',
    } })

    doc.registerFont('serif',  FONTS.serif)
    doc.registerFont('serifR', FONTS.serifR)
    doc.registerFont('sans',   FONTS.sans)
    doc.registerFont('sansB',  FONTS.sansB)

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const M = 48
    const W = doc.page.width
    const H = doc.page.height
    const CW = W - M * 2            // content width
    const bottom = H - M - 24       // leave room for footer
    let y = M

    // ── primitives ───────────────────────────────────────────────────────────
    const ensure = (h: number) => { if (y + h > bottom) { doc.addPage(); y = M } }

    const text = (
      s: string, font: keyof typeof fontMap, size: number, color: string,
      opts: { x?: number; w?: number; align?: 'left' | 'center' | 'right'; gap?: number } = {}
    ) => {
      const x = opts.x ?? M
      const w = opts.w ?? CW
      doc.font(fontMap[font]).fontSize(size).fillColor(color)
      const h = doc.heightOfString(s, { width: w, align: opts.align, lineGap: opts.gap ?? 0 })
      ensure(h)
      doc.text(s, x, y, { width: w, align: opts.align, lineGap: opts.gap ?? 0 })
      y += h
    }

    const fontMap = { serif: 'serif', serifR: 'serifR', sans: 'sans', sansB: 'sansB' } as const

    const gap = (h: number) => { y += h }

    const rule = (color = C.border) => {
      ensure(8)
      doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(1).strokeColor(color).stroke()
      y += 1
    }

    const sectionHeading = (label: string) => {
      gap(18)
      ensure(28)
      // amber tick + serif heading
      doc.rect(M, y + 2, 3, 16).fill(C.amber)
      doc.font('serif').fontSize(15).fillColor(C.ink).text(label, M + 12, y, { width: CW - 12 })
      y += 22
      rule()
      gap(8)
    }

    // ── COVER HEADER ───────────────────────────────────────────────────────────
    // Parchment band with wordmark + document type.
    doc.rect(0, 0, W, 96).fill(C.bg)
    doc.font('serif').fontSize(17).fillColor(C.ink)
      .text('ИСПУМ', M, 30)
    const wmW = doc.widthOfString('ИСПУМ')
    doc.font('sans').fontSize(9).fillColor(C.amber)
      .text('Анализ архитектуры образовательной программы', M + wmW + 10, 36)
    doc.font('sans').fontSize(9).fillColor(C.ink3)
      .text(new Date(analysis.generated_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
        M, 30, { width: CW, align: 'right' })
    y = 116

    // Program title + meta
    text(program.name, 'serif', 24, C.ink, { gap: 2 })
    const meta = [
      program.code,
      program.profile,
      program.education_level,
      program.forms_of_study,
    ].filter(Boolean).join('  ·  ')
    if (meta) { gap(2); text(meta, 'sans', 10.5, C.ink2) }
    gap(10)

    // ── SCORE + VERDICT ─────────────────────────────────────────────────────────
    const scoreBoxH = 76
    ensure(scoreBoxH)
    doc.roundedRect(M, y, CW, scoreBoxH, 10).fill(C.bg)
    const sc = scoreColor(analysis.overall_score)
    // score disc
    const discX = M + 44, discY = y + scoreBoxH / 2
    doc.circle(discX, discY, 30).lineWidth(2).strokeColor(sc).stroke()
    doc.font('serif').fontSize(26).fillColor(sc)
      .text(String(analysis.overall_score), discX - 30, discY - 14, { width: 60, align: 'center' })
    doc.font('sans').fontSize(6.5).fillColor(C.ink3)
      .text('ИЗ 100', discX - 30, discY + 14, { width: 60, align: 'center', characterSpacing: 0.5 })
    // verdict text
    doc.font('sans').fontSize(11).fillColor(C.ink)
      .text(analysis.summary, M + 92, y + 16, { width: CW - 92 - 16, lineGap: 1.5 })
    y += scoreBoxH

    // ── WARNINGS (non-fatal issues from the analysis run) ────────────────────
    if (analysis.warnings && analysis.warnings.length > 0) {
      gap(10)
      ensure(20)
      doc.font('sansB').fontSize(8).fillColor(C.warning)
        .text('Часть анализа не завершилась', M, y)
      y += 12
      for (const w of analysis.warnings) {
        text(`⚠  ${w}`, 'sans', 9, C.ink2, { gap: 1 })
        gap(2)
      }
    }

    // ── OUTCOME DELIVERY (does the plan deliver the graduate profile?) ───────
    if (analysis.outcome_delivery) {
      const od = analysis.outcome_delivery
      const odColor = od.verdict === 'delivered' ? C.success : od.verdict === 'gaps' ? C.danger : C.warning
      const odLabel = od.verdict === 'delivered' ? 'Результаты обеспечены'
                    : od.verdict === 'gaps'      ? 'Есть необеспеченные результаты'
                    :                              'Обеспечены частично'
      gap(14)
      const boxH = 66
      ensure(boxH)
      doc.roundedRect(M, y, CW, boxH, 8).lineWidth(1).strokeColor(C.border).stroke()
      // score disc
      const odDiscX = M + 40, odDiscY = y + boxH / 2
      doc.circle(odDiscX, odDiscY, 22).lineWidth(1.5).strokeColor(odColor).stroke()
      doc.font('serif').fontSize(18).fillColor(odColor)
        .text(String(od.score), odDiscX - 22, odDiscY - 9, { width: 44, align: 'center' })
      doc.font('sansB').fontSize(8).fillColor(odColor).text(odLabel, M + 76, y + 12)
      doc.font('sans').fontSize(9).fillColor(C.ink2)
        .text(od.headline, M + 76, y + 26, { width: CW - 76 - 10, lineGap: 1 })
      // breakdown chips
      const chipY = y + boxH - 14
      let cx = M + 76
      const chip = (label: string, value: number, color: string) => {
        if (value === 0) return
        const s = `${value} ${label}`
        doc.font('sans').fontSize(7.5).fillColor(color).text(s, cx, chipY, { lineBreak: false })
        cx += doc.widthOfString(s) + 14
      }
      chip('полностью',    od.fully,     C.success)
      chip('поверхностно', od.thin,      C.warning)
      chip('поздно',       od.late,      C.warning)
      chip('не обеспечены', od.uncovered, C.danger)
      y += boxH
    }

    // ── STAT ROW ──────────────────────────────────────────────────────────────
    gap(14)
    const stats: { label: string; value: number; danger: boolean }[] = [
      { label: 'Нарушений порядка',       value: analysis.sequencing.inversions.length, danger: analysis.sequencing.inversions.length > 0 },
      { label: 'Не покрыто компетенций',  value: analysis.missing.length,                danger: analysis.missing.length > 0 },
      { label: 'Дисциплин без вклада',    value: analysis.orphans.length,                danger: analysis.orphans.length > 0 },
      { label: 'Тематических кластеров',  value: analysis.clusters.length,               danger: false },
    ]
    const sgap = 10
    const sw = (CW - sgap * (stats.length - 1)) / stats.length
    const sh = 56
    ensure(sh)
    stats.forEach((st, i) => {
      const sx = M + i * (sw + sgap)
      doc.roundedRect(sx, y, sw, sh, 8).lineWidth(1).strokeColor(C.border).stroke()
      doc.font('serif').fontSize(22).fillColor(st.danger ? C.danger : C.ink)
        .text(String(st.value), sx + 12, y + 10)
      doc.font('sans').fontSize(8).fillColor(C.ink2)
        .text(st.label, sx + 12, y + 38, { width: sw - 20 })
    })
    y += sh

    // ── SEQUENCING ──────────────────────────────────────────────────────────────
    const seq = analysis.sequencing
    sectionHeading('Последовательность и предпосылки')
    if (seq.verdict) text(seq.verdict, 'sans', 10.5, C.ink, { gap: 1.5 })

    // Whole-plan structure derived from the edges — foundational → профильные,
    // key prerequisite chains, and isolated disciplines. Compact list view.
    if (seq.structure && seq.structure.layers.length > 0) {
      gap(10)
      text('Дерево зависимостей — от фундаментальных к профильным', 'sansB', 9, C.ink2)
      gap(4)
      const s = seq.structure
      const maxDepth = s.layers.length ? s.layers[s.layers.length - 1].depth : 0
      const layerLabel = (d: number): string =>
        d === 0 ? 'Фундамент' : d === maxDepth ? 'Профильные' : `Уровень ${d + 1}`
      for (const layer of s.layers) {
        const names = layer.disciplines.map((d) => `${d.name} (сем. ${d.semester})`).join(', ')
        const line = `${layerLabel(layer.depth)}: ${names}`
        text(line, 'sans', 9, layer.depth === 0 ? C.amber : C.ink2, { gap: 1.5 })
        gap(2)
      }
      if (s.longest_chains.length > 0) {
        gap(4)
        text('Ключевые цепочки предпосылок', 'sansB', 8.5, C.ink2)
        gap(3)
        for (const ch of s.longest_chains) {
          text('·  ' + ch.names.join('  →  '), 'sans', 9, C.ink2, { gap: 1 })
        }
      }
    }
    if (seq.inversions.length > 0) {
      gap(8)
      text('Нарушения порядка', 'sansB', 9, C.danger)
      gap(4)
      for (const e of seq.inversions.slice(0, 8)) {
        const head = `${e.from_name} (сем. ${e.from_semester})  →  ${e.to_name} (сем. ${e.to_semester})`
        const recH = e.recommendation ? doc.font('sans').fontSize(9).heightOfString(e.recommendation, { width: CW - 24 }) : 0
        const reaH = e.reason ? doc.font('sans').fontSize(9).heightOfString(e.reason, { width: CW - 24 }) : 0
        const boxH = 20 + reaH + (e.recommendation ? recH + 4 : 0) + 10
        ensure(boxH)
        doc.roundedRect(M, y, CW, boxH, 6).fill(C.dangerBg)
        doc.font('sansB').fontSize(9.5).fillColor(C.ink).text(head, M + 12, y + 8, { width: CW - 24 })
        let yy = y + 8 + 14
        if (e.reason) { doc.font('sans').fontSize(9).fillColor(C.ink2).text(e.reason, M + 12, yy, { width: CW - 24 }); yy += reaH + 2 }
        if (e.recommendation) {
          doc.font('sansB').fontSize(9).fillColor(C.amber).text('Рекомендация: ', M + 12, yy, { continued: true })
          doc.font('sans').fontSize(9).fillColor(C.ink).text(e.recommendation, { width: CW - 24 })
        }
        y += boxH
        gap(6)
      }
    }
    const goodEdges = seq.edges.filter((e) => !e.inverted).slice(0, 14)
    if (goodEdges.length > 0) {
      gap(6)
      text(`Обоснованные связи (${goodEdges.length})`, 'sansB', 9, C.ink2)
      gap(4)
      for (const e of goodEdges) {
        const line = `${e.from_name} → ${e.to_name}`
        ensure(13)
        doc.font('sans').fontSize(9).fillColor(C.ink3).text('·  ', M, y, { continued: true })
        doc.font('sans').fontSize(9).fillColor(C.ink2).text(line, { width: CW - 12 })
        y = doc.y + 1
      }
    }

    // ── COMPETENCY PROGRESSION HEATMAP ───────────────────────────────────────────
    if (analysis.progression.length > 0) {
      sectionHeading('Формирование компетенций по семестрам')
      const duration = Math.max(8, ...analysis.load.map((l) => l.semester))
      const labelW = 232
      const statusW = 78
      const gridW = CW - labelW - statusW
      const cellW = gridW / duration
      const rowH = 17

      // Trim a string to fit maxW at the given font/size (adds an ellipsis).
      // Guarantees a single line so rows never wrap and misalign.
      const fitLabel = (s: string, maxW: number, font: 'sans' | 'sansB', size: number): string => {
        doc.font(fontMap[font]).fontSize(size)
        if (doc.widthOfString(s) <= maxW) return s
        let t = s
        while (t.length > 1 && doc.widthOfString(t + '…') > maxW) t = t.slice(0, -1)
        return t.replace(/\s+$/, '') + '…'
      }

      const drawColHeader = () => {
        ensure(rowH)
        doc.font('sansB').fontSize(7.5).fillColor(C.ink3)
        for (let s = 1; s <= duration; s++) {
          doc.text(String(s), M + labelW + (s - 1) * cellW, y + 4, { width: cellW, align: 'center' })
        }
        doc.text('Статус', M + labelW + gridW, y + 4, { width: statusW, align: 'right' })
        y += rowH
        doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.75).strokeColor(C.border).stroke()
      }
      drawColHeader()

      for (const row of analysis.progression) {
        ensure(rowH)
        if (y === M) drawColHeader()   // grid spilled to a new page — repeat the header
        const bySem = new Map(row.cells.map((c) => [c.semester, c]))
        // row label (uncovered → danger tint) — single line, never spills into the grid
        if (row.status === 'uncovered') doc.rect(M, y, labelW - 6, rowH).fill(C.dangerBg)
        const labelY = y + 4.5
        if (row.code) {
          doc.font('sansB').fontSize(8).fillColor(row.status === 'uncovered' ? C.danger : C.ink)
            .text(row.code, M, labelY, { lineBreak: false })
          doc.font('sans').fontSize(8).fillColor(C.ink2)
            .text(fitLabel(row.title, labelW - 44 - 8, 'sans', 8), M + 44, labelY, { lineBreak: false })
        } else {
          doc.font('sansB').fontSize(8).fillColor(C.ink)
            .text(fitLabel(row.title, labelW - 8, 'sansB', 8), M, labelY, { lineBreak: false })
        }
        // cells
        for (let s = 1; s <= duration; s++) {
          const cx = M + labelW + (s - 1) * cellW
          const cell = bySem.get(s)
          if (cell) {
            doc.roundedRect(cx + 1.5, y + 2.5, cellW - 3, rowH - 5, 2).fill(LEVEL_FILL[cell.level])
          } else {
            doc.roundedRect(cx + 1.5, y + 2.5, cellW - 3, rowH - 5, 2).fill('#F1ECE3')
          }
        }
        // status word
        const stColor = row.status === 'uncovered' ? C.danger : row.status === 'ok' ? C.success : C.warning
        doc.font('sans').fontSize(7.5).fillColor(stColor)
          .text(STATUS_LABEL[row.status], M + labelW + gridW, y + 4.5, { width: statusW, align: 'right' })
        y += rowH
        doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.4).strokeColor(C.border).stroke()
      }
      // legend
      gap(8)
      ensure(14)
      let lx = M
      ;(['introduce', 'develop', 'master'] as CoverageLevel[]).forEach((lv) => {
        doc.roundedRect(lx, y, 10, 10, 2).fill(LEVEL_FILL[lv])
        doc.font('sans').fontSize(8).fillColor(C.ink2).text(LEVEL_LABEL[lv], lx + 14, y + 1)
        lx += 14 + doc.widthOfString(LEVEL_LABEL[lv]) + 22
      })
      y += 12
    }

    // ── GAPS & REDUNDANCY ─────────────────────────────────────────────────────────
    if (analysis.missing.length > 0 || analysis.orphans.length > 0) {
      sectionHeading('Пробелы и избыточность')
      // When few disciplines declare their competencies, «не покрыто» is
      // inferred from names and may be a mapping gap rather than a real one.
      if (analysis.mapping_confidence?.low && analysis.missing.length > 0) {
        const mc = analysis.mapping_confidence
        const line = `Заявленные компетенции указаны лишь у ${mc.disciplines_with_codes} из ${mc.disciplines_total} дисциплин. Часть пунктов «не покрыто» может отражать неполное сопоставление, а не реальный пробел.`
        text(line, 'sans', 8.5, C.warning, { gap: 2 })
        gap(6)
      }
      gapColumns(
        doc, M, y, CW,
        { title: 'Компетенции без дисциплины', tone: C.danger, items: analysis.missing.slice(0, 10) },
        { title: 'Дисциплины без вклада', tone: C.warning, items: analysis.orphans.slice(0, 10) },
        (ny) => { y = ny }, ensure, fontMap, C
      )
    }

    // ── RELATEDNESS & LOAD ────────────────────────────────────────────────────────
    sectionHeading('Связность и нагрузка')
    if (analysis.clusters.length > 0) {
      text('Тематические кластеры', 'sansB', 9, C.ink); gap(4)
      for (const cl of analysis.clusters.slice(0, 8)) {
        text(`·  ${cl.disciplines.join('  ·  ')}`, 'sans', 9, C.ink2, { gap: 1 })
        gap(2)
      }
    }
    if (analysis.isolated.length > 0) {
      gap(4)
      text('Слабо связаны с планом', 'sansB', 8.5, C.warning); gap(3)
      text(analysis.isolated.join(', '), 'sans', 9, C.ink2)
    }
    // load bars
    gap(10)
    text('Нагрузка по семестрам', 'sansB', 9, C.ink); gap(6)
    const maxLoad = Math.max(1, ...analysis.load.map((l) => l.credits ?? l.discipline_count))
    const barLabelW = 60, barValW = 70, barTrackW = CW - barLabelW - barValW
    for (const l of analysis.load) {
      ensure(15)
      doc.font('sans').fontSize(8.5).fillColor(C.ink3).text(`Сем. ${l.semester}`, M, y + 1, { width: barLabelW })
      doc.roundedRect(M + barLabelW, y + 1, barTrackW, 8, 4).fill('#EDE7DC')
      const frac = (l.credits ?? l.discipline_count) / maxLoad
      if (frac > 0) doc.roundedRect(M + barLabelW, y + 1, Math.max(4, barTrackW * frac), 8, 4).fill(C.amberMid)
      const vlabel = l.credits != null ? `${l.credits} з.е.` : `${l.discipline_count} дисц.`
      doc.font('sans').fontSize(8).fillColor(C.ink2).text(vlabel, M + barLabelW + barTrackW + 8, y + 1, { width: barValW - 8, align: 'right' })
      y += 14
    }
    // Load-check caveats — the chart just sums extracted ЗЕТ, so flag when the
    // numbers contradict the ФГОС 60-з.е./year rule or the plan's own Итого.
    if (analysis.load_check && analysis.load_check.issues.length > 0) {
      gap(8)
      text('Проверка нагрузки', 'sansB', 9, C.warning); gap(4)
      for (const it of analysis.load_check.issues) {
        text(`⚠  ${it}`, 'sans', 8.5, C.ink2, { gap: 1 })
        gap(2)
      }
      gap(2)
      text('График суммирует ЗЕТ, распознанные из PDF. Проверьте семестры и ЗЕТ дисциплин в Конструкторе и перезапустите анализ.',
        'sans', 8, C.ink3, { gap: 1 })
    }

    // ── FOOTERS (buffered) ────────────────────────────────────────────────────────
    // Footers — drop the bottom margin to 0 while writing so a line near the page
    // edge doesn't trigger pdfkit to append a blank page.
    const range = doc.bufferedPageRange()
    const fy = H - 30
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i)
      const ob = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      doc.font('sans').fontSize(7.5).fillColor(C.ink3)
        .text('ИСПУМ · gradeassist', M, fy, { width: CW / 2, lineBreak: false })
      doc.font('sans').fontSize(7.5).fillColor(C.ink3)
        .text(`${i + 1} / ${range.count}`, M + CW / 2, fy, { width: CW / 2, align: 'right', lineBreak: false })
      doc.page.margins.bottom = ob
    }

    doc.end()
  })
}

// Two-column gap/redundancy block. Kept outside the closure for readability;
// receives the doc + cursor and reports the new y back via setY.
function gapColumns(
  doc: PDFKit.PDFDocument, M: number, y0: number, CW: number,
  left: { title: string; tone: string; items: { name: string; recommendation: string }[] },
  right: { title: string; tone: string; items: { name: string; recommendation: string }[] },
  setY: (y: number) => void,
  ensure: (h: number) => void,
  fontMap: Record<string, string>,
  C: Record<string, string>,
): void {
  const colGap = 14
  const colW = (CW - colGap) / 2
  const startY = y0

  const renderCol = (x: number, col: typeof left): number => {
    let yy = startY
    doc.font(fontMap.sansB).fontSize(8.5).fillColor(col.tone).text(col.title.toUpperCase(), x, yy, { width: colW, characterSpacing: 0.3 })
    yy = doc.y + 4
    if (col.items.length === 0) {
      doc.font(fontMap.sans).fontSize(9).fillColor(C.ink3).text('—', x, yy); return doc.y
    }
    for (const it of col.items) {
      doc.font(fontMap.sansB).fontSize(9.5).fillColor(C.ink).text(it.name, x, yy, { width: colW })
      yy = doc.y
      if (it.recommendation) {
        doc.font(fontMap.sans).fontSize(8.5).fillColor(C.ink2).text(it.recommendation, x, yy, { width: colW, lineGap: 1 })
        yy = doc.y
      }
      yy += 6
    }
    return yy
  }

  // Estimate height roughly and page-break if needed before drawing both columns.
  ensure(40)
  const leftEnd  = renderCol(M, left)
  const rightEnd = renderCol(M + colW + colGap, right)
  setY(Math.max(leftEnd, rightEnd) + 4)
}
