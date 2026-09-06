import { pool } from '../connection'
import { getArtifactExports } from './artifactEvents'

// ─── Artefact usage — what teachers actually create, per feature ─────────────
//
// This is deliberately NOT read from api_usage_log. That table is a *cost*
// ledger: its `feature` column is an LLM-spend bucket, and 'grading' is a
// shared bucket reused by ~15 unrelated services (documentReview, mtoReview,
// programDiff, docChat, cohortSynthesis, longReview, curriculumAnalysis, …),
// with one user action logging several rows (see the note above
// getDailyUsage in usageLog.ts). Counting product activity there both
// mislabels features and inflates counts — and features that make no LLM
// call at all (courses, rubrics, БРС, live sessions, uploads) never appear.
//
// Instead every artefact is derived from its own table, the same
// "derived — no event instrumentation" pattern the activation funnel uses
// (db/queries/activation.ts). It needs no new writes and works retroactively
// over the whole history of the platform.
//
// The "was it used" half comes from artifact_events (migration 126) and is
// merged in below: exports are GET requests that the audit middleware
// deliberately skips and that cost no tokens, so unlike creation they cannot
// be derived and have to be recorded explicitly at each download route.
// Post-generation *edits* are POST/PATCH and therefore already land in
// audit_log — deriving them from there is the next step, not another write.

export interface ArtifactSource {
  /** Stable key, also the i18n key on the client. */
  kind:      string
  table:     string
  /** Column holding the acting teacher, or null where the table records no actor. */
  teacherColumn: string | null
  createdColumn: string
  /** Skip rows where the timestamp is NULL (e.g. an РПД still in draft, never submitted). */
  requireCreated?: boolean
}

/**
 * Every artefact table the platform writes a user-visible object into.
 *
 * Rule 6 (parameterised SQL only) is about user-supplied values: `days` below
 * is bound, never interpolated. The identifiers here are a fixed, in-repo
 * whitelist — no request data reaches the SQL text. Adding a feature to the
 * dashboard is one line here plus a label on the client.
 */
export const ARTIFACT_SOURCES: readonly ArtifactSource[] = [
  { kind: 'grading',                 table: 'assignments',               teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'long_review',             table: 'long_reviews',              teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'presentation',            table: 'presentations',             teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'quiz',                    table: 'quizzes',                   teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'task_set',                table: 'task_sets',                 teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'topic_set',               table: 'topic_sets',                teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'published_assignment',    table: 'published_assignments',     teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'live_session',            table: 'live_sessions',             teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'course',                  table: 'courses',                   teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'document',                table: 'documents',                 teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'rubric',                  table: 'rubrics',                   teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'criterion',               table: 'criteria',                  teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'brs_scheme',              table: 'brs_schemes',               teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'fos_document',            table: 'fos_documents',             teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'feedback_challenge',      table: 'feedback_challenges',       teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  { kind: 'methodist_run',           table: 'methodist_runs',            teacherColumn: 'teacher_id',   createdColumn: 'created_at' },
  // Studio drafts are upserted per course — updated_at is the only timestamp
  // there, so this reads as "courses with a draft touched in the period".
  { kind: 'syllabus_draft',          table: 'syllabus_studio_drafts',    teacherColumn: 'teacher_id',   createdColumn: 'updated_at' },
  { kind: 'program_document',        table: 'program_documents',         teacherColumn: 'uploaded_by',  createdColumn: 'uploaded_at' },
  { kind: 'rpd_submission',          table: 'rpd_submissions',           teacherColumn: 'submitted_by', createdColumn: 'submitted_at', requireCreated: true },
  // Program-level artefacts record no acting teacher — they still count, but
  // contribute nothing to the distinct-teacher column (documented in the UI).
  { kind: 'program_analysis',        table: 'program_analyses',          teacherColumn: null,           createdColumn: 'created_at' },
  { kind: 'program_document_review', table: 'program_document_reviews',  teacherColumn: null,           createdColumn: 'created_at' },
  { kind: 'program_mto_review',      table: 'program_mto_reviews',       teacherColumn: null,           createdColumn: 'created_at' },
  { kind: 'program_placement_review',table: 'program_placement_reviews', teacherColumn: null,           createdColumn: 'created_at' },
  { kind: 'cohort_synthesis',        table: 'cohort_syntheses',          teacherColumn: null,           createdColumn: 'generated_at' },
  { kind: 'policy_memo',             table: 'course_policy_memos',       teacherColumn: null,           createdColumn: 'generated_at' },
]

export interface ArtifactUsageRow {
  kind:            string
  /** Created within the requested window. */
  period_count:    number
  /** Distinct teachers who created one in the window; null-actor tables contribute 0. */
  period_teachers: number
  /** Created ever — the denominator that says whether a zero is "new" or "dead". */
  total_count:     number
  last_at:         string | null
  /** Download/export actions in the window (migration 126). */
  export_count:    number
  /** Distinct artefacts exported at least once — pair with period_count for the "did anyone use it" ratio. */
  exported_items:  number
  export_teachers: number
}

/**
 * `(kind, teacher_id, created_at)` over every artefact table. Exported so the
 * adoption/retention reads (featureAdoption.ts) sit on exactly the same
 * definition of "a teacher used feature X" as the counts on this page — two
 * hand-maintained lists would drift and quietly disagree.
 */
export const ARTIFACT_UNION_SQL = ARTIFACT_SOURCES.map((s) => {
  const teacher = s.teacherColumn ?? 'NULL::uuid'
  const where = s.requireCreated ? ` WHERE ${s.createdColumn} IS NOT NULL` : ''
  return `SELECT '${s.kind}'::text AS kind, ${teacher} AS teacher_id, ${s.createdColumn} AS created_at FROM ${s.table}${where}`
}).join('\n     UNION ALL\n     ')

/**
 * One row per artefact kind. Kinds with no rows at all are filled in as zeros
 * by the caller-facing wrapper below — a feature nobody has ever used is the
 * single most informative cell on this dashboard, so it must not be missing.
 *
 * Scans every artefact table in full to produce `total_count`. Fine at current
 * volume (this is an admin page, not a hot path); if it ever stops being fine,
 * it belongs behind the usage_rollup pattern rather than being made cheaper
 * in place.
 */
export async function getArtifactUsage(days = 30): Promise<ArtifactUsageRow[]> {
  const { rows } = await pool.query<ArtifactUsageRow>(
    `WITH artifacts AS (
       ${ARTIFACT_UNION_SQL}
     )
     SELECT
       kind,
       COUNT(*) FILTER (WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL)::int                        AS period_count,
       COUNT(DISTINCT teacher_id) FILTER (WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL)::int      AS period_teachers,
       COUNT(*)::int                                                                                       AS total_count,
       MAX(created_at)                                                                                     AS last_at
     FROM artifacts
     GROUP BY kind`,
    [days]
  )

  const created = new Map(rows.map((r) => [r.kind, r]))
  const exports = new Map((await getArtifactExports(days)).map((r) => [r.kind, r]))

  // Union of both key spaces, not just ARTIFACT_SOURCES: some exports are
  // reports rendered from live data with no artefact table behind them
  // (Мониторинг РПД, УМЦ-готовность, выгрузка использования), and dropping
  // them would hide real usage of features that create nothing.
  const kinds = [...new Set([...ARTIFACT_SOURCES.map((s) => s.kind), ...exports.keys()])]

  return kinds
    .map((kind) => {
      const c = created.get(kind)
      const e = exports.get(kind)
      return {
        kind,
        period_count:    c?.period_count    ?? 0,
        period_teachers: c?.period_teachers ?? 0,
        total_count:     c?.total_count     ?? 0,
        last_at:         c?.last_at         ?? null,
        export_count:    e?.export_count    ?? 0,
        exported_items:  e?.exported_items  ?? 0,
        export_teachers: e?.export_teachers ?? 0,
      }
    })
    .sort((a, b) =>
      b.period_count - a.period_count ||
      b.export_count - a.export_count ||
      b.total_count - a.total_count
    )
}
