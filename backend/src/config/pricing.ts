// Subscription plans purchasable via T-Bank. Amounts in kopecks (1 ₽ = 100 kop).
// These mirror the prices shown in the UI — keep both in sync.

export const PURCHASABLE_PLANS = {
  pro_monthly: {
    amountKopecks: 99_000,    // ₽990
    days:          30,
    tier:          'pro',
    label:         'ИСПУМ Pro — 1 месяц',
  },
  pro_annual: {
    amountKopecks: 790_000,   // ₽7 900
    days:          365,
    tier:          'pro',
    label:         'ИСПУМ Pro — 1 год',
  },
} as const

export type PurchasablePlan = keyof typeof PURCHASABLE_PLANS

export function isPurchasablePlan(value: string): value is PurchasablePlan {
  return value === 'pro_monthly' || value === 'pro_annual'
}
