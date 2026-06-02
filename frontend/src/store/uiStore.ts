import { create } from 'zustand'

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
}

export const useUIStore = create<UIState>((set) => ({
  toasts: [],
  addToast: (message, type = 'info') =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        { id: `${Date.now()}-${Math.random()}`, message, type },
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
}))
