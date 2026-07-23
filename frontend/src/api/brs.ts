import client from './client'
import type { BrsDraft, BrsStudentAccrual } from '../types'

// Feature AE v1 — БРС engine (TODO.md "### AE"). Extract → review → publish,
// same shape as api/admin.ts's ФГОС extraction, but per-course teacher data.

export async function extractBrsDraft(courseId: string): Promise<BrsDraft> {
  const res = await client.post<BrsDraft>('/api/brs/extract', { course_id: courseId })
  return res.data
}

export async function getBrsSchemeForCourse(courseId: string): Promise<BrsDraft | null> {
  const res = await client.get<BrsDraft | null>(`/api/brs/course/${courseId}`)
  return res.data
}

export async function getBrsScheme(id: string): Promise<BrsDraft> {
  const res = await client.get<BrsDraft>(`/api/brs/${id}`)
  return res.data
}

export async function createBrsDraft(courseId: string, draft: BrsDraft): Promise<BrsDraft> {
  const res = await client.post<BrsDraft>('/api/brs', { course_id: courseId, ...draft })
  return res.data
}

export async function publishBrsScheme(id: string, draft: BrsDraft): Promise<BrsDraft> {
  const res = await client.post<BrsDraft>(`/api/brs/${id}/publish`, draft)
  return res.data
}

export async function addBrsManualEntry(schemeId: string, data: {
  checkpoint_id: string
  student_name: string
  student_group?: string
  points: number
  note?: string
}): Promise<void> {
  await client.post(`/api/brs/${schemeId}/manual-entry`, data)
}

export async function getBrsLedger(courseId: string): Promise<BrsStudentAccrual[]> {
  const res = await client.get<BrsStudentAccrual[]>(`/api/brs/course/${courseId}/ledger`)
  return res.data
}

export async function getBrsStudentLedger(
  courseId: string, studentName: string, studentGroup?: string
): Promise<BrsStudentAccrual | null> {
  const res = await client.get<BrsStudentAccrual | null>(
    `/api/brs/course/${courseId}/ledger/${encodeURIComponent(studentName)}`,
    { params: studentGroup ? { student_group: studentGroup } : undefined }
  )
  return res.data
}
