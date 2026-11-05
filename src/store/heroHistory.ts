import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { HeroRotationEntry } from '../lib/heroRotation'

/** Roughly five years of three-day rotations; the oldest picks fall off first so
 *  a long-lived profile cannot grow this without bound. */
const MAX_ENTRIES = 6000

interface HeroHistoryStore {
  /** Movies the hero has already featured, oldest first. */
  shown: HeroRotationEntry[]
  /** Newest rotation whose line-up is already stored. */
  recorded: number | null
  record: (rotation: number, ids: readonly number[]) => void
  /** Pool ran dry: forget the history so the hero can start a new cycle. */
  restart: (rotation: number) => void
}

/**
 * Hero history, so a movie featured for three days never comes back. Kept on the
 * device next to the rest of the profile rather than derived from the catalog:
 * what a viewer already saw is not something the panel can tell us.
 */
export const useHeroHistory = create<HeroHistoryStore>()(
  persist(
    (set, get) => ({
      shown: [],
      recorded: null,

      record: (rotation, ids) => {
        if (get().recorded === rotation) return
        const known = new Set(get().shown.map((entry) => entry.id))
        const fresh = ids
          .filter((id) => !known.has(id))
          .map((id) => ({ id, rotation } satisfies HeroRotationEntry))
        const shown = [...get().shown, ...fresh]
        set({
          shown: shown.length > MAX_ENTRIES ? shown.slice(shown.length - MAX_ENTRIES) : shown,
          recorded: rotation,
        })
      },

      restart: (rotation) => set({ shown: [], recorded: rotation }),
    }),
    { name: 'vntera:hero-rotation', version: 1 },
  ),
)
