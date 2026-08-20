import { chatJSON } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { ValidationError } from '../errors/AppError'
import { findCopiedOutcomeFormulations } from './outcomeFormulation'
import type {
  SyllabusReview, SyllabusCoverageItem, CoverageStatus, CoverageSource,
  ContentSection, RequirementKind, ParsedSyllabusReport, OutcomeFormulationFinding,
} from '../../../shared/types'

// КНИТУ admin feature A2 — «Анализ соответствия РПД». Structure-aware version:
// PARSE the РПД into requirements (цели / компетенции + индикаторы / Знать /
// Уметь / Владеть) and CONTENT sections (§5 лекции / §6 практ. / §7 лаб. /
// §8 СРС / §8.1 контроль); SCORE each requirement against the *content*
// sections (not the requirements section itself), citing which sections
// deliver it. Reuses chatJSON + verbatim-quote conventions from grading.
// Computed live, not persisted (MVP).

const MAX_SYLLABUS_CHARS  = 14000   // parser pass — sees the whole РПД
const MAX_CONTENT_CHARS   = 9000    // scorer pass — only the content sections
const MAX_REQUIREMENTS    = 40      // safety cap for prompt size
const VALID_STATUS: CoverageStatus[] = ['covered', 'partial', 'missing']
const VALID_SECTION: ContentSection[] = ['lectures', 'practicals', 'labs', 'independent', 'control']

const SECTION_LABEL: Record<ContentSection, string> = {
  lectures:    'LECTURES — лекционные занятия (§5)',
  practicals:  'PRACTICALS — практические/семинарские занятия (§6)',
  labs:        'LABS — лабораторные занятия (§7)',
  independent: 'INDEPENDENT — самостоятельная работа (§8)',
  control:     'CONTROL — контроль / промежуточная аттестация (§8.1)',
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface CompetencyInput { code: string; title: string }

export interface ReviewParams {
  teacherId:     string
  syllabusText:  string
  competencies?: CompetencyInput[]   // if omitted, parsed from the syllabus
  goals?:        string[]            // if omitted, parsed from the syllabus
}

export async function reviewSyllabus(params: ReviewParams): Promise<SyllabusReview> {
  const text = (params.syllabusText ?? '').trim().slice(0, MAX_SYLLABUS_CHARS)
  if (text.length < 80) {
    throw new ValidationError('Недостаточно содержания РПД для анализа.')
  }

  const competenciesProvided = (params.competencies?.length ?? 0) > 0
  const goalsProvided        = (params.goals?.length ?? 0) > 0

  // 1) Parse РПД into structured sections (requirements + content blocks).
  const parsed = await parseSyllabusStructure(params.teacherId, text)

  // 2) Overlay caller-provided competencies/goals (РПД-студия uses this path).
  if (competenciesProvided) {
    parsed.competencies = params.competencies!.map((c) => ({
      code: (c.code ?? '').trim(), title: c.title.trim(), indicators: [],
    }))
  }
  if (goalsProvided) {
    parsed.goals = params.goals!.map((g) => g.trim()).filter(Boolean)
  }

  // 3) Build the flat requirements list (with refs that survive the round-trip).
  const requirements = buildRequirements(parsed)
  if (requirements.length === 0) {
    throw new ValidationError(
      'Не удалось определить требования (цели/компетенции/результаты). Проверьте структуру РПД или укажите их вручную.'
    )
  }

  // 4) Score each requirement against the CONTENT sections only.
  const items = await scoreCoverage(params.teacherId, parsed.content, requirements)

  // 5) Formulation quality — is each ЗУВ item a real reformulation of the
  // indicator through this discipline's content, or just a copy of it?
  // Deterministic and independent of the coverage scoring above (see
  // services/outcomeFormulation.ts's header for why it's neither an LLM call
  // nor a status demotion). Empty on the РПД-студия path: caller-supplied
  // competencies carry no indicators to compare against.
  const formulationFindings = findCopiedOutcomeFormulations(
    parsed.competencies.flatMap((c) => c.indicators),
    { knowledge: parsed.outcomes.knowledge, skills: parsed.outcomes.skills, mastery: parsed.outcomes.mastery },
  )

  return {
    competencies_source: competenciesProvided ? 'provided' : 'declared',
    goals_source:        goalsProvided ? 'provided' : 'declared',
    parsed: parsedReport(parsed),
    items,
    formulation_findings: formulationFindings,
    summary: summarise(items, formulationFindings),
    covered: items.filter((i) => i.status === 'covered').length,
    partial: items.filter((i) => i.status === 'partial').length,
    missing: items.filter((i) => i.status === 'missing').length,
    generated_at: new Date().toISOString(),
  }
}

// Backward-compat for РПД-студия (`syllabusAuthor`) which seeds its authoring
// targets from a discipline's existing РПД. Returns just the flat shapes it
// needs; internally uses the structured parser so we keep one source of truth.
export async function extractDeclared(
  teacherId: string, syllabus: string
): Promise<{ competencies: CompetencyInput[]; goals: string[] }> {
  const parsed = await parseSyllabusStructure(teacherId, syllabus)
  return {
    competencies: parsed.competencies.map((c) => ({ code: c.code, title: c.title })),
    goals:        [...parsed.goals],
  }
}

// ── Internal types ────────────────────────────────────────────────────────────

interface ParsedCompetency {
  code:       string
  title:      string
  indicators: { code: string; title: string }[]
}
interface ParsedSyllabus {
  goals:         string[]
  competencies:  ParsedCompetency[]
  outcomes:      { knowledge: string[]; skills: string[]; mastery: string[] }
  // Раздел 13 «Образовательные технологии» — declared teaching methods.
  technologies:  string[]
  content:       Record<ContentSection, string | null>
}

export interface Requirement {
  ref:         string                 // stable id for the round-trip (G0 / C0 / I0_1 / K0 / S0 / M0)
  kind:        RequirementKind
  code:        string | null
  title:       string
  parent_code: string | null
}

// ── Parser pass — RPD → structured sections ───────────────────────────────────

// Topology graph substrate (docs/topology-spec.md, Increment 0) — the
// content-unit extractor (services/programContentUnits.ts) reuses this same
// whole-section parse instead of re-implementing РПД section splitting; it
// only needs the `content` blobs, not the requirements/competencies side of
// the parse.
export async function parseSyllabusContentSections(
  teacherId: string, text: string
): Promise<Record<ContentSection, string | null>> {
  return (await parseSyllabusStructure(teacherId, text)).content
}

async function parseSyllabusStructure(teacherId: string, text: string): Promise<ParsedSyllabus> {
  const system =
    'Вы — методист российского вуза. Вы извлекаете из текста рабочей программы дисциплины (РПД) ' +
    'её структурные элементы: цели, компетенции с индикаторами, планируемые результаты ' +
    '(Знать/Уметь/Владеть), образовательные технологии и разделы содержания (лекции, практические, ' +
    'лабораторные, СРС, контроль). Берите формулировки из текста, не выдумывайте. Отвечайте только ' +
    'валидным JSON на русском языке.'

  const user =
    `## Текст РПД\n${sanitiseForPrompt(text)}\n\n` +
    `## Задача\nИзвлеките структуру РПД.\n\n` +
    `1) "goals" — массив строк: цели освоения дисциплины (раздел «Цели освоения»).\n\n` +
    `2) "competencies" — массив компетенций (раздел «Компетенции»). Для каждой:\n` +
    `   - "code": код вида "ОПК-1" / "ПК-3" / "УК-2" (или "" если кода нет),\n` +
    `   - "title": формулировка компетенции,\n` +
    `   - "indicators": массив индикаторов достижения (например 3.1, 3.2). Для каждого:\n` +
    `     {"code": "ОПК-1.1" или "3.1", "title": "..."}\n\n` +
    `3) "outcomes" — планируемые результаты обучения («В результате освоения … должен»). Объект:\n` +
    `   - "knowledge": массив пунктов из «Знать:» (каждый пункт — отдельная строка),\n` +
    `   - "skills": массив пунктов из «Уметь:»,\n` +
    `   - "mastery": массив пунктов из «Владеть:».\n\n` +
    `5) "technologies" — массив строк: образовательные технологии из раздела «Образовательные ` +
    `технологии» (обычно раздел 13) — например «проблемное обучение», «работа в малых группах», ` +
    `«кейс-метод», «дистанционные образовательные технологии». Каждая — отдельная строка, дословно ` +
    `или близко к тексту. Пустой массив, если раздела нет.\n\n` +
    `4) "content" — РАЗДЕЛЫ СОДЕРЖАНИЯ (что реально преподаётся/делается). Объект с пятью полями:\n` +
    `   - "lectures": текст раздела о лекционных занятиях (полностью), либо null,\n` +
    `   - "practicals": текст раздела о практических/семинарских, либо null,\n` +
    `   - "labs": текст раздела о лабораторных занятиях, либо null,\n` +
    `   - "independent": текст раздела о самостоятельной работе студентов (СРС), либо null,\n` +
    `   - "control": текст раздела о контроле/промежуточной аттестации/ФОС/КСР, либо null.\n` +
    `Если соответствующего раздела в РПД нет — null или пустой массив. Не выдумывайте контент.\n\n` +
    `## Формат\nВерните JSON: {"goals":[...],"competencies":[...],"outcomes":{...},"technologies":[...],"content":{...}}. Только JSON.`

  const result = await chatJSON<RawParse>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'структура РПД',
    // temperature 0 — this is pure extraction, and the provider default (1.0)
    // made the parse itself non-deterministic: the same РПД would sometimes
    // lose a whole content section (e.g. §6 практ.) between runs, so the
    // scorer saw different evidence and the verdict counts jumped around.
    { context: { teacherId, feature: 'grading' }, temperature: 0 },
  )

  return normaliseParse(result)
}

interface RawParse {
  goals?:         unknown
  competencies?:  { code?: string; title?: string; indicators?: { code?: string; title?: string }[] }[]
  outcomes?:      { knowledge?: unknown; skills?: unknown; mastery?: unknown }
  technologies?:  unknown
  content?:       Partial<Record<ContentSection, string | null>>
}

function normaliseParse(r: RawParse): ParsedSyllabus {
  const strArr = (x: unknown): string[] =>
    Array.isArray(x) ? x.map((v) => String(v ?? '').trim()).filter(Boolean) : []

  const competencies: ParsedCompetency[] = (r.competencies ?? []).map((c) => ({
    code:  String(c.code ?? '').trim(),
    title: String(c.title ?? '').trim(),
    indicators: (c.indicators ?? [])
      .map((i) => ({ code: String(i.code ?? '').trim(), title: String(i.title ?? '').trim() }))
      .filter((i) => i.title),
  })).filter((c) => c.title)

  const content = Object.fromEntries(
    VALID_SECTION.map((s) => [s, normContent(r.content?.[s])])
  ) as Record<ContentSection, string | null>

  return {
    goals:        strArr(r.goals),
    competencies,
    outcomes: {
      knowledge: strArr(r.outcomes?.knowledge),
      skills:    strArr(r.outcomes?.skills),
      mastery:   strArr(r.outcomes?.mastery),
    },
    technologies: strArr(r.technologies),
    content,
  }
}

function normContent(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t.length >= 30 ? t : null   // tiny snippets aren't real sections
}

// ── Build the flat requirement list with stable refs ──────────────────────────

function buildRequirements(p: ParsedSyllabus): Requirement[] {
  const out: Requirement[] = []
  p.goals.forEach((g, i)        => out.push({ ref: `G${i}`,  kind: 'goal',       code: null,                  title: g, parent_code: null }))
  p.competencies.forEach((c, i) => {
    out.push({ ref: `C${i}`, kind: 'competency', code: c.code || null, title: c.title, parent_code: null })
    c.indicators.forEach((ind, k) => {
      out.push({ ref: `I${i}_${k}`, kind: 'indicator', code: ind.code || null, title: ind.title, parent_code: c.code || null })
    })
  })
  p.outcomes.knowledge.forEach((t, i) => out.push({ ref: `K${i}`, kind: 'knowledge', code: null, title: t, parent_code: null }))
  p.outcomes.skills.forEach((t, i)    => out.push({ ref: `S${i}`, kind: 'skill',     code: null, title: t, parent_code: null }))
  p.outcomes.mastery.forEach((t, i)   => out.push({ ref: `M${i}`, kind: 'mastery',   code: null, title: t, parent_code: null }))
  p.technologies.forEach((t, i)       => out.push({ ref: `TC${i}`, kind: 'technology', code: null, title: t, parent_code: null }))
  return out.slice(0, MAX_REQUIREMENTS)
}

// Раздел 13 «Образовательные технологии» must be checked against how
// independent work and assessment are actually RUN — a declared «кейс-метод»
// that never shows up in СРС/ФОС is exactly what the УМЦ head asked to
// catch. Every other kind may cite any content section, as before.
const ALLOWED_SECTIONS: Record<RequirementKind, readonly ContentSection[]> = {
  goal: VALID_SECTION, competency: VALID_SECTION, indicator: VALID_SECTION,
  knowledge: VALID_SECTION, skill: VALID_SECTION, mastery: VALID_SECTION,
  technology: ['independent', 'control'],
}

// ── Scorer pass — score each requirement against the CONTENT sections only ────

export interface RawScored {
  ref?:            string
  status?:         string
  score?:          number
  sources?:        { section?: string; excerpt?: string }[]
  gap?:            string
  recommendation?: string
}

async function scoreCoverage(
  teacherId: string,
  content: Record<ContentSection, string | null>,
  requirements: Requirement[],
): Promise<SyllabusCoverageItem[]> {
  const contentBlock = buildContentBlock(content)
  const reqBlock     = buildRequirementsBlock(requirements)

  const system =
    'Вы — эксперт по качеству учебных программ российского вуза. Вы оцениваете, действительно ли ' +
    'содержание лекций, практических, лабораторных, СРС и контроля обеспечивает заявленные ' +
    'требования (цели, компетенции, индикаторы, Знать/Уметь/Владеть). Отвечайте только валидным JSON на русском.'

  const user =
    `## Содержание РПД (что реально преподаётся и оценивается)\n${contentBlock}\n\n` +
    `## Требования к обеспечению\n${reqBlock}\n\n` +
    `## Задача\nДля КАЖДОГО требования (с ref) определите, обеспечивает ли его СОДЕРЖАНИЕ выше.\n` +
    `ВАЖНО: ищите подтверждение в РАЗДЕЛАХ СОДЕРЖАНИЯ (LECTURES/PRACTICALS/LABS/INDEPENDENT/CONTROL), ` +
    `а не в формулировке самого требования. Для требований типа «Образовательные технологии» ` +
    `(раздел 13) ищите подтверждение ТОЛЬКО в INDEPENDENT (СРС) и CONTROL (контроль/ФОС/КСР) — ` +
    `действительно ли заявленная технология обучения отражена в том, как организована самостоятельная ` +
    `работа и аттестация, а не просто упомянута в лекциях.\n\n` +
    `## Критерии статуса (применяйте строго, в этом порядке)\n` +
    `- "covered": в содержании есть тема/занятие/форма контроля, ПРЯМО обеспечивающая требование ` +
    `(тот же предмет деятельности, а не смежный) — и вы можете привести дословную цитату.\n` +
    `- "partial": в содержании есть только СМЕЖНАЯ тема (часть требования обеспечена, часть нет), ` +
    `либо тема упомянута без соответствующей деятельности (например, «Знать» подкреплено лекцией, ` +
    `но «Уметь»-требование не имеет ни практического занятия, ни лабораторной).\n` +
    `- "missing": ни одной цитаты из содержания привести нельзя — опереться не на что.\n` +
    `Правило при сомнении между двумя статусами: выбирайте более строгий (ниже) статус.\n\n` +
    `## Формат ответа\nВерните JSON: {"items":[ ... ]}, где каждый элемент:\n` +
    `- "ref": идентификатор требования из списка выше,\n` +
    `- "status": "covered" / "partial" / "missing",\n` +
    `- "score": число 0–100 (степень покрытия),\n` +
    `- "sources": массив до 3 источников: [{"section": "lectures|practicals|labs|independent|control", ` +
    `"excerpt": "ДОСЛОВНАЯ цитата 5–20 слов из этого раздела"}]. Пустой массив, если опереться не на что.\n` +
    `- "gap": что слабо/отсутствует (1–2 предложения; пусто, если covered),\n` +
    `- "recommendation": конкретная рекомендация — в какой раздел и что добавить (1 предложение).\n` +
    `Не выдумывайте цитаты. Ответьте ТОЛЬКО JSON-объектом.`

  const result = await chatJSON<{ items: RawScored[] }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'оценка покрытия РПД',
    // temperature 0 — classification over a fixed evidence set. At the
    // provider default (1.0) borderline requirements flipped between
    // covered/partial on every run; greedy decoding + the explicit status
    // rubric above pins the same input to (almost always) the same verdict.
    { context: { teacherId, feature: 'grading' }, temperature: 0 },
  )

  const byRef = new Map<string, RawScored>()
  for (const it of result.items ?? []) {
    if (it.ref) byRef.set(String(it.ref).trim().toUpperCase(), it)
  }

  // Pre-normalised haystacks per section, for verbatim excerpt validation
  // (same anti-hallucination contract as grading's validateCitation — rule #2).
  const haystacks = Object.fromEntries(
    VALID_SECTION.map((s) => [s, normaliseForMatch(content[s] ?? '')])
  ) as Record<ContentSection, string>

  return requirements.map((req) => toItem(req, byRef.get(req.ref.toUpperCase()), haystacks))
}

function normaliseForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function buildContentBlock(content: Record<ContentSection, string | null>): string {
  const present = VALID_SECTION.filter((s) => content[s])
  if (present.length === 0) return '— разделы содержания не найдены в РПД —'

  // Cap proportionally so the prompt stays in budget.
  const budget = Math.floor(MAX_CONTENT_CHARS / present.length)
  return present.map((s) =>
    `### ${SECTION_LABEL[s]}\n${sanitiseForPrompt((content[s] ?? '').slice(0, budget))}`
  ).join('\n\n')
}

function buildRequirementsBlock(reqs: Requirement[]): string {
  const groups: Record<RequirementKind, Requirement[]> = {
    goal: [], competency: [], indicator: [], knowledge: [], skill: [], mastery: [], technology: [],
  }
  for (const r of reqs) groups[r.kind].push(r)

  const header: Record<RequirementKind, string> = {
    goal: '### Цели', competency: '### Компетенции', indicator: '### Индикаторы достижения',
    knowledge: '### Знать', skill: '### Уметь', mastery: '### Владеть',
    technology: '### Образовательные технологии',
  }
  return (['goal','competency','indicator','knowledge','skill','mastery','technology'] as RequirementKind[])
    .filter((k) => groups[k].length > 0)
    .map((k) => `${header[k]}\n` + groups[k].map((r) =>
      `${r.ref}.${r.code ? ` [${sanitiseForPrompt(r.code)}]` : ''} ${sanitiseForPrompt(r.title)}`
    ).join('\n'))
    .join('\n\n')
}

// Exported for unit tests (excerpt validation + rubric-enforcement demotion) —
// same convention as longReview.ts's clusterByName.
export function toItem(
  req: Requirement,
  raw: RawScored | undefined,
  haystacks: Record<ContentSection, string>,
): SyllabusCoverageItem {
  let status: CoverageStatus = VALID_STATUS.includes(raw?.status as CoverageStatus)
    ? (raw!.status as CoverageStatus)
    : 'missing'

  // Keep a source only if its excerpt genuinely appears (verbatim,
  // case/whitespace-insensitive) in the claimed section — hallucinated
  // quotes get dropped rather than shown to the admin as "evidence".
  // Sections this requirement's kind is even allowed to cite (technology →
  // independent/control only, everything else → all five, see
  // ALLOWED_SECTIONS) — enforced here, not just asked for in the prompt, so
  // a model citing a lecture for a declared технология can't slip through.
  const allowed = ALLOWED_SECTIONS[req.kind]
  const sources: CoverageSource[] = (raw?.sources ?? [])
    .map((s) => ({
      section: (VALID_SECTION as readonly string[]).includes(String(s.section)) ? (s.section as ContentSection) : null,
      excerpt: String(s.excerpt ?? '').trim(),
    }))
    .filter((s): s is CoverageSource =>
      s.section !== null &&
      allowed.includes(s.section) &&
      s.excerpt.length >= 8 &&
      haystacks[s.section].includes(normaliseForMatch(s.excerpt))
    )
    .slice(0, 3)

  // Enforce the scoring rubric deterministically: "covered" requires at
  // least one verifiable citation. If every quote failed validation, the
  // claim is unverified — demote to partial so the admin sees it flagged,
  // and discard the model's score along with it (it rated the unverified
  // "covered" claim, not the demoted state).
  let demoted = false
  if (status === 'covered' && sources.length === 0) { status = 'partial'; demoted = true }

  return {
    kind:           req.kind,
    code:           req.code,
    title:          req.title,
    parent_code:    req.parent_code,
    status,
    score:          clampScore(demoted ? undefined : raw?.score, status),
    sources,
    evidence:       sources[0]?.excerpt ?? null,    // back-compat with existing UI
    gap:            (raw?.gap ?? '').trim(),
    recommendation: (raw?.recommendation ?? '').trim(),
  }
}

function clampScore(score: number | undefined, status: CoverageStatus): number {
  if (typeof score === 'number' && isFinite(score)) {
    return Math.max(0, Math.min(100, Math.round(score)))
  }
  return status === 'covered' ? 90 : status === 'partial' ? 55 : 15
}

// ── Reports + verdict ─────────────────────────────────────────────────────────

function parsedReport(p: ParsedSyllabus): ParsedSyllabusReport {
  return {
    goals_count:        p.goals.length,
    competencies_count: p.competencies.length,
    indicators_count:   p.competencies.reduce((n, c) => n + c.indicators.length, 0),
    knowledge_count:    p.outcomes.knowledge.length,
    skills_count:       p.outcomes.skills.length,
    mastery_count:      p.outcomes.mastery.length,
    technologies_count: p.technologies.length,
    content_sections:   VALID_SECTION.filter((s) => p.content[s]),
  }
}

// The formulation findings deliberately reach the verdict line too. Without
// this, a РПД whose ЗУВ items are copy-pasted indicators but whose content
// does deliver them would read as «полностью обеспечивает» — which is the
// exact false all-clear the методист flagged. Coverage and formulation stay
// separate facts; the summary just refuses to report one without the other.
function summarise(items: SyllabusCoverageItem[], findings: OutcomeFormulationFinding[] = []): string {
  const total   = items.length
  if (total === 0) return 'Нет элементов для оценки.'
  const missing = items.filter((i) => i.status === 'missing').length
  const partial = items.filter((i) => i.status === 'partial').length

  const formulationNote = findings.length > 0
    ? ` Отдельно: ${findings.length} ${plural(findings.length, 'формулировка', 'формулировки', 'формулировок')} ` +
      `«Знать/Уметь/Владеть» дословно повторяет индикаторы компетенций — их нужно переформулировать через содержание дисциплины.`
    : ''

  if (missing === 0 && partial === 0) {
    return `Содержание РПД полностью обеспечивает заявленные требования.${formulationNote}`
  }
  const parts: string[] = []
  if (missing) parts.push(`${missing} не обеспечено`)
  if (partial) parts.push(`${partial} частично`)
  return `Из ${total} требований: ${parts.join(', ')}. Требуется доработка содержания РПД.${formulationNote}`
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
