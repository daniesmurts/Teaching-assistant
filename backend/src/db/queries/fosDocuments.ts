import { pool } from '../connection'
import type { FosStatus, FosSections, FosCoverageReport } from '../../../../shared/types'

export interface FosDocumentRow {
  id:             string
  course_id:      string
  teacher_id:     string
  status:         FosStatus
  progress_done:  number
  progress_total: number
  sections:       FosSections | null
  coverage:       FosCoverageReport | null
  error_message:  string | null
  created_at:     string
  updated_at:     string
}

export async function createFosDocument(data: {
  courseId:  string
  teacherId: string
}): Promise<FosDocumentRow> {
  const { rows } = await pool.query<FosDocumentRow>(
    `INSERT INTO fos_documents (course_id, teacher_id) VALUES ($1, $2) RETURNING *`,
    [data.courseId, data.teacherId]
  )
  return rows[0]
}

export async function getFosDocumentById(id: string, teacherId: string): Promise<FosDocumentRow | null> {
  const { rows } = await pool.query<FosDocumentRow>(
    `SELECT * FROM fos_documents WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
  return rows[0] ?? null
}

export async function listFosDocumentsForCourse(courseId: string, teacherId: string): Promise<FosDocumentRow[]> {
  const { rows } = await pool.query<FosDocumentRow>(
    `SELECT * FROM fos_documents WHERE course_id = $1 AND teacher_id = $2 ORDER BY created_at DESC`,
    [courseId, teacherId]
  )
  return rows
}

export async function setFosStatus(id: string, status: FosStatus): Promise<void> {
  await pool.query(
    `UPDATE fos_documents SET status = $2, updated_at = NOW() WHERE id = $1`,
    [id, status]
  )
}

export async function setFosProgress(id: string, done: number, total: number): Promise<void> {
  await pool.query(
    `UPDATE fos_documents SET progress_done = $2, progress_total = $3, updated_at = NOW() WHERE id = $1`,
    [id, done, total]
  )
}

// Generation-time partial write — merges whatever sections have been produced
// so far. Called after each sub-generator step so a crash mid-run leaves
// earlier sections visible/editable rather than losing everything.
export async function setFosSections(id: string, sections: FosSections): Promise<void> {
  await pool.query(
    `UPDATE fos_documents SET sections = $2, updated_at = NOW() WHERE id = $1`,
    [id, JSON.stringify(sections)]
  )
}

export async function completeFosDocument(
  id: string,
  sections: FosSections,
  coverage: FosCoverageReport
): Promise<void> {
  await pool.query(
    `UPDATE fos_documents
       SET status = 'ready', sections = $2, coverage = $3,
           progress_done = progress_total, updated_at = NOW()
     WHERE id = $1`,
    [id, JSON.stringify(sections), JSON.stringify(coverage)]
  )
}

export async function failFosDocument(id: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE fos_documents SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
    [id, message.slice(0, 500)]
  )
}

// Teacher's manual edit to sections after generation — kept separate from
// setFosSections (the generation-time partial write) so an edit never resets
// status/progress; only allowed once a document has left 'pending'/'processing'.
export async function updateFosSections(id: string, teacherId: string, sections: FosSections): Promise<FosDocumentRow | null> {
  const { rows } = await pool.query<FosDocumentRow>(
    `UPDATE fos_documents SET sections = $3, updated_at = NOW()
     WHERE id = $1 AND teacher_id = $2
     RETURNING *`,
    [id, teacherId, JSON.stringify(sections)]
  )
  return rows[0] ?? null
}
