import { create } from 'zustand'
import { EPG_CACHE_MS } from '../lib/config'
import { getEPG, getShortEpg } from '../lib/xtream'
import { groupByChannel, parseXmltv } from '../lib/xmltv'
import type { EpgProgramme } from '../types'
import { useAuth } from './auth'
import { useUI } from './ui'

interface EpgEntry {
  programmes: EpgProgramme[]
  fetchedAt: number
  full: boolean
}

interface EpgStore {
  cache: Record<string, EpgEntry>
  loading: Record<string, boolean>
  ensure: (params: { channelId?: string; streamId: number; name: string; full?: boolean }) => Promise<void>
  forChannel: (channelId?: string) => EpgProgramme[]
  fullGuideLoaded: boolean
  fullGuideBusy: boolean
  loadFullGuide: () => Promise<void>
}

const key = (channelId?: string, streamId?: number) => channelId || (streamId != null ? String(streamId) : '')

export const useEpg = create<EpgStore>((set, get) => ({
  cache: {},
  loading: {},
  fullGuideLoaded: false,
  fullGuideBusy: false,

  ensure: async ({ channelId, streamId, full = false }) => {
    const k = key(channelId, streamId)
    if (!k) return
    const cached = get().cache[k]
    if (cached && Date.now() - cached.fetchedAt < EPG_CACHE_MS && (!full || cached.full)) return
    if (get().loading[k]) return

    set({ loading: { ...get().loading, [k]: true } })
    try {
      // Cards only need now/next; the full table is reserved for the guide and
      // the channel page (a 100-channel home row must not issue 100 full pulls).
      const programmes = full ? await getEPG(String(streamId)) : await getShortEpg(streamId, 3)
      set((s) => ({
        cache: { ...s.cache, [k]: { programmes, fetchedAt: Date.now(), full } },
        loading: { ...s.loading, [k]: false },
      }))
    } catch {
      // Keep any cached data; retry on the next visibility change.
      set((s) => ({ loading: { ...s.loading, [k]: false } }))
    }
  },

  forChannel: (channelId) => (channelId ? (get().cache[channelId]?.programmes ?? []) : []),

  loadFullGuide: async () => {
    if (get().fullGuideBusy) return
    const session = useAuth.getState().session
    if (!session) return
    set({ fullGuideBusy: true })
    const toast = useUI.getState().toast
    try {
      const { fetchXmltv } = await import('../lib/xtream')
      // Background sync: no start/finish toasts, the guide updates silently.
      const xml = await fetchXmltv()
      const { programmes } = parseXmltv(xml)
      const grouped = groupByChannel(programmes)
      const cache: Record<string, EpgEntry> = { ...get().cache }
      for (const [channelId, list] of grouped) cache[channelId] = { programmes: list, fetchedAt: Date.now(), full: true }
      set({ cache, fullGuideLoaded: true, fullGuideBusy: false })
    } catch (err) {
      set({ fullGuideBusy: false })
      toast(err instanceof Error ? err.message : 'Guide download failed', 'error')
    }
  },
}))

/** Short EPG helper used by live tiles: only "now" and "next" are needed. */
export async function fetchNowNext(streamId: number): Promise<EpgProgramme[]> {
  try {
    return await getShortEpg(streamId, 2)
  } catch {
    return []
  }
}
