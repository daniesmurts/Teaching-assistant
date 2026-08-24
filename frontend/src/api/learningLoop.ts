import client from './client'
import type { LearningLoopSummary } from '../../../shared/types'
export type { LearningLoopSummary } from '../../../shared/types'

export async function getLearningLoopSummary(): Promise<LearningLoopSummary> {
  const res = await client.get<LearningLoopSummary>('/api/learning-loop/summary')
  return res.data
}
