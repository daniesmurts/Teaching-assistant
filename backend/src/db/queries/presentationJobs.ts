import { pool } from '../connection'
import type { PresentationJobStatus, PresentationOutlineSlide } from '../../../../shared/types'
import type { GenerateParams, GenerateResult } from '../../services/presentations'
import type { SearchResult } from '../../services/yandexSearch'

export interface PresentationJobRow {
  id:              string
  teacher_id:      string
  status:          PresentationJobStatus
  presentation_id: string | null
  result:          GenerateResult | null
  error_message:   string | null
  created_at:      string
  // Outline approval gate (migration 118). params is stored server-side so
  // the confirm request carries only the edited outline — the client must
  // not be able to swap the conspectus or a plan-gated depth between the two
  // halves of one generation.
  params:           GenerateParams | null
  outline:          PresentationOutlineSlide[] | null
  web_grounding:    SearchResult[] | null
  outline_ready_at: string | null
}

export async function createPresentationJob(
  teacherId: string,
  params: GenerateParams,
): Promise<PresentationJobRow> {
  const { rows } = await pool.query<PresentationJobRow>(
    `INSERT INTO presentation_jobs (teacher_id, params) VALUES ($1, $2) RETURNING *`,
    [teacherId, JSON.stringify(params)]
  )
  return rows[0]
}

export async function getPresentationJobById(id: string, teacherId: string): Promise<PresentationJobRow | null> {
  const { rows } = await pool.query<PresentationJobRow>(
    `SELECT * FROM presentation_jobs WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
  return rows[0] ?? null
}

// Worker-side lookup — the pg-boss payload is trusted (built by our own
// route), so no teacher scoping here. Route handlers must use getPresentationJobById.
export async function getPresentationJobByIdUnscoped(id: string): Promise<PresentationJobRow | null> {
  const { rows } = await pool.query<PresentationJobRow>(
    `SELECT * FROM presentation_jobs WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function setPresentationJobProcessing(id: string): Promise<void> {
  await pool.query(`UPDATE presentation_jobs SET status = 'processing' WHERE id = $1`, [id])
}

export async function completePresentationJob(
  id: string,
  result: GenerateResult
): Promise<void> {
  await pool.query(
    `UPDATE presentation_jobs SET status = 'ready', result = $2, presentation_id = $3 WHERE id = $1`,
    [id, JSON.stringify(result), result.presentation_id]
  )
}

export async function failPresentationJob(id: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE presentation_jobs SET status = 'failed', error_message = $2 WHERE id = $1`,
    [id, message.slice(0, 500)]
  )
}

// ─── Outline approval gate (migration 118) ──────────────────────────────────

/**
 * Hands the plan back to the teacher and parks the job. Guarded on the
 * current status so a retried worker attempt can't resurrect a job the
 * teacher has already confirmed (or that the sweep has expired) — the
 * `status IN ('pending','processing')` predicate is what makes the outline
 * stage idempotent.
 */
export async function setPresentationJobOutlineReady(
  id: string,
  outline: PresentationOutlineSlide[],
  webGrounding: SearchResult[],
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE presentation_jobs
        SET status = 'outline_ready', outline = $2, web_grounding = $3, outline_ready_at = NOW()
      WHERE id = $1 AND status IN ('pending', 'processing')`,
    [id, JSON.stringify(outline), JSON.stringify(webGrounding)]
  )
  return (rowCount ?? 0) > 0
}

/**
 * Teacher confirmed the plan (possibly edited). Returns false when the job
 * wasn't waiting for confirmation any more — a double-submitted «Продолжить»,
 * or an outline the sweep expired while the teacher was editing — which the
 * route turns into a 409 rather than enqueueing a second expansion.
 */
export async function confirmPresentationJobOutline(
  id: string,
  teacherId: string,
  outline: PresentationOutlineSlide[],
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE presentation_jobs
        SET status = 'processing', outline = $3
      WHERE id = $1 AND teacher_id = $2 AND status = 'outline_ready'`,
    [id, teacherId, JSON.stringify(outline)]
  )
  return (rowCount ?? 0) > 0
}

/**
 * Expires outlines nobody confirmed. Clears `params` as well as failing the
 * row: params holds up to 20k chars of the teacher's own conspectus, and an
 * abandoned draft is no reason to keep it indefinitely.
 */
export async function expireStalePresentationOutlines(olderThanHours: number): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE presentation_jobs
        SET status = 'failed',
            error_message = 'Черновик плана истёк — создайте презентацию заново',
            params = NULL
      WHERE status = 'outline_ready'
        AND outline_ready_at < NOW() - ($1 || ' hours')::interval`,
    [String(olderThanHours)]
  )
  return rowCount ?? 0
}
