import client from './client'

export interface LtiConfig {
  lti_enabled:                 boolean
  lti_platform_issuer:         string | null
  lti_platform_client_id:      string | null
  lti_platform_deployment_ids: string[]
  lti_platform_auth_login_url: string | null
  lti_platform_auth_token_url: string | null
  lti_platform_jwks_url:       string | null
  complete:                    boolean
  login_url:                   string
  launch_url:                  string
  jwks_url:                    string
}

export type LtiConfigPatch = Partial<Pick<LtiConfig,
  | 'lti_enabled'
  | 'lti_platform_issuer'
  | 'lti_platform_client_id'
  | 'lti_platform_deployment_ids'
  | 'lti_platform_auth_login_url'
  | 'lti_platform_auth_token_url'
  | 'lti_platform_jwks_url'
>>

export async function getLtiConfig(): Promise<LtiConfig> {
  return (await client.get<LtiConfig>('/api/institution/lti')).data
}

export async function updateLtiConfig(patch: LtiConfigPatch): Promise<LtiConfig> {
  return (await client.put<LtiConfig>('/api/institution/lti', patch)).data
}

export interface LtiTestConnectionResult {
  ok:      boolean
  message: string
}

export async function testLtiConnection(): Promise<LtiTestConnectionResult> {
  return (await client.post<LtiTestConnectionResult>('/api/institution/lti/test-connection')).data
}

export async function getLtiRegistrationLink(): Promise<{ url: string }> {
  return (await client.get<{ url: string }>('/api/institution/lti/registration-link')).data
}

// ─── Deep Linking picker (teacher adding GradeAssist as a Moodle activity) ────

export interface LtiDeepLinkSessionInfo {
  contextTitle: string | null
  publishedAssignments: Array<{ id: string; title: string; status: string }>
}

export async function getDeepLinkSession(sessionId: string): Promise<LtiDeepLinkSessionInfo> {
  return (await client.get<LtiDeepLinkSessionInfo>(`/api/lti/deep-link/${sessionId}`)).data
}

export interface LtiDeepLinkSelectResult {
  deepLinkReturnUrl: string
  jwt: string
}

export async function selectDeepLink(
  sessionId: string,
  payload: { publishedAssignmentId?: string; newTitle?: string }
): Promise<LtiDeepLinkSelectResult> {
  return (await client.post<LtiDeepLinkSelectResult>(`/api/lti/deep-link/${sessionId}/select`, payload)).data
}

// ─── Course mapping (Moodle context ↔ org_unit) ────────────────────────────────

export interface LtiCourseLink {
  id:                    string
  context_title:         string | null
  context_label:         string | null
  course_id:             string | null
  course_name:           string | null
  org_unit_id:           string | null
  org_unit_name:         string | null
  // A co-taught Moodle context can have more than one row (one per teacher
  // who's launched it) — these distinguish them.
  teacher_name:          string | null
  teacher_email:         string | null
  last_launch_at:        string
}

export async function listLtiCourseLinks(): Promise<LtiCourseLink[]> {
  return (await client.get<{ links: LtiCourseLink[] }>('/api/institution/lti/course-links')).data.links
}

export async function setLtiCourseLinkOrgUnit(id: string, orgUnitId: string | null): Promise<LtiCourseLink> {
  return (await client.put<LtiCourseLink>(`/api/institution/lti/course-links/${id}`, { org_unit_id: orgUnitId })).data
}

// ─── Launch activity log ────────────────────────────────────────────────────────

export interface LtiLaunch {
  id:            string
  teacher_name:  string | null
  teacher_email: string | null
  message_type:  string | null
  role:          string | null
  context_title: string | null
  success:       boolean
  error_code:    string | null
  created_at:    string
}

export async function listLtiLaunches(): Promise<LtiLaunch[]> {
  return (await client.get<{ launches: LtiLaunch[] }>('/api/institution/lti/launches')).data.launches
}
