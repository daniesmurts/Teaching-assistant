import client from './client'

export interface LearningLoopSummary {
  style_match: {
    current_pct:  number | null
    previous_pct: number | null
    delta:        number | null
    sample_n_30d: number
  }
  approved: {
    lifetime:            number
    this_month:          number
    delta_vs_last_month: number
  }
  used_as_example_30d: number
  bullets_retention_30d: {
    pct:        number | null
    sample_n:   number
  }
  kafedra_contribution_30d: number
  trend_weekly: Array<{ week: string; mean_delta: number; n: number }>
}

export async function getLearningLoopSummary(): Promise<LearningLoopSummary> {
  const res = await client.get<LearningLoopSummary>('/api/learning-loop/summary')
  return res.data
}
