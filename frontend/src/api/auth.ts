import client from './client'
import type { AuthResponse, Teacher, PlanState } from '../types'

export async function register(data: {
  email: string; password: string; name?: string; university?: string; phone?: string
  invite_token?: string
}): Promise<AuthResponse> {
  const res = await client.post<AuthResponse>('/api/auth/register', data, { skipErrorToast: true })
  return res.data
}

// Public — look up an institution invite to prefill the register form.
export interface InviteInfo {
  valid:            boolean
  email?:           string
  institution_name?: string | null
}
export async function getInvite(token: string): Promise<InviteInfo> {
  const res = await client.get<InviteInfo>(`/api/auth/invite/${token}`, { skipErrorToast: true })
  return res.data
}

export async function login(data: {
  email: string; password: string
}): Promise<AuthResponse> {
  const res = await client.post<AuthResponse>('/api/auth/login', data, { skipErrorToast: true })
  return res.data
}

// SSO discovery — given an email, does its domain use SAML or password?
// Drives the email-first login flow. Never reveals whether the account exists,
// only whether the domain is configured for SSO.
export type SsoDiscovery =
  | { method: 'password' }
  | { method: 'saml'; institutionId: string; institutionName: string; loginUrl: string }

export async function discoverSso(email: string): Promise<SsoDiscovery> {
  const res = await client.post<SsoDiscovery>('/api/sso/discover', { email }, { skipErrorToast: true })
  return res.data
}

/** Extract a user-facing message from an auth error (for inline display). */
export function authErrorMessage(err: unknown): string {
  const ae = err as { response?: { status?: number; data?: { error?: string } }; code?: string }
  if (ae?.code === 'ERR_NETWORK') return 'Нет связи с сервером. Проверьте подключение к интернету.'
  return ae?.response?.data?.error ?? 'Не удалось войти. Попробуйте ещё раз.'
}

// GET /api/auth/me returns the teacher fields flat, with `plan` as a sibling.
// `token` overrides the stored JWT — used by the SSO callback, where the token
// arrives in the URL before it's committed to the auth store.
export async function getMe(token?: string): Promise<{ teacher: Teacher; plan: PlanState }> {
  const res = await client.get<Teacher & { plan: PlanState }>('/api/auth/me',
    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
  const { plan, ...teacher } = res.data
  return { teacher, plan }
}

// Re-send the email-verification link (in-app banner). Idempotent — the
// server no-ops if the address is already verified.
export async function resendVerificationEmail(): Promise<void> {
  await client.post('/api/auth/resend-verification')
}

export async function forgotPassword(email: string): Promise<void> {
  await client.post('/api/auth/forgot-password', { email }, { skipErrorToast: true })
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await client.post('/api/auth/reset-password', { token, password }, { skipErrorToast: true })
}
