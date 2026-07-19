import client from './client'
import type { LiveSession, LiveSessionMode } from '../types'

// Live QR quiz (TODO.md Feature Y) — teacher-side authenticated client.

export async function createLiveSession(quizId: string, mode: LiveSessionMode = 'paced'): Promise<LiveSession> {
  const res = await client.post<LiveSession>('/api/live-sessions', { quiz_id: quizId, mode })
  return res.data
}

export async function getLiveSession(id: string): Promise<LiveSession> {
  const res = await client.get<LiveSession>(`/api/live-sessions/${id}`)
  return res.data
}

export async function advanceLiveSession(id: string): Promise<LiveSession> {
  const res = await client.post<LiveSession>(`/api/live-sessions/${id}/next`)
  return res.data
}

export async function finishLiveSession(id: string): Promise<LiveSession> {
  const res = await client.post<LiveSession>(`/api/live-sessions/${id}/finish`)
  return res.data
}

export interface SaveToJournalEntry {
  participant_id: string
  student_name:   string
  student_group?: string
}

export async function saveLiveSessionToJournal(
  sessionId: string, courseId: string | undefined, entries: SaveToJournalEntry[]
): Promise<{ created: number; skipped: number }> {
  const res = await client.post<{ created: number; skipped: number }>(
    `/api/live-sessions/${sessionId}/save-to-journal`,
    { course_id: courseId, entries }
  )
  return res.data
}
