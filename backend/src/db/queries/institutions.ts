import { pool } from '../connection'

export interface InstitutionRow {
  id:           string
  name:         string
  plan_tier:    string
  max_teachers: number | null
  email_domain: string | null
  created_at:   string
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

export async function createInstitution(data: {
  name: string; planTier: string; maxTeachers: number | null; emailDomain?: string | null
}): Promise<InstitutionRow> {
  const { rows } = await pool.query<InstitutionRow>(
    `INSERT INTO institutions (name, plan_tier, max_teachers, email_domain)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.name, data.planTier, data.maxTeachers, data.emailDomain ?? null]
  )
  return rows[0]
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
