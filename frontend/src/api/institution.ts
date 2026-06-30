import client from './client'
import type { Criterion, CriterionSubject } from '../types'

export interface InstitutionOverview {
  institution:        { id: string; name: string; plan_tier: string; max_teachers: number | null } | null
  totalTeachers:      number
  activeThisMonth:    number
  totalGrades:        number
  totalPresentations: number
}

export interface InstitutionDailyUsage {
  date:               string
  total_tokens:       number
  grade_count:        number
  presentation_count: number
}

export interface InstitutionTeacher {
  id:         string
  email:      string
  name:       string | null
  role:       string
  plan_tier:  string
  is_active:  boolean
  created_at: string
  grades:     number
}

export interface PendingInvite {
  id:               string
  email:            string
  expires_at:       string
  created_at:       string
  // Migration 048 — tri-state. NULL = pre-migration row (status unknown,
  // render as if no signal). TRUE = delivered, FALSE = send rejected.
  email_delivered?: boolean | null
  email_error?:     string  | null
}

export interface InstitutionCriterion extends Criterion {
  author_name: string | null
}

export async function getInstitutionOverview(): Promise<InstitutionOverview> {
  return (await client.get<InstitutionOverview>('/api/institution/overview')).data
}

export async function getInstitutionUsage(days = 30): Promise<InstitutionDailyUsage[]> {
  return (await client.get<InstitutionDailyUsage[]>('/api/institution/usage/daily', { params: { days } })).data
}

export async function getInstitutionTeachers(): Promise<InstitutionTeacher[]> {
  return (await client.get<InstitutionTeacher[]>('/api/institution/teachers')).data
}

export async function setTeacherActive(id: string, isActive: boolean): Promise<void> {
  await client.patch(`/api/institution/teachers/${id}`, { isActive }, { skipErrorToast: true })
}

export async function getPendingInvites(): Promise<PendingInvite[]> {
  return (await client.get<PendingInvite[]>('/api/institution/teachers/invites')).data
}

export async function inviteTeacher(email: string): Promise<PendingInvite> {
  return (await client.post<PendingInvite>('/api/institution/teachers/invite', { email }, { skipErrorToast: true })).data
}

export interface BulkInviteResult {
  invited: number
  skipped: Array<{ email: string; reason: string }>
}
export async function inviteTeachersBulk(emails: string[]): Promise<BulkInviteResult> {
  return (await client.post<BulkInviteResult>('/api/institution/teachers/invite-bulk', { emails }, { skipErrorToast: true })).data
}

export async function revokeInvite(id: string): Promise<void> {
  await client.delete(`/api/institution/teachers/invite/${id}`, { skipErrorToast: true })
}

export interface AuditEntry {
  id:          string
  actor_email: string | null
  action:      string
  target:      string | null
  metadata:    Record<string, unknown> | null
  created_at:  string
}
export async function getAuditLog(): Promise<AuditEntry[]> {
  return (await client.get<AuditEntry[]>('/api/institution/audit', { params: { limit: 200 } })).data
}

export async function getInstitutionCriteria(): Promise<InstitutionCriterion[]> {
  return (await client.get<InstitutionCriterion[]>('/api/institution/criteria')).data
}

export async function createInstitutionCriterion(data: {
  name: string; description?: string; course_id?: string; subject?: CriterionSubject
}): Promise<Criterion> {
  return (await client.post<Criterion>('/api/institution/criteria', data)).data
}

// ─── Model sovereignty (Phase 4) ──────────────────────────────────────────────

export type LLMProviderName = 'deepseek' | 'yandex' | null

export interface InstitutionModelSummary {
  preferred_provider: LLMProviderName
  by_provider_30d:    Array<{ provider: string | null; n: number }>
}

export async function getInstitutionModel(): Promise<InstitutionModelSummary> {
  return (await client.get<InstitutionModelSummary>('/api/institution/model')).data
}

export async function setInstitutionModel(provider: LLMProviderName): Promise<InstitutionModelSummary> {
  return (await client.patch<InstitutionModelSummary>('/api/institution/model', { provider })).data
}

// ─── Shared RAG (institutional flywheel) ──────────────────────────────────────

export interface SharedRagSummary {
  enabled:                  boolean
  shared_courses_n:         number
  participating_teachers_n: number
  cross_uses_30d:           number
  courses: Array<{
    course_id:        string
    course_name:      string
    course_code:      string | null
    teacher_id:       string
    teacher_name:     string | null
    approved_n:       number
    cross_uses_30d:   number
  }>
}

export async function getSharedRag(): Promise<SharedRagSummary> {
  return (await client.get<SharedRagSummary>('/api/institution/shared-rag')).data
}

export async function setSharedRagEnabled(enabled: boolean): Promise<SharedRagSummary> {
  return (await client.patch<SharedRagSummary>('/api/institution/shared-rag', { enabled })).data
}

// ─── Shared rubrics ────────────────────────────────────────────────────────────

import type { Rubric, RubricItem } from '../types'

export async function getInstitutionRubrics(): Promise<Array<Rubric & { author_name: string | null }>> {
  return (await client.get<Array<Rubric & { author_name: string | null }>>('/api/institution/rubrics')).data
}

export async function createInstitutionRubric(data: {
  name: string; description?: string; subject?: CriterionSubject; items: RubricItem[]
}): Promise<Rubric> {
  return (await client.post<Rubric>('/api/institution/rubrics', data)).data
}
