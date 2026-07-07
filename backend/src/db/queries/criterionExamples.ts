import { pool } from '../connection'

export interface InsertCriterionExample {
  assignmentId:  string
  teacherId:     string
  courseId:      string
  criterionName: string
  score:         number
  feedback:      string
  embedding:     number[]
}

export async function insertCriterionExample(ex: InsertCriterionExample): Promise<void> {
  await pool.query(
    `INSERT INTO criterion_rag_examples
       (assignment_id, teacher_id, course_id, criterion_name, score, feedback, embedding)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      ex.assignmentId, ex.teacherId, ex.courseId, ex.criterionName, ex.score, ex.feedback,
      `[${ex.embedding.join(',')}]`,
    ]
  )
}

export interface CriterionExample {
  feedback:   string
  score:      number
  similarity: number
}

/**
 * Own-course only — courses.teacher_id is NOT NULL (one course row belongs to
 * exactly one teacher), so scoping by course_id alone is already teacher-scoped.
 * Institution-wide cross-teacher matching (a separate join on course code, like
 * the whole-assignment RAG pool) is out of scope for v1.
 */
export async function findSimilarCriterionExamples(
  courseId: string,
  criterionName: string,
  embedding: number[],
  limit = 2
): Promise<CriterionExample[]> {
  const { rows } = await pool.query<CriterionExample>(
    `SELECT feedback, score, (embedding <=> $3) AS similarity
       FROM criterion_rag_examples
      WHERE course_id = $1
        AND LOWER(criterion_name) = LOWER($2)
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $3
      LIMIT $4`,
    [courseId, criterionName, `[${embedding.join(',')}]`, limit]
  )
  return rows
}
