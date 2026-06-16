import { pool } from '../db/connection'
import { embed } from './deepseek'

// What a single search hit returns. Designed for two consumers:
//   - the standalone /library page (full list view)
//   - the inline "похожий прошлый отзыв" hint in the grading form
// Both want enough text to be useful at a glance without a second round-trip.

export interface FeedbackHit {
  assignment_id:        string
  course_name:          string | null
  student_label:        string | null     // group only — kept identifiable for the teacher's own context
  approved_score:       number | null
  approved_grade:       string | null
  approved_feedback:    string | null     // typically the most relevant body
  feedback_excerpt:     string            // first ~240 chars for list display
  similarity:           number            // pgvector cosine distance (lower = closer)
  approved_at:          string | null
}

export interface SearchOptions {
  query:    string
  courseId?: string
  limit?:    number          // default 10, max 20
}

/**
 * Vector similarity search over a single teacher's approved grades. Scope is
 * always (teacher_id = X AND status='approved' AND embedding IS NOT NULL).
 * Returns hits ordered by similarity. The teacher's *own* corpus only — no
 * institution sharing in this Phase 2 cut (Phase 3 territory).
 */
export async function searchFeedbackLibrary(
  teacherId: string,
  opts: SearchOptions,
): Promise<FeedbackHit[]> {
  const limit = Math.min(opts.limit ?? 10, 20)
  const query = opts.query.trim()
  if (query.length < 3) return []

  const vector = await embed(query, { teacherId, feature: 'embedding' })
  const vectorLiteral = `[${vector.join(',')}]`

  const params: unknown[] = [teacherId, vectorLiteral, limit]
  let courseFilter = ''
  if (opts.courseId) {
    params.push(opts.courseId)
    courseFilter = ` AND a.course_id = $${params.length}::uuid`
  }

  const { rows } = await pool.query<{
    id:                string
    course_name:       string | null
    student_name:      string | null
    student_group:     string | null
    approved_score:    number | null
    approved_grade:    string | null
    approved_feedback: string | null
    similarity:        number
    approved_at:       Date | null
  }>(
    `SELECT a.id, c.name AS course_name,
            a.student_name, a.student_group,
            a.approved_score, a.approved_grade, a.approved_feedback,
            (a.embedding <=> $2) AS similarity,
            a.approved_at
       FROM assignments a
       LEFT JOIN courses c ON c.id = a.course_id
      WHERE a.teacher_id = $1
        AND a.status = 'approved'
        AND a.embedding IS NOT NULL${courseFilter}
      ORDER BY a.embedding <=> $2
      LIMIT $3`,
    params
  )

  return rows.map((r) => ({
    assignment_id:    r.id,
    course_name:      r.course_name,
    student_label:    composeStudentLabel(r.student_name, r.student_group),
    approved_score:   r.approved_score,
    approved_grade:   r.approved_grade,
    approved_feedback: r.approved_feedback,
    feedback_excerpt: excerpt(r.approved_feedback ?? '', 240),
    similarity:       Number(r.similarity),
    approved_at:      r.approved_at?.toISOString() ?? null,
  }))
}

function composeStudentLabel(name: string | null, group: string | null): string | null {
  if (!name && !group) return null
  if (name && group) return `${name} · ${group}`
  return name ?? group
}

function excerpt(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…'
}
