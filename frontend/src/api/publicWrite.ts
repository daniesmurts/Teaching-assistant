import axios from 'axios'
import type { SubmissionTelemetry } from '../types'

// Dedicated client for the public student writing surface. Unlike the main
// `client`, it attaches NO teacher JWT and has NO 401→/login redirect — a
// student has no account. The per-student token in the URL is the credential.
const publicClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  timeout: 20000,
})

export interface WriteAssignment {
  title:        string
  instructions: string | null
  due_at:       string | null
  status:       'draft' | 'open' | 'closed'
}

export interface WriteState {
  assignment:      WriteAssignment
  student_name:    string | null
  status:          'invited' | 'writing' | 'submitted'
  consent_given:   boolean
  submitted:       boolean
  draft_content:   unknown | null
  consent_version: string
}

export async function getWriteState(token: string): Promise<WriteState> {
  return (await publicClient.get<WriteState>(`/api/write/${token}`)).data
}

export async function acceptConsent(token: string, version: string): Promise<void> {
  await publicClient.post(`/api/write/${token}/consent`, { version })
}

export async function saveDraft(
  token: string,
  body: { draft_content: unknown; telemetry: SubmissionTelemetry; snapshot?: boolean }
): Promise<void> {
  await publicClient.put(`/api/write/${token}/draft`, body)
}

export async function submitWrite(
  token: string,
  body: { draft_content: unknown; telemetry: SubmissionTelemetry }
): Promise<void> {
  await publicClient.post(`/api/write/${token}/submit`, body)
}
