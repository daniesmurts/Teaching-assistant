import client from './client'
import type { FeedbackHit } from '../../../shared/types'

export async function searchFeedbackLibrary(params: {
  q:          string
  course_id?: string
  limit?:     number
}): Promise<FeedbackHit[]> {
  const res = await client.get<{ hits: FeedbackHit[] }>('/api/grading/library/search', { params })
  return res.data.hits
}
