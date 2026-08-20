import client from './client'
import type { UmcDashboardResult, SyllabusReview } from '../types'

// Кабинет методиста (TODO Feature AM, Phase 2) — async check runs. Mirrors
// api/fos.ts: POST kicks off a pg-boss job and returns immediately with a
// 'queued' row; GET polls it.

export type MethodistCheckKey = 'syllabus' | 'coverage' | 'placement' | 'mto'
export type MethodistRunStatus = 'queued' | 'processing' | 'ready' | 'failed'

export interface MethodistCheckOutcome {
  key:        MethodistCheckKey
  status:     'ok' | 'error'
  result_id?: string
  result?:    unknown
  error?:     string
}

export interface MethodistRun {
  id:                string
  teacher_id:        string
  program_id:        string
  discipline_id:     string
  requested_checks:  MethodistCheckKey[]
  status:            MethodistRunStatus
  checks:            MethodistCheckOutcome[] | null
  error_message:     string | null
  created_at:        string
  updated_at:        string
}

export async function createMethodistRun(
  programId: string, disciplineId: string, checks: MethodistCheckKey[]
): Promise<MethodistRun> {
  const res = await client.post<MethodistRun>('/api/methodist/runs', {
    program_id: programId, discipline_id: disciplineId, checks,
  })
  return res.data
}

// Poll endpoint — run may still be queued/processing.
export async function getMethodistRun(id: string): Promise<MethodistRun> {
  const res = await client.get<MethodistRun>(`/api/methodist/runs/${id}`)
  return res.data
}

export async function listMethodistRuns(): Promise<MethodistRun[]> {
  const res = await client.get<MethodistRun[]>('/api/methodist/runs')
  return res.data
}

// TODO Feature AM, Phase 3 — cross-programme triage queue. Same shape as
// api/umcDashboard.ts's getUmcDashboard (reuses the backend aggregation
// wholesale) but reachable via `methodist_access` — see routes/methodist.ts.
export async function getMethodistQueue(): Promise<UmcDashboardResult> {
  const res = await client.get<UmcDashboardResult>('/api/methodist/queue')
  return res.data
}

// TODO Feature AM, Phase 3 — §5-§8 evidence-citation coverage check for a
// РПД that isn't attached to any programme yet. Exactly one of `file`/`text`
// should be set; the file wins if both are (matches the backend's own
// precedence in routes/methodist.ts).
export async function reviewAdHocSyllabus(input: { file?: File; text?: string }): Promise<SyllabusReview> {
  const form = new FormData()
  if (input.file) form.append('file', input.file)
  else if (input.text) form.append('syllabus_text', input.text)
  const res = await client.post<SyllabusReview>('/api/methodist/ad-hoc-review', form, { timeout: 120_000 })
  return res.data
}
