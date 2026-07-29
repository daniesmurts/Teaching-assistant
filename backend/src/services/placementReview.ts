import { chatJSON, embed } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { selectRelevantSections, validateEvidence } from './documentReview'
import { listContentUnitsByDiscipline } from '../db/queries/programTopology'
import type {
  DeclaredPrerequisiteLink, PlacementFinding, PlacementFindingKind, PlacementResolution,
  PlacementReviewResult, PlacementSeverity, Program, ProgramDiscipline, ProgramPlacementReview,
} from '../../../shared/types'

// «Место дисциплины в структуре ОП» — checks РПД §2 (see the screenshot this
// feature was built from: «2. Место дисциплины в структуре образовательной
// программы» — declared предшествующие/последующие disciplines, and the
// направление/профиль the РПД claims to belong to). Nobody parsed this
// section before; syllabusReview.ts scores цели/компетенции/ЗУВ against
// content, documentReview.ts scores competency coverage — neither touches §2.
//
// The check compares THREE independent sources against each other, never
// trusting §2 alone:
//   - the real plan       (program_disciplines.semester)
//   - the programme header (Program.code / .specialty_name / .profile)
//   - other disciplines' own §2 (asymmetry — D3)
// plus two AI passes that answer "are these the RIGHT disciplines" rather
// than just "is the logic internally consistent" (D6 rationale, D7 missing
// prerequisite), reusing the embeddings + program_content_units the
// topology substrate (migration 099) already populates.

const MAX_DOC_CHARS = 20000
const EXTERNAL_HINTS = /школьн|школе|среднего\s+общего|среднее\s+общее|общеобразовательн/i
const AFFINITY_THRESHOLD = 0.72   // cosine floor for a D6 "content actually relates" / D7 candidate

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function finding(
  kind: PlacementFindingKind, severity: PlacementSeverity, disciplineName: string,
  detail: string, recommendation: string, evidence: string | null = null,
): PlacementFinding {
  return { kind, severity, discipline_name: disciplineName, detail, recommendation, evidence }
}

// ── Stage 1: parse §2 out of the РПД text ───────────────────────────────────

interface RawPlacementItem { name?: string; quote?: string }
interface RawPlacement {
  program?:       string | null
  program_quote?: string | null
  predecessors?:  unknown
  successors?:    unknown
}

interface ParsedDeclared { name: string; quote: string | null }

async function parsePlacementSection(teacherId: string, text: string): Promise<{
  declaredProgram: string | null
  declaredProgramQuote: string | null
  predecessors: ParsedDeclared[]
  successors: ParsedDeclared[]
}> {
  const system =
    'Вы — методист российского вуза. Вы извлекаете из раздела «Место дисциплины в структуре ' +
    'образовательной программы» рабочей программы дисциплины (РПД): какие дисциплины указаны как ' +
    'предшествующие, какие — как последующие, и к какому направлению/профилю относится программа. ' +
    'Берите формулировки из текста, не выдумывайте. Отвечайте только валидным JSON на русском языке.'

  const user =
    `## Текст РПД (или его часть)\n${sanitiseForPrompt(text)}\n\n` +
    `## Задача\nНайдите раздел «Место дисциплины в структуре образовательной программы» (обычно раздел 2). ` +
    `Извлеките:\n` +
    `1) "program" — направление подготовки и/или профиль, к которому РПД относит себя в этом разделе ` +
    `(например «15.03.02 Технологические машины и оборудование, профиль Оборудование ` +
    `нефтегазопереработки»). "program_quote" — ДОСЛОВНАЯ цитата из текста, где это указано (5–20 слов). ` +
    `Оба поля null, если не указано.\n` +
    `2) "predecessors" — массив дисциплин, указанных как предшествующие (на освоение которых опирается ` +
    `данная дисциплина). Для каждой: {"name": "название", "quote": "ДОСЛОВНАЯ цитата из текста, где эта ` +
    `дисциплина названа предшествующей"}.\n` +
    `3) "successors" — то же для дисциплин, для которых данная дисциплина указана как предшествующая/` +
    `необходимая (раздел «является предшествующей и необходима для...»).\n` +
    `Цитаты — короткие (5–20 слов), дословные, без выдумывания. Если раздела нет или он не называет ни ` +
    `одной дисциплины — верните пустые массивы.\n\n` +
    `## Формат ответа\nВерните JSON: {"program":"...","program_quote":"...",` +
    `"predecessors":[{"name":"...","quote":"..."}],"successors":[{"name":"...","quote":"..."}]}. Только JSON.`

  const result = await chatJSON<RawPlacement>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'раздел «место дисциплины в структуре ОП»',
    { context: { teacherId, feature: 'grading' }, temperature: 0 },
  )

  const haystack = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const items = (x: unknown): ParsedDeclared[] =>
    Array.isArray(x)
      ? (x as RawPlacementItem[])
          .map((v) => ({ name: String(v?.name ?? '').trim(), quote: validateEvidence(v?.quote, haystack) }))
          .filter((v) => v.name)
      : []

  return {
    declaredProgram:      result.program ? String(result.program).trim() || null : null,
    declaredProgramQuote: validateEvidence(result.program_quote, haystack),
    predecessors:         items(result.predecessors),
    successors:           items(result.successors),
  }
}

// ── Stage 2: resolve declared names against the real plan ──────────────────

function resolveDeclared(
  items: ParsedDeclared[], role: 'predecessor' | 'successor', disciplines: ProgramDiscipline[],
): DeclaredPrerequisiteLink[] {
  const byName = new Map(disciplines.filter((d) => d.id).map((d) => [norm(d.name), d]))
  return items.map(({ name: raw, quote }): DeclaredPrerequisiteLink => {
    const match = byName.get(norm(raw))
    if (match) {
      return { raw_name: raw, role, resolution: 'internal', discipline_id: match.id!, semester: match.semester, quote }
    }
    const resolution: PlacementResolution = EXTERNAL_HINTS.test(raw) ? 'external' : 'unmatched'
    return { raw_name: raw, role, resolution, discipline_id: null, semester: null, quote }
  })
}

// ── Stage 3: deterministic checks (D1, D2, D4, D5) + D3 (needs siblings) ───

function deterministicFindings(
  declared: DeclaredPrerequisiteLink[], declaredProgram: string | null, declaredProgramQuote: string | null,
  discipline: ProgramDiscipline, program: Program,
  siblingReviews: ProgramPlacementReview[],
): PlacementFinding[] {
  const out: PlacementFinding[] = []

  if (declared.length === 0) {
    out.push(finding(
      'empty_section', 'warning', '',
      'Раздел «Место дисциплины в структуре ОП» не называет ни одной дисциплины — только общие фразы.',
      'Укажите конкретные предшествующие и последующие дисциплины из учебного плана.',
    ))
  }

  // D1 — phantom: unmatched and not plausibly external.
  for (const d of declared) {
    if (d.resolution !== 'unmatched') continue
    out.push(finding(
      'phantom', 'error', d.raw_name,
      `«${d.raw_name}» указана как ${d.role === 'predecessor' ? 'предшествующая' : 'последующая'} ` +
      `дисциплина, но не найдена в учебном плане программы.`,
      'Проверьте название — опечатка, дисциплина переименована, или это дисциплина другого плана.',
      d.quote,
    ))
  }

  // D2 — inversion: predecessor must be taught no later than this discipline;
  // successor must be taught no earlier. Same-semester is not an inversion
  // (mirrors programAnalysis's "strict inversion only" rule).
  for (const d of declared) {
    if (d.resolution !== 'internal' || d.semester == null) continue
    if (d.role === 'predecessor' && d.semester > discipline.semester) {
      out.push(finding(
        'inversion', 'error', d.raw_name,
        `«${d.raw_name}» указана как предшествующая, но изучается в семестре ${d.semester} — позже, ` +
        `чем «${discipline.name}» (семестр ${discipline.semester}).`,
        `Перенесите «${d.raw_name}» на более ранний семестр, либо «${discipline.name}» — на более поздний, ` +
        `либо исправьте раздел, если предшествование указано ошибочно.`,
        d.quote,
      ))
    }
    if (d.role === 'successor' && d.semester < discipline.semester) {
      out.push(finding(
        'inversion', 'error', d.raw_name,
        `«${d.raw_name}» указана как последующая, но изучается в семестре ${d.semester} — раньше, ` +
        `чем «${discipline.name}» (семестр ${discipline.semester}).`,
        `Перенесите «${d.raw_name}» на более поздний семестр, либо исправьте раздел.`,
        d.quote,
      ))
    }
  }

  // D3 — asymmetry: only checked against disciplines that have ALSO been
  // reviewed (siblingReviews) — an unreviewed counterpart isn't a finding,
  // same "не проверено, не ошибка" convention as the coverage table.
  const siblingByDiscipline = new Map(siblingReviews.map((r) => [r.discipline_id, r]))
  for (const d of declared) {
    if (d.resolution !== 'internal' || !d.discipline_id) continue
    const sibling = siblingByDiscipline.get(d.discipline_id)
    if (!sibling) continue
    const expectedRole = d.role === 'predecessor' ? 'successor' : 'predecessor'
    const reciprocal = sibling.result.declared.find(
      (s) => s.role === expectedRole && s.discipline_id === discipline.id
    )
    if (!reciprocal) {
      // If the sibling's §2 mentions this discipline at all (just under the
      // wrong role, or not naming a relationship the check expects), surface
      // that quote too — the teacher sees both documents' actual wording
      // instead of just "doesn't match" and has to open both files anyway.
      const anyMention = sibling.result.declared.find((s) => s.discipline_id === discipline.id)
      out.push(finding(
        'asymmetry', 'warning', d.raw_name,
        `«${discipline.name}» указывает «${d.raw_name}» как ${d.role === 'predecessor' ? 'предшествующую' : 'последующую'}, ` +
        `но раздел «Место дисциплины» самой «${d.raw_name}» не подтверждает обратную связь` +
        (anyMention?.quote ? ` (там она упомянута иначе: «${anyMention.quote}»)` : '') + '.',
        `Согласуйте формулировки раздела 2 между «${discipline.name}» и «${d.raw_name}» — одна из РПД, ` +
        `вероятно, устарела или составлена без учёта другой.`,
        d.quote,
      ))
    }
  }

  // D5 — wrong направление/профиль.
  if (declaredProgram) {
    const haystack = norm(declaredProgram)
    const candidates = [program.code, program.specialty_name, program.profile].filter(Boolean) as string[]
    const matches = candidates.length === 0 || candidates.some((c) => {
      const cn = norm(c)
      return haystack.includes(cn) || cn.includes(haystack) || sharesCode(haystack, cn)
    })
    if (!matches && candidates.length > 0) {
      out.push(finding(
        'wrong_program', 'error', '',
        `Раздел указывает направление/профиль «${declaredProgram}», что не совпадает с направлением ` +
        `текущей программы (${candidates.join(', ')}).`,
        'Проверьте, не скопирована ли РПД из другой образовательной программы без правки раздела 2.',
        declaredProgramQuote,
      ))
    }
  }

  return out
}

// A programme code like «15.03.02» is the strongest signal — match it
// digit-for-digit even if surrounding text (profile wording) differs.
function sharesCode(a: string, b: string): boolean {
  const codeOf = (s: string) => s.match(/\d{2}\.\d{2}\.\d{2}/)?.[0]
  const ca = codeOf(a), cb = codeOf(b)
  return !!ca && ca === cb
}

// ── Stage 4: AI — D6 rationale strength, D7 missing prerequisite ───────────
// Best-effort: needs program_content_units for the candidate disciplines,
// which only exist once the plan-wide analysis (or this check, run before)
// has populated them. Silently contributes nothing (not an error) when
// there's nothing to compare — same honesty rule as MappingConfidence.

async function affinityFindings(
  teacherId: string, discipline: ProgramDiscipline, documentText: string,
  declared: DeclaredPrerequisiteLink[], allDisciplines: ProgramDiscipline[],
): Promise<PlacementFinding[]> {
  const out: PlacementFinding[] = []
  const disciplineEmbedText = selectRelevantSections(documentText, 4000)
  if (disciplineEmbedText.trim().length < 80) return out

  let ownEmbedding: number[]
  try {
    ownEmbedding = await embed(`${discipline.name}. ${disciplineEmbedText}`, { teacherId, feature: 'embedding' })
  } catch {
    return out   // embedding is best-effort here — never block the deterministic findings
  }

  const declaredInternalIds = new Set(
    declared.filter((d) => d.role === 'predecessor' && d.resolution === 'internal').map((d) => d.discipline_id!)
  )

  // D6 — for each declared predecessor with content units, check affinity.
  for (const id of declaredInternalIds) {
    const units = await listContentUnitsByDiscipline(id).catch(() => [])
    if (units.length === 0) continue
    const topicText = units.flatMap((u) => [u.title, ...u.topics]).join('. ').slice(0, 2000)
    if (topicText.trim().length < 20) continue
    const candEmbedding = await embed(topicText, { teacherId, feature: 'embedding' }).catch(() => null)
    if (!candEmbedding) continue
    const sim = cosine(ownEmbedding, candEmbedding)
    if (sim < AFFINITY_THRESHOLD * 0.6) {
      const name = declared.find((d) => d.discipline_id === id)?.raw_name ?? ''
      out.push(finding(
        'weak_rationale', 'suggestion', name,
        `Содержание «${name}» слабо пересекается с содержанием «${discipline.name}» — связь как ` +
        `с предшествующей дисциплиной выглядит формальной.`,
        'Проверьте, действительно ли эта дисциплина закладывает основу для текущей, либо уточните формулировку связи.',
      ))
    }
  }

  // D7 — earlier-semester disciplines NOT declared, with strong affinity.
  const candidates = allDisciplines.filter(
    (d) => d.id && d.id !== discipline.id && d.semester < discipline.semester && !declaredInternalIds.has(d.id)
  )
  const suggestions: { name: string; sim: number }[] = []
  for (const cand of candidates.slice(0, 15)) {   // cap — this is a per-review AI cost
    const units = await listContentUnitsByDiscipline(cand.id!).catch(() => [])
    if (units.length === 0) continue
    const topicText = units.flatMap((u) => [u.title, ...u.topics]).join('. ').slice(0, 2000)
    if (topicText.trim().length < 20) continue
    const candEmbedding = await embed(topicText, { teacherId, feature: 'embedding' }).catch(() => null)
    if (!candEmbedding) continue
    const sim = cosine(ownEmbedding, candEmbedding)
    if (sim >= AFFINITY_THRESHOLD) suggestions.push({ name: cand.name, sim })
  }
  suggestions.sort((a, b) => b.sim - a.sim)
  for (const s of suggestions.slice(0, 3)) {
    out.push(finding(
      'missing_link', 'suggestion', s.name,
      `«${s.name}» (семестр раньше текущего) по содержанию заметно перекликается с «${discipline.name}», ` +
      `но не упомянута в разделе 2 как предшествующая.`,
      `Рассмотрите добавление «${s.name}» в список предшествующих дисциплин, либо убедитесь, что ` +
      `пересечение содержания — не дублирование (см. «Задвоение содержания»).`,
    ))
  }

  return out
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// ── Public API ────────────────────────────────────────────────────────────

export interface ReviewPlacementParams {
  teacherId:       string
  program:         Program
  discipline:      ProgramDiscipline   // must have .id
  allDisciplines:  ProgramDiscipline[] // the whole plan, for D2/D7
  documentText:    string
  siblingReviews:  ProgramPlacementReview[]   // OTHER disciplines' latest placement reviews, for D3
}

export async function reviewPlacement(params: ReviewPlacementParams): Promise<PlacementReviewResult> {
  const text = (params.documentText ?? '').trim().slice(0, MAX_DOC_CHARS)
  if (text.length < 80) {
    return {
      declared: [], declared_program: null,
      findings: [finding('empty_section', 'warning', '', 'Недостаточно текста РПД для анализа раздела.', 'Загрузите полный текст рабочей программы.')],
      summary: 'Недостаточно содержания для анализа.',
    }
  }

  const parsed = await parsePlacementSection(params.teacherId, text)
  const declared = [
    ...resolveDeclared(parsed.predecessors, 'predecessor', params.allDisciplines),
    ...resolveDeclared(parsed.successors, 'successor', params.allDisciplines),
  ]

  const findings = [
    ...deterministicFindings(
      declared, parsed.declaredProgram, parsed.declaredProgramQuote,
      params.discipline, params.program, params.siblingReviews,
    ),
    ...await affinityFindings(params.teacherId, params.discipline, text, declared, params.allDisciplines).catch(() => []),
  ]

  return {
    declared,
    declared_program: parsed.declaredProgram,
    findings,
    summary: summarise(findings),
  }
}

function summarise(findings: PlacementFinding[]): string {
  if (findings.length === 0) {
    return 'Раздел «Место дисциплины в структуре ОП» согласован с учебным планом — противоречий не найдено.'
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
