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
}))
