import { pool } from '../connection'

// ─── Micro-satisfaction prompts (migration 129) ──────────────────────────────
// See the migration header for why prompts and responses share one table.

export interface SatisfactionPromptRecord {
  id:             string
  teacher_id:     string
  institution_id: string | null
  feature:        string
  artifact_id:    string | null
  score:          number | null
  comment:        string | null
  context:        Record<string, unknown>
  shown_at:       string
  responded_at:   string | null
  dismissed_at:   string | null
}

/** When this teacher was last shown any prompt, and when they were last shown
 *  one for this specific feature. Both cooldowns are read in a single
 *  round-trip because they're checked together on every eligible action —
 *  this sits in the approve path, so it must not cost two queries. */
export async function getPromptCooldowns(
  teacherId: string,
  feature: string,
): Promise<{ lastAnyAt: string | null; lastFeatureAt: string | null }> {
  const { rows } = await pool.query<{ last_any: string | null; last_feature: string | null }>(
    `SELECT MAX(shown_at)                                          AS last_any,
            MAX(shown_at) FILTER (WHERE feature = $2)              AS last_feature
       FROM satisfaction_prompts
      WHERE teacher_id = $1`,
    [teacherId, feature],
  )
  return { lastAnyAt: rows[0]?.last_any ?? null, lastFeatureAt: rows[0]?.last_feature ?? null }
}

export async function createPrompt(params: {
  teacherId:      string
  institutionId:  string | null
  feature:        string
  artifactId?:    string | null
  context?:       Record<string, unknown>
}): Promise<SatisfactionPromptRecord> {
  const { rows } = await pool.query<SatisfactionPromptRecord>(
    `INSERT INTO satisfaction_prompts (teacher_id, institution_id, feature, artifact_id, context)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.teacherId, params.institutionId, params.feature, params.artifactId ?? null, params.context ?? {}],
  )
  return rows[0]
}

/** Records an answer. Scoped by teacher_id as well as id so one teacher can't
 *  answer another's prompt by guessing a UUID — cheap, and this endpoint is
 *  reachable by every authenticated user. */
export async function recordResponse(
  id: string,
  teacherId: string,
  score: number,
  comment?: string | null,
): Promise<SatisfactionPromptRecord | null> {
  const { rows } = await pool.query<SatisfactionPromptRecord>(
    `UPDATE satisfaction_prompts
        SET score = $3, comment = COALESCE($4, comment), responded_at = NOW()
      WHERE id = $1 AND teacher_id = $2
      RETURNING *`,
    [id, teacherId, score, comment ?? null],
  )
  return rows[0] ?? null
}

/** Attaches the «Расскажите подробнее» text to an already-scored prompt. */
export async function attachComment(
  id: string,
  teacherId: string,
  comment: string,
): Promise<SatisfactionPromptRecord | null> {
  const { rows } = await pool.query<SatisfactionPromptRecord>(
    `UPDATE satisfaction_prompts
        SET comment = $3
      WHERE id = $1 AND teacher_id = $2
      RETURNING *`,
    [id, teacherId, comment],
  )
  return rows[0] ?? null
}

export async function recordDismissal(id: string, teacherId: string): Promise<void> {
  await pool.query(
    `UPDATE satisfaction_prompts
        SET dismissed_at = NOW()
      WHERE id = $1 AND teacher_id = $2 AND dismissed_at IS NULL`,
    [id, teacherId],
  )
}

// ─── Admin read (platform admin only) ────────────────────────────────────────

export interface SatisfactionPromptWithTeacher extends SatisfactionPromptRecord {
  teacher_email:    string | null
  teacher_name:     string | null
  institution_name: string | null
}

/** Recent prompts — answered, dismissed and ignored alike. The ignored ones
 *  are the point: the response and dismissal rates are what decide whether
 *  this mechanism keeps existing (TODO Feature AQ, Phase 2 gate), so this
 *  deliberately does NOT filter to `responded_at IS NOT NULL`.
 *
 *  Rollups are derived client-side from this same feed rather than computed
 *  here, following the precedent AdminFeedback.tsx set for help-article
 *  helpfulness — at this volume a second aggregation endpoint would be more
 *  code than the arithmetic it replaces. */
export async function listSatisfactionPrompts(limit = 200): Promise<SatisfactionPromptWithTeacher[]> {
  const { rows } = await pool.query<SatisfactionPromptWithTeacher>(
    `SELECT sp.*, t.email AS teacher_email, t.name AS teacher_name, i.name AS institution_name
       FROM satisfaction_prompts sp
       LEFT JOIN teachers t     ON t.id = sp.teacher_id
       LEFT JOIN institutions i ON i.id = sp.institution_id
      ORDER BY sp.shown_at DESC
      LIMIT $1`,
    [Math.min(limit, 500)],
  )
  return rows
}
