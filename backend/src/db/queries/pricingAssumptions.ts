import { pool } from '../connection'

// Migration 111 — persisted assumptions for the AdminPricing negotiation
// tool. institutionId === null reads/writes the single global-defaults row
// (see migration comment: a partial unique index enforces at most one NULL
// row). Update-else-insert via `IS NOT DISTINCT FROM` rather than
// ON CONFLICT, because ON CONFLICT's conflict-target inference needs a
// single index to match against and this table intentionally has two
// (one for real institution ids, one constant-expression index for the
// NULL row) — simpler to just read-then-write for a table an operator edits
// by hand, not a high-concurrency path.

export const PRICING_DEFAULTS = {
  activationOverride: null as number | null,
  marginMultiplier: 3.5,
  maxDiscountPct: 55,
  costPerActiveTeacherManualOverrideRub: null as number | null,
}

export interface PricingAssumptionsRow {
  institutionId:       string | null
  activationOverride:  number | null
  marginMultiplier:    number
  maxDiscountPct:      number
  costPerActiveTeacherManualOverrideRub: number | null
  updatedBy:           string | null
  updatedAt:           string | null
}

interface DbRow {
  institution_id: string | null
  activation_override: string | null
  margin_multiplier: string
  max_discount_pct: string
  cost_per_active_teacher_manual_override_rub: string | null
  updated_by: string | null
  updated_at: string
}

function fromDb(institutionId: string | null, r: DbRow | undefined): PricingAssumptionsRow {
  if (!r) {
    return {
      institutionId,
      activationOverride: PRICING_DEFAULTS.activationOverride,
      marginMultiplier:   PRICING_DEFAULTS.marginMultiplier,
      maxDiscountPct:     PRICING_DEFAULTS.maxDiscountPct,
      costPerActiveTeacherManualOverrideRub: PRICING_DEFAULTS.costPerActiveTeacherManualOverrideRub,
      updatedBy: null,
      updatedAt: null,
    }
  }
  return {
    institutionId,
    activationOverride: r.activation_override != null ? parseFloat(r.activation_override) : null,
    marginMultiplier:   parseFloat(r.margin_multiplier),
    maxDiscountPct:      parseFloat(r.max_discount_pct),
    costPerActiveTeacherManualOverrideRub:
      r.cost_per_active_teacher_manual_override_rub != null
        ? parseFloat(r.cost_per_active_teacher_manual_override_rub)
        : null,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  }
}

export async function getPricingAssumptions(institutionId: string | null): Promise<PricingAssumptionsRow> {
  const { rows } = await pool.query<DbRow>(
    `SELECT * FROM pricing_assumptions WHERE institution_id IS NOT DISTINCT FROM $1`,
    [institutionId]
  )
  return fromDb(institutionId, rows[0])
}

export interface PricingAssumptionsPatch {
  activationOverride?: number | null
  marginMultiplier?: number
  maxDiscountPct?: number
  costPerActiveTeacherManualOverrideRub?: number | null
}

export async function upsertPricingAssumptions(
  institutionId: string | null, patch: PricingAssumptionsPatch, updatedBy: string
): Promise<PricingAssumptionsRow> {
  const current = await getPricingAssumptions(institutionId)

  const merged = {
    activationOverride: patch.activationOverride !== undefined ? patch.activationOverride : current.activationOverride,
    marginMultiplier:   patch.marginMultiplier   !== undefined ? patch.marginMultiplier   : current.marginMultiplier,
    maxDiscountPct:     patch.maxDiscountPct     !== undefined ? patch.maxDiscountPct     : current.maxDiscountPct,
    costPerActiveTeacherManualOverrideRub:
      patch.costPerActiveTeacherManualOverrideRub !== undefined
        ? patch.costPerActiveTeacherManualOverrideRub
        : current.costPerActiveTeacherManualOverrideRub,
  }

  const { rows } = await pool.query<DbRow>(
    `UPDATE pricing_assumptions SET
       activation_override = $2,
       margin_multiplier = $3,
       max_discount_pct = $4,
       cost_per_active_teacher_manual_override_rub = $5,
       updated_by = $6,
       updated_at = NOW()
     WHERE institution_id IS NOT DISTINCT FROM $1
     RETURNING *`,
    [institutionId, merged.activationOverride, merged.marginMultiplier, merged.maxDiscountPct,
      merged.costPerActiveTeacherManualOverrideRub, updatedBy]
  )

  if (rows.length > 0) return fromDb(institutionId, rows[0])

  const { rows: inserted } = await pool.query<DbRow>(
    `INSERT INTO pricing_assumptions
       (institution_id, activation_override, margin_multiplier, max_discount_pct,
        cost_per_active_teacher_manual_override_rub, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [institutionId, merged.activationOverride, merged.marginMultiplier, merged.maxDiscountPct,
      merged.costPerActiveTeacherManualOverrideRub, updatedBy]
  )
  return fromDb(institutionId, inserted[0])
}
