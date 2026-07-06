import { pool } from '../connection'
import type { CohortSynthesis } from '../../../../shared/types'

interface CohortSynthesisRow {
  published_assignment_id: string
  generated_at:             Date
  based_on_count:           number
  result:                   CohortSynthesis
  model_used:               string | null
}

export async function getCohortSynthesis(publishedAssignmentId: string): Promise<CohortSynthesis | null> {
  const { rows } = await pool.query<CohortSynthesisRow>(
    'SELECT * FROM cohort_syntheses WHERE published_assignment_id = $1 LIMIT 1',
    [publishedAssignmentId]
  )
  return rows[0] ? rows[0].result : null
}

export async function upsertCohortSynthesis(
  publishedAssignmentId: string,
  result:    CohortSynthesis,
  count:     number,
  modelUsed: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO cohort_syntheses (published_assignment_id, generated_at, based_on_count, result, model_used)
     VALUES ($1, NOW(), $2, $3::jsonb, $4)
     ON CONFLICT (published_assignment_id) DO UPDATE
       SET generated_at = NOW(), based_on_count = $2, result = $3::jsonb, model_used = $4`,
    [publishedAssignmentId, count, JSON.stringify(result), modelUsed]
  )
}
