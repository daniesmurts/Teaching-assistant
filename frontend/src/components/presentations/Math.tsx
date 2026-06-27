import katex from 'katex'

// Render a LaTeX string with KaTeX. Two flavours:
//   <BlockMath latex="P = \rho g Q H" />
//   <InlineText text="Подача $Q$ задаётся..." />
//
// InlineText is the workhorse — slides have prose mixed with $inline$ math,
// and we render exactly that without forcing the caller to pre-split.

interface BlockProps {
  latex: string
}

export function BlockMath({ latex }: BlockProps) {
  const html = renderSafe(latex, true)
  return (
    <div
      className="katex-block my-2 text-center"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

interface InlineProps {
  text: string
}

// Splits `text` on $...$ math runs (and $$...$$ blocks, rendered inline) and
// renders each piece. Non-math segments pass through as plain text so React
// keeps escaping them. Unmatched $ gets rendered literally.
export function InlineText({ text }: InlineProps) {
  const parts = parseMixed(text)
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'math'
          ? <span
              key={i}
              className="katex-inline"
              dangerouslySetInnerHTML={{ __html: renderSafe(p.body, p.block) }}
            />
          : <span key={i}>{p.body}</span>
      )}
    </>
  )
}

// ── Parsing ─────────────────────────────────────────────────────────────────

interface Segment {
  kind:  'text' | 'math'
  body:  string
  block: boolean   // true for $$...$$
}

function parseMixed(text: string): Segment[] {
  const out: Segment[] = []
  let i = 0
  while (i < text.length) {
    const dollar = text.indexOf('$', i)
    if (dollar === -1) {
      out.push({ kind: 'text', body: text.slice(i), block: false })
      break
    }
    if (dollar > i) {
      out.push({ kind: 'text', body: text.slice(i, dollar), block: false })
    }
    // $$...$$ block math
    if (text[dollar + 1] === '$') {
      const close = text.indexOf('$$', dollar + 2)
      if (close === -1) {
        // Unterminated — bail to literal text so we don't eat the rest of the slide.
        out.push({ kind: 'text', body: text.slice(dollar), block: false })
        break
      }
      out.push({ kind: 'math', body: text.slice(dollar + 2, close), block: true })
      i = close + 2
      continue
    }
    // $...$ inline math
    const close = text.indexOf('$', dollar + 1)
    if (close === -1) {
      out.push({ kind: 'text', body: text.slice(dollar), block: false })
      break
    }
    out.push({ kind: 'math', body: text.slice(dollar + 1, close), block: false })
    i = close + 1
  }
  return out
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderSafe(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      // Don't pretend bad LaTeX is fine — render the raw source in red so the
      // teacher knows to edit. Better than silently dropping content.
      errorColor: '#C0392B',
      strict: 'ignore',
      output: 'html',
    })
  } catch {
    // throwOnError:false already keeps us out of this branch, but keep a
    // last-resort fallback so a malformed string can't crash the slide.
    return `<span style="color:#C0392B">${escapeHtml(latex)}</span>`
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
