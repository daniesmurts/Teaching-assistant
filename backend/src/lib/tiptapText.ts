// Extract plain text from a TipTap / ProseMirror JSON document.
// Used to validate a draft is non-empty on submit, and (Q4) to materialise a
// gradeable submission_text from the stored draft.

interface ProseMirrorNode {
  type?: string
  text?: string
  content?: ProseMirrorNode[]
}

// Block-level node types after which we insert a newline, so paragraphs and
// list items don't run together when flattened to text.
const BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'horizontalRule',
])

export function tiptapToText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return ''
  const out: string[] = []

  const walk = (node: ProseMirrorNode) => {
    if (typeof node.text === 'string') out.push(node.text)
    if (Array.isArray(node.content)) node.content.forEach(walk)
    if (node.type && BLOCK_TYPES.has(node.type)) out.push('\n')
  }

  walk(doc as ProseMirrorNode)
  return out.join('').replace(/\n{3,}/g, '\n\n').trim()
}

export function tiptapCharCount(doc: unknown): number {
  return tiptapToText(doc).length
}
