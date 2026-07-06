import client from './client'

export interface EvalRunListItem {
  id:            string
  teacher_id:    string | null
  course_id:     string | null
  model:         string
  conditions:    number[]
  status:        'running' | 'done' | 'failed'
  kind:          'flywheel' | 'confidence'
  notes:         string | null
  created_at:    string
  completed_at:  string | null
  result_count:  number
  teacher_email: string | null
  course_name:   string | null
}

export interface ConditionSummary {
  k: number; variant: string; n: number; meanExamples: number
  qwk: number | null; mae: number | null; rho: number | null
}

export interface CoveragePoint {
  coverage: number; n: number; meanError: number; gradeAccuracy: number; signalMax: number
}
export interface CalibrationBin {
  bin: number; n: number; signalLow: number; signalHigh: number; meanError: number; gradeAccuracy: number
}
export interface ConfidenceLabelAgg {
  confidence: string; n: number; meanError: number; gradeAccuracy: number
}

export type RunSummary =
  | { kind: 'flywheel'; conditions: ConditionSummary[] }
  | {
      kind: 'confidence'; n: number; selectivity: number
      riskCoverage: CoveragePoint[]; calibration: CalibrationBin[]; byLabel: ConfidenceLabelAgg[]
    }

export interface RunDetail {
  run: EvalRunListItem
  summary: RunSummary
}

export interface ConfidenceConfig {
  highStdMax: number; lowStdMin: number
  runId: string | null; nHigh: number | null; nLow: number | null; fittedAt: string | null
}

export interface FittedThresholds {
  highStdMax: number; lowStdMin: number
  nHigh: number; nLow: number; highError: number; lowError: number
}

export async function listEvalRuns(): Promise<EvalRunListItem[]> {
  return (await client.get<EvalRunListItem[]>('/api/admin/evals')).data
}

export async function getEvalRun(id: string): Promise<RunDetail> {
  return (await client.get<RunDetail>(`/api/admin/evals/${id}`)).data
}

export async function getConfidenceConfig(): Promise<ConfidenceConfig | null> {
  return (await client.get<ConfidenceConfig | null>('/api/admin/evals/config')).data
}

export async function startFlywheelRun(data: {
  teacher_id: string; course_id?: string; k?: number[]; variants?: string[]; limit?: number; notes?: string
}): Promise<EvalRunListItem> {
  return (await client.post<EvalRunListItem>('/api/admin/evals', data)).data
}

export async function startConfidenceRun(data: {
  teacher_id: string; course_id?: string; k?: number; samples?: number; limit?: number; notes?: string
}): Promise<EvalRunListItem> {
  return (await client.post<EvalRunListItem>('/api/admin/evals/confidence', data)).data
}

export async function applyThresholds(runId: string): Promise<FittedThresholds> {
  return (await client.post<FittedThresholds>(`/api/admin/evals/${runId}/apply-thresholds`, {})).data
}

export function evalCsvUrl(runId: string): string {
  return `${client.defaults.baseURL ?? ''}/api/admin/evals/${runId}/csv`
}
