import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CatalogSnapshot, Title } from '../types'
import { COLLECTIONS, type CollectionSlug } from '../lib/collections'
import { featuredChannels } from './catalog'

export type ShortcutItem =
  | { type: 'channel'; id: number; label: string }
  | { type: 'collection'; slug: CollectionSlug }
  | { type: 'category'; id: string; label: string }

export interface ResolvedShortcut {
  key: string
  label: string
  /** Present for collections and live categories. */
  href?: string
  /** Present for single channels. */
  channel?: Title
  item: ShortcutItem
}

interface ShortcutStore {
  /** null means "not customised yet": the curated default is used. */
  items: ShortcutItem[] | null
  setItems: (items: ShortcutItem[]) => void
  reset: () => void
}

export const useShortcuts = create<ShortcutStore>()(
  persist(
    (set) => ({
      items: null,
      setItems: (items) => set({ items }),
      reset: () => set({ items: null }),
    }),
    {
      name: 'vntera:shortcuts',
      version: 2,
      // Kids and Anime moved to their own Home rails, so saved shortcuts from
      // v1 must not keep duplicating them in the shortcut column.
      migrate: (persisted) => {
        const state = persisted as { items?: ShortcutItem[] | null } | undefined
        const items = state?.items
        if (!items) return { items: null }
        const kept = items.filter((item) => item.type !== 'collection')
        return { items: kept.length ? kept : null }
      },
    },
  ),
)

/** Curated default: the panel's pinned channels. */
export function defaultShortcutItems(snapshot: CatalogSnapshot | null): ShortcutItem[] {
  return featuredChannels(snapshot).map(({ channel, label }) => ({
    type: 'channel' as const,
    id: channel.id,
    label,
  }))
}

/** Turn stored descriptors into renderable entries, dropping anything missing. */
export function resolveShortcuts(
  snapshot: CatalogSnapshot | null,
  items: ShortcutItem[],
  liveCategories: Array<{ id: string; name: string }>,
): ResolvedShortcut[] {
  const out: ResolvedShortcut[] = []
  for (const item of items) {
    if (item.type === 'channel') {
      const channel = snapshot?.channels.find((candidate) => candidate.id === item.id)
      if (!channel) continue
      out.push({ key: `channel:${item.id}`, label: item.label, channel, item })
      continue
    }
    if (item.type === 'collection') {
      const collection = COLLECTIONS[item.slug]
      if (!collection) continue
      out.push({ key: `collection:${item.slug}`, label: collection.label, href: `/collection/${item.slug}`, item })
      continue
    }
    const category = liveCategories.find((entry) => entry.id === item.id)
    if (!category) continue
    out.push({
      key: `category:${item.id}`,
      label: item.label || category.name,
      href: `/live?category=${encodeURIComponent(item.id)}`,
      item,
    })
  }
  return out
}
