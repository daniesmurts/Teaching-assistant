import { create } from 'zustand'

/** The score is always 1..3 with 1 = worst, so features stay comparable — but
 *  the wording is per-feature, because a generic «плохо/нормально/хорошо»
 *  asks for a mood, and the answers worth having are about what just
 *  happened. `labels` is ordered [1, 2, 3]. */
export interface SatisfactionAsk {
  question: string
  labels:   [string, string, string]
}

export interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

interface UIState {
  toasts: Toast[]
  addToast: (message: string, type?: Toast['type']) => void
  removeToast: (id: string) => void
  mobileSidebarOpen: boolean
  setMobileSidebarOpen: (open: boolean) => void
  upgradeModalOpen: boolean
  upgradeModalCode: string | null
  showUpgradeModal: (code?: string) => void
  hideUpgradeModal: () => void
  // Micro-satisfaction prompt (TODO Feature SAT). Held in the store rather
  // than local state at the trigger site so the bar survives the navigation
  // that often follows the action being rated — approving a grade frequently
  // sends the teacher straight to История.
  satisfactionPromptId: string | null
  satisfactionAsk: SatisfactionAsk | null
  showSatisfaction: (promptId: string, ask: SatisfactionAsk) => void
  hideSatisfaction: () => void
}

export const useUIStore = create<UIState>((set) => ({
  toasts: [],
  // Coerce to string at the store boundary as belt-and-braces — ToastContainer
  // renders `toast.message` directly, so a non-string slip-through here would
  // crash React. Better to render a less-helpful "[object Object]" than to
  // unmount the toast tree (and with it any other toast on screen).
  addToast: (message, type = 'info') =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        { id: `${Date.now()}-${Math.random()}`, message: typeof message === 'string' ? message : String(message), type },
      ],
    })),
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  mobileSidebarOpen: false,
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
  upgradeModalOpen: false,
  upgradeModalCode: null,
  showUpgradeModal: (code) => set({ upgradeModalOpen: true, upgradeModalCode: code ?? null }),
  hideUpgradeModal: () => set({ upgradeModalOpen: false, upgradeModalCode: null }),
  satisfactionPromptId: null,
  satisfactionAsk: null,
  showSatisfaction: (promptId, ask) => set({ satisfactionPromptId: promptId, satisfactionAsk: ask }),
  hideSatisfaction: () => set({ satisfactionPromptId: null, satisfactionAsk: null }),
}))
