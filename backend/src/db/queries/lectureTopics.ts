import { pool } from '../connection'
import type { LectureTopic } from '../../../../shared/types'

// Тематический план of a course (migration 121) — the list a teacher picks a
// lecture from instead of retyping its topic.

interface Row {
  id:          string
  course_id:   string
  teacher_id:  string
  position:    number
  title:       string
  description: string | null
  source:      string
  created_at:  Date
}

function toTopic(r: Row): LectureTopic {
  return {
    id: r.id, course_id: r.course_id, position: r.position,
    title: r.title, description: r.description,
    source: r.source === 'manual' ? 'manual' : 'syllabus',
    created_at: r.created_at.toISOString(),
  }
}

export async function findLectureTopics(courseId: string, teacherId: string): Promise<LectureTopic[]> {
  const { rows } = await pool.query<Row>(
    `SELECT * FROM course_lecture_topics
      WHERE course_id = $1 AND teacher_id = $2
      ORDER BY position`,
    [courseId, teacherId]
  )
  return rows.map(toTopic)
}

export async function findLectureTopicById(id: string, teacherId: string): Promise<LectureTopic | null> {
  const { rows } = await pool.query<Row>(
    `SELECT * FROM course_lecture_topics WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
  return rows[0] ? toTopic(rows[0]) : null
}

/**
 * Replaces a course's plan wholesale, in one transaction.
 *
 * Delete-then-insert rather than a merge: a re-extraction is the teacher
 * saying "this plan is wrong, read the programme again", and a merge would
 * have to guess which of two similarly-worded темы are the same one. The
 * `ON DELETE SET NULL` on `presentations.lecture_topic_id` (migration 121) is
 * what makes that safe — decks already built survive, they just lose the link.
 */
export async function replaceLectureTopics(
  courseId: string,
  teacherId: string,
  topics: Array<{ title: string; description?: string | null; source?: 'syllabus' | 'manual' }>,
): Promise<LectureTopic[]> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'DELETE FROM course_lecture_topics WHERE course_id = $1 AND teacher_id = $2',
      [courseId, teacherId]
    )
    for (const [i, t] of topics.entries()) {
      await client.query(
        `INSERT INTO course_lecture_topics (course_id, teacher_id, position, title, description, source)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [courseId, teacherId, i + 1, t.title, t.description ?? null, t.source ?? 'syllabus']
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return findLectureTopics(courseId, teacherId)
}
