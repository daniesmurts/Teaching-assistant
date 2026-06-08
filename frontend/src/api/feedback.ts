import client from './client'

export type FeedbackCategory = 'bug' | 'idea' | 'question' | 'other'

export async function submitFeedback(data: {
  message: string
  category: FeedbackCategory
  page?: string
}): Promise<void> {
  await client.post('/api/feedback', data)
}
