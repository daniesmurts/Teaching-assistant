import client from './client'
import type { ChallengeRequest, ChallengeResult } from '../types'

export async function submitChallenge(params: ChallengeRequest): Promise<ChallengeResult> {
  const res = await client.post<ChallengeResult>('/api/challenges', params)
  return res.data
}
