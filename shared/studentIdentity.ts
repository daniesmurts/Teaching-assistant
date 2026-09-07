/**
 * Decides whether two free-text student identities are the same person.
 *
 * A student has no row of their own anywhere in this codebase: identity is the
 * denormalised (student_name, student_group) pair the teacher typed on each
 * graded work, and the Students roster is a GROUP BY over it. So «Алтышев Н.И»
 * and «Алтышев Назар Игоревич · 251-МО21» are two students with one work each
 * instead of one student with two — the average, the trajectory chart, the
 * cohort rollup and the БРС ledger all split down the middle.
 *
 * Everything here is pure, so the suggestion logic is unit-testable without a
 * database and the same predicate can be reused wherever a roster is compared.
 *
 * ФИО-specific by design. The rules match how Russian names actually get
 * shortened — surname in full, given name and patronymic collapsed to
 * initials — and nothing else:
 *
 *   • the surname (first token) must match exactly;
 *   • every following token pair must be equal, or one of them a single
 *     letter that starts the other («Н» ↔ «Назар»);
 *   • a comparison is only ever made over the tokens both forms have, so
 *     «Алтышев» matches «Алтышев Назар Игоревич» — weakly, and it is scored
 *     as such.
 *
 * What it deliberately does NOT do: stemming or gender-ending tolerance on
 * the surname (Иванов/Иванова are two people until a teacher says otherwise),
 * transliteration, or typo distance. A false merge silently rewrites grade
 * history; a missed one costs a teacher two clicks in the manual merge UI.
 */

export interface StudentKey {
  student_name:  string
  student_group: string | null
}

export type MergeConfidence = 'high' | 'medium' | 'low'

/** Lowercase, ё→е, punctuation (initial dots above all) → space, collapse. */
export function normaliseStudentName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function studentNameTokens(raw: string): string[] {
  const n = normaliseStudentName(raw)
  return n ? n.split(' ') : []
}

/** Normalised group, or null when the teacher left it blank. */
export function normaliseStudentGroup(raw: string | null | undefined): string | null {
  if (!raw) return null
  const n = raw.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '').trim()
  return n || null
}

/** «Н» vs «Назар» — one is an initial of the other. Equality counts too. */
function tokensCompatible(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length === 1) return b.startsWith(a)
  if (b.length === 1) return a.startsWith(b)
  return false
}

export type NameRelation =
  | 'identical'   // same person, same spelling once normalised
  | 'compatible'  // one form is an abbreviation of the other
  | 'different'   // cannot be the same person

export function compareStudentNames(a: string, b: string): NameRelation {
  const ta = studentNameTokens(a)
  const tb = studentNameTokens(b)
  if (!ta.length || !tb.length) return 'different'
  if (ta[0] !== tb[0]) return 'different'          // surname must match in full

  const shared = Math.min(ta.length, tb.length)
  for (let i = 1; i < shared; i++) {
    if (!tokensCompatible(ta[i], tb[i])) return 'different'
  }
  return ta.length === tb.length && ta.every((t, i) => t === tb[i]) ? 'identical' : 'compatible'
}

/**
 * Two explicit, different groups mean two students — the same abbreviation in
 * 251-МО21 and 252-МО21 is exactly the case where a merge would be wrong. A
 * blank group on either side is not evidence of anything, so it stays
 * compatible: the missing group is usually *why* the duplicate exists.
 */
export function groupsCompatible(a: string | null, b: string | null): boolean {
  const na = normaliseStudentGroup(a)
  const nb = normaliseStudentGroup(b)
  if (na === null || nb === null) return true
  return na === nb
}

export function studentsCompatible(a: StudentKey, b: StudentKey): boolean {
  return compareStudentNames(a.student_name, b.student_name) !== 'different'
      && groupsCompatible(a.student_group, b.student_group)
}

/**
 * How much of a name is actually spelled out — the count of tokens longer
 * than one letter. «Алтышев Назар Игоревич» scores 3, «Алтышев Н.И» scores 1.
 * Picks the merge target: the fullest spelling wins.
 */
export function nameCompleteness(name: string): number {
  return studentNameTokens(name).filter((t) => t.length > 1).length
}

function pairConfidence(a: StudentKey, b: StudentKey): MergeConfidence {
  const relation = compareStudentNames(a.student_name, b.student_name)
  const sameGroup = normaliseStudentGroup(a.student_group) !== null
                 && normaliseStudentGroup(a.student_group) === normaliseStudentGroup(b.student_group)

  // Identical once normalised — the rows differ only in dots, case or spacing.
  if (relation === 'identical') return sameGroup ? 'high' : 'medium'

  // An abbreviation is only convincing when the fuller form carries both a
  // given name and a patronymic to expand the initials against; a bare
  // surname on one side matches half the group and stays 'low'.
  const shorter = Math.min(studentNameTokens(a.student_name).length, studentNameTokens(b.student_name).length)
  const fuller  = Math.max(nameCompleteness(a.student_name), nameCompleteness(b.student_name))
  if (shorter < 2 || fuller < 2) return 'low'
  return sameGroup ? 'high' : 'medium'
}

export interface MergeSuggestion {
  /** The identity to keep — fullest spelling, then most work, then most recent. */
  target:     StudentKey
  /** The identities to rewrite onto the target. Never empty. */
  sources:    StudentKey[]
  confidence: MergeConfidence
  /** Total works that would end up under the target. */
  submissions: number
}

interface RosterEntry extends StudentKey {
  submissions:     number
  last_submission: string   // ISO
}

/**
 * Cluster a roster into groups that look like one student.
 *
 * Transitive by construction (union-find), which is what makes «Алтышев Н.И» +
 * «Алтышев Н. И.» + «Алтышев Назар Игоревич» come out as one suggestion rather
 * than three pairs the teacher has to apply in the right order. That same
 * transitivity is also the only way this can be badly wrong, so a cluster is
 * dropped unless EVERY pair inside it is compatible: «Алтышев Никита Иванович»
 * and «Алтышев Назар Игоревич» are both compatible with «Алтышев Н.И» and
 * incompatible with each other, and there is no honest way to guess which one
 * the short form belongs to. Ambiguous clusters are withheld rather than
 * guessed — the manual merge is still there when the teacher knows.
 */
export function suggestStudentMerges(roster: RosterEntry[]): MergeSuggestion[] {
  const parent = roster.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] }
    return i
  }
  const union = (i: number, j: number) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b }

  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      if (studentsCompatible(roster[i], roster[j])) union(i, j)
    }
  }

  const clusters = new Map<number, RosterEntry[]>()
  for (let i = 0; i < roster.length; i++) {
    const root = find(i)
    const bucket = clusters.get(root)
    if (bucket) bucket.push(roster[i]); else clusters.set(root, [roster[i]])
  }

  const out: MergeSuggestion[] = []
  for (const members of clusters.values()) {
    if (members.length < 2) continue

    // Withhold anything the transitive step over-joined (see above).
    let ambiguous = false
    for (let i = 0; i < members.length && !ambiguous; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (!studentsCompatible(members[i], members[j])) { ambiguous = true; break }
      }
    }
    if (ambiguous) continue

    const ranked = members.slice().sort((a, b) =>
      nameCompleteness(b.student_name) - nameCompleteness(a.student_name)
      || studentNameTokens(b.student_name).length - studentNameTokens(a.student_name).length
      // A group on the target is worth keeping — it is what the roster shows.
      || (normaliseStudentGroup(b.student_group) ? 1 : 0) - (normaliseStudentGroup(a.student_group) ? 1 : 0)
      || b.submissions - a.submissions
      || b.last_submission.localeCompare(a.last_submission)
    )
    const [target, ...sources] = ranked

    // The cluster's confidence is its weakest link — one shaky member is
    // enough to make the whole rewrite shaky.
    let confidence: MergeConfidence = 'high'
    for (const s of sources) {
      const c = pairConfidence(target, s)
      if (c === 'low') confidence = 'low'
      else if (c === 'medium' && confidence === 'high') confidence = 'medium'
    }

    out.push({
      target:      { student_name: target.student_name, student_group: target.student_group },
      sources:     sources.map((s) => ({ student_name: s.student_name, student_group: s.student_group })),
      confidence,
      submissions: members.reduce((n, m) => n + m.submissions, 0),
    })
  }

  const order: Record<MergeConfidence, number> = { high: 0, medium: 1, low: 2 }
  return out.sort((a, b) =>
    order[a.confidence] - order[b.confidence]
    || b.submissions - a.submissions
    || a.target.student_name.localeCompare(b.target.student_name, 'ru')
  )
}
