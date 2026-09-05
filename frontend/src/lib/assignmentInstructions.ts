// Assignment instructions arrive as plain text — typed by the teacher, or
// generated from a lecture's discussion slides (buildAssignmentFromDeck). The
// page used to render them in a single `whitespace-pre-wrap` paragraph, so a
// numbered question, its sub-questions and the closing sentence all came out
// at the same size, weight and colour, with indentation made of literal
// spaces. On a phone that is a wall of grey text — and it is the one thing on
// the page a student has to read carefully before writing.
//
// This turns that text into blocks the page can render with real hierarchy.
// It is deliberately forgiving: instructions typed by hand are not a format,
// so anything unrecognised stays a paragraph rather than being dropped or
// mangled.

export interface QuestionBlock {
  kind:    'question'
  number:  string
  text:    string
  prompts: string[]
}

export interface ParagraphBlock {
  kind: 'paragraph'
  text: string
}

export type InstructionBlock = QuestionBlock | ParagraphBlock

// "1. …" / "2) …" — the numbering both the generator and teachers use.
const NUMBERED = /^\s*(\d{1,2})[.)]\s+(.+)$/
// "— …" / "– …" / "- …", optionally indented: a sub-question under the last one.
const BULLET   = /^\s*[—–-]\s+(.+)$/

export function parseInstructions(raw: string): InstructionBlock[] {
  const blocks: InstructionBlock[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ').trim() })
    paragraph = []
  }

  for (const line of raw.split('\n')) {
    if (!line.trim()) { flushParagraph(); continue }

    const numbered = line.match(NUMBERED)
    if (numbered) {
      flushParagraph()
      blocks.push({ kind: 'question', number: numbered[1], text: numbered[2].trim(), prompts: [] })
      continue
    }

    const bullet = line.match(BULLET)
    if (bullet) {
      const last = blocks[blocks.length - 1]
      // A dash line only belongs to a question when it directly follows one —
      // and paragraph text must not have been started since, or a stray dash in
      // prose would silently reattach itself to a question above it.
      if (last && last.kind === 'question' && paragraph.length === 0) {
        last.prompts.push(bullet[1].trim())
      } else {
        flushParagraph()
        blocks.push({ kind: 'paragraph', text: bullet[1].trim() })
      }
      continue
    }

    // A wrapped continuation line joins the paragraph rather than becoming its
    // own — hard-wrapped text pasted from Word is otherwise rendered as a
    // stack of one-line paragraphs.
    paragraph.push(line.trim())
  }

  flushParagraph()
  return blocks
}
