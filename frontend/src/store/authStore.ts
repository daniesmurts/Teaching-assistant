import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Teacher } from '../types'

interface AuthState {
  token: string | null
  teacher: Teacher | null
  setAuth: (token: string, teacher: Teacher) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      teacher: null,
      setAuth: (token, teacher) => set({ token, teacher }),
      clearAuth: () => set({ token: null, teacher: null }),
    }),
    { name: 'ga_token' }
  )
)
