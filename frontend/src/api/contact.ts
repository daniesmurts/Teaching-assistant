import client from './client'

export type ContactTopic = 'support' | 'demo' | 'research' | 'billing'
export type ContactSourcePage = 'contact' | 'research'

export async function submitContactMessage(data: {
  name: string
  email: string
  organization?: string
  topic?: ContactTopic
  message: string
  sourcePage: ContactSourcePage
}): Promise<void> {
  await client.post('/api/contact', data)
}
