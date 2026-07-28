import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { clearGradingDrafts } from '../hooks/usePersistedState'
import type { Teacher, PlanState } from '../types'

interface AuthState {
  // The session itself lives in an HttpOnly cookie the browser attaches
  // automatically — this flag is only a UI signal for route guards, never
  // used to authenticate a request.
  authenticated:  boolean
  // Non-secret per-login seed used to key local AES-GCM encryption of
  // grading drafts (see lib/draftCrypto.ts). Rotates every login, same as
  // the old JWT-derived key did, but grants no API access on its own.
  draftKeySeed:   string | null
  teacher:        Teacher | null
  plan:           PlanState | null
  setAuth:        (teacher: Teacher, plan: PlanState, draftKeySeed: string) => void
  clearAuth:      () => void
  updatePlan:     (plan: PlanState) => void
  // Reconcile cached teacher + plan with the server (e.g. after an upgrade
  // confirmed outside this tab) without touching the session.
  updateAccount:  (teacher: Teacher, plan: PlanState) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      authenticated: false,
      draftKeySeed:  null,
      teacher:       null,
      plan:          null,
      setAuth:   (teacher, plan, draftKeySeed) => set({ authenticated: true, teacher, plan, draftKeySeed }),
      clearAuth: () => {
        clearGradingDrafts()   // don't leave student PII on disk after logout
        set({ authenticated: false, teacher: null, plan: null, draftKeySeed: null })
      },
      updatePlan: (plan) => set({ plan }),
      updateAccount: (teacher, plan) => set({ teacher, plan }),
    }),
    { name: 'ga_token' }
  )
)
