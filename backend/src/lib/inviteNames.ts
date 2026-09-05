/**
 * Cleans a pasted student list into the names to actually invite.
 *
 * Pasting is the realistic path — a group roster lives in a spreadsheet or a
 * Word table — and what arrives is never clean: trailing blank lines, an
 * accidental header row's worth of whitespace, and the same student twice
 * because the list was assembled from two sources. Two links for one student
 * is two submissions to reconcile at grading time, so the dedupe matters more
 * than it looks.
 *
 * Case- and space-insensitive on the comparison only: the name is stored as
 * the teacher typed it.
 */
export const INVITE_NAME_MAX = 200

export function normaliseInviteNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []

  const seen = new Set<string>()
  const out: string[] = []

  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const name = entry.trim().replace(/\s{2,}/g, ' ')
    if (!name) continue

    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name.slice(0, INVITE_NAME_MAX))
  }

  return out
}
