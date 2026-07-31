import { pool } from '../connection'
import type { TopicItem, TopicSet } from '../../../../shared/types'

export async function createTopicSet(data: {
  teacherId: string
  courseId?: string
  level: string
  workType: string
  field?: string
  interests?: string
  practiceSite?: string
  studentName?: string
  studentGroup?: string
  topics: TopicItem[]
  usedSearch: boolean
}): Promise<TopicSet> {
  const { rows } = await pool.query<Omit<TopicSet, 'course_name'>>(
    `INSERT INTO topic_sets
       (teacher_id, course_id, level, work_type, field, interests, practice_site,
        student_name, student_group, topics, used_search)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      data.teacherId, data.courseId ?? null, data.level, data.workType,
      data.field ?? null, data.interests ?? null, data.practiceSite ?? null,
      data.studentName ?? null, data.studentGroup ?? null,
      JSON.stringify(data.topics), data.usedSearch,
    ]
  )
  return { ...rows[0], course_name: null }
}

export async function listTopicSets(teacherId: string, limit = 50): Promise<TopicSet[]> {
  const { rows } = await pool.query<TopicSet>(
    `SELECT t.*, c.name AS course_name
       FROM topic_sets t
       LEFT JOIN courses c ON c.id = t.course_id
      WHERE t.teacher_id = $1
      ORDER BY t.created_at DESC LIMIT $2`,
    [teacherId, Math.min(limit, 200)]
  )
  return rows
}

export async function getTopicSet(id: string, teacherId: string): Promise<TopicSet | null> {
  const { rows } = await pool.query<TopicSet>(
    `SELECT t.*, c.name AS course_name
       FROM topic_sets t
       LEFT JOIN courses c ON c.id = t.course_id
      WHERE t.id = $1 AND t.teacher_id = $2`,
    [id, teacherId]
  )
  return rows[0] ?? null
}

export async function deleteTopicSet(id: string, teacherId: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM topic_sets WHERE id = $1 AND teacher_id = $2`, [id, teacherId])
  return (rowCount ?? 0) > 0
}

// Count-based monthly usage (no pre-aggregated counter needed for this feature).
export async function countTopicsThisMonth(teacherId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM topic_sets
     WHERE teacher_id = $1 AND created_at >= date_trunc('month', NOW())`,
    [teacherId]
  )
  return parseInt(rows[0].count, 10)
}
