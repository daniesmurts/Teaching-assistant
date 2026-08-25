import client from './client'
import type { UmcDashboardResult } from '../types'

// Кабинет методиста (TODO Feature AM, Phase 2) — async check runs. Mirrors
// api/fos.ts: POST kicks off a pg-boss job and returns immediately with a
// 'queued' row; GET polls it.

export type MethodistCheckKey = 'syllabus' | 'coverage' | 'placement' | 'mto' | 'linkage'
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

// TODO Feature AM, Phase 3 — cross-programme triage queue. Same shape as
// api/umcDashboard.ts's getUmcDashboard (reuses the backend aggregation
// wholesale) but reachable via `methodist_access` — see routes/methodist.ts.
export async function getMethodistQueue(): Promise<UmcDashboardResult> {
  const res = await client.get<UmcDashboardResult>('/api/methodist/queue')
  return res.data
}

// TODO Feature AM, Phase 3 — checks for a РПД that isn't attached to any
// programme yet. Runs the same three checks the discipline tab offers that
// don't need real programme data (see backend/src/services/methodist/
// adHocChecks.ts's header for exactly why coverage/placement can't run
// here). Exactly one of `file`/`text` should be set; the file wins if both
// are (matches the backend's own precedence). `fosFile` is optional and only
// feeds the `linkage` check — the discipline being checked here doesn't
// exist in the system yet, so nothing about the ФОС is persisted; attaching
// it for real (once the discipline is added to an ОП) still means uploading
// it again through the programme's own document panel.
export type AdHocCheckKey = 'syllabus' | 'linkage' | 'mto'
export interface AdHocCheckOutcome {
  key:        AdHocCheckKey
  status:     'ok' | 'error'
  result?:    unknown
  error?:     string
}

export async function reviewAdHoc(
  input: { file?: File; text?: string; fosFile?: File }, checks: AdHocCheckKey[]
): Promise<AdHocCheckOutcome[]> {
  const form = new FormData()
  if (input.file) form.append('file', input.file)
  else if (input.text) form.append('syllabus_text', input.text)
  if (input.fosFile) form.append('fos_file', input.fosFile)
  form.append('checks', checks.join(','))
  const res = await client.post<{ checks: AdHocCheckOutcome[] }>('/api/methodist/ad-hoc-review', form, { timeout: 180_000 })
  return res.data.checks
}
