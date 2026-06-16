import client from './client'

export interface FeedbackHit {
  assignment_id:     string
  course_name:       string | null
  student_label:     string | null
  approved_score:    number | null
  approved_grade:    string | null
  approved_feedback: string | null
  feedback_excerpt:  string
  similarity:        number
  approved_at:       string | null
}

export async function searchFeedbackLibrary(params: {
  q:          string
  course_id?: string
  limit?:     number
}): Promise<FeedbackHit[]> {
  const res = await client.get<{ hits: FeedbackHit[] }>('/api/grading/library/search', { params })
  return res.data.hits
}
