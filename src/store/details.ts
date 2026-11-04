import { create } from 'zustand'
import type { SeriesInfo, VodInfo } from '../types'
import { getSeriesInfo, getVODInfo } from '../lib/xtream'

interface DetailsStore {
  series: Record<number, SeriesInfo>
  vod: Record<number, VodInfo>
  loading: Record<string, boolean>
  error: Record<string, string | undefined>
  loadSeries: (id: number) => Promise<SeriesInfo | null>
  loadVod: (id: number) => Promise<VodInfo | null>
}

export const useDetails = create<DetailsStore>((set, get) => ({
  series: {},
  vod: {},
  loading: {},
  error: {},

  loadSeries: async (id) => {
    const cached = get().series[id]
    if (cached) return cached
    set((s) => ({ loading: { ...s.loading, [`s${id}`]: true } }))
    try {
      const info = await getSeriesInfo(id)
      set((s) => ({
        series: { ...s.series, [id]: info },
        loading: { ...s.loading, [`s${id}`]: false },
        error: { ...s.error, [`s${id}`]: undefined },
      }))
      return info
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [`s${id}`]: false },
        error: { ...s.error, [`s${id}`]: err instanceof Error ? err.message : 'Unable to load episodes.' },
      }))
      return null
    }
  },

  loadVod: async (id) => {
    const cached = get().vod[id]
    if (cached) return cached
    set((s) => ({ loading: { ...s.loading, [`v${id}`]: true } }))
    try {
      const info = await getVODInfo(id)
      set((s) => ({ vod: { ...s.vod, [id]: info }, loading: { ...s.loading, [`v${id}`]: false } }))
      return info
    } catch {
      set((s) => ({ loading: { ...s.loading, [`v${id}`]: false } }))
      return null
    }
  },
}))
