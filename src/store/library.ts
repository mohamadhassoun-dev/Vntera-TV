import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ListEntry, MediaKind, NotificationItem, ProgressEntry, Title } from '../types'

interface LibraryStore {
  list: ListEntry[]
  progress: Record<string, ProgressEntry>
  watched: Record<string, boolean>
  /** Titles already nudged with a "keep watching" reminder. */
  reminded: Record<string, boolean>
  notifications: NotificationItem[]
  toggleList: (title: Title) => boolean
  isInList: (contentType: ListEntry['contentType'], contentId: number) => boolean
  saveProgress: (entry: Omit<ProgressEntry, 'lastWatched'>) => void
  progressFor: (contentType: MediaKind, contentId: number) => ProgressEntry | undefined
  removeProgress: (contentType: MediaKind, contentId: number) => void
  clearHistory: () => void
  markWatched: (seriesId: number, season: number, episode: number) => void
  isWatched: (seriesId: number, season: number, episode: number) => boolean
  addNotification: (item: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>) => void
  markAllRead: () => void
  clearNotifications: () => void
  exportData: () => string
  importData: (raw: string) => boolean
}

const progressKey = (type: MediaKind, id: number) => `${type}:${id}`

export const useLibrary = create<LibraryStore>()(
  persist(
    (set, get) => ({
      list: [],
      progress: {},
      watched: {},
      reminded: {},
      notifications: [
        {
          id: 'welcome',
          kind: 'system',
          title: 'Welcome to Vntera',
          body: 'Your rails, continue watching and My List sync through this profile.',
          createdAt: Date.now(),
          read: false,
          href: '/',
        },
      ],

      toggleList: (title) => {
        const contentType = title.kind === 'live' ? 'live' : title.kind
        const existing = get().list.find((l) => l.contentId === title.id && l.contentType === contentType)
        if (existing) {
          set({ list: get().list.filter((l) => l !== existing) })
          return false
        }
        set({ list: [{ contentId: title.id, contentType, addedAt: Date.now() }, ...get().list] })
        return true
      },

      isInList: (contentType, contentId) => get().list.some((l) => l.contentId === contentId && l.contentType === contentType),

      saveProgress: (entry) => {
        const key = progressKey(entry.contentType, entry.contentId)
        const ratio = entry.duration > 0 ? entry.progress / entry.duration : 0
        const reminded = get().reminded ?? {}
        const shouldRemind =
          entry.contentType !== 'live' && ratio >= 0.3 && ratio < 0.96 && !reminded[key]
        set({
          progress: { ...get().progress, [key]: { ...entry, lastWatched: Date.now() } },
          ...(shouldRemind ? { reminded: { ...reminded, [key]: true } } : {}),
        })
        if (shouldRemind) {
          const name = entry.title.split(' · ')[0]
          const percent = Math.max(30, Math.round(ratio * 100))
          const lines = [
            `${name} is waiting for you — you're ${percent}% in, and the best part is still ahead.`,
            `Plot twist loading… ${name} is paused at ${percent}%. Don't leave it hanging.`,
            `Your couch called: ${name} misses you (${percent}% watched).`,
          ]
          get().addNotification({
            kind: 'content',
            title: `Continue ${name}`,
            body: lines[entry.contentId % lines.length],
            href:
              entry.contentType === 'series'
                ? `/title/series/${entry.parentId ?? entry.contentId}`
                : `/title/movie/${entry.contentId}`,
            poster: entry.thumbnail,
          })
        }
      },

      progressFor: (contentType, contentId) => get().progress[progressKey(contentType, contentId)],

      removeProgress: (contentType, contentId) => {
        const next = { ...get().progress }
        delete next[progressKey(contentType, contentId)]
        set({ progress: next })
      },

      clearHistory: () => set({ progress: {}, watched: {}, reminded: {} }),

      markWatched: (seriesId, season, episode) =>
        set({ watched: { ...get().watched, [`${seriesId}:${season}:${episode}`]: true } }),

      isWatched: (seriesId, season, episode) => !!get().watched[`${seriesId}:${season}:${episode}`],

      addNotification: (item) =>
        set({
          notifications: [
            { ...item, id: Math.random().toString(36).slice(2), createdAt: Date.now(), read: false },
            ...get().notifications,
          ].slice(0, 40),
        }),

      markAllRead: () => set({ notifications: get().notifications.map((n) => ({ ...n, read: true })) }),

      clearNotifications: () => set({ notifications: [] }),

      exportData: () => JSON.stringify({ list: get().list, progress: get().progress, watched: get().watched }, null, 2),

      importData: (raw) => {
        try {
          const data = JSON.parse(raw) as Pick<LibraryStore, 'list' | 'progress' | 'watched'>
          if (!Array.isArray(data.list)) return false
          set({ list: data.list, progress: data.progress ?? {}, watched: data.watched ?? {} })
          return true
        } catch {
          return false
        }
      },
    }),
    { name: 'vntera:library', version: 1 },
  ),
)

export function continueWatching(limit = 12): ProgressEntry[] {
  return Object.values(useLibrary.getState().progress)
    .filter((p) => p.progress > 5 && (!p.duration || p.progress / p.duration < 0.96))
    .sort((a, b) => b.lastWatched - a.lastWatched)
    .slice(0, limit)
}
