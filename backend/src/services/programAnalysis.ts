import { chatJSON, embed } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { findCourseById } from '../db/queries/courses'
import { getLatestKnowledgeText } from '../db/queries/documents'
import { ValidationError } from '../errors/AppError'
import { logger } from '../lib/logger'
import type {
  ProgramDetail, ProgramDiscipline, ProgramCompetency, ProgramAnalysis,
  PrerequisiteEdge, SequencingResult, SequencingStructure, SequencingLayerNode,
  CompetencyProgressionRow, CompetencyTimelineCell, OutcomeDelivery, MappingConfidence,
  CoverageLevel, RedundancyItem, RelatednessCluster, SemesterLoad, LoadCheck,
} from '../../../shared/types'

// Program-level architecture analysis (учебные планы). Given an ordered,
// semester-by-semester list of disciplines + the ФГОС competencies/goals the
// plan must deliver, produce four analyses:
//   1) relatedness & load   — embeddings + in-process cosine (+ credit/count tally)
//   2) sequencing & prereqs — one LLM call → prerequisite edges + inversion flags
//   3) competency progression — one LLM call → per-competency introduce/develop/master timeline
//   4) gaps & redundancy    — derived in-process from (2)+(3)
// Reuses embed()/cosine + the Yandex rate-limit backoff from curriculumAnalysis,
// and the chatJSON + verbatim conventions from the grading/syllabus services.

const MAX_DISCIPLINES   = 60
const MAX_CONTENT_CHARS = 1500   // per discipline, when a linked course has РПД text
const EMBED_SPACING_MS  = 120
const EMBED_MAX_RETRIES = 4
const RELATED_THRESHOLD = 0.62   // cosine floor to treat two disciplines as related
const ISOLATED_MAX_SIM  = 0.45   // best match below this → discipline is isolated

const VALID_LEVEL: CoverageLevel[] = ['introduce', 'develop', 'master']

interface PreparedDiscipline {
  d:          ProgramDiscipline
  embedText:  string
  embedding:  number[]
}

export async function analyzeProgram(params: {
  teacherId:      string
  institutionId?: string
  program:        ProgramDetail
}): Promise<ProgramAnalysis> {
  const { teacherId, institutionId, program } = params

  const disciplines = [...program.disciplines]
    .sort((a, b) => a.semester - b.semester || a.sort_order - b.sort_order)
    .slice(0, MAX_DISCIPLINES)

  if (disciplines.length < 2) {
    throw new ValidationError('Добавьте минимум две дисциплины в учебный план для анализа.')
  }

  // 1) Relatedness & load — embed each discipline, cross-compare, tally load.
  const prepared = await prepareAndEmbed(teacherId, disciplines)
  const { clusters, isolated } = clusterByRelatedness(prepared)
  const load = computeLoad(disciplines, program.duration_semesters)

  // 2) Sequencing & prerequisites (best-effort — never blocks the report).
  let sequencing: SequencingResult = { verdict: '', flow_score: 0, edges: [], inversions: [] }
  try {
    sequencing = await analyzeSequencing(teacherId, institutionId, disciplines)
  } catch (err) {
    logger.warn({ message: 'Program sequencing analysis failed', error: (err as Error).message })
  }

  // 3) Competency progression (best-effort).
  let progression: CompetencyProgressionRow[] = []
  if (program.competencies.length > 0) {
    try {
      progression = await analyzeProgression(teacherId, institutionId, disciplines, program.competencies)
    } catch (err) {
      logger.warn({ message: 'Program progression analysis failed', error: (err as Error).message })
    }
  }

  // 4) Gaps & redundancy — derived from (2)+(3) + declared codes.
  const { orphans, missing } = deriveGaps(disciplines, progression)

  const score = overallScore(sequencing, progression)

  return {
    generated_at:  new Date().toISOString(),
    overall_score: score,
    summary:       buildSummary(sequencing, progression, orphans, missing),
    sequencing,
    progression,
    orphans,
    missing,
    clusters,
    isolated,
    load,
    outcome_delivery:   deriveOutcomeDelivery(progression),
    mapping_confidence: program.competencies.length > 0 ? deriveMappingConfidence(disciplines) : undefined,
    load_check:         deriveLoadCheck(load, disciplines, program.duration_semesters),
  }
}

// Sanity-check the credit load against ФГОС ВО (60 з.е./academic year). The
// chart just sums extracted ЗЕТ, so a truncated/mis-parsed plan shows wrong
// totals silently — this surfaces the tells: disciplines with no ЗЕТ (dropped
// from the sum), a total short of 60×years (missing tail), and years far from
// 60 з.е. (semesters dumped together). Pure — no I/O.
const YEAR_TARGET = 60
const YEAR_TOLERANCE = 5   // accept 55–65 з.е./year; outside → likely a parse error

export function deriveLoadCheck(
  load: SemesterLoad[], disciplines: ProgramDiscipline[], duration: number
): LoadCheck {
  const total_credits = round1(load.reduce((sum, l) => sum + (l.credits ?? 0), 0))
  const years = Math.max(1, Math.round((duration || load.length) / 2))
  const expected_total = years * YEAR_TARGET
  const without = disciplines.filter((d) => d.credits == null).length

  const issues: string[] = []

  if (without > 0) {
    issues.push(`${without} ${plural(without, 'дисциплина', 'дисциплины', 'дисциплин')} без ЗЕТ — не учтены в нагрузке.`)
  }
  if (total_credits > 0 && Math.abs(total_credits - expected_total) > YEAR_TOLERANCE) {
    issues.push(
      `Всего ${total_credits} з.е. вместо ожидаемых ${expected_total} (60 з.е. × ${years} ` +
      `${plural(years, 'год', 'года', 'лет')}) — учебный план, вероятно, распознан не полностью.`
    )
  }
  // Per-year deviations — the ФГОС invariant is 60 з.е./year. Only flag years
  // whose both semesters carry credit data (else it's a null-ЗЕТ issue above).
  for (let y = 1; y <= years; y++) {
    const a = load.find((l) => l.semester === 2 * y - 1)
    const b = load.find((l) => l.semester === 2 * y)
    if (!a || !b || a.credits == null || b.credits == null) continue
    const yearCredits = round1((a.credits ?? 0) + (b.credits ?? 0))
    if (Math.abs(yearCredits - YEAR_TARGET) > YEAR_TOLERANCE) {
      issues.push(`Год ${y} (сем. ${2 * y - 1}–${2 * y}): ${yearCredits} з.е. вместо 60.`)
    }
  }

  return { total_credits, expected_total, disciplines_without_credits: without, issues }
}

// How much of the competency→discipline mapping rests on authoritative declared
// codes vs. name inference. When under half the disciplines declare any codes,
// «uncovered» gaps are likely name-inference artefacts, not real absences — the
// UI uses `low` to caveat the gaps section.
export function deriveMappingConfidence(disciplines: ProgramDiscipline[]): MappingConfidence {
  const total = disciplines.length
  const withCodes = disciplines.filter((d) => d.competency_codes.length > 0).length
  return {
    disciplines_total:      total,
    disciplines_with_codes: withCodes,
    low:                    total > 0 && withCodes / total < 0.5,
  }
}

// ── Outcome-delivery synthesis ──────────────────────────────────────────────
//
// The headline the РОП actually wants: does the WHOLE plan build up the
// graduate profile? Pure roll-up of the per-competency progression statuses
// (no extra LLM call). `ok` = fully built (introduce→develop→master); `thin` =
// built once (no development); `late` = introduced too late; `uncovered` = no
// discipline forms it at all. Verdict:
//   delivered — every requirement fully built (nothing thin/late/uncovered)
//   gaps      — ≥1 requirement uncovered (the plan literally doesn't deliver it)
//   partial   — all covered, but some thin/late (delivered weakly, not absent)
// Returns undefined when there's no competency data to synthesise.

export function deriveOutcomeDelivery(
  progression: CompetencyProgressionRow[]
): OutcomeDelivery | undefined {
  const total = progression.length
  if (total === 0) return undefined

  const fully     = progression.filter((r) => r.status === 'ok').length
  const thin      = progression.filter((r) => r.status === 'thin').length
  const late      = progression.filter((r) => r.status === 'late').length
  const uncovered = progression.filter((r) => r.status === 'uncovered').length

  // Delivery score: fully built = 1, thin/late = 0.6 (built, but weakly/late),
  // uncovered = 0. Mean × 100.
  const score = Math.round(((fully * 1 + (thin + late) * 0.6) / total) * 100)

  const verdict: OutcomeDelivery['verdict'] =
    uncovered > 0 ? 'gaps'
    : (thin + late) > 0 ? 'partial'
    : 'delivered'

  const headline =
    verdict === 'delivered'
      ? `Программа формирует все ${total} заявленных результатов: каждый развивается последовательно от введения к владению.`
      : verdict === 'gaps'
        ? `${uncovered} из ${total} результатов не формируются ни одной дисциплиной — профиль выпускника обеспечен не полностью. Полностью сформированы: ${fully}.`
        : `Все ${total} результатов формируются, но ${thin + late} — поверхностно или поздно (нет последовательного развития). Полностью сформированы: ${fully}.`

  return { total, fully, thin, late, uncovered, score, verdict, headline }
}

// ── 1) Embedding + relatedness ──────────────────────────────────────────────────

async function prepareAndEmbed(
  teacherId: string, disciplines: ProgramDiscipline[]
): Promise<PreparedDiscipline[]> {
  const out: PreparedDiscipline[] = []
  for (const d of disciplines) {
    const content = await resolveContent(d, teacherId)
    const embedText = content ? `${d.name}. ${content}` : d.name
    const embedding = await embedWithBackoff(embedText.slice(0, MAX_CONTENT_CHARS + 200), teacherId)
    out.push({ d, embedText, embedding })
    await sleep(EMBED_SPACING_MS)
  }
  return out
}

async function resolveContent(d: ProgramDiscipline, teacherId: string): Promise<string> {
  if (!d.course_id) return ''
  try {
    const course = await findCourseById(d.course_id, teacherId)
    const inline = (course?.syllabus_text ?? '').trim()
    if (inline.length >= 80) return inline.slice(0, MAX_CONTENT_CHARS)
    const doc = await getLatestKnowledgeText(d.course_id, teacherId)
    return [inline, doc ?? ''].filter(Boolean).join('\n\n').trim().slice(0, MAX_CONTENT_CHARS)
  } catch {
    return ''
  }
}

function clusterByRelatedness(
  prepared: PreparedDiscipline[]
): { clusters: RelatednessCluster[]; isolated: string[] } {
  const n = prepared.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  const union = (a: number, b: number) => { parent[find(a)] = find(b) }

  const bestSim = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = cosine(prepared[i].embedding, prepared[j].embedding)
      bestSim[i] = Math.max(bestSim[i], sim)
      bestSim[j] = Math.max(bestSim[j], sim)
      if (sim >= RELATED_THRESHOLD) union(i, j)
    }
  }

  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(i)
  }

  const clusters: RelatednessCluster[] = []
  for (const members of groups.values()) {
    if (members.length < 2) continue          // singletons aren't a cluster
    if (members.length > n * 0.6) continue     // a near-everything blob isn't informative
    const names = members.map((i) => prepared[i].d.name)
    clusters.push({ label: names.slice(0, 2).join(' · '), disciplines: names })
  }
  clusters.sort((a, b) => b.disciplines.length - a.disciplines.length)

  const isolated = prepared
    .filter((_, i) => bestSim[i] < ISOLATED_MAX_SIM)
    .map((p) => p.d.name)

  return { clusters, isolated }
}

function computeLoad(disciplines: ProgramDiscipline[], duration: number): SemesterLoad[] {
  const maxSem = Math.max(duration, ...disciplines.map((d) => d.semester))
  const load: SemesterLoad[] = []
  for (let s = 1; s <= maxSem; s++) {
    const inSem = disciplines.filter((d) => d.semester === s)
    const credited = inSem.filter((d) => d.credits != null)
    load.push({
      semester: s,
      discipline_count: inSem.length,
      credits: credited.length > 0 ? round1(credited.reduce((n, d) => n + (d.credits ?? 0), 0)) : null,
    })
  }
  return load
}

// ── 2) Sequencing & prerequisites ───────────────────────────────────────────────

async function analyzeSequencing(
  teacherId: string, institutionId: string | undefined, disciplines: ProgramDiscipline[]
): Promise<SequencingResult> {
  const layout = buildLayout(disciplines)
  const semesterOf = new Map(disciplines.map((d) => [norm(d.name), d.semester]))

  const system =
    'Вы — методист российского вуза, эксперт по проектированию учебных планов. Вы выявляете ' +
    'предпосылки между дисциплинами: какая дисциплина является фундаментом для другой. ' +
    'Классификацию порядка делает система по номерам семестров — вам нужно лишь определить ' +
    'сами связи и обосновать их. Отвечайте только валидным JSON на русском.'

  // The model only proposes prerequisite links + reasons. Whether a link is an
  // ordering violation is decided here, deterministically, from the semesters —
  // so the verdict, the flag and the recommendation can never contradict.
  const user =
    `## Учебный план (по семестрам)\n${layout}\n\n` +
    `## Задача\n` +
    `1) Определите ключевые пары «предпосылка → зависимая дисциплина» (A → B: B опирается на ` +
    `знания/умения из A). Сосредоточьтесь на фундаментальных и профессиональных дисциплинах ` +
    `(математика, физика, механика, материаловедение, профильные). У общеобразовательных ` +
    `(история, философия, физкультура, иностранный язык) предпосылок обычно нет — не включайте их. ` +
    `Найдите 8–20 наиболее значимых связей. Используйте ТОЧНЫЕ названия из плана. Для каждой связи ` +
    `дайте reason — почему B опирается на A (1 предложение). Рекомендации НЕ пишите.\n` +
    `2) Дайте краткую оценку общей логики (verdict, 1–2 предложения): выстроены ли дисциплины от ` +
    `фундаментальных к профильным. НЕ упоминайте количество нарушений и НЕ утверждайте об их ` +
    `наличии или отсутствии — это определит система автоматически по семестрам. Также дайте ` +
    `flow_score (0–100): насколько грамотно выстроен порядок.\n\n` +
    `## Формат ответа\nВерните JSON: {"verdict":"...","flow_score":75,"edges":[` +
    `{"from":"<название A>","to":"<название B>","reason":"почему B зависит от A"}]}. Только JSON.`

  const result = await chatJSON<{
    verdict?: string; flow_score?: number
    edges?: { from?: string; to?: string; reason?: string }[]
  }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'анализ последовательности дисциплин',
    { context: { teacherId, institutionId, feature: 'grading' }, maxTokens: 3500 },
  )

  const edges: PrerequisiteEdge[] = []
  const seen = new Set<string>()
  for (const e of result.edges ?? []) {
    const fromName = String(e.from ?? '').trim()
    const toName   = String(e.to ?? '').trim()
    const fromSem  = semesterOf.get(norm(fromName))
    const toSem    = semesterOf.get(norm(toName))
    if (fromSem == null || toSem == null) continue   // unmatched name — skip
    const key = `${norm(fromName)}>${norm(toName)}`
    if (seen.has(key)) continue
    seen.add(key)

    // Strict inversion only: dependent is taught in an EARLIER semester than its
    // prerequisite. Same-semester links are valid (intra-semester order is the
    // teacher's call) and stay as ordinary justified links.
    const inverted = toSem < fromSem
    edges.push({
      from_name: fromName, from_semester: fromSem,
      to_name: toName,     to_semester: toSem,
      reason: String(e.reason ?? '').trim(),
      inverted,
      recommendation: inverted
        ? `«${toName}» (сем. ${toSem}) опирается на «${fromName}» (сем. ${fromSem}), но изучается раньше — перенесите «${fromName}» на более ранний семестр или «${toName}» на более поздний.`
        : '',
    })
  }

  const inversions = edges.filter((e) => e.inverted)
  // Append a verdict sentence that always agrees with the deterministic count,
  // so the prose never contradicts the «нарушений порядка» stat.
  const invSentence = inversions.length === 0
    ? 'Нарушений хронологии — когда дисциплина изучается раньше своей предпосылки — не выявлено.'
    : `Выявлено нарушений хронологии: ${inversions.length} — подробности ниже.`
  const baseVerdict = String(result.verdict ?? '').trim()

  return {
    verdict:    [baseVerdict, invSentence].filter(Boolean).join(' '),
    flow_score: clampScore(result.flow_score),
    edges,
    inversions,
    structure:  deriveStructure(edges, disciplines),
  }
}

// ── Holistic structure derived from the prerequisite edges ──────────────────
//
// Turns the flat pairwise list into the whole-plan shape the reader actually
// wants: which disciplines are foundational, what builds on what, the critical
// prerequisite spines, and what sits outside the dependency graph. Pure graph
// derivation over `edges` — no extra LLM call. An edge from A→B means B depends
// on A (A is the prerequisite), so depth(B) = 1 + max(depth of B's
// prerequisites). Cycle-safe: a node revisited on the current DFS stack
// contributes depth 0 (breaks the loop) rather than recursing forever — real
// plans are acyclic, but a stray model edge shouldn't hang the analysis.

export function deriveStructure(
  edges: PrerequisiteEdge[], disciplines: ProgramDiscipline[]
): SequencingStructure {
  const semesterOf = new Map(disciplines.map((d) => [norm(d.name), d.semester]))
  const displayName = new Map(disciplines.map((d) => [norm(d.name), d.name]))

  // Adjacency by normalised name. prereqsOf[x] = disciplines x depends on.
  const prereqsOf = new Map<string, string[]>()   // dependent → its prerequisites
  const dependentsOf = new Map<string, string[]>() // prerequisite → what depends on it
  const inGraph = new Set<string>()
  for (const e of edges) {
    const from = norm(e.from_name), to = norm(e.to_name)
    if (from === to) continue
    inGraph.add(from); inGraph.add(to)
    displayName.set(from, e.from_name); displayName.set(to, e.to_name)
    if (!semesterOf.has(from)) semesterOf.set(from, e.from_semester)
    if (!semesterOf.has(to))   semesterOf.set(to,   e.to_semester)
    ;(prereqsOf.get(to)     ?? prereqsOf.set(to, []).get(to)!).push(from)
    ;(dependentsOf.get(from) ?? dependentsOf.set(from, []).get(from)!).push(to)
  }

  const node = (n: string): SequencingLayerNode => ({ name: displayName.get(n) ?? n, semester: semesterOf.get(n) ?? 0 })

  // Longest-prerequisite depth per node (cycle-safe memoised DFS).
  const depthCache = new Map<string, number>()
  const depthOf = (n: string, stack: Set<string>): number => {
    const cached = depthCache.get(n)
    if (cached != null) return cached
    if (stack.has(n)) return 0                       // cycle — break
    stack.add(n)
    const prereqs = prereqsOf.get(n) ?? []
    const d = prereqs.length === 0 ? 0 : 1 + Math.max(...prereqs.map((p) => depthOf(p, stack)))
    stack.delete(n)
    depthCache.set(n, d)
    return d
  }

  // Group connected nodes into dependency layers.
  const byDepth = new Map<number, SequencingLayerNode[]>()
  for (const n of inGraph) {
    const d = depthOf(n, new Set())
    ;(byDepth.get(d) ?? byDepth.set(d, []).get(d)!).push(node(n))
  }
  const layers: SequencingStructure['layers'] = [...byDepth.keys()].sort((a, b) => a - b).map((depth) => ({
    depth,
    disciplines: byDepth.get(depth)!.sort((a, b) => a.semester - b.semester || a.name.localeCompare(b.name, 'ru')),
  }))

  // Longest prerequisite chains — the spines where a misplacement cascades.
  // Longest path ending at each node, reconstructed via best predecessor.
  const bestPrev = new Map<string, string | null>()
  const pathLen = new Map<string, number>()
  const lenOf = (n: string, stack: Set<string>): number => {
    const cached = pathLen.get(n)
    if (cached != null) return cached
    if (stack.has(n)) return 1
    stack.add(n)
    let best = 1, prev: string | null = null
    for (const p of prereqsOf.get(n) ?? []) {
      const l = 1 + lenOf(p, stack)
      if (l > best) { best = l; prev = p }
    }
    stack.delete(n)
    pathLen.set(n, best); bestPrev.set(n, prev)
    return best
  }
  for (const n of inGraph) lenOf(n, new Set())

  // Take the longest chains (by end node), dedup overlapping shorter ones.
  const ends = [...inGraph].sort((a, b) => (pathLen.get(b) ?? 0) - (pathLen.get(a) ?? 0))
  const longest_chains: SequencingStructure['longest_chains'] = []
  const usedTails = new Set<string>()
  for (const end of ends) {
    if ((pathLen.get(end) ?? 0) < 3) break            // a chain needs ≥3 to be worth showing
    if (usedTails.has(end)) continue
    const seq: string[] = []
    let cur: string | null = end
    const guard = new Set<string>()
    while (cur && !guard.has(cur)) { guard.add(cur); seq.unshift(displayName.get(cur) ?? cur); usedTails.add(cur); cur = bestPrev.get(cur) ?? null }
    longest_chains.push({ names: seq, length: seq.length })
    if (longest_chains.length >= 3) break
  }

  // Isolated — disciplines that appear in no edge at all (often general-ed).
  const isolated: SequencingLayerNode[] = disciplines
    .filter((d) => !inGraph.has(norm(d.name)))
    .map((d) => ({ name: d.name, semester: d.semester }))
    .sort((a, b) => a.semester - b.semester || a.name.localeCompare(b.name, 'ru'))

  return { layers, longest_chains, isolated }
}

// ── 3) Competency progression ────────────────────────────────────────────────────

async function analyzeProgression(
  teacherId: string, institutionId: string | undefined,
  disciplines: ProgramDiscipline[], competencies: ProgramCompetency[]
): Promise<CompetencyProgressionRow[]> {
  const layout = buildLayout(disciplines, true)
  const semesterOf = new Map(disciplines.map((d) => [norm(d.name), d.semester]))

  // Chunk competencies so ALL of them are analysed (was capped at 28, dropping
  // the tail silently — a plan with 31 competencies showed the last 3 as never
  // examined and skewed the outcome-delivery headline). Each batch is small
  // enough for the response to fit in the token budget.
  const BATCH_SIZE = 20
  const batches: ProgramCompetency[][] = []
  for (let i = 0; i < competencies.length; i += BATCH_SIZE) {
    batches.push(competencies.slice(i, i + BATCH_SIZE))
  }

  const results = await Promise.all(
    batches.map((batch, batchIdx) =>
      analyzeProgressionBatch({
        teacherId, institutionId, layout, semesterOf,
        // Global ref index so refs remain unique across batches (defensive:
        // batches are separate LLM calls but the debug/logging is cleaner).
        batchOffset: batchIdx * BATCH_SIZE,
        competencies: batch,
      })
    )
  )
  return results.flat()
}

async function analyzeProgressionBatch(params: {
  teacherId:     string
  institutionId: string | undefined
  layout:        string
  semesterOf:    Map<string, number>
  batchOffset:   number
  competencies:  ProgramCompetency[]
}): Promise<CompetencyProgressionRow[]> {
  const { teacherId, institutionId, layout, semesterOf, batchOffset, competencies } = params

  // Stable refs (batch-local so the model doesn't have to see huge numbers) —
  // used only for round-trip identity, mapped back to the source competency
  // via the `refs` array below.
  const refs = competencies.map((c, i) => ({ ref: `R${i}`, c, globalIdx: batchOffset + i }))
  const reqBlock = refs.map(({ ref, c }) =>
    `${ref}. ${c.kind === 'goal' ? '[ЦЕЛЬ]' : `[${sanitiseForPrompt(c.code ?? '')}]`} ${sanitiseForPrompt(c.title)}`
  ).join('\n')

  const system =
    'Вы — эксперт по качеству образовательных программ российского вуза. Вы оцениваете, как ' +
    'компетенции (УК/ОПК/ПК) и цели программы формируются по семестрам: где они вводятся ' +
    '(introduce), развиваются (develop) и доводятся до уверенного владения (master). Отвечайте ' +
    'только валидным JSON на русском.'

  const user =
    `## Учебный план (по семестрам, с указанием заявленных кодов компетенций)\n${layout}\n\n` +
    `## Компетенции и цели программы\n${reqBlock}\n\n` +
    `## Задача\nДля КАЖДОГО требования (по ref) определите, какие дисциплины и в каких семестрах ` +
    `его формируют, и на каком уровне (introduce/develop/master). Затем присвойте статус:\n` +
    `- "uncovered" — ни одна дисциплина не формирует требование;\n` +
    `- "thin" — формируется только в одной дисциплине (нет развития);\n` +
    `- "late" — впервые формируется слишком поздно (нет ранней основы);\n` +
    `- "ok" — формируется последовательно (введение → развитие → владение).\n\n` +
    `## Формат ответа\nВерните JSON: {"items":[{"ref":"R0","status":"ok",` +
    `"cells":[{"discipline":"<точное название>","semester":2,"level":"introduce"}],` +
    `"note":"краткое пояснение и рекомендация (1–2 предложения)"}]}. Сохраняйте ref. Только JSON.`

  type RawRow = {
    ref?: string; status?: string; note?: string
    cells?: { discipline?: string; semester?: number; level?: string }[]
  }

  // Bigger token budget — 20 refs × timeline cells + notes over ~50 disciplines
  // routinely overran the old 6000 cap, cutting off the tail of the JSON and
  // triggering the retry/failure that made progression sections randomly empty.
  const result = await chatJSON<{ items?: RawRow[] }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'анализ формирования компетенций',
    { context: { teacherId, institutionId, feature: 'grading' }, maxTokens: 8000 },
  )

  const byRef = new Map<string, RawRow>()
  for (const it of result.items ?? []) {
    if (it.ref) byRef.set(String(it.ref).trim().toUpperCase(), it)
  }

  const validStatus = new Set(['ok', 'late', 'thin', 'uncovered'])
  return refs.map(({ ref, c }) => {
    const raw = byRef.get(ref.toUpperCase())
    const cells: CompetencyTimelineCell[] = (raw?.cells ?? [])
      .map((cell) => {
        const sem = semesterOf.get(norm(String(cell.discipline ?? ''))) ?? Number(cell.semester)
        return {
          semester: Number.isFinite(sem) ? Number(sem) : 0,
          level: (VALID_LEVEL.includes(cell.level as CoverageLevel) ? cell.level : 'introduce') as CoverageLevel,
          via: String(cell.discipline ?? '').trim(),
        }
      })
      .filter((cell) => cell.via.length > 0)
      .sort((a, b) => a.semester - b.semester)

    const status = validStatus.has(String(raw?.status))
      ? (raw!.status as CompetencyProgressionRow['status'])
      : (cells.length === 0 ? 'uncovered' : cells.length === 1 ? 'thin' : 'ok')

    return {
      kind:   c.kind,
      code:   c.code,
      title:  c.title,
      cells,
      status,
      note:   String(raw?.note ?? '').trim(),
    }
  })
}

// ── 4) Gaps & redundancy (derived) ───────────────────────────────────────────────

function deriveGaps(
  disciplines: ProgramDiscipline[], progression: CompetencyProgressionRow[]
): { orphans: RedundancyItem[]; missing: RedundancyItem[] } {
  // Orphan detection only makes sense once we have a competency mapping. With no
  // progression (no competencies, or the pass failed) every discipline would
  // look like an orphan — which is misleading, so we skip it.
  const serving = new Set<string>()
  for (const row of progression) {
    for (const cell of row.cells) serving.add(norm(cell.via))
  }

  const orphans: RedundancyItem[] = progression.length === 0 ? [] : disciplines
    .filter((d) => !serving.has(norm(d.name)) && d.competency_codes.length === 0)
    .map((d) => ({
      name: d.name,
      reason: 'Дисциплина не формирует ни одной заявленной компетенции или цели программы.',
      recommendation: 'Уточните вклад дисциплины в компетенции либо рассмотрите её исключение из плана.',
    }))
    .slice(0, 12)

  const missing: RedundancyItem[] = progression
    .filter((row) => row.status === 'uncovered')
    .map((row) => ({
      name: row.code ? `${row.code} — ${row.title}` : row.title,
      reason: 'Ни одна дисциплина плана не формирует эту компетенцию/цель.',
      recommendation: row.note || 'Добавьте дисциплину или расширьте содержание существующей для покрытия.',
    }))

  return { orphans, missing }
}

// ── Verdict + score ──────────────────────────────────────────────────────────────

function overallScore(seq: SequencingResult, progression: CompetencyProgressionRow[]): number {
  const flow = seq.flow_score || (seq.inversions.length === 0 ? 80 : 50)
  if (progression.length === 0) return Math.round(flow)
  const covered = progression.filter((r) => r.status !== 'uncovered').length
  const coverage = Math.round((covered / progression.length) * 100)
  return Math.round(0.5 * flow + 0.5 * coverage)
}

function buildSummary(
  seq: SequencingResult, progression: CompetencyProgressionRow[],
  orphans: RedundancyItem[], missing: RedundancyItem[]
): string {
  const parts: string[] = []
  if (seq.inversions.length > 0) parts.push(`нарушений порядка: ${seq.inversions.length}`)
  if (missing.length > 0)        parts.push(`не покрыто компетенций: ${missing.length}`)
  const thin = progression.filter((r) => r.status === 'thin').length
  if (thin > 0)                  parts.push(`формируются поверхностно: ${thin}`)
  if (orphans.length > 0)        parts.push(`дисциплин без вклада в компетенции: ${orphans.length}`)

  if (parts.length === 0) {
    return 'Учебный план выстроен логично: порядок дисциплин обоснован, а заявленные компетенции формируются последовательно.'
  }
  return `Выявлены замечания к архитектуре плана — ${parts.join(', ')}. Подробности и рекомендации ниже.`
}

// ── Prompt-layout helpers ──────────────────────────────────────────────────────

function buildLayout(disciplines: ProgramDiscipline[], withCodes = false): string {
  const bySem = new Map<number, ProgramDiscipline[]>()
  for (const d of disciplines) {
    if (!bySem.has(d.semester)) bySem.set(d.semester, [])
    bySem.get(d.semester)!.push(d)
  }
  return [...bySem.keys()].sort((a, b) => a - b).map((sem) => {
    const items = bySem.get(sem)!.map((d) => {
      const codes = withCodes && d.competency_codes.length > 0
        ? ` (заявлены: ${d.competency_codes.join(', ')})` : ''
      return `  - ${sanitiseForPrompt(d.name)}${codes}`
    }).join('\n')
    return `Семестр ${sem}:\n${items}`
  }).join('\n')
}

// ── Embedding + math helpers (mirrors curriculumAnalysis) ────────────────────────

async function embedWithBackoff(text: string, teacherId: string): Promise<number[]> {
  let lastErr: unknown
  for (let attempt = 0; attempt < EMBED_MAX_RETRIES; attempt++) {
    try {
      return await embed(text, { teacherId, feature: 'embedding' })
    } catch (err) {
      lastErr = err
      const status = (err as { response?: { status?: number } })?.response?.status
      const retryable = status === 429 || status === undefined
      if (!retryable || attempt === EMBED_MAX_RETRIES - 1) break
      await sleep(500 * 2 ** attempt)
    }
  }
  throw lastErr
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function clampScore(score: number | undefined): number {
  if (typeof score === 'number' && isFinite(score)) return Math.max(0, Math.min(100, Math.round(score)))
  return 0
}

function round1(n: number): number { return Math.round(n * 10) / 10 }

// Russian plural (1 год / 2 года / 5 лет).
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}
function norm(s: string): string { return s.trim().toLowerCase().replace(/\s+/g, ' ') }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }
