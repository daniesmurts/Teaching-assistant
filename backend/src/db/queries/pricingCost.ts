import { pool } from '../connection'

// Backs the AdminPricing negotiation tool (platform-admin only). Reuses
// api_usage_log exactly as the Usage tab's queries do (usageLog.ts) — no new
// cost source, just a trailing-window + institution-scoped aggregation the
// existing queries don't do (getUsageByTeacher has no date range or
// institution filter).
//
// "Active teacher" here means: at least one api_usage_log row in the window
// — the same definition services/usageRollup.ts uses for activeTeachers
// (appeared in that month's rollup), not the last_seen_at/login signal
// /admin/overview uses for "active this week". Confirmed with the operator:
// activation rate should reflect who actually cost money, not who merely
// logged in.
//
// OCR (Yandex Vision) cost isn't a separate `feature` — it rides whatever
// feature triggered it and is only distinguishable by
// model = 'yandex:vision-ocr' (yandexVision.ts), the same string
// getUsageByModel already splits on. Token cost here is therefore
// "everything that isn't that model string", not a separate feature filter.

export interface CostPerActiveTeacherRow {
  days:                 number
  activeTeachers:       number
  tokenCostUsd:         number
  ocrCostUsd:           number
  tokenCostPerTeacherUsd: number
  ocrCostPerTeacherUsd:   number
}

export async function getCostPerActiveTeacher(
  days: number, institutionId: string | null
): Promise<CostPerActiveTeacherRow> {
  const { rows } = await pool.query<{
    active_teachers: string
    token_cost_usd:  string | null
    ocr_cost_usd:    string | null
  }>(
    `SELECT
       COUNT(DISTINCT teacher_id)::int                                          AS active_teachers,
       ROUND(SUM(cost_usd) FILTER (WHERE model <> 'yandex:vision-ocr')::numeric, 6) AS token_cost_usd,
       ROUND(SUM(cost_usd) FILTER (WHERE model =  'yandex:vision-ocr')::numeric, 6) AS ocr_cost_usd
     FROM api_usage_log
     WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
       AND ($2::uuid IS NULL OR institution_id = $2)`,
    [days, institutionId]
  )

  const r = rows[0]
  const activeTeachers = parseInt(r?.active_teachers ?? '0', 10)
  const tokenCostUsd = parseFloat(r?.token_cost_usd ?? '0')
  const ocrCostUsd = parseFloat(r?.ocr_cost_usd ?? '0')

  return {
    days,
    activeTeachers,
    tokenCostUsd,
    ocrCostUsd,
    tokenCostPerTeacherUsd: activeTeachers > 0 ? tokenCostUsd / activeTeachers : 0,
    ocrCostPerTeacherUsd:   activeTeachers > 0 ? ocrCostUsd / activeTeachers : 0,
  }
}

export interface InstitutionActivationRow {
  institution_id:   string
  name:             string
  plan_tier:        string
  max_teachers:     number | null
  teacher_count:    number
  active_teachers:  number
  seat_cap:         number   // max_teachers, falling back to teacher_count when unlimited
  activation_rate:  number   // 0–1
}

export async function listInstitutionsWithActivation(days: number): Promise<InstitutionActivationRow[]> {
  const { rows } = await pool.query<{
    institution_id: string
    name: string
    plan_tier: string
    max_teachers: number | null
    teacher_count: string
    active_teachers: string
  }>(
    `SELECT
       i.id                                                  AS institution_id,
       i.name,
       i.plan_tier,
       i.max_teachers,
       (SELECT COUNT(*)::int FROM teachers t WHERE t.institution_id = i.id) AS teacher_count,
       (SELECT COUNT(DISTINCT u.teacher_id)::int
          FROM api_usage_log u
         WHERE u.institution_id = i.id
           AND u.created_at >= NOW() - ($1 || ' days')::INTERVAL)          AS active_teachers
     FROM institutions i
     ORDER BY i.name`,
    [days]
  )

  return rows.map((r) => {
    const teacherCount = parseInt(r.teacher_count, 10)
    const activeTeachers = parseInt(r.active_teachers, 10)
    const seatCap = r.max_teachers ?? teacherCount
    return {
      institution_id: r.institution_id,
      name:           r.name,
      plan_tier:      r.plan_tier,
      max_teachers:   r.max_teachers,
      teacher_count:  teacherCount,
      active_teachers: activeTeachers,
      seat_cap:       seatCap,
      activation_rate: seatCap > 0 ? activeTeachers / seatCap : 0,
    }
  })
}
