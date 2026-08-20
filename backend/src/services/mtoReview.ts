import { chatJSON, embed } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { validateEvidence, selectRelevantSections } from './documentReview'
import { parseSyllabusContentSections } from './syllabusReview'
import { listContentUnitsByDiscipline } from '../db/queries/programTopology'
import type {
  MtoDeclaredItem, MtoFinding, MtoFindingKind, MtoReviewResult, MtoSoftwareCategory,
  ProgramDiscipline, ProgramMtoReview, ReviewSeverity,
} from '../../../shared/types'

// «Материально-техническое обеспечение» (РПД §12) — requested by the УМЦ
// head: «проверка наличия ПО по базе программного лицензионного
// обеспечения, а не мел, доска и парта». Phase 1 only (no licensed-software
// registry — see migration 101's header for why): catches §12 answering
// with nothing but generic classroom items, or with software that's all
// boilerplate (MS Office / archivers / browsers — same on every discipline)
// and no discipline-specific tool; cross-checks named tools the discipline's
// own лабораторные/практические content actually mentions against §12; and
// suggests specialized software from a CONTENT-SIMILAR sibling discipline's
// own §12 — never an LLM guess at "what this field usually needs", which
// would be the one ungrounded finding in an otherwise citation-backed check.

// A naive slice(0, N) from the start — same bug found in assessmentLinkage.ts
// 2026-08-20, same fix. §12 «Материально-техническое обеспечение» sits near
// the END of a real РПД (after §9-11), so a flat window starting from page 1
// routinely never reached it: confirmed against a real 14-page document
// where §12 clearly listed ABBYY FineReader/MS Office/7-Zip/etc., but the
// check reported "раздел пуст" — because §12's text was never in the prompt,
// not because the model misread it. Reuses documentReview.ts's
// selectRelevantSections with a heading set tuned for what THIS check needs
// (§12 first — it's the one that was silently missing — then labs/practicals
// for the isHandsOn/cross-check logic below).
const MAX_DOC_CHARS = 40000
const MTO_HEADINGS: { key: string; re: RegExp }[] = [
  { key: 'mto',         re: /^[\s\d.]*материально-техническ/im },
  { key: 'labs',        re: /^[\s\d.]*лабораторн/im },
  { key: 'practicals',  re: /^[\s\d.]*(?:практич|семинарск)/im },
]
const MTO_PRIORITY = ['mto', 'labs', 'practicals']
const AFFINITY_THRESHOLD = 0.75   // cosine floor for "similar enough content to borrow its МТО"

function finding(
  kind: MtoFindingKind, severity: ReviewSeverity, itemName: string,
  detail: string, recommendation: string, evidence: string | null = null,
): MtoFinding {
  return { kind, severity, item_name: itemName, detail, recommendation, evidence }
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

// ── Stage 1: parse §12 into named software (classified) vs. generic items ──

interface RawMtoItem { name?: string; quote?: string; category?: string }
interface RawMto { software?: unknown; generic?: unknown }

const VALID_CATEGORY: MtoSoftwareCategory[] = ['general', 'specialized']

async function parseMtoSection(teacherId: string, text: string): Promise<{
  software: MtoDeclaredItem[]
  generic: MtoDeclaredItem[]
}> {
  const system =
    'Вы — методист российского вуза. Вы извлекаете из раздела «Материально-техническое обеспечение» ' +
    'рабочей программы дисциплины (РПД, обычно раздел 12) перечисленное оборудование и ПО, разделяя ' +
    'его на конкретное лицензионное программное обеспечение и общие аудиторные средства. Берите ' +
    'формулировки из текста, не выдумывайте. Отвечайте только валидным JSON на русском языке.'

  const user =
    `## Текст РПД (или его часть)\n${sanitiseForPrompt(text)}\n\n` +
    `## Задача\nНайдите раздел «Материально-техническое обеспечение дисциплины» (обычно раздел 12). ` +
    `Разделите перечисленное на два списка:\n` +
    `1) "software" — КОНКРЕТНОЕ названное программное обеспечение (например «AutoCAD», «MS Office», ` +
    `«1С:Предприятие», «MATLAB», «КОМПАС-3D», «SPSS», операционная система с названием). Для каждого: ` +
    `{"name": "...", "quote": "ДОСЛОВНАЯ цитата из текста, где оно названо", "category": "general" | "specialized"}, где:\n` +
    `   - "general" — офисный пакет, архиватор, браузер, PDF-читалка, антивирус, ОС общего назначения ` +
    `— то, что стоит на любом компьютере независимо от дисциплины;\n` +
    `   - "specialized" — ПО, относящееся к предмету ИМЕННО этой дисциплины (САПР, расчётные пакеты, ` +
    `отраслевое/профессиональное ПО, статистические пакеты и т.п.).\n` +
    `2) "generic" — общие аудиторные средства без конкретного ПО (мел, доска, интерактивная доска, ` +
    `парта, стол, стул, проектор, экран, компьютер/ноутбук без указания установленного ПО, принтер). ` +
    `Формат {"name": "...", "quote": "..."} (без category).\n` +
    `Если раздела нет или он пуст — верните пустые массивы.\n\n` +
    `## Формат ответа\nВерните JSON: {"software":[{"name":"...","quote":"...","category":"..."}],` +
    `"generic":[{"name":"...","quote":"..."}]}. Только JSON.`

  const result = await chatJSON<RawMto>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'раздел «материально-техническое обеспечение»',
    { context: { teacherId, feature: 'grading' }, temperature: 0 },
  )

  const haystack = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const softwareItems = (x: unknown): MtoDeclaredItem[] =>
    Array.isArray(x)
      ? (x as RawMtoItem[])
          .map((v) => ({
            raw_name: String(v?.name ?? '').trim(),
            quote:    validateEvidence(v?.quote, haystack),
            category: VALID_CATEGORY.includes(v?.category as MtoSoftwareCategory)
              ? (v!.category as MtoSoftwareCategory) : 'general',   // unclassified → treat as general, the conservative default for the boilerplate check
          }))
          .filter((v) => v.raw_name)
      : []
  const genericItems = (x: unknown): MtoDeclaredItem[] =>
    Array.isArray(x)
      ? (x as RawMtoItem[])
          .map((v) => ({ raw_name: String(v?.name ?? '').trim(), quote: validateEvidence(v?.quote, haystack) }))
          .filter((v) => v.raw_name)
      : []

  return { software: softwareItems(result.software), generic: genericItems(result.generic) }
}

// ── Stage 2: what tools does the discipline's OWN content actually use? ────

interface RawToolMention { name?: string; quote?: string }

async function extractToolMentions(
  teacherId: string, disciplineName: string, labText: string,
): Promise<{ name: string; quote: string | null }[]> {
  const system =
    'Вы — методист российского вуза. Из содержания лабораторных/практических занятий рабочей ' +
    'программы дисциплины вы извлекаете названия КОНКРЕТНОГО программного обеспечения или ' +
    'инструментов, которые студенты реально используют. Берите только явно названные инструменты, ' +
    'не выдумывайте. Отвечайте только валидным JSON на русском языке.'

  const user =
    `## Дисциплина\n${sanitiseForPrompt(disciplineName)}\n\n` +
    `## Содержание лабораторных/практических занятий\n${sanitiseForPrompt(labText.slice(0, 6000))}\n\n` +
    `## Задача\nНайдите упоминания КОНКРЕТНОГО названного ПО/инструмента (например «AutoCAD», ` +
    `«Python», «1С», «MATLAB», «Excel», конкретный станок/прибор с названием). НЕ включайте общие ` +
    `слова («компьютер», «программа», «оборудование») без названия. Если ничего конкретного не ` +
    `названо — пустой массив.\n\n` +
    `## Формат ответа\nВерните JSON: {"tools":[{"name":"...","quote":"ДОСЛОВНАЯ цитата 5-15 слов"}]}. Только JSON.`

  const result = await chatJSON<{ tools?: unknown }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'инструменты в содержании лабораторных/практических',
    { context: { teacherId, feature: 'grading' }, temperature: 0 },
  )

  const haystack = labText.toLowerCase().replace(/\s+/g, ' ').trim()
  return Array.isArray(result.tools)
    ? (result.tools as RawToolMention[])
        .map((t) => ({ name: String(t?.name ?? '').trim(), quote: validateEvidence(t?.quote, haystack) }))
        .filter((t) => t.name)
    : []
}

// ── Stage 3: cross-discipline suggestion — borrow a similar discipline's OWN
// declared specialized software, never an LLM guess at "what this field
// usually needs". Mirrors placementReview.ts's D7 (missing-prerequisite)
// affinity pattern exactly, reusing the same embeddings + content units. ───

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

async function crossDisciplineSuggestions(
  teacherId: string, discipline: ProgramDiscipline, ownEmbedText: string,
  declaredSoftwareNames: Set<string>, allDisciplines: ProgramDiscipline[],
  siblingReviews: ProgramMtoReview[],
): Promise<MtoFinding[]> {
  if (ownEmbedText.trim().length < 80) return []

  let ownEmbedding: number[]
  try {
    ownEmbedding = await embed(`${discipline.name}. ${ownEmbedText}`, { teacherId, feature: 'embedding' })
  } catch {
    return []   // best-effort — never block the deterministic findings
  }

  const nameById = new Map(allDisciplines.filter((d) => d.id).map((d) => [d.id!, d.name]))
  const candidates: { itemName: string; quote: string | null; siblingName: string; sim: number }[] = []

  for (const sib of siblingReviews.slice(0, 15)) {   // cap — this is a per-review AI cost
    const specialized = sib.result.software_items.filter((s) => s.category === 'specialized')
    if (specialized.length === 0) continue
    const units = await listContentUnitsByDiscipline(sib.discipline_id).catch(() => [])
    if (units.length === 0) continue
    const topicText = units.flatMap((u) => [u.title, ...u.topics]).join('. ').slice(0, 2000)
    if (topicText.trim().length < 20) continue
    const candEmbedding = await embed(topicText, { teacherId, feature: 'embedding' }).catch(() => null)
    if (!candEmbedding) continue
    const sim = cosine(ownEmbedding, candEmbedding)
    if (sim < AFFINITY_THRESHOLD) continue

    const siblingName = nameById.get(sib.discipline_id) ?? '—'
    for (const item of specialized) {
      const already = [...declaredSoftwareNames].some(
        (d) => d.includes(norm(item.raw_name)) || norm(item.raw_name).includes(d)
      )
      if (already) continue
      candidates.push({ itemName: item.raw_name, quote: item.quote, siblingName, sim })
    }
  }

  // Dedupe by software name (keep the highest-affinity source), cap to top 3
  // so this doesn't turn into a wall of suggestions.
  const bestByName = new Map<string, typeof candidates[number]>()
  for (const c of candidates) {
    const key = norm(c.itemName)
    const existing = bestByName.get(key)
    if (!existing || c.sim > existing.sim) bestByName.set(key, c)
  }
  const top = [...bestByName.values()].sort((a, b) => b.sim - a.sim).slice(0, 3)

  return top.map((c) => finding(
    'missing_specialized_tool', 'suggestion', c.itemName,
    `«${discipline.name}» по содержанию заметно перекликается с «${c.siblingName}», которая указывает ` +
    `«${c.itemName}» как специализированное ПО — в разделе этой дисциплины оно не упомянуто.`,
    `Проверьте, нужно ли «${c.itemName}» и для этой дисциплины; если да — добавьте в раздел 12.`,
    c.quote,
  ))
}

// ── Public API ────────────────────────────────────────────────────────────

export interface ReviewMtoParams {
  teacherId:       string
  discipline:      ProgramDiscipline   // must have .id
  allDisciplines:  ProgramDiscipline[] // the whole plan, for the cross-discipline suggestion
  documentText:    string
  siblingReviews:  ProgramMtoReview[]  // OTHER disciplines' latest МТО reviews
}

export async function reviewMto(params: ReviewMtoParams): Promise<MtoReviewResult> {
  const text = selectRelevantSections((params.documentText ?? '').trim(), MAX_DOC_CHARS, MTO_HEADINGS, MTO_PRIORITY)
  if (text.length < 80) {
    return {
      software_items: [], generic_items: [],
      findings: [finding('generic_only', 'warning', '', 'Недостаточно текста РПД для анализа раздела.', 'Загрузите полный текст рабочей программы.')],
      summary: 'Недостаточно содержания для анализа.',
    }
  }

  const { software, generic } = await parseMtoSection(params.teacherId, text)
  const findings: MtoFinding[] = []

  // §5–§8 content, needed by both the boilerplate check below (is this a
  // hands-on discipline?) and the undeclared-tool cross-check.
  const sections = await parseSyllabusContentSections(params.teacherId, text).catch(() => null)
  const labText = sections ? [sections.labs, sections.practicals].filter(Boolean).join('\n\n') : ''
  const isHandsOn = labText.trim().length >= 200

  if (software.length === 0) {
    findings.push(finding(
      'generic_only', generic.length > 0 ? 'warning' : 'suggestion', '',
      generic.length > 0
        ? `Раздел «Материально-техническое обеспечение» перечисляет только общие аудиторные средства ` +
          `(${generic.map((g) => g.raw_name).join(', ')}) — ни одного названного программного обеспечения.`
        : 'Раздел «Материально-техническое обеспечение» пуст или не называет ни оборудования, ни ПО.',
      'Укажите конкретное лицензионное ПО, необходимое для освоения дисциплины, если оно используется — либо явно отметьте, что специализированное ПО не требуется.',
    ))
  } else if (isHandsOn && software.every((s) => s.category !== 'specialized')) {
    // The боилерплейт case this check was built from: MS Office / архиватор /
    // браузер repeated across every discipline regardless of subject — that
    // trivially satisfies "some software is named" but says nothing about
    // what THIS discipline needs.
    findings.push(finding(
      'generic_software_only', 'warning', '',
      `Раздел «Материально-техническое обеспечение» называет только общее прикладное ПО ` +
      `(${software.map((s) => s.raw_name).join(', ')}) — среди него нет специализированного инструмента, ` +
      `хотя дисциплина включает существенный объём лабораторных/практических занятий.`,
      'Проверьте, требуется ли для дисциплины специализированное ПО (расчётное, проектировочное, отраслевое), и укажите его в разделе.',
    ))
  }

  // Cross-check: does лабораторные/практические CONTENT mention a tool §12
  // never lists?
  const declaredNames = new Set(software.map((s) => norm(s.raw_name)))
  if (labText.trim().length >= 80) {
    const mentions = await extractToolMentions(params.teacherId, params.discipline.name, labText).catch(() => [])
    for (const m of mentions) {
      const mentioned = norm(m.name)
      const alreadyDeclared = [...declaredNames].some((d) => d.includes(mentioned) || mentioned.includes(d))
      if (alreadyDeclared) continue
      findings.push(finding(
        'undeclared_tool', 'error', m.name,
        `В содержании лабораторных/практических занятий упоминается «${m.name}», но раздел ` +
        `«Материально-техническое обеспечение» не указывает его.`,
        `Добавьте «${m.name}» в раздел 12, либо укажите используемый аналог.`,
        m.quote,
      ))
    }
  }

  // Cross-discipline suggestion — best-effort, never blocks the rest.
  const ownEmbedText = selectRelevantSections(text, 4000)
  findings.push(...await crossDisciplineSuggestions(
    params.teacherId, params.discipline, ownEmbedText, declaredNames, params.allDisciplines, params.siblingReviews,
  ).catch(() => []))

  return {
    software_items: software,
    generic_items:  generic,
    findings,
    summary: summarise(findings),
  }
}

function summarise(findings: MtoFinding[]): string {
  if (findings.length === 0) {
    return 'Раздел «Материально-техническое обеспечение» называет конкретное ПО, согласованное с содержанием — противоречий не найдено.'
  }
  const errors = findings.filter((f) => f.severity === 'error').length
  const warnings = findings.filter((f) => f.severity === 'warning').length
  const suggestions = findings.filter((f) => f.severity === 'suggestion').length
  const parts: string[] = []
  if (errors) parts.push(`${errors} ошибок`)
  if (warnings) parts.push(`${warnings} предупреждений`)
  if (suggestions) parts.push(`${suggestions} рекомендаций`)
  return `Найдено: ${parts.join(', ')}.`
}
