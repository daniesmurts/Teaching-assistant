import { logger } from '../lib/logger'

// Recovers OOXML math (`<m:oMath>`, the format Word's Equation Editor
// writes) as LaTeX, so a teacher's uploaded conspectus keeps its formulas
// instead of them silently vanishing — mammoth.extractRawText() (the
// existing DOCX path in documentExtractor.ts) has no concept of `m:oMath`
// at all and just drops it, which is exactly what a teacher hit pasting her
// notes into the presentation form's plain-text field (paste can only ever
// carry a Word equation object's plain-text clipboard flavour, which is
// empty — this fixes it at the source by reading the docx's own XML instead
// of relying on the clipboard).
//
// Recovered formulas are wrapped `$...$` (inline `m:oMath`) or `$$...$$`
// (block `m:oMathPara`) — the same delimiters cleanForSlide()/KaTeX in the
// web viewer and the LaTeX prompt in presentations.ts already expect.

// ─── Minimal preserveOrder-tree helpers ────────────────────────────────────
//
// fast-xml-parser's `preserveOrder` mode represents each element as an
// object with exactly one non-`:@` key (the tag name, prefixed exactly as
// written — "w:p", "m:oMath", ...) mapped to its children array; attributes
// (when present) sit under a sibling `:@` key. Real-world .docx files are
// always produced by Word/LibreOffice, both of which consistently bind the
// `w:`/`m:` prefixes to the standard OOXML namespaces, so matching on the
// literal prefixed tag name (rather than resolving namespace URIs) is a
// pragmatic simplification — good enough for actual teacher-authored files,
// not a general-purpose OOXML parser.
type XNode = Record<string, unknown>

function tagName(node: XNode): string | null {
  const keys = Object.keys(node).filter((k) => k !== ':@' && k !== '#text')
  return (keys[0] as string) ?? null
}

function children(node: XNode): XNode[] {
  const name = tagName(node)
  if (!name) return []
  const kids = node[name]
  return Array.isArray(kids) ? (kids as XNode[]) : []
}

function attrs(node: XNode): Record<string, string> {
  return (node[':@'] as Record<string, string>) ?? {}
}

function textOf(node: XNode): string {
  const t = node['#text']
  return typeof t === 'string' ? t : ''
}

// Skip OOXML "properties" nodes (m:fPr, m:dPr, w:pPr, ...) when walking —
// they describe formatting/layout, not content, and this convention (any
// tag ending "Pr") covers every properties element without enumerating them.
function isContentChild(node: XNode): boolean {
  const name = tagName(node)
  return !!name && !name.endsWith('Pr')
}

function childByTag(node: XNode, tag: string): XNode | null {
  return children(node).find((c) => tagName(c) === tag) ?? null
}

/** All `#text` under a node, depth-first — the fallback for any element this converter doesn't specifically understand. */
function collectText(node: XNode): string {
  const name = tagName(node)
  if (!name) return textOf(node)
  return children(node).map(collectText).join('')
}

/** `<m:xPr><m:prop m:val="..."/></m:xPr>` — reads `prop`'s `m:val` attribute, defaulting when the whole chain is absent. */
function getPropVal(node: XNode, propsTag: string, propTag: string, def: string): string {
  const props = childByTag(node, propsTag)
  if (!props) return def
  const prop = childByTag(props, propTag)
  if (!prop) return def
  return attrs(prop)['@_m:val'] ?? def
}

// ─── OMML → LaTeX ───────────────────────────────────────────────────────────

const NARY_OPS: Record<string, string> = {
  '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint',
  '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap', '⋁': '\\bigvee', '⋀': '\\bigwedge',
}

const ACCENT_LATEX: Record<string, string> = {
  '→': '\\vec', '⃗': '\\vec', '^': '\\hat', '.': '\\dot', '..': '\\ddot',
  '~': '\\tilde', '‾': '\\overline', '´': '\\acute', '`': '\\grave',
}

const KNOWN_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'lim', 'max', 'min', 'det', 'exp', 'gcd',
  'arcsin', 'arccos', 'arctan',
])

function delimiterCommand(chr: string): string {
  const known = new Set(['(', ')', '[', ']', '{', '}', '|', '‖'])
  if (!known.has(chr)) return chr || '.'
  return chr === '{' ? '\\{' : chr === '}' ? '\\}' : chr
}

function walk(node: XNode): string {
  const name = tagName(node)
  if (!name) return textOf(node)

  if (name === 'm:t') return collectText(node)
  if (name === 'm:r') {
    return children(node).filter((c) => tagName(c) === 'm:t').map(collectText).join('')
  }

  // Transparent containers — just concatenate their content children.
  if (['m:e', 'm:num', 'm:den', 'm:sub', 'm:sup', 'm:deg', 'm:lim', 'm:fName', 'm:oMath'].includes(name)) {
    return children(node).filter(isContentChild).map(walk).join('')
  }

  switch (name) {
    case 'm:f': {
      const num = childByTag(node, 'm:num')
      const den = childByTag(node, 'm:den')
      return `\\frac{${num ? walk(num) : ''}}{${den ? walk(den) : ''}}`
    }
    case 'm:sSup': {
      const e = childByTag(node, 'm:e'); const sup = childByTag(node, 'm:sup')
      return `${e ? walk(e) : ''}^{${sup ? walk(sup) : ''}}`
    }
    case 'm:sSub': {
      const e = childByTag(node, 'm:e'); const sub = childByTag(node, 'm:sub')
      return `${e ? walk(e) : ''}_{${sub ? walk(sub) : ''}}`
    }
    case 'm:sSubSup': {
      const e = childByTag(node, 'm:e'); const sub = childByTag(node, 'm:sub'); const sup = childByTag(node, 'm:sup')
      return `${e ? walk(e) : ''}_{${sub ? walk(sub) : ''}}^{${sup ? walk(sup) : ''}}`
    }
    case 'm:rad': {
      const e = childByTag(node, 'm:e')
      const degHide = getPropVal(node, 'm:radPr', 'm:degHide', '0')
      const deg = childByTag(node, 'm:deg')
      const degLatex = deg ? walk(deg) : ''
      return (degHide === '1' || degHide === 'on' || !degLatex.trim())
        ? `\\sqrt{${e ? walk(e) : ''}}`
        : `\\sqrt[${degLatex}]{${e ? walk(e) : ''}}`
    }
    case 'm:d': {
      const beg = delimiterCommand(getPropVal(node, 'm:dPr', 'm:begChr', '('))
      const end = delimiterCommand(getPropVal(node, 'm:dPr', 'm:endChr', ')'))
      const args = children(node).filter((c) => tagName(c) === 'm:e').map(walk)
      return `\\left${beg}${args.join(', ')}\\right${end}`
    }
    case 'm:bar': {
      const e = childByTag(node, 'm:e')
      const pos = getPropVal(node, 'm:barPr', 'm:pos', 'top')
      return pos === 'bot' ? `\\underline{${e ? walk(e) : ''}}` : `\\overline{${e ? walk(e) : ''}}`
    }
    case 'm:acc': {
      const e = childByTag(node, 'm:e')
      const chr = getPropVal(node, 'm:accPr', 'm:chr', '‾')
      const cmd = ACCENT_LATEX[chr] ?? '\\overline'
      return `${cmd}{${e ? walk(e) : ''}}`
    }
    case 'm:nary': {
      const chr = getPropVal(node, 'm:naryPr', 'm:chr', '∫')
      const subHide = getPropVal(node, 'm:naryPr', 'm:subHide', '0')
      const supHide = getPropVal(node, 'm:naryPr', 'm:supHide', '0')
      const sub = childByTag(node, 'm:sub'); const sup = childByTag(node, 'm:sup'); const e = childByTag(node, 'm:e')
      const op = NARY_OPS[chr] ?? chr
      const subPart = (subHide === '1' || subHide === 'on' || !sub) ? '' : `_{${walk(sub)}}`
      const supPart = (supHide === '1' || supHide === 'on' || !sup) ? '' : `^{${walk(sup)}}`
      return `${op}${subPart}${supPart} ${e ? walk(e) : ''}`
    }
    case 'm:func': {
      const fName = childByTag(node, 'm:fName')
      const e = childByTag(node, 'm:e')
      const nameText = (fName ? walk(fName) : '').trim()
      const body = e ? walk(e) : ''
      return KNOWN_FUNCTIONS.has(nameText) ? `\\${nameText}{${body}}` : `\\operatorname{${nameText}}(${body})`
    }
    case 'm:limLow': {
      const e = childByTag(node, 'm:e'); const lim = childByTag(node, 'm:lim')
      return `${e ? walk(e) : ''}_{${lim ? walk(lim) : ''}}`
    }
    case 'm:limUpp': {
      const e = childByTag(node, 'm:e'); const lim = childByTag(node, 'm:lim')
      return `${e ? walk(e) : ''}^{${lim ? walk(lim) : ''}}`
    }
    case 'm:groupChr': {
      const e = childByTag(node, 'm:e')
      const pos = getPropVal(node, 'm:groupChrPr', 'm:pos', 'bot')
      return pos === 'top' ? `\\overbrace{${e ? walk(e) : ''}}` : `\\underbrace{${e ? walk(e) : ''}}`
    }
    case 'm:eqArr': {
      const rows = children(node).filter((c) => tagName(c) === 'm:e').map(walk)
      return `\\begin{gathered}${rows.join(' \\\\ ')}\\end{gathered}`
    }
    case 'm:m': {
      const rows = children(node).filter((c) => tagName(c) === 'm:mr')
        .map((row) => children(row).filter((c) => tagName(c) === 'm:e').map(walk).join(' & '))
      return `\\begin{matrix}${rows.join(' \\\\ ')}\\end{matrix}`
    }
    default: {
      // Unknown OMML construct — recurse into content children if any exist,
      // otherwise fall back to raw text. Never drop the node silently: the
      // whole point of this converter is "degrade gracefully", not "vanish".
      const kids = children(node).filter(isContentChild)
      return kids.length ? kids.map(walk).join('') : collectText(node)
    }
  }
}

/** Converts a single `<m:oMath>` node's content to a LaTeX string (no surrounding `$`). */
export function ommlNodeToLatex(oMathNode: XNode): string {
  return children(oMathNode).filter(isContentChild).map(walk).join('').trim()
}

// ─── Paragraph/body walker — produces plain text with formulas inlined ─────

function escapeDollar(s: string): string {
  return s.replace(/\$/g, '\\$')
}

function walkRun(node: XNode): string {
  return children(node).map((c) => {
    const n = tagName(c)
    if (n === 'w:t') return collectText(c)
    if (n === 'w:tab') return '\t'
    if (n === 'w:br' || n === 'w:cr') return '\n'
    return ''
  }).join('')
}

function walkParagraphChild(node: XNode, onFormula: (n: number) => void): string {
  const name = tagName(node)
  if (!name) return ''
  if (name.endsWith('Pr')) return ''
  if (name === 'w:r') return walkRun(node)
  if (name === 'm:oMath') {
    const latex = ommlNodeToLatex(node)
    onFormula(1)
    return latex ? ` $${escapeDollar(latex)}$ ` : ''
  }
  if (name === 'm:oMathPara') {
    const maths = children(node).filter((c) => tagName(c) === 'm:oMath')
    onFormula(maths.length)
    return maths.map((m) => {
      const latex = ommlNodeToLatex(m)
      return latex ? `\n$$${escapeDollar(latex)}$$\n` : ''
    }).join('')
  }
  // Transparent wrapper (w:hyperlink, tracked-change w:ins/w:del, w:smartTag, ...) — recurse.
  return children(node).map((c) => walkParagraphChild(c, onFormula)).join('')
}

function walkParagraph(pNode: XNode, onFormula: (n: number) => void): string {
  return children(pNode).map((c) => walkParagraphChild(c, onFormula)).join('')
}

function walkTable(tblNode: XNode, onFormula: (n: number) => void): string {
  const rows = children(tblNode).filter((c) => tagName(c) === 'w:tr')
  return rows.map((row) => {
    const cells = children(row).filter((c) => tagName(c) === 'w:tc')
    return cells.map((cell) =>
      children(cell).filter((c) => tagName(c) === 'w:p').map((p) => walkParagraph(p, onFormula)).join(' '),
    ).join(' | ')
  }).join('\n')
}

export interface DocxExtraction {
  text:         string
  formulaCount: number
}

/**
 * Reads word/document.xml directly (bypassing mammoth) so `m:oMath`/
 * `m:oMathPara` formulas survive as `$...$`/`$$...$$` LaTeX instead of being
 * dropped. Returns null on anything unexpected (missing part, parse
 * failure) so the caller can fall back to mammoth.extractRawText() —
 * this never needs to be the *only* way to read a docx, just a better one
 * when it succeeds.
 */
export async function extractDocxTextWithFormulas(buffer: Buffer): Promise<DocxExtraction | null> {
  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buffer)
    const documentXmlFile = zip.file('word/document.xml')
    if (!documentXmlFile) return null
    const xml = await documentXmlFile.async('string')

    const { XMLParser } = await import('fast-xml-parser')
    const parser = new XMLParser({
      preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '@_',
      // A formula's text runs are frequently just digits ("2", "0") or look
      // numeric ("2.9") — without this, fast-xml-parser silently coerces
      // them to JS numbers, and textOf()'s `typeof t === 'string'` check
      // then drops them entirely (e.g. `x^2` → `x^{}`).
      parseTagValue: false,
    })
    const parsed = parser.parse(xml) as XNode[]

    const root = parsed.find((n) => tagName(n) === 'w:document')
    const body = root && childByTag(root, 'w:body')
    if (!body) return null

    let formulaCount = 0
    const onFormula = (n: number) => { formulaCount += n }

    const parts: string[] = []
    for (const node of children(body)) {
      const name = tagName(node)
      if (name === 'w:p') parts.push(walkParagraph(node, onFormula))
      else if (name === 'w:tbl') parts.push(walkTable(node, onFormula))
    }

    const text = parts.map((p) => p.trim()).filter(Boolean).join('\n\n')
    return { text, formulaCount }
  } catch (err) {
    logger.warn({ message: '[docx] custom text+formula extraction failed, falling back to mammoth', error: (err as Error).message })
    return null
  }
}
