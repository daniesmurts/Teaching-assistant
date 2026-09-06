import { pool } from '../connection'
import { logger } from '../../lib/logger'

// ─── Artefact outcome events (migration 126) ─────────────────────────────────
//
// See the migration header for why exports cannot be derived and need an
// explicit write: they are GET requests, and the global audit middleware
// deliberately skips reads.

export type ArtifactEventName = 'exported'

export interface RecordArtifactEventParams {
  kind:           string
  event:          ArtifactEventName
  teacherId:      string
  artifactId?:    string | null
  institutionId?: string | null
  format?:        string
  metadata?:      Record<string, unknown>
}

/**
 * Fire-and-forget, and swallows its own failures.
 *
 * Every call site is a file download the teacher is waiting on. An analytics
 * write must never turn a working export into a 500, so the error is logged
 * and dropped here rather than left to the discipline of a dozen call sites
 * remembering to `.catch()`.
 */
export function recordArtifactEvent(params: RecordArtifactEventParams): void {
  pool.query(
    `INSERT INTO artifact_events
       (kind, event, artifact_id, teacher_id, institution_id, format, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      params.kind,
      params.event,
      params.artifactId ?? null,
      params.teacherId,
      params.institutionId ?? null,
      params.format ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ]
  ).catch((err: unknown) => {
    logger.warn({ err, kind: params.kind, event: params.event }, 'artifact event not recorded')
  })
}

export interface ArtifactExportRow {
  kind:           string
  export_count:   number
  /** Distinct artefacts exported at least once — the numerator of "was it used". */
  exported_items: number
  export_teachers: number
}

/** Exports per artefact kind over the window, for the admin «Артефакты» tab. */
export async function getArtifactExports(days = 30): Promise<ArtifactExportRow[]> {
  const { rows } = await pool.query<ArtifactExportRow>(
    `SELECT
       kind,
       COUNT(*)::int                            AS export_count,
       COUNT(DISTINCT artifact_id)::int         AS exported_items,
       COUNT(DISTINCT teacher_id)::int          AS export_teachers
     FROM artifact_events
     WHERE event = 'exported'
       AND created_at >= NOW() - ($1 || ' days')::INTERVAL
     GROUP BY kind`,
    [days]
  )
  return rows
}
