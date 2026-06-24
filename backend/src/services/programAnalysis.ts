import { chatJSON, embed } from './deepseek'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { findCourseById } from '../db/queries/courses'
import { getLatestKnowledgeText } from '../db/queries/documents'
import { ValidationError } from '../errors/AppError'
import { logger } from '../lib/logger'
import type {
  ProgramDetail, ProgramDiscipline, ProgramCompetency, ProgramAnalysis,
  PrerequisiteEdge, SequencingResult, CompetencyProgressionRow, CompetencyTimelineCell,
  CoverageLevel, RedundancyItem, RelatednessCluster, SemesterLoad,
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
  }
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
    'Вы — методист российского вуза, эксперт по проектированию учебных планов. Вы анализируете ' +
    'логику последовательности дисциплин: какие дисциплины являются предпосылкой (фундаментом) ' +
    'для других, и нет ли нарушений порядка (зависимая дисциплина изучается раньше или одновременно ' +
    'с той, на которую опирается). Отвечайте только валидным JSON на русском.'

  const user =
    `## Учебный план (по семестрам)\n${layout}\n\n` +
    `## Задача\n` +
    `1) Определите ключевые пары «предпосылка → зависимая дисциплина»: дисциплина B опирается на ` +
    `знания/умения из дисциплины A. Сосредоточьтесь на фундаментальных и профессиональных ` +
    `дисциплинах (математика, физика, механика, материаловедение, профильные), где есть реальные ` +
    `связи. У общеобразовательных дисциплин (история, философия, физкультура, иностранный язык) ` +
    `предпосылок обычно нет — их не включайте. Найдите 8–20 наиболее значимых связей. ` +
    `Используйте ТОЧНЫЕ названия из плана.\n` +
    `2) Особо отметьте НАРУШЕНИЯ порядка: зависимая дисциплина изучается раньше или в том же ` +
    `семестре, что и её предпосылка.\n` +
    `3) Дайте общий вердикт (verdict, 2–3 предложения) и оценку flow_score (0–100): насколько ` +
    `грамотно выстроен порядок (фундамент → продвинутые темы).\n\n` +
    `## Формат ответа\nВерните JSON: {"verdict":"...","flow_score":75,"edges":[` +
    `{"from":"<название A>","to":"<название B>","reason":"почему B зависит от A (1 предложение)",` +
    `"recommendation":"что сделать, если порядок нарушен (1 предложение)"}]}. Только JSON.`

  const result = await chatJSON<{
    verdict?: string; flow_score?: number
    edges?: { from?: string; to?: string; reason?: string; recommendation?: string }[]
  }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'анализ последовательности дисциплин',
    { context: { teacherId, institutionId, feature: 'grading' }, maxTokens: 4000 },
  )

  const edges: PrerequisiteEdge[] = []
  for (const e of result.edges ?? []) {
    const fromSem = semesterOf.get(norm(String(e.from ?? '')))
    const toSem   = semesterOf.get(norm(String(e.to ?? '')))
    if (fromSem == null || toSem == null) continue   // unmatched name — skip
    edges.push({
      from_name: String(e.from).trim(), from_semester: fromSem,
      to_name: String(e.to).trim(),     to_semester: toSem,
      reason: String(e.reason ?? '').trim(),
      inverted: toSem <= fromSem,
      recommendation: String(e.recommendation ?? '').trim(),
    })
  }

  return {
    verdict:    String(result.verdict ?? '').trim(),
    flow_score: clampScore(result.flow_score),
    edges,
    inversions: edges.filter((e) => e.inverted),
  }
}

// ── 3) Competency progression ────────────────────────────────────────────────────

async function analyzeProgression(
  teacherId: string, institutionId: string | undefined,
  disciplines: ProgramDiscipline[], competencies: ProgramCompetency[]
): Promise<CompetencyProgressionRow[]> {
  const layout = buildLayout(disciplines, true)
  const semesterOf = new Map(disciplines.map((d) => [norm(d.name), d.semester]))

  // Stable refs so the round-trip survives reordering/renaming by the model.
  // Cap the set fed to the model so the response stays within token budget.
  const refs = competencies.slice(0, 28).map((c, i) => ({ ref: `R${i}`, c }))
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

  const result = await chatJSON<{ items?: RawRow[] }>(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    'анализ формирования компетенций',
    { context: { teacherId, institutionId, feature: 'grading' }, maxTokens: 6000 },
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
function norm(s: string): string { return s.trim().toLowerCase().replace(/\s+/g, ' ') }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }
