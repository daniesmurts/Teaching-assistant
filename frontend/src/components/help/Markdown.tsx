import { ReactNode } from 'react'

// Lightweight markdown renderer for help articles, styled to the ИСПУМ design
// system. Supports: # ## ### headings, **bold**, *italic*, `code`, [links](url),
// - bullet / 1. numbered lists, > blockquotes, --- rules, and GFM pipe tables.
// (Self-contained — avoids a heavy/fragile remark dependency tree.)

const INLINE = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)/

function inline(text: string, kp: string): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let k = 0
  while (rest) {
    const m = INLINE.exec(rest)
    if (!m) { out.push(rest); break }
    if (m.index > 0) out.push(rest.slice(0, m.index))
    if (m[1]) {
      const url = m[3]
      out.push(<a key={kp + k} href={url} target={url.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="text-amber hover:underline">{m[2]}</a>)
    } else if (m[4]) {
      out.push(<strong key={kp + k} className="font-semibold text-ink">{m[5]}</strong>)
    } else if (m[6]) {
      out.push(<code key={kp + k} className="font-mono text-[12.5px] bg-surface-warm border border-border rounded px-1 py-0.5 text-ink">{m[7]}</code>)
    } else if (m[8]) {
      out.push(<em key={kp + k}>{m[9]}</em>)
    }
    rest = rest.slice(m.index + m[0].length)
    k++
  }
  return out
}

const splitRow = (line: string): string[] =>
  line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

const isSpecial = (l: string) => /^(#{1,3}\s|---+\s*$|\||>|\s*-\s|\s*\d+\.\s)/.test(l)

export default function Markdown({ children }: { children: string }) {
  const lines = children.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    // Heading
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      const content = inline(h[2], `h${key}-`)
      if (h[1].length === 1)      blocks.push(<h1 key={key} className="font-display text-2xl font-bold text-ink tracking-tight mt-8 mb-3 first:mt-0">{content}</h1>)
      else if (h[1].length === 2) blocks.push(<h2 key={key} className="font-display text-lg font-bold text-ink mt-8 mb-2">{content}</h2>)
      else                        blocks.push(<h3 key={key} className="font-sans text-sm font-semibold text-ink mt-5 mb-1.5">{content}</h3>)
      i++; key++; continue
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line.trim())) { blocks.push(<hr key={key} className="my-6 border-border" />); i++; key++; continue }

    // Table (header row + |---| separator)
    if (line.trim().startsWith('|') && i + 1 < lines.length && /-/.test(lines[i + 1]) && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++ }
      blocks.push(
        <div key={key} className="my-4 overflow-x-auto">
          <table className="w-full text-sm font-sans border border-border rounded-lg overflow-hidden">
            <thead className="bg-surface-warm"><tr>{header.map((c, ci) => <th key={ci} className="text-left px-3 py-2 text-xs font-semibold text-ink-secondary border-b border-border">{inline(c, `th${key}-${ci}-`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="px-3 py-2 text-ink border-b border-border align-top">{inline(c, `td${key}-${ri}-${ci}-`)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
      key++; continue
    }

    // Blockquote
    if (line.trim().startsWith('>')) {
      const q: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
      blocks.push(<blockquote key={key} className="border-l-2 border-amber bg-amber-light/40 rounded-r-md px-4 py-2 my-4 text-sm font-sans text-ink-secondary leading-relaxed">{inline(q.join(' '), `q${key}-`)}</blockquote>)
      key++; continue
    }

    // Unordered list
    if (/^\s*-\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*-\s+/, '')); i++ }
      blocks.push(<ul key={key} className="my-3 space-y-1.5">{items.map((it, ii) => <li key={ii} className="font-sans text-sm text-ink leading-relaxed flex gap-2"><span className="text-amber flex-shrink-0 select-none">•</span><span>{inline(it, `ul${key}-${ii}-`)}</span></li>)}</ul>)
      key++; continue
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++ }
      blocks.push(<ol key={key} className="my-3 space-y-1.5 list-decimal pl-5 marker:text-amber">{items.map((it, ii) => <li key={ii} className="font-sans text-sm text-ink leading-relaxed pl-1">{inline(it, `ol${key}-${ii}-`)}</li>)}</ol>)
      key++; continue
    }

    // Paragraph
    const para = [line]; i++
    while (i < lines.length && lines[i].trim() && !isSpecial(lines[i])) { para.push(lines[i]); i++ }
    blocks.push(<p key={key} className="font-sans text-sm text-ink leading-[1.75] my-3">{inline(para.join(' '), `p${key}-`)}</p>)
    key++
  }

  return <>{blocks}</>
}
