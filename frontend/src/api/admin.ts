import client from './client'

export interface AdminOverview {
  totalTeachers:      number
  activeThisWeek:     number
  newThisMonth:       number
  totalGrades:        number
  totalPresentations: number
  gradesToday:        number
  todayCostUsd:       number
}

export interface DailyUsage {
  date:              string
  total_tokens:      number
  input_tokens:      number
  output_tokens:     number
  cost_usd:          number
  grade_count:       number
  presentation_count: number
  error_count:       number
}

export interface TeacherUsage {
  teacher_id:   string
  teacher_name: string | null
  email:        string
  total_tokens: number
  cost_usd:     number
  grade_count:  number
  last_active:  string | null
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const res = await client.get<AdminOverview>('/api/admin/overview')
  return res.data
}

export async function getDailyUsage(days = 30): Promise<DailyUsage[]> {
  const res = await client.get<DailyUsage[]>('/api/admin/usage/daily', { params: { days } })
  return res.data
}

export async function getUsageByTeacher(): Promise<TeacherUsage[]> {
  const res = await client.get<TeacherUsage[]>('/api/admin/usage/by-teacher')
  return res.data
}

export interface FeatureUsage {
  feature:             string
  total_tokens:        number
  cost_usd:            number
  call_count:          number
  avg_tokens_per_call: number
}

export async function getUsageByFeature(days = 30): Promise<FeatureUsage[]> {
  const res = await client.get<FeatureUsage[]>('/api/admin/usage/by-feature', { params: { days } })
  return res.data
}

export interface AdminTeacher {
  id:               string
  email:            string
  name:             string | null
  university:       string | null
  role:             string
  plan_tier:        string
  is_active:        boolean
  institution_id:   string | null
  institution_name: string | null
  grade_count:      number
  created_at:       string
  monthly_spend_cap_usd: number | null   // null = plan-tier default
  month_spend_usd:       number
}

export async function getAdminTeachers(params: { page?: number; search?: string } = {}): Promise<{ teachers: AdminTeacher[]; total: number }> {
  const res = await client.get<{ teachers: AdminTeacher[]; total: number }>('/api/admin/teachers', { params })
  return res.data
}

export async function patchTeacher(
  id: string,
  data: {
    role?: string; plan_tier?: string; is_active?: boolean; institution_id?: string | null
    monthly_spend_cap_usd?: number | null
  }
): Promise<AdminTeacher> {
  const res = await client.patch<AdminTeacher>(`/api/admin/teachers/${id}`, data)
  return res.data
}

// ─── Institutions ─────────────────────────────────────────────────────────────

export interface AdminInstitution {
  id:            string
  name:          string
  plan_tier:     string
  max_teachers:  number | null
  email_domain:  string | null
  teacher_count: number
  created_at:    string
}

export interface AdminFeedback {
  id:            string
  category:      string
  message:       string
  page:          string | null
  created_at:    string
  teacher_email: string | null
  teacher_name:  string | null
}

export async function getFeedback(limit = 100): Promise<AdminFeedback[]> {
  return (await client.get<AdminFeedback[]>('/api/admin/feedback', { params: { limit } })).data
}

export interface AdminContactMessage {
  id:           string
  name:         string
  email:        string
  organization: string | null
  topic:        string
  message:      string
  source_page:  string
  status:       string
  created_at:   string
}

export async function getContactMessages(limit = 200): Promise<AdminContactMessage[]> {
  return (await client.get<AdminContactMessage[]>('/api/admin/contact-messages', { params: { limit } })).data
}

export async function markContactMessageRead(id: string): Promise<AdminContactMessage> {
  return (await client.patch<AdminContactMessage>(`/api/admin/contact-messages/${id}/read`)).data
}

export async function getInstitutions(): Promise<AdminInstitution[]> {
  return (await client.get<AdminInstitution[]>('/api/admin/institutions')).data
}

export async function createInstitution(data: {
  name: string; planTier: string; maxTeachers: number | null; emailDomain?: string | null
}): Promise<AdminInstitution> {
  return (await client.post<AdminInstitution>('/api/admin/institutions', data)).data
}

export async function updateInstitution(
  id: string,
  data: { name?: string; planTier?: string; maxTeachers?: number | null; emailDomain?: string | null }
): Promise<AdminInstitution> {
  return (await client.patch<AdminInstitution>(`/api/admin/institutions/${id}`, data)).data
}

// ─── SAML / SSO config ────────────────────────────────────────────────────────

export interface SamlConfig {
  saml_enabled:         boolean
  saml_idp_entity_id:   string | null
  saml_idp_sso_url:     string | null
  saml_idp_x509_cert:   string | null
  saml_attribute_email: string
  saml_attribute_name:  string
  saml_force_sso:       boolean
  // Read-only — the SP values the IdP admin needs on their side
  spEntityId:  string | null
  metadataUrl: string
  acsUrl:      string
}

export async function getSamlConfig(institutionId: string): Promise<SamlConfig> {
  return (await client.get<SamlConfig>(`/api/admin/institutions/${institutionId}/saml`)).data
}

export async function updateSamlConfig(
  institutionId: string,
  patch: Partial<Omit<SamlConfig, 'spEntityId' | 'metadataUrl' | 'acsUrl'>>
): Promise<SamlConfig> {
  return (await client.put<SamlConfig>(`/api/admin/institutions/${institutionId}/saml`, patch)).data
}

export interface AdminError {
  feature:    string
  error_code: string | null
  count:      number
  last_seen:  string
}

export async function getAdminErrors(days = 7): Promise<AdminError[]> {
  const res = await client.get<AdminError[]>('/api/admin/errors', { params: { days } })
  return res.data
}

export interface CriterionTemplate {
  id:          string
  name:        string
  description: string | null
  subject:     string | null
  created_at:  string
}

export async function getCriterionTemplates(): Promise<CriterionTemplate[]> {
  const res = await client.get<CriterionTemplate[]>('/api/admin/criteria/templates')
  return res.data
}

export async function createCriterionTemplate(data: {
  name: string; description?: string; subject: string
}): Promise<CriterionTemplate> {
  const res = await client.post<CriterionTemplate>('/api/admin/criteria/templates', data)
  return res.data
}

export async function deleteCriterionTemplate(id: string): Promise<void> {
  await client.delete(`/api/admin/criteria/templates/${id}`)
}

// ─── Edit-distance / AI quality ───────────────────────────────────────────────

export interface EditDistanceSummary {
  n_total:                     number
  n_30d:                       number
  n_90d:                       number
  mean_score_delta_30d:        number | null    // 0–100, lower = AI agrees with teachers
  mean_score_delta_90d:        number | null
  pct_feedback_changed_30d:    number | null    // 0–100
  mean_strengths_kept_30d:     number | null    // 0–100
  mean_improvements_kept_30d:  number | null    // 0–100
}

export async function getEditDistanceSummary(): Promise<EditDistanceSummary> {
  const res = await client.get<EditDistanceSummary>('/api/admin/edit-distance')
  return res.data
}

// ─── Global rubric templates ──────────────────────────────────────────────────

import type { Rubric, RubricItem } from '../types'

export interface RubricTemplatePayload {
  name:         string
  description?: string | null
  subject?:     string
  items:        RubricItem[]
}

export async function getRubricTemplates(): Promise<Rubric[]> {
  const res = await client.get<Rubric[]>('/api/admin/rubrics/templates')
  return res.data
}
export async function createRubricTemplate(data: RubricTemplatePayload): Promise<Rubric> {
  const res = await client.post<Rubric>('/api/admin/rubrics/templates', data)
  return res.data
}
export async function updateRubricTemplate(id: string, data: Partial<RubricTemplatePayload>): Promise<Rubric> {
  const res = await client.put<Rubric>(`/api/admin/rubrics/templates/${id}`, data)
  return res.data
}
export async function deleteRubricTemplate(id: string): Promise<void> {
  await client.delete(`/api/admin/rubrics/templates/${id}`)
}

// ─── Subscription management ──────────────────────────────────────────────────

export interface AdminPayment {
  order_id:       string
  plan:           string
  amount_kopecks: number
  status:         string
  payment_id:     string | null
  created_at:     string
  confirmed_at:   string | null
}

export async function getTeacherPayments(teacherId: string): Promise<AdminPayment[]> {
  const res = await client.get<AdminPayment[]>(`/api/admin/teachers/${teacherId}/payments`)
  return res.data
}

export async function grantSubscription(teacherId: string, days: number): Promise<void> {
  await client.post(`/api/admin/teachers/${teacherId}/subscription/grant`, { days })
}

export async function cancelSubscription(teacherId: string): Promise<void> {
  await client.post(`/api/admin/teachers/${teacherId}/subscription/cancel`, {})
}

export async function refundPayment(orderId: string): Promise<{ status: string }> {
  const res = await client.post<{ status: string }>(`/api/admin/payments/${orderId}/refund`, {})
  return res.data
}

// ─── Activity log (cross-institution) ────────────────────────────────────────

export interface AuditEntry {
  id:               string
  institution_id:   string | null
  actor_teacher_id: string | null
  actor_email:      string | null
  action:           string
  target:           string | null
  metadata:         Record<string, unknown> | null
  ip_address:       string | null
  user_agent:       string | null
  created_at:       string
}

export interface AuditFilters {
  institutionId?: string
  actorTeacherId?: string
  action?:         string
  from?:           string
  to?:             string
  limit?:          number
  offset?:         number
}

export async function getAudit(
  filters: AuditFilters = {}
): Promise<{ rows: AuditEntry[]; total: number }> {
  const res = await client.get<{ rows: AuditEntry[]; total: number }>('/api/admin/audit', {
    params: filters,
  })
  return res.data
}
