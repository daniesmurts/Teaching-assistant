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

export interface ModelUsage {
  provider:     string
  model:        string
  total_tokens: number
  cost_usd:     number
  call_count:   number
  error_count:  number
}

export async function getUsageByModel(days = 30): Promise<ModelUsage[]> {
  const res = await client.get<ModelUsage[]>('/api/admin/usage/by-model', { params: { days } })
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

// ─── Institution contracts (TODO.md Feature AL Phase 0) ───────────────────────
// Manual record of negotiated deals — institution revenue doesn't exist
// anywhere else (payments.ts is teacher-scoped only), and these are
// negotiated offline via 44-ФЗ procurement.

export interface InstitutionContract {
  id:                string
  institution_id:    string
  annual_value_rub:  number
  seats_purchased:   number
  term_start:        string   // 'YYYY-MM-DD'
  term_end:          string   // 'YYYY-MM-DD'
  notes:             string | null
  created_by:        string | null
  created_at:        string
  updated_at:        string
}

export async function getInstitutionContracts(institutionId: string): Promise<InstitutionContract[]> {
  return (await client.get<InstitutionContract[]>(`/api/admin/institutions/${institutionId}/contracts`)).data
}

export async function createInstitutionContract(
  institutionId: string,
  data: { annual_value_rub: number; seats_purchased: number; term_start: string; term_end: string; notes?: string | null }
): Promise<InstitutionContract> {
  return (await client.post<InstitutionContract>(`/api/admin/institutions/${institutionId}/contracts`, data)).data
}

export async function updateInstitutionContract(
  institutionId: string,
  contractId: string,
  data: Partial<{ annual_value_rub: number; seats_purchased: number; term_start: string; term_end: string; notes: string | null }>
): Promise<InstitutionContract> {
  return (await client.patch<InstitutionContract>(`/api/admin/institutions/${institutionId}/contracts/${contractId}`, data)).data
}

export async function deleteInstitutionContract(institutionId: string, contractId: string): Promise<void> {
  await client.delete(`/api/admin/institutions/${institutionId}/contracts/${contractId}`)
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

// ─── Activation funnel ────────────────────────────────────────────────────────

export interface FunnelSummary {
  total_teachers:        number
  created_course:        number
  reached_first_grade:   number
  created_presentation:  number
  graded_within_24h:     number
  graded_within_72h:     number
  graded_within_7d:      number
  median_hours_to_grade: number | null
}

export interface FunnelCohort {
  week:                  string
  signups:               number
  created_course:        number
  reached_first_grade:   number
  median_hours_to_grade: number | null
}

export async function getActivationFunnel(weeks = 12): Promise<{ summary: FunnelSummary; cohorts: FunnelCohort[] }> {
  const res = await client.get<{ summary: FunnelSummary; cohorts: FunnelCohort[] }>('/api/admin/activation/funnel', { params: { weeks } })
  return res.data
}

export interface StalledTeacher {
  id:              string
  email:           string
  name:            string | null
  created_at:      string
  last_seen_at:    string | null
  first_course_at: string | null
  first_grade_at:  string | null
}

export async function getStalledTeachers(limit = 100): Promise<StalledTeacher[]> {
  const res = await client.get<StalledTeacher[]>('/api/admin/activation/stalled', { params: { limit } })
  return res.data
}

// ─── Payments / business metrics ──────────────────────────────────────────────

export interface PaymentsSummary {
  revenue_this_month_kopecks: number
  revenue_30d_kopecks:        number
  confirmed_30d:              number
  rejected_30d:               number
  active_subscribers:         number
  in_grace:                   number
}

export interface MonthlyRevenue {
  month:           string
  revenue_kopecks: number
  confirmed_count: number
  rejected_count:  number
}

export async function getPaymentsSummary(months = 12): Promise<{ summary: PaymentsSummary; byMonth: MonthlyRevenue[] }> {
  const res = await client.get<{ summary: PaymentsSummary; byMonth: MonthlyRevenue[] }>('/api/admin/payments/summary', { params: { months } })
  return res.data
}

export interface AdminPayment {
  id:             string
  order_id:       string
  teacher_id:     string
  teacher_email:  string
  teacher_name:   string | null
  plan:           string
  amount_kopecks: number
  status:         string
  is_renewal:     boolean
  created_at:     string
  confirmed_at:   string | null
}

export async function getAdminPayments(params: { status?: string; limit?: number; offset?: number } = {}): Promise<{ rows: AdminPayment[]; total: number }> {
  const res = await client.get<{ rows: AdminPayment[]; total: number }>('/api/admin/payments', { params })
  return res.data
}

// ─── ФГОС 3++ registry (Feature AA v1) ─────────────────────────────────────────

import type { FgosDraft, FgosStandard, FgosStandardWithChildren } from '../types'

export async function getFgosStandards(
  params: { page?: number; search?: string; level?: string } = {}
): Promise<{ standards: FgosStandard[]; total: number }> {
  const res = await client.get<{ standards: FgosStandard[]; total: number }>('/api/admin/fgos', { params })
  return res.data
}
export async function getFgosStandard(id: string): Promise<FgosStandardWithChildren> {
  const res = await client.get<FgosStandardWithChildren>(`/api/admin/fgos/${id}`)
  return res.data
}
export async function extractFgosDraft(file: File): Promise<FgosDraft> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await client.post<FgosDraft>('/api/admin/fgos/extract', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}
export async function createFgosDraft(payload: FgosDraft): Promise<FgosStandard> {
  const res = await client.post<FgosStandard>('/api/admin/fgos', payload)
  return res.data
}
export async function publishFgosStandard(id: string, payload: FgosDraft): Promise<FgosStandard> {
  const res = await client.post<FgosStandard>(`/api/admin/fgos/${id}/publish`, payload)
  return res.data
}
export async function deleteFgosStandard(id: string): Promise<void> {
  await client.delete(`/api/admin/fgos/${id}`)
}

// ─── Bulk import from fgosvo.ru ────────────────────────────────────────────

export interface FgosvoDiscoverItem {
  code:             string | null
  name:             string | null
  level:            string | null
  pdf_url:          string
  order_date:       string | null
  category:         string
  already_imported: boolean
}
export interface FgosvoDiscoverResult {
  level:              string | null
  items:              FgosvoDiscoverItem[]
  categories_scanned: number
  categories_failed:  { title: string; url: string; error: string }[]
}

export async function discoverFgosvo(url: string): Promise<FgosvoDiscoverResult> {
  const res = await client.post<FgosvoDiscoverResult>('/api/admin/fgos/discover', { url })
  return res.data
}
export async function importFgosvoItem(item: { code: string; name: string; level: string; pdfUrl: string }): Promise<FgosStandard> {
  const res = await client.post<FgosStandard>('/api/admin/fgos/import-one', {
    code: item.code, name: item.name, level: item.level, pdf_url: item.pdfUrl,
  })
  return res.data
}

// ─── Capacity + unit economics (TODO.md Feature AL Phase 2) ───────────────────

export interface TierDistributionRow {
  tier: string
  n:    number
  mean: number
  p50:  number
  p95:  number
  max:  number
}

export interface FreeOutlierRow {
  thresholdUsd: number
  count:        number
  total:        number
}

export interface InstitutionSummaryRow {
  institutionId:  string
  name:           string
  activeSeats:    number
  seatsPurchased: number | null
  utilizationPct: number | null
  costUsd:        number
  revenueUsd:     number | null
  marginUsd:      number | null
  costPerSeatUsd: number
}

export interface ResourceHeadroom {
  key:             string
  label:           string
  unit:            string
  current:         number
  ceiling:         number | null
  ceilingLabel:    string
  projectedAtScenario: number | null
  breaksAtTeachers:    number | null
  breaksAtTeachersPeakAdjusted?: number | null
  note?:           string
}

export interface HeadroomResult {
  activeTeachers:   number
  scenarioTeachers: number
  resources:        ResourceHeadroom[]
}

export interface RateLimitKnee {
  observed:                       boolean
  minHourlyVolumeWithRateLimit:    number | null
  maxHourlyVolumeWithoutRateLimit: number | null
}

export interface AccountCeiling {
  account:           string
  burnRatePerDayUsd: number
  balanceFailures:   number
  failureCount:      number
  lastSuccessAt:     string | null
  lastFailureAt:     string | null
  possiblyUnhealthy: boolean
}

export interface ProviderCeilingsReport {
  windowDays:    number
  peakToMean:    { ratio: number | null; totalCalls: number; peakHourlyCalls: number }
  rateLimitKnee: RateLimitKnee
  accounts:      AccountCeiling[]
  yandexEmbedSpofNote: string
}

export interface CapacityOverview {
  month:              string
  availableMonths:    string[]
  trackingSinceMonth: string | null
  isTrendReady:       boolean
  activeTeachers:     number
  tierDistribution:   TierDistributionRow[]
  freeOutliers:       FreeOutlierRow[]
  institutions:       InstitutionSummaryRow[]
  fixedCostUsd:       number | null
  variableCostPerTeacherUsd: number | null
  headroom:           HeadroomResult
  providerCeilings:   ProviderCeilingsReport
}

export interface CapacityNoData {
  noData:  true
  message: string
}

export async function getCapacityOverview(
  params: { month?: string; scenarioTeachers?: number } = {}
): Promise<CapacityOverview | CapacityNoData> {
  const res = await client.get<CapacityOverview | CapacityNoData>('/api/admin/capacity/overview', { params })
  return res.data
}

// ─── Pricing calculator (platform-admin negotiation tool) ───────────────────

export interface PricingCostInputs {
  days:                   number
  activeTeachers:         number
  tokenCostUsd:           number
  ocrCostUsd:             number
  tokenCostPerTeacherUsd: number
  ocrCostPerTeacherUsd:   number
  tokenCostPerTeacherRub: number
  ocrCostPerTeacherRub:   number
  fxRate:                 number
  fxRateDate:             string
}

export async function getPricingCostInputs(
  params: { days?: number; institutionId?: string } = {}
): Promise<PricingCostInputs> {
  const res = await client.get<PricingCostInputs>('/api/admin/pricing/cost-inputs', { params })
  return res.data
}

export interface PricingInstitution {
  institution_id:  string
  name:            string
  plan_tier:       string
  max_teachers:    number | null
  teacher_count:   number
  active_teachers: number
  seat_cap:        number
  activation_rate: number
}

export async function getPricingInstitutions(days = 30): Promise<PricingInstitution[]> {
  const res = await client.get<PricingInstitution[]>('/api/admin/pricing/institutions', { params: { days } })
  return res.data
}

export interface PricingAssumptions {
  institutionId:      string | null
  activationOverride: number | null
  marginMultiplier:   number
  maxDiscountPct:     number
  costPerActiveTeacherManualOverrideRub: number | null
  updatedBy:          string | null
  updatedAt:          string | null
}

export async function getPricingAssumptions(institutionId?: string): Promise<PricingAssumptions> {
  const res = await client.get<PricingAssumptions>('/api/admin/pricing/assumptions', { params: { institutionId } })
  return res.data
}

export async function updatePricingAssumptions(
  institutionId: string | undefined,
  patch: {
    activation_override?: number | null
    margin_multiplier?: number
    max_discount_pct?: number
    cost_per_active_teacher_manual_override_rub?: number | null
  }
): Promise<PricingAssumptions> {
  const res = await client.put<PricingAssumptions>('/api/admin/pricing/assumptions', patch, { params: { institutionId } })
  return res.data
}

// ─── Fleet — control-plane deployment registry (docs/on-prem-deployment.md §16 Track 1.7) ──

export interface DeploymentSummary {
  id:                     string
  name:                   string
  mode:                   string
  expected_connectivity:  string
  current_version:        string | null
  first_seen_at:          string | null
  last_heartbeat_at:      string | null
  active_seats:           number | null
  db_ok:                  boolean | null
  queue_depth:            number | null
  uptime_seconds:         number | null
  errors_24h:             number
}

export async function getAdminDeployments(): Promise<DeploymentSummary[]> {
  const res = await client.get<DeploymentSummary[]>('/api/admin/deployments')
  return res.data
}
