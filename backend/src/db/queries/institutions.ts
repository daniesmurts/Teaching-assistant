import { pool } from '../connection'

export interface InstitutionRow {
  id:           string
  name:         string
  plan_tier:    string
  max_teachers: number | null
  email_domain: string | null
  // Migration 085 — allowlist for "upload document by URL". Bare hostnames;
  // a subdomain of a listed host is allowed too. Defaults to '{}'.
  document_fetch_domains: string[]
  created_at:   string
}

/** Read just the URL-fetch allowlist for an institution. */
export async function getInstitutionDocumentFetchDomains(institutionId: string): Promise<string[]> {
  const { rows } = await pool.query<{ document_fetch_domains: string[] }>(
    `SELECT document_fetch_domains FROM institutions WHERE id = $1`,
    [institutionId]
  )
  return rows[0]?.document_fetch_domains ?? []
}

/** Replace the URL-fetch allowlist (already normalised/validated by the caller). */
export async function setInstitutionDocumentFetchDomains(
  institutionId: string,
  domains: string[],
): Promise<void> {
  await pool.query(
    `UPDATE institutions SET document_fetch_domains = $2 WHERE id = $1`,
    [institutionId, domains]
  )
}

// SAML config — separate from InstitutionRow so callers can hold it
// independently and so the public list/overview endpoints never accidentally
// serialise the IdP cert.
export interface SamlConfigRow {
  saml_enabled:         boolean
  saml_idp_entity_id:   string | null
  saml_idp_sso_url:     string | null
  saml_idp_x509_cert:   string | null
  saml_attribute_email: string
  saml_attribute_name:  string
  saml_force_sso:       boolean
}

// A SAML config is "complete" only when all three IdP fields are populated.
// Used by /api/sso/discover before redirecting.
export function isSamlConfigComplete(c: SamlConfigRow): boolean {
  return Boolean(
    c.saml_enabled &&
    c.saml_idp_entity_id &&
    c.saml_idp_sso_url &&
    c.saml_idp_x509_cert
  )
}

export async function getInstitutionById(id: string): Promise<InstitutionRow | null> {
  const { rows } = await pool.query<InstitutionRow>(`SELECT * FROM institutions WHERE id = $1`, [id])
  return rows[0] ?? null
}

// Auto-join lookup: find an institution that owns this email domain.
export async function findInstitutionByEmailDomain(domain: string): Promise<InstitutionRow | null> {
  const { rows } = await pool.query<InstitutionRow>(
    `SELECT * FROM institutions WHERE lower(email_domain) = lower($1) LIMIT 1`,
    [domain]
  )
  return rows[0] ?? null
}

// ─── SAML config ──────────────────────────────────────────────────────────────

export async function getSamlConfig(institutionId: string): Promise<SamlConfigRow | null> {
  const { rows } = await pool.query<SamlConfigRow>(
    `SELECT saml_enabled, saml_idp_entity_id, saml_idp_sso_url, saml_idp_x509_cert,
            saml_attribute_email, saml_attribute_name, saml_force_sso
       FROM institutions WHERE id = $1`,
    [institutionId]
  )
  return rows[0] ?? null
}

export async function setSamlConfig(
  institutionId: string,
  patch: Partial<SamlConfigRow>
): Promise<SamlConfigRow | null> {
  const { rows } = await pool.query<SamlConfigRow>(
    `UPDATE institutions SET
       saml_enabled          = COALESCE($2, saml_enabled),
       saml_idp_entity_id    = CASE WHEN $3  THEN $4  ELSE saml_idp_entity_id   END,
       saml_idp_sso_url      = CASE WHEN $5  THEN $6  ELSE saml_idp_sso_url     END,
       saml_idp_x509_cert    = CASE WHEN $7  THEN $8  ELSE saml_idp_x509_cert   END,
       saml_attribute_email  = COALESCE($9,  saml_attribute_email),
       saml_attribute_name   = COALESCE($10, saml_attribute_name),
       saml_force_sso        = COALESCE($11, saml_force_sso)
     WHERE id = $1
     RETURNING saml_enabled, saml_idp_entity_id, saml_idp_sso_url, saml_idp_x509_cert,
               saml_attribute_email, saml_attribute_name, saml_force_sso`,
    [
      institutionId,
      patch.saml_enabled         ?? null,
      patch.saml_idp_entity_id   !== undefined, patch.saml_idp_entity_id   ?? null,
      patch.saml_idp_sso_url     !== undefined, patch.saml_idp_sso_url     ?? null,
      patch.saml_idp_x509_cert   !== undefined, patch.saml_idp_x509_cert   ?? null,
      patch.saml_attribute_email ?? null,
      patch.saml_attribute_name  ?? null,
      patch.saml_force_sso       ?? null,
    ]
  )
  return rows[0] ?? null
}

// Discovery: "what login method does this email use?" — case-insensitive on
// the domain, returns the institution + its SAML config in one round trip.
// Used by POST /api/sso/discover from the login page.
export interface SamlDiscoveryRow extends SamlConfigRow {
  institution_id:   string
  institution_name: string
}

export async function findSamlConfigForEmailDomain(
  domain: string
): Promise<SamlDiscoveryRow | null> {
  const { rows } = await pool.query<SamlDiscoveryRow>(
    `SELECT id AS institution_id, name AS institution_name,
            saml_enabled, saml_idp_entity_id, saml_idp_sso_url, saml_idp_x509_cert,
            saml_attribute_email, saml_attribute_name, saml_force_sso
       FROM institutions
      WHERE lower(email_domain) = lower($1)
      LIMIT 1`,
    [domain]
  )
  return rows[0] ?? null
}

// ─── LTI 1.3 platform config (migration 066) ──────────────────────────────────
// Mirrors the SAML config shape above — one registered platform per
// institution, edited by the institution admin (Settings → Organisation →
// LTI), not platform-admin.

export interface LtiConfigRow {
  lti_enabled:                boolean
  lti_platform_issuer:        string | null
  lti_platform_client_id:     string | null
  lti_platform_deployment_ids: string[]
  lti_platform_auth_login_url: string | null
  lti_platform_auth_token_url: string | null
  lti_platform_jwks_url:      string | null
}

// A config is "complete" when everything a launch needs is present. Service
// calls (AGS/NRPS) additionally need auth_token_url, checked separately by
// callers that need it (not required just to accept launches).
export function isLtiConfigComplete(c: LtiConfigRow): boolean {
  return Boolean(
    c.lti_enabled &&
    c.lti_platform_issuer &&
    c.lti_platform_client_id &&
    c.lti_platform_deployment_ids.length > 0 &&
    c.lti_platform_auth_login_url &&
    c.lti_platform_jwks_url
  )
}

const LTI_CONFIG_COLUMNS = `
  lti_enabled, lti_platform_issuer, lti_platform_client_id,
  lti_platform_deployment_ids, lti_platform_auth_login_url,
  lti_platform_auth_token_url, lti_platform_jwks_url
`

export async function getLtiConfig(institutionId: string): Promise<LtiConfigRow | null> {
  const { rows } = await pool.query<LtiConfigRow>(
    `SELECT ${LTI_CONFIG_COLUMNS} FROM institutions WHERE id = $1`,
    [institutionId]
  )
  return rows[0] ?? null
}

export async function setLtiConfig(
  institutionId: string,
  patch: Partial<LtiConfigRow>
): Promise<LtiConfigRow | null> {
  const { rows } = await pool.query<LtiConfigRow>(
    `UPDATE institutions SET
       lti_enabled                 = COALESCE($2, lti_enabled),
       lti_platform_issuer         = CASE WHEN $3  THEN $4  ELSE lti_platform_issuer         END,
       lti_platform_client_id      = CASE WHEN $5  THEN $6  ELSE lti_platform_client_id      END,
       lti_platform_deployment_ids = CASE WHEN $7  THEN $8::jsonb ELSE lti_platform_deployment_ids END,
       lti_platform_auth_login_url = CASE WHEN $9  THEN $10 ELSE lti_platform_auth_login_url END,
       lti_platform_auth_token_url = CASE WHEN $11 THEN $12 ELSE lti_platform_auth_token_url END,
       lti_platform_jwks_url       = CASE WHEN $13 THEN $14 ELSE lti_platform_jwks_url       END
     WHERE id = $1
     RETURNING ${LTI_CONFIG_COLUMNS}`,
    [
      institutionId,
      patch.lti_enabled ?? null,
      patch.lti_platform_issuer !== undefined, patch.lti_platform_issuer ?? null,
      patch.lti_platform_client_id !== undefined, patch.lti_platform_client_id ?? null,
      patch.lti_platform_deployment_ids !== undefined, JSON.stringify(patch.lti_platform_deployment_ids ?? []),
      patch.lti_platform_auth_login_url !== undefined, patch.lti_platform_auth_login_url ?? null,
      patch.lti_platform_auth_token_url !== undefined, patch.lti_platform_auth_token_url ?? null,
      patch.lti_platform_jwks_url !== undefined, patch.lti_platform_jwks_url ?? null,
    ]
  )
  return rows[0] ?? null
}

// Discovery: the OIDC login-init request carries the platform's `iss` — find
// which institution registered it. Mirrors findSamlConfigForEmailDomain.
export interface LtiDiscoveryRow extends LtiConfigRow {
  institution_id: string
}

export async function findLtiConfigForIssuer(issuer: string): Promise<LtiDiscoveryRow | null> {
  const { rows } = await pool.query<LtiDiscoveryRow>(
    `SELECT id AS institution_id, ${LTI_CONFIG_COLUMNS}
       FROM institutions
      WHERE lti_platform_issuer = $1
      LIMIT 1`,
    [issuer]
  )
  return rows[0] ?? null
}

// ─── Platform-admin management ────────────────────────────────────────────────

export interface InstitutionWithCount extends InstitutionRow {
  teacher_count: number
}

export async function listInstitutionsWithCounts(): Promise<InstitutionWithCount[]> {
  const { rows } = await pool.query<InstitutionWithCount>(
    `SELECT i.*, (SELECT COUNT(*)::int FROM teachers t WHERE t.institution_id = i.id) AS teacher_count
       FROM institutions i
       ORDER BY i.created_at DESC`
  )
  return rows
}

// Creates the institution AND seeds the org-tree root + a default department in
// a single transaction. Without the tree seed, /api/institution/structure
// returns an empty array and the structure page shows "Корневое подразделение
// не найдено" — see migration 045 §7 for the same backfill applied to
// institutions that existed when the tree shipped.
export async function createInstitution(data: {
  name: string; planTier: string; maxTeachers: number | null; emailDomain?: string | null
}): Promise<InstitutionRow> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query<InstitutionRow>(
      `INSERT INTO institutions (name, plan_tier, max_teachers, email_domain)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.name, data.planTier, data.maxTeachers, data.emailDomain ?? null]
    )
    const inst = rows[0]

    const { rows: rootRows } = await client.query<{ id: string }>(
      `INSERT INTO org_units (institution_id, parent_id, type_code, name, path)
       VALUES ($1, NULL, 'institution', $2, '')
       RETURNING id`,
      [inst.id, inst.name]
    )
    const rootId = rootRows[0].id
    await client.query(
      `UPDATE org_units SET path = '/' || id::text || '/' WHERE id = $1`,
      [rootId]
    )

    const { rows: deptRows } = await client.query<{ id: string }>(
      `INSERT INTO org_units (institution_id, parent_id, type_code, name, path)
       VALUES ($1, $2, 'department', 'Кафедра (по умолчанию)', '')
       RETURNING id`,
      [inst.id, rootId]
    )
    await client.query(
      `UPDATE org_units d
          SET path = r.path || d.id::text || '/'
         FROM org_units r
        WHERE d.id = $1 AND r.id = d.parent_id`,
      [deptRows[0].id]
    )

    await client.query('COMMIT')
    return inst
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function updateInstitution(
  id: string,
  patch: { name?: string; planTier?: string; maxTeachers?: number | null; emailDomain?: string | null }
): Promise<InstitutionRow | null> {
  const { rows } = await pool.query<InstitutionRow>(
    `UPDATE institutions
       SET name         = COALESCE($2, name),
           plan_tier    = COALESCE($3, plan_tier),
           max_teachers = CASE WHEN $4 THEN $5 ELSE max_teachers END,
           email_domain = CASE WHEN $6 THEN $7 ELSE email_domain END
     WHERE id = $1
     RETURNING *`,
    [id, patch.name ?? null, patch.planTier ?? null,
     patch.maxTeachers !== undefined, patch.maxTeachers ?? null,
     patch.emailDomain !== undefined, patch.emailDomain ?? null]
  )
  return rows[0] ?? null
}

// ─── Teachers within an institution (scoped) ──────────────────────────────────

export interface InstitutionTeacherRow {
  id:          string
  email:       string
  name:        string | null
  role:        string
  plan_tier:   string
  is_active:   boolean
  created_at:  string
  grades:      number
}

export async function listInstitutionTeachers(institutionId: string): Promise<InstitutionTeacherRow[]> {
  const { rows } = await pool.query<InstitutionTeacherRow>(
    `SELECT t.id, t.email, t.name, t.role, t.plan_tier, t.is_active, t.created_at,
            (SELECT COUNT(*) FROM assignments a WHERE a.teacher_id = t.id)::int AS grades
       FROM teachers t
      WHERE t.institution_id = $1
      ORDER BY t.created_at`,
    [institutionId]
  )
  return rows
}

export async function countInstitutionTeachers(institutionId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM teachers WHERE institution_id = $1`,
    [institutionId]
  )
  return parseInt(rows[0].count, 10)
}

// institution_admin may only toggle active state — never role or plan
export async function setInstitutionTeacherActive(
  teacherId: string,
  institutionId: string,
  isActive: boolean
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE teachers SET is_active = $3 WHERE id = $1 AND institution_id = $2`,
    [teacherId, institutionId, isActive]
  )
  return (rowCount ?? 0) > 0
}

// ─── Aggregate stats (scoped, NEVER exposes cost) ─────────────────────────────

export interface InstitutionOverview {
  totalTeachers:      number
  activeThisMonth:    number
  totalGrades:        number
  totalPresentations: number
}

export async function getInstitutionOverview(institutionId: string): Promise<InstitutionOverview> {
  const { rows } = await pool.query<{
    total_teachers: string; active_this_month: string
    total_grades: string; total_presentations: string
  }>(
    `SELECT
       (SELECT COUNT(*) FROM teachers t WHERE t.institution_id = $1)                          AS total_teachers,
       (SELECT COUNT(DISTINCT a.teacher_id) FROM assignments a
          JOIN teachers t ON t.id = a.teacher_id
          WHERE t.institution_id = $1 AND a.created_at >= date_trunc('month', NOW()))         AS active_this_month,
       (SELECT COUNT(*) FROM assignments a
          JOIN teachers t ON t.id = a.teacher_id WHERE t.institution_id = $1)                 AS total_grades,
       (SELECT COUNT(*) FROM presentations p
          JOIN teachers t ON t.id = p.teacher_id WHERE t.institution_id = $1)                 AS total_presentations`,
    [institutionId]
  )
  const r = rows[0]
  return {
    totalTeachers:      parseInt(r.total_teachers,      10),
    activeThisMonth:    parseInt(r.active_this_month,    10),
    totalGrades:        parseInt(r.total_grades,         10),
    totalPresentations: parseInt(r.total_presentations, 10),
  }
}

export interface InstitutionDailyUsageRow {
  date:               string
  total_tokens:       number
  grade_count:        number
  presentation_count: number
}

// Tokens + counts only — cost_usd is deliberately omitted (platform-admin only).
// Scoped via teacher membership so it works regardless of api_usage_log.institution_id.
export async function getInstitutionDailyUsage(
  institutionId: string,
  days = 30
): Promise<InstitutionDailyUsageRow[]> {
  const { rows } = await pool.query<InstitutionDailyUsageRow>(
    `SELECT
       DATE(l.created_at)                                            AS date,
       SUM(l.input_tokens + l.output_tokens)::int                    AS total_tokens,
       COUNT(*) FILTER (WHERE l.feature = 'grading')::int            AS grade_count,
       COUNT(*) FILTER (WHERE l.feature = 'presentation')::int       AS presentation_count
     FROM api_usage_log l
     JOIN teachers t ON t.id = l.teacher_id
     WHERE t.institution_id = $1
       AND l.created_at >= NOW() - ($2 || ' days')::INTERVAL
     GROUP BY DATE(l.created_at)
     ORDER BY date DESC`,
    [institutionId, days]
  )
  return rows
}
