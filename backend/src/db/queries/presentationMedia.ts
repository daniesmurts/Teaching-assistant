import { pool } from '../connection'

// Pictures lifted out of an uploaded .pptx (migration 128). Deliberately not
// document_figures: these are never retrieved by similarity, they belong to
// one slide of one deck, and the object behind each row is deleted with it.

export interface PresentationMediaRow {
  id:              string
  presentation_id: string
  teacher_id:      string
  slide_index:     number
  storage_path:    string
  mime_type:       string
  width:           number | null
  height:          number | null
  bytes:           number
}

export async function createPresentationMedia(data: {
  presentationId: string
  teacherId:      string
  slideIndex:     number
  storagePath:    string
  mimeType:       string
  width:          number | null
  height:         number | null
  bytes:          number
}): Promise<PresentationMediaRow> {
  const { rows } = await pool.query<PresentationMediaRow>(
    `INSERT INTO presentation_media
       (presentation_id, teacher_id, slide_index, storage_path, mime_type, width, height, bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, presentation_id, teacher_id, slide_index, storage_path, mime_type, width, height, bytes`,
    [data.presentationId, data.teacherId, data.slideIndex, data.storagePath,
     data.mimeType, data.width, data.height, data.bytes]
  )
  return rows[0]
}

export async function getPresentationMediaById(id: string): Promise<PresentationMediaRow | null> {
  const { rows } = await pool.query<PresentationMediaRow>(
    `SELECT id, presentation_id, teacher_id, slide_index, storage_path, mime_type, width, height, bytes
       FROM presentation_media WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

/** Storage keys for a deck — read BEFORE deleting it, so the objects can go too. */
export async function listPresentationMediaPaths(presentationId: string): Promise<string[]> {
  const { rows } = await pool.query<{ storage_path: string }>(
    'SELECT storage_path FROM presentation_media WHERE presentation_id = $1',
    [presentationId]
  )
  return rows.map((r) => r.storage_path)
}
