// Parser for fgosvo.ru's ФГОС ВО (3++) listing pages. Powers bulk ФГОС
// import (extends TODO.md Feature AA): the admin pastes one top-level
// listing URL (e.g. https://fgosvo.ru/fgosvo/index/24 for bachelor's) →
// the backend crawls every subject-area category page linked from it →
// returns a flat checklist of every направление's PDF.
//
// Unlike svedenParser.ts's target (a Рособрнадзор-mandated, machine-readable
// itemprop schema every university must publish), fgosvo.ru is a single
// fixed site we don't control the markup of — there's no mandated schema to
// lean on. Verified directly against a real fetch (2026-07-22): both the
// top listing page and each category page render every row as a
// `<div class="item d-flex" data-key="…">…</div>` block, never nested
// inside another such block. That repeating, non-nesting marker is what
// makes tag-level regex parsing safe here (same trick svedenParser.ts's
// splitYearPanels uses for year tabs): split on the marker's start
// positions rather than trying to balance nested `<div>`s with regex, which
// tag-level parsing can't reliably do once nesting gets deep (the direction
// row block nests five levels of plain `<div>`).
//
// Dependency-free (no cheerio/jsdom), pure — no IO — so parsing is
// unit-testable without a real fetch.

const ITEM_BLOCK_START = /<div class="item d-flex"[^>]*>/g
const CODE_RE = /\b\d{2}\.\d{2}\.\d{2}\b/
const CATEGORY_CODE_RE = /\b\d{6}\b/

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
}

function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITY_MAP[m] ?? m)
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
    })
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** Split the page into each `<div class="item d-flex">…` row block (see file header for why marker-slicing, not tag-balancing). */
function extractItemBlocks(html: string): string[] {
  const starts: number[] = []
  let m: RegExpExecArray | null
  ITEM_BLOCK_START.lastIndex = 0
  while ((m = ITEM_BLOCK_START.exec(html)) !== null) starts.push(m.index)
  return starts.map((start, i) => html.slice(start, i + 1 < starts.length ? starts[i + 1] : html.length))
}

function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    const u = new URL(decodeEntities(href), baseUrl)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

export interface FgosvoCategoryLink {
  url:   string
  title: string
  /** The 6-digit subject-area code shown next to the title (e.g. "010000"), null if not found. */
  code:  string | null
}

/**
 * Top listing page (e.g. https://fgosvo.ru/fgosvo/index/24) → every
 * subject-area category link. Verified block shape:
 * `<div class="item d-flex" data-key="28"><div class="w112 …">010000</div>
 * <div><a class="item-link" href="/fgosvo/index/24/28" …>МАТЕМАТИКА И
 * МЕХАНИКА</a></div></div>`.
 */
export function parseCategoryLinks(html: string, baseUrl: string): FgosvoCategoryLink[] {
  const out: FgosvoCategoryLink[] = []
  for (const block of extractItemBlocks(html)) {
    const anchor = /<a\s+class="item-link"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (!anchor) continue
    const url = resolveUrl(anchor[1], baseUrl)
    if (!url) continue
    const title = stripTags(anchor[2])
    if (!title) continue
    const codeMatch = CATEGORY_CODE_RE.exec(stripTags(block.slice(0, anchor.index)))
    out.push({ url, title, code: codeMatch ? codeMatch[0] : null })
  }
  return out
}

/**
 * Best-effort education level from a listing page's `<title>`/`<h1>` text
 * (e.g. "ФГОС ВО (3++) по направлениям бакалавриата"). Null when no keyword
 * matches — the admin picks the level manually in that case.
 */
export function parsePageLevel(html: string): string | null {
  const heading = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
    ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]
    ?? /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1]
    ?? ''
  const norm = stripTags(heading).toLowerCase().replace(/ё/g, 'е')
  if (norm.includes('бакалавр')) return 'бакалавриат'
  if (norm.includes('магистр')) return 'магистратура'
  if (norm.includes('специалитет')) return 'специалитет'
  if (norm.includes('ординатур')) return 'ординатура'
  if (norm.includes('аспирант')) return 'аспирантура'
  return null
}

export interface FgosvoDirectionRow {
  code:       string | null
  name:       string | null
  pdf_url:    string
  order_date: string | null
}

/**
 * Category page (e.g. https://fgosvo.ru/fgosvo/index/24/29) → every
 * направление row with its PDF link. Verified block shape:
 * `<div class="item d-flex" data-key="1583"><div class="d-flex">
 * <div class="w80 me-2">02.03.01</div><div><div><span
 * class="icons googledocs …"></span>Математика и компьютерные науки</div>
 * <div class="text-darkgrey"><a class="text-darkgrey"
 * href="/fgosvo/downloads?f=…pdf&id=1583" …>PDF, 176.57 КБ</a><span>,
 * 15.01.2022</span></div></div></div></div>`.
 * A block with no PDF link (a row still being drafted, or a non-standard
 * layout) is skipped rather than guessed at.
 */
export function parseDirectionRows(html: string, baseUrl: string): FgosvoDirectionRow[] {
  const out: FgosvoDirectionRow[] = []
  for (const block of extractItemBlocks(html)) {
    const pdfAnchor = /<a\s+class="text-darkgrey"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>(\s*<span[^>]*>([\s\S]*?)<\/span>)?/i.exec(block)
    if (!pdfAnchor) continue
    const pdf_url = resolveUrl(pdfAnchor[1], baseUrl)
    if (!pdf_url) continue

    const codeMatch = CODE_RE.exec(stripTags(block))
    const code = codeMatch ? codeMatch[0] : null

    // The направление name sits in the block's own `<div>` right after the
    // "googledocs" icon span — the icon reliably distinguishes it from the
    // code cell and the "PDF, …КБ" link text.
    const nameMatch = /<span\s+class="icons\s+googledocs[^"]*"[^>]*><\/span>([\s\S]*?)<\/div>/i.exec(block)
    const name = nameMatch ? stripTags(nameMatch[1]) : null

    const dateText = pdfAnchor[4] ? stripTags(pdfAnchor[4]) : null
    const order_date = dateText ? dateText.replace(/^,\s*/, '').trim() || null : null

    out.push({ code, name, pdf_url, order_date })
  }
  return out
}
