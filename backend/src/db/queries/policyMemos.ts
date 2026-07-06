import { pool } from '../connection'

export interface PolicyMemo {
  course_id:      string
  memo_text:      string
  based_on_count: number
  generated_at:   string
  model_used:     string | null
}

interface PolicyMemoRow {
  course_id:      string
  memo_text:      string
  based_on_count: number
  generated_at:   Date
  model_used:     string | null
}

function toPolicyMemo(row: PolicyMemoRow): PolicyMemo {
  return {
    course_id:      row.course_id,
    memo_text:      row.memo_text,
    based_on_count: row.based_on_count,
    generated_at:   row.generated_at.toISOString(),
    model_used:     row.model_used,
  }
}

export async function getPolicyMemo(courseId: string): Promise<PolicyMemo | null> {
  const { rows } = await pool.query<PolicyMemoRow>(
    'SELECT * FROM course_policy_memos WHERE course_id = $1 LIMIT 1',
    [courseId]
  )
  return rows[0] ? toPolicyMemo(rows[0]) : null
}

export async function upsertPolicyMemo(
  courseId:  string,
  memoText:  string,
  count:     number,
  modelUsed: string | null,
): Promise<PolicyMemo> {
  const { rows } = await pool.query<PolicyMemoRow>(
    `INSERT INTO course_policy_memos (course_id, memo_text, based_on_count, generated_at, model_used)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (course_id) DO UPDATE
       SET memo_text = $2, based_on_count = $3, generated_at = NOW(), model_used = $4
     RETURNING *`,
    [courseId, memoText, count, modelUsed]
  )
  return toPolicyMemo(rows[0])
}

// Count of approved_revisions rows for this course created since the memo's
// last generated_at (or all-time if no memo exists yet) — cheap gate for the
// "regenerate every ~10 approvals" throttle.
export async function countApprovalsSince(courseId: string, since: Date | null): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM approved_revisions r
       JOIN assignments a ON a.id = r.assignment_id
      WHERE a.course_id = $1
        AND ($2::timestamptz IS NULL OR r.approved_at > $2)`,
    [courseId, since]
  )
  return parseInt(rows[0].count, 10)
}

// The raw corrections used to distill a memo — ai_* vs approved_* pairs where
// the teacher meaningfully diverged from the AI draft.
export interface PolicyMemoSourceRow {
  submission_excerpt: string
  ai_score:           number | null
  ai_feedback:        string | null
  approved_score:     number | null
  approved_feedback:  string | null
}

export async function findPolicyMemoSources(courseId: string, limit = 30): Promise<PolicyMemoSourceRow[]> {
  const { rows } = await pool.query<PolicyMemoSourceRow>(
    `SELECT LEFT(a.submission_text, 800) AS submission_excerpt,
            a.ai_score, a.ai_feedback,
            a.approved_score, a.approved_feedback
       FROM assignments a
      WHERE a.course_id = $1
        AND a.status = 'approved'
        AND (
          ABS(COALESCE(a.approved_score, 0) - COALESCE(a.ai_score, 0)) >= 1
          OR a.approved_feedback IS DISTINCT FROM a.ai_feedback
        )
      ORDER BY a.approved_at DESC
      LIMIT $2`,
    [courseId, limit]
  )
  return rows
}
