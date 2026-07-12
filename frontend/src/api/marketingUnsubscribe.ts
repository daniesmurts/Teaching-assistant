import client from './client'

export async function unsubscribeFromMarketingEmails(email: string): Promise<void> {
  await client.post('/api/auth/marketing-unsubscribe', { email })
}
