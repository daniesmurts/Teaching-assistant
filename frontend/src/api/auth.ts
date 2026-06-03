import client from './client'
import type { AuthResponse, Teacher, PlanState } from '../types'

export async function register(data: {
  email: string; password: string; name?: string; university?: string
}): Promise<AuthResponse> {
  const res = await client.post<AuthResponse>('/api/auth/register', data)
  return res.data
}

export async function login(data: {
  email: string; password: string
}): Promise<AuthResponse> {
  const res = await client.post<AuthResponse>('/api/auth/login', data)
  return res.data
}

// GET /api/auth/me returns the teacher fields flat, with `plan` as a sibling.
export async function getMe(): Promise<{ teacher: Teacher; plan: PlanState }> {
  const res = await client.get<Teacher & { plan: PlanState }>('/api/auth/me')
  const { plan, ...teacher } = res.data
  return { teacher, plan }
}

export async function forgotPassword(email: string): Promise<void> {
  await client.post('/api/auth/forgot-password', { email })
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await client.post('/api/auth/reset-password', { token, password })
}
