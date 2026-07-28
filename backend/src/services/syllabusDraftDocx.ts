import type { SyllabusSection } from '../../../shared/types'

// Renders a РПД-студия draft to a real, editable .docx — path B of
// docs/RPD-WORKFLOW.md §2.1 ("Сдать из РПД-студии"). docx is imported
// lazily so the backend boots without it installed, same posture as
// fosExport.ts / programReportPdf.ts.

export async function generateSyllabusDraftDocx(
  disciplineName: string,
  sections: SyllabusSection[],
): Promise<Buffer> {
  const { Document, Paragraph, TextRun, HeadingLevel, Packer } = await import('docx')

  const children = [
    new Paragraph({ text: 'Рабочая программа дисциплины', heading: HeadingLevel.TITLE, spacing: { after: 100 } }),
    new Paragraph({ text: disciplineName, heading: HeadingLevel.HEADING_2, spacing: { after: 300 } }),
  ]
  for (const s of sections) {
    children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 150 } }))
    for (const line of s.content.split('\n').filter((l) => l.trim())) {
      children.push(new Paragraph({ children: [new TextRun(line)], spacing: { after: 80 } }))
    }
  }

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBuffer(doc)
}
