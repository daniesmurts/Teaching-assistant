import client from './client'

export async function deleteAccount(password: string): Promise<void> {
  await client.delete('/api/account', { data: { password } })
}
