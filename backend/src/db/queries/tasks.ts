import { pool } from '../connection'
import type { TaskItem, TaskSet } from '../../../../shared/types'

export async function createTaskSet(data: {
  teacherId:  string
  courseId?:  string
  kind:       string
  topic:      string
  difficulty: string
  tasks:      TaskItem[]
}): Promise<TaskSet> {
  const { rows } = await pool.query<Omit<TaskSet, 'course_name'>>(
    `INSERT INTO task_sets (teacher_id, course_id, kind, topic, difficulty, tasks)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [data.teacherId, data.courseId ?? null, data.kind, data.topic, data.difficulty, JSON.stringify(data.tasks)]
  )
  return { ...rows[0], course_name: null }
}

export async function listTaskSets(teacherId: string, kind?: string, limit = 50): Promise<TaskSet[]> {
  const { rows } = await pool.query<TaskSet>(
    `SELECT t.*, c.name AS course_name
       FROM task_sets t
       LEFT JOIN courses c ON c.id = t.course_id
      WHERE t.teacher_id = $1 AND ($2::text IS NULL OR t.kind = $2)
      ORDER BY t.created_at DESC LIMIT $3`,
    [teacherId, kind ?? null, Math.min(limit, 200)]
  )
  return rows
}

export async function getTaskSet(id: string, teacherId: string): Promise<TaskSet | null> {
  const { rows } = await pool.query<TaskSet>(
    `SELECT t.*, c.name AS course_name
       FROM task_sets t
       LEFT JOIN courses c ON c.id = t.course_id
      WHERE t.id = $1 AND t.teacher_id = $2`,
    [id, teacherId]
  )
  return rows[0] ?? null
}

export async function deleteTaskSet(id: string, teacherId: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM task_sets WHERE id = $1 AND teacher_id = $2`, [id, teacherId])
  return (rowCount ?? 0) > 0
}

// Count-based monthly usage (no pre-aggregated counter — mirrors topics).
export async function countTasksThisMonth(teacherId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM task_sets
     WHERE teacher_id = $1 AND created_at >= date_trunc('month', NOW())`,
    [teacherId]
  )
  return parseInt(rows[0].count, 10)
}
