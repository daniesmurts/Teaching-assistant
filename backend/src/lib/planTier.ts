// Effective plan-tier computation — the SINGLE source of truth, shared by the
// authenticate middleware and the login route so they can never disagree
// (a past mismatch caused upgrades to only show after re-login).
//
// Effective tier = the stronger of:
//   - own tier, downgraded to 'free' if a personal subscription has expired
//   - the institution's tier, for active members (seat-based entitlement)

const TIER_RANK: Record<string, number> = { free: 0, pro: 1, institution: 2 }

export function strongerTier(a: string, b: string): string {
  return (TIER_RANK[a] ?? 0) >= (TIER_RANK[b] ?? 0) ? a : b
}

export function computeEffectiveTier(row: {
  plan_tier:             string | null
  plan_expires_at:       Date | null
  institution_id:        string | null
  institution_plan_tier: string | null
}): string {
  const ownTier =
    row.plan_expires_at && row.plan_expires_at < new Date()
      ? 'free'
      : (row.plan_tier ?? 'free')

  const institutionTier = row.institution_id ? (row.institution_plan_tier ?? 'free') : 'free'
  return strongerTier(ownTier, institutionTier)
}
