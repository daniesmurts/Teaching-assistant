import type { SubmissionTelemetry, ProvenanceFacts } from '../../../shared/types'

// Process-of-creation provenance (Research.md §5.1.3). Turns the aggregate
// telemetry into transparent numeric facts — NO score, NO verdict. The teacher
// reads the facts and judges; the platform only attests. Rule-based, no ML.

const round1 = (n: number) => Math.round(n * 10) / 10

export function computeProvenance(t: SubmissionTelemetry | null | undefined): ProvenanceFacts {
  const totalChars  = Math.max(0, t?.total_chars   ?? 0)
  const pastedChars = Math.max(0, t?.pasted_chars  ?? 0)
  const activeMs    = Math.max(0, t?.active_ms      ?? 0)

  const spanMs = t?.started_at && t?.last_edit_at
    ? new Date(t.last_edit_at).getTime() - new Date(t.started_at).getTime()
    : 0

  return {
    activeMinutes: round1(activeMs / 60_000),
    spanMinutes:   Math.max(0, Math.round(spanMs / 60_000)),
    revisionCount: Math.max(0, t?.revision_count ?? 0),
    totalChars,
    pastedChars:   Math.min(pastedChars, totalChars || pastedChars),
    largestPaste:  Math.max(0, t?.largest_paste ?? 0),
    pasteRatio:    totalChars > 0 ? Math.min(1, pastedChars / totalChars) : 0,
    startedAt:     t?.started_at ?? null,
    lastEditAt:    t?.last_edit_at ?? null,
  }
}
