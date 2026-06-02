import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Teacher, PlanState } from '../types'

interface AuthState {
  token:      string | null
  teacher:    Teacher | null
  plan:       PlanState | null
  setAuth:    (token: string, teacher: Teacher, plan: PlanState) => void
  clearAuth:  () => void
  updatePlan: (plan: PlanState) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token:     null,
      teacher:   null,
      plan:      null,
      setAuth:   (token, teacher, plan) => set({ token, teacher, plan }),
      clearAuth: () => set({ token: null, teacher: null, plan: null }),
      updatePlan: (plan) => set({ plan }),
    }),
    { name: 'ga_token' }
  )
)
