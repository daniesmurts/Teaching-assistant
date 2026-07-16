import client from './client'
import type { LiveSession } from '../types'

// Live QR quiz (TODO.md Feature Y) — teacher-side authenticated client.

export async function createLiveSession(quizId: string): Promise<LiveSession> {
  const res = await client.post<LiveSession>('/api/live-sessions', { quiz_id: quizId })
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
