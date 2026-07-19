import axios from 'axios'
import type { LiveJoinState } from '../types'

// Dedicated client for the public live-quiz join/answer surface. Unlike the
// main `client`, it attaches NO teacher JWT and has NO 401→/login redirect —
// a student has no account. The server-issued participant_token is the
// credential. Mirrors api/publicWrite.ts exactly.
const publicClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  timeout: 20000,
})

export interface JoinResult {
  participant_token: string
  session_id:        string
}

export async function joinSession(code: string, nickname?: string): Promise<JoinResult> {
  const res = await publicClient.post<JoinResult>(`/api/live-join/${code}/join`, { nickname })
  return res.data
}

export async function getJoinState(code: string, participantToken: string): Promise<LiveJoinState> {
  const res = await publicClient.get<LiveJoinState>(`/api/live-join/${code}/state`, {
    params: { participant_token: participantToken },
  })
  return res.data
}

export async function submitAnswer(code: string, participantToken: string, choiceIndex: number): Promise<void> {
  await publicClient.post(`/api/live-join/${code}/answer`, {
    participant_token: participantToken,
    choice_index: choiceIndex,
  })
}

// Self-paced only — moves the participant on to their own next question.
export async function advanceSelf(code: string, participantToken: string): Promise<void> {
  await publicClient.post(`/api/live-join/${code}/advance`, { participant_token: participantToken })
}
