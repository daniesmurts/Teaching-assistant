import client from './client'
import type { RpdSubmission } from '../types'

// УМЦ's side of the РПД approval route (docs/RPD-WORKFLOW.md phase 4b) —
// 'forwarded' items institution-wide.

export async function getForwardedQueue(): Promise<RpdSubmission[]> {
  const res = await client.get<RpdSubmission[]>('/api/institution/rpd-approvals')
  return res.data
}

export async function actOnForwardedSubmission(
  submissionId: string, action: 'return' | 'approve', comment?: string,
): Promise<RpdSubmission> {
  const res = await client.post<RpdSubmission>(`/api/institution/rpd-approvals/${submissionId}/${action}`, { comment })
  return res.data
}
