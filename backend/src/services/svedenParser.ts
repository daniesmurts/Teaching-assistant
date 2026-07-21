// Parser for the «Сведения об образовательной организации → Образование»
// disclosure page (the /sveden/education section every Russian university must
// publish). Powers bulk РПД discovery: the РОП pastes the page URL once
// instead of pasting ~40 individual document links.
//
// Why this is parseable without a headless browser: Рособрнадзор's
// requirements (Приказ № 831 + methodology) mandate machine-readable
// `itemprop` microdata on exactly these tables — universities are audited on
// it — and push the pages to be server-rendered. We parse in two tiers:
//   1. itemprop attributes (the mandated markup) — used to identify cells,
//      most importantly to tell the РПД column from the «Аннотации» column,
//      whose links carry the *same discipline names*.
//   2. Text/href heuristics — for imperfect markup. Residual ambiguity is
//      fine: the result is a human-confirmed checklist, never an auto-import.
//
// Deliberately dependency-free (no cheerio/jsdom — new deps need a manual
// install): these tables are flat enough that tag-level regex segmentation
// holds. Pure module — no IO — so the whole pipeline is unit-testable.

import type { ProgramPracticeType } from '../../../shared/types'

export type DiscoveredKind =
  | 'working_programme'   // РПД — the bulk of the links, importable
  | 'practice'            // программа практики — importable
  | 'plan'                // учебный план — informational (attached at intake)
  | 'description'         // описание ОП — informational
  | 'schedule'            // календарный график — not modelled, skipped
  | 'annotation'          // аннотация — deliberately skipped (name-collides with РПД)
  | 'other'

export interface DiscoveredDoc {
  url:           string
  /** Link text with sveden's underscore convention undone («Линейная_алгебра» → «Линейная алгебра»). */
  text:          string
  kind:          DiscoveredKind
  practice_type: ProgramPracticeType | null
}

export interface SvedenProgramRow {
  code: string | null   // направление code, e.g. «01.03.02»
  name: string | null
  // Профиль (specialisation) — verified against kstu.ru: a code+name pair is
  // NOT unique. «01.03.02 Прикладная математика и информатика» splits into
  // several separate rows sharing that exact code+name, one per профиль
  // (e.g. «Прикладная математика и информатика», «Искусственный интеллект и
  // большие данные», …), each with its OWN document set. Null when the page
  // has no eduProf cell (single-профиль programmes, most other universities).
  profile: string | null
  docs: DiscoveredDoc[]
}

// ── Small HTML helpers (tag-level, not a real DOM) ────────────────────────────

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

/** Extract an attribute value from a tag's attribute string (both quote styles). */
function attrValue(attrs: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs)
  return m ? (m[2] ?? m[3] ?? '') : null
}

interface Anchor { href: string; text: string; itemprop: string | null }

function extractAnchors(html: string, baseUrl: string): Anchor[] {
  const out: Anchor[] = []
  // Real sveden markup (verified against kstu.ru) tags each link's itemprop
  // on a `<span itemprop="…">` wrapping the anchor, not on the `<a>` or the
  // `<td>` itself: `<span itemprop="educationRpd"><a href=…>Name</a></span>`.
  // The optional leading group captures that wrapper when it directly
  // precedes the anchor; the anchor's own itemprop (rare, but some other
  // universities' sites do put it there) still wins if both are present.
  const re = /(?:<span\b([^>]*)>\s*)?<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const wrapperAttrs = m[1]
    const aAttrs       = m[2]
    const href = attrValue(aAttrs, 'href')
    if (!href) continue
    let abs: string
    try {
      const u = new URL(decodeEntities(href), baseUrl)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue
      abs = u.toString()
    } catch { continue }
    const text = stripTags(m[3])
    if (!text) continue
    const itemprop = attrValue(aAttrs, 'itemprop') ?? (wrapperAttrs ? attrValue(wrapperAttrs, 'itemprop') : null)
    out.push({ href: abs, text, itemprop })
  }
  return out
}

// ── Classification ────────────────────────────────────────────────────────────

/** Underscore-convention undo + whitespace collapse, preserves case for display. */
export function cleanLinkText(s: string): string {
  return s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Case/ё-insensitive form used for keyword tests and name matching. */
export function normalizeName(s: string): string {
  return cleanLinkText(s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Cell-level kind hint from mandated itemprop values. Tolerant contains-tests:
// spellings drift across site generators (including the methodology's own
// «educationShedule» misspelling), so we match substrings, most specific first.
function kindFromItemprop(itemprop: string): DiscoveredKind | null {
  const p = itemprop.toLowerCase()
  if (p.includes('rpd')) return 'working_programme'
  if (p.includes('annot')) return 'annotation'
  if (p.includes('opmain')) return 'description'
  if (p.includes('plan')) return 'plan'
  if (p.includes('shedul') || p.includes('schedul')) return 'schedule'
  if (p.includes('practi') || p === 'edupr') return 'practice'
  // Real sveden pages (verified against kstu.ru) carry a «методические и иные
  // документы» column tagged itemprop="methodology" (plus an unrelated "Copy"
  // marker elsewhere on the page) — these are general-purpose PDFs (Metod_KR,
  // Plan_VR, …) whose filenames match neither a discipline name nor any text
  // keyword, so without this they'd fall through to the document-URL default
  // and get miscounted as unmatched РПД. Return 'other' explicitly instead of
  // null so the itemprop hint, not the default, wins.
  if (p.includes('methodology') || p === 'copy') return 'other'
  return null
}

function kindFromText(norm: string): DiscoveredKind | null {
  if (norm.includes('аннотац')) return 'annotation'
  if (norm.includes('практик')) return 'practice'
  if (norm.includes('учебный план') || norm.includes('учебныи план')) return 'plan'
  if (norm.includes('описание')) return 'description'
  if (norm.includes('календарн') || norm.includes('график')) return 'schedule'
  return null
}

/** Does the href plausibly point at a document (vs. a page/anchor)? */
function looksLikeDocument(url: string): boolean {
  const path = url.toLowerCase().split('?')[0]
  if (/\.(pdf|docx?|rtf|odt)$/.test(path)) return true
  // University document systems commonly serve files behind opaque handler
  // URLs (e.g. kstu's /getpilot?id=…) — treat any query-bearing or
  // handler-ish path as plausible; magic-byte sniffing at fetch time is the
  // real type gate.
  return /getpilot|download|getfile|filedownload|doc|file/.test(url.toLowerCase())
}

export function classifyPracticeType(text: string): ProgramPracticeType | null {
  const n = normalizeName(text)
  if (n.includes('преддиплом')) return 'production_pre_diploma'
  if (n.includes('ознакомит')) return 'educational_familiarization'
  if (n.includes('эксплуатац')) return 'educational_operational'
  // «Производственная (технологическая / проектно-технологическая)» — but a
  // *учебная* технологическая практика must NOT silently map here, so the
  // производственная qualifier is required; anything else stays null and the
  // user picks the type in the checklist.
  if (n.includes('производствен') && (n.includes('технологич') || n.includes('проектно'))) {
    return 'production_technological'
  }
  return null
}

// ── Row / page parsing ────────────────────────────────────────────────────────

const CODE_RE = /\b\d{2}\.\d{2}\.\d{2}\b/

/**
 * Text of the first `<span itemprop="…">` inside `html` whose itemprop
 * matches `test`. Real sveden pages (verified against kstu.ru) wrap
 * eduCode/eduName in an inner span rather than tagging the `<td>` itself —
 * the same wrapper pattern `extractAnchors` handles for document links.
 */
function findSpanItempropText(html: string, test: (itemprop: string) => boolean): string | null {
  const re = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const prop = attrValue(m[1], 'itemprop')
    if (prop && test(prop.toLowerCase())) return stripTags(m[2])
  }
  return null
}

function parseRowsFromHtml(html: string, baseUrl: string): SvedenProgramRow[] {
  // Drop script/style noise so their string contents can't fake anchors/rows.
  const clean = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '')

  const rows: SvedenProgramRow[] = []
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(clean)) !== null) {
    const rowHtml = rm[1]
    const docs: DiscoveredDoc[] = []
    let code: string | null = null
    let name: string | null = null
    let profile: string | null = null

    // Cells — the unit that carries the mandated column semantics.
    const cellRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi
    let cm: RegExpExecArray | null
    let sawCell = false
    while ((cm = cellRe.exec(rowHtml)) !== null) {
      sawCell = true
      const cellAttrs = cm[1]
      const cellHtml  = cm[2]
      const cellText  = stripTags(cellHtml)

      // Row identity from mandated cell markup (own attribute, or an inner
      // wrapping span — see findSpanItempropText), with a whole-row regex
      // fallback for the code below if neither locates it.
      const cellProp = attrValue(cellAttrs, 'itemprop') ?? ''
      const codeText = /educode/i.test(cellProp) ? cellText : findSpanItempropText(cellHtml, (p) => p.includes('educode'))
      if (codeText && CODE_RE.test(codeText)) code = CODE_RE.exec(codeText)![0]
      const nameText = /eduname/i.test(cellProp) ? cellText : findSpanItempropText(cellHtml, (p) => p.includes('eduname'))
      if (nameText) name = nameText
      // eduProf — the профиль (specialisation) cell. Distinguishes rows that
      // otherwise share the exact same code AND name (see SvedenProgramRow).
      const profileText = /eduprof/i.test(cellProp) ? cellText : findSpanItempropText(cellHtml, (p) => p.includes('eduprof'))
      if (profileText) profile = profileText

      const anchors = extractAnchors(cellHtml, baseUrl)
      if (anchors.length === 0) continue

      // The cell's own hint: its itemprop, or the first anchor-level itemprop
      // found inside it. This is what separates the РПД column from the
      // Аннотации column when link texts are identical discipline names.
      const cellKind =
        kindFromItemprop(cellProp)
        ?? anchors.map((a) => (a.itemprop ? kindFromItemprop(a.itemprop) : null)).find((k) => k !== null)
        ?? null

      for (const a of anchors) {
        const text = cleanLinkText(a.text)
        const norm = normalizeName(text)
        // Precedence: the anchor's own itemprop → its text keywords → the
        // cell hint → document-looking default. Text keywords must outrank
        // the cell hint: практики sometimes live inside the РПД cell.
        const own = a.itemprop ? kindFromItemprop(a.itemprop) : null
        let kind: DiscoveredKind
        if (own) kind = own
        else {
          const byText = kindFromText(norm)
          if (byText) kind = byText
          else if (cellKind) kind = cellKind
          else kind = looksLikeDocument(a.href) ? 'working_programme' : 'other'
        }
        // The РПД cell often opens with a header-style link literally titled
        // «Рабочая программа» (an archive or column heading) — that's not a
        // discipline.
        if (kind === 'working_programme' && /^рабоч(ая|ие) программ/i.test(norm)) kind = 'other'

        docs.push({
          url: a.href, text, kind,
          practice_type: kind === 'practice' ? classifyPracticeType(text) : null,
        })
      }
    }

    // Some generators put programme rows in div-grids rather than tables —
    // no cells found means nothing to do for this "row".
    if (!sawCell || docs.length === 0) continue
    if (!code) {
      const m = CODE_RE.exec(stripTags(rowHtml))
      code = m ? m[0] : null
    }
    rows.push({ code, name, profile, docs })
  }
  return rows
}

// ── Multi-year pages ──────────────────────────────────────────────────────────
// Some universities (verified against kstu.ru) publish ALL years' programmes in
// ONE server response, with client-side JS tabs (year "2026", "2025", …) just
// showing/hiding already-embedded `<div class="tab-pane" id="{year}">` panels
// — nothing is re-fetched per tab. Critically, the panels are NOT in the same
// order as the tab buttons (kstu.ru lists panels 2021→2026 ascending, while the
// tab bar shows 2026 first) — parsing the whole document without this
// scoping silently mixes six years of rows, and a naive "first match wins"
// picks whichever year happens to appear earliest in the raw HTML, not the
// one the user would see by default in a browser. Single-year sites (the
// large majority) have no such markup and fall through unaffected.

export interface YearPanel { year: string; active: boolean; html: string }

/** Null when the page has no multi-year tab markup — callers fall back to whole-document parsing. */
function splitYearPanels(html: string): YearPanel[] | null {
  const markerRe = /<div\s+class="(tab-pane[^"]*)"\s+id="(\d{4})"/g
  const markers: { index: number; year: string; active: boolean }[] = []
  let m: RegExpExecArray | null
  while ((m = markerRe.exec(html)) !== null) {
    markers.push({ index: m.index, year: m[2], active: /\bactive\b/.test(m[1]) })
  }
  if (markers.length === 0) return null

  return markers.map((mk, i) => ({
    year:   mk.year,
    active: mk.active,
    html:   html.slice(mk.index, i + 1 < markers.length ? markers[i + 1].index : html.length),
  }))
}

export interface SvedenParseResult {
  rows: SvedenProgramRow[]
  /** Years found as separate tabs on a multi-year page, newest first. Empty for a single-year page. */
  availableYears: string[]
  /** Which year's panel was actually parsed. Null on a single-year page (not applicable — there's only one). */
  selectedYear: string | null
}

/**
 * Parses the disclosure page, scoping to one year's panel when the page
 * bundles several. `requestedYear` lets the discovery endpoint re-run
 * against a different tab than the page's own default; falls back to the
 * page's own active tab, then the first panel found, if omitted/unmatched.
 */
export function parseSvedenPage(html: string, baseUrl: string, requestedYear?: string): SvedenParseResult {
  const panels = splitYearPanels(html)
  if (!panels) return { rows: parseRowsFromHtml(html, baseUrl), availableYears: [], selectedYear: null }

  const availableYears = [...new Set(panels.map((p) => p.year))].sort((a, b) => b.localeCompare(a))
  const chosen =
    (requestedYear ? panels.find((p) => p.year === requestedYear) : undefined)
    ?? panels.find((p) => p.active)
    ?? panels[0]
  return { rows: parseRowsFromHtml(chosen.html, baseUrl), availableYears, selectedYear: chosen.year }
}

// ── Discipline matching ───────────────────────────────────────────────────────

export interface DisciplineRef { id: string; name: string }
export interface DisciplineMatch { id: string; confidence: 'exact' | 'fuzzy' }

function tokens(norm: string): Set<string> {
  return new Set(norm.split(' ').filter((t) => t.length > 2))
}

/**
 * Match a РПД link's text (the discipline name, per the sveden convention)
 * against the programme's disciplines. Exact normalized match wins; otherwise
 * best token-overlap (Jaccard ≥ 0.6, unique winner). Null → the user picks
 * manually in the checklist — never guess below the threshold.
 */
export function matchDiscipline(linkText: string, disciplines: DisciplineRef[]): DisciplineMatch | null {
  const norm = normalizeName(linkText)
  if (!norm) return null

  for (const d of disciplines) {
    if (normalizeName(d.name) === norm) return { id: d.id, confidence: 'exact' }
  }

  const linkTokens = tokens(norm)
  if (linkTokens.size === 0) return null
  let best: { id: string; score: number } | null = null
  let runnerUp = 0
  for (const d of disciplines) {
    const dTokens = tokens(normalizeName(d.name))
    if (dTokens.size === 0) continue
    let inter = 0
    for (const t of linkTokens) if (dTokens.has(t)) inter++
    const union = linkTokens.size + dTokens.size - inter
    const score = union === 0 ? 0 : inter / union
    if (!best || score > best.score) {
      runnerUp = best?.score ?? 0
      best = { id: d.id, score }
    } else if (score > runnerUp) {
      runnerUp = score
    }
  }
  // Require a clear winner — «Математический анализ» vs «Функциональный
  // анализ» must not resolve on the shared token alone.
  if (best && best.score >= 0.6 && best.score > runnerUp) return { id: best.id, confidence: 'fuzzy' }
  return null
}

// ── Programme-row selection ───────────────────────────────────────────────────

/**
 * Pick the row for the programme being imported into. Code match first (the
 * unambiguous key), then normalized-name match, then "the only row with
 * documents". Null → caller returns the candidate list for the user.
 *
 * A code is NOT guaranteed unique — verified against kstu.ru, where one
 * code+name splits into several rows, one per **профиль** (specialisation),
 * each with its own document set (`SvedenProgramRow.profile`). When several
 * rows share the requested code, try to narrow by profile/name before ever
 * guessing: guessing here would silently import the wrong профиль's РПД set
 * under the right programme, which is worse than surfacing "ambiguous".
 */
export function selectProgramRow(
  rows: SvedenProgramRow[],
  program: { code: string | null; name: string },
): SvedenProgramRow | null {
  const withDocs = rows.filter((r) => r.docs.length > 0)
  if (withDocs.length === 0) return null

  const code = program.code?.match(CODE_RE)?.[0] ?? null
  const nameNorm = normalizeName(program.name)
  if (code) {
    const byCode = withDocs.filter((r) => r.code === code)
    if (byCode.length === 1) return byCode[0]
    if (byCode.length > 1) {
      // Several forms of study/профили publish as separate rows sharing one
      // code. Try the programme's own name against each row's профиль first
      // (the more specific field), falling back to the направление name —
      // only act on a UNIQUE match.
      const byProfile = nameNorm
        ? byCode.filter((r) => r.profile && normalizeName(r.profile) === nameNorm)
        : []
      if (byProfile.length === 1) return byProfile[0]
      const byRowName = nameNorm
        ? byCode.filter((r) => r.name && normalizeName(r.name) === nameNorm)
        : []
      if (byRowName.length === 1) return byRowName[0]
      // Still ambiguous (0 or >1) — do not guess among different профили.
      return null
    }
  }
  if (nameNorm) {
    const byName = withDocs.filter((r) => r.name && normalizeName(r.name) === nameNorm)
    if (byName.length === 1) return byName[0]
  }
  return withDocs.length === 1 ? withDocs[0] : null
}
