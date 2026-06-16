import client from './client'
import type { CurriculumAnalysis } from '../types'

// КНИТУ admin feature A3 — анализ дублирования содержания между дисциплинами.
export async function analyzeOverlap(courseIds: string[]): Promise<CurriculumAnalysis> {
  // Extraction + per-topic embedding + classification across several disciplines
  // can run ~1 minute — override the client's default timeout for this call.
  const res = await client.post<CurriculumAnalysis>('/api/curriculum/overlap', {
    course_ids: courseIds,
  }, { timeout: 180_000 })
  return res.data
}
