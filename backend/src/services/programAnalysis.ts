import { chatJSON, embed } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { findCourseById } from '../db/queries/courses'
import { getLatestKnowledgeText } from '../db/queries/documents'
import { listWorkingProgrammesByDiscipline, findWorkingProgrammeForDiscipline } from '../db/queries/programDocuments'
import { findApprovedDocumentForDiscipline } from '../db/queries/rpdSubmissions'
import {
  replacePrerequisites, replaceCompetencyLinks, replaceContentUnits, hasContentUnitsForDocument,
  type ReplaceCompetencyLinkInput,
} from '../db/queries/programTopology'
import { findPublishedFgosCompetencies } from '../db/queries/fgos'
import { setCompetencyFgosLinks } from '../db/queries/programs'
import { getOtfByIds } from '../db/queries/profstandards'
import { inferFgosLevel, matchProgramCompetenciesToFgos } from './fgosMatch'
import { extractContentUnits } from './programContentUnits'
import { findCopiedPkFormulations, type PkCompetencyInput } from './pkFormulation'
import { ValidationError } from '../errors/AppError'
import { logger } from '../lib/logger'
import type {
  ProgramDetail, ProgramDiscipline, ProgramCompetency, ProgramAnalysis,
  PrerequisiteEdge, SequencingResult, SequencingStructure, SequencingLayerNode,
  CompetencyProgressionRow, CompetencyTimelineCell, OutcomeDelivery, MappingConfidence, ContentConfidence,
  CoverageLevel, RedundancyItem, RelatednessCluster, SemesterLoad, LoadCheck, PkFormulationFinding,
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

  // Non-fatal issues from any pass. When a pass fails silently (an LLM timeout,
  // an embed batch that dropped) sections came back empty and the whole report
  // looked randomly different between runs. Collecting them here means the UI
  // can say «повторите анализ» instead of showing an empty section as truth.
  const warnings: string[] = []

  // Pull all uploaded РПД text for this programme up-front — one round trip
  // instead of per-discipline lookups inside the embed loop. Feeds
  // resolveContent so the embedding/analysis reflects the actual content the
  // РОП uploaded, not just the discipline name.
  let docTextByDiscipline: Map<string, string> = new Map()
  try {
    docTextByDiscipline = await listWorkingProgrammesByDiscipline(program.id)
  } catch (err) {
    logger.warn({ message: 'Failed to load РПД texts for analysis', error: (err as Error).message })
    // Non-fatal — analysis falls back to name-only embeddings, same as before.
  }

  // 1) Relatedness & load — embed each discipline, cross-compare, tally load.
  // Guarded: a persistent embed failure used to 500 the whole request (unlike
  // the LLM passes). Now degrades gracefully — the report renders without
  // clusters and the user learns why.
  let clusters: RelatednessCluster[] = []
  let isolated: string[] = []
  try {
    const prepared = await prepareAndEmbed(teacherId, disciplines, docTextByDiscipline)
    const r = clusterByRelatedness(prepared)
    clusters = r.clusters
    isolated = r.isolated
  } catch (err) {
    logger.warn({ message: 'Program embedding pass failed', error: (err as Error).message })
    warnings.push('Не удалось построить карту связанности дисциплин — сервис эмбеддингов временно недоступен, повторите анализ.')
  }
  const load = computeLoad(disciplines, program.duration_semesters)

  // 2) Sequencing & prerequisites (best-effort — never blocks the report).
  let sequencing: SequencingResult = { verdict: '', flow_score: 0, edges: [], inversions: [] }
  try {
    sequencing = await analyzeSequencing(teacherId, institutionId, disciplines)
  } catch (err) {
    logger.warn({ message: 'Program sequencing analysis failed', error: (err as Error).message })
    warnings.push('Анализ последовательности дисциплин не завершился — повторите анализ.')
  }

  // 3) Competency progression (best-effort).
  let progression: CompetencyProgressionRow[] = []
  if (program.competencies.length > 0) {
    try {
      progression = await analyzeProgression(teacherId, institutionId, disciplines, program.competencies)
    } catch (err) {
      logger.warn({ message: 'Program progression analysis failed', error: (err as Error).message })
      warnings.push('Не удалось построить карту формирования компетенций — повторите анализ.')
    }
  }

  // 4) Gaps & redundancy — derived from (2)+(3) + declared codes.
  const { orphans, missing } = deriveGaps(disciplines, progression)

  // 5) ПК formulation copy-check (deterministic, methodist feedback item 3)
  // — only for competencies with an ОТФ actually linked; nothing to compare
  // against otherwise.
  const pkFormulationFindings = await derivePkFormulationFindings(program.competencies)

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
    content_confidence: deriveContentConfidence(disciplines, docTextByDiscipline),
    load_check:         deriveLoadCheck(load, disciplines, program.duration_semesters, program.reported_semester_totals),
    warnings:           warnings.length > 0 ? warnings : undefined,
    pk_formulation_findings: pkFormulationFindings.length > 0 ? pkFormulationFindings : undefined,
  }
}

/** Resolves each ПК competency's linked ОТФ (if any) and runs the
 *  deterministic copy-check. Exported so routes/programs.ts's competency-save
 *  handler can run the same check inline without a second analysis pass. */
export async function derivePkFormulationFindings(
  competencies: ProgramCompetency[]
): Promise<PkFormulationFinding[]> {
  const withOtf = competencies.filter((c) => c.kind === 'competency' && c.profstandard_otf_id)
  if (withOtf.length === 0) return []

  const otfRows = await getOtfByIds(withOtf.map((c) => c.profstandard_otf_id as string))
  const otfById = new Map(otfRows.map((o) => [o.id, o]))

  const inputs: PkCompetencyInput[] = withOtf.map((c) => {
    const otf = otfById.get(c.profstandard_otf_id as string)
    return {
      code:  c.code,
      title: c.title,
      indicators: (c.indicators ?? []).map((i) => ({ code: i.code, title: i.title })),
      otf: otf ? { otf_code: otf.otf_code, name: otf.name } : null,
    }
  })

  return findCopiedPkFormulations(inputs)
}

// Topology graph substrate (docs/topology-spec.md, Increment 0). Best-effort
// side-effect called by the route AFTER analyzeProgram + saveAnalysis: turns
// the id-resolved edges/cells above into queryable program_prerequisites /
// program_competency_links rows, and resolves program_competencies onto the
// canonical ФГОС registry (УК/ОПК only — ПК has no federal registry entry).
// Never throws — a failure here must not break the analysis report teachers
// already depend on; the caller logs and moves on.
export async function persistTopology(
  program: ProgramDetail, analysis: ProgramAnalysis, analysisId: string, teacherId: string
): Promise<void> {
  const prereqEdges = analysis.sequencing.edges
    .filter((e): e is PrerequisiteEdge & { from_id: string; to_id: string } => !!e.from_id && !!e.to_id)
    .map((e) => ({
      disciplineId:              e.to_id,
      prerequisiteDisciplineId:  e.from_id,
      reason:                    e.reason,
      inverted:                  e.inverted,
    }))
  await replacePrerequisites(program.id, prereqEdges, analysisId)

  const linkKey = (l: ReplaceCompetencyLinkInput) => `${l.disciplineId}>${l.competencyId}>${l.stage}`
  const competencyLinks = new Map<string, ReplaceCompetencyLinkInput>()
  for (const row of analysis.progression) {
    if (!row.competency_id) continue
    for (const cell of row.cells) {
      if (!cell.via_discipline_id) continue
      const link: ReplaceCompetencyLinkInput = {
        disciplineId: cell.via_discipline_id,
        competencyId: row.competency_id,
        stage:        cell.level,
      }
      competencyLinks.set(linkKey(link), link)
    }
  }
  await replaceCompetencyLinks(program.id, [...competencyLinks.values()], analysisId)

  if (program.code) {
    const fgosLevel = inferFgosLevel(program)
    if (fgosLevel) {
      const fgosCompetencies = await findPublishedFgosCompetencies(program.code, fgosLevel)
      const matches = matchProgramCompetenciesToFgos(program.competencies, fgosCompetencies)
      if (matches.length > 0) await setCompetencyFgosLinks(matches)
    }
  }
}

// Content-unit extraction (docs/topology-spec.md, Increment 0). Deliberately
// NOT part of persistTopology above and NOT awaited by the route — each
// discipline with an uploaded РПД costs its own LLM round trip (structure
// parse + one call per non-empty section), so across a real programme
// (confirmed live against a 59-discipline plan) this can run many minutes
// past the point edges/links already finished, which would otherwise push
// the whole /analyze request past its 180s client timeout for no benefit —
// nothing in this increment's UI reads content units yet (that's Increment
// 2). Same fire-and-forget posture as generateAndStoreEmbedding
// (services/embeddings.ts): the caller logs and moves on, never awaits.
export async function persistContentUnits(program: ProgramDetail, teacherId: string): Promise<void> {
  for (const d of program.disciplines) {
    if (!d.id) continue
    try {
      const approved = await findApprovedDocumentForDiscipline(d.id)
      let documentId: string, extractedText: string | null, provenance: 'approved' | 'latest'
      if (approved) {
        documentId = approved.documentId
        extractedText = approved.extractedText
        provenance = 'approved'
      } else {
        const latest = await findWorkingProgrammeForDiscipline(program.id, d.id)
        if (!latest) continue
        documentId = latest.document.id
        extractedText = latest.extractedText
        provenance = 'latest'
      }
      if (!extractedText || extractedText.trim().length < 80) continue
      if (await hasContentUnitsForDocument(d.id, documentId)) continue

      const units = await extractContentUnits(teacherId, extractedText, d.name)
      await replaceContentUnits(
        d.id,
        units.map((u, i) => ({ section: u.section, title: u.title, topics: u.topics, sortOrder: i })),
        documentId, provenance,
      )
    } catch (err) {
      logger.warn({ message: 'Content-unit extraction failed', disciplineId: d.id, error: (err as Error).message })
    }
  }
}

// How much of the clustering pass rests on real uploaded content vs. bare
// discipline names. A discipline embeds on its uploaded РПД text when present
// (see resolveContent); with few uploads, most disciplines embed on name
// alone — short, generic text that either collapses into one "everything is
// similar" blob (silently suppressed by clusterByRelatedness as uninformative)
// or sits in a similarity band that's neither cluster nor outlier. Either way
// "Явных кластеров не выявлено" looks like "no thematic structure" when it's
// really "not enough real content yet" — `low` tells the UI to say so.
export function deriveContentConfidence(
  disciplines: ProgramDiscipline[], docTextByDiscipline: Map<string, string>
): ContentConfidence {
  const total = disciplines.length
  const withContent = disciplines.filter(
    (d) => d.id != null && (docTextByDiscipline.get(d.id)?.trim().length ?? 0) >= 80
  ).length
  return {
    disciplines_total:        total,
    disciplines_with_content: withContent,
    low:                      total > 0 && withContent / total < 0.5,
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
  load: SemesterLoad[], disciplines: ProgramDiscipline[], duration: number,
  reportedSemesterTotals?: Record<number, number>,
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
  // Per-semester reconciliation against the plan's own «Итого» rows — the
  // strongest signal of a mis-parsed semester because it compares against
  // the plan's own asserted total rather than a ФГОС rule of thumb. A ±2 з.е.
  // tolerance absorbs rounding of parts of ЗЕТ.
  const RECONCILE_TOLERANCE = 2
  if (reportedSemesterTotals) {
    for (const [semStr, reported] of Object.entries(reportedSemesterTotals)) {
      const sem = Number(semStr)
      const l = load.find((x) => x.semester === sem)
      if (!l || l.credits == null) continue
      if (Math.abs(l.credits - reported) > RECONCILE_TOLERANCE) {
        issues.push(
          `Сем. ${sem}: сумма извлечённых ЗЕТ ${l.credits}, ` +
          `в плане указано ${reported} — часть дисциплин распознана неверно.`
        )
      }
    }
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
  teacherId: string, disciplines: ProgramDiscipline[],
  docTextByDiscipline: Map<string, string>,
): Promise<PreparedDiscipline[]> {
  const out: PreparedDiscipline[] = []
  for (const d of disciplines) {
    const content = await resolveContent(d, teacherId, docTextByDiscipline)
    const embedText = content ? `${d.name}. ${content}` : d.name
    const embedding = await embedWithBackoff(embedText.slice(0, MAX_CONTENT_CHARS + 200), teacherId)
    out.push({ d, embedText, embedding })
    await sleep(EMBED_SPACING_MS)
  }
  return out
}

// Resolve the descriptive text for a discipline used to enrich its embedding.
// Priority: uploaded РПД (program_documents.extracted_text) → linked course
// syllabus/knowledge. Importer-created disciplines carry no course_id, so
// before this fix they always embedded on name alone — the plan analysis
// literally ignored every uploaded document. Reading the РПД makes clusters
// and «disciplines outside the graph» reflect actual content.
async function resolveContent(
  d: ProgramDiscipline, teacherId: string,
  docTextByDiscipline: Map<string, string>,
): Promise<string> {
  // Prefer uploaded РПД — this is what РОПы actually upload for a plan.
  if (d.id) {
    const uploaded = docTextByDiscipline.get(d.id)
    if (uploaded && uploaded.trim().length >= 80) return uploaded.slice(0, MAX_CONTENT_CHARS)
  }
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

  const { edges, unmatchedNames } = resolveSequencingEdges(result.edges ?? [], disciplines)

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
    unmatched_names: unmatchedNames.length > 0 ? unmatchedNames : undefined,
  }
}

// Pure edge resolution — separated from analyzeSequencing so the id-lookup +
// unmatched-name behaviour is unit-testable without a live LLM call (topology
// substrate, docs/topology-spec.md §3.1: edges used to be matched by
// discipline name with unmatched names silently dropped; this now also
// resolves the persistable program_disciplines.id and surfaces what didn't
// match instead of discarding it).
export function resolveSequencingEdges(
  rawEdges: { from?: string; to?: string; reason?: string }[],
  disciplines: ProgramDiscipline[],
): { edges: PrerequisiteEdge[]; unmatchedNames: string[] } {
  const refOf = new Map<string, { semester: number; id?: string }>(
    disciplines.map((d) => [norm(d.name), { semester: d.semester, id: d.id }])
  )

  const edges: PrerequisiteEdge[] = []
  const unmatchedNames = new Set<string>()
  const seen = new Set<string>()
  for (const e of rawEdges) {
    const fromName = String(e.from ?? '').trim()
    const toName   = String(e.to ?? '').trim()
    const from = refOf.get(norm(fromName))
    const to   = refOf.get(norm(toName))
    if (!from) { if (fromName) unmatchedNames.add(fromName); continue }
    if (!to)   { if (toName) unmatchedNames.add(toName); continue }
    const key = `${norm(fromName)}>${norm(toName)}`
    if (seen.has(key)) continue
    seen.add(key)

    // Strict inversion only: dependent is taught in an EARLIER semester than its
    // prerequisite. Same-semester links are valid (intra-semester order is the
    // teacher's call) and stay as ordinary justified links.
    const inverted = to.semester < from.semester
    edges.push({
      from_name: fromName, from_semester: from.semester, from_id: from.id,
      to_name: toName,     to_semester: to.semester,     to_id: to.id,
      reason: String(e.reason ?? '').trim(),
      inverted,
      recommendation: inverted
        ? `«${toName}» (сем. ${to.semester}) опирается на «${fromName}» (сем. ${from.semester}), но изучается раньше — перенесите «${fromName}» на более ранний семестр или «${toName}» на более поздний.`
        : '',
    })
  }

  return { edges, unmatchedNames: [...unmatchedNames] }
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
  const refOf = new Map(disciplines.map((d) => [norm(d.name), { semester: d.semester, id: d.id }]))

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
        teacherId, institutionId, layout, refOf,
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
  refOf:         Map<string, { semester: number; id?: string }>
  batchOffset:   number
  competencies:  ProgramCompetency[]
}): Promise<CompetencyProgressionRow[]> {
  const { teacherId, institutionId, layout, refOf, batchOffset, competencies } = params

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
        const ref = refOf.get(norm(String(cell.discipline ?? '')))
        const sem = ref?.semester ?? Number(cell.semester)
        return {
          semester: Number.isFinite(sem) ? Number(sem) : 0,
          level: (VALID_LEVEL.includes(cell.level as CoverageLevel) ? cell.level : 'introduce') as CoverageLevel,
          via: String(cell.discipline ?? '').trim(),
          via_discipline_id: ref?.id,
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
      competency_id: c.id,
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
