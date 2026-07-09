import type { Assignment, RevisionStatus } from '../types'

// Per-student analytics derived from the assignment list (Students page).
// A "chain" is a sequence of versions of what looks like the same work.
// Teachers only set parent_assignment_id when they explicitly grade via the
// "проверить как доработку" flow — in practice most resubmissions never go
// through that path, so relying on it alone leaves chains invisible for the
// common case. Chains are therefore built from the union of two signals:
//   1. explicit parent_assignment_id links (authoritative)
//   2. submission_text similarity within the same student + course (heuristic)
// A false-positive risk of (2) is two distinct assignments that happen to
// share boilerplate (e.g. a shared "СОДЕРЖАНИЕ" template) — mitigated by a
// high similarity threshold and comparing a large-enough text window.

export interface RevisionChain {
  root:     Assignment          // earliest known version
  versions: Assignment[]        // chronological, root first
}

const SIMILARITY_MAX_CHARS = 2000   // text window compared per assignment
const SIMILARITY_MIN_TOKEN_LEN = 3  // drop short tokens (numbers, stray letters)
const SIMILARITY_THRESHOLD = 0.5    // Jaccard over word tokens

/** Lower-cased word tokens from the first SIMILARITY_MAX_CHARS of a submission. */
export function tokenize(text: string): Set<string> {
  const words = text
    .slice(0, SIMILARITY_MAX_CHARS)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= SIMILARITY_MIN_TOKEN_LEN)
  return new Set(words)
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const w of a) if (b.has(w)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export interface StudentStats {
  firstSubmissions:  number     // works that started a chain
  resubmissions:     number     // follow-up versions
  chainsWithRework:  number     // chains that got at least one revision
  totalChains:       number
  /** median hours between a version and its follow-up; null when no resubmissions */
  medianReworkHours: number | null
  /** average score change from a chain's first to its last version; null without reworked chains */
  avgScoreDelta:     number | null
  /** ai_revision_check verdicts aggregated over all revisions */
  corrections: Record<RevisionStatus, number>
  /** share of feedback points fixed: addressed + half credit for partial; null when no checks ran */
  correctionRate:    number | null
}

const effectiveScore = (a: Assignment): number | null => a.approved_score ?? a.ai_score

/** Group assignments into revision chains via explicit links + text similarity. */
export function buildChains(assignments: Assignment[]): RevisionChain[] {
  const n = assignments.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] }
    return i
  }
  const union = (i: number, j: number) => {
    const ri = find(i), rj = find(j)
    if (ri !== rj) parent[ri] = rj
  }

  const indexById = new Map(assignments.map((a, i) => [a.id, i]))

  // Signal 1: explicit parent_assignment_id links.
  assignments.forEach((a, i) => {
    if (!a.parent_assignment_id) return
    const j = indexById.get(a.parent_assignment_id)
    if (j !== undefined) union(i, j)
  })

  // Signal 2: submission-text similarity, scoped to the same course (both
  // null counts as "same" — the whole list is already one student's works).
  const tokens = assignments.map((a) => tokenize(a.submission_text ?? ''))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (assignments[i].course_id !== assignments[j].course_id) continue
      if (find(i) === find(j)) continue
      if (jaccardSimilarity(tokens[i], tokens[j]) >= SIMILARITY_THRESHOLD) union(i, j)
    }
  }

  const groups = new Map<number, Assignment[]>()
  assignments.forEach((a, i) => {
    const root = find(i)
    const list = groups.get(root)
    if (list) list.push(a)
    else groups.set(root, [a])
  })

  const result: RevisionChain[] = []
  for (const versions of groups.values()) {
    versions.sort((x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime())
    result.push({ root: versions[0], versions })
  }
  // Newest chains first (by latest activity) — matches the works list order.
  result.sort((x, y) =>
    new Date(y.versions[y.versions.length - 1].created_at).getTime() -
    new Date(x.versions[x.versions.length - 1].created_at).getTime()
  )
  return result
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function computeStudentStats(assignments: Assignment[]): StudentStats {
  const chains = buildChains(assignments)

  const reworkGaps: number[] = []   // hours between consecutive versions
  const scoreDeltas: number[] = []
  const corrections: Record<RevisionStatus, number> = { addressed: 0, partial: 0, not_addressed: 0 }
  let resubmissions = 0
  let chainsWithRework = 0

  for (const chain of chains) {
    const v = chain.versions
    if (v.length > 1) {
      chainsWithRework++
      resubmissions += v.length - 1
      for (let i = 1; i < v.length; i++) {
        const gapMs = new Date(v[i].created_at).getTime() - new Date(v[i - 1].created_at).getTime()
        reworkGaps.push(gapMs / 3_600_000)
      }
      const first = effectiveScore(v[0])
      const last = effectiveScore(v[v.length - 1])
      if (first != null && last != null) scoreDeltas.push(last - first)
    }
    for (const a of v) {
      for (const item of a.ai_revision_check ?? []) {
        if (item.status in corrections) corrections[item.status]++
      }
    }
  }

  const totalChecks = corrections.addressed + corrections.partial + corrections.not_addressed
  return {
    firstSubmissions:  chains.length,
    resubmissions,
    chainsWithRework,
    totalChains:       chains.length,
    medianReworkHours: median(reworkGaps),
    avgScoreDelta:     scoreDeltas.length
      ? Math.round((scoreDeltas.reduce((s, d) => s + d, 0) / scoreDeltas.length) * 10) / 10
      : null,
    corrections,
    correctionRate: totalChecks > 0
      ? Math.round(((corrections.addressed + corrections.partial * 0.5) / totalChecks) * 100)
      : null,
  }
}

/** "3 ч", "2 дн.", "45 мин" — compact Russian duration for the rework-time stat. */
export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} мин`
  if (hours < 48) return `${Math.round(hours)} ч`
  return `${Math.round(hours / 24)} дн.`
}
