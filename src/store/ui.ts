import { create } from 'zustand'

export interface Toast {
  id: string
  message: string
  tone: 'default' | 'error' | 'success'
}

interface UIStore {
  searchOpen: boolean
  toasts: Toast[]
  openSearch: () => void
  closeSearch: () => void
  toast: (message: string, tone?: Toast['tone']) => void
  dismiss: (id: string) => void
}

export const useUI = create<UIStore>((set) => ({
  searchOpen: false,
  toasts: [],
  openSearch: () => set({ searchOpen: true }),
  closeSearch: () => set({ searchOpen: false }),
  toast: (message, tone = 'default') => {
    const id = Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, tone }] }))
    window.setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3600)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
