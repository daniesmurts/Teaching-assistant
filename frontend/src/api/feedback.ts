import client from './client'

export type FeedbackCategory = 'bug' | 'idea' | 'question' | 'other' | 'help_up' | 'help_down' | 'help_search'

export async function submitFeedback(data: {
  message: string
  category: FeedbackCategory
  page?: string
}): Promise<void> {
  await client.post('/api/feedback', data)
}
